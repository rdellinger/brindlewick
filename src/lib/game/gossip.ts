/**
 * gossip.ts
 *
 * Brindlewick gossip system.
 *
 * Three phases:
 *  1. Capture  — detect personal facts in player messages; record witnessed actions
 *  2. Spread   — cron propagates gossip between co-located NPCs by gossip_rating
 *  3. Surface  — enrich NPC dialogue prompts with what they know
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicClient, MODEL } from '../anthropic/client'
import { getEasternTime } from '../realtime'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GossipItem {
  id: string
  content: string
  subject: string
  category: string
  player_key: string | null
  origin_citizen_id: string | null
  created_at: string
}

// ── Player key helpers ────────────────────────────────────────────────────────

export function makePlayerKey(playerId: string | null, guestToken: string | null): string | null {
  if (playerId) return `player:${playerId}`
  if (guestToken) return `guest:${guestToken}`
  return null
}

// ── Capture: detect personal facts from player messages ───────────────────────

// Quick keyword filter — only call Claude if message looks personal
const PERSONAL_SIGNALS = /\b(i'?m|i am|i was|i used to|i have|i love|i hate|i grew up|i've been|i work|i live|i came from|my (name|job|work|home|family|dog|cat|hobby|passion|profession|background|sister|brother|mother|father|parents|kids|children|husband|wife|partner)|i'm from|i studied|i moved|i retired)\b/i

/**
 * Detect whether a player message contains a personal fact. If so, creates a
 * gossip_item and grants knowledge to the listening NPC.
 *
 * Cost: one haiku call (~$0.00001) only when personal signals are detected.
 */
export async function detectAndStorePlayerFact(
  supabase: SupabaseClient,
  playerMessage: string,
  playerKey: string | null,
  citizenId: string
): Promise<void> {
  if (!playerKey) return
  if (!PERSONAL_SIGNALS.test(playerMessage)) return
  // B3: raised from 10 → 25 chars. Short messages that trip the keyword
  // filter ("I'm good", "I have to go") almost never contain a storable
  // personal fact — skipping them cuts detection calls roughly in half.
  if (playerMessage.length < 25) return

  try {
    const client = getAnthropicClient()
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 80,
      system: 'Extract any personal fact the speaker reveals about themselves. Reply with exactly one sentence starting with "The visitor" describing the fact. If no personal fact is revealed, reply with exactly: NONE',
      messages: [{ role: 'user', content: playerMessage }],
    })
    const text = result.content[0].type === 'text' ? result.content[0].text.trim() : 'NONE'
    if (text === 'NONE' || !text.startsWith('The visitor')) return

    // Check for near-duplicate to avoid storing the same fact twice
    const { data: existing } = await supabase
      .from('gossip_items')
      .select('id')
      .eq('player_key', playerKey)
      .ilike('content', `%${text.slice(12, 40)}%`) // rough dedup
      .limit(1)
    if (existing && existing.length > 0) return

    // Store gossip item
    const { data: item, error } = await supabase
      .from('gossip_items')
      .insert({
        content: text,
        subject: 'player',
        category: 'player_fact',
        player_key: playerKey,
        origin_citizen_id: citizenId,
      })
      .select('id')
      .single()

    if (error || !item) return

    // NPC who heard it now knows this gossip
    await supabase.from('citizen_gossip').upsert(
      { citizen_id: citizenId, gossip_id: item.id },
      { onConflict: 'citizen_id,gossip_id', ignoreDuplicates: true }
    )
  } catch {
    // Non-fatal — gossip capture failure should never break dialogue
  }
}

/**
 * Record a notable action the player took that a witnessing NPC may gossip about.
 * Call this from the engine when notable things happen (picking up items,
 * entering special locations, completing quests).
 */
export async function recordWitnessedAction(
  supabase: SupabaseClient,
  playerKey: string | null,
  actionDescription: string,  // e.g. "The visitor was seen taking the old key from the antique shop"
  locationId: string,
  witnessCitizenIds: string[]  // citizens present at the location
): Promise<void> {
  if (!playerKey || !witnessCitizenIds.length) return

  try {
    const { data: item, error } = await supabase
      .from('gossip_items')
      .insert({
        content: actionDescription,
        subject: 'player',
        category: 'player_action',
        player_key: playerKey,
        origin_citizen_id: witnessCitizenIds[0] ?? null,
      })
      .select('id')
      .single()

    if (error || !item) return

    // All witnesses know this
    const rows = witnessCitizenIds.map(cid => ({ citizen_id: cid, gossip_id: item.id }))
    await supabase.from('citizen_gossip').upsert(rows, { onConflict: 'citizen_id,gossip_id', ignoreDuplicates: true })
  } catch {
    // Non-fatal
  }

  void locationId // used by callers for context, not needed here
}

// ── Surface: what does an NPC know about the player ──────────────────────────

/**
 * Returns up to `limit` gossip items this NPC knows about the player,
 * sorted by most recent. Used to enrich dialogue system prompts.
 */
export async function getPlayerGossipForNpc(
  supabase: SupabaseClient,
  citizenId: string,
  playerKey: string | null,
  limit = 4
): Promise<string[]> {
  if (!playerKey) return []

  // Get gossip IDs this citizen knows
  const { data: cgRows } = await supabase
    .from('citizen_gossip')
    .select('gossip_id')
    .eq('citizen_id', citizenId)

  if (!cgRows || cgRows.length === 0) return []

  const ids = cgRows.map((r: { gossip_id: string }) => r.gossip_id)

  // Fetch items about this player
  const { data: items } = await supabase
    .from('gossip_items')
    .select('content')
    .in('id', ids)
    .eq('player_key', playerKey)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (items ?? []).map((i: { content: string }) => i.content)
}

// ── Spread: cron propagates gossip between co-located NPCs ───────────────────

/**
 * Called by the cron job. For each location where multiple citizens are
 * present right now, high-gossip-rating citizens spread what they know to
 * co-located citizens.
 *
 * Spread probability = gossip_rating / 10 per cron tick.
 */
export async function spreadGossip(supabase: SupabaseClient): Promise<{ spread: number }> {
  const et = getEasternTime()
  const DOW_FULL = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  const dowKey = DOW_FULL[et.dow]
  const timeSlot = et.timeSlot

  // Get all citizen routines for current day + time slot
  const { data: routines } = await supabase
    .from('citizen_routines')
    .select('citizen_id, location_id')
    .eq('day_of_week', dowKey)
    .eq('time_slot', timeSlot)

  if (!routines || routines.length === 0) return { spread: 0 }

  // Group citizens by location
  const byLocation: Record<string, string[]> = {}
  for (const r of routines as Array<{ citizen_id: string; location_id: string }>) {
    if (!byLocation[r.location_id]) byLocation[r.location_id] = []
    byLocation[r.location_id].push(r.citizen_id)
  }

  // Only locations with 2+ citizens matter
  const activeLocations = Object.entries(byLocation).filter(([, ids]) => ids.length >= 2)
  if (!activeLocations.length) return { spread: 0 }

  // Get all citizen IDs involved and their gossip ratings
  const allCitizenIds = [...new Set(activeLocations.flatMap(([, ids]) => ids))]
  const { data: citizenRows } = await supabase
    .from('citizens')
    .select('id, gossip_rating')
    .in('id', allCitizenIds)

  const ratingMap: Record<string, number> = {}
  for (const c of (citizenRows ?? []) as Array<{ id: string; gossip_rating: number }>) {
    ratingMap[c.id] = c.gossip_rating ?? 5
  }

  // Get all gossip these citizens know (that hasn't been over-shared)
  const { data: knowledgeRows } = await supabase
    .from('citizen_gossip')
    .select('citizen_id, gossip_id, times_shared')
    .in('citizen_id', allCitizenIds)
    .lt('times_shared', 15) // cap spread

  // Build: citizen → gossip they know
  const bySharer: Record<string, string[]> = {}
  for (const row of (knowledgeRows ?? []) as Array<{ citizen_id: string; gossip_id: string; times_shared: number }>) {
    if (!bySharer[row.citizen_id]) bySharer[row.citizen_id] = []
    bySharer[row.citizen_id].push(row.gossip_id)
  }

  let spreadCount = 0
  const newKnowledge: Array<{ citizen_id: string; gossip_id: string }> = []
  const sharedGossipIds: string[] = []

  for (const [, citizenIds] of activeLocations) {
    for (const sharerId of citizenIds) {
      const gossipRating = ratingMap[sharerId] ?? 5
      // Roll to share
      if (Math.random() > gossipRating / 10) continue

      const gossipIds = bySharer[sharerId] ?? []
      if (!gossipIds.length) continue

      const recipients = citizenIds.filter(id => id !== sharerId)
      for (const gossipId of gossipIds) {
        for (const recipientId of recipients) {
          newKnowledge.push({ citizen_id: recipientId, gossip_id: gossipId })
          spreadCount++
        }
        sharedGossipIds.push(gossipId)
      }
    }
  }

  // Batch upsert new knowledge (ignore duplicates — citizen already knows)
  if (newKnowledge.length > 0) {
    // Upsert in chunks of 100
    for (let i = 0; i < newKnowledge.length; i += 100) {
      await supabase
        .from('citizen_gossip')
        .upsert(newKnowledge.slice(i, i + 100), { onConflict: 'citizen_id,gossip_id', ignoreDuplicates: true })
    }
  }

  // Increment times_shared for shared gossip items
  const uniqueShared = [...new Set(sharedGossipIds)]
  for (const gossipId of uniqueShared) {
    // Simple increment via RPC or direct update
    await supabase.rpc('increment_gossip_shared_count', { p_gossip_id: gossipId })
      .then(() => {}) // ignore error — times_shared is just for rate limiting
  }

  return { spread: spreadCount }
}

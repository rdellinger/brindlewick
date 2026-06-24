/**
 * Player state management — trust levels, saves, sessions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameSession, PlayerSave, GuestSave, ConversationMessage } from '../../types/game'
import { v4 as uuidv4 } from 'uuid'

const MAX_STORED_MESSAGES = 30  // 15 back-and-forth exchanges

// ── Trust System ─────────────────────────────────────────────────────────────

export async function getTrustLevel(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string
): Promise<number> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data } = await supabase
    .from('player_citizen_trust')
    .select('trust_level')
    .eq(key, val)
    .eq('citizen_id', citizenId)
    .single()

  return data?.trust_level ?? 0
}

/**
 * Update trust level for a citizen.
 * increment is the amount to add (can be fractional — we floor to int before storing).
 * Returns the new integer trust level.
 */
export async function updateTrust(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string,
  currentTrust: number,
  increment: number
): Promise<number> {
  const newLevel = Math.min(
    Math.floor(currentTrust + increment),
    5  // absolute max trust
  )

  if (newLevel === Math.floor(currentTrust)) return Math.floor(currentTrust)

  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  await supabase
    .from('player_citizen_trust')
    .upsert({
      [key]: val,
      citizen_id: citizenId,
      trust_level: newLevel,
      last_interaction: new Date().toISOString(),
    }, {
      onConflict: key === 'player_id'
        ? 'player_id,citizen_id'
        : 'guest_token,citizen_id',
    })

  return newLevel
}

// ── Save Management ───────────────────────────────────────────────────────────

export async function getOrCreateGuestSave(
  supabase: SupabaseClient,
  sessionToken: string
): Promise<GuestSave> {
  const { data: existing } = await supabase
    .from('guest_saves')
    .select('*')
    .eq('session_token', sessionToken)
    .single()

  if (existing) return existing as GuestSave

  const { data: created, error } = await supabase
    .from('guest_saves')
    .insert({
      session_token: sessionToken,
      current_location: 'lantern_post_inn',  // newcomers start at the inn
      inventory: [],
      data: {},
    })
    .select()
    .single()

  if (error) throw error
  return created as GuestSave
}

export async function getOrCreatePlayerSave(
  supabase: SupabaseClient,
  playerId: string
): Promise<PlayerSave> {
  const { data: existing } = await supabase
    .from('player_saves')
    .select('*')
    .eq('player_id', playerId)
    .single()

  if (existing) return existing as PlayerSave

  const { data: created, error } = await supabase
    .from('player_saves')
    .insert({
      player_id: playerId,
      current_location: 'lantern_post_inn',
      inventory: [],
    })
    .select()
    .single()

  if (error) throw error
  return created as PlayerSave
}

export async function buildGameSession(
  supabase: SupabaseClient,
  playerId?: string,
  guestToken?: string
): Promise<GameSession> {
  const { data: world } = await supabase
    .from('world_state')
    .select('*')
    .eq('id', 1)
    .single()

  if (playerId) {
    const save = await getOrCreatePlayerSave(supabase, playerId)
    const saveRow = save as unknown as Record<string, unknown>
    return {
      playerId,
      guestToken: null,
      currentLocation: save.current_location,
      inventory: save.inventory,
      worldState: world,
      timePosition: (saveRow.time_position as string | null) ?? null,
      hasChronoLogbook: (saveRow.has_chrono_logbook as boolean) ?? false,
    }
  }

  if (guestToken) {
    const save = await getOrCreateGuestSave(supabase, guestToken)
    const saveRow = save as unknown as Record<string, unknown>
    return {
      playerId: null,
      guestToken,
      currentLocation: save.current_location,
      inventory: save.inventory,
      worldState: world,
      timePosition: (saveRow.time_position as string | null) ?? null,
      hasChronoLogbook: (saveRow.has_chrono_logbook as boolean) ?? false,
    }
  }

  throw new Error('Either playerId or guestToken is required')
}

export function generateGuestToken(): string {
  return `guest_${uuidv4().replace(/-/g, '')}`
}

// ── Conversation Memory ───────────────────────────────────────────────────────

/**
 * Load stored conversation history between the player and a citizen.
 * Returns an empty array if they've never spoken before.
 */
export async function getConversationHistory(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string
): Promise<ConversationMessage[]> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data } = await supabase
    .from('player_citizen_conversations')
    .select('history')
    .eq(key, val)
    .eq('citizen_id', citizenId)
    .single()

  return (data?.history as ConversationMessage[]) ?? []
}

/**
 * Append new messages to stored history, trimming to MAX_STORED_MESSAGES.
 * Call after each exchange so the NPC remembers it next session.
 */
export async function saveConversationHistory(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string,
  newMessages: ConversationMessage[]
): Promise<void> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Load existing history first
  const { data: existing } = await supabase
    .from('player_citizen_conversations')
    .select('history')
    .eq(key, val)
    .eq('citizen_id', citizenId)
    .single()

  const current: ConversationMessage[] = (existing?.history as ConversationMessage[]) ?? []
  const combined = [...current, ...newMessages]
  // Keep only the most recent messages to bound token usage
  const trimmed = combined.slice(-MAX_STORED_MESSAGES)

  await supabase
    .from('player_citizen_conversations')
    .upsert({
      [key]: val,
      citizen_id: citizenId,
      history: trimmed,
      last_talked_at: new Date().toISOString(),
    }, {
      onConflict: key === 'player_id' ? 'player_id,citizen_id' : 'guest_token,citizen_id',
    })
}

// ── Journal ───────────────────────────────────────────────────────────────────

export async function addJournalEntry(
  supabase: SupabaseClient,
  session: GameSession,
  entryType: string,
  title: string,
  content: string,
  relatedId?: string
): Promise<void> {
  const { data: world } = await supabase
    .from('world_state')
    .select('game_date')
    .eq('id', 1)
    .single()

  await supabase.from('player_journal').insert({
    player_id: session.playerId,
    guest_token: session.guestToken,
    entry_type: entryType,
    title,
    content,
    related_id: relatedId ?? null,
    game_date: world?.game_date ?? null,
  })
}

// ── Seen Items ────────────────────────────────────────────────────────────────

export async function markItemSeen(
  supabase: SupabaseClient,
  session: GameSession,
  itemId: string
): Promise<void> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken
  await supabase.from('player_seen_items').upsert(
    { [key]: val, item_id: itemId },
    { onConflict: key === 'player_id' ? 'player_id,item_id' : 'guest_token,item_id', ignoreDuplicates: true }
  )
}

export async function getSeenItemIds(
  supabase: SupabaseClient,
  session: GameSession
): Promise<string[]> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken
  const { data } = await supabase
    .from('player_seen_items')
    .select('item_id')
    .eq(key, val)
  return (data ?? []).map((r: { item_id: string }) => r.item_id)
}

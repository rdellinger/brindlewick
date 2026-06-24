/**
 * NPC Item System
 *
 * Handles scripted item behaviors for citizens: picking up, dropping,
 * transferring to other citizens, and offering/giving to the player.
 *
 * Three entry points:
 *   processWorldTickBehaviors  — called by the cron job each tick
 *   processArrivalBehaviors    — called by handleLook when player enters a location
 *   processInteractionBehaviors — called by handleTalk/handleAsk
 *
 * Behavior rule schema (citizen_item_behaviors table):
 *   trigger_type: 'world_tick' | 'on_arrival' | 'on_talk' | 'on_ask'
 *   trigger_condition: e.g. "at_location:perkins_cider_house", "trust >= 3",
 *                      "holding:perkins_alpine_honey", "mystery:missing_recipe_accessed"
 *   action_type: 'pick_up' | 'drop' | 'give_to_citizen' | 'offer_to_player' | 'give_to_player'
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameSession, Item } from '../../types/game'
import { getTrustLevel } from './player'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CitizenItemBehavior {
  id: string
  citizen_id: string
  trigger_type: 'world_tick' | 'on_arrival' | 'on_talk' | 'on_ask'
  trigger_condition: string | null
  action_type: 'pick_up' | 'drop' | 'give_to_citizen' | 'offer_to_player' | 'give_to_player'
  item_id: string
  target_citizen_id: string | null
  once_only: boolean
  dialogue_hint: string | null
  sort_order: number
}

export interface NpcItemOffer {
  citizenId: string
  citizenName: string
  itemId: string
  itemName: string
  dialogueHint: string
}

export interface NpcItemTransferResult {
  transferred: boolean
  item?: Item
  narrativeHint?: string
}

// ── Condition evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a behavior's trigger_condition.
 *
 * Supported formats:
 *   null / undefined              → always passes
 *   "at_location:<location_id>"   → NPC must be at this location (uses citizen schedule)
 *   "trust >= <n>"                → player trust with this citizen >= n
 *   "holding:<item_id>"           → citizen must currently hold this item
 *   "mystery:<mystery_id>_accessed" → player has at least one clue for this mystery
 */
async function evaluateBehaviorCondition(
  supabase: SupabaseClient,
  condition: string | null | undefined,
  citizenId: string,
  citizenCurrentLocation: string | null,
  session: GameSession | null
): Promise<boolean> {
  if (!condition) return true

  // at_location:<location_id>
  const atLocMatch = condition.match(/^at_location:(\S+)$/)
  if (atLocMatch) {
    return citizenCurrentLocation === atLocMatch[1]
  }

  // trust >= N  (requires a session)
  const trustMatch = condition.match(/^trust\s*>=\s*(\d+)$/)
  if (trustMatch && session) {
    const required = parseInt(trustMatch[1])
    const trust = await getTrustLevel(supabase, session, citizenId)
    return trust >= required
  }

  // holding:<item_id>
  const holdingMatch = condition.match(/^holding:(\S+)$/)
  if (holdingMatch) {
    const itemId = holdingMatch[1]
    const { data } = await supabase
      .from('citizen_item_holdings')
      .select('id')
      .eq('citizen_id', citizenId)
      .eq('item_id', itemId)
      .maybeSingle()
    return !!data
  }

  // mystery:<mystery_id>_accessed  (requires a session)
  const mysteryMatch = condition.match(/^mystery:(\S+)_accessed$/)
  if (mysteryMatch && session) {
    const mysteryId = mysteryMatch[1]
    const key = session.playerId ? 'player_id' : 'guest_token'
    const val = session.playerId ?? session.guestToken
    const { count } = await supabase
      .from('player_mystery_clues')
      .select('id', { count: 'exact', head: true })
      .eq(key, val)
      .eq('mystery_id', mysteryId)
    return (count ?? 0) > 0
  }

  // Unknown condition — default allow
  return true
}

// ── Behavior log helpers ──────────────────────────────────────────────────────

async function hasAlreadyFired(supabase: SupabaseClient, behaviorId: string): Promise<boolean> {
  const { data } = await supabase
    .from('citizen_item_behavior_log')
    .select('id')
    .eq('behavior_id', behaviorId)
    .maybeSingle()
  return !!data
}

async function logBehaviorFired(
  supabase: SupabaseClient,
  behaviorId: string,
  context: Record<string, unknown>
): Promise<void> {
  await supabase.from('citizen_item_behavior_log').insert({
    behavior_id: behaviorId,
    context: { ...context, once_only: true },
  })
}

// ── Citizen current location ──────────────────────────────────────────────────

/**
 * Get the citizen's current location based on their schedule (game time aware).
 * Returns null if not on schedule or not found.
 */
async function getCitizenCurrentLocation(
  supabase: SupabaseClient,
  citizenId: string
): Promise<string | null> {
  const { data: world } = await supabase
    .from('world_state')
    .select('game_date')
    .eq('id', 1)
    .single()

  if (!world?.game_date) return null

  const hour = new Date().getHours()
  const timeSlot =
    hour < 6  ? 'night' :
    hour < 9  ? 'early_morning' :
    hour < 12 ? 'morning' :
    hour < 14 ? 'midday' :
    hour < 18 ? 'afternoon' :
    hour < 21 ? 'evening' : 'night'

  const { data } = await supabase.rpc('get_citizens_at_location', {
    p_location_id: null,          // unsupported — fall back to manual schedule lookup
    p_game_date: world.game_date,
    p_time_slot: timeSlot,
  }).limit(0)  // RPC doesn't support "find all locations for a citizen" — use direct query

  // Direct schedule query
  const { data: schedule } = await supabase
    .from('citizen_schedules')
    .select('location_id')
    .eq('citizen_id', citizenId)
    .or(`time_slot.eq.${timeSlot},time_slot.is.null`)
    .limit(1)

  return schedule?.[0]?.location_id ?? null
}

// ── Item transfer primitives ──────────────────────────────────────────────────

/** Move an item from its canonical location into a citizen's holdings */
async function citizenPickUp(
  supabase: SupabaseClient,
  citizenId: string,
  itemId: string,
  fromLocationId: string | null
): Promise<void> {
  await supabase.from('citizen_item_holdings').upsert({
    citizen_id: citizenId,
    item_id: itemId,
    acquired_from_type: 'location',
    acquired_from_id: fromLocationId,
    acquired_at: new Date().toISOString(),
  }, { onConflict: 'citizen_id,item_id' })
}

/** Drop a citizen's held item — records a player_item_locations row so it shows at location */
async function citizenDrop(
  supabase: SupabaseClient,
  citizenId: string,
  itemId: string,
  locationId: string
): Promise<void> {
  // Remove from citizen's holdings
  await supabase.from('citizen_item_holdings')
    .delete()
    .eq('citizen_id', citizenId)
    .eq('item_id', itemId)

  // The item's canonical location_id in `items` still points to its home.
  // We don't update that — instead, if the citizen drops it somewhere non-canonical,
  // we'd need a world-level item location override. For now, dropping returns
  // it to its canonical location (no override needed — it'll just appear there again).
  // If the citizen drops it at a NON-canonical location, log it as a world override.
  const { data: item } = await supabase.from('items').select('location_id').eq('id', itemId).single()
  if (item?.location_id !== locationId) {
    // Non-canonical drop — use a sentinel "world" key to mark it
    await supabase.from('player_item_locations').upsert({
      guest_token: `__world__${citizenId}`,
      item_id: itemId,
      location_id: locationId,
      moved_at: new Date().toISOString(),
    }, { onConflict: 'guest_token,item_id' })
  }
}

/** Transfer item from one citizen's holdings to another's */
async function citizenGiveToCitizen(
  supabase: SupabaseClient,
  fromCitizenId: string,
  toCitizenId: string,
  itemId: string,
  currentLocation: string | null
): Promise<void> {
  // Remove from giver
  await supabase.from('citizen_item_holdings')
    .delete()
    .eq('citizen_id', fromCitizenId)
    .eq('item_id', itemId)

  // Add to receiver
  await supabase.from('citizen_item_holdings').upsert({
    citizen_id: toCitizenId,
    item_id: itemId,
    acquired_from_type: 'citizen',
    acquired_from_id: fromCitizenId,
    acquired_at: new Date().toISOString(),
  }, { onConflict: 'citizen_id,item_id' })
}

/** Transfer item from citizen's holdings to the player's inventory */
async function citizenGiveToPlayer(
  supabase: SupabaseClient,
  citizenId: string,
  itemId: string,
  session: GameSession
): Promise<Item | null> {
  // Fetch the item first
  const { data: item } = await supabase.from('items').select('*').eq('id', itemId).single()
  if (!item) return null

  // Remove from citizen
  await supabase.from('citizen_item_holdings')
    .delete()
    .eq('citizen_id', citizenId)
    .eq('item_id', itemId)

  // Add to player inventory
  const newInventory = [...session.inventory, itemId]
  const table = session.playerId ? 'player_saves' : 'guest_saves'
  const key   = session.playerId ? 'player_id'   : 'session_token'
  const val   = session.playerId ?? session.guestToken
  await supabase.from(table).update({ inventory: newInventory }).eq(key, val)

  // Clear any player_item_locations override for this item (it's now in inventory)
  const pilKey = session.playerId ? 'player_id' : 'guest_token'
  const pilVal = session.playerId ?? session.guestToken
  await supabase.from('player_item_locations').delete()
    .eq(pilKey, pilVal)
    .eq('item_id', itemId)

  return item as Item
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns all items currently held by a citizen.
 */
export async function getCitizenHoldings(
  supabase: SupabaseClient,
  citizenId: string
): Promise<Item[]> {
  const { data: holdings } = await supabase
    .from('citizen_item_holdings')
    .select('item_id')
    .eq('citizen_id', citizenId)

  if (!holdings?.length) return []

  const itemIds = holdings.map((h: { item_id: string }) => h.item_id)
  const { data: items } = await supabase
    .from('items')
    .select('*')
    .in('id', itemIds)

  return (items ?? []) as Item[]
}

/**
 * Returns all items currently held by any citizen at a given location,
 * keyed by citizen_id.
 */
export async function getHoldingsAtLocation(
  supabase: SupabaseClient,
  locationId: string,
  gameDate: string,
  timeSlot: string
): Promise<Map<string, Item[]>> {
  // Get citizens at this location
  const { data: citizenRows } = await supabase.rpc('get_citizens_at_location', {
    p_location_id: locationId,
    p_game_date: gameDate,
    p_time_slot: timeSlot,
  })

  const result = new Map<string, Item[]>()
  if (!citizenRows?.length) return result

  const citizenIds = citizenRows.map((r: { citizen_id: string }) => r.citizen_id)

  const { data: holdings } = await supabase
    .from('citizen_item_holdings')
    .select('citizen_id, item_id')
    .in('citizen_id', citizenIds)

  if (!holdings?.length) return result

  const itemIds = holdings.map((h: { item_id: string }) => h.item_id)
  const { data: items } = await supabase.from('items').select('*').in('id', itemIds)
  const itemMap = new Map((items ?? []).map((i: Item) => [i.id, i]))

  for (const h of holdings as Array<{ citizen_id: string; item_id: string }>) {
    const item = itemMap.get(h.item_id)
    if (!item) continue
    const existing = result.get(h.citizen_id) ?? []
    existing.push(item)
    result.set(h.citizen_id, existing)
  }

  return result
}

/**
 * Run world-tick behaviors (called by cron). Processes 'world_tick' rules for
 * all citizens, evaluating location and condition, then executing pick_up,
 * drop, or give_to_citizen actions.
 */
export async function processWorldTickBehaviors(supabase: SupabaseClient): Promise<void> {
  const { data: behaviors } = await supabase
    .from('citizen_item_behaviors')
    .select('*')
    .eq('trigger_type', 'world_tick')
    .order('sort_order', { ascending: true })

  if (!behaviors?.length) return

  for (const behavior of behaviors as CitizenItemBehavior[]) {
    try {
      // Skip once_only behaviors that have already fired
      if (behavior.once_only && await hasAlreadyFired(supabase, behavior.id)) continue

      const citizenLoc = await getCitizenCurrentLocation(supabase, behavior.citizen_id)

      const conditionMet = await evaluateBehaviorCondition(
        supabase, behavior.trigger_condition, behavior.citizen_id, citizenLoc, null
      )
      if (!conditionMet) continue

      switch (behavior.action_type) {
        case 'pick_up':
          await citizenPickUp(supabase, behavior.citizen_id, behavior.item_id, citizenLoc)
          break
        case 'drop':
          if (citizenLoc) await citizenDrop(supabase, behavior.citizen_id, behavior.item_id, citizenLoc)
          break
        case 'give_to_citizen':
          if (behavior.target_citizen_id) {
            await citizenGiveToCitizen(
              supabase, behavior.citizen_id, behavior.target_citizen_id, behavior.item_id, citizenLoc
            )
          }
          break
        // offer_to_player and give_to_player are player-triggered; skip on tick
      }

      if (behavior.once_only) {
        await logBehaviorFired(supabase, behavior.id, { trigger: 'world_tick' })
      }
    } catch (err) {
      console.error(`[npc_items] world_tick behavior ${behavior.id} failed:`, err)
    }
  }
}

/**
 * Process on_arrival behaviors when a player enters a location.
 * Returns narrative hints for behaviors that fired (for the look description).
 */
export async function processArrivalBehaviors(
  supabase: SupabaseClient,
  session: GameSession,
  locationId: string,
  gameDate: string,
  timeSlot: string
): Promise<string[]> {
  const { data: behaviors } = await supabase
    .from('citizen_item_behaviors')
    .select('*')
    .eq('trigger_type', 'on_arrival')
    .order('sort_order', { ascending: true })

  if (!behaviors?.length) return []

  const narratives: string[] = []

  // Get citizens at this location
  const { data: citizenRows } = await supabase.rpc('get_citizens_at_location', {
    p_location_id: locationId,
    p_game_date: gameDate,
    p_time_slot: timeSlot,
  })
  const citizenIdsHere = new Set(
    (citizenRows ?? []).map((r: { citizen_id: string }) => r.citizen_id)
  )

  for (const behavior of behaviors as CitizenItemBehavior[]) {
    if (!citizenIdsHere.has(behavior.citizen_id)) continue
    if (behavior.once_only && await hasAlreadyFired(supabase, behavior.id)) continue

    const conditionMet = await evaluateBehaviorCondition(
      supabase, behavior.trigger_condition, behavior.citizen_id, locationId, session
    )
    if (!conditionMet) continue

    try {
      switch (behavior.action_type) {
        case 'pick_up':
          await citizenPickUp(supabase, behavior.citizen_id, behavior.item_id, locationId)
          break
        case 'drop':
          await citizenDrop(supabase, behavior.citizen_id, behavior.item_id, locationId)
          break
        case 'give_to_citizen':
          if (behavior.target_citizen_id) {
            await citizenGiveToCitizen(
              supabase, behavior.citizen_id, behavior.target_citizen_id, behavior.item_id, locationId
            )
            if (behavior.dialogue_hint) narratives.push(behavior.dialogue_hint)
          }
          break
        // offer/give to player require explicit interaction
      }

      if (behavior.once_only) {
        await logBehaviorFired(supabase, behavior.id, {
          trigger: 'on_arrival', location_id: locationId,
        })
      }
    } catch (err) {
      console.error(`[npc_items] on_arrival behavior ${behavior.id} failed:`, err)
    }
  }

  return narratives
}

/**
 * Process on_talk behaviors when a player initiates conversation with a citizen.
 * Returns any offers the NPC makes (offer_to_player actions).
 * give_to_player actions fire immediately and return the item + narrative.
 */
export async function processInteractionBehaviors(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string,
  citizenCurrentLocation: string | null,
  triggerType: 'on_talk' | 'on_ask',
  requestedItemId?: string   // for on_ask: the specific item the player asked for
): Promise<{
  offers: NpcItemOffer[]
  immediateGifts: NpcItemTransferResult[]
}> {
  const { data: behaviors } = await supabase
    .from('citizen_item_behaviors')
    .select('*')
    .eq('citizen_id', citizenId)
    .eq('trigger_type', triggerType)
    .order('sort_order', { ascending: true })

  const offers: NpcItemOffer[] = []
  const immediateGifts: NpcItemTransferResult[] = []

  if (!behaviors?.length) return { offers, immediateGifts }

  for (const behavior of behaviors as CitizenItemBehavior[]) {
    // For on_ask, only process the behavior matching the requested item (if specified)
    if (triggerType === 'on_ask' && requestedItemId && behavior.item_id !== requestedItemId) continue
    if (behavior.once_only && await hasAlreadyFired(supabase, behavior.id)) continue

    const conditionMet = await evaluateBehaviorCondition(
      supabase, behavior.trigger_condition, citizenId, citizenCurrentLocation, session
    )
    if (!conditionMet) continue

    try {
      if (behavior.action_type === 'offer_to_player') {
        // Look up citizen and item names for the offer
        const [{ data: citizen }, { data: item }] = await Promise.all([
          supabase.from('citizens').select('first_name, last_name').eq('id', citizenId).single(),
          supabase.from('items').select('id, name').eq('id', behavior.item_id).single(),
        ])
        if (citizen && item) {
          offers.push({
            citizenId,
            citizenName: `${citizen.first_name} ${citizen.last_name}`,
            itemId: behavior.item_id,
            itemName: item.name,
            dialogueHint: behavior.dialogue_hint ?? `${citizen.first_name} offers you ${item.name}.`,
          })
        }
        if (behavior.once_only) {
          await logBehaviorFired(supabase, behavior.id, { trigger: triggerType })
        }
      } else if (behavior.action_type === 'give_to_player') {
        const item = await citizenGiveToPlayer(supabase, citizenId, behavior.item_id, session)
        if (item) {
          immediateGifts.push({
            transferred: true,
            item,
            narrativeHint: behavior.dialogue_hint ?? undefined,
          })
          if (behavior.once_only) {
            await logBehaviorFired(supabase, behavior.id, { trigger: triggerType })
          }
        }
      }
    } catch (err) {
      console.error(`[npc_items] interaction behavior ${behavior.id} failed:`, err)
    }
  }

  return { offers, immediateGifts }
}

/**
 * Player explicitly accepts an offered item from a citizen.
 * Called when the player says "yes" / "take it" during an offer dialogue.
 */
export async function acceptNpcOffer(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string,
  itemId: string
): Promise<NpcItemTransferResult> {
  const item = await citizenGiveToPlayer(supabase, citizenId, itemId, session)
  if (!item) {
    return { transferred: false }
  }
  return { transferred: true, item }
}

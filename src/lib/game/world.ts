/**
 * World queries — fetching locations, citizens, items, and world state.
 * All functions take a Supabase client so they work in both server
 * (API routes) and client contexts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Location, Citizen, Item, ItemStateTransition, WorldState, CitizenDialogue,
  CitizenLore, MysteryClue, HelpTask, CalendarEvent, GameSession,
} from '../../types/game'

// ── World State ──────────────────────────────────────────────────────────────

export async function getWorldState(supabase: SupabaseClient): Promise<WorldState> {
  const { data, error } = await supabase
    .from('world_state')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) throw error
  return data as WorldState
}

export function getTimeSlot(date?: Date): string {
  const hour = (date ?? new Date()).getHours()
  if (hour < 6) return 'night'
  if (hour < 9) return 'early_morning'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'midday'
  if (hour < 18) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

// ── Locations ────────────────────────────────────────────────────────────────

export async function getLocation(
  supabase: SupabaseClient,
  id: string
): Promise<Location | null> {
  const { data } = await supabase
    .from('locations')
    .select('*')
    .eq('id', id)
    .single()
  return data as Location | null
}

export async function getLocationWithExits(
  supabase: SupabaseClient,
  id: string
): Promise<{ location: Location; exits: Array<{ id: string; name: string; label: string | null }> } | null> {
  const location = await getLocation(supabase, id)
  if (!location) return null

  const { data: exitRows } = await supabase
    .from('location_exits')
    .select('to_loc, label')
    .eq('from_loc', id)
    .eq('blocked', false)

  const exitIds = (exitRows ?? []).map((e: { to_loc: string }) => e.to_loc)
  let exits: Array<{ id: string; name: string; label: string | null }> = []

  if (exitIds.length > 0) {
    const { data: exitLocations } = await supabase
      .from('locations')
      .select('id, name')
      .in('id', exitIds)
      .eq('is_hidden', false)

    exits = (exitLocations ?? []).map((loc: { id: string; name: string }) => ({
      id: loc.id,
      name: loc.name,
      label: exitRows?.find((e: { to_loc: string; label: string | null }) => e.to_loc === loc.id)?.label ?? null,
    }))
  }

  return { location, exits }
}

export async function findLocationByName(
  supabase: SupabaseClient,
  query: string
): Promise<Location | null> {
  // Exact match first
  const { data: exact } = await supabase
    .from('locations')
    .select('*')
    .ilike('name', `%${query}%`)
    .eq('is_hidden', false)
    .limit(1)

  if (exact?.[0]) return exact[0] as Location

  // Try matching on id too (e.g. 'bakery' → 'copper_kettle_bakery')
  const { data: byId } = await supabase
    .from('locations')
    .select('*')
    .ilike('id', `%${query.toLowerCase().replace(/\s+/g, '_')}%`)
    .eq('is_hidden', false)
    .limit(1)

  return (byId?.[0] ?? null) as Location | null
}

export function getLocationDescription(
  location: Location,
  season: string,
  timeSlot: string
): string {
  const parts: string[] = [location.long_desc]

  // Add seasonal variation
  const seasonalKey = `seasonal_variant_${season}` as keyof Location
  const seasonal = location[seasonalKey]
  if (seasonal) parts.push(seasonal as string)

  // Add time-of-day variation
  const timeKey = `time_variant_${timeSlot.includes('morning') ? 'morning' :
    timeSlot === 'afternoon' || timeSlot === 'midday' ? 'afternoon' :
    timeSlot === 'evening' ? 'evening' : 'night'}` as keyof Location
  const timeDesc = location[timeKey]
  if (timeDesc) parts.push(timeDesc as string)

  return parts.filter(Boolean).join('\n\n')
}

// ── Citizens ─────────────────────────────────────────────────────────────────

export async function getCitizensAtLocation(
  supabase: SupabaseClient,
  locationId: string,
  gameDate: string,
  timeSlot: string
): Promise<Citizen[]> {
  // Use the DB function for accurate schedule-based lookup
  const { data } = await supabase
    .rpc('get_citizens_at_location', {
      p_location_id: locationId,
      p_game_date: gameDate,
      p_time_slot: timeSlot,
    })

  if (!data?.length) return []

  const citizenIds = data.map((row: { citizen_id: string }) => row.citizen_id)
  const { data: citizens } = await supabase
    .from('citizens')
    .select('*')
    .in('id', citizenIds)

  return (citizens ?? []) as Citizen[]
}

export async function getTownRoster(
  supabase: SupabaseClient
): Promise<Array<{ first_name: string; last_name: string; occupation: string | null; personality: string | null; household: string[] }>> {
  const { data } = await supabase
    .from('citizens')
    .select('first_name, last_name, occupation, personality, household')
    .order('last_name')
  return (data ?? []) as Array<{ first_name: string; last_name: string; occupation: string | null; personality: string | null; household: string[] }>
}

export async function getCitizen(
  supabase: SupabaseClient,
  id: string
): Promise<Citizen | null> {
  const { data } = await supabase
    .from('citizens')
    .select('*')
    .eq('id', id)
    .single()
  return (data ?? null) as Citizen | null
}

export async function findCitizenByName(
  supabase: SupabaseClient,
  query: string
): Promise<Citizen | null> {
  const q = query.trim()

  // Multi-word query: try matching first + last name separately first
  // e.g. "Eleanor Finch-Hartwell" → first_name ILIKE %Eleanor% AND last_name ILIKE %Finch-Hartwell%
  if (q.includes(' ')) {
    const parts = q.split(/\s+/)
    const firstName = parts[0]
    const lastName = parts.slice(1).join(' ')
    const { data: exact } = await supabase
      .from('citizens')
      .select('*')
      .ilike('first_name', `%${firstName}%`)
      .ilike('last_name', `%${lastName}%`)
      .limit(1)
    if (exact?.[0]) return exact[0] as Citizen
  }

  // Fall back to any-field ILIKE
  const { data } = await supabase
    .from('citizens')
    .select('*')
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,nickname.ilike.%${q}%`)
    .limit(1)

  return (data?.[0] ?? null) as Citizen | null
}

export async function getDialogueForCitizen(
  supabase: SupabaseClient,
  citizenId: string,
  trustLevel: number,
  topic: string
): Promise<CitizenDialogue | null> {
  // Try exact topic match first
  const { data } = await supabase
    .from('citizen_dialogue')
    .select('*')
    .eq('citizen_id', citizenId)
    .ilike('topic', `%${topic}%`)
    .lte('min_trust', trustLevel)
    .order('min_trust', { ascending: false })
    .limit(1)

  if (data?.[0]) return data[0] as CitizenDialogue

  // Fall back to greeting
  const { data: greeting } = await supabase
    .from('citizen_dialogue')
    .select('*')
    .eq('citizen_id', citizenId)
    .eq('topic', 'greeting')
    .lte('min_trust', trustLevel)
    .single()

  return (greeting ?? null) as CitizenDialogue | null
}

export async function getLoreForCitizen(
  supabase: SupabaseClient,
  citizenId: string,
  trustLevel: number
): Promise<CitizenLore | null> {
  const { data } = await supabase
    .from('citizen_lore')
    .select('*')
    .eq('citizen_id', citizenId)
    .lte('min_trust', trustLevel)
    .order('min_trust', { ascending: false })
    .limit(1)

  return (data?.[0] ?? null) as CitizenLore | null
}

// ── Items ────────────────────────────────────────────────────────────────────

/**
 * Returns the current effective state of an item, accounting for real-time
 * state transitions (e.g. tea cooling, flowers wilting).
 *
 * Returns { state, description, name } — use these instead of item.current_state
 * and item.description when displaying to the player.
 */
export function getItemCurrentState(item: Item): {
  state: string | null
  description: string
  name: string
} {
  if (!item.state_transitions?.length || !item.state_changed_at) {
    return { state: item.current_state, description: item.description, name: item.name }
  }

  const elapsedMs = Date.now() - new Date(item.state_changed_at).getTime()
  const elapsedMinutes = elapsedMs / (1000 * 60)

  // Find the latest transition whose time threshold has been crossed
  const transitions = [...item.state_transitions].sort(
    (a: ItemStateTransition, b: ItemStateTransition) => b.after_real_minutes - a.after_real_minutes
  )

  for (const t of transitions) {
    if (elapsedMinutes >= t.after_real_minutes) {
      return {
        state: t.new_state,
        description: t.description_override ?? item.description,
        name: t.name_override ?? item.name,
      }
    }
  }

  return { state: item.current_state, description: item.description, name: item.name }
}

/**
 * Filter items by the current game season (and weather, if supported).
 * Items with no season_availability are always visible.
 */
export function filterItemsBySeason(items: Item[], season: string): Item[] {
  return items.filter(item =>
    !item.season_availability || item.season_availability.includes(season)
  )
}

/**
 * Return items visible at a location for a given player.
 *
 * Merges two sources:
 *   1. Items whose canonical location_id = locationId, MINUS any the player
 *      has picked up (inventory) or moved elsewhere (player_item_locations).
 *   2. Items the player has explicitly dropped here (player_item_locations
 *      rows where location_id = locationId), MINUS any now back in inventory.
 *
 * When called without a session (e.g. admin / seed tooling) falls back to
 * the simple canonical-location query.
 */
export async function getItemsAtLocation(
  supabase: SupabaseClient,
  locationId: string,
  session?: GameSession
): Promise<Item[]> {
  if (!session) {
    // No session — return canonical items only (backward compat)
    const { data } = await supabase.from('items').select('*').eq('location_id', locationId)
    return (data ?? []) as Item[]
  }

  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken
  const carriedIds = session.inventory  // items the player is currently holding

  // Fetch all player-specific overrides for this player
  const { data: overrides } = await supabase
    .from('player_item_locations')
    .select('item_id, location_id')
    .eq(key, val)

  const overriddenItemIds = (overrides ?? []).map((r: { item_id: string }) => r.item_id)
  const droppedHereIds = (overrides ?? [])
    .filter((r: { location_id: string }) => r.location_id === locationId)
    .map((r: { item_id: string }) => r.item_id)
    .filter(id => !carriedIds.includes(id))

  // Build the canonical-location query
  let canonicalQuery = supabase.from('items').select('*').eq('location_id', locationId)

  // Exclude items the player is carrying
  if (carriedIds.length > 0) {
    canonicalQuery = canonicalQuery.not('id', 'in', `(${carriedIds.map(id => `"${id}"`).join(',')})`)
  }
  // Exclude items this player has moved somewhere (we'll add them back if they're here)
  if (overriddenItemIds.length > 0) {
    canonicalQuery = canonicalQuery.not('id', 'in', `(${overriddenItemIds.map(id => `"${id}"`).join(',')})`)
  }

  const { data: canonicalItems } = await canonicalQuery

  // Fetch items the player dropped here (if any)
  let droppedItems: Item[] = []
  if (droppedHereIds.length > 0) {
    const { data } = await supabase
      .from('items')
      .select('*')
      .in('id', droppedHereIds)
    droppedItems = (data ?? []) as Item[]
  }

  return [...((canonicalItems ?? []) as Item[]), ...droppedItems]
}

export async function getItem(
  supabase: SupabaseClient,
  id: string
): Promise<Item | null> {
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('id', id)
    .single()
  return (data ?? null) as Item | null
}

/**
 * Find an item by name. When a session is supplied, also considers items the
 * player has dropped at the given location (player_item_locations).
 */
export async function findItemByName(
  supabase: SupabaseClient,
  query: string,
  locationId?: string,
  session?: GameSession
): Promise<Item | null> {
  // If we have a session + locationId, build the full visible item list and search by name
  if (session && locationId) {
    const visible = await getItemsAtLocation(supabase, locationId, session)
    const lq = query.toLowerCase()
    const match = visible.find(i => i.name.toLowerCase().includes(lq))
    if (match) return match
    // If not found in visible set, fall through to broader search below
    // (handles examine/look at items not necessarily at this location)
  }

  // Broader search — useful for examine/look without location context
  let queryBuilder = supabase
    .from('items')
    .select('*')
    .ilike('name', `%${query}%`)

  if (locationId && !session) {
    queryBuilder = queryBuilder.eq('location_id', locationId)
  }

  const { data } = await queryBuilder.limit(1)
  return (data?.[0] ?? null) as Item | null
}

// ── Mysteries ────────────────────────────────────────────────────────────────

export async function getMysteryClue(
  supabase: SupabaseClient,
  clueId: string
): Promise<MysteryClue | null> {
  const { data } = await supabase
    .from('mystery_clues')
    .select('*')
    .eq('id', clueId)
    .single()
  return (data ?? null) as MysteryClue | null
}

// ── Help Tasks ───────────────────────────────────────────────────────────────

export async function getAvailableTasksAtLocation(
  supabase: SupabaseClient,
  locationId: string
): Promise<HelpTask[]> {
  const { data } = await supabase
    .from('help_tasks')
    .select('*')
    .eq('location_req', locationId)

  return (data ?? []) as HelpTask[]
}

// ── Calendar / Events ────────────────────────────────────────────────────────

export async function getActiveEvents(
  supabase: SupabaseClient,
  gameDate: string
): Promise<CalendarEvent[]> {
  const date = new Date(gameDate)
  const month = date.getMonth() + 1
  const day = date.getDate()

  // Get annual events active today
  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .or(`event_type.eq.annual,event_type.eq.weekly,event_type.eq.monthly`)

  // Filter to events that are currently active (simplified — full logic in cron)
  return (data ?? []).filter((event: CalendarEvent) => {
    if (event.event_type === 'annual' && event.month === month) {
      if (event.day && Math.abs(event.day - day) <= (event.duration_days ?? 1)) return true
    }
    return false
  }) as CalendarEvent[]
}

export async function getUpcomingEvents(
  supabase: SupabaseClient,
  gameDate: string,
  daysAhead = 14
): Promise<Array<{ event: CalendarEvent; days_away: number }>> {
  const date = new Date(gameDate)
  const { data } = await supabase
    .from('calendar_events')
    .select(`*, event_ambient_changes(*)`)

  if (!data) return []

  const upcoming: Array<{ event: CalendarEvent; days_away: number }> = []
  for (const event of data) {
    if (event.month && event.day) {
      const eventDate = new Date(date.getFullYear(), event.month - 1, event.day)
      const daysAway = Math.ceil((eventDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      if (daysAway >= 0 && daysAway <= daysAhead) {
        upcoming.push({ event, days_away: daysAway })
      }
    }
  }
  return upcoming.sort((a, b) => a.days_away - b.days_away)
}

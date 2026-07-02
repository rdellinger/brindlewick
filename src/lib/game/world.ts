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
import { getEasternTime, checkBusinessHours, getRealWorldState } from '../realtime'
import { getAllLocationsCached, getLocationCached, getTownRosterCached } from './world_cache'

// ── World State ──────────────────────────────────────────────────────────────

/**
 * Returns world state derived from the REAL US Eastern Time clock.
 * The DB world_state table is no longer the source of truth for date/season.
 */
export async function getWorldState(_supabase: SupabaseClient): Promise<WorldState> {
  return getRealWorldState() as WorldState
}

export function getTimeSlot(_date?: Date): string {
  return getEasternTime().timeSlot
}

// ── Business Hours ────────────────────────────────────────────────────────────

export interface LocationOpenStatus {
  open: boolean
  message: string | null   // null = open (no gate needed)
}

/**
 * Check whether a location with business hours is currently open.
 * Returns { open: true, message: null } if no hours defined (always open).
 */
export function checkLocationOpen(location: Location): LocationOpenStatus {
  if (!location.business_hours) return { open: true, message: null }
  const et = getEasternTime()
  const status = checkBusinessHours(location.business_hours, et)
  if (status.open) return { open: true, message: null }

  let msg = `**${location.name}** is closed right now.`
  if (status.closedToday && status.opensAt) {
    msg += ` It next opens ${status.opensAt}.`
  } else if (status.opensAt) {
    msg += ` It opens at ${status.opensAt}.`
  }
  return { open: false, message: msg }
}

// ── Locations ────────────────────────────────────────────────────────────────

export async function getLocation(
  supabase: SupabaseClient,
  id: string
): Promise<Location | null> {
  // A2: served from the in-process locations cache (DB fallback for unknown ids)
  return getLocationCached(supabase, id)
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
  // A7: fuzzy matching now runs in JS over the cached location list (69 rows)
  // instead of up to 6 sequential ILIKE queries. Match order preserved:
  // stripped/raw name match → per-word name match → ID match.
  const all = await getAllLocationsCached(supabase)
  const visible = all.filter(l => !l.is_hidden)

  // Normalise: strip leading "the " so "the diner" → "diner", "the bakery" → "bakery"
  const stripped = query.replace(/^the\s+/i, '').trim()

  // Helper: pick shortest match (closest to exact)
  const shortest = (rows: Location[]) => rows.reduce((a, b) => a.name.length <= b.name.length ? a : b)

  // 1. Try the stripped query first (catches "the diner" → "diner" in "Millpond Diner")
  for (const q of [stripped, query]) {
    const lq = q.toLowerCase()
    if (!lq) continue
    const matches = visible.filter(l => l.name.toLowerCase().includes(lq))
    if (matches.length) return shortest(matches)
  }

  // 2. Try individual significant words (≥4 chars) from the stripped query
  const words = stripped.split(/\s+/).filter(w => w.length >= 4)
  for (const word of words) {
    const lw = word.toLowerCase()
    const matches = visible.filter(l => l.name.toLowerCase().includes(lw))
    if (matches.length) return shortest(matches)
  }

  // 3. Fall back to matching on ID (e.g. 'bakery' → 'copper_kettle_bakery')
  for (const q of [stripped, query]) {
    const idq = q.toLowerCase().replace(/\s+/g, '_')
    if (!idq) continue
    const matches = visible.filter(l => l.id.includes(idq))
    if (matches.length) return matches.reduce((a, b) => a.id.length <= b.id.length ? a : b)
  }

  return null
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
  timeSlot: string,
  citizenOverrides?: Record<string, string>  // citizen_id → location_id
): Promise<Citizen[]> {
  // Use the DB function for accurate schedule-based lookup
  const { data } = await supabase
    .rpc('get_citizens_at_location', {
      p_location_id: locationId,
      p_game_date: gameDate,
      p_time_slot: timeSlot,
    })

  const citizenIds = (data ?? []).map((row: { citizen_id: string }) => row.citizen_id)
  let citizens: Citizen[] = []

  if (citizenIds.length > 0) {
    const { data: citizenRows } = await supabase
      .from('citizens')
      .select('*')
      .in('id', citizenIds)
    citizens = (citizenRows ?? []) as Citizen[]
  }

  // Add any citizens summoned to this location via player overrides
  if (citizenOverrides) {
    const summonedHere = Object.entries(citizenOverrides)
      .filter(([, loc]) => loc === locationId)
      .map(([cid]) => cid)
    if (summonedHere.length > 0) {
      const { data: summonedCitizens } = await supabase
        .from('citizens')
        .select('*')
        .in('id', summonedHere)
      const existingIds = new Set(citizens.map(c => c.id))
      for (const c of (summonedCitizens ?? []) as Citizen[]) {
        if (!existingIds.has(c.id)) citizens.push(c)
      }
    }
  }

  return citizens
}

export async function getTownRoster(
  supabase: SupabaseClient
): Promise<Array<{ id: string; first_name: string; last_name: string; occupation: string | null; personality: string | null; household: string[] }>> {
  // A2: served from the in-process roster cache (5-minute TTL)
  return getTownRosterCached(supabase)
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
    canonicalQuery = canonicalQuery.not('id', 'in', `(${carriedIds.join(',')})`)
  }
  // Exclude items this player has moved somewhere (we'll add them back if they're here)
  if (overriddenItemIds.length > 0) {
    canonicalQuery = canonicalQuery.not('id', 'in', `(${overriddenItemIds.join(',')})`)
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

/**
 * Returns the day-of-month for the Nth occurrence of a weekday in a given month.
 * dayName can be full ("saturday") or 3-char ("sat") — case-insensitive.
 */
function getNthWeekdayOfMonth(year: number, month: number, nth: number, dayName: string): number | null {
  const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const target = KEYS.indexOf(dayName.toLowerCase().slice(0, 3))
  if (target === -1) return null
  let count = 0
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month - 1, d)
    if (dt.getMonth() !== month - 1) break
    if (dt.getDay() === target) { count++; if (count === nth) return d }
  }
  return null
}

/**
 * Returns true if `month` falls within the event's seasonal_restriction.
 * null restriction = always allowed.
 * "months:6-10" = June through October.
 */
function checkSeasonalRestriction(restriction: string | null, month: number): boolean {
  if (!restriction) return true
  if (restriction.startsWith('months:')) {
    const [s, e] = restriction.slice(7).split('-').map(Number)
    return month >= s && month <= e
  }
  return true
}

/**
 * Compute the next occurrence Date for an event on or after `today`.
 * Returns null if the event has no computable schedule (triggered, missing fields).
 */
function getNextOccurrence(
  event: CalendarEvent, today: Date, year: number, month: number
): Date | null {
  if (event.event_type === 'triggered') return null

  if (event.event_type === 'annual') {
    if (!event.month) return null
    const resolveDay = (y: number): number | null => {
      if (event.day != null) return event.day
      if (event.week_of_month && event.day_of_week) {
        return getNthWeekdayOfMonth(y, event.month!, event.week_of_month, event.day_of_week)
      }
      return null
    }
    const d0 = resolveDay(year)
    if (d0 === null) return null
    const c0 = new Date(year, event.month - 1, d0)
    if (c0 >= today) return c0
    // Event already passed this year — check next year
    const d1 = resolveDay(year + 1)
    if (d1 === null) return null
    return new Date(year + 1, event.month - 1, d1)
  }

  if (event.event_type === 'weekly') {
    if (!event.day_of_week) return null
    const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const targetDow = KEYS.indexOf(event.day_of_week.toLowerCase().slice(0, 3))
    if (targetDow === -1) return null
    for (let i = 0; i <= 14; i++) {
      const candidate = new Date(today.getTime() + i * 86_400_000)
      if (candidate.getDay() === targetDow) {
        const m = candidate.getMonth() + 1
        if (checkSeasonalRestriction(event.seasonal_restriction, m)) return candidate
      }
    }
    return null
  }

  if (event.event_type === 'monthly') {
    if (!event.day_of_week || !event.week_of_month) return null
    for (let offset = 0; offset <= 2; offset++) {
      const ref = new Date(today.getFullYear(), today.getMonth() + offset, 1)
      const y = ref.getFullYear()
      const m = ref.getMonth() + 1
      const d = getNthWeekdayOfMonth(y, m, event.week_of_month, event.day_of_week)
      if (d !== null) {
        const candidate = new Date(y, m - 1, d)
        if (candidate >= today) return candidate
      }
    }
    return null
  }

  return null
}

/**
 * Returns all calendar events active right now (uses real ET clock).
 */
export async function getActiveEvents(supabase: SupabaseClient): Promise<CalendarEvent[]> {
  const et = getEasternTime()
  const { year, month, day, dowKey } = et
  const weekOfMonth = Math.ceil(day / 7)

  const { data } = await supabase.from('calendar_events').select('*')

  return (data ?? []).filter((event: CalendarEvent) => {
    if (event.event_type === 'triggered') return false

    if (event.event_type === 'annual') {
      if (event.month !== month) return false
      if (event.day != null) {
        return day >= event.day && day < event.day + (event.duration_days ?? 1)
      }
      if (event.week_of_month && event.day_of_week) {
        const startDay = getNthWeekdayOfMonth(year, month, event.week_of_month, event.day_of_week)
        if (startDay === null) return false
        return day >= startDay && day < startDay + (event.duration_days ?? 1)
      }
      return false
    }

    if (event.event_type === 'weekly') {
      if (event.day_of_week && event.day_of_week.slice(0, 3) !== dowKey) return false
      return checkSeasonalRestriction(event.seasonal_restriction, month)
    }

    if (event.event_type === 'monthly') {
      if (event.day_of_week && event.day_of_week.slice(0, 3) !== dowKey) return false
      if (event.week_of_month && weekOfMonth !== event.week_of_month) return false
      return true
    }

    return false
  }) as CalendarEvent[]
}

/**
 * Returns upcoming events within `daysAhead` days (uses real ET clock).
 * Handles all event types: annual day-based, annual week-based, weekly, monthly.
 */
export async function getUpcomingEvents(
  supabase: SupabaseClient,
  _gameDate: string,   // kept for API compat; clock is now real-time
  daysAhead = 14
): Promise<Array<{ event: CalendarEvent; days_away: number }>> {
  const et = getEasternTime()
  const today = new Date(et.year, et.month - 1, et.day)

  const { data } = await supabase.from('calendar_events').select(`*, event_ambient_changes(*)`)
  if (!data) return []

  const upcoming: Array<{ event: CalendarEvent; days_away: number }> = []

  for (const event of data as CalendarEvent[]) {
    const nextDate = getNextOccurrence(event, today, et.year, et.month)
    if (!nextDate) continue
    const daysAway = Math.round((nextDate.getTime() - today.getTime()) / 86_400_000)
    if (daysAway >= 0 && daysAway <= daysAhead) {
      upcoming.push({ event, days_away: daysAway })
    }
  }

  return upcoming.sort((a, b) => a.days_away - b.days_away)
}

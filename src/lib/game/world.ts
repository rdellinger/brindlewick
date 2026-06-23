/**
 * World queries — fetching locations, citizens, items, and world state.
 * All functions take a Supabase client so they work in both server
 * (API routes) and client contexts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Location, Citizen, Item, WorldState, CitizenDialogue,
  CitizenLore, MysteryClue, HelpTask, CalendarEvent,
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
): Promise<Array<{ first_name: string; last_name: string; occupation: string | null; personality: string | null }>> {
  const { data } = await supabase
    .from('citizens')
    .select('first_name, last_name, occupation, personality')
    .order('last_name')
  return (data ?? []) as Array<{ first_name: string; last_name: string; occupation: string | null; personality: string | null }>
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
  // Try first name match
  const { data } = await supabase
    .from('citizens')
    .select('*')
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nickname.ilike.%${query}%`)
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

export async function getItemsAtLocation(
  supabase: SupabaseClient,
  locationId: string
): Promise<Item[]> {
  const { data } = await supabase
    .from('items')
    .select('*')
    .eq('location_id', locationId)

  return (data ?? []) as Item[]
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

export async function findItemByName(
  supabase: SupabaseClient,
  query: string,
  locationId?: string
): Promise<Item | null> {
  let queryBuilder = supabase
    .from('items')
    .select('*')
    .ilike('name', `%${query}%`)

  if (locationId) {
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

/**
 * Temporal system — time travel utilities for the Chrono-Logbook mechanic.
 *
 * When a player holds the Chrono-Logbook they can travel to any date between
 * 1809-01-01 (town founding) and today.  The engine sets session.timePosition
 * to the visited date; null means the player is in the present.
 *
 * This module handles:
 *  - Mapping a date to a TimePeriod era
 *  - Fetching historical location descriptions
 *  - Fetching historical citizens at a location
 *  - Reading / writing temporal changes (past actions affecting the present)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameSession, TimePeriod, HistoricalCitizen, TemporalChange } from '../../types/game'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Earliest travelable date (town founding). */
export const TOWN_FOUNDING_DATE = '1809-01-01'

/** Year of founding — used for range checks. */
export const TOWN_FOUNDING_YEAR = 1809

// ── Era resolution ────────────────────────────────────────────────────────────

/**
 * Return the TimePeriod that contains `dateStr` (ISO date).
 * Falls back to the most recent period if nothing matches.
 */
export async function getTimePeriodForDate(
  supabase: SupabaseClient,
  dateStr: string
): Promise<TimePeriod | null> {
  const year = new Date(dateStr).getFullYear()

  const { data: periods } = await supabase
    .from('time_periods')
    .select('*')
    .order('start_year', { ascending: true })

  if (!periods?.length) return null

  // Find the period that contains this year
  for (const period of periods as TimePeriod[]) {
    const inRange = year >= period.start_year && (period.end_year === null || year <= period.end_year)
    if (inRange) return period
  }

  // Fallback: latest period
  return periods[periods.length - 1] as TimePeriod
}

// ── Historical location description ──────────────────────────────────────────

export interface HistoricalLocationData {
  description: string
  seasonal_notes: string | null
  special_note: string | null
}

export async function getHistoricalLocationDescription(
  supabase: SupabaseClient,
  locationId: string,
  timePeriodId: string
): Promise<HistoricalLocationData | null> {
  const { data } = await supabase
    .from('historical_location_descriptions')
    .select('description, seasonal_notes, special_note')
    .eq('location_id', locationId)
    .eq('time_period_id', timePeriodId)
    .single()

  return data ?? null
}

// ── Historical citizens ────────────────────────────────────────────────────────

export async function getHistoricalCitizensAt(
  supabase: SupabaseClient,
  locationId: string,
  timePeriodId: string
): Promise<HistoricalCitizen[]> {
  const { data } = await supabase
    .from('historical_citizens')
    .select('*')
    .eq('time_period_id', timePeriodId)
    .eq('home_location', locationId)

  return (data ?? []) as HistoricalCitizen[]
}

/** Find a historical citizen by name (first or last) in a given period. */
export async function findHistoricalCitizenByName(
  supabase: SupabaseClient,
  name: string,
  timePeriodId: string
): Promise<HistoricalCitizen | null> {
  const lower = name.toLowerCase()

  const { data } = await supabase
    .from('historical_citizens')
    .select('*')
    .eq('time_period_id', timePeriodId)

  if (!data?.length) return null

  return (data as HistoricalCitizen[]).find(c =>
    c.first_name.toLowerCase().includes(lower) ||
    c.last_name.toLowerCase().includes(lower) ||
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(lower)
  ) ?? null
}

// ── Historical items ──────────────────────────────────────────────────────────

export interface HistoricalItem {
  id: string
  name: string
  description: string
  location_id: string | null
  time_period_id: string
  lore_note: string | null
  mystery_tie: string | null
  reveals_clue: string | null
}

export async function getHistoricalItemsAt(
  supabase: SupabaseClient,
  locationId: string,
  timePeriodId: string
): Promise<HistoricalItem[]> {
  const { data } = await supabase
    .from('historical_items')
    .select('*')
    .eq('location_id', locationId)
    .eq('time_period_id', timePeriodId)

  return (data ?? []) as HistoricalItem[]
}

export async function findHistoricalItemByName(
  supabase: SupabaseClient,
  name: string,
  locationId: string,
  timePeriodId: string
): Promise<HistoricalItem | null> {
  const items = await getHistoricalItemsAt(supabase, locationId, timePeriodId)
  const lower = name.toLowerCase()
  return items.find(i => i.name.toLowerCase().includes(lower)) ?? null
}

// ── Temporal changes ──────────────────────────────────────────────────────────

/**
 * Load all temporal changes made by this player in the past.
 * These are checked when rendering present-day content.
 */
export async function getPlayerTemporalChanges(
  supabase: SupabaseClient,
  session: GameSession
): Promise<TemporalChange[]> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data } = await supabase
    .from('temporal_changes')
    .select('*')
    .eq(key, val)
    .eq('is_permanent', true)
    .order('created_at', { ascending: true })

  return (data ?? []) as TemporalChange[]
}

/**
 * Record a new temporal change — something the player did in the past
 * that will affect the present.
 */
export async function recordTemporalChange(
  supabase: SupabaseClient,
  session: GameSession,
  change: {
    change_type: TemporalChange['change_type']
    target_type: TemporalChange['target_type']
    target_id: string
    change_date: string
    effect_present: string
    mystery_reveal?: string | null
    clue_text?: string | null
    is_permanent?: boolean
  }
): Promise<void> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  await supabase.from('temporal_changes').insert({
    [key]: val,
    change_type: change.change_type,
    target_type: change.target_type,
    target_id: change.target_id,
    change_date: change.change_date,
    effect_present: change.effect_present,
    mystery_reveal: change.mystery_reveal ?? null,
    clue_text: change.clue_text ?? null,
    is_permanent: change.is_permanent ?? true,
  })
}

/**
 * Check whether the player already made a specific temporal change,
 * identified by (target_id, change_type).
 */
export async function hasTemporalChange(
  supabase: SupabaseClient,
  session: GameSession,
  targetId: string,
  changeType: string
): Promise<boolean> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data } = await supabase
    .from('temporal_changes')
    .select('id')
    .eq(key, val)
    .eq('target_id', targetId)
    .eq('change_type', changeType)
    .limit(1)

  return (data?.length ?? 0) > 0
}

// ── Date parsing ──────────────────────────────────────────────────────────────

/** Parse travel targets like "1866", "March 1866", "1866-03-15", "the gilded age" */
export function parseTravelTarget(input: string): { date: string; displayName: string } | null {
  if (!input) return null
  const cleaned = input.trim().toLowerCase()

  // Plain 4-digit year: "1866"
  const yearMatch = cleaned.match(/\b(1[89]\d{2}|20[012]\d)\b/)
  if (yearMatch) {
    const year = parseInt(yearMatch[1])
    const today = new Date()
    if (year < TOWN_FOUNDING_YEAR) return null
    if (year > today.getFullYear()) return null
    return {
      date: `${year}-06-15`,  // mid-year default
      displayName: String(year),
    }
  }

  // Named eras → map to representative year
  const eraMap: Record<string, { year: number; name: string }> = {
    'founding': { year: 1820, name: 'the founding years' },
    'founding year': { year: 1820, name: 'the founding years' },
    'early settlement': { year: 1848, name: 'the early settlement era' },
    'growth era': { year: 1848, name: 'the growth era' },
    'gilded age': { year: 1880, name: 'the gilded years' },
    'gilded': { year: 1880, name: 'the gilded years' },
    'victorian': { year: 1880, name: 'the gilded years' },
    'early modern': { year: 1920, name: 'the early modern era' },
    'depression': { year: 1935, name: 'the 1930s' },
    'mid century': { year: 1965, name: 'the mid-century years' },
    'mid-century': { year: 1965, name: 'the mid-century years' },
    'modern': { year: 1985, name: 'the modern era' },
  }

  for (const [key, val] of Object.entries(eraMap)) {
    if (cleaned.includes(key)) {
      return { date: `${val.year}-06-15`, displayName: val.name }
    }
  }

  return null
}

/** Format a date for display as a historical era. */
export function formatHistoricalDate(dateStr: string): string {
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = date.toLocaleDateString('en-US', { month: 'long' })
  return `${month} ${year}`
}

// ── Session helpers ───────────────────────────────────────────────────────────

/** Update the player's time_position in the DB. */
export async function setTimePosition(
  supabase: SupabaseClient,
  session: GameSession,
  date: string | null
): Promise<void> {
  const table = session.playerId ? 'player_saves' : 'guest_saves'
  const key = session.playerId ? 'player_id' : 'session_token'
  const val = session.playerId ?? session.guestToken

  await supabase
    .from(table)
    .update({ time_position: date })
    .eq(key, val)
}

/** Mark that the player has the Chrono-Logbook. */
export async function grantChronoLogbook(
  supabase: SupabaseClient,
  session: GameSession
): Promise<void> {
  const table = session.playerId ? 'player_saves' : 'guest_saves'
  const key = session.playerId ? 'player_id' : 'session_token'
  const val = session.playerId ?? session.guestToken

  await supabase
    .from(table)
    .update({ has_chrono_logbook: true })
    .eq(key, val)
}

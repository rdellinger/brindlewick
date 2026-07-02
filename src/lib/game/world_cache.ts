/**
 * In-process TTL cache for static-ish world data (Workstream A2/A7).
 *
 * Locations and the town roster change only when content is reseeded or an
 * admin edits them, yet they were being fetched from Supabase on every
 * command (and on every conversation message). Caching them in module scope
 * with a short TTL removes those round-trips.
 *
 * IMPORTANT (Phase 4 forward-compat): when the dynamic-entity system starts
 * inserting citizens/locations/items at runtime, it MUST call
 * `invalidateWorldCache()` after every insert so new entities appear in
 * rosters and directories on the next turn. Admin write routes should do the
 * same. Until then, the TTL bounds staleness to 5 minutes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Location } from '../../types/game'

const TTL_MS = 5 * 60 * 1000  // 5 minutes

export interface RosterEntry {
  id: string
  first_name: string
  last_name: string
  occupation: string | null
  personality: string | null
  household: string[]
}

interface CacheEntry<T> {
  value: T
  fetchedAt: number
}

let locationsCache: CacheEntry<Location[]> | null = null
let rosterCache: CacheEntry<RosterEntry[]> | null = null

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.fetchedAt < TTL_MS
}

/**
 * All locations (including hidden ones — callers filter `is_hidden` as needed).
 * One full-table fetch per instance per TTL window instead of per command.
 */
export async function getAllLocationsCached(supabase: SupabaseClient): Promise<Location[]> {
  if (isFresh(locationsCache)) return locationsCache.value
  const { data } = await supabase.from('locations').select('*')
  const rows = (data ?? []) as Location[]
  if (rows.length > 0) {
    locationsCache = { value: rows, fetchedAt: Date.now() }
  }
  return rows
}

/** Cached single-location lookup with DB fallback for ids not in the cache. */
export async function getLocationCached(
  supabase: SupabaseClient,
  id: string
): Promise<Location | null> {
  const all = await getAllLocationsCached(supabase)
  const hit = all.find(l => l.id === id)
  if (hit) return hit
  // Fallback: a row created after the cache was filled (e.g. future dynamic entities)
  const { data } = await supabase.from('locations').select('*').eq('id', id).single()
  return (data ?? null) as Location | null
}

/**
 * Town roster projection used for dialogue prompts and name matching.
 * NOTE: intentionally NOT filtered by tier in Phase 2 — prompt-content changes
 * (roster slimming, B1/B2) are deferred to Phase 5 per the master plan.
 */
export async function getTownRosterCached(supabase: SupabaseClient): Promise<RosterEntry[]> {
  if (isFresh(rosterCache)) return rosterCache.value
  const { data } = await supabase
    .from('citizens')
    .select('id, first_name, last_name, occupation, personality, household')
    .order('last_name')
  const rows = (data ?? []) as RosterEntry[]
  if (rows.length > 0) {
    rosterCache = { value: rows, fetchedAt: Date.now() }
  }
  return rows
}

/** Drop all cached world data. Call after any write to locations/citizens. */
export function invalidateWorldCache(): void {
  locationsCache = null
  rosterCache = null
}

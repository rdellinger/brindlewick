/**
 * Sidebar state builder (Workstream A3/A4).
 *
 * Extracted from GET /api/game/state so the same payload can be attached to
 * POST /api/game/command responses — removing the client's second round-trip
 * after every command.
 *
 * A4 fixes applied during extraction:
 *  - trust levels for citizens present: one `.in()` query (was one query per citizen)
 *  - help-task giver names: one `.in()` query (was one query per task)
 *  - all independent top-level reads run in a single Promise.all batch
 *  - the citizen_overrides read for guests now uses `session_token` (the
 *    guest_saves key column) — it previously queried a nonexistent
 *    `guest_token` column, so summoned citizens never appeared in guest sidebars
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameSession } from '../../types/game'
import {
  getLocationWithExits, getLocationDescription, getCitizensAtLocation,
  getItemsAtLocation, getWorldState, getTimeSlot, getUpcomingEvents,
  getActiveEvents,
} from './world'
import { getSeenItemIds } from './player'

export interface SidebarStatePayload {
  session: {
    playerId: string | null
    guestToken: string | null
    inventory: string[]
    currentLocation: string
    timePosition: string | null
    hasChronoLogbook: boolean
  }
  world: {
    date: string
    season: string
    dayOfWeek: string
    timeSlot: string
    time: string | null
    displayDate: string | null
  }
  location: Record<string, unknown> | null
  stats: {
    journalEntries: number
    mysteriesStarted: number
    mysteriesResolved: number
  }
  upcomingEvents: Array<{ name: string; daysAway: number }>
  activeEvents: Array<{ name: string }>
  journalEntries: Array<Record<string, unknown>>
  inventoryItems: Array<{ id: string; name: string }>
  seenItemIds: string[]
  worldEvents: Array<Record<string, unknown>>
  tasks: Array<Record<string, unknown>>
}

export async function buildSidebarState(
  supabase: SupabaseClient,
  session: GameSession,
  playerId: string | null,
  guestToken: string | null
): Promise<SidebarStatePayload> {
  const world = await getWorldState(supabase)
  const timeSlot = getTimeSlot()

  const key = playerId ? 'player_id' : 'guest_token'
  const val = playerId ?? guestToken

  // guest_saves is keyed by session_token (NOT guest_token — see header note)
  const saveTable = playerId ? 'player_saves' : 'guest_saves'
  const saveKey = playerId ? 'player_id' : 'session_token'
  const saveVal = playerId ?? guestToken

  // ── Batch 1: everything independent of one another ─────────────────────────
  const [
    locationData,
    saveRowRes,
    journalCountRes,
    journalRowsRes,
    inventoryRowsRes,
    worldEventsRes,
    upcomingEvents,
    activeEvents,
    mysteryProgressRes,
    playerTasksRes,
    seenItemIds,
    items,
  ] = await Promise.all([
    getLocationWithExits(supabase, session.currentLocation),
    supabase.from(saveTable).select('citizen_overrides').eq(saveKey, saveVal).single(),
    supabase.from('player_journal').select('*', { count: 'exact', head: true }).eq(key, val),
    supabase
      .from('player_journal')
      .select('id, entry_type, title, content, related_id, game_date, created_at')
      .eq(key, val)
      .order('created_at', { ascending: false })
      .limit(30),
    session.inventory.length
      ? supabase.from('items').select('id, name').in('id', session.inventory)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    supabase
      .from('world_events')
      .select('id, game_date, event_type, headline, detail, is_major')
      .order('game_date', { ascending: false })
      .limit(14),
    getUpcomingEvents(supabase, world.game_date, 7),
    getActiveEvents(supabase),
    supabase
      .from('player_mystery_progress')
      .select('mystery_id, clues_found, is_resolved')
      .eq(key, val),
    supabase
      .from('player_task_progress')
      .select('task_id, status')
      .eq(key, val)
      .eq('status', 'in_progress'),
    getSeenItemIds(supabase, session),
    getItemsAtLocation(supabase, session.currentLocation, session),
  ])

  const citizenOverrides: Record<string, string> =
    (saveRowRes.data?.citizen_overrides as Record<string, string>) ?? {}

  // ── Batch 2: reads that depend on batch 1 ───────────────────────────────────
  const citizens = await getCitizensAtLocation(
    supabase, session.currentLocation, world.game_date, timeSlot, citizenOverrides
  )

  const playerTaskRows = (playerTasksRes.data ?? []) as Array<{ task_id: string; status: string }>
  const taskIds = playerTaskRows.map(r => r.task_id)

  const [trustRes, helpTasksRes] = await Promise.all([
    citizens.length
      ? supabase
          .from('player_citizen_trust')
          .select('citizen_id, trust_level')
          .eq(key, val)
          .in('citizen_id', citizens.map(c => c.id))
      : Promise.resolve({ data: [] as Array<{ citizen_id: string; trust_level: number }> }),
    taskIds.length
      ? supabase
          .from('help_tasks')
          .select('id, title, description, giver_citizen')
          .in('id', taskIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string; description: string; giver_citizen: string | null }> }),
  ])

  const trustData: Record<string, number> = {}
  for (const row of (trustRes.data ?? []) as Array<{ citizen_id: string; trust_level: number }>) {
    trustData[row.citizen_id] = row.trust_level
  }

  const helpTaskRows = (helpTasksRes.data ?? []) as Array<{
    id: string; title: string; description: string; giver_citizen: string | null
  }>
  const taskDetails: Record<string, { title: string; description: string; giver_citizen: string | null }> = {}
  for (const t of helpTaskRows) taskDetails[t.id] = t

  // Giver names: one batched query (was one per task)
  const giverIds = [...new Set(helpTaskRows.map(t => t.giver_citizen).filter((g): g is string => !!g))]
  const citizenNames: Record<string, string> = {}
  if (giverIds.length > 0) {
    const { data: giverRows } = await supabase
      .from('citizens')
      .select('id, first_name, last_name')
      .in('id', giverIds)
    for (const c of (giverRows ?? []) as Array<{ id: string; first_name: string; last_name: string }>) {
      citizenNames[c.id] = `${c.first_name} ${c.last_name}`
    }
  }

  // ── Assembly (unchanged output shape) ───────────────────────────────────────
  const journalRowsRaw = (journalRowsRes.data ?? []) as Array<{
    id: string; entry_type: string; title: string; content: string;
    related_id: string | null; game_date: string | null; created_at: string
  }>

  // Deduplicate: only show the first citizen_met per citizen (related_id), keep all others
  const seenCitizens = new Set<string>()
  const journalRows = journalRowsRaw.filter(e => {
    if (e.entry_type === 'citizen_met') {
      const rid = e.related_id ?? e.title
      if (seenCitizens.has(rid)) return false
      seenCitizens.add(rid)
    }
    return true
  }).slice(0, 15)

  // Inventory item details (preserve order)
  const inventoryItems: Array<{ id: string; name: string }> = []
  if (session.inventory.length) {
    const itemRows = (inventoryRowsRes.data ?? []) as Array<{ id: string; name: string }>
    for (const id of session.inventory) {
      const row = itemRows.find(r => r.id === id)
      if (row) inventoryItems.push({ id: row.id, name: row.name })
      else inventoryItems.push({ id, name: id.replace(/_/g, ' ') })
    }
  }

  const mysteryProgress = (mysteryProgressRes.data ?? []) as Array<{
    mystery_id: string; clues_found: unknown; is_resolved: boolean
  }>

  const locationDesc = locationData
    ? getLocationDescription(locationData.location, world.game_season, timeSlot)
    : ''

  return {
    session: {
      playerId: playerId ?? null,
      guestToken: guestToken ?? null,
      inventory: session.inventory,
      currentLocation: session.currentLocation,
      timePosition: session.timePosition ?? null,
      hasChronoLogbook: session.hasChronoLogbook ?? false,
    },
    world: {
      date: world.game_date,
      season: world.game_season,
      dayOfWeek: world.day_of_week,
      timeSlot,
      time: world.game_time ?? null,
      displayDate: world.display_date ?? null,
    },
    location: locationData ? {
      ...locationData.location,
      description: locationDesc,
      exits: locationData.exits,
      citizens: citizens.map(c => ({
        id: c.id,
        name: `${c.first_name}${c.nickname ? ` "${c.nickname}"` : ''} ${c.last_name}`,
        occupation: c.occupation,
        trustLevel: trustData[c.id] ?? 0,
      })),
      items: items.filter(i => !i.requires_condition).map(i => ({
        id: i.id,
        name: i.name,
        canTake: i.can_take,
      })),
    } : null,
    stats: {
      journalEntries: journalCountRes.count ?? 0,
      mysteriesStarted: mysteryProgress.filter(m => Array.isArray(m.clues_found) ? m.clues_found.length > 0 : (m.clues_found != null)).length,
      mysteriesResolved: mysteryProgress.filter(m => m.is_resolved).length,
    },
    upcomingEvents: upcomingEvents.slice(0, 3).map(e => ({
      name: e.event.name,
      daysAway: e.days_away,
    })),
    activeEvents: activeEvents.map(e => ({ name: e.name })),
    journalEntries: journalRows.map(e => ({
      id: e.id,
      entry_type: e.entry_type,
      title: e.title,
      content: e.content,
      related_id: e.related_id,
      game_date: e.game_date,
      created_at: e.created_at,
    })),
    inventoryItems,
    seenItemIds,
    worldEvents: ((worldEventsRes.data ?? []) as Array<Record<string, unknown>>).map(e => ({
      id: e.id as string,
      game_date: e.game_date as string,
      event_type: e.event_type as string,
      headline: e.headline as string,
      detail: e.detail as string | null,
      is_major: e.is_major as boolean,
    })),
    tasks: playerTaskRows.map(row => {
      const detail = taskDetails[row.task_id]
      return {
        task_id: row.task_id,
        title: detail?.title ?? row.task_id.replace(/_/g, ' '),
        description: detail?.description ?? '',
        status: row.status,
        giverName: detail?.giver_citizen ? (citizenNames[detail.giver_citizen] ?? null) : null,
        giverCitizenId: detail?.giver_citizen ?? null,
      }
    }),
  }
}

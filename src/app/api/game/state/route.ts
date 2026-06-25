import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { buildGameSession, generateGuestToken, getSeenItemIds } from '../../../../lib/game/player'
import { getLocationWithExits, getLocationDescription, getCitizensAtLocation,
         getItemsAtLocation, getWorldState, getTimeSlot, getUpcomingEvents,
         getActiveEvents } from '../../../../lib/game/world'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    let guestToken = searchParams.get('guestToken')

    const supabase = await createClient()

    let playerId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    if (user) playerId = user.id
    else if (!guestToken) guestToken = generateGuestToken()

    const session = await buildGameSession(supabase, playerId, guestToken ?? undefined)
    const world = await getWorldState(supabase)
    const timeSlot = getTimeSlot()

    // Get current location details
    const locationData = await getLocationWithExits(supabase, session.currentLocation)
    const citizens = await getCitizensAtLocation(
      supabase, session.currentLocation, world.game_date, timeSlot
    )
    const items = await getItemsAtLocation(supabase, session.currentLocation, session)

    const key = playerId ? 'player_id' : 'guest_token'
    const val = playerId ?? guestToken

    // Get journal entry count
    const { count: journalCount } = await supabase
      .from('player_journal')
      .select('*', { count: 'exact', head: true })
      .eq(key, val)

    // Recent journal entries for sidebar (last 30, then deduplicate citizen_met)
    const { data: journalRowsRaw } = await supabase
      .from('player_journal')
      .select('id, entry_type, title, content, related_id, game_date, created_at')
      .eq(key, val)
      .order('created_at', { ascending: false })
      .limit(30)

    // Deduplicate: only show the first citizen_met per citizen (related_id), keep all others
    const seenCitizens = new Set<string>()
    const journalRows = (journalRowsRaw ?? []).filter(e => {
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
      const { data: itemRows } = await supabase
        .from('items')
        .select('id, name')
        .in('id', session.inventory)
      if (itemRows) {
        for (const id of session.inventory) {
          const row = (itemRows as Array<{ id: string; name: string }>).find(r => r.id === id)
          if (row) inventoryItems.push({ id: row.id, name: row.name })
          else inventoryItems.push({ id, name: id.replace(/_/g, ' ') })
        }
      }
    }

    // Recent world events for Chronicle tab (last 14)
    const { data: worldEventRows } = await supabase
      .from('world_events')
      .select('id, game_date, event_type, headline, detail, is_major')
      .order('game_date', { ascending: false })
      .limit(14)

    // Upcoming events for ambient dialogue
    const upcomingEvents = await getUpcomingEvents(supabase, world.game_date, 7)
    const activeEvents = await getActiveEvents(supabase)

    // Mystery progress summary — direct query, no join needed for counts
    const { data: mysteryProgress } = await supabase
      .from('player_mystery_progress')
      .select('mystery_id, clues_found, is_resolved')
      .eq(key, val)

    // Player tasks (in_progress only — 'offered' tasks are not shown in the tab)
    const { data: playerTaskRows } = await supabase
      .from('player_task_progress')
      .select('task_id, status')
      .eq(key, val)
      .eq('status', 'in_progress')

    const taskIds = (playerTaskRows ?? []).map((r: { task_id: string }) => r.task_id)
    const taskDetails: Record<string, { title: string; description: string; giver_citizen: string | null }> = {}
    const citizenNames: Record<string, string> = {}

    if (taskIds.length > 0) {
      const { data: helpTaskRows } = await supabase
        .from('help_tasks')
        .select('id, title, description, giver_citizen')
        .in('id', taskIds)

      for (const t of (helpTaskRows ?? []) as Array<{ id: string; title: string; description: string; giver_citizen: string | null }>) {
        taskDetails[t.id] = t
        if (t.giver_citizen) {
          const { data: cit } = await supabase
            .from('citizens')
            .select('first_name, last_name')
            .eq('id', t.giver_citizen)
            .single()
          if (cit) citizenNames[t.giver_citizen] = `${cit.first_name} ${cit.last_name}`
        }
      }
    }

    // Items the player has examined (persisted seen state)
    const seenItemIds = await getSeenItemIds(supabase, session)

    // Citizen trust levels for current location
    const trustData: Record<string, number> = {}
    for (const c of citizens) {
      const { data } = await supabase
        .from('player_citizen_trust')
        .select('trust_level')
        .eq(key, val)
        .eq('citizen_id', c.id)
        .single()
      trustData[c.id] = data?.trust_level ?? 0
    }

    const locationDesc = locationData
      ? getLocationDescription(locationData.location, world.game_season, timeSlot)
      : ''

    return NextResponse.json({
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
        journalEntries: journalCount ?? 0,
        mysteriesStarted: (mysteryProgress ?? []).filter(m => Array.isArray(m.clues_found) ? m.clues_found.length > 0 : (m.clues_found != null)).length,
        mysteriesResolved: (mysteryProgress ?? []).filter(m => m.is_resolved).length,
      },
      upcomingEvents: upcomingEvents.slice(0, 3).map(e => ({
        name: e.event.name,
        daysAway: e.days_away,
      })),
      activeEvents: activeEvents.map(e => ({ name: e.name })),
      journalEntries: (journalRows ?? []).map((e: Record<string, unknown>) => ({
        id: e.id as string,
        entry_type: e.entry_type as string,
        title: e.title as string,
        content: e.content as string,
        related_id: e.related_id as string | null,
        game_date: e.game_date as string | null,
        created_at: e.created_at as string,
      })),
      inventoryItems,
      seenItemIds,
      worldEvents: (worldEventRows ?? []).map((e: Record<string, unknown>) => ({
        id: e.id as string,
        game_date: e.game_date as string,
        event_type: e.event_type as string,
        headline: e.headline as string,
        detail: e.detail as string | null,
        is_major: e.is_major as boolean,
      })),
      tasks: (playerTaskRows ?? []).map((row: { task_id: string; status: string }) => {
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
    })
  } catch (err) {
    console.error('[game/state] Error:', err)
    return NextResponse.json({ error: 'Could not load game state' }, { status: 500 })
  }
}

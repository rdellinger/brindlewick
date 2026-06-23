import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { buildGameSession, generateGuestToken } from '../../../../lib/game/player'
import { getLocationWithExits, getLocationDescription, getCitizensAtLocation,
         getItemsAtLocation, getWorldState, getTimeSlot, getUpcomingEvents } from '../../../../lib/game/world'
import { getPlayerMysteryProgress } from '../../../../lib/game/mysteries'

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
    const items = await getItemsAtLocation(supabase, session.currentLocation)

    const key = playerId ? 'player_id' : 'guest_token'
    const val = playerId ?? guestToken

    // Get journal entry count
    const { count: journalCount } = await supabase
      .from('player_journal')
      .select('*', { count: 'exact', head: true })
      .eq(key, val)

    // Recent journal entries for sidebar (last 15)
    const { data: journalRows } = await supabase
      .from('player_journal')
      .select('id, entry_type, title, content, related_id, game_date, created_at')
      .eq(key, val)
      .order('created_at', { ascending: false })
      .limit(15)

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

    // Mystery progress summary
    const mysteries = await getPlayerMysteryProgress(supabase, session)

    // Player tasks (available + in_progress)
    const { data: playerTaskRows } = await supabase
      .from('player_task_progress')
      .select('task_id, status, help_tasks(title, description, giver_citizen, citizens!help_tasks_giver_citizen_fkey(first_name, last_name))')
      .eq(key, val)
      .in('status', ['available', 'in_progress'])

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
        mysteriesStarted: mysteries.filter(m => m.clues_found?.length > 0).length,
        mysteriesResolved: mysteries.filter(m => m.is_resolved).length,
      },
      upcomingEvents: upcomingEvents.slice(0, 3).map(e => ({
        name: e.event.name,
        daysAway: e.days_away,
      })),
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
      worldEvents: (worldEventRows ?? []).map((e: Record<string, unknown>) => ({
        id: e.id as string,
        game_date: e.game_date as string,
        event_type: e.event_type as string,
        headline: e.headline as string,
        detail: e.detail as string | null,
        is_major: e.is_major as boolean,
      })),
      tasks: (playerTaskRows ?? []).map((row: Record<string, unknown>) => {
        // Supabase returns FK relations as arrays when using select with nested resources
        const task = Array.isArray(row.help_tasks) ? row.help_tasks[0] : row.help_tasks
        const citizen = task && Array.isArray(task.citizens) ? task.citizens[0] : task?.citizens
        return {
          task_id: row.task_id as string,
          title: (task?.title as string) ?? row.task_id as string,
          description: (task?.description as string) ?? '',
          status: row.status as string,
          giverName: citizen ? `${citizen.first_name} ${citizen.last_name}` : null,
        }
      }),
    })
  } catch (err) {
    console.error('[game/state] Error:', err)
    return NextResponse.json({ error: 'Could not load game state' }, { status: 500 })
  }
}

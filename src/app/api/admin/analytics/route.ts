import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createAdminSupabaseClient()

  const [
    { data: topLocations },
    { data: leastDiscovered },
  ] = await Promise.all([
    // Most visited locations from analytics aggregate
    supabase
      .from('analytics_location_popularity')
      .select('location_id, total_visits, unique_visitors')
      .order('total_visits', { ascending: false })
      .limit(10),

    // Mysteries with fewest players — these are under-discovered, worth promoting
    supabase
      .from('player_mystery_progress')
      .select('mystery_id, is_resolved, mysteries(title)')
      .order('mystery_id')
      .limit(100),
  ])

  // Aggregate mystery stats
  const mysteryMap: Record<string, {
    mystery_id: string
    players_started: number
    players_resolved: number
    mysteries: { title: string }
  }> = {}

  for (const row of leastDiscovered ?? []) {
    if (!mysteryMap[row.mystery_id]) {
      mysteryMap[row.mystery_id] = {
        mystery_id: row.mystery_id,
        players_started: 0,
        players_resolved: 0,
        mysteries: (row as unknown as { mysteries: { title: string } }).mysteries,
      }
    }
    mysteryMap[row.mystery_id].players_started++
    if (row.is_resolved) mysteryMap[row.mystery_id].players_resolved++
  }

  const leastDiscoveredMysteries = Object.values(mysteryMap)
    .sort((a, b) => a.players_started - b.players_started)
    .slice(0, 5)

  return NextResponse.json({
    topLocations: topLocations ?? [],
    leastDiscoveredMysteries,
  })
}

import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createAdminSupabaseClient()

  // Mysteries with player engagement counts
  const { data: mysteries, error } = await supabase
    .from('mysteries')
    .select('id, title, depth')
    .order('title')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate player stats per mystery
  const { data: progress } = await supabase
    .from('player_mystery_progress')
    .select('mystery_id, is_resolved')

  const statsMap: Record<string, { players_started: number; players_resolved: number }> = {}
  for (const row of progress ?? []) {
    if (!statsMap[row.mystery_id]) statsMap[row.mystery_id] = { players_started: 0, players_resolved: 0 }
    statsMap[row.mystery_id].players_started++
    if (row.is_resolved) statsMap[row.mystery_id].players_resolved++
  }

  const enriched = (mysteries ?? []).map(m => ({
    ...m,
    ...(statsMap[m.id] ?? { players_started: 0, players_resolved: 0 }),
  }))

  return NextResponse.json({ mysteries: enriched })
}

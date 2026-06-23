import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createAdminSupabaseClient()

  const [
    { count: citizenCount },
    { count: locationCount },
    { count: mysteryCount },
    { count: activePlayerCount },
    { count: totalCommands },
  ] = await Promise.all([
    supabase.from('citizens').select('*', { count: 'exact', head: true }),
    supabase.from('locations').select('*', { count: 'exact', head: true }),
    supabase.from('mysteries').select('*', { count: 'exact', head: true }),
    supabase.from('player_saves')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('command_log').select('*', { count: 'exact', head: true }),
  ])

  return NextResponse.json({
    citizenCount: citizenCount ?? 0,
    locationCount: locationCount ?? 0,
    mysteryCount: mysteryCount ?? 0,
    activePlayerCount: activePlayerCount ?? 0,
    totalCommands: totalCommands ?? 0,
  })
}

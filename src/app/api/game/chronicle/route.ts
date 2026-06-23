import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'

/**
 * GET /api/game/chronicle
 * Returns world events, optionally filtered by date.
 *
 * Query params:
 *   since=YYYY-MM-DD  — only events on or after this game date
 *   limit=N           — max events (default 20, max 50)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const since = searchParams.get('since')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50)

    const supabase = await createClient()

    let query = supabase
      .from('world_events')
      .select('id, game_date, event_type, headline, detail, location_id, citizen_id, is_major, created_at')
      .order('game_date', { ascending: false })
      .limit(limit)

    if (since) query = query.gte('game_date', since)

    const { data, error } = await query

    if (error) {
      console.error('[chronicle] Supabase error:', error.message)
      return NextResponse.json({ error: 'Could not load chronicle' }, { status: 500 })
    }

    return NextResponse.json({ events: data ?? [] })
  } catch (err) {
    console.error('[chronicle] Error:', err)
    return NextResponse.json({ error: 'Could not load chronicle' }, { status: 500 })
  }
}

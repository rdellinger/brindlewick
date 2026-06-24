import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient } from '../../../../lib/supabase/server'

// All tables that hold per-player progress, keyed by guest vs logged-in
const PLAYER_TABLES = [
  'player_task_progress',
  'player_given_items',
  'player_item_locations',
  'player_citizen_trust',
  'player_mystery_progress',
  'player_mystery_clues',
  'player_citizen_conversations',
  'player_consumed_items',
  'player_seen_items',
  'player_journal',
  'player_location_visits',
  'temporal_changes',
] as const

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { guestToken } = body

    const supabase = await createClient()
    const admin = createAdminSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      // Logged-in: delete all player_id rows, then the save row
      for (const table of PLAYER_TABLES) {
        await admin.from(table).delete().eq('player_id', user.id)
      }
      await admin.from('player_saves').delete().eq('player_id', user.id)
    } else if (guestToken) {
      // Guest: delete guest_token rows across all tables
      for (const table of PLAYER_TABLES) {
        await admin.from(table).delete().eq('guest_token', guestToken)
      }
      // guest_saves uses session_token, not guest_token
      await admin.from('guest_saves').delete().eq('session_token', guestToken)
    } else {
      return NextResponse.json({ error: 'No player identity' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[game/reset] Error:', err)
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }
}

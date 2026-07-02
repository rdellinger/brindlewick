import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { buildGameSession, generateGuestToken } from '../../../../lib/game/player'
import { buildSidebarState } from '../../../../lib/game/sidebar_state'

/**
 * Full sidebar state. Used for the initial page load; after commands, the
 * same payload is attached to the POST /api/game/command response (A3), so
 * the client no longer calls this endpoint on every command.
 *
 * The payload assembly lives in lib/game/sidebar_state.ts (shared with the
 * command route), including the A4 batching fixes.
 */
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
    const state = await buildSidebarState(supabase, session, playerId ?? null, guestToken ?? null)

    return NextResponse.json(state)
  } catch (err) {
    console.error('[game/state] Error:', err)
    return NextResponse.json({ error: 'Could not load game state' }, { status: 500 })
  }
}

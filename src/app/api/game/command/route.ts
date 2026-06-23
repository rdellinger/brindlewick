import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { parseCommand } from '../../../../lib/game/parser'
import { executeCommand } from '../../../../lib/game/engine'
import { buildGameSession, generateGuestToken } from '../../../../lib/game/player'
import { addJournalEntry } from '../../../../lib/game/player'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { input, guestToken } = body

    if (!input?.trim()) {
      return NextResponse.json({ error: 'No input provided' }, { status: 400 })
    }

    const supabase = await createClient()

    // Determine player identity
    let playerId: string | undefined
    let effectiveGuestToken = guestToken

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      playerId = user.id
    } else if (!effectiveGuestToken) {
      effectiveGuestToken = generateGuestToken()
    }

    // Build session
    const session = await buildGameSession(
      supabase,
      playerId,
      effectiveGuestToken
    )

    // Parse the command
    const command = await parseCommand(input)

    // Execute against the game world
    const response = await executeCommand(supabase, command, session)

    // Persist journal entry if one was generated
    if (response.journal_entry && response.journal_entry.entry_type) {
      await addJournalEntry(
        supabase,
        session,
        response.journal_entry.entry_type,
        response.journal_entry.title,
        response.journal_entry.content,
        response.journal_entry.related_id ?? undefined
      )
    }

    // Log the command
    await supabase.from('command_log').insert({
      player_id: playerId ?? null,
      guest_token: effectiveGuestToken ?? null,
      raw_input: input,
      parsed_intent: command.intent,
      parsed_args: { target: command.target, qualifier: command.qualifier },
      location_at: session.currentLocation,
      success: !response.error,
      response_text: response.text.slice(0, 500),
    })

    return NextResponse.json({
      ...response,
      guestToken: effectiveGuestToken,  // Return for client to persist
      currentLocation: response.location?.id ?? session.currentLocation,
    })
  } catch (err) {
    console.error('[game/command] Error:', err)
    return NextResponse.json(
      { error: 'Something went gently wrong. Try again?', text: 'A moment of static. Try again.' },
      { status: 500 }
    )
  }
}

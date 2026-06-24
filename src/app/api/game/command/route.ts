import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { parseCommand } from '../../../../lib/game/parser'
import { executeCommand, handleConversationMessage } from '../../../../lib/game/engine'
import { buildGameSession, generateGuestToken } from '../../../../lib/game/player'
import { addJournalEntry } from '../../../../lib/game/player'
import type { ConversationMessage } from '../../../../types/game'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { input, guestToken, conversationHistory, activeCitizenId } = body

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

    // If we're in an active conversation, route directly to the conversation handler.
    // Navigation commands (go, look) and explicit new-talk commands bypass this so
    // players can still move or switch conversations mid-chat.
    let response
    if (activeCitizenId && conversationHistory) {
      // Quick check: if the player is trying to navigate or leave, fall through to normal parsing
      const looksLikeNavigation = /^(go|walk|move|head|travel|look|examine|bye|goodbye|farewell|see you|leave|solve|deduce|figure out|i think i|i've figured|i've solved)\b/i.test(input.trim())
      if (!looksLikeNavigation) {
        response = await handleConversationMessage(
          supabase,
          activeCitizenId,
          conversationHistory as ConversationMessage[],
          input,
          session
        )
      }
    }

    if (!response) {
      // Parse the command normally
      const command = await parseCommand(input)
      response = await executeCommand(supabase, command, session)
      // If the player navigated away or started talking to someone else, end conversation
      if (activeCitizenId && (response.location || response.conversation_start)) {
        response = { ...response, conversation_end: true }
      }
    }

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
      parsed_intent: activeCitizenId ? 'chat' : 'unknown',
      parsed_args: {},
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

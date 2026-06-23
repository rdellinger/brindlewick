import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameSession, GameResponse } from '../../types/game'

/**
 * Check if discovering something (item, location, citizen topic) reveals a
 * mystery clue. Records the clue in the player's progress and returns the
 * update object for the GameResponse.
 */
export async function checkMysteryClue(
  supabase: SupabaseClient,
  session: GameSession,
  sourceId: string,  // what triggered the check (item id, location id, etc.)
  mysteryId: string
): Promise<GameResponse['mystery_update']> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Get or create mystery progress
  const { data: existing } = await supabase
    .from('player_mystery_progress')
    .select('*')
    .eq(key, val)
    .eq('mystery_id', mysteryId)
    .single()

  const cluesFound: string[] = existing?.clues_found ?? []

  if (cluesFound.includes(sourceId)) {
    return undefined // Already found this clue
  }

  const newClues = [...cluesFound, sourceId]

  await supabase
    .from('player_mystery_progress')
    .upsert({
      [key]: val,
      mystery_id: mysteryId,
      clues_found: newClues,
      is_resolved: existing?.is_resolved ?? false,
    }, {
      onConflict: key === 'player_id'
        ? 'player_id,mystery_id'
        : 'guest_token,mystery_id',
    })

  return { mystery_id: mysteryId, clue_found: sourceId }
}

/**
 * Get all mystery progress for the current player.
 */
export async function getPlayerMysteryProgress(
  supabase: SupabaseClient,
  session: GameSession
) {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data } = await supabase
    .from('player_mystery_progress')
    .select(`*, mysteries(title, depth)`)
    .eq(key, val)

  return data ?? []
}

/**
 * Mark a mystery as fully resolved.
 */
export async function resolveMystery(
  supabase: SupabaseClient,
  session: GameSession,
  mysteryId: string
): Promise<void> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  await supabase
    .from('player_mystery_progress')
    .upsert({
      [key]: val,
      mystery_id: mysteryId,
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    }, {
      onConflict: key === 'player_id'
        ? 'player_id,mystery_id'
        : 'guest_token,mystery_id',
    })
}

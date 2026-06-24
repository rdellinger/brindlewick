import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameSession, GameResponse } from '../../types/game'
import { getTrustLevel } from './player'

// ── Citizen alias map ─────────────────────────────────────────────────────────
// Clue requires conditions use short aliases like "rosalind_trust >= 2".
// Map them to full citizen IDs for trust lookup.
const CITIZEN_ALIASES: Record<string, string> = {
  rosalind: 'rosalind_webb',
  fletcher: 'fletcher_grange',
  petra:    'petra_holloway',
  clem:     'clem_rourke',
  sadie:    'sadie_mirabel',
  eleanor:  'eleanor_finch_hartwell',
  constance:'constance_alderman',
  dot:      'dot_flowers',
  hettie:   'hettie_mossgrove',
  artie:    'artie_pryce',
  agnes:    'agnes_perkins',
  mari:     'marigold_osei',
  prewitt:  'reverend_prewitt',
}

// Minimum clues the player must have found before a solve attempt succeeds
const MIN_CLUES_TO_SOLVE: Record<string, number> = {
  shallow:    2,
  medium:     3,
  deep:       4,
  easter_egg: 3,
}

// ── Condition evaluator ───────────────────────────────────────────────────────

/**
 * Evaluate a requires condition string from mysteries.json.
 *
 * Supported forms:
 *   null / undefined         → always true (no prerequisite)
 *   "{name}_trust >= N"      → player trust with citizen >= N
 *   "visit {location_id}"    → player has visited that location
 *   "library_access"         → player has visited the library
 *   "{mystery_id}_accessed"  → player has at least one clue for that mystery
 *   "examine_statue_base"    → player has examined something at lakeside_park
 *   anything else            → default allow (graceful fallback)
 */
async function evaluateCondition(
  supabase: SupabaseClient,
  session: GameSession,
  condition: string | null | undefined
): Promise<boolean> {
  if (!condition) return true

  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // ── Trust check: "rosalind_trust >= 2" ──────────────────────────────────
  const trustMatch = condition.match(/^(\w+)_trust\s*>=\s*(\d+)$/)
  if (trustMatch) {
    const alias = trustMatch[1]
    const required = parseInt(trustMatch[2])
    const citizenId = CITIZEN_ALIASES[alias] ?? alias
    const trustLevel = await getTrustLevel(supabase, session, citizenId)
    return trustLevel >= required
  }

  // ── Location visit: "visit covered_bridge" ───────────────────────────────
  const visitMatch = condition.match(/^visit\s+(\S+)/)
  if (visitMatch) {
    const locationId = visitMatch[1]
    const { data } = await supabase
      .from('player_location_visits')
      .select('id')
      .eq(key, val)
      .eq('location_id', locationId)
      .maybeSingle()
    return !!data
  }

  // ── Library access shorthand ─────────────────────────────────────────────
  if (condition === 'library_access') {
    const { data } = await supabase
      .from('player_location_visits')
      .select('id')
      .eq(key, val)
      .eq('location_id', 'library')
      .maybeSingle()
    return !!data
  }

  // ── Mystery accessed: "founders_hidden_room_accessed" ────────────────────
  const accessedMatch = condition.match(/^(\w+)_accessed$/)
  if (accessedMatch) {
    const mysteryId = accessedMatch[1]
    const { count } = await supabase
      .from('player_mystery_clues')
      .select('id', { count: 'exact', head: true })
      .eq(key, val)
      .eq('mystery_id', mysteryId)
    return (count ?? 0) > 0
  }

  // ── Examine at location: "examine_statue_base" ───────────────────────────
  if (condition === 'examine_statue_base') {
    const { data } = await supabase
      .from('player_interactions')
      .select('id')
      .eq(key, val)
      .eq('location_id', 'lakeside_park')
      .eq('interaction_type', 'examine')
      .maybeSingle()
    return !!data
  }

  // ── Complex / unknown conditions — default allow ─────────────────────────
  return true
}

// ── Clue tracking ─────────────────────────────────────────────────────────────

/**
 * Return the clue IDs the player has already found for a given mystery.
 */
export async function getFoundClueIds(
  supabase: SupabaseClient,
  session: GameSession,
  mysteryId: string
): Promise<string[]> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data } = await supabase
    .from('player_mystery_clues')
    .select('clue_id')
    .eq(key, val)
    .eq('mystery_id', mysteryId)

  return (data ?? []).map((r: { clue_id: string }) => r.clue_id)
}

/**
 * Check if discovering something reveals a mystery clue.
 * Looks up the clue definition by (mystery_id, source|clue_id), evaluates
 * requires_condition, and records it if all prereqs are met.
 *
 * Returns the GameResponse update object if a NEW clue was revealed.
 * Returns undefined if: already found, condition not met, or no matching clue.
 */
export async function checkMysteryClue(
  supabase: SupabaseClient,
  session: GameSession,
  sourceId: string,   // what triggered the check (item id, location id, clue id…)
  mysteryId: string
): Promise<GameResponse['mystery_update']> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Look up the clue definition — match on source OR clue_id
  const { data: clue } = await supabase
    .from('mystery_clues')
    .select('clue_id, requires_condition')
    .eq('mystery_id', mysteryId)
    .or(`source.eq.${sourceId},clue_id.eq.${sourceId}`)
    .maybeSingle()

  // Use content clue_id if we found a match, otherwise fall back to sourceId
  const clueId = clue?.clue_id ?? sourceId
  const condition = clue?.requires_condition ?? null

  // Already found?
  const { data: existing } = await supabase
    .from('player_mystery_clues')
    .select('id')
    .eq(key, val)
    .eq('mystery_id', mysteryId)
    .eq('clue_id', clueId)
    .maybeSingle()

  if (existing) return undefined

  // Check prerequisite
  const conditionMet = await evaluateCondition(supabase, session, condition)
  if (!conditionMet) return undefined

  // Record in per-clue table
  try {
    await supabase.from('player_mystery_clues').insert({
      [key]: val,
      mystery_id: mysteryId,
      clue_id: clueId,
    })
  } catch {
    // Duplicate insert race — not a problem
    return undefined
  }

  // Keep player_mystery_progress (sidebar) in sync
  const { data: progress } = await supabase
    .from('player_mystery_progress')
    .select('clues_found, is_resolved')
    .eq(key, val)
    .eq('mystery_id', mysteryId)
    .maybeSingle()

  const cluesFound: string[] = progress?.clues_found ?? []
  if (!cluesFound.includes(clueId)) {
    await supabase
      .from('player_mystery_progress')
      .upsert({
        [key]: val,
        mystery_id: mysteryId,
        clues_found: [...cluesFound, clueId],
        is_resolved: progress?.is_resolved ?? false,
      }, {
        onConflict: key === 'player_id' ? 'player_id,mystery_id' : 'guest_token,mystery_id',
      })
  }

  return { mystery_id: mysteryId, clue_found: clueId }
}

// ── Solve attempt ─────────────────────────────────────────────────────────────

/**
 * Attempt to solve a mystery by ID. Checks whether the player has gathered
 * enough clues (varies by depth), then resolves and returns the resolution text.
 */
export async function handleSolveAttempt(
  supabase: SupabaseClient,
  session: GameSession,
  mysteryId: string
): Promise<{ success: boolean; text: string }> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data: mystery } = await supabase
    .from('mysteries')
    .select('title, depth, resolution_text')
    .eq('id', mysteryId)
    .single()

  if (!mystery) {
    return { success: false, text: "You're not sure which mystery you're working on." }
  }

  // Already resolved?
  const { data: progress } = await supabase
    .from('player_mystery_progress')
    .select('is_resolved, clues_found')
    .eq(key, val)
    .eq('mystery_id', mysteryId)
    .maybeSingle()

  if (progress?.is_resolved) {
    return {
      success: false,
      text: `You've already worked out **${mystery.title as string}**. The resolution is in your journal.`,
    }
  }

  // Count found clues
  const { count } = await supabase
    .from('player_mystery_clues')
    .select('id', { count: 'exact', head: true })
    .eq(key, val)
    .eq('mystery_id', mysteryId)

  const foundCount = count ?? 0
  const required = MIN_CLUES_TO_SOLVE[mystery.depth as string] ?? 3

  if (foundCount < required) {
    const still = required - foundCount
    const hints = [
      `Something feels incomplete. You need ${still} more piece${still > 1 ? 's' : ''} before it all fits.`,
      `You have a sense of the shape of it, but ${still} thread${still > 1 ? 's are' : ' is'} still loose. Keep looking.`,
      `Not yet — there's more to find. You're ${foundCount} of ${required} clues in.`,
    ]
    return { success: false, text: hints[foundCount % hints.length] }
  }

  // Resolve
  await supabase
    .from('player_mystery_progress')
    .upsert({
      [key]: val,
      mystery_id: mysteryId,
      clues_found: progress?.clues_found ?? [],
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    }, {
      onConflict: key === 'player_id' ? 'player_id,mystery_id' : 'guest_token,mystery_id',
    })

  const resolutionText = (mystery.resolution_text as string | null)
    ?? `You've worked it out. **${mystery.title as string}** — solved.`

  return {
    success: true,
    text: `*— You've worked it out. —*\n\n${resolutionText}`,
  }
}

/**
 * Fuzzy-match player input to a mystery ID. Returns the mystery ID or null.
 * Checks title match first, then a keyword table.
 */
export async function findMysteryByInput(
  supabase: SupabaseClient,
  input: string
): Promise<string | null> {
  const lower = input.toLowerCase()

  // Title-word check via DB
  const { data: mysteries } = await supabase
    .from('mysteries')
    .select('id, title')

  if (mysteries) {
    for (const m of mysteries) {
      if (lower.includes((m.title as string).toLowerCase())) return m.id as string
    }
  }

  // Keyword shortcuts
  const KEYWORDS: Record<string, string> = {
    'statue':              'moving_statue',
    'lake light':          'lake_light',
    'bioluminescen':       'lake_light',
    'beacon':              'lake_light',
    'sealed room':         'founders_hidden_room',
    'hidden room':         'founders_hidden_room',
    'alderman estate':     'founders_hidden_room',
    'walled':              'founders_hidden_room',
    'dear neighbor':       'anonymous_letter_writer',
    'anonymous':           'anonymous_letter_writer',
    'letter writer':       'anonymous_letter_writer',
    'note writer':         'anonymous_letter_writer',
    'artie and oliver':    'anonymous_letter_writer',
    'honey cake':          'missing_recipe',
    'recipe':              'missing_recipe',
    'missing ingredient':  'missing_recipe',
    'feud':                'family_feud',
    'perkins alderman':    'family_feud',
    'alderman perkins':    'family_feud',
    'mira finch':          'mira_finch',
    'who named':           'mira_finch',
    'lake named':          'mira_finch',
    'clocktower':          'clocktower_secret',
    'clock tower':         'clocktower_secret',
    'three minutes':       'clocktower_secret',
    '3 minutes':           'clocktower_secret',
  }

  for (const [kw, id] of Object.entries(KEYWORDS)) {
    if (lower.includes(kw)) return id
  }

  return null
}

// ── Convenience helpers ───────────────────────────────────────────────────────

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
 * Mark a mystery as fully resolved (used by special-case resolutions in engine).
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
      onConflict: key === 'player_id' ? 'player_id,mystery_id' : 'guest_token,mystery_id',
    })
}

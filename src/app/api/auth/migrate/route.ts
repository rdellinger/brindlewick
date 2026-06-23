import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminSupabaseClient } from '../../../../lib/supabase/server'

/**
 * POST /api/auth/migrate
 * Copies a guest session's progress to the newly-authenticated player account.
 * Must be called immediately after login when a prior guest token exists.
 *
 * Body: { guestToken: string }
 * Requires: authenticated session (via cookie)
 */
export async function POST(request: NextRequest) {
  try {
    const { guestToken } = await request.json()
    if (!guestToken) return NextResponse.json({ error: 'guestToken required' }, { status: 400 })

    // Verify the caller is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const playerId = user.id
    const admin = createAdminSupabaseClient()

    // ── 1. Trust levels ───────────────────────────────────────────────────────
    const { data: trustRows } = await admin
      .from('player_citizen_trust')
      .select('citizen_id, trust_level, first_met_at, last_interaction')
      .eq('guest_token', guestToken)

    if (trustRows?.length) {
      await admin.from('player_citizen_trust').upsert(
        trustRows.map(r => ({
          player_id: playerId,
          citizen_id: r.citizen_id,
          trust_level: r.trust_level,
          first_met_at: r.first_met_at,
          last_interaction: r.last_interaction,
        })),
        { onConflict: 'player_id,citizen_id' }
      )
    }

    // ── 2. Journal entries ────────────────────────────────────────────────────
    const { data: journalRows } = await admin
      .from('player_journal')
      .select('entry_type, title, content, related_id, game_date, created_at')
      .eq('guest_token', guestToken)

    if (journalRows?.length) {
      await admin.from('player_journal').insert(
        journalRows.map(r => ({
          player_id: playerId,
          guest_token: null,
          entry_type: r.entry_type,
          title: r.title,
          content: r.content,
          related_id: r.related_id,
          game_date: r.game_date,
          created_at: r.created_at,
        }))
      )
    }

    // ── 3. Mystery progress ───────────────────────────────────────────────────
    const { data: mysteryRows } = await admin
      .from('player_mystery_progress')
      .select('mystery_id, clues_found, is_resolved, resolved_at')
      .eq('guest_token', guestToken)

    if (mysteryRows?.length) {
      await admin.from('player_mystery_progress').upsert(
        mysteryRows.map(r => ({
          player_id: playerId,
          mystery_id: r.mystery_id,
          clues_found: r.clues_found,
          is_resolved: r.is_resolved,
          resolved_at: r.resolved_at,
        })),
        { onConflict: 'player_id,mystery_id' }
      )
    }

    // ── 4. Task progress ──────────────────────────────────────────────────────
    const { data: taskRows } = await admin
      .from('player_task_progress')
      .select('task_id, status, started_at, completed_at')
      .eq('guest_token', guestToken)

    if (taskRows?.length) {
      await admin.from('player_task_progress').upsert(
        taskRows.map(r => ({
          player_id: playerId,
          task_id: r.task_id,
          status: r.status,
          started_at: r.started_at,
          completed_at: r.completed_at,
        })),
        { onConflict: 'player_id,task_id' }
      )
    }

    // ── 5. Save state (location + inventory) ──────────────────────────────────
    const { data: guestSave } = await admin
      .from('guest_saves')
      .select('current_location, inventory, data')
      .eq('session_token', guestToken)
      .single()

    if (guestSave) {
      const saveData = guestSave.data as Record<string, unknown>
      // Check if player already has a save — only overwrite if guest is further along
      const { data: existingSave } = await admin
        .from('player_saves')
        .select('id')
        .eq('player_id', playerId)
        .single()

      if (existingSave) {
        await admin.from('player_saves').update({
          current_location: guestSave.current_location,
          inventory: guestSave.inventory,
          time_position: saveData?.time_position ?? null,
          has_chrono_logbook: saveData?.has_chrono_logbook ?? false,
          updated_at: new Date().toISOString(),
        }).eq('player_id', playerId)
      } else {
        await admin.from('player_saves').insert({
          player_id: playerId,
          current_location: guestSave.current_location,
          inventory: guestSave.inventory,
        })
      }
    }

    // ── 6. Location visits ────────────────────────────────────────────────────
    const { data: visitRows } = await admin
      .from('player_location_visits')
      .select('location_id, visited_at')
      .eq('guest_token', guestToken)

    if (visitRows?.length) {
      // Insert only locations not already visited
      const { data: existingVisits } = await admin
        .from('player_location_visits')
        .select('location_id')
        .eq('player_id', playerId)
      const existingIds = new Set((existingVisits ?? []).map(v => v.location_id))
      const newVisits = visitRows.filter(v => !existingIds.has(v.location_id))
      if (newVisits.length) {
        await admin.from('player_location_visits').insert(
          newVisits.map(r => ({
            player_id: playerId,
            location_id: r.location_id,
            visited_at: r.visited_at,
          }))
        )
      }
    }

    return NextResponse.json({ ok: true, playerId })
  } catch (err) {
    console.error('[auth/migrate] Error:', err)
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 })
  }
}

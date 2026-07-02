# Phase 2 Handoff — Performance Quick Wins

**Date:** 2026-07-02 · **Scope:** all Workstream A items (A1–A9) plus B3, per MASTER_PLAN.md. No system-prompt content in dialogue.ts was changed (roster/directory slimming stays in Phase 5).

## Files changed

`src/lib/game/world_cache.ts` (new), `src/lib/game/sidebar_state.ts` (new), `src/lib/game/world.ts`, `src/lib/game/engine.ts`, `src/lib/game/player.ts`, `src/lib/game/npc_items.ts`, `src/lib/game/dialogue.ts` (fetch parallelization + gossip concurrency only — no prompt text touched), `src/lib/game/gossip.ts`, `src/app/api/game/state/route.ts`, `src/app/api/game/command/route.ts`, `src/app/game/page.tsx`.

## Before / after by flow

Query counts are Supabase round-trips for a typical request (conditional queries shown as ranges). "Serial depth" is the number of *sequential* round-trip waves, which is what the player feels. The second HTTP request (GET /state) that used to follow most commands is counted separately in the last row.

| Flow | Queries before | Queries after | Serial depth before → after | What changed |
|---|---|---|---|---|
| `look` (look around) | ~12–14, all sequential | ~10–12 in 2 parallel batches | ~12 → ~5 | Location row from cache (A2); location+arrival-behaviors+citizens batched, holdings+items batched (A5); behavior fired-log batched (A9) |
| `go` | ~15–17, all sequential (incl. up to 6 findLocationByName queries + a redundant first-visit query) | ~8–10 | ~15 → ~6 | findLocationByName is 0 queries (A7); save-update + visit-log + direct-exit batched; citizens + task-completion batched (A5); first-visit query removed (A8) |
| `talk` | ~15–18 sequential + world_state read in logInteraction | ~11–13 | ~15 → ~8 | Roster + location context from cache; trust/roster/history/location batched (A5); world_state read removed (A6) |
| `ask` | ~8–10 sequential | ~6–8 | −2 waves | Trust + location context batched; cache; A6 |
| Conversation message | ~18 sequential + gossip Haiku call **serial after** dialogue call + a broken locations query | ~14–15 | ~18 → ~8–9 | One 5-way parallel batch pre-dialogue (A1); roster/locations cached (A2); lore+gossip batched; trust/history/log writes batched post-dialogue; gossip detection now runs **concurrently with** the dialogue call (B3) — its latency disappears; world_state reads removed (A6) |
| Sidebar state refresh | Separate GET after most commands: ~20–25 fully sequential, incl. two N+1 loops (trust per citizen, giver name per task) + world_state read ×2 | Attached to the command response: ~16–18 in 3 waves; N+1s → two `.in()` queries (A4); world_state reads removed | Entire extra HTTP round-trip eliminated (A3) | GET /api/game/state remains for initial page load only; command route rebuilds the session (1 query) and attaches state whenever the client would have refetched |

**Claude calls per session:** unchanged for dialogue/parsing (by design — prompt work is Phase 5). Gossip detection (`detectAndStorePlayerFact`): trigger threshold raised from 10 → 25 chars, cutting call volume roughly in half (est. ~5–10 → ~2–5 per session), and the remaining calls add zero latency because they run concurrently with the dialogue call. It also now respects the `ANTHROPIC_MODEL` env var instead of a hardcoded model ID.

## Bugs fixed in passing (all in files already in scope)

1. **Escort map / location directory were silently empty.** The `allLocations` query in `handleConversationMessage` selected a nonexistent `address` column on `locations`, so PostgREST rejected it on every conversation message — `[ESCORT:]` proactive offers, the town location directory, and the "you are at X" context line never reached the model. Now served from the cache; **note: this re-enables the intended location-directory prompt block (~69 entries with hours), which adds ~1.3K input tokens per conversation turn until Phase 5 slims it.** If cost matters more than the feature short-term, pass an empty `locationDirectory` — one line in engine.ts.
2. **Guest sidebars never showed summoned citizens.** The state route read `citizen_overrides` from `guest_saves` keyed by `guest_token`, but that table is keyed by `session_token`. Fixed in `sidebar_state.ts`.
3. **Bakery tutorial hint could never fire** (first-visit check ran after the visit row was inserted). `logLocationVisit` now returns first-visit status from the check it already performs (A8).
4. **`getCitizenCurrentLocation` used the server's local timezone** to compute the time slot (and made a dead no-op RPC call + a world_state read). Now uses the shared ET clock (A6).

## Verification

- `npx tsc --noEmit`: **clean**.
- `npm run lint`: **no errors in any touched file**. Three errors that existed at HEAD were fixed in passing since they were in files this phase touched (two page.tsx hook-ordering/memoization errors, one engine.ts `prefer-const`). The 4 remaining lint errors are pre-existing and out of scope: `src/app/page.tsx` unescaped quotes ×2, `scripts/generate-supporting-citizens.js` require() ×2.
- `npm run build`: **could not run in this sandbox** — Next.js needs to download the `@next/swc-linux-arm64-gnu` binary (node_modules were installed on macOS) and the environment has no npm-registry access. **Rich: please run `npm run build` locally once**; tsc + lint cover the type/syntax surface, but this is the one unchecked box.
- No git commits were made (the mounted repo rejects git index writes from this environment). All changes are uncommitted working-tree edits — review with `git diff`.

## Skipped / deferred (and why)

- **B1 (roster tier filter) and all prompt slimming (B2/B4/B5/B6/B7)** — explicitly deferred to Phase 5 per this phase's instructions: shrinking NPC world-awareness before the entity/grounding system exists would be counterproductive. Open Question 1 (is production seeded with 930 citizens?) is still worth answering now — the roster *cache* (A2) means the 930-row fetch happens once per 5 minutes instead of per message, but the roster still lands in every prompt.
- **A7 for `findItemByName` / `findCitizenByName`** — items and citizens mutate at runtime (state transitions, Phase 4 dynamic entities) and citizens may be a 930-row table; kept on DB. `findLocationByName` is fully cache-backed.
- **`citizen_schedules` table question** — `getCitizenCurrentLocation` (npc_items.ts) queries a `citizen_schedules` table that doesn't appear in any migration (001 creates `citizen_routines`). If that table doesn't exist in production, world-tick behavior conditions like `at_location:` have never matched. Out of scope for Phase 2; flagged for Phase 4/5 investigation.

## Post-phase addendum (2026-07-02, same day)

- **Open Question 1 answered: production has 37 principal + 893 supporting citizens.** With Rich's sign-off, **B1 was pulled forward**: `getTownRosterCached` now filters `tier='principal'`, cutting ~30–37K input tokens from every conversation turn (~90%+ of prompt cost). The engine's summon fallback was switched from roster matching to `findCitizenByName` so all 930 residents remain summonable by player request. NPC prompts list only the 37 principals until the grounding phase.
- **`citizen_schedules` confirmed nonexistent** (only `citizen_routines`). Logged as new item A10 in the master plan: world-tick `at_location:` behaviors have never fired.
- Error logging added to both dialogue catch blocks (they previously swallowed API failures silently — discovered when a missing local `ANTHROPIC_API_KEY` produced canned fallback dialogue during the smoke test).

## Cache semantics (for future phases)

`world_cache.ts`: module-scope, 5-minute TTL, caches full `locations` table and the citizens roster projection. **Phase 4 must call `invalidateWorldCache()` after inserting any dynamic entity**, and admin write routes should too. Per-instance only (serverless instances each warm their own cache — first request per instance pays the two fetches).

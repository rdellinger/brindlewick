# Phase 1 Handoff — Audit Complete

**Date:** 2026-07-02 · **Mode:** read-only audit; no application code was changed. Deliverable: `docs/fable/MASTER_PLAN.md` (this doc summarizes it and confirms readiness for Phase 2).

## What was reviewed

Read in full: `src/lib/game/engine.ts` (2,809 lines), `dialogue.ts`, `world.ts`, `gossip.ts`, `npc_items.ts`, `player.ts`, `src/app/api/game/command/route.ts`, `state/route.ts`, `src/types/game.ts`, `src/lib/anthropic/client.ts`, `REVIEW_PROMPT.md`, plus the frontend command loop in `src/app/game/page.tsx` and `parser.ts` (needed to complete the Claude call inventory). Skimmed: `content/citizens/*.json`, `locations.json`, `items.json`, all 20 files in `supabase/migrations/`, `scripts/seed.ts`, `src/app/api/cron/advance-world/route.ts`.

## Headline findings

1. **Likely-critical cost discovery (needs a 5-minute DB check):** `scripts/seed.ts` seeds **930 citizens** (37 principal + 893 supporting), and `getTownRoster()` (world.ts:221) has no tier filter. If production matches the seed, every conversation turn's system prompt carries a ~930-entry roster **plus** a ~930-entry summon-ID list ≈ **35–40K input tokens per turn** — vs. the ~200 tokens dialogue.ts's cost comment assumes. REVIEW_PROMPT.md's "~35 people" architecture note appears to predate the supporting-citizen seed. The one-line fix (B1) is in Phase 3; verifying the row count is Open Question 1 in the master plan.
2. **Perf shape:** `handleConversationMessage` runs ~12–18 sequential DB round-trips around a 1–3 s Claude call, and the client refires `GET /api/game/state` (10–15 more queries, two N+1 loops at state/route.ts:115–131 and 138–147) after nearly every command. Phases 2 and 6 address this (Promise.all batching, in-process static caches, state-in-command-response).
3. **Four Claude call sites total** (dialogue.ts ×2, gossip.ts ×1, parser.ts ×1), fully inventoried with per-session frequency and token estimates in Workstream B. Notable: `detectAndStorePlayerFact` is **awaited serially after** the dialogue call on every keyword-matching message — latency and call volume are both trimmable without losing the feature.
4. **Workstream C is fully designed** in the master plan: `[NEW_PERSON:name|description|where]` / `[NEW_PLACE:...]` / `[NEW_ITEM:...]` tags extending the proven ESCORT/SUMMON mechanism (parse points verified at engine.ts:643–671 and 817–849; prompt blocks at dialogue.ts:183–206). Recommendation: **direct insert into the real tables with a `source: 'seeded'|'ai_generated'` column** (not a staging table) so all existing finders/roster/holdings helpers see new entities with zero read-path changes; safety via caps + tone blocklist + `ai_entity_log` + an admin curation panel. Column-default decisions (new person gets `home_location` fallback + a `citizen_overrides` entry; new place gets an auto-exit from its anchor location; new item lands at the conversation location or in the speaker's holdings) are specified item-by-item in §C3.
5. **Bugs found in passing:** (a) `handleGo` logs the location visit *before* checking first-visit, so `isFirstVisit` is always false and the bakery tutorial hint (engine.ts:405–406) can never fire — fix scheduled in Phase 2. (b) `citizen_relationships` is seeded but referenced nowhere in `src/` — surfacing it is D3. (c) Dead no-op RPC call in `getCitizenCurrentLocation` (npc_items.ts:167–171). (d) Migrations include three files numbered `014_*` — new migration should take `019_` (Open Question 5).

## State of the plan

`MASTER_PLAN.md` contains: 6 open questions for Rich (top of doc), prioritized checklists for all four workstreams with file/function/line references and S/M/L sizes, a call-site inventory table for Workstream B, the full Workstream C design (tag format, storage recommendation with reasoning, defaults, dedup, guardrails), a ranked top-9 for Workstream D biased toward features that reinforce C, and a Phase 2–6 grouping where each phase touches 3–6 files and 3–6 checklist items with per-phase verification steps.

## For the Phase 2 session

Phase 2 = query hygiene (A1, A4, A5, A6, A8/D8-bug) across engine.ts, world.ts, player.ts, npc_items.ts, state/route.ts. Before starting: resolve Open Question 1 (`select count(*), tier from citizens group by tier`) — it changes Phase 3's urgency, not Phase 2's content. Line numbers in the plan were verified against the codebase on 2026-07-02; re-confirm with the named functions if files have since changed.

**MASTER_PLAN.md is ready for Phase 2.**

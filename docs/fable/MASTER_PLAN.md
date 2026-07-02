# Brindlewick — Master Implementation Plan

**Produced:** Phase 1 audit, 2026-07-02 (read-only; no code changed).
**Scope:** Four workstreams — (A) performance/query efficiency, (B) Claude API call reduction, (C) dynamic world-entity system, (D) world-class feature gaps — bundled into proposed Phases 2–6.
**Line numbers** reference the files as of this audit. They will drift; each item also names the function, which is the durable reference.

---

## Open questions for Rich (decide before the phase that needs them)

1. **ANSWERED 2026-07-02: YES — production has 37 principal + 893 supporting citizens.** Every conversation turn ships a ~930-entry roster + summon list (~35–40K input tokens/turn). B1 is therefore urgent, not speculative. *(Original question below for context.)* Is the full 930-citizen roster actually seeded in production? `scripts/seed.ts` seeds 37 principal + 893 supporting citizens into `citizens`, and `getTownRoster()` (world.ts:221) has **no tier filter**. If production matches the seed, every conversation turn ships a ~930-entry roster + ~930-entry summon list in the system prompt (~35–40K tokens/turn, ~40× the cost the dialogue.ts comment assumes). If only principals are seeded, it's ~5–6K tokens. **Check the row count of `citizens` before Phase 2** — this determines whether B1 is a critical fix or a moderate one. Needed for: Phase 2.
2. **Should AI-generated entities be shared across all players or per-player?** Workstream C recommends inserting into the shared `citizens`/`locations`/`items` tables (so "Aunt Clara" exists for everyone), which is the simplest way to satisfy "referenced by the player and all NPCs later." The alternative — per-player entities keyed like `citizen_overrides` — keeps each player's world private but roughly doubles the query complexity of every `findXByName` helper. Recommendation: **shared**, with a per-day global cap and admin curation. Needed for: Phase 4.
3. **Cap values for auto-created entities.** Proposed defaults: max 3 new entities per player per real day, max 10 town-wide per day, hard cap 100 `ai_generated` rows total until you've reviewed the first batch. Fine to adjust later; need a starting number. Needed for: Phase 4.
4. **May a `[NEW_PERSON]` be summoned/met in the same turn it's created?** Recommended: yes for items (goes to the current location or the speaker's holdings), yes for people (auto-add a `citizen_overrides` entry so they can walk in), but **no** for places (created `is_hidden:false` with an exit, but the player still has to `go` there). Confirm or simplify. Needed for: Phase 4.
5. **The duplicate migration numbers** (three files named `014_*.sql`) — is production tracking migrations by filename order, or have these all been applied manually via the SQL editor? Determines whether Phase 4's new migration should renumber or just take `019_`. Needed for: Phase 4 (low risk either way; plan assumes `019_`).
6. **Tolerance for scripted-vs-generated dialogue ratio.** B4 proposes raising scripted dialogue usage from 70% to ~90% for greetings/asks. That's a real cost saving but slightly more repetition. Is that trade acceptable? Needed for: Phase 3.

---

## Workstream A — Performance & Supabase query efficiency

Ordered by priority. The overall shape of the problem: `handleConversationMessage` runs ~12–18 sequential DB round-trips wrapped around a 1–3 s Claude call, and the client then fires `GET /api/game/state` (another ~10–15 round-trips, two of them N+1 loops) after nearly every command.

- [x] *(Phase 2)* **A1 (M) — Parallelize `handleConversationMessage` pre-Claude reads.** engine.ts, `handleConversationMessage` (lines ~586–641). Sequential awaits that are mutually independent: `getWorldState`, `getCitizen`, `getTrustLevel`, the `citizen_overrides` save-row read (~602–607), `getCitizensAtLocation` (~610), `getTownRoster` (~611), the `allLocations` query (~615–619), and inside `continueConversation` the `getLoreForCitizen` + `getPlayerGossipForNpc` reads (dialogue.ts:157, 163). Group into 2 `Promise.all` batches (identity/session reads, then location-dependent reads). Post-response writes (`updateTrust`, `saveConversationHistory`, `logInteraction`, ~674–688) can also run as one parallel batch — none reads another's result.
- [x] *(Phase 2)* **A2 (S) — Cache static world data in-process.** The `locations` table (69 rows), `citizens` roster projection, and `location_exits` change only when Rich reseeds. Add a module-level TTL cache (5–15 min) in world.ts for `getTownRoster` and a new `getAllLocations` helper; the `allLocations` query in `handleConversationMessage` (engine.ts:615–619) then becomes a cache hit instead of a per-message full-table fetch. Invalidation hook: bump on admin writes, or just accept TTL staleness. (Note: once Workstream C inserts new rows at runtime, cache invalidation must happen on `[NEW_*]` capture — design the cache with an explicit `invalidate()` from day one.)
- [x] *(Phase 2)* **A3 (M) — Kill the double round-trip: return sidebar state from POST /command.** `src/app/game/page.tsx` calls `loadGameState()` (GET /api/game/state) after every command that touches trust/journal/mystery/inventory/tasks (page.tsx:402–404) — which is nearly every conversational turn, since trust updates on each exchange. Extract the state-building body of `state/route.ts` into a shared `buildSidebarState(supabase, session)` and append it to the command response behind a `?include_state=1` flag; client stops refetching. Halves per-command latency and DB load.
- [x] *(Phase 2)* **A4 (S) — Fix the two N+1 loops in `state/route.ts`.** (1) Trust levels: lines ~138–147 query `player_citizen_trust` once **per citizen present** — replace with one `.in('citizen_id', ids)` query. (2) Task giver names: lines ~115–131 query `citizens` once per task — replace with one `.in()` query. Also batch the independent top-level reads (journal count, journal rows, world events, mystery progress, task rows, seen items) into `Promise.all`.
- [x] *(Phase 2)* **A5 (S) — Parallelize `handleLook` and `handleTalk` reads.** engine.ts `handleLook` (~228–265): `getLocationWithExits`, `getCitizensAtLocation`, `getHoldingsAtLocation`, `getItemsAtLocation` are independent → one `Promise.all`. `handleTalk` (~462–500): `getTrustLevel`, `getTownRoster`, `getConversationHistory`, and the location row fetch (~486–490) likewise. Same pattern in `handleAsk` (~942–951).
- [x] *(Phase 2)* **A6 (S) — Stop re-reading `world_state` for the date.** `getWorldState()` now derives everything from the real clock (world.ts:20–22), but `logInteraction` (engine.ts:2363–2364), `addJournalEntry` (player.ts:242–246), `buildGameSession` (player.ts:129–133), and `getCitizenCurrentLocation` (npc_items.ts:150–156) each still make a `world_state` DB read per call. Replace with `getRealWorldState()` — four round-trips saved on hot paths. Also remove the dead no-op RPC call in `getCitizenCurrentLocation` (npc_items.ts:167–171).
- [x] *(Phase 2 — locations only; findItemByName/findCitizenByName kept on DB, see PHASE_2_HANDOFF)* **A7 (S) — `findLocationByName` / `findItemByName` query fan-out.** world.ts:101–149: up to 6+ sequential ILIKE queries per lookup (stripped query, raw query, per-word, ID fallback). With A2's cached location list (69 rows), do the fuzzy matching in JS in one pass, zero queries. Same for `findCitizenByName` **if** the citizens table is small (blocked on Open Question 1).
- [x] *(Phase 2)* **A8 (S) — `handleGo` first-visit check is both a bug and an extra query.** engine.ts: `logLocationVisit` (line ~359) inserts the visit row **before** the first-visit check (~396–402) reads it, so `isFirstVisit` is always false and the bakery tutorial hint can never fire. Reorder (check first, then log) and reuse the result — fixes the bug and drops a query.
- [ ] **A10 (S, added post-Phase-2) — Fix `getCitizenCurrentLocation` querying a nonexistent table.** npc_items.ts queries `citizen_schedules`, but only `citizen_routines` exists (confirmed via information_schema, 2026-07-02). The query has always errored → returned null → every `world_tick` behavior with an `at_location:` condition has never fired. Fix: query `citizen_routines` (columns: citizen_id, day_of_week, time_slot, location_id) or reuse the `get_citizen_location` RPC. Verify world-tick behaviors actually fire after the fix.
- [x] *(Phase 2)* **A9 (M) — Batch behavior-log lookups in npc_items.ts.** `processArrivalBehaviors` / `processInteractionBehaviors` / `processWorldTickBehaviors` call `hasAlreadyFired` once per behavior row (npc_items.ts:120–127) and evaluate conditions serially. Fetch all fired-behavior IDs for the relevant behavior set in one `.in()` query. Low urgency (behavior tables are small) but the pattern will grow.

---

## Workstream B — Claude API call reduction

### Call-site inventory (every `client.messages.create` path)

| # | Call site | Trigger | Freq / session (est. 30-command session, ~15 conversation turns) | System-prompt size |
|---|---|---|---|---|
| B-i | `continueConversation` — dialogue.ts:239 | Every free-text message while a conversation is active (command/route.ts:42–58) | ~15 | **The problem.** Base (tone+world+citizen+motive+rules) ≈ 0.8–1.2K tok. Plus: roster w/ personality+household (dialogue.ts:179–181), escort map ~69 IDs (~183–185), full location directory with computed open/closed hours ~69 entries (~188–199), summon list (~201–206), gossip. **If citizens = 37 principals: ≈ 5–6K tok/turn. If citizens = 930 (full seed, no tier filter in `getTownRoster`): ≈ 35–40K tok/turn** (roster ~28K + summon list ~9K). Output ≤ 350 tok. |
| B-ii | `generateNpcDialogue` — dialogue.ts:113 | `talk` greeting (engine.ts:500), `ask` (engine.ts:951), unscripted gift reactions (engine.ts:2212). Skipped 70% of the time when scripted dialogue exists (dialogue.ts:90–93) | ~4–6 | Same roster block when called from `handleTalk` (roster passed); ~2–30K tok depending on Open Question 1. `handleAsk` passes an empty roster — much cheaper (~1K). |
| B-iii | `detectAndStorePlayerFact` — gossip.ts:59, called from dialogue.ts:248 | Every conversation message matching the `PERSONAL_SIGNALS` regex (gossip.ts:39) — a wide net ("I have", "I'm", "I was"…) | ~5–10 | Tiny (~50 tok) but **awaited serially after the dialogue call**, adding a full extra round-trip of latency to the player's response. Hardcodes model ID instead of `MODEL`. |
| B-iv | `claudeParse` — parser.ts:254 | Any input the Tier-1 regex can't classify | ~2–5 | Tiny (~250 tok). Fine as-is. |

### Checklist (priority order)

- [x] *(Pulled forward to Phase 2 follow-up, 2026-07-02, with Rich's sign-off after production confirmed 930 citizens. Roster now tier='principal' in world_cache.ts; engine's summon fallback switched to findCitizenByName so all 930 residents remain player-summonable.)* **B1 (S, do first) — Filter `getTownRoster` to `tier = 'principal'` (or verify only principals are seeded).** world.ts:221–229. One-line `.eq('tier','principal')` bounds the roster at 37 regardless of what's in the DB. If 930 citizens are live, this single line cuts per-turn input tokens by ~85–90%. Depends on Open Question 1 only for how urgent it is, not whether to do it.
- [ ] **B2 (M) — Slim the `continueConversation` prompt.** dialogue.ts:179–206. (a) Roster: send names+occupation only (drop personality/household → ~60% smaller), or only mystery-related + same-household + nearby citizens. (b) Location directory: NPCs rarely need all 69 with live hours — send name+area for all, hours only for the NPC's own location and 3–5 nearby; answer "when does X open" via a scripted lookup path instead. (c) Summon list: only citizens plausibly summonable (same household / same work location), not the whole town. Target: ≤ 2K tok system prompt. Est. saving: thousands of tokens × 15 turns/session.
- [x] *(Phase 2 — implemented as concurrent-with-dialogue rather than fire-and-forget, so serverless doesn't drop the write)* **B3 (S) — Make gossip detection non-blocking and cheaper.** gossip.ts:47–100, call at dialogue.ts:248. (a) Don't `await` it in the response path (fire-and-forget — the try/catch already makes it non-fatal). (b) Tighten `PERSONAL_SIGNALS` (require first-person + a noun-phrase, or min length ~25 chars) to cut trigger rate ~50%. (c) Optionally batch: accumulate a session's flagged messages and extract facts in one call at conversation end. Saves ~5–10 calls/session and removes serial latency.
- [ ] **B4 (S) — Raise scripted-dialogue usage for greetings/asks.** dialogue.ts:90–93 uses scripted content 70% of the time when it exists. For plain `greeting`/`returning_visitor` topics, 90–100% scripted is fine (variation matters less there than in mid-conversation). Saves ~2–4 calls/session. (Open Question 6.)
- [ ] **B5 (S) — Skip the lore fetch when scripted dialogue already won.** dialogue.ts:96 fetches `citizen_lore` even on the 70% scripted path where it's unused... actually the scripted return happens at line 92 before the lore fetch — but `continueConversation` (line 157) fetches lore on every turn whether or not the model surfaces it. Consider fetching lore only every Nth turn or when topic keywords match. Marginal; bundle with B2.
- [ ] **B6 (M) — Cache the assembled static prompt blocks.** Roster line, location directory line, escort map are identical across turns and players (until entities change). Build once, cache alongside A2's data cache; per-turn assembly then only concatenates dynamic parts (trust, gossip, history). Zero API saving but removes per-turn CPU/DB work and makes B2's slimming verifiable in one place. Invalidate on Workstream C entity creation.
- [ ] **B7 (flag only, L) — Prompt caching via the Anthropic API.** The stable prompt prefix (tone rules + roster + directory) is a textbook `cache_control` candidate — 90% input-token discount on cache hits with zero behavior change. Worth doing after B2 settles the prompt shape. Needs `@anthropic-ai/sdk` version check.

**What cannot be cut:** one Haiku call per genuine conversational turn (B-i) is the product — the goal is shrinking its input, not skipping it. `claudeParse` (B-iv) is already well-gated.

---

## Workstream C — Dynamic world-entity system (priority workstream)

### The problem

`continueConversation`'s prompt constrains people ("never invent names not on this list", dialogue.ts:180) and location IDs (escort/summon lists), but (a) there is **no constraint at all on items** — NPCs freely narrate a "jar of blackberry preserves" that exists in no table, and (b) when an NPC *does* invent a person/place despite the rules (or invents one conversationally without an ID tag — "my aunt Clara runs the flower stand"), nothing captures it. The next NPC has never heard of Aunt Clara; the player can't `find`, `talk to`, or `go to` anything mentioned. The fix has two halves: **capture** what gets invented (this workstream) and **invent less** by grounding better (fed by Workstream D's memory/grounding features).

### The pattern to extend (verified current locations)

- Tag emission is instructed in the system prompt: `[ESCORT:location_id]` at dialogue.ts:183–185, `[SUMMON:citizen_id]` at dialogue.ts:201–206.
- Tag parsing/stripping in engine.ts `handleConversationMessage`: escort regex parse at **lines 643–671** (match at 644, summon match at 648, fuzzy-summon fallback 652–666, strip 669–671); escort-offer storage at **817–825**; summon execution (writes `citizen_overrides` to the save row) at **827–849**. (The prompt's "~644–670 and ~817–849" estimates are accurate.)
- This proves the mechanism: Haiku reliably emits one structured tag inline at zero marginal API cost, and the engine parses, strips, and acts on it in the same turn.

### C1 — Tag payload format

Pipe-delimited, matching the existing bracket style, all free-text fields written by the model **in the same response that narrates the entity**:

```
[NEW_PERSON:Aunt Clara|Marigold's aunt, runs the flower stand on weekends|flower stand]
              name    |description (also used as personality/backstory seed)|where they're usually found (loose text, resolved via findLocationByName, nullable)

[NEW_PLACE:Clara's Flower Stand|A folding table of mason-jar bouquets at the edge of the market|market]
             name              |description → short_desc/long_desc            |anchor: loose reference to an existing location the new one is near (resolved via findLocationByName; falls back to the conversation's current location)

[NEW_ITEM:jar of blackberry preserves|Deep purple, wax-sealed, from the Tucker hives' berry patch|held]
            name                     |description                              |placement: "held" (speaker's holdings) or "here" (current location); default "here"
```

Parsing in engine.ts alongside the existing block (after line ~648):
`const newEntityMatches = [...rawResponse.matchAll(/\[NEW_(PERSON|PLACE|ITEM):([^\]|]+)\|([^\]|]*)(?:\|([^\]|]*))?\]/g)]`, then strip with the same `.replace` pattern used for ESCORT/SUMMON (extend lines 669–671). Multiple tags per response allowed; process at most N (guardrail C5). Prompt instructions live next to the SUMMON block in dialogue.ts with the same "only when it genuinely serves the story" framing, plus: *"Only introduce a new person/place/item when the conversation naturally calls for one and nothing on the existing lists fits."*

**Size: M** (parser + strip + prompt block), excluding the insert logic below.

### C2 — Storage: direct insert with a `source` column (recommended) vs. staging table

**Recommendation: insert directly into `citizens` / `locations` / `items`, with new columns `source text default 'seeded' check (source in ('seeded','ai_generated'))` and `created_by_player_key text` + `created_at` (items/locations already have created_at).**

Reasoning, tied to the requirement that the entity be *referenced by the player and all NPCs later without manual intervention*:

- Every lookup the game does — `findCitizenByName`, `findLocationByName`, `findItemByName`, `getTownRoster`, `getCitizensAtLocation`, `getCitizenHoldings`, sidebar state — reads these three tables directly. A direct insert makes the new entity visible to **all** of them instantly, with zero code changes to the read paths. A staging table would require either a promotion step (manual intervention — disqualified by the requirement) or dual-source reads in every one of those ~10 helpers (large, error-prone diff).
- The `source` column gives the admin dashboard a clean filter for review/curation (C5) and gives us a one-line kill switch (`delete from citizens where source='ai_generated'`).
- Risk of direct insert (a bad entity is immediately live) is handled by guardrails (C5) instead of a staging step: caps, tone check, and admin delete. In a cozy single-author game this is the right trade; a staging table is the right answer only if Rich wants pre-approval, which contradicts "without manual intervention."

Migration `019_dynamic_entities.sql` (see Open Question 5): the three `alter table ... add column source/created_by_player_key` statements + an `ai_entity_log` table (entity_type, entity_id, raw_tag, citizen_speaker, player_key, created_at) for auditability + index on `source`.

**Size: S** for the migration itself.

### C3 — Column defaults for rows the payload can't fill

**NEW_PERSON → `citizens`:**
- `id`: slugified name + short random suffix (`aunt_clara_x7f2`) — avoids collisions with the `stuart_tucker_0` style IDs.
- `tier: 'supporting'`, `trust_max: 3` (the schema default), `gossip_rating: 5`, `is_mystery_related: false`, `age/gender: null`, `personality`: the payload description, `backstory: null`.
- `home_location`: resolve payload field 3 via `findLocationByName`; fall back to the conversation's current location. This matters because the `get_citizen_location` RPC falls back to home when no routine rows exist — so the new person is findable via `find` immediately.
- No `citizen_routines` rows (home fallback covers presence). **Also write `citizen_overrides[new_id] = currentLocation`** on the speaker's save row — the exact mechanism SUMMON already uses (engine.ts:827–849) — so the new person can appear in the room this same session (per Open Question 4).
- `last_name`: if the payload name is one word, use the speaker's last name when the description implies family ("aunt", "brother"), else `''` — flag for admin cleanup.

**NEW_PLACE → `locations`:**
- `id`: slugified name. `type: 'commercial'` default (most NPC-invented places are shops/stands), `area`: inherit from the anchor location. `short_desc`/`long_desc`: payload description (long_desc can prefix "A newer addition to town —" style framing). `business_hours: null` (always open — safest default; hours are curation work).
- **Reachability (the critical default):** insert a bidirectional `location_exits` pair between the anchor location (payload field 3, resolved via `findLocationByName`, fallback = conversation's current location) and the new place. A location without exits is unreachable via the adjacency system; `is_hidden: true` without connection would make the entity pointless. Recommendation: `is_hidden: false` **and** auto-exit from the anchor. (Note `handleGo`/`findLocationByName` actually allow travel to any non-hidden location regardless of exits, but exits make it appear in `look` output and pathfinding — do both.)
- `is_locked: false`, `boat_required: false`, `research_available: false`, all variants null.

**NEW_ITEM → `items`:**
- `id`: slugified name. `type: 'examine'`, `can_take: false` default (safe: nothing breaks if the player can't pocket it), unless placement is `held`.
- Placement `here`: `location_id = session.currentLocation`. Placement `held`: `location_id = null` + insert a `citizen_item_holdings` row for the speaking NPC (`acquired_from_type: 'citizen'`) — it then shows up via `getCitizenHoldings`, the carry list in `look`, and the on-ask purchase detection in `handleConversationMessage` (engine.ts:693–712).
- `weight_class: 'small'`, `rarity: 'common'`, `impression_value: 0`, `is_ambient: false`, `is_consumable: false`, `mystery_tie: null`.

**Size: M** (insert helpers per entity type, in a new `src/lib/game/dynamic_entities.ts`).

### C4 — Deduplication

Before any insert, run the corresponding existing finder with the tag's name: `findCitizenByName` (world.ts:243–272 — already handles "First Last" splits, nickname ILIKE), `findLocationByName` (world.ts:101–149 — leading-"the" strip, per-word match, ID match), `findItemByName` (world.ts:451–479). **If a match returns, treat the tag as a reference, not a creation** — strip it, skip the insert, and (for PERSON with a `where` field) optionally just set the override. Extensions needed beyond reuse:

- Single-name matching: "Marigold" must match `marigold_osei` — `findCitizenByName`'s fallback ILIKE already does this; add a check that a **first-name-only** exact match wins over fuzzy multi-matches.
- Normalize honorifics/kin-prefixes before matching: strip leading "Aunt ", "Old ", "Mrs. ", "Dr. " and match the remainder too (so "Aunt Clara" doesn't duplicate an existing "Clara Whitfield").
- Also check against **other AI-generated entities created this session** (in-memory) since the finder queries could race within one response containing two tags.

**Size: S–M** (mostly reuse; the honorific normalizer is new).

### C5 — Guardrails

- **Caps:** per-player-per-day and town-wide-per-day caps (values = Open Question 3), enforced by counting `ai_entity_log` rows before insert; on cap hit, strip the tag silently (the narration still reads fine — the entity just isn't persisted, same failure mode as today).
- **Tone check:** cheap regex blocklist on name+description (danger/weapon/hostility vocabulary — mirror the TONE RULES in dialogue.ts:67–76) — reject and strip on match, log to `ai_entity_log` with `rejected: true`. No second API call.
- **Prompt-side constraint:** the NEW_* instruction block itself restates the tone rules ("new entities must fit Brindlewick's warmth — no danger, no hostile characters").
- **Admin curation:** add an "AI-Generated Entities" section to `src/components/admin/AdminDashboard.tsx` backed by a new `src/app/api/admin/ai-entities/route.ts` (GET list filtered on `source='ai_generated'`, DELETE, PATCH for edits like fixing a last name or adding hours). The admin API directory already has per-resource routes (`citizens/`, `locations/`, `mysteries/` …) to pattern-match.
- **Cache invalidation:** creation must call the A2/B6 cache `invalidate()` so rosters/directories include the new entity on the next turn.

**Size: M** for guardrails + log; **M** for the admin dashboard section.

### C6 — The other half: invent less (connection to Workstream D)

Capture handles inventions gracefully; grounding reduces them. Two D items directly serve this: **D2** (put the NPC's own held items + nearby location items into the prompt so "what do you have?" is answered from real inventory instead of confabulated preserves) and **D1/D3** (memory/relationship grounding so NPCs reference real neighbors instead of inventing kin). Don't over-build here — just note that Phase 5 should measure invention rate (grep `ai_entity_log`) before/after the grounding features land.

### Workstream C checklist

- [ ] **C-1 (S)** Migration `019_dynamic_entities.sql`: `source` + `created_by_player_key` columns on citizens/locations/items; `ai_entity_log` table.
- [ ] **C-2 (M)** `src/lib/game/dynamic_entities.ts`: tag regex, payload parser, per-type insert helpers with C3 defaults, dedup wrapper (C4), cap/tone guards (C5).
- [ ] **C-3 (M)** engine.ts `handleConversationMessage`: wire parsing/stripping next to ESCORT/SUMMON (lines ~643–671); response additions (`new_entity` field on `GameResponse` for a soft UI notice, e.g. *"Somewhere in town, a flower stand becomes real."*).
- [ ] **C-4 (S)** dialogue.ts: NEW_* instruction block beside SUMMON (lines ~201–206), including item grounding line (NPC's actual holdings) and tone restatement.
- [ ] **C-5 (M)** Admin dashboard section + `api/admin/ai-entities` route (list/edit/delete AI-generated rows).
- [ ] **C-6 (S)** Cache invalidation hookup (depends on A2/B6 existing) + `ai_entity_log` metrics query for measuring invention rate.

---

## Workstream D — World-class feature gaps (ranked, top 9)

Ranked by impact-per-effort, biased toward "a world that remembers and grows" (reinforcing C) over cosmetics. REVIEW_PROMPT.md Part 2 categories used as the menu; several picks below are from it, two (D2's item grounding, D9 parser pronouns) are additions.

- [ ] **D1 (M) — NPC proactive memory callbacks.** NPCs greet you with what they know: last topic discussed, gossip heard, "you were at the library yesterday." All the data already exists (`player_citizen_conversations.history`, `citizen_gossip` via `getPlayerGossipForNpc`, `player_interactions`) — this is a prompt-assembly feature in `generateNpcDialogue`/`continueConversation`, not a new system. Highest alive-feeling-per-line-of-code in the codebase. Reinforces C: grounded NPCs confabulate less.
- [ ] **D2 (S) — NPCs know what they're holding and what the player is carrying.** Add the speaker's `getCitizenHoldings` list and the player's inventory (names) to the conversation prompt. Kills the #1 item-invention trigger ("what've you got?") and enables "is that Mari's honey you're carrying?" moments. Direct feeder for C6.
- [ ] **D3 (M) — Surface `citizen_relationships`.** The table exists in migration 001, is seeded, and is **referenced nowhere in `src/`** (verified by grep). Add each NPC's own relationships (spouse, rival, friend) to their prompt context + let `recall` show known relationships. NPCs referencing real neighbors instead of inventing kin is both depth and C-grounding.
- [ ] **D4 (S) — Absence acknowledgment.** `player_citizen_conversations.last_talked_at` and `player_location_visits.last_visited` already exist. If > 7 real days since last talk, prepend a prompt line ("it's been a while since you two spoke"). Cheap, warm, memory-forward.
- [ ] **D5 (M) — Gossip about AI-created entities + world-event generation from them.** When C creates an entity, insert a `gossip_items` row ("Word is Clara's set up a flower stand by the market") so the *existing* spread cron (gossip.ts:186–281) propagates awareness to other NPCs organically, and optionally a `world_events` Chronicle row. This is what makes a created entity feel town-real rather than database-real. Depends on Phase 4 (C).
- [ ] **D6 (S) — Ambient location events.** A small `ambient_events` table (or JSON per location) of one-liners keyed by location/time-slot/season, sampled into `look` and `wait` output. Makes `wait` (engine.ts:1505–1539, currently 5 generic lines) and repeat `look`s feel alive. Pure content + one query.
- [ ] **D7 (M) — Time-visible NPC routines.** NPCs mention where they're headed at slot boundaries ("just closing up, off to the Wren & Whistle") using their real `citizen_routines` rows for the *next* slot. Makes schedules — already simulated — perceivable, which teaches players the `find` verb and makes the town feel inhabited.
- [ ] **D8 (M) — First-visit hint fix + newcomer arc.** Fix the A8 bug, then extend: 2–3 scripted beats over the first three locations visited (Marigold's hint already written at engine.ts:405–406 but dead). Onboarding polish that costs little.
- [ ] **D9 (M) — Parser pronoun + follow-up resolution.** "ask her about the recipe" / "where does she live" mid-conversation currently misroutes (parser has no referent memory). Thread `activeCitizenId` into `parseCommand` as a default referent. The most common silent-failure class for parser-IF players.

Deliberately not picked: multiplayer (wrong focus for the design), weather system (cosmetic vs. cost), branching mystery deduction rework (L, own initiative, low synergy with C).

---

## Phase grouping proposal

Each phase ≈ one focused session, 3–6 files, 3–6 checklist items. Order matters: caching (2) before prompt work (3) before entity capture (4), because C invalidates the caches and extends the prompts.

**Phase 2 — Query hygiene & the double round-trip.** Items: A1, A4, A5, A6, A8/D8(bug part). Files: engine.ts, world.ts, player.ts, npc_items.ts, state/route.ts. Gate: answer Open Question 1 first (5-minute DB check). Verification: time a `talk` + 3-message conversation before/after; confirm tutorial hint fires on a fresh save.

**Phase 3 — Claude cost & prompt slimming.** Items: B1, B2, B3, B4, A2, B6 (A2+B6 are one cache module). Files: dialogue.ts, world.ts, gossip.ts, new `src/lib/game/world_cache.ts`. Verification: log `usage.input_tokens` per call before/after; target ≥ 70% reduction on `continueConversation` (≥ 95% if Open Question 1 confirms 930 rows).

**Phase 4 — Dynamic entities (Workstream C core).** Items: C-1, C-2, C-3, C-4, C-6. Files: new migration, new dynamic_entities.ts, engine.ts, dialogue.ts. Needs decisions: Open Questions 2, 3, 4, 5. Verification: scripted conversation transcript that coaxes each tag type; confirm dedup ("tell me about Marigold's aunt" twice → one row); confirm `find`/`go`/`talk` work against the created entity; confirm cap enforcement.

**Phase 5 — Entities become town-real + admin curation.** Items: C-5, D5, D2, D3. Files: AdminDashboard.tsx, new api/admin/ai-entities route, dialogue.ts, gossip.ts. Verification: created entity appears in another NPC's gossip after a cron run; admin can edit/delete it; invention-rate metric from `ai_entity_log` recorded as the baseline.

**Phase 6 — The town that remembers (Workstream D polish).** Items: D1, D4, D6, D7, D9, A3 (state-in-command-response, saved for last because it touches the frontend), remainder of D8. Files: dialogue.ts, engine.ts, parser.ts, page.tsx, state/route.ts (+ content for D6). May split into 6a (memory: D1/D4/D7) and 6b (frontend: A3/D9/D6) if it runs long.

Not scheduled: A7, A9 (fold into any phase with spare room), B5 (bundle with B2), B7 (revisit after Phase 3 metrics).

---

## Sizing legend

**S** < 1 hour focused · **M** ≈ one session · **L** needs its own phase. Nothing in this plan is L except the deliberately-deferred B7-follow-on and the unpicked mystery rework.

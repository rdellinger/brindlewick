# Brindlewick Code & Design Review Prompt

Paste this into a fresh Claude session (or use as an Agent prompt) to get a full review.

---

## Context

You are reviewing **Brindlewick**, a cozy mystery text adventure built on **Next.js 14 App Router + Supabase + TypeScript**, powered by Claude Haiku for NPC dialogue. The game is fully functional. Your job is two-part: (1) find performance and API efficiency problems, and (2) suggest features that would make this feel like a genuinely alive, world-class text adventure.

### Architecture overview

- **`src/lib/game/engine.ts`** (~2800 lines) — core command dispatcher. Every player command (`look`, `go`, `talk`, `ask`, `give`, `take`, `solve`, `wait`, etc.) is handled here. Each handler makes multiple sequential Supabase queries.
- **`src/lib/game/dialogue.ts`** — NPC dialogue generation. Uses `claude-haiku` via the Anthropic API. Has two entry points: `generateNpcDialogue` (for initial greetings and `ask` commands) and `continueConversation` (for ongoing back-and-forth). The system prompt includes world context, citizen personality, lore, nearby residents, a full town location directory with business hours, escort/summon tags, and gossip the NPC knows about the player.
- **`src/lib/game/world.ts`** (~670 lines) — DB read helpers: `getItemsAtLocation`, `getCitizensAtLocation`, `getDialogueForCitizen`, `getLoreForCitizen`, `findCitizenByName`, `getTownRoster`, etc.
- **`src/lib/game/parser.ts`** — regex/keyword parser that maps raw text input to `CommandIntent` objects.
- **`src/lib/game/player.ts`** — save/load game state, trust levels, conversation history, inventory, visit tracking.
- **`src/lib/game/npc_items.ts`** (~600 lines) — NPC item holdings, citizen-item behaviors (world_tick, on_ask, on_talk triggers), behavior log.
- **`src/app/api/game/command/route.ts`** — POST endpoint that runs the engine. No caching. Called on every player command.
- **`src/app/api/game/state/route.ts`** (~230 lines) — GET endpoint that builds the full sidebar state: current location, exits, items, citizens present, player inventory, active tasks, trust levels. Called after every command to refresh the UI. Also makes several sequential Supabase queries.
- **`src/lib/realtime.ts`** — computes current Eastern Time, season, time slot, and business hours status from real wall-clock time (no DB dependency).
- **`src/lib/game/gossip.ts`** — detects personal facts in player messages and stores them in a per-player gossip table; NPCs can reference this in dialogue.
- **`src/lib/game/mysteries.ts`** — clue unlocking, puzzle evaluation, solve-attempt handling.
- **`src/types/game.ts`** — shared TypeScript types: `GameSession`, `Citizen`, `Item`, `Location`, `CommandIntent`, `GameResponse`, `ConversationMessage`, etc.

### Key data flows to understand

**Every player command triggers this sequence:**
1. POST `/api/game/command` → parse intent → route to handler in `engine.ts`
2. Each handler makes 3–12 sequential Supabase queries (no batching, no caching)
3. Dialogue handlers call Claude Haiku (adds 500–1500ms)
4. Response returned to client
5. Client immediately fires GET `/api/game/state` to refresh sidebar (another 5–8 Supabase queries)

**Claude API usage per player session:**
- `talk [citizen]` → 1 Haiku call (greeting)
- Each conversation message → 1 Haiku call
- `ask [citizen] about [topic]` → 1 Haiku call
- `give [item] to [citizen]` (no scripted reaction) → 1 Haiku call
- Gossip detection (`detectAndStorePlayerFact`) → 1 Haiku call on EVERY conversation message to look for facts

**System prompt size for `continueConversation`:**
The system prompt includes: town context + world context (time/season/hours) + citizen personality/backstory/lore + motive context + list of nearby citizens + full town roster (~35 people with name/occupation/personality) + escort location map (~69 locations) + full location directory with hours (~69 entries) + summon-capable citizens list + gossip facts. This is large and sent on every single conversation turn.

### What to read

Read these files in full before giving your analysis:
- `src/lib/game/engine.ts`
- `src/lib/game/dialogue.ts`
- `src/lib/game/world.ts`
- `src/app/api/game/command/route.ts`
- `src/app/api/game/state/route.ts`
- `src/lib/game/player.ts`
- `src/lib/game/npc_items.ts`
- `src/lib/game/gossip.ts`
- `src/types/game.ts`

Also skim for context:
- `content/citizens.json` — all 35 NPCs with personality, backstory, occupation, household
- `content/locations.json` — all 69 locations with descriptions, exits, business hours
- `content/help_tasks.json` — the cooperative tasks players can take on
- `content/mysteries.json` — the mystery puzzle structure

---

## Part 1: Performance & API Efficiency Review

Audit the codebase for performance problems and unnecessary Claude API spending. For each issue found, give: (a) what the problem is, (b) where exactly it is (file + line range or function name), (c) a concrete fix with code.

Specific things to look for:

**Supabase query patterns**
- Sequential awaits that could be `Promise.all`
- Repeated fetches of the same data within a single request (e.g., fetching town roster in both engine.ts and dialogue.ts)
- The state route running 5–8 queries every time; can any be combined or cached?
- Any N+1 patterns (fetching one thing, then looping to fetch more)
- The `allLocations` query in `handleConversationMessage` fetches all 69 locations on every chat message — is there a smarter approach?

**Claude API call reduction**
- `detectAndStorePlayerFact` in `gossip.ts` makes a Claude call on every single conversation message. Assess whether this is worth it and suggest alternatives (keyword heuristics, batching, call-less detection).
- The full town roster (35 NPCs) and full location directory (69 locations with hours) are included in every `continueConversation` system prompt. Does the NPC actually need all 35 people and all 69 locations on every turn? Suggest a smarter context window strategy.
- Are there cases where scripted dialogue could replace a Claude call (scripted dialogue already exists in the DB but is only used 70% of the time by design)?
- `generateNpcDialogue` fetches lore from DB even when it ends up making a Claude call anyway. Is the lore worth the extra query at the haiku cost level?
- Assess token usage: estimate the system prompt token count for a typical `continueConversation` call and identify what's worth trimming vs. what earns its tokens.

**Frontend/API boundary**
- The client fires `GET /state` after every command. Does it need to? Could the command response include the full updated state so only one round-trip is needed?
- Any unnecessary re-renders or state refreshes in `game/page.tsx`?

**Caching opportunities**
- What could be cached in memory (in-process, per-request, or Edge KV) with minimal staleness risk? (Town roster, location list, lore, scripted dialogue, citizen data all change infrequently.)
- Is there a reasonable approach using Next.js `unstable_cache` or route segment config?

---

## Part 2: World-Class Feature Suggestions

This is a cozy mystery text adventure. "World class" means: the world feels genuinely alive, time passes meaningfully, NPCs feel like real people with real lives, and the player feels like a resident rather than a tourist. The mystery should feel organic, not puzzle-box.

Review the current feature set and suggest improvements or new features across these dimensions. For each suggestion, explain: (a) what it is, (b) why it would make the game feel more alive, (c) a rough implementation sketch (what DB changes, engine changes, or content changes it would require).

**NPC depth and memory**
- NPCs currently track trust level and can recall prior conversation history (stored per player per citizen). What's missing from making them feel like real people?
- NPCs know gossip about the player (facts detected from conversation). Is the gossip system being used well? What would make it more impactful?
- Should NPCs proactively bring things up when the player visits (e.g., "I heard you were at the library yesterday")? How would you implement this?
- NPCs currently don't react to what the player is carrying. Should they?
- What would "NPC relationships with each other" look like — not just toward the player?

**World liveness and time**
- The world has real-time clock (ET), seasons, business hours, and a cron job that advances world state. What's not being done with time that should be?
- Should the player's absence matter? If you don't visit the bakery for a week, should Marigold mention it?
- Are there other time-based events that would make the world feel alive (weekly market, seasonal festivals, NPC routines that visibly change)?
- The `waiting` mechanic exists — does it do enough? What would make waiting feel meaningful?

**Player agency and discovery**
- What discovery mechanics are missing? (Hidden locations, things that are only visible at certain times, things that only reveal themselves after enough visits)
- The mystery system is clue-gated. Does it feel too linear? What would make it feel more like real detective work?
- What would make the player feel like they're building a real life in the town vs. just completing tasks?

**Narrative and atmosphere**
- What's missing from the text output that would make reading it feel like reading a good novel rather than a game?
- Should there be ambient events — things that just happen without the player doing anything (a dog barks outside, the bell tower rings, someone walks by)?
- Is there a journal or log the player should keep vs. the current Chronicle tab?

**Multiplayer or social layer**
- Is there any concept worth exploring around multiple players in the same world, or is single-player the right focus?

**Polish and feel**
- What small quality-of-life things would a player coming from modern interactive fiction (Twine, Ink, parser IF) expect that Brindlewick is currently missing?
- Is the command parser robust enough? What common player inputs probably fail silently right now?

---

## Deliverable format

Structure your response as:

### Part 1: Performance & API Issues
For each issue: **Issue title**, description, location, fix.
Order by impact (highest first). Aim for 8–15 distinct issues.

### Part 2: Feature Suggestions
For each suggestion: **Feature title**, why it matters, rough implementation sketch.
Group by theme. Aim for 10–20 suggestions, ranging from quick wins to bigger ideas.

Be specific and opinionated. Don't hedge — if something is clearly wasteful or clearly missing, say so directly.

# Brindlewick — Deployment Guide

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [Vercel](https://vercel.com) account
- An [Anthropic API key](https://console.anthropic.com)

---

## 1. Supabase Setup

### Create the project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a region close to your users
3. Note the project URL and anon key (Project Settings → API)
4. Note the service role key (keep this secret — server use only)

### Run the schema migration

In the Supabase dashboard → SQL Editor, paste and run the contents of:

```
supabase/migrations/001_initial_schema.sql
```

This creates all tables, indexes, RLS policies, and helper functions.

### Verify tables exist

After running the migration, you should see these tables in Table Editor:
- `world_state`, `locations`, `location_exits`
- `citizens`, `items`, `mysteries`, `mystery_clues`
- `calendar_events`, `research_subjects`, `research_results`
- `town_history`
- `player_saves`, `guest_saves`, `player_citizen_trust`
- `player_mystery_progress`, `journal_entries`, `command_log`
- `location_visit_analytics`

---

## 2. Seed the Database

In the project folder, there's a file called `.env.example` — it's a template that lists all the environment variables the app needs, with placeholder values. You need to make a copy of it named `.env.local` and fill in your real credentials. In Terminal, navigate to the project folder first, then copy the file:

```bash
cd /Users/richdellinger/Documents/Claude/Projects/Brindlewick
cp .env.example .env.local
```

Then open `.env.local` in any text editor and replace the placeholder values with your actual Supabase URLs, API keys, etc. (see section 4 for what each one means). The `.env.local` file is gitignored — it stays on your machine and never gets committed to GitHub.

Then run:

```bash
npm install
npm run generate-citizens   # generates content/citizens/supporting.json (893 citizens)
npm run seed                # loads all content into Supabase
```

The seed script is idempotent — safe to re-run.

Expected output:
```
✓ world_state: 1 row
✓ locations: 57 rows
✓ location_exits: ~120 rows
✓ citizens (principal): 33 rows
✓ citizens (supporting): 893 rows
✓ mysteries: 8 rows
✓ mystery_clues: ~35 rows
✓ items: 20 rows
✓ calendar_events: 14 rows
✓ research_subjects: 10 rows
✓ research_results: ~30 rows
✓ town_history: 25 rows
```

---

## 3. Push to GitHub

Vercel deploys from GitHub, so you need to push the project there first.

### Create a GitHub account (if you don't have one)

Go to [github.com](https://github.com) and sign up for a free account.

### Create a new repository

1. Once logged in, click the **+** icon in the top right → **New repository**
2. Name it `brindlewick` (or whatever you like)
3. Leave it set to **Private** (recommended)
4. Do NOT check "Add a README" or any other initialization options — the project already has its own files
5. Click **Create repository**

### Push the project from Terminal

GitHub will show you setup instructions after creating the repo. Use the "push an existing repository" option. In Terminal:

```bash
cd /Users/richdellinger/Documents/Claude/Projects/Brindlewick
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/brindlewick.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username. GitHub will ask for your username and password the first time — use a [Personal Access Token](https://github.com/settings/tokens) as your password (GitHub no longer accepts regular passwords for command-line pushes).

After this, every time you make code changes and want them live, run:

```bash
git add .
git commit -m "describe what you changed"
git push
```

Vercel picks up the push automatically and redeploys within about 60 seconds.

---

## 4. Vercel Setup

### Create a Vercel account (if you don't have one)

Go to [vercel.com](https://vercel.com) and sign up — the free "Hobby" plan is sufficient.

### Import the project

1. From the Vercel dashboard, click **Add New** → **Project**
2. Click **Continue with GitHub** and authorize Vercel to access your repositories
3. Find your `brindlewick` repo in the list and click **Import**
4. Vercel will detect it as a Next.js project automatically — leave all settings as-is
5. Click **Deploy**

The first deploy will likely fail with an error about missing environment variables — that's expected. Continue to the next step.

### Configure environment variables

1. Go to your project in the Vercel dashboard
2. Click **Settings** → **Environment Variables**
3. Add each variable below by typing the name, pasting the value, and clicking **Add**:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key (click Reveal) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `ANTHROPIC_MODEL` | Type exactly: `claude-haiku-4-5-20251001` |
| `ADMIN_SECRET` | Make up any long password — you'll use this to log into /admin |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL — you'll see this after the first deploy (e.g. `https://brindlewick.vercel.app`) |
| `CRON_SECRET` | Make up any random string — used to secure the daily world-tick job |

For `NEXT_PUBLIC_APP_URL`: if you don't know your URL yet, add it after the first successful deploy.

### Redeploy after adding env vars

1. Click **Deployments** in the left sidebar
2. Find the most recent deployment, click the **⋯** menu on the right
3. Click **Redeploy**

The app should now deploy successfully. Click **Visit** to open it.

### Verify the cron job

The game world advances one day every night at midnight UTC via an automated job. To confirm it's set up:

1. Go to your Vercel project → **Settings** → **Cron Jobs**
2. You should see: `/api/cron/advance-world` running on schedule `0 0 * * *`

To test it manually (optional):

```bash
curl -X POST https://your-app.vercel.app/api/cron/advance-world \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Replace `your-app.vercel.app` with your actual URL and `YOUR_CRON_SECRET` with the value you set.

---

## 4. Environment Variables Reference

```bash
# .env.local

# Supabase — public (safe to expose in browser)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Supabase — secret (server only, never expose)
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Admin panel password
ADMIN_SECRET=choose-something-strong

# App URL (no trailing slash)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Cron job secret (Vercel sets this as Authorization: Bearer <secret>)
CRON_SECRET=random-secret-string
```

---

## 5. Admin Panel

Visit `/admin` on your deployed app (or `localhost:3000/admin` locally).

Enter the `ADMIN_SECRET` password to access the dashboard.

**What's available:**
- **Overview** — citizen/location/mystery counts, active players, total commands
- **Citizens** — browse all 943 citizens, search by name, edit occupation/backstory
- **Locations** — read-only list of all locations with type and area
- **Mysteries** — list with player engagement stats (started vs. resolved)
- **Calendar** — list of all annual, weekly, and monthly events
- **World Clock** — view current game date/season, manually advance by 1 day (for testing), or jump to a specific date
- **Analytics** — most visited locations, least discovered mysteries

---

## 6. Making Updates After Deployment

There are four categories of update. Most things you'll want to change fall into the first two — no code deployment needed.

---

### Category A: Content changes — edit JSON, re-run seed (no redeploy)

All town content lives in `/content/`. Edit the relevant file and run:

```bash
npx tsx scripts/seed.ts
```

The seed script uses `upsert` — it's safe to run against a live database at any time. Player saves and journals are never touched.

**Add or edit a location**
- File: `content/locations.json`
- Add the location object. Add its id to the `exits` arrays of neighboring locations.
- Fields: `id`, `name`, `type`, `area`, `short_desc`, `long_desc`, and optional `seasonal_variant_*`, `time_variant_*`, `mystery_tie`, `history_text`

**Add or edit a principal citizen**
- File: `content/citizens/principal.json`
- Key fields: `id`, `name`, `age`, `occupation`, `personality`, `backstory`, `trust_stages` (object keyed 1–4), `dialogue_topics` (object keyed by topic string), `mystery_ties` (array of mystery ids)
- The `dialogue_topics` keys are what players can type after `ask [name] about` — add as many as you like
- For dynamic dialogue, Claude haiku generates responses using the citizen's personality + backstory automatically — no extra wiring needed

**Add or edit a mystery**
- File: `content/mysteries.json`
- Add a mystery with a `clues` array. Each clue needs a `description` and at least one of `location_id`, `citizen_id`, `item_id`
- Simple clues (find an item, talk to a citizen) work automatically. Clues requiring special interactions (e.g. using an item on a specific citizen) need a case added in `src/lib/game/engine.ts`

**Add or edit an item**
- File: `content/items.json`
- Fields: `id`, `name`, `type`, `location_id`, `description`, `can_take`, `lore_note`, `readable_content`, `mystery_tie`

**Edit a calendar event or add a seasonal event**
- File: `content/calendar.json`
- Annual events use `month` + `day`. Weekly events use `day_of_week`. Add `ambient_changes` keyed by timing (`"3_days_before"`, `"day_of"`, etc.)

**Add research entries (library)**
- File: `content/research.json`
- Each subject has a `results` array. Results appear when a player types `research [topic]` in the library

---

### Category B: Historical content — edit seed.ts, re-run seed (no redeploy)

Time travel content is seeded directly from functions in `scripts/seed.ts` rather than JSON files. Open the file and edit the relevant function, then re-run the seed.

**Add a historical citizen** — edit `seedHistoricalCitizens()`

Each historical citizen needs:
- `id`, `time_period_id` (one of: `pre_founding`, `founding`, `early_settlement`, `gilded`, `early_modern`, `mid_century`, `contemporary`)
- `first_name`, `last_name`, `birth_year`, `death_year`, `occupation`
- `home_location` — location id where they appear when the player visits that era
- `appearance`, `personality`
- `dialogue_topics` — a JSON object keyed by topic, value is an array of dialogue strings the engine picks randomly from

**Add a historical location description** — edit `seedHistoricalLocations()`

Each entry pairs a `location_id` with a `time_period_id` and provides:
- `description` — what the player sees when they look around here in this era
- `seasonal_notes` (optional)
- `special_note` — shown in italics after the description; use for "Cornelius is here overseeing something" type callouts

**Add a historical item** — edit `seedHistoricalItems()`

Historical items appear in a specific location during a specific era. Fields: `id`, `name`, `description`, `location_id`, `time_period_id`, `lore_note`, `mystery_tie`, `reveals_clue`. If `reveals_clue` is set, examining the item records a temporal change and triggers a mystery clue.

**Add or edit a time period** — edit `seedTimePeriods()`

Time periods are the seven eras. You'd rarely add one, but you can edit `description`, `atmosphere`, and `population_desc` to tune what the narrator says when the player arrives in an era.

---

### Category C: Schema changes — write a migration, run in Supabase

If you need a new table, column, or index:

1. Create `supabase/migrations/006_your_change.sql`
2. Paste it into **Supabase Dashboard → SQL Editor** and run it
3. Update `src/types/game.ts` if the change affects TypeScript interfaces
4. Update `src/lib/game/player.ts` if it affects what gets loaded into `GameSession`

Schema changes don't require a Vercel redeploy — the schema is in the database, not in the app code.

---

### Category D: Game logic changes — edit code, push to GitHub (auto-deploys)

Push any code change to your GitHub repo and Vercel redeploys automatically within ~60 seconds.

**Add a new command or tweak how an existing one works**
- Parser patterns: `src/lib/game/parser.ts` — add a new `INTENT_PATTERNS` entry or adjust a regex
- Command handler: `src/lib/game/engine.ts` — add a new `case` in the dispatcher and write the handler function
- New command intent: also add it to the `CommandIntent` union in `src/types/game.ts`

**Change NPC dialogue behavior**
- `src/lib/game/dialogue.ts` — the system prompt sent to Claude haiku for dynamic NPC responses
- `src/lib/game/engine.ts` — trust milestone messages, quest chain logic (e.g. Eleanor's Chrono-Logbook quest is in `handleEleanorQuestProgress`)

**Change time travel behavior**
- `src/lib/game/temporal.ts` — era resolution, date parsing, what counts as a valid travel target
- `src/lib/game/engine.ts` — `handleTravel`, `handleReturnPresent`, what triggers a `temporal_change` record

**Change the sidebar or frontend**
- `src/components/game/Sidebar.tsx` — sidebar tabs, what's clickable, what the time travel indicator looks like
- `src/app/game/page.tsx` — header, hint bar, state reloading logic

---

### Quick reference

| What you want to change | Where | Redeploy? |
|---|---|---|
| NPC dialogue, personality, backstory | `content/citizens/principal.json` + seed | No |
| Location descriptions, exits | `content/locations.json` + seed | No |
| Items, readable content | `content/items.json` + seed | No |
| Mystery clues | `content/mysteries.json` + seed | No |
| Historical citizens | `scripts/seed.ts` → `seedHistoricalCitizens()` + seed | No |
| Historical location descriptions | `scripts/seed.ts` → `seedHistoricalLocations()` + seed | No |
| Historical items | `scripts/seed.ts` → `seedHistoricalItems()` + seed | No |
| New database table or column | New migration file + Supabase SQL Editor | No |
| New command | `parser.ts` + `engine.ts` + `types/game.ts` | Yes |
| Quest chain logic | `engine.ts` | Yes |
| Time travel behavior | `temporal.ts` + `engine.ts` | Yes |
| Frontend / sidebar | `page.tsx` + `Sidebar.tsx` | Yes |

---

### Add a new location

1. Add an entry to `content/locations.json` with all required fields
2. Add exits from/to neighboring locations in the same file
3. Re-run `npm run seed`
4. The location is immediately live — no code changes needed

### Add a new principal citizen

1. Add an entry to `content/citizens/principal.json`
2. Give them: id, name, age, gender, occupation, address, personality, backstory, trust_stages (0–4), routine, dialogue_topics, mystery_ties
3. Re-run `npm run seed`

### Add a new mystery

1. Add an entry to `content/mysteries.json` with clues array
2. Each clue needs: id, description, and at least one of location_id / citizen_id / item_id
3. Wire clue triggers in `src/lib/game/engine.ts` if the clue needs special handling (e.g., use item, trust gate)
4. Re-run `npm run seed`

### Add a calendar event

1. Add to `content/calendar.json`
2. Provide `ambient_changes` keyed by timing (e.g., `"3_days_before"`, `"day_of"`)
3. Re-run `npm run seed`

### Edit a citizen's dialogue

Citizens have `dialogue_topics` in the JSON. Each key is a topic the player can `ask <citizen> about <topic>`. Add or edit entries, then re-run `npm run seed`.

For richer dynamic dialogue, the game falls back to Claude haiku using the citizen's personality + backstory — no extra work needed.

---

## 7. Rollback Procedure

### If a bad seed corrupts world content

All world tables (citizens, locations, etc.) use `upsert` with `onConflict: 'id'` — fix the JSON and re-run `npm run seed`. Player data tables are never touched by the seed script.

### If a bad migration breaks the schema

1. In Supabase SQL Editor, run your rollback SQL
2. Or restore from the automatic daily backup (Supabase Dashboard → Backups)

### If a Vercel deployment breaks

Vercel → Deployments → click any previous deployment → **Promote to Production**.

---

## 8. Local Development

```bash
npm install
cp .env.example .env.local
# fill in .env.local

npm run dev
# → http://localhost:3000
```

The game is fully playable locally against your Supabase project. The cron job must be triggered manually locally:

```bash
curl -X POST http://localhost:3000/api/cron/advance-world \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Or use the World Clock panel at `/admin`.

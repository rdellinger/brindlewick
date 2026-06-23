-- ============================================================
-- Brindlewick Text Adventure — Database Schema
-- Migration 001: Initial Schema
-- ============================================================

-- Enable necessary extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- for fuzzy text search

-- ============================================================
-- WORLD STATE
-- ============================================================

-- Tracks the current in-game date and world state
create table world_state (
  id              integer primary key default 1 check (id = 1), -- singleton row
  game_date       date not null default current_date,
  game_season     text not null default 'spring' check (game_season in ('spring','summer','autumn','winter')),
  day_of_week     text not null default 'monday',
  time_scale      text not null default '1:1',  -- real_day:game_day ratio
  last_tick_at    timestamptz not null default now(),
  notes           text  -- admin notes about world state
);

-- Seed the singleton
insert into world_state (game_date, game_season) values (current_date, 'spring');

-- ============================================================
-- LOCATIONS
-- ============================================================

create table locations (
  id              text primary key,         -- e.g. 'town_square'
  name            text not null,
  type            text not null,            -- civic, commercial, outdoor, hidden, street, etc.
  area            text,                     -- center, lakefront, mountain, outskirts, etc.
  short_desc      text not null,
  long_desc       text not null,
  history_text    text,
  is_hidden       boolean default false,
  unlock_condition text,                    -- JSON expression evaluated server-side
  boat_required   boolean default false,
  is_locked       boolean default false,
  seasonal_variant_spring  text,
  seasonal_variant_summer  text,
  seasonal_variant_autumn  text,
  seasonal_variant_winter  text,
  time_variant_morning     text,
  time_variant_afternoon   text,
  time_variant_evening     text,
  time_variant_night       text,
  mystery_tie     text,                     -- mystery id
  research_available boolean default false,
  created_at      timestamptz default now()
);

-- Location exits (many-to-many)
create table location_exits (
  id          uuid primary key default uuid_generate_v4(),
  from_loc    text not null references locations(id) on delete cascade,
  to_loc      text not null references locations(id) on delete cascade,
  label       text,                         -- optional directional hint
  blocked     boolean default false,
  unique(from_loc, to_loc)
);

-- ============================================================
-- CITIZENS
-- ============================================================

create table citizens (
  id              text primary key,
  first_name      text not null,
  last_name       text not null,
  nickname        text,
  age             integer,
  gender          text,
  occupation      text,
  address         text,
  home_location   text references locations(id),
  work_location   text references locations(id),
  tier            text not null default 'supporting'
                    check (tier in ('principal','supporting')),
  -- Personality & appearance
  personality     text,
  appearance      text,
  backstory       text,
  -- Trust system
  trust_max       integer default 3,
  -- Flags
  is_mystery_related boolean default false,
  secret          text,                     -- private note for game engine, not shown to players
  -- Metadata
  created_at      timestamptz default now()
);

-- Citizen-to-citizen relationships
create table citizen_relationships (
  id            uuid primary key default uuid_generate_v4(),
  citizen_a     text not null references citizens(id) on delete cascade,
  citizen_b     text not null references citizens(id) on delete cascade,
  relationship  text not null,             -- 'spouse','sibling','parent','friend','friendly_rival','colleague'
  description   text,
  unique(citizen_a, citizen_b)
);

-- Citizen household membership
create table citizen_households (
  id          uuid primary key default uuid_generate_v4(),
  citizen_id  text not null references citizens(id) on delete cascade,
  address     text not null,
  is_head     boolean default false
);

-- Citizen routines: where they are at each time slot
create table citizen_routines (
  id            uuid primary key default uuid_generate_v4(),
  citizen_id    text not null references citizens(id) on delete cascade,
  day_of_week   text not null check (day_of_week in
                  ('monday','tuesday','wednesday','thursday','friday','saturday','sunday','weekday','weekend')),
  time_slot     text not null check (time_slot in
                  ('early_morning','morning','midday','afternoon','evening','night')),
  location_id   text references locations(id),
  location_note text,                       -- e.g. 'current job site (varies)'
  unique(citizen_id, day_of_week, time_slot)
);

-- Citizen dialogue topics
create table citizen_dialogue (
  id          uuid primary key default uuid_generate_v4(),
  citizen_id  text not null references citizens(id) on delete cascade,
  topic       text not null,               -- 'greeting', 'town_history', specific mystery, etc.
  content     text not null,              -- The dialogue text
  min_trust   integer default 0,          -- required trust level
  mystery_tie text,                        -- advances this mystery
  once_only   boolean default false,       -- disappears after first delivery
  created_at  timestamptz default now()
);

-- Citizen lore facts (one-line shareable facts)
create table citizen_lore (
  id          uuid primary key default uuid_generate_v4(),
  citizen_id  text not null references citizens(id) on delete cascade,
  lore_text   text not null,
  gossip_text text,                        -- version phrased as gossip
  mystery_tie text,
  min_trust   integer default 0
);

-- ============================================================
-- MYSTERY SYSTEM
-- ============================================================

create table mysteries (
  id          text primary key,
  title       text not null,
  depth       text not null check (depth in ('shallow','medium','deep','easter_egg')),
  discovery_hint text,
  summary     text,
  solution    text,
  is_easter_egg boolean default false,
  resolution_text text,
  reward_type text,
  reward_description text,
  created_at  timestamptz default now()
);

create table mystery_clues (
  id            uuid primary key default uuid_generate_v4(),
  mystery_id    text not null references mysteries(id) on delete cascade,
  clue_order    integer not null default 0,
  description   text not null,
  source        text,                      -- location or citizen id where found
  requires_condition text,                 -- unlock condition
  is_hidden     boolean default false
);

-- ============================================================
-- HELP TASKS (small wholesome quests)
-- ============================================================

create table help_tasks (
  id              text primary key,
  giver_citizen   text references citizens(id),
  title           text not null,
  description     text not null,
  reward_lore     text,
  trust_gain      integer default 1,
  mystery_reveals text references mysteries(id),
  location_req    text references locations(id),  -- must be at this location to trigger
  unlock_condition text,
  is_tutorial     boolean default false,
  created_at      timestamptz default now()
);

-- ============================================================
-- ITEMS
-- ============================================================

create table items (
  id              text primary key,
  name            text not null,
  type            text not null,           -- readable, examine, clue_item, inventory, research_interface
  location_id     text references locations(id),
  description     text not null,
  can_take        boolean default false,
  lore_note       text,
  readable_content text,                   -- full text if readable
  mystery_tie     text references mysteries(id),
  mystery_tie_2   text references mysteries(id),
  requires_condition text,
  created_at      timestamptz default now()
);

-- ============================================================
-- CALENDAR / EVENTS
-- ============================================================

create table calendar_events (
  id              text primary key,
  name            text not null,
  event_type      text not null check (event_type in ('annual','weekly','monthly','triggered')),
  month           integer,                 -- 1-12, null for triggered events
  day             integer,                 -- day of month, null if week-based
  week_of_month   integer,                 -- 1-4, null if day-based
  day_of_week     text,                    -- for weekly/annual-by-day events
  duration_days   integer default 1,
  description     text not null,
  setup_days_before integer default 0,
  mystery_tie     text references mysteries(id),
  seasonal_restriction text,              -- 'summer','autumn', etc. null = all seasons
  trigger_condition text,                 -- for triggered events like first snow
  created_at      timestamptz default now()
);

-- Ambient world changes tied to event proximity
create table event_ambient_changes (
  id          uuid primary key default uuid_generate_v4(),
  event_id    text not null references calendar_events(id) on delete cascade,
  days_before integer not null,           -- negative = days after
  change_text text not null,
  location_id text references locations(id)
);

-- ============================================================
-- RESEARCH SYSTEM
-- ============================================================

create table research_subjects (
  id          uuid primary key default uuid_generate_v4(),
  subject     text not null,
  created_at  timestamptz default now()
);

create table research_results (
  id              uuid primary key default uuid_generate_v4(),
  subject_id      uuid not null references research_subjects(id) on delete cascade,
  title           text not null,
  source_label    text,
  content         text not null,
  mystery_tie     text references mysteries(id),
  requires_condition text,               -- e.g. 'eleanor_trust >= 2'
  sort_order      integer default 0
);

-- ============================================================
-- PLAYER SYSTEM
-- ============================================================

-- Player accounts (maps to Supabase auth.users)
create table player_profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  created_at      timestamptz default now(),
  last_active     timestamptz default now()
);

-- Player save state (one active save per player)
create table player_saves (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid not null references player_profiles(id) on delete cascade,
  current_location text not null references locations(id) default 'town_square',
  -- Inventory: array of item IDs the player is carrying
  inventory       text[] default '{}',
  -- Guest support: null player_id means anonymous session
  session_token   text,                   -- for guest saves
  game_date_when_saved date,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(player_id)
);

-- Guest saves (linked by session token, no auth required)
create table guest_saves (
  id              uuid primary key default uuid_generate_v4(),
  session_token   text not null unique,
  current_location text not null references locations(id) default 'town_square',
  inventory       text[] default '{}',
  data            jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  expires_at      timestamptz default (now() + interval '30 days')
);

-- Player-citizen relationship levels
create table player_citizen_trust (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete cascade,
  guest_token     text,                   -- for guest sessions
  citizen_id      text not null references citizens(id) on delete cascade,
  trust_level     integer not null default 0,
  first_met_at    timestamptz default now(),
  last_interaction timestamptz default now(),
  check (player_id is not null or guest_token is not null)
);

-- Player mystery progress
create table player_mystery_progress (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete cascade,
  guest_token     text,
  mystery_id      text not null references mysteries(id) on delete cascade,
  clues_found     text[] default '{}',    -- array of mystery_clue IDs
  is_resolved     boolean default false,
  resolved_at     timestamptz,
  check (player_id is not null or guest_token is not null)
);

-- Player help task progress
create table player_task_progress (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete cascade,
  guest_token     text,
  task_id         text not null references help_tasks(id) on delete cascade,
  status          text not null default 'available'
                    check (status in ('available','in_progress','completed')),
  started_at      timestamptz,
  completed_at    timestamptz,
  check (player_id is not null or guest_token is not null)
);

-- Player journal: auto-logged entries
create table player_journal (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete cascade,
  guest_token     text,
  entry_type      text not null check (entry_type in
                    ('location_visited','citizen_met','lore_discovered',
                     'mystery_clue','task_completed','event_witnessed',
                     'item_found','note')),
  title           text not null,
  content         text not null,
  related_id      text,                   -- citizen_id, mystery_id, location_id, etc.
  game_date       date,
  created_at      timestamptz default now(),
  check (player_id is not null or guest_token is not null)
);

-- Player location visit history (for analytics and journal)
create table player_location_visits (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete cascade,
  guest_token     text,
  location_id     text not null references locations(id) on delete cascade,
  visit_count     integer default 1,
  first_visited   timestamptz default now(),
  last_visited    timestamptz default now(),
  unique(player_id, location_id),
  check (player_id is not null or guest_token is not null)
);

-- ============================================================
-- COMMAND LOG (for analytics and replay)
-- ============================================================

create table command_log (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete set null,
  guest_token     text,
  raw_input       text not null,
  parsed_intent   text,                   -- what the parser determined
  parsed_args     jsonb,
  location_at     text references locations(id),
  success         boolean,
  response_text   text,
  created_at      timestamptz default now()
);

-- ============================================================
-- ANALYTICS (anonymized aggregates — no PII)
-- ============================================================

create table analytics_location_popularity (
  location_id   text primary key references locations(id),
  total_visits  bigint default 0,
  unique_visitors bigint default 0,
  updated_at    timestamptz default now()
);

create table analytics_mystery_progress (
  mystery_id    text primary key references mysteries(id),
  players_started bigint default 0,
  players_resolved bigint default 0,
  avg_clues_before_resolution float,
  updated_at    timestamptz default now()
);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

alter table player_profiles enable row level security;
alter table player_saves enable row level security;
alter table player_citizen_trust enable row level security;
alter table player_mystery_progress enable row level security;
alter table player_task_progress enable row level security;
alter table player_journal enable row level security;
alter table player_location_visits enable row level security;

-- Players can only see/modify their own data
create policy "Players access own profile"
  on player_profiles for all using (auth.uid() = id);

create policy "Players access own save"
  on player_saves for all using (auth.uid() = player_id);

create policy "Players access own trust"
  on player_citizen_trust for all using (auth.uid() = player_id);

create policy "Players access own mystery progress"
  on player_mystery_progress for all using (auth.uid() = player_id);

create policy "Players access own task progress"
  on player_task_progress for all using (auth.uid() = player_id);

create policy "Players access own journal"
  on player_journal for all using (auth.uid() = player_id);

create policy "Players access own visits"
  on player_location_visits for all using (auth.uid() = player_id);

-- World data is publicly readable (no auth required to play)
create policy "World data is public"
  on locations for select using (true);

create policy "Citizens are public"
  on citizens for select using (true);

create policy "Mysteries are public"
  on mysteries for select using (true);

create policy "Items are public"
  on items for select using (true);

create policy "Calendar is public"
  on calendar_events for select using (true);

create policy "Research is public"
  on research_subjects for select using (true);

create policy "Research results are public"
  on research_results for select using (true);

-- Guest saves are accessible by session token (enforced in API layer)
-- No RLS on guest_saves — enforced at the API route level

-- ============================================================
-- ADMIN ROLE
-- ============================================================

-- Admin access is managed via Supabase service role key in API routes.
-- The /admin routes use the service role key which bypasses RLS.
-- No separate admin table needed — admin identity is the Supabase service key holder.

-- ============================================================
-- INDEXES
-- ============================================================

-- Location exits
create index idx_location_exits_from on location_exits(from_loc);
create index idx_location_exits_to on location_exits(to_loc);

-- Citizen lookups
create index idx_citizens_tier on citizens(tier);
create index idx_citizens_name on citizens using gin(to_tsvector('english', first_name || ' ' || last_name));

-- Citizen dialogue
create index idx_dialogue_citizen on citizen_dialogue(citizen_id);
create index idx_dialogue_topic on citizen_dialogue(topic);

-- Citizen routines
create index idx_routines_citizen on citizen_routines(citizen_id);
create index idx_routines_day_time on citizen_routines(day_of_week, time_slot);

-- Player data
create index idx_trust_player on player_citizen_trust(player_id);
create index idx_trust_citizen on player_citizen_trust(citizen_id);
create index idx_mystery_player on player_mystery_progress(player_id);
create index idx_journal_player on player_journal(player_id);
create index idx_journal_type on player_journal(entry_type);
create index idx_visits_player on player_location_visits(player_id);
create index idx_command_log_player on command_log(player_id);
create index idx_command_log_created on command_log(created_at);

-- Research full-text search
create index idx_research_subjects_text on research_subjects using gin(to_tsvector('english', subject));
create index idx_research_results_text on research_results using gin(to_tsvector('english', title || ' ' || content));

-- Guest saves
create index idx_guest_saves_token on guest_saves(session_token);
create index idx_guest_saves_expires on guest_saves(expires_at);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get current location of a citizen based on game time
create or replace function get_citizen_location(
  p_citizen_id text,
  p_game_date date default current_date,
  p_time_slot text default 'morning'
) returns text as $$
declare
  v_day_of_week text;
  v_location text;
begin
  v_day_of_week := lower(to_char(p_game_date, 'day'));
  v_day_of_week := trim(v_day_of_week);

  -- Try exact day match first
  select location_id into v_location
  from citizen_routines
  where citizen_id = p_citizen_id
    and day_of_week = v_day_of_week
    and time_slot = p_time_slot
  limit 1;

  if v_location is null then
    -- Fall back to weekday/weekend
    select location_id into v_location
    from citizen_routines
    where citizen_id = p_citizen_id
      and day_of_week = case
        when v_day_of_week in ('saturday','sunday') then 'weekend'
        else 'weekday'
      end
      and time_slot = p_time_slot
    limit 1;
  end if;

  -- Final fallback: home location
  if v_location is null then
    select home_location into v_location
    from citizens where id = p_citizen_id;
  end if;

  return v_location;
end;
$$ language plpgsql stable;

-- Get citizens present at a location right now
create or replace function get_citizens_at_location(
  p_location_id text,
  p_game_date date default current_date,
  p_time_slot text default 'morning'
) returns table(citizen_id text) as $$
  select c.id
  from citizens c
  where get_citizen_location(c.id, p_game_date, p_time_slot) = p_location_id;
$$ language sql stable;

-- Determine current season from date
create or replace function get_season(p_date date) returns text as $$
  select case
    when extract(month from p_date) in (3,4,5) then 'spring'
    when extract(month from p_date) in (6,7,8) then 'summer'
    when extract(month from p_date) in (9,10,11) then 'autumn'
    else 'winter'
  end;
$$ language sql immutable;

-- Advance world state by one day (called by cron)
create or replace function advance_world_day() returns void as $$
declare
  v_new_date date;
begin
  update world_state
  set game_date = game_date + interval '1 day',
      game_season = get_season(game_date + interval '1 day'),
      day_of_week = lower(trim(to_char(game_date + interval '1 day', 'day'))),
      last_tick_at = now()
  where id = 1
  returning game_date into v_new_date;

  -- Update analytics aggregates (lightweight)
  insert into analytics_location_popularity (location_id, total_visits, unique_visitors)
  select location_id, sum(visit_count), count(distinct player_id)
  from player_location_visits
  group by location_id
  on conflict (location_id) do update
  set total_visits = excluded.total_visits,
      unique_visitors = excluded.unique_visitors,
      updated_at = now();

  -- Expire old guest saves
  delete from guest_saves where expires_at < now();
end;
$$ language plpgsql security definer;

-- Update player journal (convenience function)
create or replace function add_journal_entry(
  p_player_id uuid,
  p_guest_token text,
  p_entry_type text,
  p_title text,
  p_content text,
  p_related_id text default null
) returns uuid as $$
declare
  v_id uuid;
begin
  insert into player_journal (player_id, guest_token, entry_type, title, content, related_id, game_date)
  select p_player_id, p_guest_token, p_entry_type, p_title, p_content, p_related_id,
    (select game_date from world_state where id = 1)
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;

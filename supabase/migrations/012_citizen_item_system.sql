-- Migration 012: NPC Item System
--
-- Allows citizens to hold items, defines scripted behaviors (pick up, drop,
-- give to another citizen, offer to player), and logs once-only behavior fires.
--
-- Run this in the Supabase SQL Editor.

-- ── citizen_item_holdings ────────────────────────────────────────────────────
-- What each NPC is currently carrying.

create table if not exists citizen_item_holdings (
  id            uuid primary key default uuid_generate_v4(),
  citizen_id    text not null references citizens(id) on delete cascade,
  item_id       text not null,
  acquired_at   timestamptz default now(),
  acquired_from_type  text,  -- 'location' | 'citizen' | 'script'
  acquired_from_id    text,  -- location_id or citizen_id
  constraint    uq_citizen_item unique (citizen_id, item_id)
);

create index if not exists idx_cih_citizen on citizen_item_holdings (citizen_id);
create index if not exists idx_cih_item    on citizen_item_holdings (item_id);
alter table citizen_item_holdings disable row level security;

-- ── citizen_item_behaviors ───────────────────────────────────────────────────
-- Scripted rules that drive NPC item interactions.
--
-- trigger_type:
--   'world_tick'   — evaluated on each cron tick
--   'on_arrival'   — fires when player enters the NPC's current location
--   'on_talk'      — fires when player initiates conversation with the NPC
--   'on_ask'       — fires when player explicitly asks for the item
--
-- action_type:
--   'pick_up'          — NPC takes the item from its canonical location
--   'drop'             — NPC leaves the item at their current location
--   'give_to_citizen'  — NPC transfers item to target_citizen_id
--   'offer_to_player'  — NPC offers item; player must accept (on_talk / on_ask)
--   'give_to_player'   — NPC gives item immediately, no player input required
--
-- trigger_condition examples:
--   "at_location:perkins_cider_house"  NPC must be at this location
--   "trust >= 3"                        player trust with this NPC >= N
--   "mystery:missing_recipe_accessed"   player has any clue for that mystery
--   "holding:perkins_alpine_honey"      NPC must already hold this item

create table if not exists citizen_item_behaviors (
  id                  uuid primary key default uuid_generate_v4(),
  citizen_id          text not null references citizens(id) on delete cascade,
  trigger_type        text not null
                        check (trigger_type in ('world_tick','on_arrival','on_talk','on_ask')),
  trigger_condition   text,          -- null = always fires when triggered
  action_type         text not null
                        check (action_type in ('pick_up','drop','give_to_citizen','offer_to_player','give_to_player')),
  item_id             text not null,
  target_citizen_id   text references citizens(id) on delete set null,
  once_only           boolean not null default false,
  dialogue_hint       text,          -- narration hint for Claude, e.g. "Agnes hands it over reluctantly"
  sort_order          int  default 0  -- lower fires first when multiple behaviors match
);

create index if not exists idx_cib_citizen  on citizen_item_behaviors (citizen_id);
create index if not exists idx_cib_trigger  on citizen_item_behaviors (trigger_type);
alter table citizen_item_behaviors disable row level security;

-- ── citizen_item_behavior_log ────────────────────────────────────────────────
-- Tracks which once_only behaviors have fired (globally — not per player).

create table if not exists citizen_item_behavior_log (
  id            uuid primary key default uuid_generate_v4(),
  behavior_id   uuid not null references citizen_item_behaviors(id) on delete cascade,
  executed_at   timestamptz default now(),
  context       jsonb  -- e.g. { "triggered_by": "player", "player_id": "..." }
);

create unique index if not exists idx_cibl_once
  on citizen_item_behavior_log (behavior_id)
  where (context->>'once_only')::boolean = true;

alter table citizen_item_behavior_log disable row level security;

-- Migration 013: Item Systems
--
-- Adds state tracking, consumability, rarity, impression (for gift-giving),
-- seasonal/weather availability, and vendor replenishment to the items table.
-- Also adds citizen gift preferences and per-player consumption tracking.
--
-- Run this in the Supabase SQL Editor.

-- ── Items table additions ────────────────────────────────────────────────────

-- State tracking (real-world time based)
alter table items
  add column if not exists current_state        text,          -- e.g. 'fresh', 'cold', 'wilted', 'melted'
  add column if not exists base_state           text,          -- initial / reset state
  add column if not exists state_transitions    jsonb,         -- [{after_real_minutes, new_state, description_override, name_override?}]
  add column if not exists state_changed_at     timestamptz default now();

-- Consumability
alter table items
  add column if not exists is_consumable        boolean not null default false,
  add column if not exists vendor_citizen_id    text references citizens(id) on delete set null,
  add column if not exists price                int;           -- null = not for sale; 0 = given freely

-- Rarity
alter table items
  add column if not exists rarity               text not null default 'common'
    check (rarity in ('common', 'uncommon', 'rare', 'precious', 'legendary'));

-- Gift impression (how NPCs feel about receiving this)
-- impression_value: -3 (deeply unpleasant) to +3 (genuinely lovely)
alter table items
  add column if not exists impression_value     int  not null default 0,
  add column if not exists impression_category  text          -- 'pleasant','beautiful','practical','food','nature','dirty','ugly','unpleasant','neutral'
    check (impression_category in ('pleasant','beautiful','practical','food','nature','dirty','ugly','unpleasant','neutral') or impression_category is null);

-- Seasonal / weather availability
alter table items
  add column if not exists season_availability  text[],        -- null = year-round; e.g. ['autumn','winter']
  add column if not exists weather_trigger      text;          -- null = always; 'snow', 'rain'

-- Physical weight class (affects carry / look descriptions)
alter table items
  add column if not exists weight_class         text not null default 'small'
    check (weight_class in ('tiny','small','medium','large','immovable'));

-- Whether this item is ambient world detail (shown inline in look description, not listed separately)
alter table items
  add column if not exists is_ambient           boolean not null default false;

-- ── citizen_item_preferences ─────────────────────────────────────────────────
-- Per-citizen preferences for gift categories. Multiplies the item's base
-- impression_value: 2.0 = loves this category, 0.5 = indifferent, -1.0 = dislikes.

create table if not exists citizen_item_preferences (
  citizen_id            text not null references citizens(id) on delete cascade,
  impression_category   text not null,
  preference_multiplier float not null default 1.0,
  reaction_positive     text,   -- what they say when receiving something they like
  reaction_negative     text,   -- what they say when receiving something they dislike
  primary key (citizen_id, impression_category)
);

alter table citizen_item_preferences disable row level security;

-- ── player_consumed_items ─────────────────────────────────────────────────────
-- Tracks items the player has consumed (used up). Consumable items disappear
-- from inventory on use and are recorded here so the world knows they're gone.

create table if not exists player_consumed_items (
  id            uuid primary key default uuid_generate_v4(),
  player_id     uuid references player_profiles(id) on delete cascade,
  guest_token   text,
  item_id       text not null,
  consumed_at   timestamptz default now(),
  constraint    chk_pci_player_or_guest check (player_id is not null or guest_token is not null)
);

create index if not exists idx_pci_player on player_consumed_items (player_id) where player_id is not null;
create index if not exists idx_pci_guest  on player_consumed_items (guest_token) where guest_token is not null;
alter table player_consumed_items disable row level security;

-- ── player_given_items ────────────────────────────────────────────────────────
-- Tracks items the player has given to NPCs, for journal/history purposes.

create table if not exists player_given_items (
  id            uuid primary key default uuid_generate_v4(),
  player_id     uuid references player_profiles(id) on delete cascade,
  guest_token   text,
  item_id       text not null,
  citizen_id    text not null references citizens(id) on delete cascade,
  given_at      timestamptz default now(),
  trust_delta   float,
  constraint    chk_pgi_player_or_guest check (player_id is not null or guest_token is not null)
);

alter table player_given_items disable row level security;

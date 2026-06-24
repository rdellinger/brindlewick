-- Migration 011: Per-player item location overrides
--
-- When a player picks up an item and drops it somewhere new, we store their
-- personal position here. The items table still holds the canonical/default
-- location; this table overrides it per-player.
--
-- Lifecycle:
--   pick up  → delete row (item goes into inventory)
--   drop     → upsert row with new location_id
--   display  → getItemsAtLocation merges default + this table
--
-- Run this in the Supabase SQL Editor.

create table if not exists player_item_locations (
  id          uuid primary key default uuid_generate_v4(),
  player_id   uuid references player_profiles(id) on delete cascade,
  guest_token text,
  item_id     text not null,
  location_id text not null,
  moved_at    timestamptz default now(),
  constraint  chk_pil_player_or_guest check (player_id is not null or guest_token is not null)
);

-- One row per (player, item) — each item has exactly one override location
create unique index if not exists idx_pil_player
  on player_item_locations (player_id, item_id)
  where player_id is not null;

create unique index if not exists idx_pil_guest
  on player_item_locations (guest_token, item_id)
  where guest_token is not null;

-- Fast lookup: all items a player has placed at a given location
create index if not exists idx_pil_location
  on player_item_locations (location_id);

alter table player_item_locations disable row level security;

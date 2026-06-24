-- Migration 014: Track which items a player has examined
-- Persists "seen" status across sessions and devices

create table if not exists player_seen_items (
  id           bigserial primary key,
  player_id    uuid references auth.users(id) on delete cascade,
  guest_token  text,
  item_id      text not null references items(id) on delete cascade,
  seen_at      timestamptz not null default now(),
  constraint player_seen_items_player_check check (
    (player_id is not null) or (guest_token is not null)
  ),
  -- One row per (player, item)
  constraint player_seen_items_player_item_unique unique nulls not distinct (player_id, guest_token, item_id)
);

create index if not exists idx_player_seen_items_player
  on player_seen_items (player_id) where player_id is not null;

create index if not exists idx_player_seen_items_guest
  on player_seen_items (guest_token) where guest_token is not null;

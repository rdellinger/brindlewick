-- Migration 009: Persistent NPC conversation history per player.
-- Stores the message history for each player-citizen pair so NPCs remember
-- prior conversations across sessions. History is capped at 30 messages
-- (15 exchanges) in application code before saving.

create table player_citizen_conversations (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references player_profiles(id) on delete cascade,
  guest_token     text,
  citizen_id      text not null references citizens(id) on delete cascade,
  history         jsonb not null default '[]'::jsonb,  -- array of {role, content}
  last_talked_at  timestamptz default now(),
  created_at      timestamptz default now(),
  check (player_id is not null or guest_token is not null),
  unique (player_id, citizen_id),
  unique (guest_token, citizen_id)
);

create index idx_conv_player   on player_citizen_conversations(player_id);
create index idx_conv_guest    on player_citizen_conversations(guest_token);
create index idx_conv_citizen  on player_citizen_conversations(citizen_id);

-- Disable RLS — access enforced at API route level like all other game tables
alter table player_citizen_conversations disable row level security;

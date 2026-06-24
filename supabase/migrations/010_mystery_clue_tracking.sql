-- Migration 010: Per-clue tracking + clue_id on mystery_clues
--
-- Two things:
-- 1. Add clue_id column to mystery_clues so we can store the content-file string ID
--    (e.g. "sv_clue_1") alongside the auto-generated uuid PK.
-- 2. Create player_mystery_clues for per-clue tracking per player.
--    This replaces the rough JSONB array approach and enables prerequisite gating
--    (a clue is only revealed if its requires_condition is met).
--
-- Run this in the Supabase SQL Editor.

-- ── 1. Add clue_id to mystery_clues ──────────────────────────────────────────
alter table mystery_clues
  add column if not exists clue_id text;

-- ── 2. Per-clue tracking table ────────────────────────────────────────────────
create table if not exists player_mystery_clues (
  id            uuid primary key default uuid_generate_v4(),
  player_id     uuid references player_profiles(id) on delete cascade,
  guest_token   text,
  mystery_id    text not null,
  clue_id       text not null,         -- matches mystery_clues.clue_id
  found_at      timestamptz default now(),
  constraint    chk_pmc_player_or_guest check (player_id is not null or guest_token is not null)
);

-- Unique index per player (partial, avoids ambiguity with null columns)
create unique index if not exists idx_pmc_player
  on player_mystery_clues (player_id, mystery_id, clue_id)
  where player_id is not null;

create unique index if not exists idx_pmc_guest
  on player_mystery_clues (guest_token, mystery_id, clue_id)
  where guest_token is not null;

-- No RLS needed — server-side only
alter table player_mystery_clues disable row level security;

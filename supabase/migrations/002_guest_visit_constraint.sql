-- ============================================================
-- Migration 002: Fix guest session visit tracking
-- ============================================================
--
-- Problem: player_location_visits had unique(player_id, location_id)
-- but guest sessions use guest_token (not player_id). Upserts for
-- guests with null player_id would conflict incorrectly.
--
-- Fix: add a second unique constraint for (guest_token, location_id)
-- and update the engine to use the correct conflict target.

-- Add guest_token column if missing (should already exist from 001)
-- Drop the old partial unique constraint on player_id alone if any
-- (the schema in 001 had: unique(player_id, location_id))

-- Add a partial unique index for authenticated players
drop index if exists player_location_visits_player_location_unique;

create unique index player_location_visits_player_unique
  on player_location_visits (player_id, location_id)
  where player_id is not null;

-- Add a partial unique index for guest sessions
create unique index player_location_visits_guest_unique
  on player_location_visits (guest_token, location_id)
  where guest_token is not null;

-- Ensure guest_token column exists with an index for lookups
create index if not exists idx_visits_guest_token
  on player_location_visits (guest_token)
  where guest_token is not null;

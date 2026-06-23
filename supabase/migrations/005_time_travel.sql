-- Migration 005: Time travel system
-- Enables the Chrono-Logbook mechanic: players can visit any date from
-- 1809 (founding) to the present. Historical content renders per era.
-- Changes the player makes in the past persist as temporal_changes.

-- ── Time Periods ──────────────────────────────────────────────────────────────
-- Broad eras used for historical rendering. A game_date maps to whichever
-- period contains it.

CREATE TABLE IF NOT EXISTS time_periods (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  start_year      integer NOT NULL,
  end_year        integer,              -- null = ongoing
  description     text NOT NULL,       -- narrator's description of the era
  atmosphere      text,                -- ambient sensory feel
  population_desc text,                -- what the population was like
  world_event     text                 -- the defining historical event of this era
);

-- ── Historical Citizens ───────────────────────────────────────────────────────
-- People who existed in the past. They appear when player travels to their era.

CREATE TABLE IF NOT EXISTS historical_citizens (
  id              text PRIMARY KEY,
  time_period_id  text NOT NULL REFERENCES time_periods(id),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  birth_year      integer,
  death_year      integer,
  occupation      text,
  home_location   text REFERENCES locations(id) ON DELETE SET NULL,
  appearance      text,
  personality     text,
  dialogue_topics jsonb NOT NULL DEFAULT '{}'
    -- JSON map of topic -> array of dialogue strings
);

-- ── Historical Location Descriptions ─────────────────────────────────────────
-- Each location can have a different look/feel in each era.

CREATE TABLE IF NOT EXISTS historical_location_descriptions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id     text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  time_period_id  text NOT NULL REFERENCES time_periods(id),
  description     text NOT NULL,
  seasonal_notes  text,
  special_note    text,   -- narrative note about what's unique in this era
  UNIQUE (location_id, time_period_id)
);

-- ── Historical Items ──────────────────────────────────────────────────────────
-- Items that only exist (or look different) in a specific era.
-- Also used for "present but future" items (e.g. the lake beacon before it sank).

CREATE TABLE IF NOT EXISTS historical_items (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  description     text NOT NULL,
  location_id     text REFERENCES locations(id) ON DELETE SET NULL,
  time_period_id  text NOT NULL REFERENCES time_periods(id),
  lore_note       text,
  mystery_tie     text REFERENCES mysteries(id) ON DELETE SET NULL,
  reveals_clue    text    -- a clue text to add to mystery_clue log on examine
);

-- ── Temporal Changes ──────────────────────────────────────────────────────────
-- When a player does something in the past that affects the future,
-- the effect is stored here. The engine checks this table when rendering
-- present-day content to apply persistent changes.

CREATE TABLE IF NOT EXISTS temporal_changes (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_token      text,
  change_type      text NOT NULL
    CHECK (change_type IN (
      'door_unlocked', 'item_retrieved', 'secret_revealed',
      'mechanism_understood', 'path_opened', 'knowledge_gained'
    )),
  target_type      text NOT NULL CHECK (target_type IN ('location','item','mystery','citizen')),
  target_id        text NOT NULL,
  change_date      date NOT NULL,       -- the historical date the change was made
  effect_present   text NOT NULL,       -- how this manifests in the present
  mystery_reveal   text REFERENCES mysteries(id) ON DELETE SET NULL,
  clue_text        text,                -- optional mystery clue to record
  is_permanent     boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tc_player ON temporal_changes(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX idx_tc_guest  ON temporal_changes(guest_token) WHERE guest_token IS NOT NULL;

-- ── Save table extensions ─────────────────────────────────────────────────────
-- time_position: null = player is in the present
--                date  = player is visiting this historical date
-- has_chrono_logbook: whether Eleanor has given the player the device

ALTER TABLE player_saves
  ADD COLUMN IF NOT EXISTS time_position    date,
  ADD COLUMN IF NOT EXISTS has_chrono_logbook boolean NOT NULL DEFAULT false;

ALTER TABLE guest_saves
  ADD COLUMN IF NOT EXISTS time_position    date,
  ADD COLUMN IF NOT EXISTS has_chrono_logbook boolean NOT NULL DEFAULT false;

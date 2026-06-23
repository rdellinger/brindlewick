-- Migration 003: World events chronicle
-- Records things that happen in Brindlewick even when no player is watching.
-- Populated nightly by the cron job; queried for the "catch me up" feature.

CREATE TABLE IF NOT EXISTS world_events (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_date    date NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN (
                  'social', 'weather', 'discovery', 'rumor',
                  'business', 'seasonal', 'mystery', 'community'
               )),
  headline     text NOT NULL,
  detail       text,
  location_id  text REFERENCES locations(id) ON DELETE SET NULL,
  citizen_id   text REFERENCES citizens(id) ON DELETE SET NULL,
  mystery_tie  text REFERENCES mysteries(id) ON DELETE SET NULL,
  is_major     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_world_events_game_date ON world_events(game_date DESC);
CREATE INDEX idx_world_events_major     ON world_events(is_major) WHERE is_major = true;

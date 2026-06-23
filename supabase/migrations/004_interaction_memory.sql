-- Migration 004: Player interaction memory
-- Records every meaningful player-world interaction so NPCs can remember
-- the player, and so the world can reflect past encounters.

-- Full granular interaction log (every talk, examine, ask, take, use)
CREATE TABLE IF NOT EXISTS player_interactions (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_token  text,
  citizen_id   text REFERENCES citizens(id) ON DELETE SET NULL,
  location_id  text REFERENCES locations(id) ON DELETE SET NULL,
  item_id      text REFERENCES items(id) ON DELETE SET NULL,
  interaction_type text NOT NULL
    CHECK (interaction_type IN ('talk','ask','look','examine','take','use','give','research')),
  topic        text,               -- what was asked/discussed
  summary      text,               -- brief summary of the exchange (for recall)
  game_date    date,               -- in-world date this happened
  time_position date,              -- null = present, date = historical position
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pi_player ON player_interactions(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX idx_pi_guest  ON player_interactions(guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX idx_pi_citizen ON player_interactions(citizen_id, player_id, guest_token);

-- Per-citizen conversation memory (aggregated view of the relationship)
CREATE TABLE IF NOT EXISTS citizen_conversation_memory (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_token      text,
  citizen_id       text NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  interaction_count integer NOT NULL DEFAULT 0,
  topics_discussed  text[] NOT NULL DEFAULT '{}',
  last_interaction  timestamptz,
  first_met_at      timestamptz,
  -- One row per player-citizen pair
  CONSTRAINT ccm_player_unique  UNIQUE NULLS NOT DISTINCT (player_id, citizen_id),
  CONSTRAINT ccm_guest_unique   UNIQUE NULLS NOT DISTINCT (guest_token, citizen_id)
);

CREATE INDEX idx_ccm_player ON citizen_conversation_memory(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX idx_ccm_guest  ON citizen_conversation_memory(guest_token) WHERE guest_token IS NOT NULL;

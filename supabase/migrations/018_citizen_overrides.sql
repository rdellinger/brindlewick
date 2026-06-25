-- citizen_overrides: temporary per-player location overrides for summoned citizens
-- Format: { "citizen_id": "location_id", ... }
alter table player_saves add column if not exists citizen_overrides jsonb default '{}'::jsonb;
alter table guest_saves add column if not exists citizen_overrides jsonb default '{}'::jsonb;

-- Migration 014: Real-time clock support
-- Adds business_hours JSONB column to locations.
-- Format: { "mon": [9,17], "tue": [9,17], ..., "sun": null }
-- null value for a day = closed all day
-- Missing key = no hours constraint (location always accessible)

alter table locations
  add column if not exists business_hours jsonb default null;

comment on column locations.business_hours is
  'Operating hours per day of week. Keys: mon/tue/wed/thu/fri/sat/sun. Values: [open_hour_24, close_hour_24] or null (closed). Null column = always accessible.';

-- Also add game_time to world_state for reference (populated by cron, not used for truth)
alter table world_state
  add column if not exists game_time text default null;

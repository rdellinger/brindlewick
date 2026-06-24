-- Migration 016: Geographic anomaly fixes
--
-- Corrects seven issues found during a full town walkthrough:
--
--   1. Remove Town Square → Library direct exit (library is on Millpond Row,
--      not on the square; access it via Millpond Row).
--
--   2. Move Station Master's House from north mountain road to south end of
--      Lake Street. New England rail lines came through valleys from the south,
--      not from mountain trailheads. Updated area and description in JSON.
--
--   3. Add Chapel ↔ Cemetery connection. The cemetery is immediately behind
--      St. Agatha's Chapel, separated by a low stone wall — they must connect.
--
--   4. Remove Spruce Point → Trailhead exit. Spruce Point is on the lake's
--      eastern shore; the trailhead is on the north side of town. No logical
--      path connects them without passing through town.
--
--   5. Connect Old Mill Ruins ↔ Covered Bridge. Both are on Heron's Creek
--      within a short walk of each other; a creek-bank path links them.
--
--   6. Connect Founders' Graves ↔ Water Tower. Both sit on Copper Hill's
--      lower slope; each can see the other.
--
--   7. Finch Family Orchard description updated in JSON (south-facing slope,
--      not south side of town). No exit changes needed.
--
-- Run this in the Supabase SQL Editor.

-- ----------------------------------------------------------------
-- 1. Remove Town Square → Library direct exit
-- ----------------------------------------------------------------

delete from location_exits
  where from_loc = 'town_square'
    and to_loc   = 'library';

-- ----------------------------------------------------------------
-- 2. Station Master's House: remove from north road, add to south Lake Street
-- ----------------------------------------------------------------

-- Remove all north-road connections
delete from location_exits
  where (from_loc = 'station_masters_house' or to_loc = 'station_masters_house')
    and (from_loc in ('grange_hall','covered_bridge','brindlewick_trailhead','millpond_row')
      or to_loc   in ('grange_hall','covered_bridge','brindlewick_trailhead','millpond_row'));

-- Connect to Lake Street (south end)
insert into location_exits (from_loc, to_loc) values
  ('station_masters_house', 'lake_street'),
  ('lake_street',           'station_masters_house')
on conflict (from_loc, to_loc) do nothing;

-- Grange Hall now connects directly to Covered Bridge
insert into location_exits (from_loc, to_loc) values
  ('grange_hall',    'covered_bridge'),
  ('covered_bridge', 'grange_hall')
on conflict (from_loc, to_loc) do nothing;

-- ----------------------------------------------------------------
-- 3. Chapel ↔ Cemetery
-- ----------------------------------------------------------------

insert into location_exits (from_loc, to_loc) values
  ('st_agathas_chapel',    'brindlewick_cemetery'),
  ('brindlewick_cemetery', 'st_agathas_chapel')
on conflict (from_loc, to_loc) do nothing;

-- ----------------------------------------------------------------
-- 4. Remove Spruce Point → Trailhead
-- ----------------------------------------------------------------

delete from location_exits
  where from_loc = 'spruce_point'
    and to_loc   = 'brindlewick_trailhead';

delete from location_exits
  where from_loc = 'brindlewick_trailhead'
    and to_loc   = 'spruce_point';

-- ----------------------------------------------------------------
-- 5. Old Mill Ruins ↔ Covered Bridge (creek-bank path)
-- ----------------------------------------------------------------

insert into location_exits (from_loc, to_loc) values
  ('old_mill_ruins', 'covered_bridge'),
  ('covered_bridge', 'old_mill_ruins')
on conflict (from_loc, to_loc) do nothing;

-- ----------------------------------------------------------------
-- 6. Founders' Graves ↔ Water Tower (same hillside)
-- ----------------------------------------------------------------

insert into location_exits (from_loc, to_loc) values
  ('founders_graves', 'water_tower'),
  ('water_tower',     'founders_graves')
on conflict (from_loc, to_loc) do nothing;

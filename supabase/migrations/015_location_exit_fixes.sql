-- Migration 015: Fix location exit connectivity
--
-- Changes made to content/locations.json are reflected here as
-- location_exits inserts/deletes.
--
-- Fixes:
--   1. Trail system: warming_hut is the junction at 1.2mi — wire it to
--      the_lookout and wardens_cabin so trails connect sequentially.
--   2. North road: Millbrook Farm → Grange Hall → Station Master's House →
--      Covered Bridge → Trailhead are all on the same road; add connections
--      between them so they don't all dead-end back to Millpond Row alone.
--   3. Alderman Estate: remove self-referential exit (alderman_estate → alderman_estate).
--   4. Cemetery: add a street exit to maple_row (real cemeteries have a gate).
--
-- Run this in the Supabase SQL Editor.

-- ----------------------------------------------------------------
-- 1. Trail system
-- ----------------------------------------------------------------

-- Warming hut (junction at 1.2mi) connects to the lookout and warden's cabin
insert into location_exits (from_loc, to_loc) values
  ('warming_hut',          'the_lookout'),
  ('warming_hut',          'wardens_cabin'),
  -- Lookout and warden's cabin route back through the hut
  ('the_lookout',          'warming_hut'),
  ('wardens_cabin',        'warming_hut')
on conflict (from_loc, to_loc) do nothing;

-- ----------------------------------------------------------------
-- 2. North road connectivity
-- ----------------------------------------------------------------

insert into location_exits (from_loc, to_loc) values
  -- Millbrook Farm ↔ Grange Hall (adjacent on north road)
  ('millbrook_farm',       'grange_hall'),
  ('grange_hall',          'millbrook_farm'),
  -- Grange Hall ↔ Station Master's House
  ('grange_hall',          'station_masters_house'),
  ('station_masters_house','grange_hall'),
  -- Station Master's House ↔ Covered Bridge
  ('station_masters_house','covered_bridge'),
  ('covered_bridge',       'station_masters_house'),
  -- Station Master's House ↔ Trailhead (north end of road)
  ('station_masters_house','brindlewick_trailhead'),
  ('brindlewick_trailhead','station_masters_house'),
  -- Covered Bridge ↔ Trailhead (bridge is on the road to the trailhead)
  ('brindlewick_trailhead','covered_bridge')
on conflict (from_loc, to_loc) do nothing;

-- ----------------------------------------------------------------
-- 3. Remove Alderman Estate self-reference
-- ----------------------------------------------------------------

delete from location_exits
  where from_loc = 'alderman_estate'
    and to_loc   = 'alderman_estate';

-- ----------------------------------------------------------------
-- 4. Cemetery street exit
-- ----------------------------------------------------------------

insert into location_exits (from_loc, to_loc) values
  ('brindlewick_cemetery', 'maple_row'),
  ('maple_row',            'brindlewick_cemetery')
on conflict (from_loc, to_loc) do nothing;

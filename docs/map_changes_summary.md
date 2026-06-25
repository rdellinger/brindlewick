# Brindlewick Map Consistency — Change Summary

## What Changed and Why

### Problem
`content/exit_directions.json` had **23 reciprocal violations** — pairs where
Location A said "go north to reach B" but B said "go east to reach A." Additionally,
**14 locations** had one-way exits (A exits to B, but B had no exit back to A) and
all 69 locations lacked street addresses.

### Files Modified
- `content/exit_directions.json` — corrected all violations, added 15 new entries
- `content/locations.json` — added 10 missing reciprocal exits, added `address` field to all 69 locations

---

## exit_directions.json — Direction Changes (23 violations fixed)

| Connection | Old label | New label | Reason |
|---|---|---|---|
| `town_hall → town_square` | outside | **south** | Town Hall is north of the square; exiting goes south |
| `town_square → lantern_post_inn` | inside | **south** | Inn is a building south of the square, uses compass throughout |
| `maple_row → town_square` | north | **east** | Square is east of Maple Row (west street); west↔east pair |
| `lake_street → town_square` | north | **west** | Square is west of Lake Street (east street); east↔west pair |
| `millpond_row → lantern_post_inn` | inside | **east** | Inn is east of Millpond Row; completes east↔west pair |
| `lake_street → lantern_post_inn` | inside | **west** | Inn is west of Lake Street; completes east↔west pair |
| `lake_street → station_masters_house` | inside | **west** | Station is west of Lake Street; east↔west pair |
| `millpond_row → station_masters_house` | inside | **east** | Station is east of Millpond Row; east↔west pair |
| `lakeside_park → lake_street` | north | **west** | Lake Street is west of Lakeside Park; east↔west pair |
| `lakefront_boardwalk → lake_street` | north | **west** | Lake Street is west of the boardwalk; east↔west pair |
| `lake_pier → lakeside_park` | back to shore | **west** | Park is west of pier; east↔west pair |
| `lake_pier → miras_boat_rental` | along the dock | **south** | Boat rental is south of pier; south↔north pair |
| `miras_boat_rental → lake_pier` | to the dock | **north** | Pier is north of rental; north↔south pair |
| `miras_boat_rental → lakefront_boardwalk` | outside | **north** | Boardwalk is north of boat rental; south↔north pair |
| `old_alderman_boathouse → lakefront_boardwalk` | outside | **south** | Boathouse is at north end of boardwalk; north↔south pair |
| `lighthouse → lakefront_boardwalk` | back to boardwalk | **north** | Boardwalk is north of lighthouse; south↔north pair |
| `spruce_point → lakefront_boardwalk` | back to boardwalk | **north** | Boardwalk is north of Spruce Point; south↔north pair |
| `alderman_estate → hidden_garden` | into the garden | **south** | Garden is behind (south of) the estate |
| `hidden_garden → alderman_estate` | back to the estate | **north** | Estate is north of the garden |
| `finch_lane → alderman_estate` | north | **west** | Estate is west of Finch Lane; east↔west pair |
| `st_agathas_chapel → brindlewick_cemetery` | to the cemetery | **south** | Cemetery is south of the chapel |
| `brindlewick_cemetery → st_agathas_chapel` | back to chapel | **north** | Chapel is north of the cemetery |
| `brindlewick_cemetery → maple_row` | outside | **north** | Maple Row is north of the cemetery; south↔north pair |
| `brindlewick_trailhead → warming_hut` | north | **south** | Warming hut is south of trailhead (into wilderness) |
| `warming_hut → brindlewick_trailhead` | down the trail | **north** | Trailhead is north of warming hut |
| `warming_hut → the_lookout` | up the trail | **south** | Lookout is further south on the trail |
| `the_lookout → warming_hut` | south | **north** | Warming hut is north of the lookout |
| `brindlewick_trailhead → the_lookout` | up the trail | **south** | Lookout is south on the trail |
| `the_lookout → brindlewick_trailhead` | down the trail | **north** | Trailhead is north of the lookout |
| `keepers_cottage → library` | to the library | **inside** | Cottage and library share a garden gate; inside↔outside pair |

---

## exit_directions.json — New Entries (15 added)

| New entry | Value | Reason |
|---|---|---|
| `clocktower_stairs → town_hall` | down | Return from clocktower to town hall |
| `founders_hidden_room → alderman_estate` | outside | Return from sealed room to estate |
| `town_square → sunday_market` | inside | Reciprocal of market→square |
| `millpond_row → covered_bridge` | south | Reciprocal of bridge→millpond_row |
| `millpond_row → finch_family_orchard` | south | Reciprocal of orchard→millpond_row |
| `millpond_row → keepers_cottage` | inside | Reciprocal of cottage→millpond_row |
| `millpond_row → notions_nook` | inside | Reciprocal of notions_nook→millpond_row |
| `millpond_row → thornburys_provisions` | inside | Reciprocal of thornburys→millpond_row |
| `finch_lane → candle_soap_shop` | inside | Reciprocal of candle_shop→finch_lane |
| `finch_lane → cobblers_corner` | inside | Reciprocal of cobbler→finch_lane |
| `lake_street → finch_lane` | west | Reciprocal of finch_lane→lake_street |
| `library → keepers_cottage` | outside | Reciprocal of cottage→library |
| `miras_boat_rental → finch_island` | by boat | Reciprocal of island→miras |
| `brindlewick_trailhead → millpond` | north | Reciprocal of millpond→trailhead |

---

## locations.json — Missing Exits Added (10 locations)

| Location | Exits added |
|---|---|
| `clocktower_stairs` | `town_hall` |
| `founders_hidden_room` | `alderman_estate` |
| `station_masters_house` | `millpond_row` |
| `millpond_row` | `covered_bridge`, `finch_family_orchard`, `keepers_cottage`, `notions_nook`, `thornburys_provisions` |
| `lake_street` | `finch_lane` |
| `miras_boat_rental` | `finch_island` |
| `finch_lane` | `candle_soap_shop`, `cobblers_corner` |
| `library` | `keepers_cottage` |
| `town_square` | `sunday_market` |
| `brindlewick_trailhead` | `millpond` |

---

## Spatial Logic (reference for future additions)

**East–West ordering of streets:**
Maple Row (west) → Millpond Row → Finch Lane → Lake Street → Lakefront Boardwalk → Lake (east)

**Cardinal rules:**
- From any street, going **east** moves you toward the lake
- From any street, going **west** moves you away from the lake
- Going **north** from town means toward the trailhead / open country
- Going **south** from town means toward farms, the covered bridge, and the rural south
- From the trailhead, **north** returns to town; **south** goes into the wilderness

**Lantern Post Inn** — uses compass throughout (no inside/outside), as it is a corner hub at the junction of Millpond Row, Lake Street, and Town Square.

**Warden's Cabin** — is *north* of the trailhead (at the forest edge, before the official trail begins), which is why `brindlewick_trailhead → wardens_cabin = "north"`.

**Boardwalk** — runs N–S along the lake shore, east of Lake Street. You reach it by going "east" from Lake Street, then travel it "north" or "south."

---

## Validation

After all changes:
- **0 reciprocal violations** in exit_directions.json (verified by audit script)
- **0 orphaned direction keys** — every key in exit_directions.json has a matching exit in locations.json
- **178 total direction entries** (up from 163)
- **69/69 locations** have street addresses


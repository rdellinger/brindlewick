import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * Called by Vercel Cron at midnight UTC every day.
 * Vercel sets the Authorization header with the CRON_SECRET value.
 * See vercel.json for schedule config.
 *
 * Steps:
 *   1. Advance the world day (game_date, season, day_of_week)
 *   2. Generate a world event for the new day (town chronicle)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()

  // 1. Advance the world day
  const { error } = await supabase.rpc('advance_world_day')

  if (error) {
    console.error('[cron/advance-world] RPC error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch the new world state
  const { data: world } = await supabase
    .from('world_state')
    .select('game_date, game_season, day_of_week')
    .eq('id', 1)
    .single()

  console.log('[cron/advance-world] Advanced to:', world?.game_date, world?.game_season)

  // 2. Generate a world event for today
  if (world?.game_date) {
    try {
      await generateDailyWorldEvent(supabase, world.game_date, world.game_season, world.day_of_week)
    } catch (evtErr) {
      // Non-fatal — world still advanced
      console.error('[cron/advance-world] World event generation failed:', evtErr)
    }
  }

  return NextResponse.json({
    ok: true,
    game_date: world?.game_date,
    game_season: world?.game_season,
    day_of_week: world?.day_of_week,
  })
}

// ── Daily event generation ────────────────────────────────────────────────────

type EventTemplate = {
  event_type: string
  headline: string
  detail: string | null
  location_id: string | null
  citizen_id: string | null
  mystery_tie: string | null
  is_major: boolean
  seasons?: string[]    // if set, only fire in these seasons
  days?: string[]       // if set, only fire on these days of week
}

const EVENT_POOL: EventTemplate[] = [
  // Social
  { event_type: 'social', headline: 'Marigold Osei put a new recipe on trial at the bakery — cardamom and dried pear. The verdict from regulars was cautiously optimistic.', detail: null, location_id: 'copper_kettle_bakery', citizen_id: 'marigold_osei', mystery_tie: null, is_major: false },
  { event_type: 'social', headline: 'Teddy Birch reorganized the inn\'s notice board. Again. He is convinced there is an optimal configuration.', detail: null, location_id: 'lantern_post_inn', citizen_id: 'teddy_birch', mystery_tie: null, is_major: false },
  { event_type: 'social', headline: 'Artie Pryce held court in the town square for an hour, sharing what he called "historical context" about the Webb family.', detail: 'Two people stopped to listen. One of them disagreed about a date. Artie was not discouraged.', location_id: 'town_square', citizen_id: 'artie_pryce', mystery_tie: null, is_major: false },
  { event_type: 'social', headline: 'Eleanor Finch-Hartwell extended the library hours by thirty minutes. No announcement was made; the door was simply still unlocked at 6:30pm.', detail: null, location_id: 'library', citizen_id: 'eleanor_finch_hartwell', mystery_tie: null, is_major: false },
  { event_type: 'community', headline: 'A small group gathered at the lakeside park in the evening to watch for the lake light. It did not appear. They stayed anyway.', detail: null, location_id: 'lakeside_park', citizen_id: null, mystery_tie: null, is_major: false },
  { event_type: 'social', headline: 'Agnes Perkins brought a crate of late-season apples down from the orchard. She sold them from the front step of the cider house.', detail: null, location_id: 'perkins_cider_house', citizen_id: 'agnes_perkins', mystery_tie: null, is_major: false },

  // Weather / Seasonal (autumn-only)
  { event_type: 'weather', headline: 'The first hard frost of the season arrived overnight. The lake had a thin skim of ice at the edges by dawn.', detail: null, location_id: 'lakeside_park', citizen_id: null, mystery_tie: null, is_major: false, seasons: ['autumn', 'winter'] },
  { event_type: 'seasonal', headline: 'The maple trees along the eastern side of the square reached peak color today — a range of amber, rust, and deep red.', detail: 'Artie Pryce noted that this is the latest peak in eleven years.', location_id: 'town_square', citizen_id: 'artie_pryce', mystery_tie: null, is_major: false, seasons: ['autumn'] },
  { event_type: 'weather', headline: 'A windstorm came through the valley in the afternoon, stripping the last leaves from the covered bridge approach.', detail: null, location_id: 'covered_bridge', citizen_id: null, mystery_tie: null, is_major: false, seasons: ['autumn', 'winter'] },
  { event_type: 'weather', headline: 'Overnight snowfall dusted the mountaintops. The town woke to the kind of clear cold that sharpens everything.', detail: null, location_id: null, citizen_id: null, mystery_tie: null, is_major: false, seasons: ['winter', 'autumn'] },

  // Discovery / Mystery
  { event_type: 'mystery', headline: 'Someone left a handwritten note under the door of the library — addressed to "the archivist" with no signature.', detail: 'Eleanor has not shared the contents.', location_id: 'library', citizen_id: 'eleanor_finch_hartwell', mystery_tie: null, is_major: true },
  { event_type: 'mystery', headline: 'The lake light appeared again at midnight — unusually bright, according to Fletcher Grange, who was watching.', detail: 'He noted it lasted four minutes and twelve seconds before fading.', location_id: 'lakeside_park', citizen_id: 'fletcher_grange', mystery_tie: null, is_major: true },
  { event_type: 'mystery', headline: 'A brass button was found at the base of the Alderman statue — engraved with an insignia no one has been able to identify.', detail: null, location_id: 'town_square', citizen_id: null, mystery_tie: null, is_major: true },
  { event_type: 'discovery', headline: 'Fletcher Grange published a new note in the town gazette about his lake observations, this time including a hand-drawn depth map.', detail: null, location_id: null, citizen_id: 'fletcher_grange', mystery_tie: null, is_major: true },
  { event_type: 'mystery', headline: 'Rosalind Webb was seen at the clocktower in the early morning with a measuring tape and a notebook. She declined to explain.', detail: null, location_id: 'town_square', citizen_id: null, mystery_tie: null, is_major: true },

  // Rumor
  { event_type: 'rumor', headline: 'Rumor in the square: someone has been seen on the covered bridge after dark two nights in a row. No one agrees on who it was.', detail: null, location_id: 'covered_bridge', citizen_id: null, mystery_tie: null, is_major: false },
  { event_type: 'rumor', headline: 'Word has it that the Alderman estate received a letter from a law firm in the city. Constance Alderman has not commented.', detail: null, location_id: null, citizen_id: 'constance_alderman', mystery_tie: null, is_major: false },
  { event_type: 'rumor', headline: 'Several locals have independently reported hearing what sounds like music from the direction of the lake — late at night, just once.', detail: null, location_id: 'lakeside_park', citizen_id: null, mystery_tie: null, is_major: false },
  { event_type: 'rumor', headline: 'It is said that Agnes Perkins received a visitor at the cider house yesterday — a person no one in town recognized.', detail: null, location_id: 'perkins_cider_house', citizen_id: 'agnes_perkins', mystery_tie: null, is_major: false },

  // Business / Community
  { event_type: 'business', headline: 'The Lantern Post Inn received its largest single booking in three years — a family reunion, apparently.', detail: 'Teddy Birch was seen making a list of things that needed fixing in rooms 4 and 5.', location_id: 'lantern_post_inn', citizen_id: 'teddy_birch', mystery_tie: null, is_major: false },
  { event_type: 'community', headline: 'The town\'s informal litter patrol — four retired residents and two very willing dogs — made their monthly pass through the lakeside park.', detail: null, location_id: 'lakeside_park', citizen_id: null, mystery_tie: null, is_major: false },
  { event_type: 'community', headline: 'A new notice appeared on the inn\'s board calling for volunteers to repaint the covered bridge railing before winter.', detail: 'Three people signed up within the day. Teddy says he\'s optimistic.', location_id: 'lantern_post_inn', citizen_id: 'teddy_birch', mystery_tie: null, is_major: false },

  // Weekend-specific (farmers market / social gatherings)
  { event_type: 'community', headline: 'Saturday market in the town square drew a crowd — local honey, late-season vegetables, and the usual debates about the best pie.', detail: null, location_id: 'town_square', citizen_id: null, mystery_tie: null, is_major: false, days: ['Saturday'] },
  { event_type: 'social', headline: 'Sunday afternoon at the Lantern Post Inn: quiet, warm, and almost completely full.', detail: null, location_id: 'lantern_post_inn', citizen_id: 'teddy_birch', mystery_tie: null, is_major: false, days: ['Sunday'] },
]

async function generateDailyWorldEvent(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  gameDate: string,
  gameSeason: string,
  dayOfWeek: string
): Promise<void> {
  // Filter pool by season and day constraints
  const eligible = EVENT_POOL.filter(e => {
    if (e.seasons && !e.seasons.includes(gameSeason)) return false
    if (e.days && !e.days.includes(dayOfWeek)) return false
    return true
  })

  if (!eligible.length) return

  // Check what events have run recently to avoid immediate repeats
  const sevenDaysAgo = new Date(gameDate)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const { data: recentEvents } = await supabase
    .from('world_events')
    .select('headline')
    .gte('game_date', sevenDaysAgo.toISOString().slice(0, 10))

  const recentHeadlines = new Set((recentEvents ?? []).map((e: { headline: string }) => e.headline))
  const fresh = eligible.filter(e => !recentHeadlines.has(e.headline))
  const pool = fresh.length > 0 ? fresh : eligible

  // Pick randomly
  const chosen = pool[Math.floor(Math.random() * pool.length)]

  await supabase.from('world_events').insert({
    game_date: gameDate,
    event_type: chosen.event_type,
    headline: chosen.headline,
    detail: chosen.detail,
    location_id: chosen.location_id,
    citizen_id: chosen.citizen_id,
    mystery_tie: chosen.mystery_tie,
    is_major: chosen.is_major,
  })
}

/**
 * Brindlewick database seeder
 * Reads all content from /content/ and upserts into Supabase.
 *
 * Run: npx tsx scripts/seed.ts
 *
 * Requires environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

// Load .env.local so the script works when run directly via `npm run seed`
config({ path: path.resolve(process.cwd(), '.env.local') })

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})

const CONTENT = path.join(process.cwd(), 'content')

function readJSON(relPath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(CONTENT, relPath), 'utf8'))
}

async function upsert(table: string, rows: Record<string, unknown>[], conflictCol = 'id') {
  if (!rows.length) return
  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictCol })
  if (error) {
    console.error(`  ✗ ${table}:`, error.message)
    throw error
  }
  console.log(`  ✓ ${table}: ${rows.length} rows`)
}

// ── Locations ─────────────────────────────────────────────────────────────────

async function seedLocations() {
  console.log('\nSeeding locations…')
  const raw = readJSON('locations.json') as {
    locations: Array<{
      id: string
      name: string
      type: string
      area: string
      short_desc: string
      long_desc: string
      history_text?: string
      seasonal_variant_spring?: string
      seasonal_variant_summer?: string
      seasonal_variant_autumn?: string
      seasonal_variant_winter?: string
      time_variant_morning?: string
      time_variant_afternoon?: string
      time_variant_evening?: string
      time_variant_night?: string
      mystery_tie?: string
      is_hidden?: boolean
      unlock_condition?: string
      exits?: string[]
      npcs_frequent?: string[]
      items_present?: string[]
    }>
  }

  const locations = raw.locations.map(l => ({
    id: l.id,
    name: l.name,
    type: l.type,
    area: l.area,
    short_desc: l.short_desc,
    long_desc: l.long_desc,
    history_text: l.history_text ?? null,
    seasonal_variant_spring: l.seasonal_variant_spring ?? null,
    seasonal_variant_summer: l.seasonal_variant_summer ?? null,
    seasonal_variant_autumn: l.seasonal_variant_autumn ?? null,
    seasonal_variant_winter: l.seasonal_variant_winter ?? null,
    time_variant_morning: l.time_variant_morning ?? null,
    time_variant_afternoon: l.time_variant_afternoon ?? null,
    time_variant_evening: l.time_variant_evening ?? null,
    time_variant_night: l.time_variant_night ?? null,
    mystery_tie: l.mystery_tie ?? null,
    is_hidden: l.is_hidden ?? false,
    unlock_condition: l.unlock_condition ?? null,
  }))

  await upsert('locations', locations)

  // Seed exits (location_exits table) — skip any that reference unknown location IDs
  const dirData = readJSON('exit_directions.json') as { directions: Record<string, string> }
  const dirMap = dirData.directions

  const knownIds = new Set(raw.locations.map(l => l.id))
  const exits: Array<{ from_loc: string; to_loc: string; label: string }> = []
  for (const loc of raw.locations) {
    for (const toId of loc.exits ?? []) {
      if (knownIds.has(toId)) {
        const key = `${loc.id}:${toId}`
        const label = dirMap[key] ?? toId.replace(/_/g, ' ')
        if (!dirMap[key]) {
          console.warn(`  ⚠ no direction mapping for ${key} — using destination name`)
        }
        exits.push({ from_loc: loc.id, to_loc: toId, label })
      } else {
        console.warn(`  ⚠ skipping exit ${loc.id} → ${toId} (unknown location)`)
      }
    }
  }
  if (exits.length) {
    // Delete all existing exits first so stale rows (e.g. self-references) are removed
    const { error: delErr } = await supabase.from('location_exits').delete().neq('from_loc', '')
    if (delErr) console.error('  ✗ location_exits delete:', delErr.message)
    const { error } = await supabase.from('location_exits').insert(exits)
    if (error) console.error('  ✗ location_exits:', error.message)
    else console.log(`  ✓ location_exits: ${exits.length} rows`)
  }
}

// ── Citizens ──────────────────────────────────────────────────────────────────

async function seedCitizens() {
  console.log('\nSeeding citizens…')

  // Principal citizens
  const principalRaw = readJSON('citizens/principal.json') as {
    citizens: Array<{
      id: string
      first_name: string
      last_name: string
      age: number
      gender: string
      occupation: string
      address: string
      household?: string[]
      personality?: string
      appearance?: string
      backstory?: string
      mystery_ties?: string[]
      trust_stages?: Record<string, string>
      routine?: Record<string, Record<string, string>>
      dialogue_topics?: Record<string, string>
      help_tasks?: Array<{ id: string; description: string; reward_lore: string; trust_gain?: number }>
      lore_fact?: string
      secret?: string
    }>
  }

  const principalList = (principalRaw as Record<string, unknown>).citizens
    ?? (principalRaw as Record<string, unknown>).principal_citizens
  if (!Array.isArray(principalList)) {
    console.error('  ✗ citizens/principal.json: expected a "citizens" or "principal_citizens" array at the top level')
    return
  }
  const principals = (principalList as typeof principalRaw.citizens).map(c => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    age: c.age,
    gender: c.gender,
    occupation: c.occupation,
    address: c.address,
    household: c.household ?? [],
    personality: c.personality ?? null,
    appearance: c.appearance ?? null,
    backstory: c.backstory ?? null,
    mystery_ties: c.mystery_ties ?? [],
    trust_stages: c.trust_stages ?? {},
    routine: c.routine ?? {},
    dialogue_topics: c.dialogue_topics ?? {},
    help_tasks: c.help_tasks ?? [],
    lore_fact: c.lore_fact ?? null,
    secret: c.secret ?? null,
    tier: 'principal',
  }))

  await upsert('citizens', principals)

  // Supporting citizens
  const supportingRawFile = readJSON('citizens/supporting.json') as Record<string, unknown>
  const supportingRaw = {
    citizens: (supportingRawFile.citizens ?? supportingRawFile.supporting_citizens) as Array<{
      id: string
      first_name: string
      last_name: string
      age: number
      gender: string
      occupation: string
      address: string
      household?: string[]
      personality_trait?: string
      routine?: Record<string, string>
      gossip?: string
      help_task?: { description: string; reward: string } | null
    }>
  }

  // Batch in chunks of 200 to avoid payload limits
  const BATCH = 200
  let i = 0
  for (let offset = 0; offset < supportingRaw.citizens.length; offset += BATCH) {
    const chunk = supportingRaw.citizens.slice(offset, offset + BATCH).map(c => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      age: c.age,
      gender: c.gender,
      occupation: c.occupation,
      address: c.address,
      household: c.household ?? [],
      personality: c.personality_trait ?? null,
      backstory: null,
      appearance: null,
      mystery_ties: [],
      trust_stages: {},
      routine: c.routine ? {
        weekday_morning: { any: c.routine.weekday_morning },
        weekday_afternoon: { any: c.routine.weekday_afternoon },
        evening: { any: c.routine.evening },
        weekend: { any: c.routine.weekend },
      } : {},
      dialogue_topics: c.gossip ? { gossip: c.gossip } : {},
      help_tasks: c.help_task ? [c.help_task] : [],
      lore_fact: null,
      secret: null,
      tier: 'supporting',
    }))

    const { error } = await supabase
      .from('citizens')
      .upsert(chunk, { onConflict: 'id' })

    if (error) {
      console.error(`  ✗ supporting citizens (batch ${i}):`, error.message)
      throw error
    }
    i++
    process.stdout.write(`\r  ✓ supporting citizens: ${Math.min(offset + BATCH, supportingRaw.citizens.length)}/${supportingRaw.citizens.length}`)
  }
  console.log()
}

// ── Mysteries ─────────────────────────────────────────────────────────────────

async function seedMysteries() {
  console.log('\nSeeding mysteries…')

  const raw = readJSON('mysteries.json') as {
    mysteries: Array<{
      id: string
      title: string
      depth: string
      summary: string
      resolution: string
      clues: Array<{
        id: string           // content string ID, e.g. "sv_clue_1"
        description: string
        source?: string      // what triggers this clue
        requires?: string | null  // prerequisite condition
        // legacy fields (not used in current content):
        location_id?: string
        citizen_id?: string
        item_id?: string
        requires_trust_level?: number
        unlock_condition?: string
        reveals?: string
      }>
    }>
  }

  const mysteries = raw.mysteries.map(m => ({
    id: m.id,
    title: m.title,
    depth: m.depth,
    summary: m.summary,
    resolution_text: m.resolution,
  }))

  await upsert('mysteries', mysteries)

  // Build a set of valid mystery IDs for FK validation downstream
  ;(globalThis as Record<string, unknown>).__seededMysteryIds = new Set(raw.mysteries.map(m => m.id))

  // Seed clue definitions
  // mystery_clues uses uuid PK — insert (not upsert) per mystery
  for (const mystery of raw.mysteries) {
    // delete existing clues for this mystery first so we can re-seed cleanly
    await supabase.from('mystery_clues').delete().eq('mystery_id', mystery.id)

    const clues = mystery.clues.map((clue, idx) => ({
      mystery_id: mystery.id,
      clue_id: clue.id,                                          // content string ID
      clue_order: idx,
      description: clue.description,
      source: clue.source ?? clue.citizen_id ?? clue.location_id ?? null,
      requires_condition: clue.requires ?? clue.unlock_condition ?? null,
      is_hidden: false,
    }))

    if (clues.length) {
      const { error } = await supabase.from('mystery_clues').insert(clues)
      if (error) console.error(`  ✗ mystery_clues (${mystery.id}):`, error.message)
    }
  }
  console.log(`  ✓ mystery_clues: seeded for ${raw.mysteries.length} mysteries`)
}

// ── Items ─────────────────────────────────────────────────────────────────────

async function seedItems() {
  console.log('\nSeeding items…')

  const raw = readJSON('items.json') as {
    items: Array<{
      id: string
      name: string
      type: string
      location?: string
      location_id?: string
      description: string
      can_take?: boolean
      lore_note?: string
      readable_content?: string
      mystery_tie?: string
      mystery_tie_2?: string
      requires_condition?: string
      use_on?: string
      // New fields (013)
      weight_class?: string
      rarity?: string
      impression_value?: number
      impression_category?: string
      is_ambient?: boolean
      is_consumable?: boolean
      vendor_citizen_id?: string
      price?: number
      current_state?: string
      base_state?: string
      state_transitions?: unknown
      season_availability?: string[]
      weather_trigger?: string
    }>
  }

  const validMysteryIds = (globalThis as Record<string, unknown>).__seededMysteryIds as Set<string> | undefined

  const items = raw.items.map(item => {
    const mysteryTie = item.mystery_tie ?? null
    if (mysteryTie && validMysteryIds && !validMysteryIds.has(mysteryTie)) {
      console.warn(`  ⚠ item "${item.id}" has unknown mystery_tie "${mysteryTie}" — setting to null`)
    }
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      location_id: item.location ?? item.location_id ?? null,
      description: item.description,
      can_take: item.can_take ?? false,
      lore_note: item.lore_note ?? null,
      readable_content: item.readable_content ?? null,
      mystery_tie: (mysteryTie && validMysteryIds?.has(mysteryTie)) ? mysteryTie : null,
      mystery_tie_2: item.mystery_tie_2 ?? null,
      requires_condition: item.requires_condition ?? null,
      // New fields (013)
      weight_class: item.weight_class ?? 'small',
      rarity: item.rarity ?? 'common',
      impression_value: item.impression_value ?? 0,
      impression_category: item.impression_category ?? null,
      is_ambient: item.is_ambient ?? false,
      is_consumable: item.is_consumable ?? false,
      vendor_citizen_id: item.vendor_citizen_id ?? null,
      price: item.price ?? null,
      current_state: item.current_state ?? item.base_state ?? null,
      base_state: item.base_state ?? null,
      state_transitions: item.state_transitions ?? null,
      season_availability: item.season_availability ?? null,
      weather_trigger: item.weather_trigger ?? null,
    }
  })

  await upsert('items', items)
}

// ── Citizen Item Preferences ──────────────────────────────────────────────────

async function seedCitizenItemPreferences() {
  console.log('\nSeeding citizen item preferences…')

  const raw = readJSON('citizen_item_preferences.json') as {
    citizen_item_preferences: Array<{
      citizen_id: string
      impression_category: string
      preference_multiplier: number
      reaction_positive: string | null
      reaction_negative: string | null
    }>
  }

  // Upsert on (citizen_id, impression_category)
  const rows = raw.citizen_item_preferences
  for (const row of rows) {
    const { error } = await supabase
      .from('citizen_item_preferences')
      .upsert(row, { onConflict: 'citizen_id,impression_category' })
    if (error) {
      console.error('  ✗ citizen_item_preferences:', error.message)
      throw error
    }
  }
  console.log(`  ✓ citizen_item_preferences: ${rows.length} rows`)
}

// ── Calendar ──────────────────────────────────────────────────────────────────

async function seedCalendar() {
  console.log('\nSeeding calendar events…')

  const raw = readJSON('calendar.json') as {
    annual_events: Array<{
      id: string
      name: string
      description?: string
      date?: { month?: number; day?: number; week?: number; day_of_week?: string }
      month?: number
      day?: number
      day_of_week?: string
      duration_days?: number
      setup_days_before?: number
      mystery_tie?: string | null
    }>
    weekly_events: Array<{
      id: string
      name: string
      description?: string
      day_of_week?: string
      schedule?: string
    }>
    monthly_events: Array<{
      id: string
      name: string
      description?: string
      schedule?: string
    }>
  }

  const events: Array<Record<string, unknown>> = []

  for (const e of raw.annual_events ?? []) {
    events.push({
      id: e.id,
      name: e.name,
      description: e.description ?? e.name,
      event_type: 'annual',
      month: e.date?.month ?? e.month ?? null,
      day: e.date?.day ?? e.day ?? null,
      day_of_week: e.date?.day_of_week ?? e.day_of_week ?? null,
      duration_days: e.duration_days ?? 1,
      setup_days_before: e.setup_days_before ?? 0,
      mystery_tie: e.mystery_tie ?? null,
    })
  }

  for (const e of raw.weekly_events ?? []) {
    events.push({
      id: e.id,
      name: e.name,
      description: e.description ?? e.name,
      event_type: 'weekly',
      month: null,
      day: null,
      day_of_week: e.day_of_week ?? null,
      duration_days: 1,
      setup_days_before: 0,
      mystery_tie: null,
    })
  }

  for (const e of raw.monthly_events ?? []) {
    events.push({
      id: e.id,
      name: e.name,
      description: e.description ?? e.name,
      event_type: 'monthly',
      month: null,
      day: null,
      day_of_week: null,
      duration_days: 1,
      setup_days_before: 0,
      mystery_tie: null,
    })
  }

  await upsert('calendar_events', events)
}

// ── Research ──────────────────────────────────────────────────────────────────

async function seedResearch() {
  console.log('\nSeeding research subjects…')

  const rawFile = readJSON('research.json') as Record<string, unknown>

  // Support both { subjects: [...] } and { research_system: { catalogue: [...] } }
  const subjects = (
    (rawFile.subjects as unknown[]) ??
    ((rawFile.research_system as Record<string, unknown>)?.catalogue as unknown[]) ??
    []
  ) as Array<{
    subject?: string   // catalogue format
    name?: string      // subjects format
    results: Array<{
      title: string
      source?: string        // catalogue format
      source_label?: string  // subjects format
      content: string
      mystery_tie?: string
      requires_condition?: string
      [key: string]: unknown // allow extra fields like requires_reverend_trust
    }>
  }>

  // research_subjects has uuid PK — delete and re-insert
  await supabase.from('research_results').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('research_subjects').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  for (const subject of subjects) {
    const subjectName = subject.name ?? subject.subject ?? 'Unknown'
    const { data: subjectRow, error: subErr } = await supabase
      .from('research_subjects')
      .insert({ subject: subjectName })
      .select('id')
      .single()

    if (subErr || !subjectRow) {
      console.error('  ✗ research_subjects:', subErr?.message)
      continue
    }

    const resultRows = (subject.results ?? []).map((r, idx) => ({
      subject_id: subjectRow.id,
      title: r.title,
      source_label: r.source_label ?? r.source ?? null,
      content: r.content,
      mystery_tie: r.mystery_tie ?? null,
      requires_condition: r.requires_condition ?? null,
      sort_order: idx,
    }))

    if (resultRows.length) {
      const { error: resErr } = await supabase.from('research_results').insert(resultRows)
      if (resErr) console.error(`  ✗ research_results (${subjectName}):`, resErr.message)
    }
  }
  console.log(`  ✓ research_subjects + results: ${subjects.length} subjects`)
}

// ── World State ───────────────────────────────────────────────────────────────

async function seedWorldState() {
  console.log('\nSeeding initial world state…')

  // Start on a pleasant autumn Tuesday
  const { error } = await supabase
    .from('world_state')
    .upsert({
      id: 1,
      game_date: '2024-10-08',
      game_season: 'autumn',
      day_of_week: 'Tuesday',
      last_tick_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) console.error('  ✗ world_state:', error.message)
  else console.log('  ✓ world_state: 1 row')
}

// ── Citizen Routines ──────────────────────────────────────────────────────────

async function seedCitizenRoutines() {
  console.log('\nSeeding citizen routines…')

  const principalRawFile = readJSON('citizens/principal.json') as Record<string, unknown>
  const principals = ((principalRawFile.citizens ?? principalRawFile.principal_citizens) as Array<{
    id: string
    routine?: Record<string, unknown>
  }>) ?? []

  // Get valid location IDs
  const { data: locRows } = await supabase.from('locations').select('id')
  const validLocs = new Set((locRows ?? []).map((l: { id: string }) => l.id))

  // Map invalid/shorthand location references to real location IDs
  const LOC_ALIAS: Record<string, string> = {
    // Market variants → town square
    farmers_market: 'town_square',
    farmers_market_brief: 'town_square',
    farmers_market_occasional: 'town_square',
    farmers_market_brief_appearance: 'town_square',
    farmers_market_reporting: 'town_square',
    farmers_market_book_stall: 'town_square',
    farmers_market_fabric_stall: 'town_square',
    farmers_market_flowers: 'town_square',
    farmers_market_flowers_stall: 'town_square',
    farmers_market_with_agnes: 'town_square',
    thornburys_farmers_market_table: 'town_square',
    sunday_market: 'town_square',
    // Inn variants
    inn_common_room: 'lantern_post_inn',
    lantern_post_inn_or_millpond_row_errands: 'lantern_post_inn',
    // Bakery variants
    copper_kettle_bakery_kitchen: 'copper_kettle_bakery',
    closed_personal_baking: 'copper_kettle_bakery',
    // Library variants
    library_archive: 'library',
    library_reading_or_town_walk: 'library',
    covered_bridge_research: 'library',
    // Chapel variants
    chapel: 'st_agathas_chapel',
    chapel_office: 'st_agathas_chapel',
    service: 'st_agathas_chapel',
    st_agathas_chapel_occasional: 'st_agathas_chapel',
    community_visits: 'st_agathas_chapel',
    // Bookshop variants
    book_nook_browsing: 'book_nook',
    book_nook_sunday_hours: 'book_nook',
    // Business variants
    aldermans_hardware_half_day: 'aldermans_hardware',
    candle_soap_shop_or_foraging: 'candle_soap_shop',
    chronicle_building_or_town_reporting: 'chronicle_building',
    webbs_watch_repair_half_day: 'webbs_watch_repair',
    practice_paperwork: 'dr_okafor_practice',
    // Civic variants
    town_hall_or_event_prep: 'town_hall',
    town_patrol_or_office: 'sheriffs_office',
    postal_route_all_of_brindlewick: 'post_office',
    fire_station_volunteer_work: 'fire_station',
    current_job_site: 'millpond_row',
    lakeside_park_statue_measurement_monthly: 'town_square',
    community_potluck_monthly: 'community_hall',
    // Wren & Whistle variants
    wren_and_whistle_with_agnes: 'wren_and_whistle',
    wren_and_whistle_with_constance: 'wren_and_whistle',
    // Lakeside variants
    lake_pier_fishing: 'lake_pier',
    lake_pier_reading: 'lake_pier',
    solo_lake_row: 'lake_pier',
    lakefront_boardwalk_walk: 'lakefront_boardwalk',
    lakefront_boardwalk_slow_walk: 'lakefront_boardwalk',
    lakefront_walk: 'lakefront_boardwalk',
    lakefront_sketch_work: 'lakefront_boardwalk',
    walk_lake_shore: 'lakefront_boardwalk',
    lake_sampling: 'lakeside_park',
    // Orchard/nature variants
    finch_family_orchard_walk: 'finch_family_orchard',
    orchard_or_cidery: 'finch_family_orchard',
    walk_copper_hill: 'brindlewick_trailhead',
    trail_maintenance: 'brindlewick_trailhead',
    // Estate variants
    alderman_estate_garden: 'alderman_estate',
    reading_in_estate: 'alderman_estate',
    // Diner
    millpond_diner_closed: 'millpond_diner',
    // Keepers cottage
    keepers_cottage_dinner_sometimes: 'keepers_cottage',
    // Off duty / home → nearby public spaces
    off_duty: 'lakefront_boardwalk',
    off_duty_walk: 'lakefront_boardwalk',
    home_garden: 'finch_family_orchard',
    home_or_gardening: 'finch_family_orchard',
    home_reading: 'book_nook',
    home_studying: 'library',
    home: 'lantern_post_inn',
    // Private residential addresses → nearest street location
    '12_birch_hollow_road': 'finch_lane',
    '3_birch_hollow_road': 'finch_lane',
    '7_finch_lane': 'finch_lane',
    '9_finch_lane': 'finch_lane',
    '18_maple_row': 'maple_row',
    '22_maple_row': 'maple_row',
    '31_maple_row': 'maple_row',
  }

  const VALID_DAYS = new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','weekday','weekend'])
  const VALID_SLOTS = new Set(['early_morning','morning','midday','afternoon','evening','night'])

  const rows: Array<{ citizen_id: string; day_of_week: string; time_slot: string; location_id: string }> = []

  for (const c of principals) {
    const routine = c.routine ?? {}
    for (const [dayKey, val] of Object.entries(routine)) {
      const resolveloc = (raw: string) => {
        if (validLocs.has(raw)) return raw
        return LOC_ALIAS[raw] ?? null
      }

      if (typeof val === 'object' && val !== null) {
        // Nested format: { monday: { morning: 'loc' } } or { weekdays: { morning: 'loc' } }
        const day = dayKey === 'weekdays' ? 'weekday' : dayKey
        if (!VALID_DAYS.has(day)) continue
        for (const [slot, rawLoc] of Object.entries(val as Record<string, string>)) {
          if (!VALID_SLOTS.has(slot)) continue
          const loc = resolveloc(rawLoc)
          if (!loc) continue
          rows.push({ citizen_id: c.id, day_of_week: day, time_slot: slot, location_id: loc })
        }
      } else if (typeof val === 'string') {
        // Flat format: { morning: 'loc' } or { wednesday_evening: 'loc' }
        const parts = dayKey.split('_')
        let day = 'weekday'
        let slot: string | null = null
        if (VALID_SLOTS.has(dayKey)) {
          slot = dayKey
        } else if (parts.length === 2 && VALID_DAYS.has(parts[0]) && VALID_SLOTS.has(parts[1])) {
          day = parts[0]
          slot = parts[1]
        }
        if (!slot) continue
        const loc = resolveloc(val)
        if (!loc) continue
        rows.push({ citizen_id: c.id, day_of_week: day, time_slot: slot, location_id: loc })
      }
    }
  }

  if (rows.length) {
    // Clear existing and re-insert
    await supabase.from('citizen_routines').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    const { error } = await supabase
      .from('citizen_routines')
      .upsert(rows, { onConflict: 'citizen_id,day_of_week,time_slot' })
    if (error) console.error('  ✗ citizen_routines:', error.message)
    else console.log(`  ✓ citizen_routines: ${rows.length} rows`)
  } else {
    console.log('  ⚠ citizen_routines: no valid rows found')
  }

  // Set home_location on citizens from their most common morning location
  // This is the fallback used when no routine matches the current time slot
  const homeByC: Record<string, string> = {}
  for (const row of rows) {
    if (row.time_slot === 'morning' && !homeByC[row.citizen_id]) {
      homeByC[row.citizen_id] = row.location_id
    }
  }
  for (const [citizenId, homeLoc] of Object.entries(homeByC)) {
    await supabase.from('citizens').update({ home_location: homeLoc }).eq('id', citizenId)
  }
  console.log(`  ✓ home_location: set for ${Object.keys(homeByC).length} citizens`)
}

// ── Help Tasks ────────────────────────────────────────────────────────────────

async function seedHelpTasks() {
  console.log('\nSeeding help_tasks…')

  const principalRawFile = readJSON('citizens/principal.json') as Record<string, unknown>
  const principals = ((principalRawFile.citizens ?? principalRawFile.principal_citizens) as Array<{
    id: string
    help_tasks?: Array<{ id: string; description: string; reward_lore?: string; trust_gain?: number }>
  }>) ?? []

  const rows: Array<Record<string, unknown>> = []
  for (const c of principals) {
    for (const t of (c.help_tasks ?? [])) {
      // Derive title from snake_case id: "organize_returned_books" → "Organize Returned Books"
      const title = t.id.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      rows.push({
        id: t.id,
        giver_citizen: c.id,
        title,
        description: t.description,
        reward_lore: t.reward_lore ?? null,
        trust_gain: t.trust_gain ?? 1,
        mystery_reveals: null,
        location_req: null,
        unlock_condition: null,
        is_tutorial: false,
      })
    }
  }

  if (rows.length) await upsert('help_tasks', rows)
  else console.log('  ⚠ help_tasks: no tasks found in principal.json')
}

// ── History ───────────────────────────────────────────────────────────────────

async function seedHistory() {
  // Town history is surfaced via Eleanor Finch's dialogue and the research system.
  console.log('\nSkipping separate history table (embedded in lore/research).')
}

// ── World Events ──────────────────────────────────────────────────────────────

async function seedWorldEvents() {
  console.log('\nSeeding world events (town chronicle)…')

  // Clear existing seeded events so this is idempotent
  await supabase.from('world_events').delete().lte('game_date', '2024-10-08')

  // Historical events: Oct 1-7 (before the player arrives Oct 8)
  const historicalEvents = [
    {
      game_date: '2024-10-01',
      event_type: 'mystery',
      headline: 'Fresh flowers appeared at the base of the Alderman statue — no one saw who left them.',
      detail: 'The flowers were mountain asters, which don\'t grow in the valley. Someone carried them from higher ground.',
      location_id: 'town_square',
      citizen_id: null,
      mystery_tie: null,
      is_major: true,
    },
    {
      game_date: '2024-10-02',
      event_type: 'discovery',
      headline: 'Fletcher Grange spotted what he described as "a regular pulse" in the lake light.',
      detail: 'He noted it in his logbook: three flashes, then a pause, repeating for almost an hour just after midnight.',
      location_id: 'lakeside_park',
      citizen_id: 'fletcher_grange',
      mystery_tie: null,
      is_major: true,
    },
    {
      game_date: '2024-10-03',
      event_type: 'social',
      headline: 'Teddy Birch repainted the inn\'s sign for the first time in eleven years.',
      detail: 'He used a slightly warmer shade of green. Most people haven\'t noticed. Teddy has noticed that most people haven\'t noticed.',
      location_id: 'lantern_post_inn',
      citizen_id: 'teddy_birch',
      mystery_tie: null,
      is_major: false,
    },
    {
      game_date: '2024-10-04',
      event_type: 'mystery',
      headline: 'The clocktower chimes skipped a beat at noon — an unusual hiccup in 168 years of reliable timekeeping.',
      detail: 'Rosalind Webb was seen examining the mechanism for the better part of the afternoon.',
      location_id: 'town_square',
      citizen_id: null,
      mystery_tie: null,
      is_major: true,
    },
    {
      game_date: '2024-10-05',
      event_type: 'discovery',
      headline: 'Eleanor Finch-Hartwell found a misfiled bundle of letters in the restricted archive.',
      detail: 'She has not yet said who they are from, or to whom they were addressed. She catalogued them under a new reference number and said nothing further.',
      location_id: 'library',
      citizen_id: 'eleanor_finch_hartwell',
      mystery_tie: null,
      is_major: true,
    },
    {
      game_date: '2024-10-06',
      event_type: 'weather',
      headline: 'A dense fog settled over Lake Mirrowell from before dawn until nearly noon.',
      detail: 'Fletcher Grange was seen on the water in a small rowboat at 5am. He returned with muddy boots and would not say where he had been.',
      location_id: 'lakeside_park',
      citizen_id: 'fletcher_grange',
      mystery_tie: null,
      is_major: false,
    },
    {
      game_date: '2024-10-07',
      event_type: 'social',
      headline: 'Agnes Perkins received a letter with no return address. She read it at the cider house and did not mention it to anyone.',
      detail: 'Artie Pryce, the retired postman, noted that the envelope was postmarked from within the valley — but not from a postal address he recognized.',
      location_id: null,
      citizen_id: 'agnes_perkins',
      mystery_tie: null,
      is_major: true,
    },
  ]

  const { error } = await supabase.from('world_events').insert(historicalEvents)
  if (error) {
    console.error('  ✗ world_events (historical):', error.message)
    throw error
  }
  console.log(`  ✓ world_events: ${historicalEvents.length} historical events`)
}

// ── Time Periods ─────────────────────────────────────────────────────────────

async function seedTimePeriods() {
  console.log('\nSeeding time periods…')

  const periods = [
    {
      id: 'pre_founding',
      name: 'Before the Town (1800–1808)',
      start_year: 1800,
      end_year: 1808,
      description: 'The valley existed long before anyone named it. A few trappers and Abenaki traders used the lake, but there was no settlement — only forest, granite ridgelines, and the silence of unclaimed land.',
      atmosphere: 'Dense forest presses to the water\'s edge. No paths, no mill sound, no church bells. The mountains look as they always have. Smoke rises from a single trapper\'s fire on the eastern bank.',
      population_desc: 'No permanent residents. Seasonal Abenaki camps, a handful of New England trappers passing through.',
      world_event: 'The valley is wilderness. No one yet knows what will be built here.',
    },
    {
      id: 'founding',
      name: 'The Founding Years (1809–1830)',
      start_year: 1809,
      end_year: 1830,
      description: 'Josiah Alderman arrived in 1809, led by a land grant and a letter from his father describing the lake. Elias Finch followed within the year, drawn by Josiah\'s letters home. By 1815, a dozen families had settled. By 1820, there was a mill, a schoolhouse, and a name: Brindlewick, for the brindle-colored doe Josiah saw drinking at the lake on the morning he arrived.',
      atmosphere: 'Raw lumber smell, fresh-turned soil, the sound of axes. The main road is a cart track. The lake is the center of everything — water, fish, washing, wonder.',
      population_desc: 'A dozen founding families: Aldermans, Finches, Birches, Webbs, Granges. Perhaps 80 people by 1820.',
      world_event: 'Town officially incorporated 1817. First post road reaches the valley 1824.',
    },
    {
      id: 'early_settlement',
      name: 'Growth Era (1831–1865)',
      start_year: 1831,
      end_year: 1865,
      description: 'Brindlewick grew slowly but steadily. A proper library was established in 1838, the clocktower was built in 1856, and by 1860 the population had reached nearly 300. The town square took its current shape in this era, with the Alderman statue commissioned for the 50th anniversary of the town in 1859.',
      atmosphere: 'A real town now — boardwalks, painted storefronts, the smell of the tannery and the bakehouse. The clocktower is new and everyone is proud of it. Children fish from the dock.',
      population_desc: 'Around 280 residents by 1865. Several second-generation families. First inn opens 1842.',
      world_event: 'Civil War affects the valley: 22 men leave in 1862-63, 17 return. A memorial list goes up on the library wall.',
    },
    {
      id: 'gilded',
      name: 'The Gilded Years (1866–1899)',
      start_year: 1866,
      end_year: 1899,
      description: 'The late 19th century was Brindlewick\'s most prosperous and most secretive era. The town reached its Victorian peak — formal gardens, a small hotel, the library expanded. But it was also the era of the great quarrel between the Aldermans and the Finches, and the year young Mira Finch died at seventeen and the lake was renamed for her.',
      atmosphere: 'Gas lamps on the square, ladies in good wool coats, men in hats. The library smells of beeswax and old paper. Everything looks a little more formal, a little more self-conscious.',
      population_desc: 'Population peaks near 400. A prosperous but insular community. Two prominent families — Alderman and Finch — in an unspoken cold war.',
      world_event: 'Mira Finch dies 1879, age 17. The lake renamed Mirrowell that same autumn. The Alderman-Finch quarrel of 1866 is never formally resolved.',
    },
    {
      id: 'early_modern',
      name: 'Early Modern (1900–1939)',
      start_year: 1900,
      end_year: 1939,
      description: 'The twentieth century arrived slowly in Brindlewick. The first motorcar appeared in 1911 and caused a minor scandal. The Great War took eleven young men; six came back. The Depression hit quietly — fewer visitors, the hotel closed, some families left. But the town endured. The bakery opened in 1937, founded by Adaeze Osei, who had come north from Philadelphia.',
      atmosphere: 'The town feels a little smaller than it used to. Fewer horses now, a few cars. The hotel is boarded up. But the library is well-used and the bakery is new and bright.',
      population_desc: 'Population around 320, declining slowly. Several farms sold or consolidated. New families arrive occasionally.',
      world_event: 'The Copper Kettle Bakery opens in 1937. Adaeze Osei becomes the first business owner of African descent in the valley.',
    },
    {
      id: 'mid_century',
      name: 'Mid-Century (1940–1990)',
      start_year: 1940,
      end_year: 1990,
      description: 'Brindlewick sat out most of the twentieth century\'s upheavals in characteristic quiet. The war touched it — rationing, absent men, women running the farms. Then came the postwar years, televisions appearing in windows, a proper paved road at last in 1957. The 1950 fire in the library annex destroyed the east reading room and rusted the iron fittings of the archive door beyond use.',
      atmosphere: 'Pickup trucks and transistor radios. The square looks much as it does now, though the trees are younger. The library smells of smoke, and the archive wing is still a little scorched around the edges.',
      population_desc: 'Stable around 280. Young people leave for college and cities; some return. The town is self-sufficient but no longer growing.',
      world_event: '1950 library fire damages east wing. 1957 road paved. Eleanor Finch-Hartwell begins her 42-year run of the "Dear Neighbor" column in 1968.',
    },
    {
      id: 'contemporary',
      name: 'Present Day (1991–now)',
      start_year: 1991,
      end_year: null,
      description: 'Brindlewick today. The internet arrived, but slowly. The town has a website nobody updates. Cell signal is weak near the water. The library is Eleanor\'s domain. The clocktower still runs three minutes slow — nobody has corrected it in 168 years. The lake light still appears. The statue still rotates.',
      atmosphere: 'Comfortable, unhurried, a little out of time. The kind of place where the same families have lived for generations and everyone knows everyone\'s business but is kind about it.',
      population_desc: 'About 290 residents. Steady now. The Osei bakery is in its third generation. The Finch-Hartwells run the library. The Webbs still fix clocks.',
      world_event: 'This is where you arrived. Everything you\'ve seen is here.',
    },
  ]

  await upsert('time_periods', periods)
}

// ── Historical Citizens ────────────────────────────────────────────────────────

async function seedHistoricalCitizens() {
  console.log('\nSeeding historical citizens…')

  const citizens = [
    // ── Founding Era ──
    {
      id: 'josiah_alderman',
      time_period_id: 'founding',
      first_name: 'Josiah',
      last_name: 'Alderman',
      birth_year: 1772,
      death_year: 1842,
      occupation: 'Farmer, town founder, first selectman',
      home_location: 'town_square',
      appearance: 'A large, weathered man in his late thirties when you see him here. Dark wool coat, boots caked with the kind of mud that never quite comes off. His hands are the size of paddles. He has a direct, unhurried way of looking at you.',
      personality: 'Patient, stubborn, occasionally visionary. He doesn\'t waste words. Deeply proud of what he and Elias built, though he would never say so aloud.',
      dialogue_topics: {
        greeting: ['You\'re new to the valley. That makes two of us, in a way — I\'ve been here three years and it still surprises me every morning.', 'Josiah Alderman. I founded this place, though "founded" is a grand word for what was mostly just refusing to leave when the first winter hit.'],
        town: ['We call it Brindlewick. For the deer I saw drinking at the lake when I first arrived. A brindle doe, just standing there like she owned the place. I suppose she did.', 'Elias Finch and I laid the first road ourselves. Eighteen days with two axes and a borrowed plow horse.'],
        lake: ['The lake is what made this possible. Clean water, fish, a good bottom for a mill dam. Every good thing about this town starts with the lake.', 'I don\'t know what the light is. The one some people see at night. I\'ve seen it myself twice. I leave it alone.'],
        future: ['I hope it lasts. That\'s all I ask. I hope someone is here in a hundred years saying the name right.'],
      },
    },
    {
      id: 'elias_finch',
      time_period_id: 'founding',
      first_name: 'Elias',
      last_name: 'Finch',
      birth_year: 1780,
      death_year: 1851,
      occupation: 'Schoolmaster, first librarian of Brindlewick',
      home_location: 'library',
      appearance: 'Slight, quick-moving, with ink-stained fingers and a tendency to gesture broadly when he\'s making a point. His coat is good wool, slightly too large, the kind you inherit rather than buy.',
      personality: 'Curious, generous, occasionally distracted. He believes in education with the particular fervor of someone who mostly taught himself. The library was his idea.',
      dialogue_topics: {
        greeting: ['Elias Finch. I keep the books — what few we have. Every family in town has donated at least one, which is more than I expected.', 'You\'ll want to know about the town, I expect. I\'ve written most of it down. It\'s a habit I can\'t shake.'],
        library: ['This room will be a proper library one day. I can feel it. Josiah thinks I\'m optimistic. He is not wrong.', 'We have forty-three books. I know each one. If you\'re looking for something specific, ask me.'],
        town: ['The name was Josiah\'s. The roads were Josiah\'s. The library was mine. I consider that a fair division.'],
        future: ['I want my grandchildren to be able to read the history of this place. That\'s what I write for.'],
      },
    },

    // ── Growth / Gilded Era ──
    {
      id: 'cornelius_webb',
      time_period_id: 'early_settlement',
      first_name: 'Cornelius',
      last_name: 'Webb',
      birth_year: 1828,
      death_year: 1901,
      occupation: 'Clockmaker, mechanical engineer',
      home_location: 'town_square',
      appearance: 'A compact, deliberate man with silver-shot dark hair and hands that seem to always be calculating something even when still. He wears a clockmaker\'s glass on a cord around his neck. There is gear oil on his cuff.',
      personality: 'Precise, warm, privately romantic. He speaks about machines the way other men speak about poetry. His friendship with Thomas Alderman is the deepest thing in his life.',
      dialogue_topics: {
        greeting: ['Cornelius Webb. I build and repair clocks. Also, apparently, statues. That was an unexpected commission.', 'Good morning. Or good afternoon. I could tell you precisely, if you\'d like.'],
        statue: ['The mechanism is my own design. I won\'t say more than that — it\'s a gift, and gifts lose something when explained.', 'It took three years to build the internal work. I finished it the night before the dedication and had four hours of sleep. Worth it.'],
        clocktower: ['The clocktower clock runs three minutes slow. I set it that way. It\'s a private joke between Thomas and me — he is constitutionally incapable of being anywhere on time. The clock keeps him company in his lateness.', 'If anyone ever corrects it, I\'ll know they didn\'t understand.'],
        thomas: ['Thomas Alderman is my closest friend. Has been since we were boys. He is late to everything, loses his hat constantly, and is one of the best people I know.'],
        mechanism: ['Mercury float bearing. Temperature differential as the drive. One full rotation per year, completing at the winter solstice. Alderman Finch loved the stars — I thought he would have wanted his statue to track them.', 'No one knows how it works. That is intentional. Some things should keep their secrets for a while.'],
      },
    },
    {
      id: 'thomas_alderman',
      time_period_id: 'early_settlement',
      first_name: 'Thomas',
      last_name: 'Alderman',
      birth_year: 1835,
      death_year: 1892,
      occupation: 'Selectman, farmer',
      home_location: 'town_square',
      appearance: 'Tall, always slightly rumpled, with Josiah\'s build but none of his father\'s solemnity. His hair looks like he\'s been outside. His hat, when he has it, is on the wrong hook. He is late.',
      personality: 'Warm, easily distracted, genuinely kind. He carries a sadness he never discusses. If you know about Eleanor Finch, you understand the sadness.',
      dialogue_topics: {
        greeting: ['Thomas Alderman. I\'m almost certainly late for something. Cornelius says I\'m exactly three minutes late for everything, which is apparently intentional on someone\'s part.', 'Sorry — I was just thinking. Thomas. Thomas Alderman. My grandfather started the town.'],
        cornelius: ['Cornelius Webb is my oldest friend. He once set the clocktower three minutes slow on my account. That is the kindest thing anyone has ever done for me.'],
        eleanor: ['Eleanor Finch and I — that\'s not something I\'ll discuss. Some things are private, even in a small town.', 'She was — she is — let\'s talk about something else.'],
        statue: ['Cornelius did something extraordinary with the statue. He won\'t tell me what. I\'ve been watching it for three years and I\'m starting to understand it. I think it moves.'],
        sealed_room: ['There\'s a room in the library archive that Eleanor and I used to use for — correspondence. Private correspondence. I suppose it\'s been locked for a while now.'],
      },
    },
    {
      id: 'eleanor_finch_ancestor',
      time_period_id: 'gilded',
      first_name: 'Eleanor',
      last_name: 'Finch',
      birth_year: 1842,
      death_year: 1918,
      occupation: 'Librarian, archivist',
      home_location: 'library',
      appearance: 'A woman in her middle twenties, with the Finch family\'s dark eyes and precise, economical movements. She wears a good dark dress and keeps her hair pinned neatly. She does not smile often, but when she does it changes her face entirely.',
      personality: 'Reserved, meticulous, with a private wit she almost never shows. She is in love with Thomas Alderman and has been for four years. She is also furious with him for something that happened last spring, and she may never tell him why. The letters she keeps in the archive room are addressed to him.',
      dialogue_topics: {
        greeting: ['Eleanor Finch. I keep this library. If you need something, I can usually find it.', 'I don\'t believe we\'ve met. I would remember.'],
        library: ['My grandfather Elias started this collection. I intend to finish it properly — a real catalogue, a real archive. The misfiled papers alone are taking me months.'],
        thomas: ['Thomas Alderman is a public figure and I have nothing to say about him in that capacity.', 'If you\'re asking whether we are friends — we were. Things change.'],
        sealed_room: ['The room at the back of the archive is for private correspondence and research materials. It is not open to the general public.', 'If you have business there, you may ask me. But I will decide whether it\'s appropriate.'],
        letters: ['I don\'t know what letters you mean. The archive has a great many letters. That is what archives are for.'],
      },
    },
    {
      id: 'mira_finch_historical',
      time_period_id: 'early_settlement',
      first_name: 'Mira',
      last_name: 'Finch',
      birth_year: 1862,
      death_year: 1879,
      occupation: 'Student',
      home_location: 'lakeside_park',
      appearance: 'A girl of nine or ten, with ink on her fingers and a book tucked under one arm. She has her grandmother\'s dark eyes and a habit of looking at you very directly, as though she\'s already figured out what you\'re going to say.',
      personality: 'Curious, brave, completely unselfconscious. She has opinions about everything and shares them freely. She is not afraid of the lake.',
      dialogue_topics: {
        greeting: ['I\'m Mira. Mira Finch. My grandmother runs the library.', 'Hello. Are you lost? Most visitors to the lake are lost.'],
        lake: ['The lake doesn\'t have a name yet. Not a real one. People call it "the lake" or "the Alderman lake" but that\'s not right. I\'m going to name it.', 'I think lakes should have names. Everything should have a proper name.'],
        mirrowell: ['I think I\'ll call it Mirrowell. Because of the way it mirrors the sky, and because "well" sounds like it goes all the way down. Which it does. I checked.', 'Mirrowell. Yes. I like that.'],
        light: ['I\'ve seen the light. Three times. It\'s not scary — it\'s like something breathing under the water. I wrote it down.'],
      },
    },
    {
      id: 'adaeze_osei',
      time_period_id: 'early_modern',
      first_name: 'Adaeze',
      last_name: 'Osei',
      birth_year: 1908,
      death_year: 1981,
      occupation: 'Bakery owner, pastry chef',
      home_location: 'copper_kettle_bakery',
      appearance: 'A woman in her late twenties with flour on her apron and the contained energy of someone who has been awake since four in the morning and intends to stay awake until everything is done. Her hands are quick and sure.',
      personality: 'Direct, generous, matter-of-fact about extraordinary things. She came from Philadelphia. She opened the bakery in a town that had no reason to welcome her, and she won it over in about six months with honey cake.',
      dialogue_topics: {
        greeting: ['Adaeze Osei. I own this bakery. Try the honey cake — it\'s a new recipe. I\'m still working it out.', 'You\'re new in town. Good. New people ask better questions.'],
        bakery: ['I opened this place in 1937. Everyone thought I was either brave or foolish. I thought I was just hungry, and tired of places without good pastry.', 'The recipe I\'m working on — honey cake — it needs something. I know what it tastes like, I just don\'t have the right honey yet.'],
        town: ['Brindlewick is a strange place. I mean that well. People here actually let you be a person before they decide who you are. That\'s rarer than it should be.'],
        honey: ['There\'s a beekeeper in the high orchard — old Perkins woman — who has hives up where the alpine flowers grow. Her honey is different. I haven\'t been able to get it yet.'],
      },
    },
  ]

  await upsert('historical_citizens', citizens)
}

// ── Historical Location Descriptions ─────────────────────────────────────────

async function seedHistoricalLocations() {
  console.log('\nSeeding historical location descriptions…')

  const descriptions = [
    // Town Square
    {
      location_id: 'town_square',
      time_period_id: 'founding',
      description: 'A clearing in the trees, more mud than square, with a young oak sapling at its center that Josiah Alderman planted the first spring. Two log buildings face each other across the open ground. The smell of fresh sawdust is everywhere. This will be the heart of something — you can feel it, even now.',
      seasonal_notes: 'In winter, the clearing fills with snow and children use it as a sliding hill. In spring, the mud is impressive.',
      special_note: 'The Alderman statue does not yet exist. The oak sapling is where it will one day stand.',
    },
    {
      location_id: 'town_square',
      time_period_id: 'early_settlement',
      description: 'The square has taken shape now — a proper rectangle of packed dirt and boardwalk, with the general store on the north side and the church on the south. The clocktower was completed two years ago and everyone is still proud of it. In the center, on a granite plinth, stands the new bronze statue of Josiah Alderman. It is very still, and yet something about it feels slightly different each time you look.',
      seasonal_notes: 'The market sets up Saturdays in summer. Autumn brings a harvest gathering.',
      special_note: 'You can watch workers putting the finishing touches on the statue installation. Cornelius Webb is here, overseeing something in the base of the plinth.',
    },
    {
      location_id: 'town_square',
      time_period_id: 'gilded',
      description: 'The square at its Victorian peak. Gas lamps on iron posts. Well-dressed citizens crossing the boardwalks. The statue of Josiah Alderman stands in the center, and if you watch it long enough on a clear night, you might notice it has rotated slightly from yesterday\'s position. No one who notices mentions it aloud.',
      seasonal_notes: 'The autumn festival is a major event in this era — bunting, a brass band, speeches.',
      special_note: null,
    },
    // Library
    {
      location_id: 'library',
      time_period_id: 'founding',
      description: 'This is Elias Finch\'s front room, pressed into service as the town\'s first library. Three shelves of books, a writing desk, and a fire going. Elias himself is probably here, cataloguing something. The books smell of other houses.',
      seasonal_notes: null,
      special_note: 'The archive room, the main reading hall, the stacks — none of these exist yet. It is a beginning.',
    },
    {
      location_id: 'library',
      time_period_id: 'early_settlement',
      description: 'The library has been moved into its own building now, a proper two-story structure with tall windows. The main collection is on the ground floor. Upstairs, the archive is just taking shape under Elias\'s direction. It smells of leather bindings and beeswax. A sign on the door reads: *BRINDLEWICK PUBLIC LIBRARY. Elias Finch, Librarian.*',
      seasonal_notes: null,
      special_note: 'The clocktower can be seen from the library windows. The reading room has a fireplace that actually draws.',
    },
    {
      location_id: 'library',
      time_period_id: 'gilded',
      description: 'The library in its finest form. Tall oak shelves, a reading room with upholstered chairs, the archive fully catalogued in Eleanor Finch\'s precise hand. The light through the high windows falls in columns. Eleanor is at the main desk, probably. She is always at the main desk.',
      seasonal_notes: null,
      special_note: 'The archive room at the back is accessible in this era. Its lock is a new iron mechanism, recently installed — bright, unrusted, and functional.',
    },
    {
      location_id: 'library',
      time_period_id: 'mid_century',
      description: 'The library still stands, but the east wing smells faintly of old smoke — the 1950 fire. The archive room door has a new padlock, the old iron mechanism rusted shut after the fire brigade soaked everything. Someone has written "ARCHIVE — INQUIRE AT DESK" on a card pinned to the door. The card is yellowing.',
      seasonal_notes: null,
      special_note: 'The archive room door uses a padlock now. The original iron lock is rusted solid beneath it.',
    },
    // Lakeside Park
    {
      location_id: 'lakeside_park',
      time_period_id: 'founding',
      description: 'The lakeshore before there was a dock, a park, or a name for the water. Forest to the water\'s edge, a narrow strip of gravel beach. The lake is extraordinary — deep blue-black, mirror-still this morning, reflecting the mountains perfectly. You understand immediately why someone would decide to stay.',
      seasonal_notes: 'In autumn the reflection is best. In winter, the lake freezes solid enough to walk on.',
      special_note: 'There is no name on the lake yet. It will be called Mirrowell one day, but not yet.',
    },
    {
      location_id: 'lakeside_park',
      time_period_id: 'early_settlement',
      description: 'The dock has been built now, and there\'s a small boathouse at the water\'s edge. Children fish from the dock. Families walk here on Sunday afternoons. The lake is still nameless — people call it "the lake" or "Alderman\'s water" — but a nine-year-old named Mira Finch has been seen here with a notebook, looking thoughtful.',
      seasonal_notes: null,
      special_note: 'You may find Mira Finch here. She is nine years old and has decided to name the lake.',
    },
    {
      location_id: 'lakeside_park',
      time_period_id: 'gilded',
      description: 'Mirrowell, as the lake is called now. A proper park has grown up around the shore — benches, a bandstand, a proper dock with a railing. The water is the same uncanny blue-black as always. In 1879, a girl named Mira Finch died at seventeen, and the lake was renamed for her. That was this year. The benches near the water have fresh-cut flowers on them.',
      seasonal_notes: null,
      special_note: 'The lake now bears the name Mirrowell. The grief is fresh here.',
    },
    // Copper Kettle Bakery
    {
      location_id: 'copper_kettle_bakery',
      time_period_id: 'early_modern',
      description: 'The bakery is new — the paint still smells of linseed, the counter is unstained pine. Adaeze Osei is here, almost certainly, moving between the oven and the counter with a focus that does not invite small talk unless she invites it first. There is something baking that you cannot identify yet, but it smells extraordinary.',
      seasonal_notes: null,
      special_note: 'This is 1937. The bakery has been open perhaps three months. The honey cake recipe is still being developed — the missing ingredient has not been found yet.',
    },
  ]

  // Use delete+insert because of composite UNIQUE on (location_id, time_period_id)
  await supabase.from('historical_location_descriptions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { error } = await supabase.from('historical_location_descriptions').insert(descriptions)
  if (error) {
    console.error('  ✗ historical_location_descriptions:', error.message)
    throw error
  }
  console.log(`  ✓ historical_location_descriptions: ${descriptions.length} rows`)
}

// ── Historical Items ──────────────────────────────────────────────────────────

async function seedHistoricalItems() {
  console.log('\nSeeding historical items…')

  const items = [
    {
      id: 'statue_installation_tools',
      name: 'Cornelius Webb\'s Installation Equipment',
      description: 'A wooden crate beside the statue plinth holds a collection of precision instruments — a mercury barometer, fine steel rods, a sealed glass flask, and tools whose purpose is not immediately obvious. Cornelius Webb is nearby, and he watches the crate with the attention of someone who built everything in it.',
      location_id: 'town_square',
      time_period_id: 'early_settlement',
      lore_note: 'If you examine this closely while Cornelius is here, he will explain more than he ordinarily would.',
      mystery_tie: 'moving_statue',
      reveals_clue: 'The statue mechanism uses a mercury float bearing and temperature differential drive — Cornelius Webb\'s design. It completes one full rotation per year, ending at the winter solstice.',
    },
    {
      id: 'love_letters_bundle',
      name: 'Bundle of Letters, Tied with Black Ribbon',
      description: 'A thick bundle of letters on good cream paper, tied with a black ribbon that has faded to grey. The handwriting on the top envelope is restrained and precise — the kind of handwriting that took effort to contain. They are addressed to Mr. T. Alderman, in care of the library. There are perhaps thirty of them, spanning several years.',
      location_id: 'library',
      time_period_id: 'gilded',
      lore_note: null,
      mystery_tie: 'founders_hidden_room',
      reveals_clue: 'Eleanor Finch wrote thirty-one letters to Thomas Alderman between 1866 and 1872. He wrote back. Neither sent any of them. They kept the letters in the archive room instead — a conversation conducted entirely without being spoken aloud.',
    },
    {
      id: 'mira_notebook',
      name: 'Mira\'s Naming Notebook',
      description: 'A small cloth-covered notebook, its pages dense with a child\'s handwriting. This page reads: *Lake names I have considered: (1) Glasswater (2) Deeplook (3) Mirrorwell (crossed out, too plain) (4) Mirrowell (yes, this is right, I can feel it). I am going to name this lake Mirrowell. I am nine years old and I live here and I believe I have the right.*',
      location_id: 'lakeside_park',
      time_period_id: 'early_settlement',
      lore_note: 'Mira Finch named this lake in 1871. She died eight years later, at seventeen. The town named the lake officially for her that autumn.',
      mystery_tie: null,
      reveals_clue: null,
    },
    {
      id: 'alderman_family_emerald',
      name: 'Finch Family Emerald Brooch',
      description: 'A small brooch of green river-stone set in silver, clearly old and clearly cared-for. It was Elias Finch\'s wife\'s. When Eleanor came to the archive room to leave the final bundle of letters, she left this as well — not for Thomas, exactly. Just left behind.',
      location_id: 'library',
      time_period_id: 'gilded',
      lore_note: 'Left in the archive room when Eleanor Finch sealed her last bundle of letters.',
      mystery_tie: 'founders_hidden_room',
      reveals_clue: null,
    },
    {
      id: 'cornelius_clockwork_journal',
      name: 'Cornelius Webb\'s Private Journal, 1856–1860',
      description: 'A slim green journal with a lock that has been forced open sometime in the last century. The entries are technical but human: measurements, diagrams, and occasional personal notes. One entry, dated June 1858, reads: *The mercury float is working. One year per rotation. At winter solstice it will face true north. I am building a year into this thing, a whole year\'s worth of patience, and I am giving it to the town as a gift. They will not know it is turning. They will think it is still. That is the best kind of gift — the kind that moves while you sleep.*',
      location_id: 'library',
      time_period_id: 'early_settlement',
      lore_note: 'Cornelius Webb\'s working notes on the statue mechanism. Held in the library archive.',
      mystery_tie: 'moving_statue',
      reveals_clue: 'Cornelius Webb built a year-long clockwork mechanism into the Alderman statue\'s plinth. It uses a mercury float bearing to complete exactly one rotation per year, aligned to winter solstice — a secret gift to the town from its clockmaker.',
    },
  ]

  await upsert('historical_items', items)
}

// ── Citizen Item Behaviors ────────────────────────────────────────────────────

async function seedCitizenItemBehaviors() {
  console.log('\nSeeding citizen item behaviors…')

  const raw = readJSON('citizen_item_behaviors.json') as {
    citizen_item_behaviors: Array<{
      citizen_id: string
      trigger_type: string
      trigger_condition: string | null
      action_type: string
      item_id: string
      target_citizen_id?: string | null
      once_only: boolean
      dialogue_hint: string | null
      sort_order?: number
    }>
  }

  // Clear and re-seed so edits to the JSON are always reflected
  await supabase.from('citizen_item_behaviors').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const rows = raw.citizen_item_behaviors.map(b => ({
    citizen_id:       b.citizen_id,
    trigger_type:     b.trigger_type,
    trigger_condition: b.trigger_condition ?? null,
    action_type:      b.action_type,
    item_id:          b.item_id,
    target_citizen_id: b.target_citizen_id ?? null,
    once_only:        b.once_only,
    dialogue_hint:    b.dialogue_hint ?? null,
    sort_order:       b.sort_order ?? 0,
  }))

  const { error } = await supabase.from('citizen_item_behaviors').insert(rows)
  if (error) {
    console.error('  ✗ citizen_item_behaviors:', error.message)
    throw error
  }
  console.log(`  ✓ citizen_item_behaviors: ${rows.length} rows`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌿 Brindlewick seed script starting…')
  console.log(`   Supabase: ${supabaseUrl}`)

  try {
    await seedWorldState()
    await seedLocations()
    await seedCitizens()
    await seedHelpTasks()
    await seedCitizenRoutines()
    await seedMysteries()
    await seedItems()
    await seedCalendar()
    await seedResearch()
    await seedHistory()
    await seedWorldEvents()
    await seedTimePeriods()
    await seedHistoricalCitizens()
    await seedHistoricalLocations()
    await seedHistoricalItems()
    await seedCitizenItemBehaviors()
    await seedCitizenItemPreferences()

    console.log('\n✅ Seed complete.\n')
  } catch (err) {
    console.error('\n❌ Seed failed:', err)
    process.exit(1)
  }
}

main()

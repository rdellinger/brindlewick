// ── World ────────────────────────────────────────────────────────────────────

export interface WorldState {
  id: number
  game_date: string        // ISO date string
  game_season: Season
  day_of_week: string
  time_scale: string
  last_tick_at: string
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type TimeSlot = 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'

// ── Locations ────────────────────────────────────────────────────────────────

export interface Location {
  id: string
  name: string
  type: string
  area: string | null
  short_desc: string
  long_desc: string
  history_text: string | null
  is_hidden: boolean
  unlock_condition: string | null
  boat_required: boolean
  is_locked: boolean
  seasonal_variant_spring: string | null
  seasonal_variant_summer: string | null
  seasonal_variant_autumn: string | null
  seasonal_variant_winter: string | null
  time_variant_morning: string | null
  time_variant_afternoon: string | null
  time_variant_evening: string | null
  time_variant_night: string | null
  mystery_tie: string | null
  research_available: boolean
}

export interface LocationExit {
  from_loc: string
  to_loc: string
  label: string | null
}

// ── Citizens ─────────────────────────────────────────────────────────────────

export interface Citizen {
  id: string
  first_name: string
  last_name: string
  nickname: string | null
  age: number | null
  gender: string | null
  occupation: string | null
  address: string | null
  home_location: string | null
  work_location: string | null
  tier: 'principal' | 'supporting'
  personality: string | null
  appearance: string | null
  backstory: string | null
  trust_max: number
  is_mystery_related: boolean
}

export interface CitizenDialogue {
  id: string
  citizen_id: string
  topic: string
  content: string
  min_trust: number
  mystery_tie: string | null
  once_only: boolean
}

export interface CitizenLore {
  id: string
  citizen_id: string
  lore_text: string
  gossip_text: string | null
  mystery_tie: string | null
  min_trust: number
}

// ── Player ───────────────────────────────────────────────────────────────────

export interface PlayerSave {
  id: string
  player_id: string | null
  current_location: string
  inventory: string[]
  session_token: string | null
  game_date_when_saved: string | null
  updated_at: string
}

export interface GuestSave {
  id: string
  session_token: string
  current_location: string
  inventory: string[]
  data: Record<string, unknown>
  updated_at: string
  expires_at: string
}

export interface PlayerTrust {
  citizen_id: string
  trust_level: number
  first_met_at: string
  last_interaction: string
}

export interface MysteryProgress {
  mystery_id: string
  clues_found: string[]
  is_resolved: boolean
  resolved_at: string | null
}

export interface JournalEntry {
  id: string
  entry_type: JournalEntryType
  title: string
  content: string
  related_id: string | null
  game_date: string | null
  created_at: string
}

export type JournalEntryType =
  | 'location_visited'
  | 'citizen_met'
  | 'lore_discovered'
  | 'mystery_clue'
  | 'task_completed'
  | 'event_witnessed'
  | 'item_found'
  | 'note'

export interface TaskProgress {
  task_id: string
  status: 'available' | 'in_progress' | 'completed'
  started_at: string | null
  completed_at: string | null
}

// ── Game Session ─────────────────────────────────────────────────────────────

export interface GameSession {
  playerId: string | null
  guestToken: string | null
  currentLocation: string
  inventory: string[]
  worldState: WorldState
  timePosition: string | null    // null = present; ISO date string = historical
  hasChronoLogbook: boolean
}

// ── Time Travel ───────────────────────────────────────────────────────────────

export interface TimePeriod {
  id: string
  name: string
  start_year: number
  end_year: number | null        // null = ongoing
  description: string
  atmosphere: string | null
  population_desc: string | null
  world_event: string | null
}

export interface HistoricalCitizen {
  id: string
  time_period_id: string
  first_name: string
  last_name: string
  birth_year: number | null
  death_year: number | null
  occupation: string | null
  home_location: string | null
  appearance: string | null
  personality: string | null
  dialogue_topics: Record<string, string[]>
}

export interface TemporalChange {
  id: string
  player_id: string | null
  guest_token: string | null
  change_type: string
  target_type: string
  target_id: string
  change_date: string
  effect_present: string
  mystery_reveal: string | null
  clue_text: string | null
  is_permanent: boolean
  created_at: string
}

export interface PlayerInteraction {
  id: string
  player_id: string | null
  guest_token: string | null
  citizen_id: string | null
  location_id: string | null
  item_id: string | null
  interaction_type: string
  topic: string | null
  summary: string | null
  game_date: string | null
  time_position: string | null
  created_at: string
}

// ── Items ────────────────────────────────────────────────────────────────────

export interface ItemStateTransition {
  after_real_minutes: number
  new_state: string
  description_override?: string
  name_override?: string
}

export interface Item {
  id: string
  name: string
  type: string
  location_id: string | null
  description: string
  can_take: boolean
  lore_note: string | null
  readable_content: string | null
  mystery_tie: string | null
  mystery_tie_2: string | null
  requires_condition: string | null
  // Extended fields (013)
  weight_class: 'tiny' | 'small' | 'medium' | 'large' | 'immovable'
  rarity: 'common' | 'uncommon' | 'rare' | 'precious' | 'legendary'
  impression_value: number        // -3 to +3
  impression_category: string | null
  is_ambient: boolean             // shown inline in look, not as separate list
  is_consumable: boolean
  vendor_citizen_id: string | null
  price: number | null
  current_state: string | null
  base_state: string | null
  state_transitions: ItemStateTransition[] | null
  state_changed_at: string | null
  season_availability: string[] | null
  weather_trigger: string | null
}

// ── Mysteries ────────────────────────────────────────────────────────────────

export interface Mystery {
  id: string
  title: string
  depth: 'shallow' | 'medium' | 'deep' | 'easter_egg'
  discovery_hint: string | null
  summary: string | null
  resolution_text: string | null
  reward_type: string | null
  reward_description: string | null
}

export interface MysteryClue {
  id: string
  mystery_id: string
  clue_order: number
  description: string
  source: string | null
  requires_condition: string | null
  is_hidden: boolean
}

// ── Help Tasks ───────────────────────────────────────────────────────────────

export interface HelpTask {
  id: string
  giver_citizen: string | null
  title: string
  description: string
  reward_lore: string | null
  trust_gain: number
  mystery_reveals: string | null
  location_req: string | null
  unlock_condition: string | null
  is_tutorial: boolean
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string
  name: string
  event_type: 'annual' | 'weekly' | 'monthly' | 'triggered'
  month: number | null
  day: number | null
  week_of_month: number | null
  day_of_week: string | null
  duration_days: number
  description: string
  setup_days_before: number
  mystery_tie: string | null
  seasonal_restriction: string | null
  trigger_condition: string | null
}

// ── Conversation ─────────────────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// ── NLU / Parser ─────────────────────────────────────────────────────────────

export interface ParsedCommand {
  intent: CommandIntent
  target: string | null      // citizen name, item name, direction, topic
  qualifier: string | null   // e.g. "carefully", "again", topic extension
  raw: string
  confidence: number
}

export type CommandIntent =
  | 'go'             // move to location
  | 'look'           // examine location or item
  | 'talk'           // initiate conversation with citizen
  | 'ask'            // ask citizen about a topic
  | 'take'           // pick up item
  | 'drop'           // put down / leave an item
  | 'use'            // use item on something
  | 'examine'        // look closely at specific thing
  | 'research'       // use library research system
  | 'journal'        // open journal
  | 'inventory'      // check inventory
  | 'help'           // show help
  | 'wait'           // pass time
  | 'find'           // ask where a location or citizen is
  | 'catch_up'       // summarize what happened since last play
  | 'recall'         // recall what player knows about a person/thing
  | 'travel'         // travel to a historical date
  | 'return_present' // return to the present from historical travel
  | 'solve'          // attempt to solve / deduce a mystery
  | 'give'           // ask an NPC to give you an item / accept an offer
  | 'unknown'        // couldn't parse

// ── World Events ─────────────────────────────────────────────────────────────

export interface WorldEvent {
  id: string
  game_date: string
  event_type: 'social' | 'weather' | 'discovery' | 'rumor' | 'business' | 'seasonal' | 'mystery' | 'community'
  headline: string
  detail: string | null
  location_id: string | null
  citizen_id: string | null
  mystery_tie: string | null
  is_major: boolean
  created_at: string
}

// ── API Responses ────────────────────────────────────────────────────────────

export interface GameResponse {
  text: string              // narrative output to display
  location?: Location       // if location changed
  journal_entry?: JournalEntry
  mystery_update?: { mystery_id: string; clue_found?: string; resolved?: boolean }
  trust_update?: { citizen_id: string; new_level: number }
  inventory_update?: string[]
  task_update?: boolean     // a task was offered or completed — reload tasks sidebar
  seen_item_id?: string     // item was examined — persist seen state to DB
  ambient?: string          // quiet background detail
  error?: string
  conversation_start?: { citizenId: string; citizenName: string; priorHistory: ConversationMessage[] }
  conversation_end?: boolean
  pending_npc_offer?: {     // NPC is offering an item — player must accept or decline
    citizenId: string
    citizenName: string
    itemId: string
    itemName: string
    dialogueHint: string
  }
}

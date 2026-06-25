/**
 * realtime.ts
 * Eastern Time clock utilities for Brindlewick's real-time world.
 *
 * All in-game time is derived from the actual US Eastern Time clock.
 * EST = UTC-5 / EDT = UTC-4 (handled automatically by Intl).
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type TimeSlot = 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type DowKey = typeof DOW_KEYS[number]

export interface EasternTime {
  year: number
  month: number      // 1-12
  day: number        // 1-31
  hour: number       // 0-23
  minute: number     // 0-59
  dow: number        // 0=Sun … 6=Sat
  dowKey: DowKey
  season: Season
  timeSlot: TimeSlot
  displayDate: string   // "Thursday, June 26"
  displayTime: string   // "2:47 PM"
  isoDate: string       // "2026-06-26"
}

export interface BusinessStatus {
  open: boolean
  closesAt?: string   // "5:00 PM"  (when currently open)
  opensAt?: string    // "9:00 AM"  (when currently closed)
  closedToday?: boolean
}

// ── Core clock ────────────────────────────────────────────────────────────────

/**
 * Returns an object whose numeric fields (year/month/day/hour/minute/dow)
 * reflect the *current moment* in US Eastern Time.
 */
export function getEasternTime(): EasternTime {
  const now = new Date()

  // Intl gives us the ET wall-clock as a formatted string; re-parse it.
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const et = new Date(etStr)  // Local-time Date whose fields equal ET values

  const year   = et.getFullYear()
  const month  = et.getMonth() + 1  // 1-12
  const day    = et.getDate()
  const hour   = et.getHours()
  const minute = et.getMinutes()
  const dow    = et.getDay()        // 0=Sun

  const season   = computeSeason(month, day)
  const timeSlot = computeTimeSlot(hour)

  const displayDate = et.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const displayTime = et.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return { year, month, day, hour, minute, dow, dowKey: DOW_KEYS[dow], season, timeSlot, displayDate, displayTime, isoDate }
}

// ── Season ───────────────────────────────────────────────────────────────────

/**
 * Astronomical seasons for the Northern Hemisphere (New England).
 * Spring  Mar 20 – Jun 20
 * Summer  Jun 21 – Sep 22
 * Autumn  Sep 23 – Dec 20
 * Winter  Dec 21 – Mar 19
 */
function computeSeason(month: number, day: number): Season {
  if ((month === 3 && day >= 20) || month === 4 || month === 5 || (month === 6 && day <= 20)) return 'spring'
  if ((month === 6 && day >= 21) || month === 7 || month === 8 || (month === 9 && day <= 22)) return 'summer'
  if ((month === 9 && day >= 23) || month === 10 || month === 11 || (month === 12 && day <= 20)) return 'autumn'
  return 'winter'
}

// ── Time slot ────────────────────────────────────────────────────────────────

function computeTimeSlot(hour: number): TimeSlot {
  if (hour < 6)  return 'night'
  if (hour < 9)  return 'early_morning'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'midday'
  if (hour < 18) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

// ── Business hours ───────────────────────────────────────────────────────────

/**
 * Business hours format (stored in locations.json / DB business_hours column):
 * {
 *   "mon": [9, 17],   // open 9 AM, close 5 PM (24-hour integers)
 *   "tue": [9, 17],
 *   ...
 *   "sun": null       // closed all day
 * }
 * A missing key means "same as a weekday default" — null always means closed.
 * If business_hours is null/undefined the location has no hours gate (always accessible).
 */
export function checkBusinessHours(
  hours: Partial<Record<DowKey, [number, number] | null>> | null | undefined,
  et: EasternTime
): BusinessStatus {
  if (!hours) return { open: true }

  const todayHours = hours[et.dowKey] ?? null

  if (!todayHours) {
    // Find next open day
    const nextOpen = findNextOpen(hours, et.dow)
    return { open: false, closedToday: true, opensAt: nextOpen }
  }

  const [open, close] = todayHours
  if (et.hour < open) {
    return { open: false, opensAt: formatHour(open) }
  }
  if (et.hour >= close) {
    // Find next open time (could be tomorrow)
    const nextOpen = findNextOpen(hours, et.dow, close)
    return { open: false, opensAt: nextOpen }
  }

  return { open: true, closesAt: formatHour(close) }
}

function formatHour(h: number): string {
  if (h === 0)  return '12:00 AM'
  if (h === 12) return '12:00 PM'
  if (h < 12)   return `${h}:00 AM`
  return `${h - 12}:00 PM`
}

function findNextOpen(
  hours: Partial<Record<DowKey, [number, number] | null>>,
  currentDow: number,
  afterHour?: number  // if set, also skip today if it would open after this hour
): string | undefined {
  for (let i = 1; i <= 7; i++) {
    const nextDow = (currentDow + i) % 7
    const key = DOW_KEYS[nextDow]
    const h = hours[key] ?? null
    if (!h) continue
    if (i === 0 && afterHour !== undefined && h[0] <= afterHour) continue
    const dayName = key.charAt(0).toUpperCase() + key.slice(1)
    return `${dayName} ${formatHour(h[0])}`
  }
  return undefined
}

// ── World-state shim ─────────────────────────────────────────────────────────

/**
 * Returns a WorldState-compatible object computed from real ET clock.
 * Use this everywhere instead of reading world_state from the DB.
 */
export function getRealWorldState() {
  const et = getEasternTime()
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return {
    id: 1,
    game_date: et.isoDate,
    game_season: et.season,
    day_of_week: DAYS[et.dow],
    time_scale: 'realtime',
    last_tick_at: new Date().toISOString(),
    game_time: et.displayTime,
    display_date: et.displayDate,
  }
}

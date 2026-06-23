/**
 * fix-citizens.ts
 *
 * Reassigns occupations and household groupings for supporting citizens
 * to reflect a realistic small mountain town of ~900 people.
 *
 * Run: npx tsx scripts/fix-citizens.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const CONTENT = path.join(process.cwd(), 'content')

// ── Realistic occupation pool for a small mountain valley town ────────────────
// Each entry: [occupation, weight]
// Children (<16) get null. Seniors (65+) get "retired". Young teens (16-17) get student.

const ADULT_OCCUPATIONS: [string, number][] = [
  // Agriculture & food production
  ['farmer', 20],
  ['dairy farmer', 8],
  ['market gardener', 8],
  ['orchard keeper', 5],
  ['beekeeper', 4],
  ['agricultural laborer', 10],
  ['fishing guide', 5],
  ['hunting guide', 4],

  // Skilled trades
  ['carpenter', 14],
  ['electrician', 9],
  ['plumber', 8],
  ['building contractor', 8],
  ['house painter', 7],
  ['roofer', 5],
  ['stonemason', 4],
  ['auto mechanic', 8],
  ['welder', 4],
  ['glazier', 3],

  // Hospitality & food service
  ['innkeeper', 3],
  ['chef', 6],
  ['baker', 5],
  ['cook', 9],
  ['waitress', 8],
  ['waiter', 6],
  ['bartender', 6],
  ['lodge housekeeper', 6],
  ['dishwasher', 4],
  ['barista', 5],

  // Retail
  ['shopkeeper', 10],
  ['shop assistant', 18],
  ['market vendor', 7],
  ['hardware store clerk', 5],
  ['pharmacy assistant', 4],
  ['florist', 3],

  // Healthcare
  ['nurse', 8],
  ['doctor', 2],
  ['dentist', 1],
  ['pharmacist', 2],
  ['physiotherapist', 2],
  ['care worker', 5],
  ['paramedic', 3],
  ['veterinarian', 2],
  ['dental hygienist', 2],

  // Education
  ['schoolteacher', 11],
  ['teaching assistant', 4],
  ['school librarian', 1],
  ['school counselor', 1],
  ['nursery teacher', 2],
  ['music teacher', 2],
  ['sports coach', 2],

  // Government & public services
  ['town clerk', 2],
  ['planning officer', 2],
  ['road worker', 5],
  ['waste collector', 4],
  ['postal worker', 5],
  ['firefighter', 4],
  ['deputy sheriff', 3],

  // Forestry & outdoors
  ['forest ranger', 5],
  ['logger', 9],
  ['tree surgeon', 4],
  ['park warden', 3],
  ['wilderness guide', 4],
  ['groundskeeper', 4],
  ['landscaper', 5],

  // Arts & crafts
  ['artist', 5],
  ['potter', 3],
  ['woodcarver', 3],
  ['textile artist', 3],
  ['photographer', 3],
  ['musician', 3],
  ['bookbinder', 2],

  // Professional services
  ['accountant', 3],
  ['bookkeeper', 4],
  ['lawyer', 2],
  ['real estate agent', 3],
  ['insurance agent', 2],
  ['financial advisor', 2],
  ['notary', 2],
  ['surveyor', 2],

  // Other services
  ['hairdresser', 4],
  ['barber', 3],
  ['laundry worker', 3],
  ['cleaner', 8],
  ['childcare worker', 5],
  ['librarian', 2],
  ['journalist', 2],
  ['writer', 2],
  ['church minister', 1],
  ['church warden', 2],
  ['taxi driver', 3],
  ['delivery driver', 5],
  ['bus driver', 2],
  ['night watchman', 2],
  ['handyman', 6],

  // Semi-employed / informal
  ['homemaker', 18],
  ['seasonal worker', 8],
  ['part-time farmhand', 5],
]

// Former occupations for retirees (more variety)
const RETIRED_FROM: string[] = [
  'teacher', 'farmer', 'nurse', 'logger', 'carpenter', 'shopkeeper',
  'postman', 'firefighter', 'baker', 'fisherman', 'librarian', 'clerk',
  'accountant', 'mechanic', 'cook', 'doctor', 'groundskeeper', 'forester',
  'driver', 'builder', 'electrician', 'plumber', 'waitress', 'dairyman',
  'soldier', 'police officer', 'pharmacist', 'market trader',
]

// Build weighted pool
function buildPool(pairs: [string, number][]): string[] {
  const pool: string[] = []
  for (const [occ, weight] of pairs) {
    for (let i = 0; i < weight; i++) pool.push(occ)
  }
  return pool
}

const ADULT_POOL = buildPool(ADULT_OCCUPATIONS)

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 4294967296
  }
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]
}

// ── Main transformation ───────────────────────────────────────────────────────

interface Citizen {
  id: string
  first_name: string
  last_name: string
  age: number
  gender: string
  occupation: string | null
  address: string
  household: string[]
  personality_trait?: string
  routine?: Record<string, string>
  gossip?: string
  help_task?: unknown
  tier: string
  [key: string]: unknown
}

function assignOccupation(citizen: Citizen, rand: () => number): string | null {
  const age = citizen.age ?? 30

  if (age < 14) return null                          // young children
  if (age < 18) return 'student'                    // teens
  if (age >= 70) {
    // Most elderly are retired; a few still work
    if (rand() < 0.15) return pick(ADULT_POOL, rand) // 15% still working
    const former = pick(RETIRED_FROM, rand)
    return `retired ${former}`
  }
  if (age >= 65) {
    if (rand() < 0.35) return pick(ADULT_POOL, rand) // 35% still working
    const former = pick(RETIRED_FROM, rand)
    return `retired ${former}`
  }
  if (age >= 55) {
    if (rand() < 0.08) {                             // 8% early retired
      return `retired ${pick(RETIRED_FROM, rand)}`
    }
  }

  return pick(ADULT_POOL, rand)
}

function buildHouseholds(citizens: Citizen[]): void {
  // Group by last name
  const byLastName: Record<string, Citizen[]> = {}
  for (const c of citizens) {
    if (!byLastName[c.last_name]) byLastName[c.last_name] = []
    byLastName[c.last_name].push(c)
  }

  for (const [, members] of Object.entries(byLastName)) {
    if (members.length < 2) continue

    // Sort by age descending — adults first
    members.sort((a, b) => (b.age ?? 0) - (a.age ?? 0))

    // Adults (18+) form the household core; children are dependents
    const adults = members.filter(m => (m.age ?? 0) >= 18)
    const children = members.filter(m => (m.age ?? 0) < 18)

    if (adults.length === 0) continue

    // All members of the household know each other
    const householdNames = members.map(m => `${m.first_name} ${m.last_name}`)

    for (const member of members) {
      // Household = other members
      member.household = householdNames.filter(n => n !== `${member.first_name} ${member.last_name}`)
    }

    // Children's relationship note
    for (const child of children) {
      if (adults.length >= 2) {
        child.household = [
          `${adults[0].first_name} ${adults[0].last_name}`,
          `${adults[1].first_name} ${adults[1].last_name}`,
          ...children
            .filter(c => c !== child)
            .map(c => `${c.first_name} ${c.last_name}`),
        ]
      } else {
        child.household = [
          `${adults[0].first_name} ${adults[0].last_name}`,
          ...children
            .filter(c => c !== child)
            .map(c => `${c.first_name} ${c.last_name}`),
        ]
      }
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

const filePath = path.join(CONTENT, 'citizens/supporting.json')
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const citizens: Citizen[] = raw.citizens ?? raw.supporting_citizens ?? []

const rand = seededRandom(42)

// Reassign occupations
let childCount = 0, studentCount = 0, retiredCount = 0, workerCount = 0
for (const c of citizens) {
  c.occupation = assignOccupation(c, rand)
  if (!c.occupation) childCount++
  else if (c.occupation === 'student') studentCount++
  else if (c.occupation.startsWith('retired')) retiredCount++
  else workerCount++
}

// Build household relationships
buildHouseholds(citizens)

// Write back (preserve original key name)
const key = raw.citizens ? 'citizens' : 'supporting_citizens'
raw[key] = citizens
fs.writeFileSync(filePath, JSON.stringify(raw, null, 2))

// Report
console.log(`\n✓ Updated ${citizens.length} citizens`)
console.log(`  Children (no occupation): ${childCount}`)
console.log(`  Students:                 ${studentCount}`)
console.log(`  Retired:                  ${retiredCount}`)
console.log(`  Working:                  ${workerCount}`)

// Show occupation breakdown
const occ: Record<string, number> = {}
citizens.forEach(c => {
  const o = c.occupation || '(child)'
  occ[o] = (occ[o] || 0) + 1
})
const sorted = Object.entries(occ).sort((a, b) => b[1] - a[1])
console.log('\nTop occupations:')
sorted.slice(0, 30).forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  ${k}`))
console.log(`\n  ... ${sorted.length} distinct occupations total`)

// Household stats
const withFamily = citizens.filter(c => c.household.length > 0).length
console.log(`\n  ${withFamily} citizens have household members assigned`)

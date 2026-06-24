/**
 * Item Generation Script
 *
 * Generates ~1000 world items for Brindlewick using Claude, distributed across
 * all locations. Items range from precious/rare (rich descriptions) to common
 * ambient clutter (lean descriptions). Generated items are saved to
 * content/generated_items.json and can be merged into items.json manually
 * or seeded directly.
 *
 * Usage:
 *   npx tsx scripts/generate-items.ts
 *
 * The script will:
 *   1. Read all locations from content/locations.json
 *   2. For each location, ask Claude to generate 20-35 contextually appropriate items
 *   3. Include a mix of rarities, states, seasonal variants, ambient/interactive
 *   4. Save incrementally so you can resume if interrupted
 *
 * Requires:
 *   ANTHROPIC_API_KEY in .env.local
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (for final seed)
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const CONTENT = path.join(process.cwd(), 'content')
const OUTPUT  = path.join(CONTENT, 'generated_items.json')

// ── Location definitions ─────────────────────────────────────────────────────

const LOCATIONS: Array<{
  id: string
  name: string
  type: string
  description: string
  count: number           // target item count
  seasons?: string[]      // seasons in which seasonal items appear
}> = [
  {
    id: 'town_square', name: 'The Town Square', type: 'civic',
    description: 'The heart of Brindlewick. Sugar maples, brick paths, granite war memorial, pigeons, benches, surrounded by shops. Community gathering place.',
    count: 45,
  },
  {
    id: 'copper_kettle_bakery', name: 'The Copper Kettle Bakery', type: 'commercial',
    description: "Marigold Osei's warm bakery. Bread, pastries, cakes. Old wooden counter, chalkboard menu, display cases, commercial kitchen in back. Always smells amazing.",
    count: 40,
  },
  {
    id: 'perkins_cider_house', name: 'Perkins Cider House', type: 'homestead',
    description: "Agnes Perkins's farmhouse and cider-making operation. Apple press, barrels, kitchen, orchard outside. Practical and well-worn. Autumn is high season.",
    count: 40,
    seasons: ['autumn'],
  },
  {
    id: 'library', name: 'Brindlewick Public Library', type: 'civic',
    description: "Eleanor Finch-Hartwell's domain. Two-story with card catalogues, computer terminals, reading tables, periodical stacks, local history section. Quiet and ordered.",
    count: 40,
  },
  {
    id: 'library_archive_room', name: 'The Library Archive Room', type: 'civic',
    description: 'Floor-to-ceiling shelves of bound correspondence, maps, ledgers, and photographs. Smells of old paper and cedar. Partially catalogued. Cool and dry.',
    count: 35,
  },
  {
    id: 'lantern_post_inn', name: 'The Lantern Post Inn', type: 'hospitality',
    description: "Teddy Birch's inn. Front desk, common room with fireplace, dining area, upstairs guest rooms. Comfortable, well-worn. Community feel. The hub of visitor life.",
    count: 45,
  },
  {
    id: 'town_hall', name: 'Town Hall', type: 'civic',
    description: 'Victorian civic building. Meeting rooms, mayor\'s office, public records office, staircase leading to the clocktower. Official and slightly austere.',
    count: 30,
  },
  {
    id: 'clocktower_stairs', name: 'The Clocktower Stairs', type: 'civic',
    description: "The winding staircase inside the Town Hall's clocktower. Stone steps, iron railing, gear housing at the top. Rosalind Webb maintains the clock mechanism here.",
    count: 20,
  },
  {
    id: 'lakeside_park', name: 'Lakeside Park', type: 'outdoor',
    description: 'Grassy park along the lakeshore. The Alderman Finch statue faces the water. Benches, old dock, wildflowers, ducks. Beautiful at sunset.',
    count: 40,
    seasons: ['spring', 'summer', 'autumn'],
  },
  {
    id: 'covered_bridge', name: 'The Covered Bridge', type: 'outdoor',
    description: 'An 1847 wooden covered bridge crossing the creek at the edge of town. Dark interior, plank floor, old inscriptions on beams. Quiet.',
    count: 25,
  },
  {
    id: 'brindlewick_cemetery', name: 'Brindlewick Cemetery', type: 'outdoor',
    description: 'A hillside cemetery with gravestones from the 1840s onward. Wrought-iron gate, overgrown older sections, well-kept newer ones. Yew trees.',
    count: 30,
    seasons: ['spring', 'summer', 'autumn'],
  },
  {
    id: 'meeting_house_museum', name: 'Meeting House Museum', type: 'cultural',
    description: 'An 1832 meeting house converted into a small local history museum. Display cases, period furniture, photographs, maps. Run by Artie Pryce adjacent to his shop.',
    count: 35,
  },
  {
    id: 'old_mill_antiques', name: "Old Mill Antiques — Artie Pryce's Shop", type: 'commercial',
    description: "Artie Pryce's antique and curiosity shop. Crowded shelves, glass cases, tagged price labels, furniture in the back, the smell of polish and old wood.",
    count: 55,
  },
  {
    id: 'copper_hill_gallery', name: 'Copper Hill Gallery', type: 'cultural',
    description: "Sadie Mirabel's art gallery. Contemporary and historical work, white walls, some sculpture. One room dedicated to Brindlewick-inspired art.",
    count: 30,
  },
  {
    id: 'lighthouse', name: 'The Lighthouse', type: 'outdoor',
    description: 'An 1880s automated lighthouse on a small peninsula. Stone base, metal spiral stairs, the lamp housing at the top. Wind off the lake.',
    count: 25,
  },
  {
    id: 'station_masters_house', name: "The Station Master's House", type: 'historic',
    description: "Gerald Hobbs's abandoned 1920s cottage beside the old rail right-of-way. Locked but accessible. Dust, old furniture, 1923 calendar, a nail by the door.",
    count: 35,
  },
  {
    id: 'brindlewick_trailhead', name: 'The Brindlewick Trailhead', type: 'outdoor',
    description: 'The start of the mountain trails. Weatherproof map case, trail register, signage, benches. Clem Rourke maintains it. Different moods by season.',
    count: 25,
    seasons: ['spring', 'summer', 'autumn'],
  },
  {
    id: 'warming_hut', name: 'The Warming Hut', type: 'outdoor',
    description: 'A small wooden hut two-thirds up the main trail. Built 1985 by Clem Rourke. Firewood, visitor log, emergency supplies, small bench. Often cold.',
    count: 25,
    seasons: ['winter', 'autumn'],
  },
  {
    id: 'brindlewick_lookout', name: 'Brindlewick Lookout', type: 'outdoor',
    description: 'The summit overlook at the top of the main trail. Panoramic view over the valley and lake. Wind-scoured granite, small marker post.',
    count: 20,
    seasons: ['spring', 'summer', 'autumn'],
  },
  {
    id: 'alderman_estate', name: 'The Alderman Estate', type: 'residential',
    description: "Constance Alderman's Victorian family home on the hill north of town. Formal rooms, portrait gallery, garden. Old money, carefully maintained.",
    count: 35,
  },
  {
    id: 'founders_hidden_room', name: "The Founder's Hidden Room", type: 'historic',
    description: 'A secret room beneath the old Alderman boathouse. Stone walls, dusty shelves, personal effects of the founding Aldermans. Undisturbed for generations.',
    count: 30,
  },
  {
    id: 'millpond_row', name: 'Millpond Row', type: 'civic',
    description: 'The main commercial street running east from the square. Shops, the post office (Dot Flowers), a small hardware store, flower shop. Busy and neighborly.',
    count: 40,
  },
  {
    id: 'lake_street', name: 'Lake Street', type: 'outdoor',
    description: 'The road running south along the lake. Residential on one side, parkland and water views on the other. Quiet, pleasant.',
    count: 25,
  },
]

// ── Item generation prompt ───────────────────────────────────────────────────

function buildPrompt(location: typeof LOCATIONS[0]): string {
  return `You are generating world items for a cozy mystery text adventure game set in the small mountain town of Brindlewick. The game is set in the present day, early autumn. The tone is warm, literary, and detailed — like a very good novel.

Location: **${location.name}** (${location.type})
${location.description}

Generate exactly ${location.count} items that would realistically be found in this location.

RULES:
1. Items should feel genuinely real to this specific place — not generic
2. Mix of rarities: mostly common, some uncommon, a few rare, 1-2 precious, maybe 1 legendary
3. Most items have NO game purpose — they are world atmosphere. A few may relate to mysteries or be interactive
4. Include items that change over time or by season where logical (tea cools, flowers wilt, apples appear in autumn, snow shovels in winter)
5. is_ambient=true means the item's description is woven into the location text, not listed separately. Use this for fixtures and scenery (paintings on walls, rugs, permanent features)
6. is_ambient=false means the player could theoretically interact with it — it gets listed in "You notice: X, Y, Z"
7. For seasonal items, set season_availability to the appropriate seasons
8. State transitions should be realistic: a cup of hot tea takes 30 min to go cold, cut flowers wilt after 4-6 hours, bread goes stale after a day
9. Impression values: beautiful flowers = +3, a kind gift = +2, something pleasant = +1, neutral = 0, dirty rag = -1, something smelly = -2, something truly unpleasant = -3
10. Description depth: precious/rare/interactive = 3-5 sentences. Common/ambient = 1-2 sentences.

Output a JSON array of items. Each item must have these fields:
{
  "id": "snake_case_unique_id",
  "name": "Display Name",
  "type": "examine|readable|clue_item|inventory|ambient",
  "location": "${location.id}",
  "description": "Item description. For state-changing items, this is the INITIAL/FRESH state description.",
  "can_take": false,
  "weight_class": "tiny|small|medium|large|immovable",
  "rarity": "common|uncommon|rare|precious|legendary",
  "impression_value": 0,
  "impression_category": "pleasant|beautiful|practical|food|nature|dirty|ugly|unpleasant|neutral|null",
  "is_ambient": false,
  "is_consumable": false,
  "current_state": null,
  "base_state": null,
  "state_transitions": null,
  "season_availability": null,
  "lore_note": null
}

For consumable items (food/drink the player can use up), add: "is_consumable": true, "can_take": true
For state-changing items, add:
  "base_state": "fresh",
  "current_state": "fresh",
  "state_transitions": [{"after_real_minutes": 30, "new_state": "cold", "description_override": "...updated description..."}]

For seasonal items:
  "season_availability": ["autumn"] (or ["winter"], ["spring","summer"], etc.)

Output ONLY the JSON array, no markdown, no explanation.`
}

// ── Main generation loop ─────────────────────────────────────────────────────

async function generateForLocation(
  location: typeof LOCATIONS[0],
  existingIds: Set<string>
): Promise<unknown[]> {
  console.log(`\n  Generating ${location.count} items for ${location.name}…`)

  const prompt = buildPrompt(location)

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Parse the JSON array
  let items: unknown[]
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    items = JSON.parse(cleaned)
    if (!Array.isArray(items)) throw new Error('Not an array')
  } catch (err) {
    console.error(`  ✗ JSON parse failed for ${location.name}:`, err)
    console.error('  Raw output:', text.slice(0, 200))
    return []
  }

  // De-duplicate IDs
  const deduped = items.filter((item: unknown) => {
    const id = (item as Record<string, unknown>).id as string
    if (!id || existingIds.has(id)) {
      console.warn(`  ⚠ Duplicate/missing ID: ${id} — skipping`)
      return false
    }
    existingIds.add(id)
    return true
  })

  console.log(`  ✓ ${deduped.length} items generated`)
  return deduped
}

async function main() {
  console.log('🌿 Brindlewick item generator starting…')
  console.log(`   Generating for ${LOCATIONS.length} locations`)

  // Load existing generated items (if resuming)
  let existing: unknown[] = []
  const existingIds = new Set<string>()

  if (fs.existsSync(OUTPUT)) {
    const raw = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))
    existing = raw.generated_items ?? []
    for (const item of existing) {
      const id = (item as Record<string, unknown>).id as string
      if (id) existingIds.add(id)
    }
    console.log(`   Resuming with ${existing.length} existing items`)
  }

  // Track which locations already have generated items
  const doneLocations = new Set<string>()
  for (const item of existing) {
    const loc = (item as Record<string, unknown>).location as string
    // Don't skip — we'll check individual IDs
    void loc
  }

  const allItems: unknown[] = [...existing]

  for (const location of LOCATIONS) {
    // Check if this location already has enough items
    const locationItems = allItems.filter(
      (i: unknown) => (i as Record<string, unknown>).location === location.id
    )
    if (locationItems.length >= location.count * 0.8) {
      console.log(`\n  Skipping ${location.name} (already has ${locationItems.length} items)`)
      continue
    }

    try {
      const newItems = await generateForLocation(location, existingIds)
      allItems.push(...newItems)

      // Save after each location so we can resume if interrupted
      fs.writeFileSync(OUTPUT, JSON.stringify({ generated_items: allItems, generated_at: new Date().toISOString() }, null, 2))
      console.log(`  💾 Saved (total: ${allItems.length} items)`)

      // Brief pause to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500))
    } catch (err) {
      console.error(`  ✗ Failed for ${location.name}:`, err)
      // Continue with next location
    }
  }

  console.log(`\n✅ Generation complete. ${allItems.length} total items.`)
  console.log(`   Output: ${OUTPUT}`)
  console.log(`\nNext steps:`)
  console.log(`   1. Review content/generated_items.json`)
  console.log(`   2. Run: npx tsx scripts/seed-generated-items.ts`)
  console.log(`      (this will upsert the items into Supabase)`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

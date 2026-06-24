/**
 * Seed Generated Items
 *
 * Reads content/generated_items.json (produced by generate-items.ts)
 * and upserts all items into the Supabase items table.
 *
 * Usage:
 *   npx tsx scripts/seed-generated-items.ts
 *
 * Safe to re-run — uses upsert so existing items are updated.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})

const CONTENT = path.join(process.cwd(), 'content')
const INPUT   = path.join(CONTENT, 'generated_items.json')

const BATCH_SIZE = 50  // upsert in batches to avoid request size limits

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`No generated items file found at ${INPUT}`)
    console.error('Run: npx tsx scripts/generate-items.ts first')
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  const items = (raw.generated_items ?? []) as Array<Record<string, unknown>>

  console.log(`🌿 Seeding ${items.length} generated items…`)

  // Normalize each item for the DB schema
  const rows = items.map(item => ({
    id:                item.id,
    name:              item.name,
    type:              item.type ?? 'examine',
    location_id:       item.location ?? item.location_id ?? null,
    description:       item.description,
    can_take:          item.can_take ?? false,
    lore_note:         item.lore_note ?? null,
    readable_content:  item.readable_content ?? null,
    mystery_tie:       item.mystery_tie ?? null,
    mystery_tie_2:     item.mystery_tie_2 ?? null,
    requires_condition: item.requires_condition ?? null,
    // 013 fields
    weight_class:      item.weight_class ?? 'small',
    rarity:            item.rarity ?? 'common',
    impression_value:  item.impression_value ?? 0,
    impression_category: item.impression_category ?? null,
    is_ambient:        item.is_ambient ?? false,
    is_consumable:     item.is_consumable ?? false,
    vendor_citizen_id: item.vendor_citizen_id ?? null,
    price:             item.price ?? null,
    current_state:     item.current_state ?? item.base_state ?? null,
    base_state:        item.base_state ?? null,
    state_transitions: item.state_transitions ?? null,
    state_changed_at:  new Date().toISOString(),
    season_availability: item.season_availability ?? null,
    weather_trigger:   item.weather_trigger ?? null,
  }))

  // Upsert in batches
  let seeded = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('items').upsert(batch, { onConflict: 'id' })
    if (error) {
      console.error(`  ✗ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message)
      throw error
    }
    seeded += batch.length
    console.log(`  ✓ ${seeded}/${rows.length} items seeded`)
  }

  console.log(`\n✅ Done. ${seeded} items in Supabase.`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

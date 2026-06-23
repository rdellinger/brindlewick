import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createAdminSupabaseClient()

  const { data, error } = await supabase
    .from('calendar_events')
    .select('id, name, event_type, month, day')
    .order('month', { nullsFirst: false })
    .order('day', { nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data })
}

'use client'

import { useState, useEffect } from 'react'

type AdminTab = 'overview' | 'citizens' | 'locations' | 'mysteries' | 'calendar' | 'world' | 'analytics'

interface Stats {
  citizenCount: number
  locationCount: number
  mysteryCount: number
  activePlayerCount: number
  totalCommands: number
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/admin/stats').then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'citizens', label: 'Citizens' },
    { id: 'locations', label: 'Locations' },
    { id: 'mysteries', label: 'Mysteries' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'world', label: 'World Clock' },
    { id: 'analytics', label: 'Analytics' },
  ]

  return (
    <div className="flex min-h-screen">
      {/* Sidebar nav */}
      <nav
        className="w-48 shrink-0 border-r"
        style={{ backgroundColor: '#12121a', borderColor: '#2a2a3a' }}
      >
        <div className="p-4 border-b" style={{ borderColor: '#2a2a3a' }}>
          <div className="text-sm font-medium" style={{ color: '#c8903a' }}>
            ⬡ Brindlewick
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#6a6a7a' }}>
            Admin Panel
          </div>
        </div>
        <ul className="py-2">
          {tabs.map(t => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                className="w-full text-left px-4 py-2 text-sm transition-colors"
                style={{
                  color: tab === t.id ? '#c8903a' : '#8a8a9a',
                  backgroundColor: tab === t.id ? '#1a1a2a' : 'transparent',
                }}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {tab === 'overview' && <OverviewTab stats={stats} />}
        {tab === 'citizens' && <CitizensTab />}
        {tab === 'locations' && <LocationsTab />}
        {tab === 'mysteries' && <MysteriesTab />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'world' && <WorldClockTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </main>
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: Stats | null }) {
  return (
    <div>
      <h2 className="text-xl mb-6" style={{ color: '#e8e0d0' }}>Overview</h2>
      <div className="grid grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Citizens', value: stats?.citizenCount ?? '…' },
          { label: 'Locations', value: stats?.locationCount ?? '…' },
          { label: 'Mysteries', value: stats?.mysteryCount ?? '…' },
          { label: 'Active Players (30d)', value: stats?.activePlayerCount ?? '…' },
          { label: 'Commands (all time)', value: stats?.totalCommands ?? '…' },
        ].map(s => (
          <div
            key={s.label}
            className="p-4 rounded"
            style={{ backgroundColor: '#1e1e2a' }}
          >
            <div className="text-2xl font-bold mb-1" style={{ color: '#c8903a' }}>
              {s.value}
            </div>
            <div className="text-xs" style={{ color: '#6a6a7a' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
      <div className="text-sm" style={{ color: '#6a6a7a' }}>
        Welcome to the Brindlewick admin panel. Use the left nav to manage content.
      </div>
    </div>
  )
}

// ── Citizens ─────────────────────────────────────────────────────────────────

function CitizensTab() {
  const [citizens, setCitizens] = useState<Array<{
    id: string; first_name: string; last_name: string; occupation: string | null; tier: string
  }>>([])
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/admin/citizens?limit=50').then(r => r.json()).then(d => setCitizens(d.citizens ?? [])).catch(() => {})
  }, [])

  const filtered = citizens.filter(c =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase())
  )

  const handleSave = async () => {
    if (!editingId) return
    await fetch(`/api/admin/citizens/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editData),
    })
    setEditingId(null)
    setCitizens(prev => prev.map(c => c.id === editingId ? { ...c, ...editData } : c))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl" style={{ color: '#e8e0d0' }}>Citizens</h2>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search citizens…"
          className="px-3 py-1.5 rounded text-sm"
          style={{ backgroundColor: '#1e1e2a', color: '#e8e0d0', border: '1px solid #2a2a3a' }}
        />
      </div>

      <div className="text-xs mb-4" style={{ color: '#6a6a7a' }}>
        Showing {filtered.length} of {citizens.length} loaded citizens
        (943 total — use search to filter)
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: '#6a6a7a' }}>
            <th className="text-left pb-2">Name</th>
            <th className="text-left pb-2">Occupation</th>
            <th className="text-left pb-2">Tier</th>
            <th className="text-left pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(c => (
            <tr
              key={c.id}
              className="border-t"
              style={{ borderColor: '#2a2a3a' }}
            >
              <td className="py-2" style={{ color: '#e8e0d0' }}>
                {c.first_name} {c.last_name}
              </td>
              <td className="py-2" style={{ color: '#8a8a9a' }}>
                {c.occupation ?? '—'}
              </td>
              <td className="py-2">
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: c.tier === 'principal' ? '#2a1a0a' : '#1a1a2a',
                    color: c.tier === 'principal' ? '#c8903a' : '#6a6a7a',
                  }}
                >
                  {c.tier}
                </span>
              </td>
              <td className="py-2">
                <button
                  onClick={() => { setEditingId(c.id); setEditData({ occupation: c.occupation ?? '' }) }}
                  className="text-xs px-2 py-1 rounded"
                  style={{ backgroundColor: '#2a2a3a', color: '#8a8a9a' }}
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Simple inline editor */}
      {editingId && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="p-6 rounded w-96"
            style={{ backgroundColor: '#1e1e2a' }}
          >
            <h3 className="mb-4" style={{ color: '#e8e0d0' }}>Edit Citizen</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs block mb-1" style={{ color: '#6a6a7a' }}>Occupation</label>
                <input
                  value={editData.occupation ?? ''}
                  onChange={e => setEditData(d => ({ ...d, occupation: e.target.value }))}
                  className="w-full px-3 py-2 rounded text-sm"
                  style={{ backgroundColor: '#12121a', color: '#e8e0d0', border: '1px solid #2a2a3a' }}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded text-sm"
                style={{ backgroundColor: '#c8903a', color: '#1a1a24' }}
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="px-4 py-2 rounded text-sm"
                style={{ backgroundColor: '#2a2a3a', color: '#8a8a9a' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Locations ────────────────────────────────────────────────────────────────

function LocationsTab() {
  const [locations, setLocations] = useState<Array<{
    id: string; name: string; type: string; area: string | null
  }>>([])

  useEffect(() => {
    fetch('/api/admin/locations').then(r => r.json()).then(d => setLocations(d.locations ?? [])).catch(() => {})
  }, [])

  return (
    <div>
      <h2 className="text-xl mb-6" style={{ color: '#e8e0d0' }}>Locations ({locations.length})</h2>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: '#6a6a7a' }}>
            <th className="text-left pb-2">ID</th>
            <th className="text-left pb-2">Name</th>
            <th className="text-left pb-2">Type</th>
            <th className="text-left pb-2">Area</th>
          </tr>
        </thead>
        <tbody>
          {locations.map(l => (
            <tr key={l.id} className="border-t" style={{ borderColor: '#2a2a3a' }}>
              <td className="py-1.5 font-mono text-xs" style={{ color: '#6a6a7a' }}>{l.id}</td>
              <td className="py-1.5" style={{ color: '#e8e0d0' }}>{l.name}</td>
              <td className="py-1.5" style={{ color: '#8a8a9a' }}>{l.type}</td>
              <td className="py-1.5" style={{ color: '#8a8a9a' }}>{l.area ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Mysteries ────────────────────────────────────────────────────────────────

function MysteriesTab() {
  const [mysteries, setMysteries] = useState<Array<{
    id: string; title: string; depth: string;
    players_started?: number; players_resolved?: number
  }>>([])

  useEffect(() => {
    fetch('/api/admin/mysteries').then(r => r.json()).then(d => setMysteries(d.mysteries ?? [])).catch(() => {})
  }, [])

  return (
    <div>
      <h2 className="text-xl mb-6" style={{ color: '#e8e0d0' }}>Mysteries</h2>
      <div className="space-y-3">
        {mysteries.map(m => (
          <div
            key={m.id}
            className="p-4 rounded"
            style={{ backgroundColor: '#1e1e2a' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: '#e8e0d0' }}>{m.title}</div>
                <div className="text-xs mt-0.5" style={{ color: '#6a6a7a' }}>
                  {m.depth} depth
                </div>
              </div>
              <div className="text-xs text-right" style={{ color: '#6a6a7a' }}>
                <div>{m.players_started ?? 0} started</div>
                <div>{m.players_resolved ?? 0} resolved</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function CalendarTab() {
  const [events, setEvents] = useState<Array<{
    id: string; name: string; event_type: string; month: number | null; day: number | null
  }>>([])

  useEffect(() => {
    fetch('/api/admin/calendar').then(r => r.json()).then(d => setEvents(d.events ?? [])).catch(() => {})
  }, [])

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div>
      <h2 className="text-xl mb-6" style={{ color: '#e8e0d0' }}>Calendar Events</h2>
      <div className="space-y-2">
        {events.map(e => (
          <div
            key={e.id}
            className="flex items-center gap-4 p-3 rounded"
            style={{ backgroundColor: '#1e1e2a' }}
          >
            <div className="w-16 text-center text-xs" style={{ color: '#c8903a' }}>
              {e.month ? `${months[e.month - 1]} ${e.day ?? ''}` : e.event_type}
            </div>
            <div>
              <div style={{ color: '#e8e0d0' }}>{e.name}</div>
              <div className="text-xs" style={{ color: '#6a6a7a' }}>{e.event_type}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── World Clock ───────────────────────────────────────────────────────────────

function WorldClockTab() {
  const [worldState, setWorldState] = useState<{
    game_date: string; game_season: string; day_of_week: string; last_tick_at: string
  } | null>(null)
  const [advancing, setAdvancing] = useState(false)

  const loadState = () => {
    fetch('/api/admin/world').then(r => r.json()).then(d => setWorldState(d.world)).catch(() => {})
  }

  useEffect(loadState, [])

  const advanceDay = async () => {
    setAdvancing(true)
    await fetch('/api/admin/world/advance', { method: 'POST' })
    loadState()
    setAdvancing(false)
  }

  const setDate = async (date: string) => {
    await fetch('/api/admin/world/set-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    })
    loadState()
  }

  return (
    <div>
      <h2 className="text-xl mb-6" style={{ color: '#e8e0d0' }}>World Clock</h2>
      {worldState ? (
        <div className="space-y-6">
          <div
            className="p-6 rounded"
            style={{ backgroundColor: '#1e1e2a' }}
          >
            <div className="text-3xl font-bold mb-2" style={{ color: '#c8903a' }}>
              {new Date(worldState.game_date).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              })}
            </div>
            <div className="text-sm" style={{ color: '#8a8a9a' }}>
              Season: {worldState.game_season} · Last tick: {new Date(worldState.last_tick_at).toLocaleString()}
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={advanceDay}
              disabled={advancing}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{ backgroundColor: '#c8903a', color: '#1a1a24', opacity: advancing ? 0.6 : 1 }}
            >
              {advancing ? 'Advancing…' : 'Advance by 1 Day (testing)'}
            </button>

            <div>
              <label className="text-xs block mb-1" style={{ color: '#6a6a7a' }}>
                Jump to specific date (YYYY-MM-DD)
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  className="px-3 py-1.5 rounded text-sm"
                  style={{ backgroundColor: '#12121a', color: '#e8e0d0', border: '1px solid #2a2a3a' }}
                  onChange={e => e.target.value && setDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div
            className="p-4 rounded text-sm"
            style={{ backgroundColor: '#12121a', color: '#6a6a7a' }}
          >
            <strong style={{ color: '#8a8a9a' }}>Time scale:</strong> 1 real day = 1 game day.
            The world advances automatically via a Vercel Cron job at midnight UTC.
            Use manual controls here for testing only.
          </div>
        </div>
      ) : (
        <div style={{ color: '#6a6a7a' }}>Loading world state…</div>
      )}
    </div>
  )
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [analytics, setAnalytics] = useState<{
    topLocations: Array<{ location_id: string; total_visits: number; unique_visitors: number }>;
    leastDiscoveredMysteries: Array<{ mystery_id: string; players_started: number; players_resolved: number; mysteries: { title: string } }>;
    commandVolume: number;
  } | null>(null)

  useEffect(() => {
    fetch('/api/admin/analytics').then(r => r.json()).then(setAnalytics).catch(() => {})
  }, [])

  return (
    <div>
      <h2 className="text-xl mb-6" style={{ color: '#e8e0d0' }}>Analytics (Anonymized)</h2>
      {analytics ? (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm mb-3" style={{ color: '#8a8a9a' }}>Most Visited Locations</h3>
            <div className="space-y-2">
              {analytics.topLocations.map(l => (
                <div key={l.location_id} className="flex items-center justify-between">
                  <div className="text-sm" style={{ color: '#e8e0d0' }}>
                    {l.location_id.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs" style={{ color: '#6a6a7a' }}>
                    {l.total_visits} visits · {l.unique_visitors} players
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm mb-3" style={{ color: '#8a8a9a' }}>Least Discovered Mysteries</h3>
            <div className="space-y-2">
              {analytics.leastDiscoveredMysteries.map(m => (
                <div key={m.mystery_id} className="flex items-center justify-between">
                  <div className="text-sm" style={{ color: '#e8e0d0' }}>
                    {m.mysteries?.title ?? m.mystery_id}
                  </div>
                  <div className="text-xs" style={{ color: '#6a6a7a' }}>
                    {m.players_started} started · {m.players_resolved} resolved
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: '#6a6a7a' }}>Loading analytics…</div>
      )}
    </div>
  )
}

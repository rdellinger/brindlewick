'use client'

import { useState } from 'react'

interface JournalEntry {
  id: string
  entry_type: string
  title: string
  content: string
  related_id: string | null
  game_date: string | null
  created_at: string
}

interface WorldEvent {
  id: string
  game_date: string
  event_type: string
  headline: string
  detail: string | null
  is_major: boolean
}

interface GameState {
  currentLocation: string
  inventory: string[]
  inventoryItems: Array<{ id: string; name: string }>
  timePosition: string | null
  hasChronoLogbook: boolean
  world: {
    date: string
    season: string
    dayOfWeek: string
    timeSlot: string
  } | null
  location: {
    name: string
    description: string
    exits: Array<{ id: string; name: string; label: string | null }>
    citizens: Array<{ id: string; name: string; occupation: string | null; trustLevel: number }>
    items: Array<{ id: string; name: string; canTake: boolean }>
  } | null
  stats: {
    journalEntries: number
    mysteriesStarted: number
    mysteriesResolved: number
  }
  upcomingEvents: Array<{ name: string; daysAway: number }>
  journalEntries: JournalEntry[]
  worldEvents: WorldEvent[]
  seenItemIds: string[]
  tasks: Array<{
    task_id: string
    title: string
    description: string
    status: 'available' | 'in_progress' | 'completed'
    giverName: string | null
    giverCitizenId: string | null
  }>
}

interface Props {
  gameState: GameState
  activeTab: 'location' | 'journal' | 'inventory' | 'tasks' | 'chronicle'
  onTabChange: (tab: 'location' | 'journal' | 'inventory' | 'tasks' | 'chronicle') => void
  onCommand: (cmd: string) => void
}

const SEASON_ICONS: Record<string, string> = {
  spring: '🌱',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️',
}

const TRUST_LABELS: Record<number, string> = {
  0: 'stranger',
  1: 'acquaintance',
  2: 'friendly',
  3: 'trusted',
  4: 'close friend',
}

const EVENT_TYPE_ICONS: Record<string, string> = {
  social: '💬',
  weather: '🌧',
  discovery: '🔍',
  rumor: '🗣',
  business: '🏪',
  seasonal: '🍂',
  mystery: '❓',
  community: '🤝',
}

function TrustDots({ level, max, showLabel }: { level: number; max: number; showLabel?: boolean }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="flex gap-0.5">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full inline-block"
            style={{
              backgroundColor: i < level ? 'var(--amber)' : 'var(--parchment)',
              border: `1px solid var(--warm-brown)`,
            }}
          />
        ))}
      </span>
      {showLabel && level > 0 && (
        <span
          className="text-xs"
          style={{ color: 'var(--amber)', fontSize: '0.6rem' }}
        >
          {TRUST_LABELS[level] ?? ''}
        </span>
      )}
    </span>
  )
}

const JOURNAL_ENTRY_LABEL: Record<string, string> = {
  citizen_met: 'Met',
  lore_discovered: 'Learned',
  mystery_clue: 'Clue',
  task_completed: 'Helped',
  location_visited: 'Visited',
  item_found: 'Found',
  event_witnessed: 'Witnessed',
  note: 'Note',
}

const JOURNAL_ENTRY_COLOR: Record<string, string> = {
  citizen_met: 'var(--amber)',
  mystery_clue: 'var(--lake-blue)',
  lore_discovered: 'var(--moss-green)',
  task_completed: 'var(--amber)',
  item_found: 'var(--moss-green)',
}

function clickableRow(styles?: React.CSSProperties) {
  return {
    cursor: 'pointer',
    borderRadius: '4px',
    padding: '4px 6px',
    margin: '0 -6px',
    transition: 'background-color 0.1s',
    ...styles,
  }
}

export default function Sidebar({ gameState, activeTab, onTabChange, onCommand }: Props) {
  const { location, world, stats, upcomingEvents, inventoryItems, tasks, journalEntries, worldEvents, timePosition, hasChronoLogbook, seenItemIds } = gameState

  const activeTasks = tasks.filter(t => t.status !== 'completed')

  // Seen items come from DB via gameState — persist across sessions and devices.
  // We also keep a local optimistic set so the label updates immediately on click
  // before the DB round-trip completes.
  const [optimisticSeen, setOptimisticSeen] = useState<Set<string>>(new Set())
  const seenItems = new Set([...(seenItemIds ?? []), ...optimisticSeen])

  const tabs: Array<{ id: 'location' | 'journal' | 'inventory' | 'tasks' | 'chronicle'; label: string; badge?: number }> = [
    { id: 'location', label: 'Here' },
    { id: 'journal', label: 'Journal' },
    { id: 'inventory', label: 'Carrying' },
    { id: 'tasks', label: 'Helping', badge: activeTasks.length || undefined },
    { id: 'chronicle', label: 'Town' },
  ]

  return (
    <aside
      className="w-72 shrink-0 flex flex-col border-l overflow-hidden"
      style={{
        backgroundColor: 'var(--parchment)',
        borderColor: 'var(--warm-brown)',
      }}
    >
      {/* World clock / temporal indicator */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: 'var(--warm-brown)' }}
      >
        {timePosition ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'var(--amber)' }}
              >
                ⧗ Traveling in the past
              </div>
            </div>
            <div
              className="text-sm font-medium"
              style={{ color: 'var(--deep-brown)' }}
            >
              {new Date(timePosition).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <div
              className="text-xs mt-1 cursor-pointer"
              style={{ color: 'var(--moss-green)' }}
              onClick={() => onCommand('return to present')}
              title="Return to the present"
            >
              → return to present
            </div>
          </div>
        ) : world ? (
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-sm font-medium"
                style={{ color: 'var(--deep-brown)' }}
              >
                {world.dayOfWeek.charAt(0).toUpperCase() + world.dayOfWeek.slice(1)}
              </div>
              <div
                className="text-xs"
                style={{ color: 'var(--soft-gray)' }}
              >
                {new Date(world.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                {' · '}{world.timeSlot.replace('_', ' ')}
              </div>
              {hasChronoLogbook && (
                <div
                  className="text-xs mt-1"
                  style={{ color: 'var(--amber)', fontSize: '0.65rem' }}
                >
                  ⧗ Chrono-Logbook
                </div>
              )}
            </div>
            <span className="text-xl">
              {SEASON_ICONS[world.season] ?? ''}
            </span>
          </div>
        ) : (
          <div className="text-xs" style={{ color: 'var(--soft-gray)' }}>
            Loading…
          </div>
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex border-b"
        style={{ borderColor: 'var(--warm-brown)' }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex-1 py-2 text-xs font-medium tracking-wide transition-colors relative"
            style={{
              color: activeTab === tab.id ? 'var(--deep-brown)' : 'var(--soft-gray)',
              borderBottom: activeTab === tab.id ? '2px solid var(--amber)' : '2px solid transparent',
              backgroundColor: 'transparent',
            }}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span
                className="absolute top-1 right-1 text-xs w-4 h-4 flex items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--amber)', color: 'var(--cream)', fontSize: '0.55rem' }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">

        {/* ── HERE ── */}
        {activeTab === 'location' && (
          <div className="space-y-4">
            <div>
              <div
                className="text-xs uppercase tracking-widest mb-1"
                style={{ color: 'var(--soft-gray)' }}
              >
                You are at
              </div>
              <div
                className="font-medium"
                style={{ color: 'var(--deep-brown)' }}
              >
                {location?.name ?? gameState.currentLocation.replace(/_/g, ' ')}
              </div>
            </div>

            {/* Who's here — clickable to talk */}
            {location?.citizens && location.citizens.length > 0 && (
              <div>
                <div
                  className="text-xs uppercase tracking-widest mb-2"
                  style={{ color: 'var(--soft-gray)' }}
                >
                  Present
                </div>
                <ul className="space-y-1">
                  {location.citizens.map(c => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between"
                      style={clickableRow()}
                      onClick={() => onCommand(`talk to ${c.name}`)}
                      title={`Talk to ${c.name}`}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(200,168,122,0.15)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                    >
                      <div>
                        <div
                          className="text-sm"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {c.name}
                        </div>
                        {c.occupation && (
                          <div
                            className="text-xs"
                            style={{ color: 'var(--soft-gray)' }}
                          >
                            {c.occupation}
                          </div>
                        )}
                      </div>
                      <TrustDots level={c.trustLevel} max={4} showLabel />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Items here — clickable to take or examine */}
            {location?.items && location.items.length > 0 && (
              <div>
                <div
                  className="text-xs uppercase tracking-widest mb-2"
                  style={{ color: 'var(--soft-gray)' }}
                >
                  Items
                </div>
                <ul className="space-y-1">
                  {location.items.map(item => {
                    const seen = seenItems.has(item.id)
                    return (
                      <li
                        key={item.id}
                        className="text-sm flex items-center justify-between"
                        style={clickableRow()}
                        onClick={() => {
                          if (item.canTake) {
                            onCommand(`take ${item.name}`)
                          } else {
                            setOptimisticSeen(prev => new Set(prev).add(item.id))
                            onCommand(`examine ${item.name}`)
                          }
                        }}
                        title={item.canTake ? `Take ${item.name}` : `Examine ${item.name}`}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(200,168,122,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                      >
                        <span style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                        <span style={{ color: 'var(--soft-gray)', fontSize: '0.65rem' }}>
                          {item.canTake ? 'take ↑' : seen ? 'seen' : 'look ↗'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {/* Exits — clickable to go */}
            {location?.exits && location.exits.length > 0 && (
              <div>
                <div
                  className="text-xs uppercase tracking-widest mb-2"
                  style={{ color: 'var(--soft-gray)' }}
                >
                  Nearby
                </div>
                <ul className="space-y-1">
                  {location.exits.map(exit => (
                    <li
                      key={exit.id}
                      className="text-sm flex items-center gap-1"
                      style={{ ...clickableRow({ color: 'var(--moss-green)' }) }}
                      onClick={() => onCommand(`go to ${exit.name}`)}
                      title={`Go to ${exit.name}`}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(90,122,90,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                    >
                      <span style={{ opacity: 0.6 }}>→</span>
                      <span>{exit.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Upcoming events */}
            {upcomingEvents.length > 0 && (
              <div>
                <div
                  className="text-xs uppercase tracking-widest mb-2"
                  style={{ color: 'var(--soft-gray)' }}
                >
                  Coming up
                </div>
                <ul className="space-y-1">
                  {upcomingEvents.map(event => (
                    <li
                      key={event.name}
                      className="text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {event.name}
                      <span style={{ color: 'var(--soft-gray)' }}>
                        {' '}in {event.daysAway} {event.daysAway === 1 ? 'day' : 'days'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── JOURNAL ── */}
        {activeTab === 'journal' && (
          <div className="space-y-3">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded" style={{ backgroundColor: 'var(--cream)' }}>
                <div className="text-lg font-medium" style={{ color: 'var(--deep-brown)' }}>{stats.journalEntries}</div>
                <div className="text-xs" style={{ color: 'var(--soft-gray)' }}>entries</div>
              </div>
              <div className="p-2 rounded" style={{ backgroundColor: 'var(--cream)' }}>
                <div className="text-lg font-medium" style={{ color: 'var(--lake-blue)' }}>{stats.mysteriesStarted}</div>
                <div className="text-xs" style={{ color: 'var(--soft-gray)' }}>threads</div>
              </div>
              <div className="p-2 rounded" style={{ backgroundColor: 'var(--cream)' }}>
                <div className="text-lg font-medium" style={{ color: 'var(--moss-green)' }}>{stats.mysteriesResolved}</div>
                <div className="text-xs" style={{ color: 'var(--soft-gray)' }}>resolved</div>
              </div>
            </div>

            {/* Entry list */}
            {journalEntries.length === 0 ? (
              <p className="text-xs italic" style={{ color: 'var(--soft-gray)' }}>
                Your journal updates automatically as you explore.
              </p>
            ) : (
              <ul className="space-y-1">
                {journalEntries.map(entry => {
                  const label = JOURNAL_ENTRY_LABEL[entry.entry_type] ?? 'Note'
                  const color = JOURNAL_ENTRY_COLOR[entry.entry_type] ?? 'var(--soft-gray)'
                  const isCitizen = entry.entry_type === 'citizen_met'
                  const isClue = entry.entry_type === 'mystery_clue' || entry.entry_type === 'lore_discovered'

                  const handleClick = () => {
                    if (isCitizen) {
                      // Extract citizen name from title like "Met Eleanor Finch-Hartwell"
                      const name = entry.title.replace(/^Met\s+/i, '')
                      onCommand(`recall ${name}`)
                    } else if (isClue && entry.related_id) {
                      onCommand(`recall ${entry.title.replace(/^(Examined:|Research:|Found:)\s*/i, '')}`)
                    }
                  }

                  const isClickable = isCitizen || isClue

                  return (
                    <li
                      key={entry.id}
                      style={isClickable ? clickableRow() : { padding: '4px 6px', margin: '0 -6px' }}
                      onClick={isClickable ? handleClick : undefined}
                      title={isClickable ? (isCitizen ? 'Recall what you know about this person' : 'View notes') : undefined}
                      onMouseEnter={isClickable ? e => (e.currentTarget.style.backgroundColor = 'rgba(200,168,122,0.15)') : undefined}
                      onMouseLeave={isClickable ? e => (e.currentTarget.style.backgroundColor = '') : undefined}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="text-xs mt-0.5 shrink-0"
                          style={{ color, fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        >
                          {label}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}>
                          {entry.title}
                          {isClickable && (
                            <span style={{ color: 'var(--soft-gray)', marginLeft: 4, fontSize: '0.6rem' }}>↗</span>
                          )}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* ── CARRYING ── */}
        {activeTab === 'inventory' && (
          <div className="space-y-1">
            {inventoryItems.length === 0 ? (
              <p
                className="text-sm italic"
                style={{ color: 'var(--soft-gray)' }}
              >
                You&apos;re not carrying anything. Your pockets are pleasantly light.
              </p>
            ) : (
              <ul>
                {inventoryItems.map(item => (
                  <li
                    key={item.id}
                    className="text-sm py-2 border-b flex items-center justify-between"
                    style={{
                      borderBottom: '1px solid var(--warm-brown)',
                      padding: '8px 6px',
                      margin: '0 -6px',
                    }}
                  >
                    <span
                      style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                      onClick={() => onCommand(`examine ${item.name}`)}
                      title={`Examine ${item.name}`}
                    >
                      {item.name}
                    </span>
                    <span
                      style={{ color: 'var(--soft-gray)', fontSize: '0.65rem', cursor: 'pointer' }}
                      onClick={() => onCommand(`drop ${item.name}`)}
                      title={`Drop ${item.name}`}
                      onMouseEnter={e => ((e.target as HTMLElement).style.color = 'var(--amber)')}
                      onMouseLeave={e => ((e.target as HTMLElement).style.color = 'var(--soft-gray)')}
                    >
                      drop ↓
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {inventoryItems.length > 0 && (
              <p className="text-xs italic pt-1" style={{ color: 'var(--soft-gray)' }}>
                Click an item to examine it · drop ↓ to set it down.
              </p>
            )}
          </div>
        )}

        {/* ── HELPING ── */}
        {activeTab === 'tasks' && (
          <div className="space-y-3">
            {activeTasks.length === 0 ? (
              <p className="text-sm italic" style={{ color: 'var(--soft-gray)' }}>
                No open tasks yet. Talk to the people of Brindlewick — they often need a hand.
              </p>
            ) : (
              <ul className="space-y-3">
                {activeTasks.map(task => (
                  <li
                    key={task.task_id}
                    className="p-2 rounded"
                    style={{ backgroundColor: 'var(--cream)', border: '1px solid var(--warm-brown)' }}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div
                        className="text-sm font-medium"
                        style={{ color: 'var(--deep-brown)', lineHeight: 1.3 }}
                      >
                        {task.title}
                      </div>
                      <span
                        className="text-xs shrink-0 px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: task.status === 'in_progress' ? 'rgba(90,122,90,0.15)' : 'rgba(200,168,122,0.2)',
                          color: task.status === 'in_progress' ? 'var(--moss-green)' : 'var(--amber)',
                          fontSize: '0.6rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {task.status === 'in_progress' ? 'active' : 'offered'}
                      </span>
                    </div>
                    <div className="text-xs mb-2" style={{ color: 'var(--soft-gray)', lineHeight: 1.5 }}>
                      {task.description}
                    </div>
                    {task.giverName && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--soft-gray)' }}>for</span>
                        <span
                          className="text-xs cursor-pointer"
                          style={{ color: 'var(--amber)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                          onClick={() => onCommand(`find ${task.giverName}`)}
                          title={`Find ${task.giverName}`}
                        >
                          {task.giverName}
                        </span>
                        <span
                          className="text-xs cursor-pointer ml-auto"
                          style={{ color: 'var(--moss-green)' }}
                          onClick={() => onCommand(`recall ${task.giverName}`)}
                          title="Recall what you know"
                        >
                          recall ↗
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── CHRONICLE ── */}
        {activeTab === 'chronicle' && (
          <div className="space-y-1">
            <div
              className="text-xs mb-3"
              style={{ color: 'var(--soft-gray)' }}
            >
              Brindlewick continues even when you&apos;re away. Type <em>what happened</em> for a summary.
            </div>
            {worldEvents.length === 0 ? (
              <p className="text-xs italic" style={{ color: 'var(--soft-gray)' }}>
                The town chronicle is quiet. Come back after a day has passed.
              </p>
            ) : (
              <ul className="space-y-3">
                {worldEvents.map(event => {
                  const icon = EVENT_TYPE_ICONS[event.event_type] ?? '•'
                  const date = new Date(event.game_date).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric',
                  })
                  return (
                    <li
                      key={event.id}
                      className="text-xs"
                      style={{
                        borderLeft: event.is_major ? '2px solid var(--amber)' : '2px solid var(--warm-brown)',
                        paddingLeft: 8,
                        paddingTop: 2,
                        paddingBottom: 2,
                      }}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <span>{icon}</span>
                        <span style={{ color: 'var(--soft-gray)' }}>{date}</span>
                        {event.is_major && (
                          <span
                            className="text-xs"
                            style={{ color: 'var(--amber)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                          >
                            notable
                          </span>
                        )}
                      </div>
                      <p style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
                        {event.headline}
                      </p>
                      {event.detail && (
                        <p className="mt-0.5" style={{ color: 'var(--soft-gray)', fontStyle: 'italic' }}>
                          {event.detail}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

      </div>

      {/* Footer */}
      <div
        className="px-4 py-3 border-t text-xs"
        style={{
          borderColor: 'var(--warm-brown)',
          color: 'var(--soft-gray)',
        }}
      >
        No saves needed — Brindlewick remembers you.
      </div>
    </aside>
  )
}

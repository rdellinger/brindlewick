'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import GameOutput from '../../components/game/GameOutput'
import CommandInput from '../../components/game/CommandInput'
import Sidebar from '../../components/game/Sidebar'
import { createClient } from '../../lib/supabase/client'
import type { GameResponse, ConversationMessage } from '../../types/game'

interface OutputEntry {
  id: string
  text: string
  type: 'narration' | 'command' | 'system'
  isNew: boolean
}

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
  guestToken: string | null
  timePosition: string | null        // null = present; date string = historical
  hasChronoLogbook: boolean
  world: {
    date: string
    season: string
    dayOfWeek: string
    timeSlot: string
    time: string | null        // "2:47 PM"
    displayDate: string | null // "Thursday, June 26"
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
  activeEvents: Array<{ name: string }>
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

/** Shape of the sidebar-state payload returned by GET /api/game/state and,
 *  since Phase 2 (A3), attached to POST /api/game/command responses. */
interface StatePayload {
  session: {
    currentLocation: string
    inventory: string[]
    timePosition: string | null
    hasChronoLogbook: boolean
  }
  world: NonNullable<GameState['world']>
  location: GameState['location']
  stats: GameState['stats']
  upcomingEvents: GameState['upcomingEvents']
  activeEvents: GameState['activeEvents']
  journalEntries: JournalEntry[]
  worldEvents: WorldEvent[]
  seenItemIds: string[]
  tasks: GameState['tasks']
  inventoryItems: Array<{ id: string; name: string }>
  error?: string
}

const INTRO_TEXT = `**Welcome to Brindlewick.**

You've arrived in the valley on a clear morning. The lake glitters at the foot of the mountains. Somewhere nearby, a bakery is producing a smell that makes you feel, unreasonably, that everything is going to be fine.

You're standing in the entry hall of the Lantern Post Inn. The innkeeper — a cheerful young man with unruly hair — has just handed you a room key and said, "Brindlewick is very small. You'll know everyone within a week. That's a good thing."

The town is yours to explore. There's no hurry. There never is, here.

*Type what you'd like to do. Try: **look around** or **go to the town square** or **talk to Teddy***`

function makeId() {
  return Math.random().toString(36).slice(2)
}

// Wrap in Suspense because useSearchParams() requires it in Next.js App Router
export default function GamePage() {
  return (
    <Suspense>
      <GamePageInner />
    </Suspense>
  )
}

function GamePageInner() {
  const searchParams = useSearchParams()
  const isWelcome = searchParams.get('welcome') === '1'
  const [output, setOutput] = useState<OutputEntry[]>([
    { id: makeId(), text: INTRO_TEXT, type: 'narration', isNew: false },
  ])
  const [gameState, setGameState] = useState<GameState>({
    currentLocation: 'lantern_post_inn',
    inventory: [],
    inventoryItems: [],
    guestToken: null,
    timePosition: null,
    hasChronoLogbook: false,
    world: null,
    location: null,
    stats: { journalEntries: 0, mysteriesStarted: 0, mysteriesResolved: 0 },
    upcomingEvents: [],
    activeEvents: [],
    journalEntries: [],
    worldEvents: [],
    seenItemIds: [],
    tasks: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'location' | 'journal' | 'inventory' | 'tasks' | 'chronicle'>('location')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [activeConversation, setActiveConversation] = useState<{
    citizenId: string
    citizenName: string
    history: ConversationMessage[]
  } | null>(null)
  const [pendingRestart, setPendingRestart] = useState(false)
  // Live ET clock — ticks every minute
  const [liveClock, setLiveClock] = useState<{ time: string; displayDate: string } | null>(null)
  useEffect(() => {
    function tick() {
      const now = new Date()
      const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
      const et = new Date(etStr)
      const time = et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      const displayDate = et.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      setLiveClock({ time, displayDate })
    }
    tick()
    const interval = setInterval(tick, 60_000)
    return () => clearInterval(interval)
  }, [])

  const [pendingEscortOffer, setPendingEscortOffer] = useState<{
    destination_id: string
    destination_name: string
    citizen_id: string
    citizen_name: string
  } | null>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)

  // Apply a sidebar-state payload (from GET /state or a command response)
  const applyStateData = useCallback((data: StatePayload) => {
    setGameState(prev => ({
      ...prev,
      currentLocation: data.session.currentLocation,
      inventory: data.session.inventory,
      inventoryItems: data.inventoryItems ?? [],
      timePosition: data.session.timePosition ?? null,
      hasChronoLogbook: data.session.hasChronoLogbook ?? false,
      world: data.world,
      location: data.location,
      stats: data.stats,
      upcomingEvents: data.upcomingEvents,
      activeEvents: data.activeEvents ?? [],
      journalEntries: data.journalEntries ?? [],
      worldEvents: data.worldEvents ?? [],
      seenItemIds: data.seenItemIds ?? [],
      tasks: data.tasks ?? [],
    }))
  }, [])

  const loadGameState = useCallback(async (token: string | null) => {
    try {
      const res = await fetch(`/api/game/state${token ? `?guestToken=${token}` : ''}`)
      const data: StatePayload = await res.json()
      if (data.error) return
      applyStateData(data)
    } catch {
      // Silently fail — game still works, sidebar just won't update
    }
  }, [applyStateData])

  // Initialize: check auth, load guest token, run migration if just logged in
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        setUserEmail(user.email ?? null)

        // If coming back from magic-link and there's a guest token, migrate progress
        if (isWelcome) {
          const guestToken = localStorage.getItem('brindlewick_guest_token')
          if (guestToken) {
            await fetch('/api/auth/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ guestToken }),
            })
            localStorage.removeItem('brindlewick_guest_token')
          }
          // Clear the ?welcome=1 from URL without reloading
          window.history.replaceState({}, '', '/game')
        }

        // Authenticated players don't need a guest token
        setGameState(prev => ({ ...prev, guestToken: null }))
        loadGameState(null)
      } else {
        // Guest flow
        let token = localStorage.getItem('brindlewick_guest_token')
        if (!token) {
          token = `guest_${Math.random().toString(36).slice(2)}`
          localStorage.setItem('brindlewick_guest_token', token)
        }
        setGameState(prev => ({ ...prev, guestToken: token }))
        loadGameState(token)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll output
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  // Clear "new" flag after animation
  useEffect(() => {
    const timer = setTimeout(() => {
      setOutput(prev => prev.map(e => ({ ...e, isNew: false })))
    }, 500)
    return () => clearTimeout(timer)
  }, [output.length])

  const handleCommand = useCallback(async (input: string) => {
    if (!input.trim() || isLoading) return

    const token = gameState.guestToken

    // Add command to output
    const commandEntry: OutputEntry = {
      id: makeId(),
      text: `> ${input}`,
      type: 'command',
      isNew: true,
    }
    setOutput(prev => [...prev, commandEntry])

    // ── Restart confirmation intercept ──────────────────────────────────────
    if (pendingRestart) {
      setPendingRestart(false)
      if (input.trim().toLowerCase() === 'i understand') {
        setIsLoading(true)
        try {
          const res = await fetch('/api/game/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guestToken: token }),
          })
          if (res.ok) {
            localStorage.removeItem('brindlewick_guest_token')
            window.location.href = '/'
          } else {
            setOutput(prev => [...prev, { id: makeId(), text: 'Something went wrong. Your save was not deleted.', type: 'system', isNew: true }])
          }
        } finally {
          setIsLoading(false)
        }
        return
      } else {
        setOutput(prev => [...prev, { id: makeId(), text: '*Restart cancelled. Your progress is safe.*', type: 'system', isNew: true }])
        setIsLoading(false)
        return
      }
    }

    setIsLoading(true)

    try {
      const res = await fetch('/api/game/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          guestToken: token,
          activeCitizenId: activeConversation?.citizenId ?? null,
          conversationHistory: activeConversation?.history ?? null,
          pendingEscortOffer: pendingEscortOffer ?? null,
        }),
      })

      const data: GameResponse & {
        guestToken?: string
        currentLocation?: string
        state?: StatePayload
      } = await res.json()

      // Save guest token if new
      if (data.guestToken && data.guestToken !== token) {
        localStorage.setItem('brindlewick_guest_token', data.guestToken)
        setGameState(prev => ({ ...prev, guestToken: data.guestToken! }))
      }

      // Add response to output
      if (data.text) {
        const responseEntry: OutputEntry = {
          id: makeId(),
          text: data.text,
          type: 'narration',
          isNew: true,
        }
        setOutput(prev => [...prev, responseEntry])
      }

      // Manage conversation state
      if (data.conversation_start) {
        // Seed history with all prior exchanges + this new greeting
        setActiveConversation({
          citizenId: data.conversation_start.citizenId,
          citizenName: data.conversation_start.citizenName,
          history: [
            ...(data.conversation_start.priorHistory ?? []),
            { role: 'assistant' as const, content: data.text },
          ],
        })
        setPendingEscortOffer(null)
      } else if (activeConversation && !data.conversation_end) {
        // Append to ongoing conversation history
        setActiveConversation(prev => prev ? {
          ...prev,
          history: [
            ...prev.history,
            { role: 'user', content: input },
            { role: 'assistant', content: data.text },
          ],
        } : null)
        // Track any escort offer the NPC just made
        if (data.escort_offer) {
          setPendingEscortOffer(data.escort_offer)
        } else if (pendingEscortOffer) {
          // Clear offer once the player's reply was processed (accepted or not)
          setPendingEscortOffer(null)
        }
      } else if (data.conversation_end) {
        setActiveConversation(null)
        setPendingEscortOffer(null)
      }

      // Set pending restart flag if engine asked for confirmation
      if (data.restart_pending) {
        setPendingRestart(true)
      }

      // Update game state
      if (data.currentLocation || data.location || data.inventory_update) {
        setGameState(prev => ({
          ...prev,
          currentLocation: data.currentLocation ?? prev.currentLocation,
          inventory: data.inventory_update ?? prev.inventory,
          location: data.location ? {
            name: data.location.name,
            description: data.location.long_desc,
            exits: [],  // Will reload from state
            citizens: [],
            items: [],
          } : prev.location,
        }))

        // Refresh full state after a move (A3: applied from the command
        // response when present; network fallback kept for safety), then
        // inject the escorting NPC into the fresh citizens list
        if (data.location) {
          const escortCitizen = data.escorting_citizen
          if (data.state) {
            applyStateData(data.state)
          } else {
            await loadGameState(data.guestToken ?? token)
          }
          if (escortCitizen) {
            setGameState(prev => {
              if (!prev.location) return prev
              if (prev.location.citizens.some(c => c.id === escortCitizen.id)) return prev
              return {
                ...prev,
                location: {
                  ...prev.location,
                  citizens: [
                    ...prev.location.citizens,
                    {
                      id: escortCitizen.id,
                      name: escortCitizen.name,
                      occupation: escortCitizen.occupation,
                      trustLevel: escortCitizen.trust_level,
                    },
                  ],
                },
              }
            })
          }
        }
      }

      // Refresh sidebar when trust, journal, mystery, inventory, or tasks
      // change (A3: served from the command response; the extra GET /state
      // round-trip only happens as a fallback when no state was attached)
      if (!data.location && (data.trust_update || data.journal_entry || data.mystery_update || data.inventory_update || data.task_update || data.seen_item_id)) {
        if (data.state) applyStateData(data.state)
        else loadGameState(data.guestToken ?? token)
      }

      // Always refresh state after travel/return so time indicator updates
      const parsedText = data.text ?? ''
      if (
        parsedText.includes('Chrono-Logbook shimmers') ||
        parsedText.includes('Chrono-Logbook closes') ||
        parsedText.includes('now carrying the Chrono-Logbook')
      ) {
        if (data.state) applyStateData(data.state)
        else loadGameState(data.guestToken ?? token)
      }

      // Handle mystery update notification
      if (data.mystery_update?.clue_found) {
        setOutput(prev => [...prev, {
          id: makeId(),
          text: `*— A new thread appears in your journal. —*`,
          type: 'system',
          isNew: true,
        }])
      }

      // Handle trust update
      if (data.trust_update) {
        const trustEntry: OutputEntry = {
          id: makeId(),
          text: `*Your relationship with someone in town has deepened.*`,
          type: 'system',
          isNew: true,
        }
        setOutput(prev => [...prev, trustEntry])
      }
    } catch {
      setOutput(prev => [...prev, {
        id: makeId(),
        text: 'A gentle hiccup. The world is still here — try again.',
        type: 'system',
        isNew: true,
      }])
    } finally {
      setIsLoading(false)
    }
  }, [gameState.guestToken, isLoading, loadGameState, applyStateData, activeConversation, pendingEscortOffer])

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: 'var(--cream)' }}
    >
      {/* Main game area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header
          className="px-6 py-3 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--deep-brown)',
            borderColor: 'var(--warm-brown)',
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg" style={{ color: 'var(--amber)' }}>⬡</span>
            <h1
              className="text-lg tracking-wide"
              style={{ color: 'var(--cream)', fontFamily: 'Georgia, serif' }}
            >
              Brindlewick
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {gameState.timePosition ? (
              <div
                className="text-xs tracking-wide px-2 py-1 rounded"
                style={{ color: 'var(--amber)', backgroundColor: 'rgba(212,160,23,0.15)', border: '1px solid rgba(212,160,23,0.3)' }}
              >
                ⧗ {new Date(gameState.timePosition).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} — Past
              </div>
            ) : gameState.world && (
              <div
                className="text-xs tracking-wide"
                style={{ color: 'var(--soft-gray)' }}
              >
                {gameState.world.season.charAt(0).toUpperCase() + gameState.world.season.slice(1)}
                {' · '}
                {liveClock ? liveClock.displayDate : new Date(gameState.world.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                {liveClock && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--amber)' }}>{liveClock.time}</span>
                  </>
                )}
              </div>
            )}

            {/* Auth status */}
            {userEmail ? (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--soft-gray)' }}>
                  {userEmail.split('@')[0]}
                </span>
                <button
                  onClick={async () => {
                    const supabase = createClient()
                    await supabase.auth.signOut()
                    setUserEmail(null)
                    // Restore guest token flow
                    const token = `guest_${Math.random().toString(36).slice(2)}`
                    localStorage.setItem('brindlewick_guest_token', token)
                    setGameState(prev => ({ ...prev, guestToken: token }))
                  }}
                  className="text-xs underline"
                  style={{ color: 'var(--soft-gray)' }}
                >
                  sign out
                </button>
              </div>
            ) : (
              <a
                href="/login"
                className="text-xs underline"
                style={{ color: 'var(--amber)' }}
              >
                save progress ↗
              </a>
            )}
          </div>
        </header>

        {/* Output scroll area */}
        <main className="flex-1 overflow-y-auto px-6 py-4">
          <GameOutput entries={output} />
          <div ref={outputEndRef} />
        </main>

        {/* Input area */}
        <footer
          className="px-6 py-4 border-t shrink-0"
          style={{
            backgroundColor: 'var(--parchment)',
            borderColor: 'var(--warm-brown)',
          }}
        >
          <CommandInput onSubmit={handleCommand} isLoading={isLoading} />
          <p
            className="mt-2 text-xs"
            style={{ color: 'var(--soft-gray)' }}
          >
            {activeConversation
              ? <>Talking with <em>{activeConversation.citizenName}</em> · Type freely · <em>bye</em> to end · <em>go to [place]</em> to leave</>
              : gameState.timePosition
              ? <>In the past: <em>look around</em> · <em>talk to [name]</em> · <em>ask [name] about [topic]</em> · <em>return to present</em></>
              : <>Try: <em>look around</em> · <em>talk to Teddy</em> · <em>go to the bakery</em> · <em>what happened</em> · <em>help</em></>
            }
          </p>
        </footer>
      </div>

      {/* Sidebar */}
      <Sidebar
        gameState={gameState}
        activeTab={sidebarTab}
        onTabChange={setSidebarTab}
        onCommand={handleCommand}
      />
    </div>
  )
} // end GamePageInner

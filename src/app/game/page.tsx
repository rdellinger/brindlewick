'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import GameOutput from '../../components/game/GameOutput'
import CommandInput from '../../components/game/CommandInput'
import Sidebar from '../../components/game/Sidebar'
import type { GameResponse } from '../../types/game'

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
  tasks: Array<{
    task_id: string
    title: string
    description: string
    status: 'available' | 'in_progress' | 'completed'
    giverName: string | null
  }>
}

const INTRO_TEXT = `**Welcome to Brindlewick.**

You've arrived in the valley on a clear morning. The lake glitters at the foot of the mountains. Somewhere nearby, a bakery is producing a smell that makes you feel, unreasonably, that everything is going to be fine.

You're standing in the entry hall of the Lantern Post Inn. The innkeeper — a cheerful young man with unruly hair — has just handed you a room key and said, "Brindlewick is very small. You'll know everyone within a week. That's a good thing."

The town is yours to explore. There's no hurry. There never is, here.

*Type what you'd like to do. Try: **look around** or **go to the town square** or **talk to Teddy***`

function makeId() {
  return Math.random().toString(36).slice(2)
}

export default function GamePage() {
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
    journalEntries: [],
    worldEvents: [],
    tasks: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'location' | 'journal' | 'inventory' | 'tasks' | 'chronicle'>('location')
  const outputEndRef = useRef<HTMLDivElement>(null)

  // Initialize: load guest token and game state
  useEffect(() => {
    let token = localStorage.getItem('brindlewick_guest_token')
    if (!token) {
      token = `guest_${Math.random().toString(36).slice(2)}`
      localStorage.setItem('brindlewick_guest_token', token)
    }
    setGameState(prev => ({ ...prev, guestToken: token }))
    loadGameState(token)
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

  const loadGameState = useCallback(async (token: string) => {
    try {
      const res = await fetch(`/api/game/state?guestToken=${token}`)
      const data = await res.json()
      if (data.error) return

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
        journalEntries: data.journalEntries ?? [],
        worldEvents: data.worldEvents ?? [],
        tasks: data.tasks ?? [],
      }))
    } catch {
      // Silently fail — game still works, sidebar just won't update
    }
  }, [])

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
    setIsLoading(true)

    try {
      const res = await fetch('/api/game/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, guestToken: token }),
      })

      const data: GameResponse & {
        guestToken?: string
        currentLocation?: string
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

        // Reload full state after a move
        if (data.location) {
          const currentToken = data.guestToken ?? token
          if (currentToken) loadGameState(currentToken)
        }
      }

      // After any trust update, journal event, or time travel, reload sidebar data
      if (data.trust_update || data.journal_entry || data.mystery_update) {
        const currentToken = data.guestToken ?? token
        if (currentToken) loadGameState(currentToken)
      }

      // Always reload state after travel/return so time indicator updates
      const parsedText = data.text ?? ''
      if (
        parsedText.includes('Chrono-Logbook shimmers') ||
        parsedText.includes('Chrono-Logbook closes') ||
        parsedText.includes('now carrying the Chrono-Logbook')
      ) {
        const currentToken = data.guestToken ?? token
        if (currentToken) loadGameState(currentToken)
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
  }, [gameState.guestToken, isLoading, loadGameState])

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
              {new Date(gameState.world.date).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
              })}
            </div>
          )}
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
            {gameState.timePosition
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
}

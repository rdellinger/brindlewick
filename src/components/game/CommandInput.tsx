'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  onSubmit: (input: string) => void
  isLoading: boolean
}

// Command history navigation
const MAX_HISTORY = 50

export default function CommandInput({ onSubmit, isLoading }: Props) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refocus input whenever loading finishes
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus()
    }
  }, [isLoading])

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || isLoading) return

    onSubmit(trimmed)
    setHistory(prev => [trimmed, ...prev.slice(0, MAX_HISTORY - 1)])
    setHistoryIdx(-1)
    setValue('')
  }, [value, isLoading, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(newIdx)
      setValue(history[newIdx] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(historyIdx - 1, -1)
      setHistoryIdx(newIdx)
      setValue(newIdx === -1 ? '' : history[newIdx])
    }
  }, [history, historyIdx])

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <span style={{ color: 'var(--amber)', fontFamily: 'monospace', fontSize: '1.1em' }}>›</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isLoading ? 'A moment…' : 'What would you like to do?'}
        disabled={isLoading}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className="game-input flex-1 bg-transparent border-b text-base py-1 transition-all"
        style={{
          borderColor: 'var(--warm-brown)',
          color: 'var(--text-primary)',
          fontFamily: 'Georgia, serif',
          fontSize: '1rem',
          opacity: isLoading ? 0.6 : 1,
        }}
      />
      {isLoading && (
        <span
          className="text-xs animate-pulse"
          style={{ color: 'var(--soft-gray)' }}
        >
          …
        </span>
      )}
    </form>
  )
}

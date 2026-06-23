'use client'

import { useMemo } from 'react'

interface OutputEntry {
  id: string
  text: string
  type: 'narration' | 'command' | 'system'
  isNew: boolean
}

interface Props {
  entries: OutputEntry[]
}

// Convert simple markdown to styled spans (no library dependency)
function renderText(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, lineIdx) => {
    if (!line.trim()) return <br key={lineIdx} />

    // Process inline formatting
    const segments: React.ReactNode[] = []
    let remaining = line
    let key = 0

    // HR
    if (line.trim() === '---') {
      return <hr key={lineIdx} style={{ borderColor: 'var(--parchment)', margin: '0.75em 0' }} />
    }

    // Process ** and * in order
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/)
      const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/)

      if (boldMatch && (!italicMatch || boldMatch[0].length <= italicMatch[0].length)) {
        if (boldMatch[1]) segments.push(<span key={key++}>{boldMatch[1]}</span>)
        segments.push(
          <strong key={key++} style={{ color: 'var(--deep-brown)', fontWeight: 'bold' }}>
            {boldMatch[2]}
          </strong>
        )
        remaining = remaining.slice(boldMatch[0].length)
      } else if (italicMatch) {
        if (italicMatch[1]) segments.push(<span key={key++}>{italicMatch[1]}</span>)
        segments.push(
          <em key={key++} style={{ color: 'var(--soft-gray)', fontStyle: 'italic' }}>
            {italicMatch[2]}
          </em>
        )
        remaining = remaining.slice(italicMatch[0].length)
      } else {
        segments.push(<span key={key++}>{remaining}</span>)
        remaining = ''
      }
    }

    return (
      <p key={lineIdx} style={{ marginBottom: '0.5em', lineHeight: '1.7' }}>
        {segments}
      </p>
    )
  })
}

export default function GameOutput({ entries }: Props) {
  return (
    <div className="space-y-4 max-w-2xl">
      {entries.map(entry => (
        <div
          key={entry.id}
          className={entry.isNew ? 'new-entry' : ''}
          style={{
            ...(entry.type === 'command' ? {
              color: 'var(--soft-gray)',
              fontFamily: 'monospace',
              fontSize: '0.9em',
              paddingLeft: '0.5em',
              borderLeft: '2px solid var(--parchment)',
            } : entry.type === 'system' ? {
              color: 'var(--moss-green)',
              fontStyle: 'italic',
              fontSize: '0.9em',
              textAlign: 'center' as const,
            } : {
              color: 'var(--text-primary)',
            }),
          }}
        >
          {entry.type === 'command' ? (
            <span style={{ fontFamily: 'monospace' }}>{entry.text}</span>
          ) : (
            <div className="game-output">{renderText(entry.text)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

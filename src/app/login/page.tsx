'use client'

import { useState } from 'react'
import { createClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--cream)' }}
    >
      <div
        className="w-full max-w-sm p-8 rounded-lg border"
        style={{
          backgroundColor: 'var(--parchment)',
          borderColor: 'var(--warm-brown)',
        }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-3xl" style={{ color: 'var(--amber)' }}>⬡</span>
          <h1
            className="mt-3 text-2xl"
            style={{ color: 'var(--deep-brown)', fontFamily: 'Georgia, serif' }}
          >
            Brindlewick
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--soft-gray)' }}>
            Sign in to save your progress
          </p>
        </div>

        {sent ? (
          <div className="text-center">
            <p
              className="text-base mb-2"
              style={{ color: 'var(--deep-brown)', fontFamily: 'Georgia, serif' }}
            >
              Check your inbox.
            </p>
            <p className="text-sm" style={{ color: 'var(--soft-gray)' }}>
              A sign-in link has been sent to <strong>{email}</strong>.
              Click it to return to Brindlewick — no password needed.
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="mt-6 text-xs underline"
              style={{ color: 'var(--soft-gray)' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label
              className="block text-sm mb-2"
              style={{ color: 'var(--deep-brown)' }}
            >
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              required
              className="w-full px-3 py-2 rounded border text-base mb-4"
              style={{
                backgroundColor: 'var(--cream)',
                borderColor: 'var(--warm-brown)',
                color: 'var(--text-primary)',
                fontFamily: 'Georgia, serif',
              }}
            />

            {error && (
              <p className="text-sm mb-3" style={{ color: '#b94a48' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded text-sm tracking-wide transition-opacity"
              style={{
                backgroundColor: 'var(--deep-brown)',
                color: 'var(--cream)',
                opacity: loading ? 0.6 : 1,
                fontFamily: 'Georgia, serif',
              }}
            >
              {loading ? 'Sending…' : 'Send sign-in link'}
            </button>

            <p className="mt-4 text-xs text-center" style={{ color: 'var(--soft-gray)' }}>
              New to Brindlewick? Enter your email and we&apos;ll create an account for you.
            </p>
          </form>
        )}

        <div className="mt-8 pt-6 border-t text-center" style={{ borderColor: 'var(--warm-brown)' }}>
          <a
            href="/game"
            className="text-xs underline"
            style={{ color: 'var(--soft-gray)' }}
          >
            Continue without signing in
          </a>
        </div>
      </div>
    </div>
  )
}

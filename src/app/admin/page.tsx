'use client'

import { useState } from 'react'
import AdminDashboard from '../../components/admin/AdminDashboard'

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: password }),
    })
    if (res.ok) {
      setAuthed(true)
      setError('')
    } else {
      setError('Incorrect password.')
    }
  }

  if (!authed) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-80">
          <h1 className="text-xl mb-6 text-center" style={{ color: '#c8903a' }}>
            Brindlewick Admin
          </h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full px-4 py-2 rounded bg-gray-800 border border-gray-600 text-white"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              className="w-full py-2 rounded font-medium"
              style={{ backgroundColor: '#c8903a', color: '#1a1a24' }}
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    )
  }

  return <AdminDashboard />
}

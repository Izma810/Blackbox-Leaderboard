import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiUrl } from '../lib/backend'

export default function Home() {
  const navigate = useNavigate()

  const [roomId, setRoomId]     = useState('')
  const [username, setUsername] = useState('')
  const [joining, setJoining]   = useState(false)
  const [error, setError]       = useState('')

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!roomId.trim() || !username.trim()) return

    setJoining(true)
    try {
      const res = await fetch(apiUrl(`/api/rooms/${roomId.trim()}/join`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      })
      const data = await res.json() as { playerId?: string; error?: string }

      if (!res.ok || !data.playerId) {
        setError(data.error ?? 'Failed to join room')
        return
      }

      localStorage.setItem(`playerId:${roomId.trim()}`, data.playerId)
      localStorage.setItem(`username:${roomId.trim()}`, username.trim())
      navigate(`/room/${roomId.trim()}`)
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-xl font-bold tracking-tight">blackbox</span>
        <Link to="/admin" className="btn-ghost px-3 py-2 text-sm">Host a game →</Link>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 pb-16 lg:grid-cols-[1.2fr_1fr]">
        {/* Pitch */}
        <section className="flex flex-col gap-8">
          <div className="flex items-center gap-3 font-display text-lg font-semibold text-ink-3">
            <span>x</span>
            <span aria-hidden>→</span>
            <span className="rounded-lg bg-ink px-3 py-1 text-white">? ? ?</span>
            <span aria-hidden>→</span>
            <span>y</span>
          </div>

          <h1 className="text-5xl font-bold leading-[1.05] sm:text-6xl">
            Crack the hidden function.
            <br />
            <span className="text-accent">Bet on who&rsquo;s right.</span>
          </h1>

          <p className="max-w-lg text-lg text-ink-2">
            Everyone sees the same data. Be the first to claim the formula behind it.
            Then put your coins on the other claims you think are right, or against the ones you think are wrong.
          </p>

          <ol className="grid max-w-xl gap-3 sm:grid-cols-3">
            {[
              ['Explore', 'Plot the data and look for the shape'],
              ['Claim', 'Post the exact formula before anyone else'],
              ['Bet', 'Back or doubt other players’ claims'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-sm font-semibold">
                  {i + 1}
                </span>
                <div>
                  <div className="font-semibold">{title}</div>
                  <div className="text-sm text-ink-3">{body}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Join */}
        <form onSubmit={handleJoin} className="card-pop flex flex-col gap-5 sm:p-8">
          <div>
            <h2 className="text-2xl font-semibold">Join a room</h2>
            <p className="mt-1 text-ink-3">Your host will give you the room code.</p>
          </div>

          <label className="flex flex-col gap-2">
            <span className="label">Room code</span>
            <input
              className="input tabular font-semibold tracking-wider"
              placeholder="e.g. 0949f8589bfe"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="label">Your name</span>
            <input
              className="input"
              placeholder="What should others call you?"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              autoComplete="off"
            />
          </label>

          {error && <div className="alert-error" role="alert">{error}</div>}

          <button
            type="submit"
            className="btn-primary w-full py-3.5 text-base"
            disabled={joining || !roomId.trim() || !username.trim()}
          >
            {joining ? 'Joining…' : 'Join room'}
          </button>

          <p className="text-center text-xs text-ink-4">
            Rejoining? Use the same name to get your wallet back.
          </p>
        </form>
      </main>
    </div>
  )
}

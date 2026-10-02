import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()

  const [roomId, setRoomId]   = useState('')
  const [username, setUsername] = useState('')
  const [joining, setJoining]   = useState(false)
  const [error, setError]       = useState('')

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!roomId.trim() || !username.trim()) return

    setJoining(true)
    try {
      const res = await fetch(`/api/rooms/${roomId.trim()}/join`, {
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
      setError('Network error — is the server running?')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-10">
      {/* Header */}
      <div className="text-center">
        <div className="text-zinc-500 text-sm mb-2 tracking-widest uppercase">
          x &nbsp;→&nbsp; ??? BLACK BOX ??? &nbsp;→&nbsp; y
        </div>
        <h1 className="text-4xl font-bold text-zinc-100 tracking-tight">Blackbox Leaderboard</h1>
        <p className="text-zinc-400 mt-2 text-sm max-w-sm mx-auto">
          Identify the hidden function. Bet on each other's answers. Best wallet wins.
        </p>
      </div>

      {/* Join form */}
      <form onSubmit={handleJoin} className="card w-full max-w-sm flex flex-col gap-4">
        <h2 className="text-zinc-300 font-semibold text-sm uppercase tracking-wider">Join a Room</h2>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Room ID</label>
          <input
            className="input"
            placeholder="Paste the room ID here"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Username</label>
          <input
            className="input"
            placeholder="Choose a display name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={30}
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={joining || !roomId.trim() || !username.trim()}
        >
          {joining ? 'Joining…' : 'Join Room'}
        </button>
      </form>


    </div>
  )
}

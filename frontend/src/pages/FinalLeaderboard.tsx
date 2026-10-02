import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { LeaderboardEntry } from '../types'

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

export default function FinalLeaderboard() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate   = useNavigate()
  const [entries, setEntries]   = useState<LeaderboardEntry[]>([])
  const [roomName, setRoomName] = useState('')
  const [loading, setLoading]   = useState(true)

  const myPlayerId = localStorage.getItem(`playerId:${roomId}`) ?? ''

  useEffect(() => {
    if (!roomId) return

    Promise.all([
      fetch(`/api/rooms/${roomId}/leaderboard`).then((r) => r.json()),
      fetch(`/api/rooms/${roomId}`).then((r) => r.json()),
    ]).then(([lb, room]: any[]) => {
      setEntries(lb.leaderboard ?? [])
      setRoomName(room.name ?? roomId)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [roomId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        Loading leaderboard…
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto flex flex-col gap-8">
      {/* Header */}
      <div className="text-center">
        <div className="text-zinc-500 text-sm uppercase tracking-widest mb-2">Game Over</div>
        <h1 className="text-3xl font-bold text-zinc-100">{roomName}</h1>
        <p className="text-zinc-500 mt-2 text-sm">Final Leaderboard</p>
      </div>

      {/* Top 3 podium */}
      {entries.length >= 1 && (
        <div className="flex items-end justify-center gap-4">
          {[entries[1], entries[0], entries[2]].map((entry, idx) => {
            if (!entry) return <div key={idx} className="w-24" />
            const heights = ['h-20', 'h-28', 'h-16']
            const isMe = entry.playerId === myPlayerId
            return (
              <div key={entry.playerId} className="flex flex-col items-center gap-2 w-28">
                <div className="text-2xl">{MEDAL[entry.rank] ?? ''}</div>
                <div
                  className={`w-full rounded-t-lg ${heights[idx]} flex items-center justify-center
                    ${isMe ? 'bg-brand-500/30 border border-brand-500/50' : 'bg-zinc-800 border border-zinc-700'}`}
                >
                  <div className="text-center">
                    <div className={`font-bold text-sm ${isMe ? 'text-brand-400' : 'text-zinc-300'}`}>
                      {entry.username}
                    </div>
                    <div className="text-xs text-zinc-500 tabular-nums">{entry.wallet.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Full table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/80">
              <th className="px-4 py-3 text-left text-zinc-400 font-medium w-12">Rank</th>
              <th className="px-4 py-3 text-left text-zinc-400 font-medium">Player</th>
              <th className="px-4 py-3 text-right text-zinc-400 font-medium">Wallet</th>
              <th className="px-4 py-3 text-right text-zinc-400 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isMe = entry.playerId === myPlayerId
              return (
                <tr
                  key={entry.playerId}
                  className={`border-t border-zinc-800/50 ${isMe ? 'bg-brand-500/5' : ''}`}
                >
                  <td className="px-4 py-3 text-zinc-500 tabular-nums">
                    {MEDAL[entry.rank] ?? `#${entry.rank}`}
                  </td>
                  <td className={`px-4 py-3 font-medium ${isMe ? 'text-brand-400' : 'text-zinc-300'}`}>
                    {entry.username}
                    {isMe && <span className="text-zinc-500 text-xs ml-1">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300 font-bold tabular-nums">
                    {entry.wallet.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500 tabular-nums">
                    {entry.totalScore}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button onClick={() => navigate('/')} className="btn-secondary mx-auto">
        Back to Home
      </button>
    </div>
  )
}

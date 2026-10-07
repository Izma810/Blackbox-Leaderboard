import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LeaderboardEntry } from '../types'
import { getTeam } from '../lib/session'

const PODIUM = [
  { place: 2, height: 'h-28', tone: 'bg-white' },
  { place: 1, height: 'h-40', tone: 'bg-accent' },
  { place: 3, height: 'h-20', tone: 'bg-white' },
]

export default function FinalLeaderboard() {
  const navigate     = useNavigate()
  const myTeam       = getTeam()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json() as Promise<{ leaderboard: LeaderboardEntry[] }>)
      .then((d) => setEntries(d.leaderboard ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-ink-3">Loading leaderboard…</div>
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <div className="text-center">
        <div className="eyebrow mb-2">Final standings</div>
        <h1 className="text-4xl font-bold sm:text-5xl">whackamodel</h1>
      </div>

      {entries.length > 0 && (
        <div className="flex items-end justify-center gap-3 sm:gap-5">
          {PODIUM.map(({ place, height, tone }) => {
            const entry = entries[place - 1]
            if (!entry) return <div key={place} className="w-28 sm:w-36" />
            const isMe = entry.teamId === myTeam?.id
            return (
              <div key={place} className="flex w-28 flex-col items-center gap-3 animate-slide-up sm:w-36">
                <div className="text-center">
                  <div className="truncate font-display text-lg font-semibold">{isMe ? 'Your team' : entry.teamName}</div>
                  <div className="tabular text-sm text-ink-3">{entry.wallet.toLocaleString()} coins</div>
                </div>
                <div className={`flex w-full ${height} items-start justify-center rounded-t-2xl border-2 border-ink pt-3 shadow-pop ${tone}`}>
                  <span className="font-display text-3xl font-bold">{place}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="tabular w-full">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="px-5 py-3 text-left font-semibold text-ink-3">#</th>
              <th className="px-5 py-3 text-left font-semibold text-ink-3">Team</th>
              <th className="px-5 py-3 text-right font-semibold text-ink-3">Correct</th>
              <th className="px-5 py-3 text-right font-semibold text-ink-3">Wallet</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isMe = entry.teamId === myTeam?.id
              return (
                <tr key={entry.teamId} className={`border-t border-line ${isMe ? 'bg-accent-soft/60' : ''}`}>
                  <td className="px-5 py-3.5 font-semibold text-ink-3">{entry.rank}</td>
                  <td className="px-5 py-3.5 font-semibold">
                    {entry.teamName}
                    {isMe && <span className="ml-2 chip-accent">you</span>}
                  </td>
                  <td className="px-5 py-3.5 text-right text-ink-2">{entry.totalScore}</td>
                  <td className="px-5 py-3.5 text-right font-display text-lg font-semibold">
                    {entry.wallet.toLocaleString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button onClick={() => navigate('/')} className="btn-secondary mx-auto">Back to home</button>
    </div>
  )
}

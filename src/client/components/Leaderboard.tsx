import { useEffect, useRef, useState } from 'react'
import type { TeamInfo } from '../types'

export function rankTeams(teams: TeamInfo[]): TeamInfo[] {
  return [...teams].sort((a, b) =>
    b.wallet - a.wallet || b.totalScore - a.totalScore || a.name.localeCompare(b.name),
  )
}

function useRankMoves(ranked: TeamInfo[]): Record<string, number> {
  const prev  = useRef<Record<string, number>>({})
  const [moves, setMoves] = useState<Record<string, number>>({})
  const order = ranked.map((t) => t.id).join(',')

  useEffect(() => {
    const next: Record<string, number> = {}
    const changed: Record<string, number> = {}
    ranked.forEach((t, i) => {
      next[t.id] = i
      const before = prev.current[t.id]
      if (before !== undefined && before !== i) changed[t.id] = before - i
    })
    prev.current = next
    if (Object.keys(changed).length === 0) return
    setMoves(changed)
    const timer = setTimeout(() => setMoves({}), 4000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  return moves
}

interface LeaderboardProps {
  teams:      TeamInfo[]
  myTeamId:   string
  limit?:     number
  title?:     string
}

export default function Leaderboard({ teams, myTeamId, limit, title = 'Leaderboard' }: LeaderboardProps) {
  const ranked  = rankTeams(teams)
  const moves   = useRankMoves(ranked)
  const myIndex = ranked.findIndex((t) => t.id === myTeamId)

  let rows = ranked.map((t, i) => ({ team: t, rank: i + 1, gapBefore: false }))
  if (limit && ranked.length > limit) {
    rows = rows.slice(0, limit)
    if (myIndex >= limit) rows.push({ team: ranked[myIndex], rank: myIndex + 1, gapBefore: true })
  }

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div>
        <div className="eyebrow mb-1">{ranked.length} team{ranked.length === 1 ? '' : 's'}</div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>

      {ranked.length === 0 ? (
        <p className="text-sm text-ink-3">No teams have joined yet.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map(({ team: t, rank, gapBefore }) => {
            const isMe = t.id === myTeamId
            const move = moves[t.id]
            return (
              <li key={t.id}>
                {gapBefore && <div className="py-1 text-center text-ink-4">⋯</div>}
                <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                  isMe ? 'bg-accent-soft ring-2 ring-ink' : rank <= 3 ? 'bg-paper' : ''
                }`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
                    rank === 1 ? 'bg-accent text-ink' : rank <= 3 ? 'bg-ink text-white' : 'text-ink-3'
                  }`}>{rank}</span>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${t.isConnected ? 'bg-up' : 'bg-line'}`} />
                      <span className="truncate font-semibold">{t.name}</span>
                      {isMe && <span className="chip-neutral shrink-0 px-2 py-0.5">you</span>}
                      {move !== undefined && (
                        <span className={`shrink-0 text-xs font-bold ${move > 0 ? 'text-up' : 'text-down'}`}>
                          {move > 0 ? `▲${move}` : `▼${-move}`}
                        </span>
                      )}
                    </div>
                    <div className="truncate pl-4 text-xs text-ink-4">
                      {t.members.map((m) => m.name).join(' & ')}
                    </div>
                  </div>

                  {t.totalScore > 0 && (
                    <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">✓{t.totalScore}</span>
                  )}
                  <span className="tabular w-16 shrink-0 text-right font-display font-semibold">
                    {t.wallet.toLocaleString()}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export function LeaderboardDialog({ teams, myTeamId, onClose }: {
  teams: TeamInfo[]; myTeamId: string; onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh] animate-fade-in"
      onClick={onClose}>
      <div role="dialog" aria-modal aria-label="Leaderboard"
        className="w-full max-w-lg animate-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex justify-end">
          <button className="btn-secondary px-3 py-2 text-sm" onClick={onClose} autoFocus>Close</button>
        </div>
        <Leaderboard teams={teams} myTeamId={myTeamId} />
      </div>
    </div>
  )
}

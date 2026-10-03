import { useEffect, useRef, useState } from 'react'
import type { PlayerInfo, WalletDelta } from '../types'

export function rankPlayers(players: PlayerInfo[]): PlayerInfo[] {
  return [...players].sort((a, b) =>
    b.wallet - a.wallet || b.totalScore - a.totalScore || a.username.localeCompare(b.username),
  )
}

/**
 * How many places each player moved since the order last changed.
 * Arrows fade out after a few seconds.
 */
function useRankMoves(ranked: PlayerInfo[]): Record<string, number> {
  const prev = useRef<Record<string, number>>({})
  const [moves, setMoves] = useState<Record<string, number>>({})
  const order = ranked.map((p) => p.id).join(',')

  useEffect(() => {
    const next: Record<string, number> = {}
    const changed: Record<string, number> = {}
    ranked.forEach((p, i) => {
      next[p.id] = i
      const before = prev.current[p.id]
      if (before !== undefined && before !== i) changed[p.id] = before - i
    })
    prev.current = next
    if (Object.keys(changed).length === 0) return
    setMoves(changed)
    const t = setTimeout(() => setMoves({}), 4000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  return moves
}

interface LeaderboardProps {
  players: PlayerInfo[]
  myPlayerId: string
  /** Show only the top `limit` players plus the viewer's own row */
  limit?: number
  /** Round results — adds a "this round" column */
  deltas?: WalletDelta[]
  onShowAll?: () => void
  title?: string
}

export default function Leaderboard({
  players, myPlayerId, limit, deltas, onShowAll, title = 'Leaderboard',
}: LeaderboardProps) {
  const ranked = rankPlayers(players)
  const moves = useRankMoves(ranked)
  const myIndex = ranked.findIndex((p) => p.id === myPlayerId)

  let rows = ranked.map((p, i) => ({ player: p, rank: i + 1, gapBefore: false }))
  if (limit && ranked.length > limit) {
    rows = rows.slice(0, limit)
    if (myIndex >= limit) rows.push({ player: ranked[myIndex], rank: myIndex + 1, gapBefore: true })
  }
  const hidden = ranked.length - rows.length
  const deltaFor = (id: string) => deltas?.find((d) => d.playerId === id)?.delta

  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="leaderboard-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">{ranked.length} player{ranked.length === 1 ? '' : 's'}</div>
          <h2 id="leaderboard-title" className="text-lg font-semibold">{title}</h2>
        </div>
        {onShowAll && hidden > 0 && (
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onShowAll}>
            See all
          </button>
        )}
      </div>

      {ranked.length === 0 ? (
        <p className="text-sm text-ink-3">Nobody has joined yet.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map(({ player: p, rank, gapBefore }) => {
            const isMe = p.id === myPlayerId
            const move = moves[p.id]
            const delta = deltaFor(p.id)
            return (
              <li key={p.id}>
                {gapBefore && <div className="py-1 text-center text-ink-4" aria-hidden>⋯</div>}
                <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                  isMe ? 'bg-accent-soft ring-2 ring-ink' : rank <= 3 ? 'bg-paper' : ''
                }`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
                    rank === 1 ? 'bg-accent text-ink' : rank <= 3 ? 'bg-ink text-white' : 'text-ink-3'
                  }`}>
                    {rank}
                  </span>

                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${p.isConnected ? 'bg-up' : 'bg-line'}`}
                      title={p.isConnected ? 'Online' : 'Offline'}
                      aria-label={p.isConnected ? 'Online' : 'Offline'}
                    />
                    <span className="truncate font-semibold">{p.username}</span>
                    {isMe && <span className="chip-neutral shrink-0 px-2 py-0.5">you</span>}
                    {move !== undefined && (
                      <span className={`shrink-0 text-xs font-bold animate-fade-in ${move > 0 ? 'text-up' : 'text-down'}`}>
                        {move > 0 ? `▲${move}` : `▼${-move}`}
                      </span>
                    )}
                  </div>

                  {p.totalScore > 0 && (
                    <span className="hidden shrink-0 text-xs text-ink-3 sm:inline" title="Correct formulas posted">
                      ✓{p.totalScore}
                    </span>
                  )}
                  {delta !== undefined && (
                    <span className={`tabular w-14 shrink-0 text-right text-sm font-semibold ${delta >= 0 ? 'text-up' : 'text-down'}`}>
                      {delta >= 0 ? '+' : '−'}{Math.abs(delta)}
                    </span>
                  )}
                  <span className="tabular w-16 shrink-0 text-right font-display font-semibold">
                    {p.wallet.toLocaleString()}
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

export function LeaderboardDialog({
  players, myPlayerId, onClose,
}: { players: PlayerInfo[]; myPlayerId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh] animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Leaderboard"
        className="w-full max-w-lg animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button className="btn-secondary px-3 py-2 text-sm" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <Leaderboard players={players} myPlayerId={myPlayerId} />
        <p className="mt-3 text-center text-sm text-white/90">
          Wallets drop while stakes are in play and settle when the round ends.
        </p>
      </div>
    </div>
  )
}

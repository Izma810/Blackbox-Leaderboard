import { useEffect, useMemo, useState } from 'react'
import type { PlayerInfo, RoundSummary } from '../types'
import { rankPlayers } from './Leaderboard'
import { prefersReducedMotion } from './RoundIntro'

interface StandingsRevealProps {
  round: number
  /** Players after settlement (wallets already updated) */
  players: PlayerInfo[]
  /** This round's settlement — used to rebuild the pre-round standings */
  summary: RoundSummary
  myPlayerId: string
  onClose: () => void
}

/**
 * Kahoot-style standings after a round:
 *   0      rows in the pre-round order with pre-round wallets
 *   0.7 s  +/− badges stamp in, wallets count to their new values, bars resize
 *   2.2 s  rows slide into their new positions
 *   3.1 s  ▲/▼ movement arrows appear
 */
const STEP_AT = { count: 700, reorder: 2200, arrows: 3100 } as const
const AUTO_CLOSE_AT = 9000
const ROW_H = 68       // px, row height + gap
const MAX_ROWS = 8

type Step = 'before' | 'count' | 'reorder' | 'arrows'

function useCountUp(from: number, to: number, run: boolean, ms = 1300): number {
  const [value, setValue] = useState(from)
  useEffect(() => {
    if (!run) { setValue(from); return }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - (1 - t) ** 3
      setValue(Math.round(from + (to - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [from, to, run, ms])
  return value
}

export default function StandingsReveal({ round, players, summary, myPlayerId, onClose }: StandingsRevealProps) {
  const reduced = prefersReducedMotion()
  const [step, setStep] = useState<Step>(reduced ? 'arrows' : 'before')

  const { rows, maxWallet } = useMemo(() => {
    const delta = new Map(summary.deltas.map((d) => [d.playerId, d.delta]))
    // Correct claims also break ties, so undo this round's ones too
    const rightThisRound = (id: string) =>
      summary.results.filter((r) => r.playerId === id && r.verdict === 'right').length
    const after = rankPlayers(players)
    const before = rankPlayers(players.map((p) => ({
      ...p,
      wallet: p.wallet - (delta.get(p.id) ?? 0),
      totalScore: p.totalScore - rightThisRound(p.id),
    })))
    const oldRank = new Map(before.map((p, i) => [p.id, i]))
    const newRank = new Map(after.map((p, i) => [p.id, i]))

    // Everyone in the top MAX_ROWS before or after, plus the viewer
    const shown = after.filter((p) =>
      newRank.get(p.id)! < MAX_ROWS || oldRank.get(p.id)! < MAX_ROWS || p.id === myPlayerId,
    )
    const shownBefore = [...shown].sort((a, b) => oldRank.get(a.id)! - oldRank.get(b.id)!)

    return {
      rows: shown.map((p) => ({
        player: p,
        delta: delta.get(p.id) ?? 0,
        oldWallet: p.wallet - (delta.get(p.id) ?? 0),
        oldRank: oldRank.get(p.id)!,
        newRank: newRank.get(p.id)!,
        oldSlot: shownBefore.findIndex((q) => q.id === p.id),
        newSlot: shown.findIndex((q) => q.id === p.id),
      })),
      maxWallet: Math.max(1, ...players.map((p) => Math.max(p.wallet, p.wallet - (delta.get(p.id) ?? 0)))),
    }
  }, [players, summary, myPlayerId])

  useEffect(() => {
    if (reduced) return
    const timers = [
      setTimeout(() => setStep('count'), STEP_AT.count),
      setTimeout(() => setStep('reorder'), STEP_AT.reorder),
      setTimeout(() => setStep('arrows'), STEP_AT.arrows),
    ]
    return () => timers.forEach(clearTimeout)
  }, [reduced])

  useEffect(() => {
    const t = setTimeout(onClose, AUTO_CLOSE_AT)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const counting = step !== 'before'
  const reordered = step === 'reorder' || step === 'arrows'
  const leader = rows.find((r) => r.newRank === 0)

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-ink px-4 py-10 text-white animate-fade-in">
      <div className="flex w-full max-w-2xl flex-col items-center gap-2 text-center">
        <div className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-white/60 animate-rise">
          After round {round}
        </div>
        <h1 className="font-display text-4xl font-bold sm:text-5xl animate-stamp">Standings</h1>
        <p className={`h-6 text-white/70 transition-opacity duration-500 ${step === 'arrows' && leader ? 'opacity-100' : 'opacity-0'}`}>
          {leader && (leader.player.id === myPlayerId ? 'You’re in the lead!' : `${leader.player.username} leads the pack`)}
        </p>
      </div>

      <ol
        className="relative mt-6 w-full max-w-2xl"
        style={{ height: rows.length * ROW_H }}
        aria-label="Standings after this round"
      >
        {rows.map((r) => (
          <Row
            key={r.player.id}
            row={r}
            slot={reordered ? r.newSlot : r.oldSlot}
            counting={counting}
            showArrow={step === 'arrows'}
            isMe={r.player.id === myPlayerId}
            maxWallet={maxWallet}
            reduced={reduced}
          />
        ))}
      </ol>

      <button className="btn-primary mt-8 px-8 py-3 text-base" onClick={onClose} autoFocus>
        See round details
      </button>
    </div>
  )
}

interface RowProps {
  row: {
    player: PlayerInfo; delta: number; oldWallet: number
    oldRank: number; newRank: number
  }
  slot: number
  counting: boolean
  showArrow: boolean
  isMe: boolean
  maxWallet: number
  reduced: boolean
}

function Row({ row, slot, counting, showArrow, isMe, maxWallet, reduced }: RowProps) {
  const { player, delta, oldWallet, oldRank, newRank } = row
  const wallet = useCountUp(oldWallet, player.wallet, counting && !reduced)
  const shownWallet = reduced ? player.wallet : wallet
  const moved = oldRank - newRank
  const rank = showArrow ? newRank : oldRank
  const barPct = Math.max(4, (Math.max(0, shownWallet) / maxWallet) * 100)

  return (
    <li
      className="absolute inset-x-0 transition-transform duration-700 ease-[cubic-bezier(0.5,1.35,0.4,1)]"
      // Climbers slide over the rows they overtake
      style={{ transform: `translateY(${slot * ROW_H}px)`, zIndex: moved > 0 ? 2 : 1 }}
    >
      <div className={`relative flex h-14 items-center gap-3 overflow-hidden rounded-2xl border-2 px-3 ${
        isMe ? 'border-accent bg-white text-ink' : 'border-white/10 bg-white/[0.08]'
      }`}>
        {/* Wallet bar along the bottom edge, relative to the richest player */}
        <div
          className={`absolute bottom-0 left-0 h-1 transition-[width] duration-1000 ease-out ${
            isMe ? 'bg-accent' : rank === 0 ? 'bg-accent/80' : 'bg-white/35'
          }`}
          style={{ width: `${barPct}%` }}
          aria-hidden
        />

        <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display font-bold ${
          rank === 0 ? 'bg-accent text-ink' : isMe ? 'bg-ink text-white' : 'bg-white/10'
        }`}>
          {rank + 1}
        </span>

        <span className="relative min-w-0 flex-1 truncate font-display text-lg font-semibold">
          {player.username}{isMe && <span className="ml-2 text-sm font-medium opacity-60">you</span>}
        </span>

        {showArrow && moved !== 0 && (
          <span className={`relative shrink-0 text-sm font-bold animate-stamp ${moved > 0 ? 'text-up' : 'text-down'}`}>
            <span className={moved > 0 ? 'inline-block animate-nudge-up' : ''}>
              {moved > 0 ? `▲ ${moved}` : `▼ ${-moved}`}
            </span>
          </span>
        )}

        {counting && delta !== 0 && (
          <span className={`relative shrink-0 rounded-lg px-2 py-0.5 text-sm font-bold animate-stamp ${
            delta > 0 ? 'bg-up text-white' : 'bg-down text-white'
          }`}>
            {delta > 0 ? '+' : '−'}{Math.abs(delta)}
          </span>
        )}

        <span className="tabular relative w-20 shrink-0 text-right font-display text-xl font-bold">
          {shownWallet.toLocaleString()}
        </span>
      </div>
    </li>
  )
}

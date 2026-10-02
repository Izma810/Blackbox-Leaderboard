import { useState, useEffect } from 'react'

interface TimerProps {
  endsAt: number | null
  /** Full round length — used for the progress bar */
  totalSecs?: number
}

export function useRemaining(endsAt: number | null): number {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!endsAt) { setRemaining(0); return }
    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [endsAt])

  return remaining
}

export default function Timer({ endsAt }: TimerProps) {
  const remaining = useRemaining(endsAt)
  if (!endsAt) return null

  const totalSecs = Math.ceil(remaining / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  const tone = totalSecs <= 10 ? 'bg-down text-white animate-pulse'
    : totalSecs <= 30 ? 'bg-accent text-ink'
    : 'bg-ink text-white'

  return (
    <div
      className={`tabular inline-flex items-center gap-2 rounded-xl px-3 py-1.5 font-display text-lg font-semibold transition-colors ${tone}`}
      aria-label={`${mins} minutes ${secs} seconds left`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2.5M9 2h6" strokeLinecap="round" />
      </svg>
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </div>
  )
}

/** Thin bar that drains as the round runs out */
export function TimeBar({ endsAt, totalSecs }: TimerProps) {
  const remaining = useRemaining(endsAt)
  if (!endsAt || !totalSecs) return null
  const pct = Math.max(0, Math.min(100, (remaining / (totalSecs * 1000)) * 100))
  const color = remaining <= 10_000 ? 'bg-down' : remaining <= 30_000 ? 'bg-accent' : 'bg-ink'

  return (
    <div className="h-1 w-full bg-line" aria-hidden>
      <div className={`h-full transition-[width] duration-300 ease-linear ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

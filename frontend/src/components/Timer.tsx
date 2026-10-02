import { useState, useEffect } from 'react'

interface TimerProps {
  endsAt: number | null
  className?: string
}

export default function Timer({ endsAt, className = '' }: TimerProps) {
  const [remaining, setRemaining] = useState<number>(0)

  useEffect(() => {
    if (!endsAt) { setRemaining(0); return }

    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [endsAt])

  if (!endsAt) return null

  const totalSecs = Math.ceil(remaining / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  const isLow = totalSecs <= 30
  const isUrgent = totalSecs <= 10

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`
          text-2xl font-bold tabular-nums transition-colors
          ${isUrgent ? 'text-red-400 animate-pulse' : isLow ? 'text-yellow-400' : 'text-zinc-300'}
        `}
      >
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      {isLow && (
        <span className={`text-xs ${isUrgent ? 'text-red-500' : 'text-yellow-500'}`}>
          {isUrgent ? 'time is up!' : 'hurry up'}
        </span>
      )}
    </div>
  )
}

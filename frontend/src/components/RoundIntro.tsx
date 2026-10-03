import { useEffect, useState } from 'react'

interface RoundIntroProps {
  round: number
  title: string
  onDone: () => void
}

// Timeline (ms). The whole intro stays under 3 s.
const COUNT_AT = [1000, 1500, 2000]   // when "3", "2", "1" appear
const FADE_AT = 2500
const DONE_AT = 2900

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Full-screen "Round N → 3 · 2 · 1" shown to everyone when a round starts. */
export default function RoundIntro({ round, title, onDone }: RoundIntroProps) {
  const [count, setCount] = useState<number | null>(null)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) {
      const t = setTimeout(onDone, 900)
      return () => clearTimeout(t)
    }
    const timers = [
      ...COUNT_AT.map((at, i) => setTimeout(() => setCount(3 - i), at)),
      setTimeout(() => setFading(true), FADE_AT),
      setTimeout(onDone, DONE_AT),
    ]
    return () => timers.forEach(clearTimeout)
  // onDone is stable for the life of the intro
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-ink text-white transition-opacity duration-300 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-live="assertive"
      onClick={onDone}
    >
      <div className="relative flex w-full flex-col items-center gap-5 text-center">
        <div className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-white/70 animate-rise">
          Round {round}
        </div>
        <div className="relative w-full py-6">
          {/* Full-width tilted band behind the puzzle title */}
          <div className="absolute inset-0 -skew-y-3 bg-accent animate-rise" aria-hidden />
          <h1
            className="relative mx-auto max-w-3xl px-6 font-display text-4xl font-bold leading-tight text-ink sm:text-6xl animate-stamp"
            style={{ animationDelay: '150ms' }}
          >
            {title}
          </h1>
        </div>
      </div>

      <div className="relative mt-10 flex h-28 items-center justify-center" aria-hidden>
        {count !== null && (
          <span
            key={count}
            className="font-display text-8xl font-bold text-accent animate-count-pop sm:text-9xl"
          >
            {count}
          </span>
        )}
      </div>

      <span className="sr-only">Round {round} is starting: {title}</span>
    </div>
  )
}

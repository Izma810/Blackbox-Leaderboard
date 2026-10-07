import { useState } from 'react'
import { authFetch } from '../lib/session'

interface HintPanelProps {
  puzzleId:   string
  hints:      string[]
  hintCount:  number
  cost:       number
  wallet:     number
  disabled:   boolean
  onBought:   (hints: string[]) => void
}

export default function HintPanel({ puzzleId, hints, hintCount, cost, wallet, disabled, onBought }: HintPanelProps) {
  const [buying, setBuying] = useState(false)
  const [error,  setError]  = useState('')
  if (hintCount === 0) return null

  const remaining = hintCount - hints.length

  async function buy() {
    setError('')
    setBuying(true)
    try {
      const res = await authFetch('/api/hint', {
        method: 'POST',
        body: JSON.stringify({ puzzleId }),
      })
      const data = await res.json() as { ok?: boolean; hints?: string[]; error?: string }
      if (!res.ok || !data.hints) { setError(data.error ?? 'Could not buy a hint'); return }
      onBought(data.hints)
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBuying(false)
    }
  }

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Stuck?</div>
          <h2 className="text-lg font-semibold">Hints</h2>
        </div>
        {remaining > 0 && !disabled && (
          <button className="btn-secondary py-2 text-sm" onClick={buy}
            disabled={buying || wallet < cost}>
            {buying ? 'Buying…' : `Buy hint ${hints.length + 1} · ${cost}`}
          </button>
        )}
      </div>

      {hints.length === 0 ? (
        <p className="text-sm text-ink-3">
          {hintCount} hint{hintCount === 1 ? '' : 's'} available. Only your team sees the hints you buy.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {hints.map((h, i) => (
            <li key={i} className="flex gap-3 rounded-xl bg-accent-soft/60 px-4 py-3 animate-slide-up">
              <span className="font-display font-semibold text-accent-dark">{i + 1}</span>
              <span className="text-ink-2">{h}</span>
            </li>
          ))}
        </ol>
      )}
      {remaining > 0 && hints.length > 0 && !disabled && (
        <p className="text-xs text-ink-4">{remaining} more hint{remaining === 1 ? '' : 's'} available.</p>
      )}
      {error && <div className="alert-error" role="alert">{error}</div>}
    </section>
  )
}

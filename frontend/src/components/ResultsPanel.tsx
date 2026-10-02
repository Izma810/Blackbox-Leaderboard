import type { RoundSummary } from '../types'
import { Formula } from '../lib/formula'

const VERDICT = {
  right: { label: '✓ Right', className: 'chip-up' },
  close: { label: '≈ Close', className: 'chip-accent' },
  wrong: { label: '✗ Wrong', className: 'chip-down' },
} as const

interface ResultsPanelProps {
  summary: RoundSummary
  myPlayerId: string
}

export default function ResultsPanel({ summary, myPlayerId }: ResultsPanelProps) {
  const { results, deltas, solution } = summary
  const myDelta = deltas.find((d) => d.playerId === myPlayerId)
  const winners = results.filter((r) => r.verdict === 'right')

  return (
    <div className="flex flex-col gap-6">
      {/* Reveal */}
      <section className="card-pop text-center animate-pop-in">
        <div className="eyebrow mb-3">The black box was</div>
        <div className="font-display text-3xl font-semibold leading-snug sm:text-4xl">
          <Formula expr={solution} />
        </div>
        <p className="mt-3 text-ink-3">
          {winners.length === 0
            ? 'Nobody cracked it this round.'
            : `Cracked by ${winners.map((w) => (w.playerId === myPlayerId ? 'you' : w.label)).join(', ')}.`}
        </p>
      </section>

      {/* My result */}
      {myDelta && (
        <section className={`rounded-2xl border-2 p-6 text-center ${
          myDelta.delta >= 0 ? 'border-up bg-up-soft' : 'border-down bg-down-soft'
        }`}>
          <div className="eyebrow mb-1">Your round</div>
          <div className={`tabular font-display text-5xl font-bold ${myDelta.delta >= 0 ? 'text-up' : 'text-down'}`}>
            {myDelta.delta >= 0 ? '+' : '−'}{Math.abs(myDelta.delta).toLocaleString()}
          </div>
          <div className="mt-1 text-ink-2">
            Wallet now <span className="tabular font-semibold">{myDelta.newBalance.toLocaleString()}</span> coins
          </div>
        </section>
      )}

      {/* Every claim */}
      {results.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="eyebrow">Every claim</div>
          {results.map((r) => {
            const isOwn = r.playerId === myPlayerId
            return (
              <div
                key={r.submissionId}
                className={`flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-5 shadow-soft ${
                  isOwn ? 'border-2 border-ink' : 'border-line'
                }`}
              >
                <span className={VERDICT[r.verdict].className}>{VERDICT[r.verdict].label}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg font-medium break-words">
                    <Formula expr={r.expr} />
                  </div>
                  <div className="mt-0.5 text-sm text-ink-3">
                    {isOwn ? 'You' : r.label} · {(r.accuracy * 100).toFixed(1)}% match · ▲{r.ups} ▼{r.downs}
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* Wallet changes */}
      {deltas.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="eyebrow">Money moved</div>
          <div className="card overflow-hidden p-0">
            <table className="tabular w-full text-sm">
              <tbody>
                {[...deltas].sort((a, b) => b.delta - a.delta).map((d) => {
                  const isMe = d.playerId === myPlayerId
                  return (
                    <tr key={d.playerId} className={`border-t border-line first:border-t-0 ${isMe ? 'bg-accent-soft/50' : ''}`}>
                      <td className="px-5 py-3 font-semibold">{isMe ? `${d.username} (you)` : d.username}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${d.delta >= 0 ? 'text-up' : 'text-down'}`}>
                        {d.delta >= 0 ? '+' : '−'}{Math.abs(d.delta)}
                      </td>
                      <td className="px-5 py-3 text-right text-ink-3">{d.newBalance.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

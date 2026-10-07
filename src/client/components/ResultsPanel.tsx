import type { BatchSummary, Verdict } from '../types'
import { Formula } from '../lib/formula'

const VERDICT: Record<Verdict, { label: string; className: string }> = {
  right: { label: '✓ Right',  className: 'chip-up' },
  close: { label: '≈ Close',  className: 'chip-accent' },
  wrong: { label: '✗ Wrong',  className: 'chip-down' },
}

interface ResultsPanelProps {
  summary:    BatchSummary
  myTeamId:   string
  solutions:  Record<string, string>   // puzzleId → solution
}

export default function ResultsPanel({ summary, myTeamId, solutions }: ResultsPanelProps) {
  const myDelta = summary.deltas.find((d) => d.teamId === myTeamId)

  return (
    <div className="flex flex-col gap-6">
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

      {Object.entries(summary.results).map(([puzzleId, results]) => (
        <section key={puzzleId} className="flex flex-col gap-3">
          {solutions[puzzleId] && (
            <div className="card-pop text-center animate-pop-in">
              <div className="eyebrow mb-2">Solution</div>
              <div className="font-display text-2xl font-semibold">
                <Formula expr={solutions[puzzleId]} />
              </div>
            </div>
          )}
          {results.map((r) => {
            const isOwn = r.teamId === myTeamId
            return (
              <div key={r.submissionId} className={`flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-5 shadow-soft ${
                isOwn ? 'border-2 border-ink' : 'border-line'
              }`}>
                <span className={VERDICT[r.verdict].className}>{VERDICT[r.verdict].label}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg font-medium break-words">
                    <Formula expr={r.expr} />
                  </div>
                  <div className="mt-0.5 text-sm text-ink-3">
                    {isOwn ? 'Your team' : r.label} · {(r.accuracy * 100).toFixed(1)}% match · ▲{r.ups} ▼{r.downs}
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      ))}

      {summary.deltas.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="eyebrow">Money moved</div>
          <div className="card overflow-hidden p-0">
            <table className="tabular w-full text-sm">
              <tbody>
                {[...summary.deltas].sort((a, b) => b.delta - a.delta).map((d) => {
                  const isMe = d.teamId === myTeamId
                  return (
                    <tr key={d.teamId} className={`border-t border-line first:border-t-0 ${isMe ? 'bg-accent-soft/50' : ''}`}>
                      <td className="px-5 py-3 font-semibold">{isMe ? `${d.teamName} (you)` : d.teamName}</td>
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

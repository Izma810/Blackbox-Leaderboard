import type { RoundResult, WalletDelta, Feature } from '../types'

interface ResultsPanelProps {
  results: RoundResult[]
  deltas: WalletDelta[]
  myPlayerId: string
}

function featureToString(f: Feature): string {
  if (typeof f === 'string') return f
  return `${f.binary}(${f.a}, ${f.b})`
}

function r2Bar(r2: number) {
  const pct = Math.round(r2 * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${r2 >= 0.92 ? 'bg-brand-500' : r2 >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-zinc-400 w-10 text-right">{r2.toFixed(3)}</span>
    </div>
  )
}

export default function ResultsPanel({ results, deltas, myPlayerId }: ResultsPanelProps) {
  const myDelta = deltas.find((d) => d.playerId === myPlayerId)

  return (
    <div className="flex flex-col gap-6">
      {/* My wallet change summary */}
      {myDelta && (
        <div className={`
          rounded-xl border p-4 text-center
          ${myDelta.delta >= 0
            ? 'bg-brand-500/10 border-brand-500/30'
            : 'bg-red-500/10 border-red-500/30'}
        `}>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Your round result</div>
          <div className={`text-3xl font-bold ${myDelta.delta >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
            {myDelta.delta >= 0 ? '+' : ''}{myDelta.delta} coins
          </div>
          <div className="text-zinc-500 text-sm mt-1">
            Balance: {myDelta.newBalance.toLocaleString()} coins
          </div>
        </div>
      )}

      {/* Submission results */}
      <div className="flex flex-col gap-3">
        <div className="text-xs text-zinc-500 uppercase tracking-wider">Submission Scores</div>
        {results.map((r) => {
          const isOwn = r.playerId === myPlayerId
          return (
            <div
              key={r.submissionId}
              className={`card ${isOwn ? 'border-brand-500/30 bg-brand-500/5' : ''}`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <span className={`font-medium ${isOwn ? 'text-brand-400' : 'text-zinc-300'}`}>
                    {r.label}
                    {isOwn && <span className="text-zinc-500 text-xs ml-1.5">(you)</span>}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {r.features.map((f, i) => (
                      <code key={i} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300">
                        {featureToString(f)}
                      </code>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`badge text-sm font-bold px-3 ${r.isCorrect ? 'badge-green' : 'badge-red'}`}>
                    {r.isCorrect ? 'CORRECT' : 'WRONG'}
                  </span>
                  <span className="text-zinc-400 text-xs">+{r.baseScore} score pts</span>
                </div>
              </div>
              {r2Bar(r.r2Score)}
            </div>
          )
        })}
      </div>

      {/* Wallet deltas table */}
      {deltas.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">Wallet Changes</div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-800/80">
                  <th className="px-4 py-2 text-left text-zinc-400 font-medium">Player</th>
                  <th className="px-4 py-2 text-right text-zinc-400 font-medium">Change</th>
                  <th className="px-4 py-2 text-right text-zinc-400 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {deltas
                  .sort((a, b) => b.delta - a.delta)
                  .map((d) => (
                    <tr
                      key={d.playerId}
                      className={`border-t border-zinc-800/50 ${d.playerId === myPlayerId ? 'bg-brand-500/5' : ''}`}
                    >
                      <td className={`px-4 py-2 ${d.playerId === myPlayerId ? 'text-brand-400 font-medium' : 'text-zinc-300'}`}>
                        {d.username}
                      </td>
                      <td className={`px-4 py-2 text-right font-bold tabular-nums ${d.delta >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
                        {d.delta >= 0 ? '+' : ''}{d.delta}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400 tabular-nums">
                        {d.newBalance.toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

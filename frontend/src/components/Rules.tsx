import { useEffect } from 'react'
import type { RoomConfig } from '../types'

export function RulesContent({ config }: { config: RoomConfig }) {
  const { postStake: Ps, postPayout: Pp, voteStake: Vs, backPayout: Bp, hintCost } = config
  const half = (n: number) => Math.round(n / 2)

  return (
    <div className="flex flex-col gap-6">
      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          ['Crack it', `Study the plot and the raw data, then type the exact formula, numbers included. Stuck? Hints cost ${hintCost} coins each.`],
          ['Claim it', `Post your formula for ${Ps} coins. Once a formula is claimed, nobody else can post it or anything almost the same.`],
          ['Bet on it', `Use your ${config.votesPerRound} votes (${Vs} coins each) to back formulas you trust and doubt the ones you don't. Backing a right formula pays more than posting it.`],
        ].map(([title, body], i) => (
          <li key={title} className="rounded-xl bg-paper p-4">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink font-display text-sm font-semibold text-white">
              {i + 1}
            </div>
            <div className="font-semibold">{title}</div>
            <p className="mt-1 text-sm text-ink-2">{body}</p>
          </li>
        ))}
      </ol>

      <div>
        <div className="eyebrow mb-3">How money moves when the round ends</div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-paper">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-ink-3">You…</th>
                <th className="px-4 py-2.5 text-left font-semibold text-up">Right</th>
                <th className="px-4 py-2.5 text-left font-semibold text-accent-dark">Close</th>
                <th className="px-4 py-2.5 text-left font-semibold text-down">Wrong</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="px-4 py-3 font-semibold">posted it</td>
                <td className="px-4 py-3 text-up">+{Pp}, plus {Vs} from every doubter</td>
                <td className="px-4 py-3 text-accent-dark">+{half(Pp)}</td>
                <td className="px-4 py-3 text-down">−{Ps}, and you pay every doubter {Vs}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-4 py-3 font-semibold">backed it ▲</td>
                <td className="px-4 py-3 text-up">+{Bp}</td>
                <td className="px-4 py-3 text-accent-dark">+{half(Bp)}</td>
                <td className="px-4 py-3 text-down">−{Vs}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-4 py-3 font-semibold">doubted it ▼</td>
                <td className="px-4 py-3 text-down">−{Vs}, paid to the poster</td>
                <td className="px-4 py-3 text-ink-3">refunded</td>
                <td className="px-4 py-3 text-up">+{Vs}, paid by the poster</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-3">
          <li><span className="font-semibold text-ink-2">Right</span>: matches the data within 2%.</li>
          <li><span className="font-semibold text-ink-2">Close</span>: the right functions with the wrong numbers, e.g. 3x² + 1 when the answer is 2x².</li>
          <li>Stakes leave your wallet the moment you post or vote and are settled when the timer hits zero. The richest wallet at the end wins.</li>
        </ul>
      </div>
    </div>
  )
}

export function RulesDialog({ config, onClose }: { config: RoomConfig; onClose: () => void }) {
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
        aria-labelledby="rules-title"
        className="card-pop w-full max-w-3xl animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id="rules-title" className="text-2xl font-semibold">How to play</h2>
          <button className="btn-ghost px-3 py-2" onClick={onClose} aria-label="Close rules" autoFocus>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <RulesContent config={config} />
      </div>
    </div>
  )
}

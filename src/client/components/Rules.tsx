import type { GameConfig } from '../types'

export function RulesContent({ config }: { config: GameConfig }) {
  return (
    <div className="flex flex-col gap-4 text-sm text-ink-2">
      <p>
        Each puzzle has a hidden function <em>y = f(x)</em>. Your team posts one formula per puzzle.
        Posting costs <strong>{config.postStake} coins</strong> upfront.
      </p>
      <p>
        You also have a vote budget of <strong>{config.voteBudget} votes</strong> for the whole game.
        Each vote costs <strong>{config.voteStake} coins</strong>. Back (▲) formulas you think are right,
        doubt (▼) ones you think are wrong.
      </p>
      <p>When a batch is settled, the correct answer is revealed and stakes are paid out:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Right formula</strong> — poster gets stake back + {config.postPayout} coins; backers get stake back + {config.backPayout} coins; doubters' stakes go to the poster.</li>
        <li><strong>Close formula</strong> (right shape, wrong numbers) — half payouts for poster and backers; doubters get their stake back.</li>
        <li><strong>Wrong formula</strong> — poster loses stake and pays {config.voteStake} per doubter; doubters get 2× stake back.</li>
      </ul>
      <p>Puzzles are grouped into three difficulty batches. The admin opens and closes each batch independently.</p>
    </div>
  )
}

export function RulesDialog({ config, onClose }: { config: GameConfig; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh]"
      onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">How it works</h2>
          <button className="btn-ghost px-3 py-2 text-sm" onClick={onClose}>Close</button>
        </div>
        <RulesContent config={config} />
      </div>
    </div>
  )
}

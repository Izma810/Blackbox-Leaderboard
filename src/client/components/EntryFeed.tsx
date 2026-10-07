import { useEffect, useRef, useState } from 'react'
import type { PublicSubmission, VoteType, Verdict } from '../types'
import { Formula } from '../lib/formula'
import { authFetch } from '../lib/session'

interface EntryFeedProps {
  submissions:  PublicSubmission[]
  myTeamId:     string
  myVotes:      Record<string, VoteType>
  voteBudget:   number
  votesUsed:    number
  voteStake:    number
  wallet:       number
  votingOpen:   boolean
  puzzleId:     string
  highlightId:  string | null
  settled:      boolean
  onVoted:      (submissionId: string, vote: VoteType) => void
}

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

const VERDICT_STYLE: Record<Verdict, { chip: string; label: string }> = {
  right: { chip: 'chip-up',     label: '✓ Right' },
  close: { chip: 'chip-accent', label: '≈ Close' },
  wrong: { chip: 'chip-down',   label: '✗ Wrong' },
}

export default function EntryFeed({
  submissions, myTeamId, myVotes, voteBudget, votesUsed, voteStake,
  wallet, votingOpen, puzzleId, highlightId, settled, onVoted,
}: EntryFeedProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [error,   setError]   = useState('')
  const now  = useNow()
  const refs = useRef(new Map<string, HTMLLIElement>())

  const votesLeft = voteBudget - votesUsed
  const ordered   = [...submissions].sort((a, b) => b.submittedAt - a.submittedAt)

  useEffect(() => {
    if (highlightId) refs.current.get(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId])

  async function castVote(submissionId: string, voteType: VoteType) {
    setError('')
    setPending(submissionId)
    try {
      const res = await authFetch('/api/vote', {
        method: 'POST',
        body: JSON.stringify({ submissionId, voteType }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setError(data.error ?? 'Vote failed'); return }
      onVoted(submissionId, voteType)
    } catch {
      setError('Network error. Try again.')
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1.5">Claims</div>
          <h2 className="text-xl font-semibold">
            {submissions.length === 0 ? 'No claims yet' : `${submissions.length} formula${submissions.length === 1 ? '' : 's'}`}
          </h2>
        </div>
        {!settled && (
          <div className="text-right">
            <div className="text-xs text-ink-3">Vote budget</div>
            <div className="tabular text-sm font-semibold">{votesLeft} / {voteBudget} left</div>
          </div>
        )}
      </div>

      {!settled && votingOpen && (
        <p className="text-sm text-ink-3">
          Each vote stakes <span className="font-semibold text-ink">{voteStake} coins</span>.
          Back (▲) formulas you think are right and doubt (▼) the ones you think are wrong.
        </p>
      )}

      {error && <div className="alert-error" role="alert">{error}</div>}

      {submissions.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center">
          <div className="font-display text-lg font-semibold">No claims yet</div>
          <p className="mt-1 text-sm text-ink-3">Be the first to post a formula for this puzzle.</p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {ordered.map((sub) => {
          const isOwn   = sub.teamId === myTeamId
          const myVote  = myVotes[sub.id]
          const total   = sub.ups + sub.downs
          const upPct   = total ? (sub.ups / total) * 100 : 50
          const canVote = votingOpen && !isOwn && !myVote && votesLeft > 0 && wallet >= voteStake && !pending

          return (
            <li
              key={sub.id}
              ref={(el) => { if (el) refs.current.set(sub.id, el); else refs.current.delete(sub.id) }}
              className={`rounded-2xl border bg-white p-5 shadow-soft animate-slide-up ${
                isOwn ? 'border-2 border-ink' : 'border-line'
              } ${highlightId === sub.id ? 'animate-flash' : ''}`}
            >
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold ${
                    isOwn ? 'bg-accent text-ink' : 'bg-ink/5 text-ink-2'
                  }`}>
                    {sub.label.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate font-semibold">{isOwn ? 'Your team' : sub.label}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {sub.verdict && (
                    <span className={VERDICT_STYLE[sub.verdict].chip}>
                      {VERDICT_STYLE[sub.verdict].label}
                      {sub.accuracy !== undefined && ` · ${(sub.accuracy * 100).toFixed(1)}%`}
                    </span>
                  )}
                  <span className="text-ink-4">{timeAgo(sub.submittedAt, now)}</span>
                </div>
              </div>

              <div className="mb-4 font-display text-xl font-medium leading-snug break-words">
                <Formula expr={sub.expr} />
              </div>

              {/* Vote bar */}
              <div className="mb-4 flex items-center gap-3">
                <span className="tabular w-8 text-sm font-semibold text-up">▲{sub.ups}</span>
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-line">
                  {total > 0 && (
                    <>
                      <div className="h-full bg-up transition-all" style={{ width: `${upPct}%` }} />
                      <div className="h-full bg-down transition-all" style={{ width: `${100 - upPct}%` }} />
                    </>
                  )}
                </div>
                <span className="tabular w-8 text-right text-sm font-semibold text-down">▼{sub.downs}</span>
              </div>

              {/* Vote actions */}
              {isOwn ? (
                <div className="text-sm text-ink-3">Your team's claim.</div>
              ) : myVote ? (
                <div className={myVote === 'up' ? 'chip-up' : 'chip-down'}>
                  {myVote === 'up' ? '▲ You backed this' : '▼ You doubted this'} · {voteStake} staked
                </div>
              ) : votingOpen ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => castVote(sub.id, 'up')} disabled={!canVote}
                    className="btn border-up bg-up-soft py-2.5 text-up hover:bg-up hover:text-white">
                    ▲ Back it
                  </button>
                  <button onClick={() => castVote(sub.id, 'down')} disabled={!canVote}
                    className="btn border-down bg-down-soft py-2.5 text-down hover:bg-down hover:text-white">
                    ▼ Doubt it
                  </button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

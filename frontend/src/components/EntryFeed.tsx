import { useEffect, useRef, useState } from 'react'
import type { PublicSubmission, VoteCount, VoteType } from '../types'
import { Formula } from '../lib/formula'

interface EntryFeedProps {
  submissions: PublicSubmission[]
  voteCounts: VoteCount[]
  myVotes: Record<string, VoteType>
  myPlayerId: string
  roomId: string
  votesPerRound: number
  stake: number
  wallet: number
  /** Submission to scroll to and flash (e.g. after a duplicate rejection) */
  highlightId: string | null
  onVoted: (submissionId: string, vote: VoteType) => void
}

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export default function EntryFeed({
  submissions, voteCounts, myVotes, myPlayerId, roomId,
  votesPerRound, stake, wallet, highlightId, onVoted,
}: EntryFeedProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const now = useNow()
  const itemRefs = useRef(new Map<string, HTMLLIElement>())

  const votesLeft = votesPerRound - Object.keys(myVotes).length
  const ordered = [...submissions].sort((a, b) => b.submittedAt - a.submittedAt)
  const claimOrder = new Map(
    [...submissions].sort((a, b) => a.submittedAt - b.submittedAt).map((s, i) => [s.id, i + 1]),
  )

  useEffect(() => {
    if (highlightId) itemRefs.current.get(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId])

  async function castVote(submissionId: string, voteType: VoteType) {
    setError('')
    setPending(submissionId)
    try {
      const res = await fetch(`/api/rooms/${roomId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: myPlayerId, submissionId, voteType }),
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
    <section className="flex flex-col gap-4" aria-labelledby="board-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1.5">Live board</div>
          <h2 id="board-title" className="text-xl font-semibold">
            {submissions.length === 0 ? 'No claims yet' : `${submissions.length} formula${submissions.length === 1 ? '' : 's'} claimed`}
          </h2>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-3">Votes left</div>
          <div className="mt-1 flex justify-end gap-1" aria-label={`${votesLeft} of ${votesPerRound} votes left`}>
            {Array.from({ length: votesPerRound }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 w-5 rounded-full ${i < votesLeft ? 'bg-ink' : 'bg-line'}`}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-ink-3">
        Each vote stakes <span className="font-semibold text-ink">{stake} coins</span>.
        Back (▲) formulas you think are right and doubt (▼) the ones you think are wrong.
      </p>

      {error && <div className="alert-error" role="alert">{error}</div>}

      {submissions.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center">
          <div className="font-display text-lg font-semibold">The board is empty</div>
          <p className="mt-1 text-sm text-ink-3">The first correct formula posted takes the reward. Nobody can post it after you.</p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {ordered.map((sub) => {
          const counts = voteCounts.find((v) => v.submissionId === sub.id) ?? { ups: 0, downs: 0 }
          const total = counts.ups + counts.downs
          const upPct = total ? (counts.ups / total) * 100 : 50
          const isOwn = sub.playerId === myPlayerId
          const myVote = myVotes[sub.id]
          const canVote = !isOwn && !myVote && votesLeft > 0 && wallet >= stake && pending === null

          return (
            <li
              key={sub.id}
              ref={(el) => { if (el) itemRefs.current.set(sub.id, el); else itemRefs.current.delete(sub.id) }}
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
                  <span className="truncate font-semibold">{isOwn ? 'You' : sub.label}</span>
                  <span className="shrink-0 text-ink-4">#{claimOrder.get(sub.id)}</span>
                </div>
                <span className="shrink-0 text-ink-4">{timeAgo(sub.submittedAt, now)}</span>
              </div>

              <div className="mb-4 font-display text-xl font-medium leading-snug break-words">
                <Formula expr={sub.expr} />
              </div>

              {/* Crowd sentiment */}
              <div className="mb-4 flex items-center gap-3">
                <span className="tabular w-8 text-sm font-semibold text-up">▲{counts.ups}</span>
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                  {total > 0 && (
                    <>
                      <div className="h-full bg-up transition-all duration-500" style={{ width: `${upPct}%` }} />
                      <div className="h-full bg-down transition-all duration-500" style={{ width: `${100 - upPct}%` }} />
                    </>
                  )}
                </div>
                <span className="tabular w-8 text-right text-sm font-semibold text-down">▼{counts.downs}</span>
              </div>

              {isOwn ? (
                <div className="text-sm text-ink-3">Your claim. You can't vote on it.</div>
              ) : myVote ? (
                <div className={myVote === 'up' ? 'chip-up' : 'chip-down'}>
                  {myVote === 'up' ? '▲ You backed this' : '▼ You doubted this'} · {stake} staked
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => castVote(sub.id, 'up')}
                    disabled={!canVote}
                    className="btn border-up bg-up-soft py-2.5 text-up hover:bg-up hover:text-white"
                  >
                    ▲ Back it
                  </button>
                  <button
                    onClick={() => castVote(sub.id, 'down')}
                    disabled={!canVote}
                    className="btn border-down bg-down-soft py-2.5 text-down hover:bg-down hover:text-white"
                  >
                    ▼ Doubt it
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

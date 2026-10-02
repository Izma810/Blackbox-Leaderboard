import { useState } from 'react'
import type { PublicSubmission, VoteCount, Feature } from '../types'

interface VotingPanelProps {
  submissions: PublicSubmission[]
  voteCounts: VoteCount[]
  myPlayerId: string
  roomId: string
  playerId: string
  votesPerRound: number
  voterReward: number
  onVoteCast: (submissionId: string, type: 'up' | 'down') => void
}

function featureToString(f: Feature): string {
  if (typeof f === 'string') return f
  return `${f.binary}(${f.a}, ${f.b})`
}

export default function VotingPanel({
  submissions, voteCounts, myPlayerId, roomId, playerId,
  votesPerRound, voterReward, onVoteCast,
}: VotingPanelProps) {
  const [voted, setVoted] = useState<Record<string, 'up' | 'down'>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const usedVotes = Object.keys(voted).length
  const votesLeft = votesPerRound - usedVotes

  async function castVote(submissionId: string, voteType: 'up' | 'down') {
    if (voted[submissionId]) return
    if (votesLeft <= 0) { setError('Vote budget exhausted'); return }
    setError('')
    setLoading(submissionId)

    try {
      const res = await fetch(`/api/rooms/${roomId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, submissionId, voteType }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setError(data.error ?? 'Vote failed'); return }
      setVoted((v) => ({ ...v, [submissionId]: voteType }))
      onVoteCast(submissionId, voteType)
    } catch {
      setError('Network error')
    } finally {
      setLoading(null)
    }
  }

  const getCount = (id: string) =>
    voteCounts.find((v) => v.submissionId === id) ?? { ups: 0, downs: 0 }

  return (
    <div className="flex flex-col gap-4">
      {/* Budget bar */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-400">Vote budget</span>
        <span className={`font-bold ${votesLeft === 0 ? 'text-red-400' : 'text-brand-400'}`}>
          {votesLeft} / {votesPerRound} remaining
        </span>
      </div>

      <div className="text-xs text-zinc-500">
        Correct vote: <span className="text-brand-400">+{voterReward}</span> coins ·
        Wrong vote: <span className="text-red-400">−{voterReward}</span> coins ·
        Results revealed at end of phase
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2">
          {error}
        </div>
      )}

      {submissions.length === 0 && (
        <p className="text-zinc-500 italic text-sm">No submissions yet.</p>
      )}

      {submissions.map((sub) => {
        const counts = getCount(sub.id)
        const myVote = voted[sub.id]
        const isOwn = sub.playerId === myPlayerId
        const isLoading = loading === sub.id

        return (
          <div
            key={sub.id}
            className={`card flex flex-col gap-3 animate-slide-up ${isOwn ? 'border-brand-500/30 bg-brand-500/5' : ''}`}
          >
            {/* Submission header */}
            <div className="flex items-center justify-between">
              <span className={`font-medium ${isOwn ? 'text-brand-400' : 'text-zinc-300'}`}>
                {sub.label}
                {isOwn && <span className="text-zinc-500 text-xs ml-1.5">(your answer)</span>}
              </span>
              <span className="text-zinc-600 text-xs">
                {new Date(sub.submittedAt).toLocaleTimeString()}
              </span>
            </div>

            {/* Features */}
            <div className="flex flex-wrap gap-1.5">
              {sub.features.map((f, i) => (
                <code
                  key={i}
                  className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300"
                >
                  {featureToString(f)}
                </code>
              ))}
            </div>

            {/* Vote buttons + counts */}
            <div className="flex items-center gap-3 mt-1">
              {!isOwn ? (
                <>
                  <button
                    onClick={() => castVote(sub.id, 'up')}
                    disabled={!!myVote || votesLeft === 0 || isLoading}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                      ${myVote === 'up'
                        ? 'bg-brand-500/20 text-brand-400 border border-brand-500/50'
                        : 'bg-zinc-800 hover:bg-green-500/20 hover:text-green-400 text-zinc-400 border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed'}
                    `}
                  >
                    ▲ {counts.ups > 0 ? counts.ups : ''}
                    {!myVote && votesLeft > 0 && <span className="text-xs text-zinc-600">upvote</span>}
                  </button>
                  <button
                    onClick={() => castVote(sub.id, 'down')}
                    disabled={!!myVote || votesLeft === 0 || isLoading}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                      ${myVote === 'down'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                        : 'bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 text-zinc-400 border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed'}
                    `}
                  >
                    ▼ {counts.downs > 0 ? counts.downs : ''}
                    {!myVote && votesLeft > 0 && <span className="text-xs text-zinc-600">downvote</span>}
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-3 text-sm text-zinc-500">
                  <span>▲ {counts.ups}</span>
                  <span>▼ {counts.downs}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

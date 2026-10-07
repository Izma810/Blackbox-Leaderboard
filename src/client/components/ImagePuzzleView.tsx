/**
 * Renders an image puzzle:
 *  - One or more input/output image pairs (multi-image puzzles show several examples
 *    of the same transform, all side-by-side)
 *  - All available transforms as selectable chips with descriptions
 *  - Live preview of the player's current filter sequence on the first image
 *  - Submit button (sends ordered list of transform names)
 *  - Voting on other teams' submissions
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ImagePuzzleForPlayers, PublicSubmission, VoteType } from '../types'
import {
  applyPipeline, generateSourceImage, TRANSFORM_DESCRIPTIONS, ALL_TRANSFORMS,
} from '../lib/imageTransforms'
import type { TransformName } from '../lib/imageTransforms'
import { authFetch } from '../lib/session'

const SIZE = 256

// ─── Canvas renderer ──────────────────────────────────────────────────────────

function PixelCanvas({ data, label }: { data: ImageData | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !data) return
    canvas.width = SIZE; canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.putImageData(data, 0, 0)
  }, [data])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="eyebrow text-xs">{label}</div>
      <canvas ref={ref} width={SIZE} height={SIZE}
        className="rounded-xl border border-line shadow-soft"
        style={{ imageRendering: 'pixelated', width: '100%', maxWidth: SIZE }} />
    </div>
  )
}

// ─── Load image from URL → ImageData ─────────────────────────────────────────

async function loadImageData(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE; canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, SIZE, SIZE)
      resolve(ctx.getImageData(0, 0, SIZE, SIZE))
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  puzzle:          ImagePuzzleForPlayers
  submissions:     PublicSubmission[]
  myVotes:         Record<string, VoteType>
  myTeamId:        string
  voteBudget:      number
  votesUsed:       number
  voteStake:       number
  wallet:          number
  submissionsOpen: boolean
  votingOpen:      boolean
  postStake:       number
  hasSubmitted:    boolean
  settled:         boolean
  solution?:       string[]
  onSubmitted:     () => void
  onVoted:         (subId: string, vote: VoteType) => void
}

export default function ImagePuzzleView({
  puzzle, submissions, myVotes, myTeamId, voteBudget, votesUsed, voteStake,
  wallet, submissionsOpen, votingOpen, postStake, hasSubmitted, settled,
  solution, onSubmitted, onVoted,
}: Props) {
  // One ImageData per source image name
  const [sources, setSources]     = useState<ImageData[]>([])
  const [outputs, setOutputs]     = useState<(ImageData | null)[]>([])
  const [preview, setPreview]     = useState<ImageData | null>(null)
  const [selected, setSelected]   = useState<TransformName[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')
  /** The existing answer a rejected duplicate matched; scrolled to and flashed. */
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [voteError, setVoteError] = useState('')
  const [pendingVote, setPendingVote] = useState<string | null>(null)

  // Load all source images
  useEffect(() => {
    let cancelled = false
    async function load() {
      const loaded = await Promise.all(
        puzzle.imageNames.map(async (name) => {
          const data = await loadImageData(`/images/${name}.png`)
          return data ?? generateSourceImage(name)
        }),
      )
      if (!cancelled) setSources(loaded)
    }
    load()
    return () => { cancelled = true }
  }, [puzzle.imageNames])

  // Compute output images once sources load
  useEffect(() => {
    if (sources.length === 0) return
    let cancelled = false
    async function computeOutputs() {
      const outs = await Promise.all(
        sources.map(async (src, i) => {
          const name = puzzle.imageNames[i]
          // Try loading pre-computed output
          const url = puzzle.imageNames.length === 1
            ? `/images/${puzzle.id}_output.png`
            : `/images/${puzzle.id}_output_${i + 1}.png`
          const fromFile = await loadImageData(url)
          if (fromFile) return fromFile
          // If settled, compute from solution
          if (settled && solution) {
            const pixels = applyPipeline(src.data, solution)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return new ImageData(pixels as any, SIZE, SIZE)
          }
          return null
        }),
      )
      if (!cancelled) setOutputs(outs)
    }
    computeOutputs()
    return () => { cancelled = true }
  }, [sources, settled, solution, puzzle.id, puzzle.imageNames])

  // Live preview on first source image
  useEffect(() => {
    if (sources.length === 0 || selected.length === 0) { setPreview(null); return }
    const pixels = applyPipeline(sources[0].data, selected)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPreview(new ImageData(pixels as any, SIZE, SIZE))
  }, [sources, selected])

  useEffect(() => {
    if (!highlightId) return
    document.getElementById(`sub-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(t)
  }, [highlightId])

  const toggleFilter = useCallback((name: TransformName) => {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((f) => f !== name)
      if (prev.length >= puzzle.maxFilters) return prev
      return [...prev, name]
    })
  }, [puzzle.maxFilters])

  const moveFilter = useCallback((i: number, dir: -1 | 1) => {
    setSelected((prev) => {
      const next = [...prev], j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  async function handleSubmit() {
    if (selected.length === 0) return
    setError(''); setSubmitting(true)
    try {
      const res = await authFetch('/api/submit', {
        method: 'POST',
        body: JSON.stringify({ puzzleId: puzzle.id, expr: JSON.stringify(selected) }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; duplicateOf?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Submission failed')
        if (data.duplicateOf) setHighlightId(data.duplicateOf)
        return
      }
      onSubmitted()
    } catch { setError('Network error. Try again.') }
    finally { setSubmitting(false) }
  }

  async function castVote(submissionId: string, voteType: VoteType) {
    setVoteError(''); setPendingVote(submissionId)
    try {
      const res = await authFetch('/api/vote', {
        method: 'POST',
        body: JSON.stringify({ submissionId, voteType }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setVoteError(data.error ?? 'Vote failed'); return }
      onVoted(submissionId, voteType)
    } catch { setVoteError('Network error.') }
    finally { setPendingVote(null) }
  }

  const votesLeft = voteBudget - votesUsed
  const multiImage = puzzle.imageNames.length > 1

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="card">
        <div className="eyebrow mb-1.5">Image Puzzle</div>
        <h2 className="text-2xl font-semibold">{puzzle.title}</h2>
        <p className="mt-2 text-ink-2 max-w-xl">{puzzle.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {puzzle.isCommutative ? (
            <span className="chip-up text-xs">✓ Order of transforms does not matter</span>
          ) : (
            <span className="chip-down text-xs">⚠ Order matters — these do NOT commute</span>
          )}
          {multiImage && (
            <span className="chip-cobalt text-xs">
              {puzzle.imageNames.length} examples — all use the same transform(s)
            </span>
          )}
        </div>
      </div>

      {/* Image pairs */}
      {puzzle.imageNames.map((name, i) => (
        <div key={name} className={`grid gap-4 ${multiImage ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
          <PixelCanvas data={sources[i] ?? null} label={multiImage ? `Input ${i+1} (${name})` : 'Input (original)'} />
          <PixelCanvas
            data={outputs[i] ?? null}
            label={settled ? 'Output (answer)' : 'Output — match this'}
          />
          {!multiImage && preview && (
            <PixelCanvas data={preview} label="Your preview" />
          )}
        </div>
      ))}

      {/* Preview for multi-image puzzles */}
      {multiImage && preview && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <PixelCanvas data={sources[0] ?? null} label="Input 1 (preview base)" />
          <PixelCanvas data={preview} label="Your preview applied" />
        </div>
      )}

      {/* Settlement solution */}
      {settled && solution && (
        <div className="card-pop animate-pop-in">
          <div className="eyebrow mb-2">Solution revealed</div>
          <div className="flex flex-wrap gap-2">
            {solution.map((t, i) => (
              <span key={i} className="chip-up font-mono">{i + 1}. {t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Filter picker */}
      {!hasSubmitted && submissionsOpen && !settled && (
        <div className="card flex flex-col gap-4">
          <div>
            <div className="eyebrow mb-1">Select transforms</div>
            <h3 className="text-lg font-semibold">
              Pick {puzzle.maxFilters === 1 ? 'the 1 transform' : `up to ${puzzle.maxFilters} transforms`}
              {puzzle.maxFilters > 1 && !puzzle.isCommutative && ' — in the correct order'}
            </h3>
          </div>

          {selected.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Your pipeline</div>
              {selected.map((name, i) => (
                <div key={name} className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2">
                  <span className="tabular w-5 text-sm font-bold text-accent-dark">{i + 1}.</span>
                  <span className="flex-1 font-mono text-sm font-semibold">{name}</span>
                  {puzzle.maxFilters > 1 && (
                    <>
                      <button onClick={() => moveFilter(i, -1)} disabled={i === 0}
                        className="btn-ghost px-1.5 py-0.5 text-xs disabled:opacity-30">↑</button>
                      <button onClick={() => moveFilter(i, 1)} disabled={i === selected.length - 1}
                        className="btn-ghost px-1.5 py-0.5 text-xs disabled:opacity-30">↓</button>
                    </>
                  )}
                  <button onClick={() => toggleFilter(name)} className="btn-ghost px-1.5 py-0.5 text-xs text-down">✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ALL_TRANSFORMS.map((name) => {
              const isSel = selected.includes(name)
              const disabled = !isSel && selected.length >= puzzle.maxFilters
              return (
                <button key={name} onClick={() => toggleFilter(name)} disabled={disabled}
                  title={TRANSFORM_DESCRIPTIONS[name]}
                  className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-colors ${
                    isSel    ? 'border-accent bg-accent-soft font-semibold text-ink'
                    : disabled ? 'cursor-not-allowed border-line bg-paper text-ink-4 opacity-50'
                    : 'border-line bg-white text-ink-2 hover:border-ink hover:text-ink'
                  }`}>
                  <div className="font-mono font-semibold">{name}</div>
                  <div className="mt-0.5 text-xs text-ink-4 leading-tight">{TRANSFORM_DESCRIPTIONS[name]}</div>
                </button>
              )
            })}
          </div>

          {error && <div className="alert-error">{error}</div>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-ink-3">
              Costs <span className="font-semibold text-ink">{postStake} coins</span>. One submission per puzzle.
            </p>
            <button onClick={handleSubmit} className="btn-primary px-6 py-3"
              disabled={submitting || selected.length === 0 || wallet < postStake}>
              {submitting ? 'Submitting…' : wallet < postStake ? 'Not enough coins' : `Submit · ${postStake}`}
            </button>
          </div>
        </div>
      )}

      {hasSubmitted && !settled && (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-3">
          Your team submitted an answer. Results revealed when this batch is settled.
        </div>
      )}

      {/* Other teams' submissions */}
      {submissions.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="eyebrow mb-1.5">All submissions</div>
          {voteError && <div className="alert-error">{voteError}</div>}
          <ul className="flex flex-col gap-3">
            {submissions.map((sub) => {
              const isOwn = sub.teamId === myTeamId
              let filters: string[] = []
              try { filters = JSON.parse(sub.expr) } catch { filters = [sub.expr] }
              const myVote = myVotes[sub.id]
              const total  = sub.ups + sub.downs
              const upPct  = total ? (sub.ups / total) * 100 : 50
              const canVote = votingOpen && !isOwn && !myVote && votesLeft > 0 && wallet >= voteStake && !pendingVote

              return (
                <li key={sub.id} id={`sub-${sub.id}`}
                  className={`rounded-2xl border bg-white p-5 shadow-soft ${isOwn ? 'border-2 border-ink' : 'border-line'} ${
                    highlightId === sub.id ? 'animate-flash' : ''
                  }`}>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-semibold">{isOwn ? 'Your team' : sub.label}</span>
                    {sub.verdict && (
                      <span className={sub.verdict === 'right' ? 'chip-up' : 'chip-down'}>
                        {sub.verdict === 'right' ? '✓ Right' : '✗ Wrong'}
                      </span>
                    )}
                  </div>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {filters.map((f, i) => (
                      <span key={i} className="chip-cobalt font-mono text-xs">
                        {filters.length > 1 ? `${i+1}. ` : ''}{f}
                      </span>
                    ))}
                  </div>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="tabular w-8 text-sm font-semibold text-up">▲{sub.ups}</span>
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-line">
                      {total > 0 && <>
                        <div className="h-full bg-up transition-all" style={{ width: `${upPct}%` }} />
                        <div className="h-full bg-down transition-all" style={{ width: `${100-upPct}%` }} />
                      </>}
                    </div>
                    <span className="tabular w-8 text-right text-sm font-semibold text-down">▼{sub.downs}</span>
                  </div>
                  {isOwn ? (
                    <div className="text-sm text-ink-3">Your submission.</div>
                  ) : myVote ? (
                    <div className={myVote === 'up' ? 'chip-up' : 'chip-down'}>
                      {myVote === 'up' ? '▲ You backed this' : '▼ You doubted this'} · {voteStake} staked
                    </div>
                  ) : votingOpen ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => castVote(sub.id, 'up')} disabled={!canVote}
                        className="btn border-up bg-up-soft py-2.5 text-up hover:bg-up hover:text-white">▲ Back it</button>
                      <button onClick={() => castVote(sub.id, 'down')} disabled={!canVote}
                        className="btn border-down bg-down-soft py-2.5 text-down hover:bg-down hover:text-white">▼ Doubt it</button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

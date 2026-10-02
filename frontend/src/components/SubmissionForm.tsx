import { useState } from 'react'
import type { Feature, BinaryTransformKey } from '../types'
import { UNARY_TRANSFORM_OPTIONS, BINARY_TRANSFORM_OPTIONS } from '../types'

interface SubmissionFormProps {
  columns: string[]
  roomId: string
  playerId: string
  onSubmitted: () => void
}

type FeatureEntry =
  | { kind: 'unary';  transform: string; col: string }
  | { kind: 'binary'; op: BinaryTransformKey; a: string; b: string }

function entryToFeature(e: FeatureEntry): Feature {
  if (e.kind === 'unary') return `${e.transform}:${e.col}`
  return { binary: e.op, a: e.a, b: e.b }
}

export default function SubmissionForm({ columns, roomId, playerId, onSubmitted }: SubmissionFormProps) {
  const [entries, setEntries] = useState<FeatureEntry[]>([
    { kind: 'unary', transform: 'identity', col: columns[0] ?? '' },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const addUnary = () =>
    setEntries([...entries, { kind: 'unary', transform: 'identity', col: columns[0] ?? '' }])

  const addBinary = () => {
    if (columns.length < 2) { setError('Need at least 2 columns for a binary feature'); return }
    setEntries([...entries, { kind: 'binary', op: 'multiply', a: columns[0], b: columns[1] }])
  }

  const removeEntry = (idx: number) =>
    setEntries(entries.filter((_, i) => i !== idx))

  const updateEntry = (idx: number, patch: Partial<FeatureEntry>) =>
    setEntries(entries.map((e, i) => (i === idx ? ({ ...e, ...patch } as FeatureEntry) : e)))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (entries.length === 0) { setError('Add at least one feature'); return }

    setSubmitting(true)
    try {
      const features: Feature[] = entries.map(entryToFeature)
      const res = await fetch(`/api/rooms/${roomId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, features }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setError(data.error ?? 'Submission failed'); return }
      onSubmitted()
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">Your feature guess</div>

      {entries.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2 bg-zinc-800/60 rounded-lg p-3 animate-fade-in">
          {/* Feature type toggle */}
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex items-center gap-2">
              <select
                className="input text-xs py-1 flex-none w-24"
                value={entry.kind}
                onChange={(e) => {
                  const k = e.target.value as 'unary' | 'binary'
                  if (k === 'unary') updateEntry(idx, { kind: 'unary', transform: 'identity', col: columns[0] ?? '' } as any)
                  else updateEntry(idx, { kind: 'binary', op: 'multiply', a: columns[0] ?? '', b: columns[1] ?? columns[0] ?? '' } as any)
                }}
              >
                <option value="unary">Unary</option>
                <option value="binary">Binary</option>
              </select>

              {entry.kind === 'unary' ? (
                <>
                  <select
                    className="input text-xs py-1 flex-1"
                    value={entry.transform}
                    onChange={(e) => updateEntry(idx, { transform: e.target.value })}
                  >
                    {UNARY_TRANSFORM_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.key} — {o.desc}</option>
                    ))}
                  </select>
                  <select
                    className="input text-xs py-1 flex-none w-24"
                    value={entry.col}
                    onChange={(e) => updateEntry(idx, { col: e.target.value })}
                  >
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <select
                    className="input text-xs py-1 flex-none w-24"
                    value={entry.a}
                    onChange={(e) => updateEntry(idx, { a: e.target.value })}
                  >
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    className="input text-xs py-1 flex-1"
                    value={entry.op}
                    onChange={(e) => updateEntry(idx, { op: e.target.value as BinaryTransformKey })}
                  >
                    {BINARY_TRANSFORM_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label} ({o.desc})</option>
                    ))}
                  </select>
                  <select
                    className="input text-xs py-1 flex-none w-24"
                    value={entry.b}
                    onChange={(e) => updateEntry(idx, { b: e.target.value })}
                  >
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </>
              )}
            </div>

            {/* Preview */}
            <div className="text-xs text-zinc-500 ml-1">
              {entry.kind === 'unary'
                ? `→ ${entry.transform}(${entry.col})`
                : `→ ${entry.op}(${entry.a}, ${entry.b})`}
            </div>
          </div>

          {/* Remove button */}
          {entries.length > 1 && (
            <button
              type="button"
              onClick={() => removeEntry(idx)}
              className="text-zinc-600 hover:text-red-400 transition-colors text-lg leading-none px-1"
              title="Remove feature"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {/* Add feature buttons */}
      <div className="flex gap-2">
        <button type="button" onClick={addUnary} className="btn-ghost text-xs border border-zinc-700">
          + Unary feature
        </button>
        {columns.length >= 2 && (
          <button type="button" onClick={addBinary} className="btn-ghost text-xs border border-zinc-700">
            + Binary feature
          </button>
        )}
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit Answer'}
      </button>
    </form>
  )
}

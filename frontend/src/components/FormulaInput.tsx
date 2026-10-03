import { useMemo, useRef, useState } from 'react'
import { parseFormula, FormulaError, MAX_FORMULA_LENGTH, type Node } from '../../../shared/expression'
import { FormulaNode } from '../lib/formula'
import { apiUrl } from '../lib/backend'

interface FormulaInputProps {
  columns: string[]
  roomId: string
  playerId: string
  stake: number
  wallet: number
  onSubmitted: () => void
  /** Called with the id of the submission that already claimed this formula */
  onDuplicate: (submissionId: string) => void
}

/** Palette buttons: label shown, text inserted, and where the cursor lands (from the end) */
const PIECES: { label: string; insert: string; back?: number; title: string }[] = [
  { label: 'x²',    insert: '^2',     title: 'Square' },
  { label: 'x³',    insert: '^3',     title: 'Cube' },
  { label: 'xⁿ',    insert: '^',      title: 'Any power' },
  { label: '√',     insert: 'sqrt()', back: 1, title: 'Square root' },
  { label: '1/',    insert: '1/',     title: 'One over…' },
  { label: 'ln',    insert: 'ln()',   back: 1, title: 'Natural log' },
  { label: 'eˣ',    insert: 'exp()',  back: 1, title: 'e to the power' },
  { label: 'sin',   insert: 'sin()',  back: 1, title: 'Sine' },
  { label: 'cos',   insert: 'cos()',  back: 1, title: 'Cosine' },
  { label: '|x|',   insert: 'abs()',  back: 1, title: 'Absolute value' },
  { label: 'π',     insert: 'pi',     title: 'Pi' },
  { label: '( )',   insert: '()',     back: 1, title: 'Brackets' },
]

const MORE_FUNCTIONS = 'tan, log2, log10, floor, ceil, step (1 if ≥ 0, else 0)'

export default function FormulaInput({
  columns, roomId, playerId, stake, wallet, onSubmitted, onDuplicate,
}: FormulaInputProps) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo((): { node: Node } | { error: FormulaError } | null => {
    if (!text.trim()) return null
    try {
      return { node: parseFormula(text, columns) }
    } catch (e) {
      return { error: e instanceof FormulaError ? e : new FormulaError(String(e), 0) }
    }
  }, [text, columns])

  const valid = parsed !== null && 'node' in parsed
  const examples = columns.length > 1
    ? [`${columns[0]}/${columns[1]}`, `2${columns[0]}^2 + ${columns[1]}`, `sqrt(${columns[0]}^2 + ${columns[1]}^2)`]
    : [`2${columns[0]}^2 + 1`, `3sin(${columns[0]})`, `${columns[0]} + 0.5cos(2pi ${columns[0]})`]

  function insert(piece: string, back = 0) {
    const el = inputRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + piece + text.slice(end)
    setText(next)
    setServerError('')
    requestAnimationFrame(() => {
      el?.focus()
      const pos = start + piece.length - back
      el?.setSelectionRange(pos, pos)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setServerError('')
    setSubmitting(true)
    try {
      const res = await fetch(apiUrl(`/api/rooms/${roomId}/submit`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, expr: text }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; duplicateOf?: string }
      if (!res.ok || !data.ok) {
        setServerError(data.error ?? 'Could not post your formula')
        if (data.duplicateOf) onDuplicate(data.duplicateOf)
        return
      }
      onSubmitted()
    } catch {
      setServerError('Network error. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card-pop flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow mb-1.5">Your guess</div>
          <h2 className="text-xl font-semibold">Type the formula</h2>
        </div>
        <span className="chip-accent">Posting costs {stake} coins</span>
      </div>

      {/* Input */}
      <div className="flex flex-col gap-2">
        <div className={`flex items-center gap-3 rounded-xl border-2 bg-white px-4 transition-colors focus-within:ring-4 focus-within:ring-accent/25 ${
          parsed && 'error' in parsed ? 'border-down' : 'border-line focus-within:border-ink'
        }`}>
          <span className="font-display text-xl font-medium text-ink-3">y =</span>
          <input
            ref={inputRef}
            className="tabular min-w-0 flex-1 bg-transparent py-3.5 font-display text-xl font-medium outline-none placeholder:text-ink-4"
            placeholder={examples[0]}
            value={text}
            maxLength={MAX_FORMULA_LENGTH}
            onChange={(e) => { setText(e.target.value); setServerError('') }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Formula for y"
            aria-invalid={parsed !== null && 'error' in parsed}
            aria-describedby="formula-feedback"
          />
        </div>

        {/* Preview / error */}
        <div id="formula-feedback" className="min-h-[2.25rem] px-1" aria-live="polite">
          {parsed === null && (
            <span className="text-sm text-ink-3">
              Try something like {examples.map((ex, i) => (
                <span key={ex}>
                  {i > 0 && ', '}
                  <button type="button" className="font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                    onClick={() => setText(ex)}>{ex}</button>
                </span>
              ))}
            </span>
          )}
          {parsed && 'node' in parsed && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-up">✓</span>
              <span className="font-display text-2xl font-medium leading-snug break-words">
                <span className="text-ink-3">y = </span><FormulaNode node={parsed.node} />
              </span>
            </div>
          )}
          {parsed && 'error' in parsed && (
            <div className="text-sm">
              <span className="font-semibold text-down">{parsed.error.message}</span>
              {parsed.error.pos < text.length && (
                <span className="ml-2 font-mono text-ink-3">
                  {text.slice(0, parsed.error.pos)}
                  <span className="rounded bg-down-soft px-0.5 text-down">{text[parsed.error.pos]}</span>
                  {text.slice(parsed.error.pos + 1)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Palette */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {columns.map((c) => (
            <button key={c} type="button" onClick={() => insert(c)}
              className="rounded-lg border-2 border-cobalt/30 bg-cobalt-soft px-3 py-1.5 text-sm font-semibold text-cobalt transition-colors hover:border-cobalt">
              {c}
            </button>
          ))}
          {PIECES.map((p) => (
            <button key={p.label} type="button" title={p.title} onClick={() => insert(p.insert, p.back)}
              className="rounded-lg border-2 border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink-2 transition-colors hover:border-ink hover:text-ink">
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-4">
          Write it like you would on paper: <code className="text-ink-3">2x^2</code> or <code className="text-ink-3">2*x^2</code> both work.
          Also available: {MORE_FUNCTIONS}.
        </p>
      </div>

      {serverError && <div className="alert-error" role="alert">{serverError}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="max-w-sm text-sm text-ink-3">
          One formula per round. The numbers matter: 2x² and 3x² are different answers.
          Getting the functions right but the numbers wrong still earns half.
        </p>
        <button
          type="submit"
          className="btn-primary px-6 py-3"
          disabled={submitting || !valid || wallet < stake}
        >
          {submitting ? 'Posting…' : wallet < stake ? 'Not enough coins' : `Post formula · ${stake}`}
        </button>
      </div>
    </form>
  )
}

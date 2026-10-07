import { useState } from 'react'
import type { PuzzleForPlayers } from '../types'
import DataPlot from './DataPlot'
import ThreeDPlot from './ThreeDPlot'

const DIFFICULTY: Record<number, { label: string; className: string }> = {
  1: { label: 'Warm-up',  className: 'chip-up' },
  2: { label: 'Tricky',   className: 'chip-accent' },
  3: { label: 'Boss',     className: 'chip-down' },
}

export default function PuzzlePanel({ puzzle }: { puzzle: PuzzleForPlayers }) {
  const has3D = puzzle.columns.length === 2
  const [view, setView]   = useState<'plot' | '3d' | 'table'>(has3D ? '3d' : 'plot')
  const [xCol, setXCol]   = useState(puzzle.columns[0])
  const activeCol = puzzle.columns.includes(xCol) ? xCol : puzzle.columns[0]
  const diff = DIFFICULTY[puzzle.difficulty]

  return (
    <section className="card flex flex-col gap-5" aria-labelledby="puzzle-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">The black box</div>
          <h2 id="puzzle-title" className="text-2xl font-semibold">{puzzle.title}</h2>
          <p className="mt-1.5 max-w-xl text-ink-2">{puzzle.description}</p>
        </div>
        {diff && <span className={diff.className}>{diff.label}</span>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* View tabs */}
        <div className="inline-flex rounded-xl bg-ink/5 p-1" role="tablist" aria-label="Data view">
          {has3D && (
            <button role="tab" aria-selected={view === '3d'} onClick={() => setView('3d')}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                view === '3d' ? 'bg-white text-ink shadow-soft' : 'text-ink-3 hover:text-ink'
              }`}>
              3D ⟳
            </button>
          )}
          {(['plot', 'table'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                view === v ? 'bg-white text-ink shadow-soft' : 'text-ink-3 hover:text-ink'
              }`}>
              {v === 'plot' ? 'Plot' : 'Raw data'}
            </button>
          ))}
        </div>

        {view === 'plot' && puzzle.columns.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Plot y against
            <select className="select w-auto py-1.5 pl-3 text-sm" value={activeCol}
              onChange={(e) => setXCol(e.target.value)}>
              {puzzle.columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}

        <span className="text-sm text-ink-3">
          {puzzle.y.length} points · inputs: {puzzle.columns.join(', ')}
        </span>
      </div>

      {view === '3d' && has3D ? (
        <ThreeDPlot
          col1={puzzle.X[puzzle.columns[0]]}
          col2={puzzle.X[puzzle.columns[1]]}
          y={puzzle.y}
          col1Label={puzzle.columns[0]}
          col2Label={puzzle.columns[1]}
        />
      ) : view === 'plot' ? (
        <DataPlot xs={puzzle.X[activeCol]} ys={puzzle.y} xLabel={activeCol} />
      ) : (
        <div className="max-h-[340px] overflow-auto rounded-xl border border-line">
          <table className="tabular w-full text-sm">
            <thead className="sticky top-0 bg-paper">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-ink-3">#</th>
                {puzzle.columns.map((c) => (
                  <th key={c} className="px-4 py-2.5 text-left font-semibold text-ink-2">{c}</th>
                ))}
                <th className="px-4 py-2.5 text-left font-semibold text-cobalt">y</th>
              </tr>
            </thead>
            <tbody>
              {puzzle.y.map((yv, i) => (
                <tr key={i} className="border-t border-line/70 hover:bg-paper/60">
                  <td className="px-4 py-1.5 text-ink-4">{i + 1}</td>
                  {puzzle.columns.map((c) => (
                    <td key={c} className="px-4 py-1.5 text-ink-2">{puzzle.X[c][i]}</td>
                  ))}
                  <td className="px-4 py-1.5 font-semibold text-cobalt">{yv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

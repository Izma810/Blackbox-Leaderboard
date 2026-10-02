import type { PuzzleForPlayers } from '../types'

interface PuzzleDisplayProps {
  puzzle: PuzzleForPlayers
  previewRows?: number
}

const DIFFICULTY_LABEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Challenge' }
const DIFFICULTY_COLOR: Record<number, string> = {
  1: 'badge-green',
  2: 'badge-yellow',
  3: 'badge-red',
}

export default function PuzzleDisplay({ puzzle, previewRows = 20 }: PuzzleDisplayProps) {
  const cols = puzzle.columns
  const n = puzzle.y.length
  const displayN = Math.min(previewRows, n)

  // Sample evenly spaced rows for the preview
  const indices: number[] = []
  for (let i = 0; i < displayN; i++) {
    indices.push(Math.floor((i * n) / displayN))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{puzzle.title}</h2>
          <p className="text-zinc-400 text-sm mt-1 italic">{puzzle.description}</p>
        </div>
        <span className={DIFFICULTY_COLOR[puzzle.difficulty] ?? 'badge-zinc'}>
          {DIFFICULTY_LABEL[puzzle.difficulty] ?? '?'}
        </span>
      </div>

      {/* Hidden function hint */}
      <div className="text-xs text-zinc-500 font-mono">
        x → <span className="text-zinc-400 font-bold">??? BLACK BOX ???</span> → y
        &nbsp;&nbsp;|&nbsp;&nbsp;
        showing {displayN} of {n} rows
      </div>

      {/* Data table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-zinc-800/80">
              {cols.map((col) => (
                <th key={col} className="px-3 py-2 text-left text-zinc-400 font-medium">
                  {col}
                </th>
              ))}
              <th className="px-3 py-2 text-left text-brand-400 font-bold">y</th>
            </tr>
          </thead>
          <tbody>
            {indices.map((i) => (
              <tr key={i} className="border-t border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                {cols.map((col) => (
                  <td key={col} className="px-3 py-1.5 text-zinc-300">
                    {puzzle.X[col]?.[i]?.toFixed(4) ?? '—'}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-brand-400 font-medium">
                  {puzzle.y[i]?.toFixed(4) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

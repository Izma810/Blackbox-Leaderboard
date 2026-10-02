import { useMemo, useState } from 'react'

interface DataPlotProps {
  xs: number[]
  ys: number[]
  xLabel: string
}

const W = 640
const H = 340
const PAD = { top: 16, right: 20, bottom: 40, left: 56 }

/** Roughly 5 round-numbered ticks covering [min, max] */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)))
  }
  return ticks
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return v.toExponential(0)
  return Number(v.toFixed(2)).toString()
}

export default function DataPlot({ xs, ys, xLabel }: DataPlotProps) {
  const [hover, setHover] = useState<number | null>(null)

  const { sx, sy, xTicks, yTicks } = useMemo(() => {
    const pad = (lo: number, hi: number) => {
      const span = hi - lo || Math.abs(hi) || 1
      return [lo - span * 0.05, hi + span * 0.05] as const
    }
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs))
    const [y0, y1] = pad(Math.min(...ys), Math.max(...ys))
    return {
      sx: (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * (W - PAD.left - PAD.right),
      sy: (v: number) => H - PAD.bottom - ((v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom),
      xTicks: niceTicks(x0, x1),
      yTicks: niceTicks(y0, y1),
    }
  }, [xs, ys])

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Scatter plot of y against ${xLabel}, ${xs.length} points`}
        onMouseLeave={() => setHover(null)}
      >
        {/* grid */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="#E4DFD3" />
            <text x={PAD.left - 10} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="12" fill="#6B665B">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={H - PAD.bottom} stroke="#EFEBE2" />
            <text x={sx(t)} y={H - PAD.bottom + 20} textAnchor="middle" fontSize="12" fill="#6B665B">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#17150F" strokeWidth="1.5" />
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="#17150F" strokeWidth="1.5" />

        <text x={(W + PAD.left) / 2} y={H - 4} textAnchor="middle" fontSize="13" fontWeight="600" fill="#17150F">
          {xLabel}
        </text>
        <text x={14} y={(H - PAD.bottom) / 2} textAnchor="middle" fontSize="13" fontWeight="600" fill="#17150F"
          transform={`rotate(-90 14 ${(H - PAD.bottom) / 2})`}>
          y
        </text>

        {/* points */}
        {xs.map((x, i) => (
          <circle
            key={i}
            cx={sx(x)}
            cy={sy(ys[i])}
            r={hover === i ? 6 : 3.5}
            fill="#3355E8"
            fillOpacity={hover === i ? 1 : 0.55}
            stroke={hover === i ? '#17150F' : 'none'}
            strokeWidth="1.5"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover !== null && (
        <div className="tabular pointer-events-none absolute right-3 top-3 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white">
          {xLabel} = {xs[hover]} · y = {ys[hover]}
        </div>
      )}
    </div>
  )
}

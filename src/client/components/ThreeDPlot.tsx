import { useEffect, useRef, useCallback } from 'react'

interface ThreeDPlotProps {
  /** Column 1 values → X axis */
  col1: number[]
  /** Column 2 values → Z axis */
  col2: number[]
  /** Output y values → Y axis (vertical) */
  y: number[]
  col1Label: string
  col2Label: string
}

// ─── Viridis colour map (5-stop approximation) ────────────────────────────────

const VIRIDIS = [
  [68, 1, 84],
  [58, 82, 139],
  [32, 144, 141],
  [94, 201, 98],
  [253, 231, 37],
] as const

function viridisRgb(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const idx = Math.min(Math.floor(clamped * 4), 3)
  const f = clamped * 4 - idx
  const a = VIRIDIS[idx], b = VIRIDIS[idx + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return `rgb(${r},${g},${bl})`
}

// ─── Projection helpers ───────────────────────────────────────────────────────

function normalise(arr: number[]): number[] {
  const lo = Math.min(...arr), hi = Math.max(...arr)
  const span = hi - lo || 1
  return arr.map((v) => ((v - lo) / span) * 1.6 - 0.8)
}

interface Point3D { x: number; y: number; z: number; colour: string }

function project(p: Point3D, rx: number, ry: number, W: number, H: number) {
  // Rotate around Y then X
  const cy = Math.cos(ry), sy = Math.sin(ry)
  const cx = Math.cos(rx), sx = Math.sin(rx)

  const x1 = p.x * cy + p.z * sy
  const z1 = -p.x * sy + p.z * cy
  const y2 = p.y * cx - z1 * sx
  const z2 = p.y * sx + z1 * cx

  const foc = 2.5
  const cam = 4
  const scale = Math.min(W, H) * 0.38
  const u =  (x1 * foc) / (z2 + cam) * scale + W / 2
  const v = -(y2 * foc) / (z2 + cam) * scale + H / 2

  return { u, v, depth: z2 }
}

// ─── Axis line helper ─────────────────────────────────────────────────────────

function drawAxis(
  ctx: CanvasRenderingContext2D,
  from: Point3D, to: Point3D, label: string, colour: string,
  rx: number, ry: number, W: number, H: number,
) {
  const f = project(from, rx, ry, W, H)
  const t = project(to,   rx, ry, W, H)
  ctx.strokeStyle = colour
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(f.u, f.v); ctx.lineTo(t.u, t.v); ctx.stroke()
  // label at positive end
  ctx.fillStyle = colour
  ctx.font = 'bold 11px monospace'
  ctx.fillText(label, t.u + 4, t.v + 4)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ThreeDPlot({ col1, col2, y, col1Label, col2Label }: ThreeDPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef({ rx: 0.35, ry: -0.6, dragging: false, lx: 0, ly: 0 })

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#fafaf8'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const { rx, ry } = state.current

    // Normalise data
    const nx = normalise(col1)
    const ny = normalise(y)
    const nz = normalise(col2)

    const yMin = Math.min(...y), yMax = Math.max(...y)

    // Build points
    const points: (Point3D & { colour: string })[] = nx.map((xv, i) => ({
      x: xv, y: ny[i], z: nz[i],
      colour: viridisRgb((y[i] - yMin) / (yMax - yMin || 1)),
    }))

    // Sort by depth (far first → painter's algorithm)
    const projected = points.map((p) => ({ ...p, proj: project(p, rx, ry, W, H) }))
    projected.sort((a, b) => b.proj.depth - a.proj.depth)

    // Draw axes
    const O: Point3D = { x: -0.85, y: -0.85, z: -0.85, colour: '' }
    drawAxis(ctx, O, { ...O, x:  0.95 }, col1Label, '#e34', rx, ry, W, H)
    drawAxis(ctx, O, { ...O, y:  0.95 }, 'y',        '#2a3', rx, ry, W, H)
    drawAxis(ctx, O, { ...O, z:  0.95 }, col2Label, '#46e', rx, ry, W, H)

    // Draw points
    for (const { proj, colour } of projected) {
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(proj.u, proj.v, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // Colour bar legend
    const barX = W - 28, barY = 30, barH = H - 70
    for (let i = 0; i < barH; i++) {
      ctx.fillStyle = viridisRgb(1 - i / barH)
      ctx.fillRect(barX, barY + i, 10, 1)
    }
    ctx.strokeStyle = '#17150F'
    ctx.lineWidth = 0.5
    ctx.strokeRect(barX, barY, 10, barH)
    ctx.fillStyle = '#17150F'
    ctx.font = '10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(yMax.toFixed(1), barX - 2, barY + 8)
    ctx.fillText(yMin.toFixed(1), barX - 2, barY + barH)
    ctx.textAlign = 'left'

    // Instructions
    ctx.fillStyle = '#9C968A'
    ctx.font = '11px sans-serif'
    ctx.fillText('drag to rotate', 8, H - 8)
  }, [col1, col2, y, col1Label, col2Label])

  // Mouse / touch handlers
  const onDown = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault()
    const s = state.current
    s.dragging = true
    const pos = 'touches' in e ? e.touches[0] : e
    s.lx = pos.clientX; s.ly = pos.clientY
  }, [])

  const onMove = useCallback((e: MouseEvent | TouchEvent) => {
    const s = state.current
    if (!s.dragging) return
    e.preventDefault()
    const pos = 'touches' in e ? e.touches[0] : e
    const dx = pos.clientX - s.lx
    const dy = pos.clientY - s.ly
    s.ry += dx * 0.01
    s.rx += dy * 0.01
    s.rx = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, s.rx))
    s.lx = pos.clientX; s.ly = pos.clientY
    render()
  }, [render])

  const onUp = useCallback(() => { state.current.dragging = false }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Set canvas size with devicePixelRatio
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)

    render()

    canvas.addEventListener('mousedown',  onDown as EventListener)
    canvas.addEventListener('mousemove',  onMove as EventListener)
    canvas.addEventListener('mouseup',    onUp)
    canvas.addEventListener('mouseleave', onUp)
    canvas.addEventListener('touchstart', onDown as EventListener, { passive: false })
    canvas.addEventListener('touchmove',  onMove as EventListener, { passive: false })
    canvas.addEventListener('touchend',   onUp)

    return () => {
      canvas.removeEventListener('mousedown',  onDown as EventListener)
      canvas.removeEventListener('mousemove',  onMove as EventListener)
      canvas.removeEventListener('mouseup',    onUp)
      canvas.removeEventListener('mouseleave', onUp)
      canvas.removeEventListener('touchstart', onDown as EventListener)
      canvas.removeEventListener('touchmove',  onMove as EventListener)
      canvas.removeEventListener('touchend',   onUp)
    }
  }, [render, onDown, onMove, onUp])

  return (
    <canvas
      ref={canvasRef}
      className="h-auto w-full cursor-grab rounded-xl active:cursor-grabbing"
      style={{ height: 340 }}
      aria-label={`3D scatter of y against ${col1Label} and ${col2Label}. Drag to rotate.`}
    />
  )
}

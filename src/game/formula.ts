/**
 * Judging and duplicate detection for typed formulas.
 *
 * Both compare a formula's *predicted outputs*, so algebraically identical
 * formulas (x·x and x^2) are the same answer, while 2x^2 and 3x^2 are not.
 *
 * Distances are normalised by the spread of the true y values:
 *
 *   dist(a, b) = ‖a − b‖ / ‖y − mean(y)‖        (dist(p, y) = √(1 − R²))
 *
 * Verdicts:
 *   right  — dist(prediction, y) ≤ TOLERANCE
 *   close  — not right, but refitting the formula's own coefficients and
 *            constant makes it right ("right functions, wrong numbers").
 *            Only counts if it doesn't use more terms than the real answer,
 *            so throwing in every function under the sun doesn't qualify.
 *   wrong  — anything else
 */

import { parseFormula, evaluate, splitTerms, type Node } from '../../shared/expression'

export const TOLERANCE = 0.02
/**
 * Equal to TOLERANCE so a near-miss wrong answer can never block the right
 * one, while "2x^2 + ε" is still rejected once 2x^2 is taken.
 */
export const DUPLICATE_TOLERANCE = TOLERANCE

export type Verdict = 'right' | 'close' | 'wrong'

export interface Judgement {
  verdict: Verdict
  /** 1 − distance to y, clamped to [0, 1] */
  accuracy: number
  r2: number
}

export function normalisedDistance(a: number[], b: number[], y: number[]): number {
  const mean = y.reduce((s, v) => s + v, 0) / y.length
  let diff = 0
  let spread = 0
  for (let i = 0; i < y.length; i++) {
    diff += (a[i] - b[i]) ** 2
    spread += (y[i] - mean) ** 2
  }
  // Constant y: fall back to absolute RMS distance
  if (spread < 1e-12) return Math.sqrt(diff / y.length)
  return Math.sqrt(diff / spread)
}

export function isFinitePrediction(prediction: number[]): boolean {
  return prediction.every(Number.isFinite)
}

/** Parse + evaluate, throwing a player-readable error if it can't be scored. */
export function compileFormula(expr: string, columns: Record<string, number[]>): { tree: Node; prediction: number[] } {
  const tree = parseFormula(expr, Object.keys(columns))
  const prediction = evaluate(tree, columns)
  if (!isFinitePrediction(prediction)) {
    throw new Error('That formula breaks on some data points (dividing by zero, log or √ of a negative, or overflow)')
  }
  return { tree, prediction }
}

export function judge(
  expr: string,
  columns: Record<string, number[]>,
  y: number[],
  solution: string,
): Judgement {
  let tree: Node
  let prediction: number[]
  try {
    ({ tree, prediction } = compileFormula(expr, columns))
  } catch {
    return { verdict: 'wrong', accuracy: 0, r2: 0 }
  }

  const d = normalisedDistance(prediction, y, y)
  const accuracy = Math.max(0, Math.min(1, 1 - d))
  const r2 = 1 - d * d
  if (d <= TOLERANCE) return { verdict: 'right', accuracy, r2 }

  const shapes = splitTerms(tree).flatMap((t) => (t.shape ? [t.shape] : []))
  const solutionShapes = splitTerms(parseFormula(solution, Object.keys(columns)))
    .filter((t) => t.shape).length
  if (shapes.length > solutionShapes) return { verdict: 'wrong', accuracy, r2 }

  const basis = shapes.map((s) => evaluate(s, columns))
  if (!basis.every(isFinitePrediction)) return { verdict: 'wrong', accuracy, r2 }

  const refit = fitWithIntercept(basis, y)
  const verdict = normalisedDistance(refit, y, y) <= TOLERANCE ? 'close' : 'wrong'
  return { verdict, accuracy, r2 }
}

// ─── Least squares ───────────────────────────────────────────────────────────

/** Best predictions of y from c₀ + Σ cᵢ·basisᵢ (ordinary least squares). */
function fitWithIntercept(basis: number[][], y: number[]): number[] {
  const n = y.length
  const cols = [new Array<number>(n).fill(1), ...basis]
  const m = cols.length

  // Normal equations: (XᵀX) β = Xᵀy, solved by Gauss-Jordan with partial pivoting
  const aug = cols.map((ci) => [
    ...cols.map((cj) => ci.reduce((s, v, k) => s + v * cj[k], 0)),
    ci.reduce((s, v, k) => s + v * y[k], 0),
  ])
  for (let col = 0; col < m; col++) {
    let pivotRow = col
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r
    }
    ;[aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]]
    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) continue   // redundant column (e.g. x + x)
    for (let r = 0; r < m; r++) {
      if (r === col) continue
      const f = aug[r][col] / pivot
      for (let c = col; c <= m; c++) aug[r][c] -= f * aug[col][c]
    }
  }
  const beta = aug.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[m] / row[i]))

  return Array.from({ length: n }, (_, k) => cols.reduce((s, c, j) => s + beta[j] * c[k], 0))
}

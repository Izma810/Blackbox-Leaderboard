import { UNARY_TRANSFORMS, BINARY_TRANSFORMS, POWER_EXPONENTS } from './transforms'
import { fitOLS, predict, r2Score } from './regression'
import type { Feature, UnaryTransformKey } from '../types'

// ─── Feature matrix builder ──────────────────────────────────────────────────

/**
 * Apply submitted features to column data and return the feature matrix (n × m).
 * Throws a descriptive error for unknown transforms / columns.
 */
export function buildFeatureMatrix(
  features: Feature[],
  columns: Record<string, number[]>,
): number[][] {
  if (features.length === 0) throw new Error('At least one feature is required')

  const n = Object.values(columns)[0]?.length ?? 0
  const featureCols: number[][] = []

  for (const feat of features) {
    if (typeof feat === 'string') {
      // e.g. "square:x"  or bare column name "x"
      const colonIdx = feat.indexOf(':')
      const transformKey = colonIdx >= 0 ? feat.slice(0, colonIdx) : 'identity'
      const colName = colonIdx >= 0 ? feat.slice(colonIdx + 1) : feat

      const fn = UNARY_TRANSFORMS[transformKey as UnaryTransformKey]
      if (!fn) throw new Error(`Unknown transform "${transformKey}"`)

      const colData = columns[colName]
      if (!colData) throw new Error(`Unknown column "${colName}"`)

      featureCols.push(colData.map(fn))
    } else {
      // Binary feature  {binary, a, b}
      const fn = BINARY_TRANSFORMS[feat.binary]
      if (!fn) throw new Error(`Unknown binary transform "${feat.binary}"`)

      const colA = columns[feat.a]
      const colB = columns[feat.b]
      if (!colA) throw new Error(`Unknown column "${feat.a}"`)
      if (!colB) throw new Error(`Unknown column "${feat.b}"`)

      featureCols.push(colA.map((v, i) => fn(v, colB[i])))
    }
  }

  // Transpose: n rows × m cols
  return Array.from({ length: n }, (_, i) => featureCols.map((col) => col[i]))
}

// ─── Submission evaluation ───────────────────────────────────────────────────

export interface EvaluationResult {
  r2: number
  baseScore: number
  isCorrect: boolean
  /** Raw feature matrix — used downstream for similarity check */
  featureMatrix: number[][]
}

/**
 * Evaluate a player's submission against puzzle data.
 * Returns R², correctness flag, and the base score.
 */
export function evaluateSubmission(
  features: Feature[],
  columns: Record<string, number[]>,
  y: number[],
): EvaluationResult {
  const featureMatrix = buildFeatureMatrix(features, columns)
  const beta = fitOLS(featureMatrix, y)
  const yPred = predict(featureMatrix, beta)
  const raw = r2Score(y, yPred)
  const r2 = Math.min(1, Math.max(0, raw))   // clamp
  const isCorrect = r2 >= 0.92

  let baseScore = 0
  if (isCorrect) {
    const qualityBonus = Math.round(50 * Math.min((r2 - 0.92) / 0.08, 1))
    baseScore = 100 + qualityBonus   // 100–150
  }

  return { r2, baseScore, isCorrect, featureMatrix }
}

// ─── Fuzzy power-family partial credit ───────────────────────────────────────

/**
 * When R² < 0.92, award partial credit if the player submitted a power-family
 * transform (identity/square/cube/sqrt/reciprocal) with the wrong exponent.
 *
 * Score = floor(100 / |submitted_power − correct_power|), minimum 0.
 */
export function fuzzyPowerScore(
  features: Feature[],
  correctPowerMap: Record<string, number>,
): number {
  let maxScore = 0

  for (const feat of features) {
    if (typeof feat !== 'string') continue

    const colonIdx = feat.indexOf(':')
    const transformKey = colonIdx >= 0 ? feat.slice(0, colonIdx) : 'identity'
    const colName = colonIdx >= 0 ? feat.slice(colonIdx + 1) : feat

    const submittedPower = POWER_EXPONENTS[transformKey as UnaryTransformKey]
    if (submittedPower === undefined) continue   // not a power-family transform

    const correctPower = correctPowerMap[colName]
    if (correctPower === undefined) continue    // column not in puzzle

    const diff = Math.abs(submittedPower - correctPower)
    if (diff < 1e-10) continue    // exact match — should have been caught by R² path

    const score = Math.floor(100 / diff)
    maxScore = Math.max(maxScore, score)
  }

  return maxScore
}

/**
 * Full submission score.
 * Uses R² when reliable, falls back to fuzzy power scoring otherwise.
 */
export function scoreSubmission(
  r2: number,
  isCorrect: boolean,
  features: Feature[],
  correctPowerMap: Record<string, number>,
): number {
  if (isCorrect) {
    const qualityBonus = Math.round(50 * Math.min((r2 - 0.92) / 0.08, 1))
    return 100 + qualityBonus
  }
  return fuzzyPowerScore(features, correctPowerMap)
}

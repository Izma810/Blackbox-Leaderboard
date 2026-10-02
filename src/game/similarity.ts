/**
 * Pearson-correlation-based similarity check.
 *
 * Before accepting a new submission, we compare its feature matrix (flattened
 * to a single vector) against every existing submission in the same round.
 * If the absolute Pearson correlation exceeds the threshold (default 0.95),
 * we reject the submission as "too similar".
 *
 * This prevents players from trivially copying an already-submitted answer
 * (e.g. submitting 2x² when x² is already posted — same shape, different scalar).
 */

function pearson(a: number[], b: number[]): number {
  const n = a.length
  if (n === 0 || a.length !== b.length) return 0

  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i] }
  const meanA = sumA / n
  const meanB = sumB / n

  let num = 0, denomA = 0, denomB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    denomA += da * da
    denomB += db * db
  }

  const denom = Math.sqrt(denomA * denomB)
  if (denom < 1e-12) return 1   // both vectors are constant → identical shape
  return Math.abs(num / denom)
}

/**
 * Flatten a feature matrix (n × m) to a 1-D vector for comparison.
 * We compare the full multi-feature fingerprint, not individual columns.
 */
function flatten(matrix: number[][]): number[] {
  return matrix.flatMap((row) => row)
}

/**
 * Returns true if newMatrix is too similar to any matrix in existingMatrices.
 * @param newMatrix         Feature matrix for the incoming submission
 * @param existingMatrices  Feature matrices for all prior submissions in the round
 * @param threshold         Pearson |r| above which we reject (default 0.95)
 */
export function isTooSimilar(
  newMatrix: number[][],
  existingMatrices: number[][][],
  threshold = 0.95,
): boolean {
  const newVec = flatten(newMatrix)

  for (const existing of existingMatrices) {
    const existVec = flatten(existing)
    if (newVec.length !== existVec.length) continue
    if (pearson(newVec, existVec) > threshold) return true
  }

  return false
}

/**
 * Pure-TypeScript least-squares linear regression.
 * No external libraries — works in Cloudflare Workers.
 *
 * Fits:  y ≈ β₀ + β₁·f₁(x) + β₂·f₂(x) + …
 * where β = (XᵀX)⁻¹Xᵀy  (bias column prepended automatically)
 */

// ─── Matrix helpers ───────────────────────────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length
  const cols = B[0].length
  const inner = B.length
  const C: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++)
    for (let k = 0; k < inner; k++)
      if (A[i][k] !== 0)
        for (let j = 0; j < cols; j++)
          C[i][j] += A[i][k] * B[k][j]
  return C
}

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]))
}

/**
 * Solves Ax = b via Gauss-Jordan elimination.
 * A must be square and non-singular.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  // Build augmented matrix [A | b]
  const aug: number[][] = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) continue  // singular or near-singular column — skip

    // Eliminate all other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col] / pivot
      for (let j = col; j <= n; j++)
        aug[row][j] -= factor * aug[col][j]
    }
  }

  // Extract solution
  return aug.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fit ordinary least squares.
 * @param X  n × m feature matrix (rows = observations, cols = features)
 * @param y  n-length target vector
 * @returns  coefficient vector β of length m+1 (β[0] = bias / intercept)
 */
export function fitOLS(X: number[][], y: number[]): number[] {
  const n = X.length
  // Prepend bias column of 1s  →  X_aug: n × (m+1)
  const Xaug: number[][] = X.map((row) => [1, ...row])
  const Xt = transpose(Xaug)
  const XtX = matMul(Xt, Xaug)
  const Xty = Xt.map((row) => row.reduce((s, v, i) => s + v * y[i], 0))
  return solveLinearSystem(XtX, Xty)
}

/**
 * Generate predictions given feature matrix and coefficient vector.
 */
export function predict(X: number[][], beta: number[]): number[] {
  return X.map((row) => {
    const Xaug = [1, ...row]
    return Xaug.reduce((s, v, i) => s + v * beta[i], 0)
  })
}

/**
 * Compute R² (coefficient of determination).
 * Clamped to [−∞, 1] — returns 0 if negative (no negative scores in-game).
 */
export function r2Score(y: number[], yPred: number[]): number {
  const n = y.length
  if (n === 0) return 0
  const mean = y.reduce((a, b) => a + b, 0) / n
  const ssTot = y.reduce((a, v) => a + (v - mean) ** 2, 0)
  if (ssTot < 1e-12) return 1   // constant y → perfect fit trivially
  const ssRes = y.reduce((a, v, i) => a + (v - yPred[i]) ** 2, 0)
  return 1 - ssRes / ssTot
}

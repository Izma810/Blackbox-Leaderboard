import type { PuzzleData } from '../types'

// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
// Deterministic, fast, good statistical properties.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randUniform(rng: () => number, lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, () => lo + rng() * (hi - lo))
}

function round4(v: number) { return Math.round(v * 10000) / 10000 }
function clean(arr: number[]) { return arr.map(round4) }

// ─── Puzzle definitions ───────────────────────────────────────────────────────

interface PuzzleDef {
  id: string
  title: string
  description: string
  difficulty: 1 | 2 | 3
  columns: string[]
  generate(rng: () => number, n: number): { X: Record<string, number[]>; y: number[] }
  /** The hidden formula, in the same syntax players type — must reproduce generate()'s y */
  solution: string
  /** Two hints, vaguest first. Point the way without giving away the answer. */
  hints: string[]
}

const PUZZLE_DEFS: PuzzleDef[] = [
  // ── BEGINNER ──────────────────────────────────────────────────────────────

  {
    id: 'line_01',
    title: 'Obedient Numbers',
    description: 'These numbers follow orders without question. A straight path awaits.',
    difficulty: 1,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 1, 10, n)
      const y = x.map(v => 2 * v)
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2x',
    hints: [
      'Compare y with x row by row. Does the gap between them stay the same, or grow?',
      'y ÷ x comes out the same on every row.',
    ],
  },

  {
    id: 'line_02',
    title: 'The Reluctant Ascent',
    description: 'It goes, but it goes the wrong way. Still perfectly linear.',
    difficulty: 1,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 1, 10, n)
      const y = x.map(v => -3 * v)
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '-3x',
    hints: [
      'When x goes up, which way does y go?',
      'y ÷ x comes out the same on every row, and it is negative.',
    ],
  },

  {
    id: 'square_01',
    title: 'The Bend in the Road',
    description: 'Something bends here. Not quite a line — something rounder.',
    difficulty: 1,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 5, n)
      const y = x.map(v => 2 * v ** 2)
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2x^2',
    hints: [
      'When x doubles, y does more than double. Find two rows where x doubles and check.',
      'Doubling x multiplies y by 4. Think about powers of x.',
    ],
  },

  {
    id: 'sqrt_01',
    title: 'Momentum Decay',
    description: 'Fast at first, then it slows. The gains diminish.',
    difficulty: 1,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0.5, 25, n)
      const y = x.map(v => 4 * Math.sqrt(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '4sqrt(x)',
    hints: [
      'y keeps growing, but each step adds a little less than the last one.',
      'Multiplying x by 4 only doubles y.',
    ],
  },

  {
    id: 'log_01',
    title: 'The Compressed Universe',
    description: 'Large inputs barely move the needle. Something is being compressed.',
    difficulty: 1,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 1, 200, n)
      const y = x.map(v => 5 * Math.log(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '5ln(x)',
    hints: [
      'Huge changes in x barely move y. See what happens to y when x is multiplied by 10.',
      'Every time x is multiplied by the same factor, y goes up by the same amount.',
    ],
  },

  {
    id: 'distractor_01',
    title: 'Four Suspects',
    description: 'Four columns walk into a bar. Only one of them knows the answer.',
    difficulty: 1,
    columns: ['x1', 'x2', 'x3', 'x4'],
    generate(rng, n) {
      const x1 = randUniform(rng, 1, 10, n)
      const x2 = randUniform(rng, 0, 20, n)
      const x3 = randUniform(rng, -5, 5, n)
      const x4 = randUniform(rng, 100, 200, n)
      const y = x1.map(v => 2 * v)
      return { X: { x1: clean(x1), x2: clean(x2), x3: clean(x3), x4: clean(x4) }, y: clean(y) }
    },
    solution: '2x1',
    hints: [
      'Not every column matters. Plot y against each column, one at a time.',
      'Only one column lines up with y in a perfectly straight line.',
    ],
  },

  // ── INTERMEDIATE ──────────────────────────────────────────────────────────

  {
    id: 'almost_linear_01',
    title: 'The Imposter Line',
    description: 'Looks linear from far away. Up close, something is off.',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 4 * Math.PI, n)
      const y = x.map(v => v + 0.5 * Math.sin(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: 'x + 0.5sin(x)',
    hints: [
      'Look closely: the points wiggle around a straight line.',
      'Work out y − x for some rows. What is left repeats about every 6.28 units.',
    ],
  },

  {
    id: 'almost_linear_02',
    title: 'Static on the Signal',
    description: 'A clear trend interrupted by a stubborn rhythm.',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 4 * Math.PI, n)
      const y = x.map(v => v + Math.sin(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: 'x + sin(x)',
    hints: [
      'There is a straight-line trend plus something that keeps repeating.',
      'y − x swings between −1 and 1, repeating about every 6.28 units.',
    ],
  },

  {
    id: 'reciprocal_01',
    title: 'Vanishing Point',
    description: 'As x grows, y shrinks toward nothing. What shrinks this fast?',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0.5, 8, n)
      const y = x.map(v => 10 / v)
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '10/x',
    hints: [
      'Multiply x by y on a few rows. Notice anything?',
      'x × y is the same on every row.',
    ],
  },

  {
    id: 'abs_01',
    title: 'The Symmetric Grudge',
    description: 'Both sides of zero behave the same. Symmetry is the clue.',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, -5, 5, n)
      const y = x.map(v => 3 * Math.abs(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '3abs(x)',
    hints: [
      'Compare y at some x with y at −x.',
      'It is a V shape: two straight lines that meet at zero.',
    ],
  },

  {
    id: 'cos_01',
    title: 'The Quarter-Turn',
    description: 'It oscillates, but it starts at its peak, not zero.',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 4 * Math.PI, n)
      const y = x.map(v => 2 * Math.cos(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2cos(x)',
    hints: [
      'It repeats. Where is it highest: near x = 0, or somewhere else?',
      'A wave at its peak when x = 0 that repeats about every 6.28 units.',
    ],
  },

  {
    id: 'periodic_01',
    title: 'The Repeating Rumour',
    description: 'It keeps coming back. The same pattern, over and over.',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 4 * Math.PI, n)
      const y = x.map(v => 3 * Math.sin(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '3sin(x)',
    hints: [
      'It repeats. Measure the distance between two peaks.',
      'A wave that crosses 0 at x = 0 and repeats about every 6.28 units.',
    ],
  },

  {
    id: 'periodic_02',
    title: 'Seven Days of Nothing',
    description: 'A weekly cycle. Something resets every seven units.',
    difficulty: 2,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 28, n)
      const y = x.map(v => 2 * Math.sin(2 * Math.PI * v / 7))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2sin(2pi x/7)',
    hints: [
      'Measure how far apart the peaks are. It is not 6.28.',
      'The pattern repeats every 7 units. A wave that repeats every P units looks like sin(2πx/P).',
    ],
  },

  {
    id: 'product_01',
    title: 'The Missing Third Variable',
    description: 'Neither x1 nor x2 alone explains it. Something multiplies.',
    difficulty: 2,
    columns: ['x1', 'x2'],
    generate(rng, n) {
      const x1 = randUniform(rng, 1, 5, n)
      const x2 = randUniform(rng, 1, 5, n)
      const y = x1.map((v, i) => v * x2[i])
      return { X: { x1: clean(x1), x2: clean(x2) }, y: clean(y) }
    },
    solution: 'x1*x2',
    hints: [
      'Neither column explains y on its own. Try combining them.',
      'Doubling x1 doubles y. Doubling x2 also doubles y.',
    ],
  },

  {
    id: 'ratio_01',
    title: 'Speed Without Units',
    description: 'One thing divided by another. The ratio is what matters.',
    difficulty: 2,
    columns: ['x1', 'x2'],
    generate(rng, n) {
      const x1 = randUniform(rng, 1, 10, n)
      const x2 = randUniform(rng, 0.5, 5, n)
      const y = x1.map((v, i) => v / x2[i])
      return { X: { x1: clean(x1), x2: clean(x2) }, y: clean(y) }
    },
    solution: 'x1/x2',
    hints: [
      'y grows with x1 but shrinks as x2 grows.',
      'Doubling x1 doubles y. Doubling x2 halves y.',
    ],
  },

  // ── CHALLENGE ─────────────────────────────────────────────────────────────

  {
    id: 'distance_01',
    title: 'The Displacement Field',
    description: 'Two dimensions. One measurement. Think Pythagoras.',
    difficulty: 3,
    columns: ['x1', 'x2'],
    generate(rng, n) {
      const x1 = randUniform(rng, 0, 5, n)
      const x2 = randUniform(rng, 0, 5, n)
      const y = x1.map((v, i) => Math.sqrt(v ** 2 + x2[i] ** 2))
      return { X: { x1: clean(x1), x2: clean(x2) }, y: clean(y) }
    },
    solution: 'sqrt(x1^2 + x2^2)',
    hints: [
      'Picture (x1, x2) as a point on a grid. What could y be measuring?',
      'y is a distance. When x2 is near 0, y is almost exactly x1.',
    ],
  },

  {
    id: 'cubic_01',
    title: 'Tripling the Problem',
    description: 'It grows, but faster than a square. Much faster.',
    difficulty: 3,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, -3, 3, n)
      const y = x.map(v => 2 * v ** 3)
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2x^3',
    hints: [
      'Compare y at x and at −x, then see what doubling x does.',
      'Doubling x multiplies y by 8, and y at −x is minus y at x.',
    ],
  },

  {
    id: 'boss_multi',
    title: 'The Hidden Tax',
    description: 'Three variables. Two rules. One is an interaction, one is a shift.',
    difficulty: 3,
    columns: ['x1', 'x2', 'x3'],
    generate(rng, n) {
      const x1 = randUniform(rng, 1, 5, n)
      const x2 = randUniform(rng, 1, 5, n)
      const x3 = randUniform(rng, 0, 3, n)
      const y = x1.map((v, i) => v * x2[i] + 2 * x3[i])
      return { X: { x1: clean(x1), x2: clean(x2), x3: clean(x3) }, y: clean(y) }
    },
    solution: 'x1*x2 + 2x3',
    hints: [
      'Two pieces are added together. One of them uses two columns at once.',
      'If x3 stayed fixed, y would change like x1 times x2. The x3 piece is a straight line.',
    ],
  },

  {
    id: 'boss_sin_sum',
    title: 'Interfering Signals',
    description: 'Two waves with different periods are superimposed. Disentangle them.',
    difficulty: 3,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 14, n)
      const y = x.map(v => 2 * Math.sin(v) + 3 * Math.sin(2 * Math.PI * v / 7))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2sin(x) + 3sin(2pi x/7)',
    hints: [
      'Two waves are added together, each repeating at a different rate.',
      'One wave repeats about every 6.28 units, the other every 7.',
    ],
  },

  {
    id: 'boss_multi_feat',
    title: 'Chaos in Three Channels',
    description: 'Three columns, three different rules — one for each.',
    difficulty: 3,
    columns: ['x1', 'x2', 'x3'],
    generate(rng, n) {
      const x1 = randUniform(rng, 1, 5, n)
      const x2 = randUniform(rng, 1, 20, n)
      const x3 = randUniform(rng, 0.5, 9, n)
      const y = x1.map((v, i) => v ** 2 + Math.log(x2[i]) + Math.sqrt(x3[i]))
      return { X: { x1: clean(x1), x2: clean(x2), x3: clean(x3) }, y: clean(y) }
    },
    solution: 'x1^2 + ln(x2) + sqrt(x3)',
    hints: [
      'Each column adds its own separate piece, and the pieces are summed.',
      'x1’s piece curves upward. x2’s piece flattens out very quickly. x3’s piece grows more and more slowly.',
    ],
  },

  {
    id: 'period_boss',
    title: 'The Noisy Calendar',
    description: 'A weekly rhythm, but there is noise and a distractor column.',
    difficulty: 3,
    columns: ['x', 'noise_col'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 28, n)
      const noise_col = randUniform(rng, 0, 100, n)   // distractor
      const y = x.map(v => 4 * Math.sin(2 * Math.PI * v / 7))
      return { X: { x: clean(x), noise_col: clean(noise_col) }, y: clean(y) }
    },
    solution: '4sin(2pi x/7)',
    hints: [
      'One column is a decoy. Plot y against each column.',
      'Against the useful column, the pattern repeats every 7 units.',
    ],
  },

  {
    id: 'polynomial_01',
    title: 'The Bent Wire',
    description: 'A parabola with a lean. Two features together explain it.',
    difficulty: 3,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, -5, 5, n)
      const y = x.map(v => v ** 2 - 3 * v)
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: 'x^2 - 3x',
    hints: [
      'It is a U shape, but the bottom of the U is not at x = 0.',
      'The bottom of the U is at x = 1.5, and y = 0 when x = 0.',
    ],
  },

  {
    id: 'phase_01',
    title: 'The Hidden Angle',
    description: 'sin + cos. A phase shift in disguise.',
    difficulty: 3,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 4 * Math.PI, n)
      const y = x.map(v => Math.sin(v) + Math.cos(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: 'sin(x) + cos(x)',
    hints: [
      'It is a wave, but at x = 0 it is neither at zero nor at its peak.',
      'Try adding two simple waves together.',
    ],
  },

  {
    id: 'exp_01',
    title: 'The Runaway Growth',
    description: 'Exponential. It starts slow, then it explodes.',
    difficulty: 3,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, 0, 3, n)
      const y = x.map(v => 2 * Math.exp(v))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '2exp(x)',
    hints: [
      'Each step of 1 in x multiplies y by the same amount.',
      'y at x + 1 divided by y at x is about 2.718.',
    ],
  },

  {
    id: 'step_01',
    title: 'The Great Divide',
    description: 'On one side: one value. On the other side: another. Find the line.',
    difficulty: 3,
    columns: ['x'],
    generate(rng, n) {
      const x = randUniform(rng, -5, 5, n)
      const y = x.map(v => 3 * (v >= 0 ? 1 : 0))
      return { X: { x: clean(x) }, y: clean(y) }
    },
    solution: '3step(x)',
    hints: [
      'Look at what happens on either side of x = 0.',
      'y only ever takes two values, switching at x = 0. One of the functions in the list does exactly that.',
    ],
  },
]

// ─── Generate all puzzle datasets at module load ───────────────────────────────

const N_SAMPLES = 200
const BASE_SEED = 42

export const PUZZLES: PuzzleData[] = PUZZLE_DEFS.map((def, idx) => {
  const rng = mulberry32(BASE_SEED + idx * 1000)
  const { X, y } = def.generate(rng, N_SAMPLES)
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    difficulty: def.difficulty,
    columns: def.columns,
    X,
    y,
    solution: def.solution,
    hints: def.hints,
  }
})

export const PUZZLE_MAP = new Map<string, PuzzleData>(PUZZLES.map((p) => [p.id, p]))

/** Public puzzle info — safe to send to clients (no solution data) */
export function getPuzzleInfo(p: PuzzleData) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    columns: p.columns,
  }
}

/** Puzzle data visible to players during submission (X and y, no solution) */
export function getPuzzleForPlayers(p: PuzzleData) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    columns: p.columns,
    X: p.X,
    y: p.y,
    hintCount: p.hints.length,
  }
}

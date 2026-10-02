import type { UnaryTransformKey, BinaryTransformKey } from '../types'

export const UNARY_TRANSFORMS: Record<UnaryTransformKey, (x: number) => number> = {
  identity:    (x) => x,
  square:      (x) => x ** 2,
  cube:        (x) => x ** 3,
  sqrt:        (x) => Math.sqrt(Math.abs(x)),
  abs:         (x) => Math.abs(x),
  log:         (x) => Math.log(Math.abs(x) + 1e-10),
  log2:        (x) => Math.log2(Math.abs(x) + 1e-10),
  reciprocal:  (x) => 1 / (x === 0 ? 1e-10 : x),
  sin:         (x) => Math.sin(x),
  cos:         (x) => Math.cos(x),
  sin_2pi:     (x) => Math.sin(2 * Math.PI * x),
  cos_2pi:     (x) => Math.cos(2 * Math.PI * x),
  sin_period7: (x) => Math.sin(2 * Math.PI * x / 7),
  cos_period7: (x) => Math.cos(2 * Math.PI * x / 7),
  exp:         (x) => Math.exp(Math.min(x, 20)),   // clamp to avoid Infinity
  floor10:     (x) => Math.floor(x / 10) * 10,
  step:        (x) => x >= 0 ? 1 : 0,
}

export const BINARY_TRANSFORMS: Record<BinaryTransformKey, (a: number, b: number) => number> = {
  multiply: (a, b) => a * b,
  divide:   (a, b) => a / (b === 0 ? 1e-10 : b),
  add:      (a, b) => a + b,
  distance: (a, b) => Math.sqrt(a ** 2 + b ** 2),
}

/**
 * Power-family exponents — used for fuzzy partial-credit scoring.
 * Only transforms that represent x^p for some p are included.
 */
export const POWER_EXPONENTS: Partial<Record<UnaryTransformKey, number>> = {
  identity:   1,
  square:     2,
  cube:       3,
  sqrt:       0.5,
  reciprocal: -1,
}

/** Human-readable descriptions for the admin puzzle list */
export const TRANSFORM_DESCRIPTIONS: Record<UnaryTransformKey, string> = {
  identity:    'x  (no change)',
  square:      'x²',
  cube:        'x³',
  sqrt:        '√x',
  abs:         '|x|',
  log:         'ln(x)',
  log2:        'log₂(x)',
  reciprocal:  '1/x',
  sin:         'sin(x)',
  cos:         'cos(x)',
  sin_2pi:     'sin(2πx)',
  cos_2pi:     'cos(2πx)',
  sin_period7: 'sin(2πx/7)',
  cos_period7: 'cos(2πx/7)',
  exp:         'eˣ',
  floor10:     'floor(x/10)·10',
  step:        '1 if x≥0 else 0',
}

export const ALL_UNARY_KEYS = Object.keys(UNARY_TRANSFORMS) as UnaryTransformKey[]
export const ALL_BINARY_KEYS = Object.keys(BINARY_TRANSFORMS) as BinaryTransformKey[]

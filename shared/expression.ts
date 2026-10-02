/**
 * Formula language shared by the worker (judging) and the frontend (live preview).
 *
 * Players type formulas the way they'd write them on paper:
 *   2x^2 + 3sin(x)      x1/x2      sqrt(x1^2 + x2^2)      4sin(2pi x/7)
 *
 * Grammar (lowest → highest precedence):
 *   sum     := product (('+' | '-') product)*
 *   product := unary (('*' | '/' | <implicit>) unary)*
 *   unary   := ('-' | '+' | '√') unary | power
 *   power   := primary ('^' unary | '²' | '³')?
 *   primary := number | name | name '(' sum ')' | '(' sum ')'
 *
 * Implicit multiplication: "2x", "3sin(x)", "x(x+1)", "2pi x".
 * No DOM or Worker APIs here — this file must run in both.
 */

export type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: 'pi' | 'e' }
  | { type: 'neg'; arg: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { type: 'call'; fn: FnName; arg: Node }

export const FUNCTIONS = {
  sin:   Math.sin,
  cos:   Math.cos,
  tan:   Math.tan,
  exp:   Math.exp,
  ln:    Math.log,
  log:   Math.log,
  log2:  Math.log2,
  log10: Math.log10,
  sqrt:  Math.sqrt,
  abs:   Math.abs,
  floor: Math.floor,
  ceil:  Math.ceil,
  step:  (x: number) => (x >= 0 ? 1 : 0),
} satisfies Record<string, (x: number) => number>

export type FnName = keyof typeof FUNCTIONS

export const MAX_FORMULA_LENGTH = 200
const MAX_NODES = 120

export class FormulaError extends Error {
  constructor(message: string, public pos: number) {
    super(message)
  }
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'name'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number }

/** Unicode look-alikes people paste or type on phones */
const NORMALISE: Record<string, string> = {
  '−': '-', '–': '-', '·': '*', '×': '*', '⋅': '*', '÷': '/', 'π': 'pi',
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = NORMALISE[src[i]] ?? src[i]
    if (/\s/.test(ch)) { i++; continue }

    // π normalises to the two-letter "pi", so handle it before the name branch
    if (ch === 'pi') { tokens.push({ t: 'name', v: 'pi', pos: i }); i++; continue }

    if (/[0-9.]/.test(ch)) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)/)
      if (!m) throw new FormulaError(`Unexpected "${ch}"`, i)
      tokens.push({ t: 'num', v: Number(m[1]), pos: i })
      i += m[1].length
      continue
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const m = src.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/)!
      tokens.push({ t: 'name', v: m[0], pos: i })
      i += m[0].length
      continue
    }

    if ('+-*/^()²³√'.includes(ch)) {
      // "**" is a common way to write powers
      if (ch === '*' && src[i + 1] === '*') { tokens.push({ t: 'op', v: '^', pos: i }); i += 2; continue }
      tokens.push({ t: 'op', v: ch, pos: i })
      i++
      continue
    }

    throw new FormulaError(`"${src[i]}" isn't allowed in a formula`, i)
  }
  tokens.push({ t: 'end', pos: src.length })
  return tokens
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * @param columns  Allowed input names. Pass null to accept any unknown name as
 *                 an input — used when only rendering an already-validated formula.
 */
export function parseFormula(src: string, columns: readonly string[] | null): Node {
  const text = src.replace(/^\s*y\s*=/, '')   // allow a leading "y ="
  if (!text.trim()) throw new FormulaError('Type a formula', 0)
  if (text.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`Keep it under ${MAX_FORMULA_LENGTH} characters`, MAX_FORMULA_LENGTH)
  }

  const tokens = tokenize(text)
  let p = 0
  let nodes = 0
  const peek = () => tokens[p]
  const next = () => tokens[p++]
  const isOp = (v: string) => { const t = peek(); return t.t === 'op' && t.v === v }
  const make = (n: Node): Node => {
    if (++nodes > MAX_NODES) throw new FormulaError('That formula is too long', peek().pos)
    return n
  }
  const startsPrimary = () => {
    const t = peek()
    return t.t === 'num' || t.t === 'name' || (t.t === 'op' && (t.v === '(' || t.v === '√'))
  }

  function sum(): Node {
    let left = product()
    while (isOp('+') || isOp('-')) {
      const op = next() as { v: '+' | '-' }
      left = make({ type: 'bin', op: op.v, left, right: product() })
    }
    return left
  }

  function product(): Node {
    let left = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = next() as { v: '*' | '/' }
        left = make({ type: 'bin', op: op.v, left, right: unary() })
      } else if (startsPrimary()) {
        left = make({ type: 'bin', op: '*', left, right: unary() })
      } else {
        return left
      }
    }
  }

  function unary(): Node {
    if (isOp('-')) { next(); return make({ type: 'neg', arg: unary() }) }
    if (isOp('+')) { next(); return unary() }
    if (isOp('√')) { next(); return make({ type: 'call', fn: 'sqrt', arg: unary() }) }
    return power()
  }

  function power(): Node {
    const base = primary()
    if (isOp('^')) { next(); return make({ type: 'bin', op: '^', left: base, right: unary() }) }
    if (isOp('²')) { next(); return make({ type: 'bin', op: '^', left: base, right: { type: 'num', value: 2 } }) }
    if (isOp('³')) { next(); return make({ type: 'bin', op: '^', left: base, right: { type: 'num', value: 3 } }) }
    return base
  }

  function primary(): Node {
    const t = next()
    if (t.t === 'num') return make({ type: 'num', value: t.v })

    if (t.t === 'op' && t.v === '(') {
      const inner = sum()
      if (!isOp(')')) throw new FormulaError('Missing a closing ")"', peek().pos)
      next()
      return inner
    }

    if (t.t === 'name') {
      const name = t.v
      if (name in FUNCTIONS) {
        if (!isOp('(')) throw new FormulaError(`Put brackets after ${name}, like ${name}(x)`, peek().pos)
        next()
        const arg = sum()
        if (!isOp(')')) throw new FormulaError(`Missing a closing ")" for ${name}(`, peek().pos)
        next()
        return make({ type: 'call', fn: name as FnName, arg })
      }
      if (name === 'pi' || name === 'e') return make({ type: 'const', name })
      if (!columns || columns.includes(name)) return make({ type: 'var', name })
      throw new FormulaError(unknownNameMessage(name, columns), t.pos)
    }

    if (t.t === 'end') throw new FormulaError('The formula ends too early', t.pos)
    throw new FormulaError(`Unexpected "${t.v}"`, t.pos)
  }

  const tree = sum()
  if (peek().t !== 'end') {
    const t = peek() as { v: string; pos: number }
    throw new FormulaError(t.v === ')' ? 'There\'s an extra ")"' : `Unexpected "${t.v}"`, t.pos)
  }
  return tree
}

/** "x1x2" → suggest "x1*x2"; otherwise list what's available */
function unknownNameMessage(name: string, columns: readonly string[]): string {
  const sorted = [...columns].sort((a, b) => b.length - a.length)
  const parts: string[] = []
  let rest = name
  while (rest) {
    const hit = sorted.find((c) => rest.startsWith(c))
    if (!hit) break
    parts.push(hit)
    rest = rest.slice(hit.length)
  }
  if (!rest && parts.length > 1) return `Unknown name "${name}". Did you mean ${parts.join('*')}?`
  return `Unknown name "${name}". Inputs here are: ${columns.join(', ')}`
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

function evalAt(n: Node, columns: Record<string, number[]>, i: number): number {
  switch (n.type) {
    case 'num':   return n.value
    case 'var':   return columns[n.name][i]
    case 'const': return n.name === 'pi' ? Math.PI : Math.E
    case 'neg':   return -evalAt(n.arg, columns, i)
    case 'call':  return FUNCTIONS[n.fn](evalAt(n.arg, columns, i))
    case 'bin': {
      const a = evalAt(n.left, columns, i)
      const b = evalAt(n.right, columns, i)
      switch (n.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return a / b
        case '^': return a ** b
      }
    }
  }
}

/** Value of the formula on every data row (may contain NaN/Infinity). */
export function evaluate(n: Node, columns: Record<string, number[]>): number[] {
  const len = Object.values(columns)[0]?.length ?? 0
  return Array.from({ length: len }, (_, i) => evalAt(n, columns, i))
}

function hasVariables(n: Node): boolean {
  switch (n.type) {
    case 'var':   return true
    case 'num':
    case 'const': return false
    case 'neg':
    case 'call':  return hasVariables(n.arg)
    case 'bin':   return hasVariables(n.left) || hasVariables(n.right)
  }
}

// ─── Term decomposition (for partial credit) ─────────────────────────────────

export interface Term {
  coef: number
  /** The term with its numeric factor removed; null for a constant term */
  shape: Node | null
}

/**
 * Split a formula into a sum of `coefficient × shape` terms:
 *   2x^2 − 3x + 5   →   [2·(x^2), −3·(x), 5·(null)]
 * Used to refit coefficients when deciding whether a wrong answer had the
 * right shape.
 */
export function splitTerms(n: Node): Term[] {
  const out: Term[] = []
  const walk = (node: Node, sign: number) => {
    if (node.type === 'bin' && (node.op === '+' || node.op === '-')) {
      walk(node.left, sign)
      walk(node.right, node.op === '-' ? -sign : sign)
    } else if (node.type === 'neg') {
      walk(node.arg, -sign)
    } else {
      const t = factor(node)
      out.push({ coef: sign * t.coef, shape: t.shape })
    }
  }
  walk(n, 1)
  return out
}

function factor(n: Node): Term {
  if (!hasVariables(n)) return { coef: evalAt(n, {}, 0), shape: null }
  if (n.type === 'neg') {
    const t = factor(n.arg)
    return { coef: -t.coef, shape: t.shape }
  }
  if (n.type === 'bin' && n.op === '*') {
    const a = factor(n.left)
    const b = factor(n.right)
    const shape = a.shape && b.shape
      ? { type: 'bin' as const, op: '*' as const, left: a.shape, right: b.shape }
      : a.shape ?? b.shape
    return { coef: a.coef * b.coef, shape }
  }
  if (n.type === 'bin' && n.op === '/') {
    const a = factor(n.left)
    if (!hasVariables(n.right)) return { coef: a.coef / evalAt(n.right, {}, 0), shape: a.shape }
    return {
      coef: a.coef,
      shape: { type: 'bin', op: '/', left: a.shape ?? { type: 'num', value: 1 }, right: n.right },
    }
  }
  return { coef: 1, shape: n }
}

import type { ReactNode } from 'react'
import { parseFormula, type Node } from '../../../shared/expression'

// ─── Pretty-printing a parsed formula ────────────────────────────────────────

const PREC = { sum: 1, product: 2, neg: 3, power: 4, atom: 5 } as const

function precedence(n: Node): number {
  if (n.type === 'bin') {
    if (n.op === '+' || n.op === '-') return PREC.sum
    if (n.op === '*' || n.op === '/') return PREC.product
    return PREC.power
  }
  if (n.type === 'neg') return PREC.neg
  if (n.type === 'num' && n.value < 0) return PREC.neg
  return PREC.atom
}

function formatNumber(v: number): string {
  return Number(v.toFixed(4)).toString()
}

/** x1 → x₁ */
function Var({ name }: { name: string }) {
  const m = name.match(/^([a-zA-Z]+)(\d+)$/)
  if (m) return <>{m[1]}<sub className="text-[0.65em]">{m[2]}</sub></>
  return <>{name.replace(/_/g, ' ')}</>
}

function wrap(n: Node, min: number): ReactNode {
  const inner = render(n)
  return precedence(n) < min ? <>({inner})</> : inner
}

/** Can `right` be written straight after `left` without a "·"? (2x, 3sin(x), 2πx) */
function juxtaposes(left: Node, right: Node): boolean {
  const rightOk = right.type === 'var' || right.type === 'const' || right.type === 'call'
    || (right.type === 'bin' && right.op === '^' && right.left.type !== 'num')
  if (!rightOk) return false
  // left must read as a coefficient: 2, π, or a chain like 2π
  if (left.type === 'num' || left.type === 'const') return true
  return left.type === 'bin' && left.op === '*' && left.right.type === 'const' && juxtaposes(left.left, left.right)
}

function render(n: Node): ReactNode {
  switch (n.type) {
    case 'num':   return formatNumber(n.value)
    case 'var':   return <Var name={n.name} />
    case 'const': return n.name === 'pi' ? 'π' : 'e'
    case 'neg':   return <>−{wrap(n.arg, PREC.neg)}</>
    case 'call':
      if (n.fn === 'abs') return <>|{render(n.arg)}|</>
      if (n.fn === 'sqrt') return precedence(n.arg) === PREC.atom ? <>√{render(n.arg)}</> : <>√({render(n.arg)})</>
      if (n.fn === 'exp') return <>e<sup>{render(n.arg)}</sup></>
      if (n.fn === 'log2' || n.fn === 'log10') {
        return <>log<sub className="text-[0.65em]">{n.fn.slice(3)}</sub>({render(n.arg)})</>
      }
      return <>{n.fn}({render(n.arg)})</>
    case 'bin':
      switch (n.op) {
        case '+': return <>{wrap(n.left, PREC.sum)} + {wrap(n.right, PREC.sum)}</>
        case '-': return <>{wrap(n.left, PREC.sum)} − {wrap(n.right, PREC.product)}</>
        case '*': {
          const l = wrap(n.left, PREC.product)
          const r = wrap(n.right, PREC.neg + 1)
          return juxtaposes(n.left, n.right) ? <>{l}{r}</> : <>{l}·{r}</>
        }
        case '/': return <>{wrap(n.left, PREC.product)}/{wrap(n.right, PREC.power)}</>
        case '^': return <>{wrap(n.left, PREC.atom)}<sup>{render(n.right)}</sup></>
      }
  }
}

/** Renders a typed formula as maths. Falls back to the raw text if it can't be parsed. */
export function Formula({ expr, className = '' }: { expr: string; className?: string }) {
  let body: ReactNode
  try {
    body = render(parseFormula(expr, null))
  } catch {
    body = expr
  }
  return (
    <span className={`whitespace-normal ${className}`}>
      <span className="text-ink-3">y = </span>
      {body}
    </span>
  )
}

export function FormulaNode({ node }: { node: Node }) {
  return <>{render(node)}</>
}

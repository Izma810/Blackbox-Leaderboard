// Reads formulas like "x^2 + 3sin(x)" without eval: tokenize, parse into a tree, walk the tree.

// Errors here are the player's fault (a typo), so the Game turns them into status 400.
export class FormulaError extends Error {}

const MAX_LENGTH = 200;
const MAX_NODES = 200;
const SAMPLE_COUNT = 200;
const SAMPLE_SEED = 20261001;
const MIN_VALID_VALUES = 30;

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  log: Math.log, // log and ln are both the natural log
  ln: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

// ---------- Tokens ----------

type Token =
  | { kind: "number"; value: number; text: string }
  | { kind: "name"; text: string }
  | { kind: "symbol"; text: string };

const SYMBOLS = "+-*/^()";

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function isNameStart(c: string): boolean {
  return (c >= "a" && c <= "z") || c === "_";
}

function isNamePart(c: string | undefined): boolean {
  return c !== undefined && (isNameStart(c) || isDigit(c));
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (isDigit(c) || c === ".") {
      let end = i;
      while (isDigit(text[end]) || text[end] === ".") end++;
      // Scientific notation only counts when a digit follows, so "2e" stays "2 times e".
      if (text[end] === "e") {
        if (isDigit(text[end + 1])) {
          end += 1;
        } else if ((text[end + 1] === "+" || text[end + 1] === "-") && isDigit(text[end + 2])) {
          end += 2;
        }
        while (end > i && isDigit(text[end])) end++;
      }
      const t = text.slice(i, end);
      const value = Number(t);
      if (Number.isNaN(value)) throw new FormulaError(`"${t}" is not a valid number.`);
      tokens.push({ kind: "number", value, text: t });
      i = end;
    } else if (isNameStart(c)) {
      let end = i;
      while (isNamePart(text[end])) end++;
      tokens.push({ kind: "name", text: text.slice(i, end) });
      i = end;
    } else if (SYMBOLS.includes(c)) {
      tokens.push({ kind: "symbol", text: c });
      i++;
    } else {
      throw new FormulaError(`The character "${c}" isn't allowed in a formula.`);
    }
  }
  return tokens;
}

// ---------- Tree ----------

type Node =
  | { kind: "number"; value: number }
  | { kind: "input"; index: number } // 0-based position in the inputs list
  | { kind: "negate"; arg: Node }
  | { kind: "call"; fn: (v: number) => number; arg: Node }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node };

// Recursive descent parser. Each method matches one line of the grammar in CLAUDE.md.
class Parser {
  private pos = 0;
  private nodeCount = 0;

  constructor(private tokens: Token[], private numInputs: number) {}

  parse(): Node {
    const tree = this.expr();
    const leftover = this.peek();
    if (leftover) {
      if (leftover.text === ")") throw new FormulaError("There's a ) without a matching (.");
      throw new FormulaError(`Unexpected "${leftover.text}" in the formula.`);
    }
    return tree;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isSymbol(text: string): boolean {
    const t = this.peek();
    return t !== undefined && t.kind === "symbol" && t.text === text;
  }

  // Counts every node so huge formulas can't slow the server down.
  private make(node: Node): Node {
    this.nodeCount++;
    if (this.nodeCount > MAX_NODES) throw new FormulaError("The formula is too long.");
    return node;
  }

  // expr := term (('+' | '-') term)*
  private expr(): Node {
    let left = this.term();
    while (this.isSymbol("+") || this.isSymbol("-")) {
      const op = this.tokens[this.pos++].text as "+" | "-";
      const right = this.term();
      left = this.make({ kind: "binary", op, left, right });
    }
    return left;
  }

  // term := unary (('*' | '/') unary | <implicit *> unary)*
  private term(): Node {
    let left = this.unary();
    for (;;) {
      if (this.isSymbol("*") || this.isSymbol("/")) {
        const op = this.tokens[this.pos++].text as "*" | "/";
        const right = this.unary();
        left = this.make({ kind: "binary", op, left, right });
      } else if (this.startsImplicitProduct()) {
        const right = this.unary();
        left = this.make({ kind: "binary", op: "*", left, right });
      } else {
        return left;
      }
    }
  }

  // "2x", "3sin(x)" and "(x+1)(x-1)" mean multiplication.
  private startsImplicitProduct(): boolean {
    const t = this.peek();
    if (!t) return false;
    return t.kind === "number" || t.kind === "name" || (t.kind === "symbol" && t.text === "(");
  }

  // unary := '-' unary | '+' unary | power
  private unary(): Node {
    if (this.isSymbol("-")) {
      this.pos++;
      return this.make({ kind: "negate", arg: this.unary() });
    }
    if (this.isSymbol("+")) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  // power := primary ('^' unary)?   so -x^2 = -(x^2) and 2^3^2 = 2^(3^2)
  private power(): Node {
    const base = this.primary();
    if (this.isSymbol("^")) {
      this.pos++;
      const exponent = this.unary();
      return this.make({ kind: "binary", op: "^", left: base, right: exponent });
    }
    return base;
  }

  // primary := number | '(' expr ')' | func '(' expr ')' | constant | variable
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaError("The formula ends too early.");
    this.pos++;

    if (t.kind === "number") return this.make({ kind: "number", value: t.value });

    if (t.kind === "symbol") {
      if (t.text === "(") {
        const inside = this.expr();
        if (!this.isSymbol(")")) throw new FormulaError("A bracket is missing its closing ).");
        this.pos++;
        return inside;
      }
      if (t.text === ")") throw new FormulaError("There's a ) without a matching (.");
      throw new FormulaError(`Unexpected "${t.text}" in the formula.`);
    }

    const name = t.text;
    // Object.hasOwn, not `in`, so names like "constructor" aren't mistaken for functions.
    if (Object.hasOwn(FUNCTIONS, name)) {
      const fn = FUNCTIONS[name];
      if (!this.isSymbol("(")) throw new FormulaError(`Write ${name} with brackets, like ${name}(x).`);
      this.pos++;
      const arg = this.expr();
      if (!this.isSymbol(")")) throw new FormulaError(`${name}( is missing its closing ).`);
      this.pos++;
      return this.make({ kind: "call", fn, arg });
    }
    if (Object.hasOwn(CONSTANTS, name)) return this.make({ kind: "number", value: CONSTANTS[name] });
    if (name === "x") return this.make({ kind: "input", index: 0 });

    const match = /^x(\d+)$/.exec(name);
    if (match) {
      const n = Number(match[1]);
      if (n >= 1 && n <= this.numInputs) return this.make({ kind: "input", index: n - 1 });
      if (this.numInputs === 1) {
        throw new FormulaError(`This game has one input. Use x (or x1), not ${name}.`);
      }
      throw new FormulaError(`This game has inputs x1 to x${this.numInputs}; ${name} doesn't exist.`);
    }
    throw new FormulaError(`"${name}" isn't a known input, function or constant.`);
  }
}

function evaluate(node: Node, inputs: number[]): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "input":
      return inputs[node.index];
    case "negate":
      return -evaluate(node.arg, inputs);
    case "call":
      return node.fn(evaluate(node.arg, inputs));
    case "binary": {
      const a = evaluate(node.left, inputs);
      const b = evaluate(node.right, inputs);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (node.op === "/") return a / b;
      return Math.pow(a, b);
    }
  }
}

// ---------- Public API ----------

export function compileFormula(text: string, numInputs: number): (inputs: number[]) => number {
  const cleaned = text.trim().toLowerCase().replaceAll("**", "^");
  if (cleaned.length > MAX_LENGTH) throw new FormulaError("Keep formulas under 200 characters.");
  if (cleaned === "") throw new FormulaError("Type a formula first.");
  const tree = new Parser(tokenize(cleaned), numInputs).parse();
  return (inputs) => evaluate(tree, inputs);
}

// Same seed every time, so every formula is tested on exactly the same inputs.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleValues(
  formula: (inputs: number[]) => number,
  numInputs: number,
  min: number,
  max: number,
): (number | null)[] {
  const random = seededRandom(SAMPLE_SEED);
  const values: (number | null)[] = [];
  for (let s = 0; s < SAMPLE_COUNT; s++) {
    const inputs: number[] = [];
    for (let i = 0; i < numInputs; i++) inputs.push(min + random() * (max - min));
    const y = formula(inputs);
    values.push(Number.isFinite(y) ? y : null); // NaN and Infinity can't be compared, so drop them
  }
  return values;
}

export function checkUsable(values: (number | null)[]): void {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < MIN_VALID_VALUES) {
    throw new FormulaError(
      "This formula gives no valid value for most inputs (e.g. log or sqrt of negatives).",
    );
  }
  const first = valid[0];
  if (valid.every((v) => Math.abs(v - first) <= 1e-12)) {
    throw new FormulaError("This formula gives the same value for every input, so it can't be a feature.");
  }
}

// Pearson correlation on the inputs where both formulas give a value.
// Scaling or shifting a formula doesn't change it, which is why x^2 and 5x^2+7 match.
export function similarity(a: (number | null)[], b: (number | null)[]): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i];
    const y = b[i];
    if (x !== null && y !== null) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < MIN_VALID_VALUES) return null;

  const meanX = xs.reduce((sum, v) => sum + v, 0) / xs.length;
  const meanY = ys.reduce((sum, v) => sum + v, 0) / ys.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

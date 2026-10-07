/**
 * Image-puzzle answers are compared by what they do to the pictures, not by how the
 * list is written. Two pipelines that give identical output pictures are the same
 * answer: they are duplicates of each other, and if one is right so is the other
 * (for example, an order that swaps two steps that commute).
 *
 * The groups come from imageEquivalence.generated.ts, built by running the CLI's
 * own transforms (see scripts/gen_image_equivalence.py).
 */
import { TRANSFORM_ORDER, EQUIVALENT_PIPELINES } from './imageEquivalence.generated'
import type { ImagePuzzleDef } from './imagePuzzles'

const LETTER = new Map<string, string>(TRANSFORM_ORDER.map((name, i) => [name, String.fromCharCode(97 + i)]))

/** puzzleId → (pipeline code → the one code that stands for its whole group) */
const CANONICAL = new Map<string, Map<string, string>>()
for (const [puzzleId, groups] of Object.entries(EQUIVALENT_PIPELINES)) {
  const canonical = new Map<string, string>()
  for (const group of groups) {
    const representative = [...group].sort()[0]
    for (const code of group) canonical.set(code, representative)
  }
  CANONICAL.set(puzzleId, canonical)
}

/** One letter per transform, in order. null if any name isn't a known transform. */
function codeOf(filters: string[]): string | null {
  let code = ''
  for (const name of filters) {
    const letter = LETTER.get(name)
    if (!letter) return null
    code += letter
  }
  return code
}

/**
 * Same key for every pipeline that gives the same output pictures on this puzzle.
 * Pipelines that match nothing else are their own key. null for an unknown transform.
 */
export function answerKey(puzzleId: string, filters: string[]): string | null {
  const code = codeOf(filters)
  if (code === null) return null
  return CANONICAL.get(puzzleId)?.get(code) ?? code
}

/** True if the pipeline reproduces the puzzle's correct output, in whatever order. */
export function isCorrectImageAnswer(puzzle: ImagePuzzleDef, filters: string[]): boolean {
  const mine = answerKey(puzzle.id, filters)
  return mine !== null && mine === answerKey(puzzle.id, puzzle.correctPipeline)
}

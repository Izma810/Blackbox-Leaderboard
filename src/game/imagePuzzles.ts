/**
 * Image puzzle definitions — exact match to blackbox-ml-game/src/blackbox_game/puzzles.py.
 *
 * Multi-image puzzles show several input/output pairs, all demonstrating the
 * same transform. Teams submit one transform (or ordered pipeline) for the batch.
 */
import type { BatchId } from '../types'

export interface ImagePuzzleDef {
  id:             string
  title:          string
  description:    string
  batchId:        BatchId
  /** One or more curated source image names (public/images/<name>.png). */
  imageNames:     string[]
  /** Ordered transform pipeline (one or several steps). */
  correctPipeline: string[]
  /** true = every ordering of the pipeline steps gives identical pixels. */
  isCommutative:  boolean
  /** Max filters the player may select (= correctPipeline.length). */
  maxFilters:     number
}

// Description shown for all image puzzles — kept neutral on purpose.
const DESC = 'Work out what was done to each input picture to make its output picture.'

export const IMAGE_PUZZLES: ImagePuzzleDef[] = [
  // ── Single transforms ─────────────────────────────────────────────────────

  {
    id:              'puzzle_11',
    title:           'Puzzle 11',
    description:     DESC,
    batchId:         'image',
    imageNames:      ['lsd', 'checkmate'],
    correctPipeline: ['rotate_chunks'],
    isCommutative:   true,
    maxFilters:      1,
  },
  {
    id:              'puzzle_12',
    title:           'Puzzle 12',
    description:     DESC,
    batchId:         'image',
    imageNames:      ['moon', 'molecule'],
    correctPipeline: ['mirror_sum'],
    isCommutative:   true,
    maxFilters:      1,
  },
  {
    id:              'puzzle_13',
    title:           'Puzzle 13',
    description:     DESC,
    batchId:         'image',
    imageNames:      ['matrix'],
    correctPipeline: ['circular_shift'],
    isCommutative:   true,
    maxFilters:      1,
  },
  {
    id:              'puzzle_14',
    title:           'Puzzle 14',
    description:     DESC,
    batchId:         'image',
    imageNames:      ['marbles', 'monet'],
    correctPipeline: ['swap_rgb_rbg'],
    isCommutative:   true,
    maxFilters:      1,
  },

  // ── Pipelines ─────────────────────────────────────────────────────────────

  {
    id:              'puzzle_15',
    title:           'Puzzle 15',
    description:     DESC + ' Two transforms were applied. Order matters here.',
    batchId:         'image',
    imageNames:      ['matrix'],
    correctPipeline: ['ghost_echo', 'solarise'],
    isCommutative:   false,
    maxFilters:      2,
  },
  {
    id:              'puzzle_16',
    title:           'Puzzle 16',
    description:     DESC + ' Three transforms were applied. The order does not matter for these three.',
    batchId:         'image',
    imageNames:      ['doctor_strange'],
    correctPipeline: ['stretch_horizontal', 'posterise', 'swap_rgb_bgr'],
    isCommutative:   true,
    maxFilters:      3,
  },
  {
    id:              'puzzle_17',
    title:           'Puzzle 17',
    description:     DESC + ' Three transforms were applied. Order matters.',
    batchId:         'image',
    imageNames:      ['pexels'],
    correctPipeline: ['invert', 'circular_shift', 'rotate_chunks'],
    isCommutative:   false,
    maxFilters:      3,
  },
]

export const IMAGE_PUZZLE_MAP = new Map<string, ImagePuzzleDef>(
  IMAGE_PUZZLES.map((p) => [p.id, p]),
)

export const IMAGE_PUZZLES_BY_BATCH: Partial<Record<BatchId, ImagePuzzleDef[]>> = {
  image: IMAGE_PUZZLES,
}

export function getImagePuzzleInfo(p: ImagePuzzleDef) {
  return {
    puzzleType:    'image' as const,
    id:            p.id,
    title:         p.title,
    description:   p.description,
    batchId:       p.batchId,
    imageNames:    p.imageNames,
    maxFilters:    p.maxFilters,
    isCommutative: p.isCommutative,
  }
}

export function getImagePuzzleForPlayers(p: ImagePuzzleDef) {
  return getImagePuzzleInfo(p)
}

export const ALL_TRANSFORM_NAMES = [
  'rotate_chunks', 'mirror_sum', 'circular_shift', 'swap_rgb_rbg',
  'swap_rgb_bgr', 'invert', 'solarise', 'posterise',
  'opacity', 'vignette', 'ghost_echo', 'stretch_horizontal',
] as const

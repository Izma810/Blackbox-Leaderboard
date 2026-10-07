import { Hono } from 'hono'
import type { Env } from '../types'
import { verifyToken } from '../lib/crypto'
import { SECRET } from './auth'

const game = new Hono<{ Bindings: Env }>()

// ─── Auth middleware ──────────────────────────────────────────────────────────

async function getTeamId(c: { req: { header: (h: string) => string | undefined }; env: Env }): Promise<string | null> {
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  return verifyToken(token, SECRET(c.env))
}

// ─── Forward to Durable Object ────────────────────────────────────────────────

function routeToDO(env: Env, action: string, payload: unknown): Promise<Response> {
  const doId = env.GAME_ROOM.idFromName('main')
  const stub = env.GAME_ROOM.get(doId)
  return stub.fetch(new Request(`https://do-internal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

// ─── POST /api/submit ─────────────────────────────────────────────────────────

game.post('/submit', async (c) => {
  const teamId = await getTeamId(c)
  if (!teamId) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json<{ puzzleId: string; expr: string }>().catch(() => null)
  if (!body?.puzzleId || typeof body.expr !== 'string') {
    return c.json({ error: 'Missing puzzleId or expr' }, 400)
  }

  return routeToDO(c.env, 'submit', { teamId, puzzleId: body.puzzleId, expr: body.expr })
})

// ─── POST /api/vote ───────────────────────────────────────────────────────────

game.post('/vote', async (c) => {
  const teamId = await getTeamId(c)
  if (!teamId) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json<{ submissionId: string; voteType: 'up' | 'down' }>().catch(() => null)
  if (!body?.submissionId || !body.voteType) {
    return c.json({ error: 'Missing submissionId or voteType' }, 400)
  }

  return routeToDO(c.env, 'vote', { teamId, submissionId: body.submissionId, voteType: body.voteType })
})

// ─── POST /api/hint ───────────────────────────────────────────────────────────

game.post('/hint', async (c) => {
  const teamId = await getTeamId(c)
  if (!teamId) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json<{ puzzleId: string }>().catch(() => null)
  if (!body?.puzzleId) return c.json({ error: 'Missing puzzleId' }, 400)

  return routeToDO(c.env, 'hint', { teamId, puzzleId: body.puzzleId })
})

// ─── GET /api/puzzles/:id ─────────────────────────────────────────────────────
// Returns full puzzle data (X, y) + submissions for the puzzle.
// Only served for puzzles in open or settled batches.

game.get('/puzzles/:id', async (c) => {
  const teamId = await getTeamId(c)
  if (!teamId) return c.json({ error: 'Unauthorized' }, 401)

  const puzzleId = c.req.param('id')
  const { PUZZLE_MAP, getPuzzleForPlayers } = await import('../game/puzzles')
  const { IMAGE_PUZZLE_MAP, getImagePuzzleForPlayers } = await import('../game/imagePuzzles')

  const puzzle      = PUZZLE_MAP.get(puzzleId)
  const imagePuzzle = IMAGE_PUZZLE_MAP.get(puzzleId)
  if (!puzzle && !imagePuzzle) return c.json({ error: 'Puzzle not found' }, 404)

  const batchId = puzzle?.batchId ?? imagePuzzle!.batchId
  const batch = await c.env.DB
    .prepare('SELECT status, submissions_open, voting_open FROM batches WHERE id = ?')
    .bind(batchId).first<{ status: string; submissions_open: number; voting_open: number }>()
  if (!batch || batch.status === 'hidden') {
    return c.json({ error: 'Puzzle not available yet' }, 403)
  }

  const { getSubmissionsForPuzzle, getTeamVotesForPuzzle, getHintsBought, buildPublicSubmission } = await import('../db/d1')
  const settled = batch.status === 'settled'
  const cfg = await c.env.DB
    .prepare('SELECT anonymous_voting FROM game_config WHERE id = 1')
    .first<{ anonymous_voting: number }>()
  const anonymous = cfg?.anonymous_voting === 1

  const [submissionRows, myVotes] = await Promise.all([
    getSubmissionsForPuzzle(c.env.DB, puzzleId),
    getTeamVotesForPuzzle(c.env.DB, puzzleId, teamId),
  ])
  const submissions = submissionRows.map((row, i) => buildPublicSubmission(row, anonymous, i, settled))

  // ── Image puzzle ───────────────────────────────────────────────────────────
  if (imagePuzzle) {
    const response: Record<string, unknown> = {
      puzzle: getImagePuzzleForPlayers(imagePuzzle),
      submissions,
      myVotes,
      submissionsOpen: !settled && batch.submissions_open === 1,
      votingOpen:      !settled && batch.voting_open === 1,
    }
    if (settled) response.solution = imagePuzzle.correctPipeline
    return c.json(response)
  }

  // ── Numerical puzzle ───────────────────────────────────────────────────────
  const hintsBought = await getHintsBought(c.env.DB, puzzleId, teamId)
  const myHints     = puzzle!.hints.slice(0, hintsBought)

  const response: Record<string, unknown> = {
    puzzle: getPuzzleForPlayers(puzzle!),
    submissions,
    myVotes,
    myHints,
    submissionsOpen: !settled && batch.submissions_open === 1,
    votingOpen:      !settled && batch.voting_open === 1,
  }
  if (settled) response.solution = puzzle!.solution

  return c.json(response)
})

// ─── GET /api/leaderboard ─────────────────────────────────────────────────────

game.get('/leaderboard', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT id, name, wallet, total_score FROM teams ORDER BY wallet DESC, total_score DESC')
    .all<{ id: string; name: string; wallet: number; total_score: number }>()

  const leaderboard = rows.results.map((r, i) => ({
    rank:       i + 1,
    teamId:     r.id,
    teamName:   r.name,
    wallet:     r.wallet,
    totalScore: r.total_score,
  }))

  return c.json({ leaderboard })
})

export { game as gameRouter }

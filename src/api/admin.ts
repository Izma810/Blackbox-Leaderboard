import { Hono } from 'hono'
import type { Env, BatchId } from '../types'
import { PUZZLES_BY_BATCH, PUZZLE_MAP, getPuzzleInfo } from '../game/puzzles'
import { IMAGE_PUZZLES_BY_BATCH, IMAGE_PUZZLE_MAP, getImagePuzzleInfo } from '../game/imagePuzzles'
import { getConfig, getAllTeams, getAllBatches, getSubmissionsForBatch } from '../db/d1'

const admin = new Hono<{ Bindings: Env }>()

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function isMaster(env: Env, authHeader: string | undefined): boolean {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim()
  return token.length > 0 && token === env.ADMIN_PASSWORD
}

function requireAdmin(env: Env, authHeader: string | undefined): Response | null {
  if (!isMaster(env, authHeader)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

function routeToDO(env: Env, action: string, payload: unknown = {}, method = 'POST'): Promise<Response> {
  const doId = env.GAME_ROOM.idFromName('main')
  const stub = env.GAME_ROOM.get(doId)
  return stub.fetch(new Request(`https://do-internal/admin/${action}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

// ─── POST /api/admin/auth ─────────────────────────────────────────────────────

admin.post('/auth', async (c) => {
  const body = await c.req.json<{ password: string }>().catch(() => null)
  if (!body?.password) return c.json({ error: 'Password required' }, 400)
  if (body.password !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Invalid password' }, 401)
  return c.json({ ok: true })
})

// ─── GET /api/admin/state ─────────────────────────────────────────────────────

admin.get('/state', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny

  const puzzlesByBatch: Record<string, ReturnType<typeof getPuzzleInfo>[]> = {}
  for (const [batchId, puzzles] of Object.entries(PUZZLES_BY_BATCH)) {
    puzzlesByBatch[batchId] = puzzles.map(getPuzzleInfo)
  }
  // Add image puzzles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(puzzlesByBatch as any)['image'] = (IMAGE_PUZZLES_BY_BATCH['image'] ?? []).map(getImagePuzzleInfo)

  const [config, teams, batches] = await Promise.all([
    getConfig(c.env.DB),
    getAllTeams(c.env.DB),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAllBatches(c.env.DB, puzzlesByBatch as any),
  ])

  // Admin gets entry numbers too — fetch them separately
  const memberRows = await c.env.DB
    .prepare('SELECT team_id, name, entry_number, hostel, slot FROM team_members ORDER BY team_id, slot')
    .all<{ team_id: string; name: string; entry_number: string; hostel: string; slot: number }>()

  const membersByTeam = new Map<string, typeof memberRows.results>()
  for (const m of memberRows.results) {
    if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, [])
    membersByTeam.get(m.team_id)!.push(m)
  }

  const resetRows = await c.env.DB
    .prepare('SELECT id FROM teams WHERE token_hash IS NULL').all<{ id: string }>()
  const awaitingReclaim = new Set(resetRows.results.map((r) => r.id))

  const countsRow = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM teams) AS teams,
      (SELECT COUNT(*) FROM submissions) AS submissions,
      (SELECT COUNT(*) FROM votes) AS votes,
      (SELECT COUNT(*) FROM wallet_transactions WHERE type = 'hint') AS hints
  `).first<{ teams: number; submissions: number; votes: number; hints: number }>()

  type RoomObs = {
    sockets: number; connectedTeams: number; connectedTeamIds: string[]
    queuedActions: number; hotLoaded: boolean
  }
  let room: RoomObs = {
    sockets: 0, connectedTeams: 0, connectedTeamIds: [], queuedActions: 0, hotLoaded: false,
  }
  try {
    const obsRes = await routeToDO(c.env, 'obs', {})
    if (obsRes.ok) room = await obsRes.json() as RoomObs
  } catch { /* room metrics stay zero */ }

  const live = new Set(room.connectedTeamIds)
  const teamsAdmin = teams.map((t) => ({
    ...t,
    isConnected: live.has(t.id),
    awaitingReclaim: awaitingReclaim.has(t.id),
    membersAdmin: (membersByTeam.get(t.id) ?? []).map((m) => ({
      name: m.name, entryNumber: m.entry_number, hostel: m.hostel, slot: m.slot,
    })),
  }))

  // Per-batch puzzle submissions (with solutions for admin)
  const puzzleData: Record<string, { solution: string | string[]; hints: string[]; submissions: unknown[] }> = {}

  // Numerical puzzles
  for (const [batchId, puzzles] of Object.entries(PUZZLES_BY_BATCH)) {
    const batchRows = await getSubmissionsForBatch(c.env.DB, batchId as BatchId)
    for (const p of puzzles) {
      const puzzle = PUZZLE_MAP.get(p.id)!
      const subs = batchRows.filter((r) => r.puzzle_id === p.id).map((r) => ({
        id: r.id, teamId: r.team_id, teamName: r.team_name, expr: r.expr,
        stake: r.stake, r2Score: r.r2_score, verdict: r.verdict,
        ups: r.ups ?? 0, downs: r.downs ?? 0, submittedAt: r.submitted_at,
      }))
      puzzleData[p.id] = { solution: puzzle.solution, hints: puzzle.hints, submissions: subs }
    }
  }

  // Image puzzles
  const imageBatchRows = await getSubmissionsForBatch(c.env.DB, 'image')
  for (const p of IMAGE_PUZZLES_BY_BATCH['image'] ?? []) {
    const puzzle = IMAGE_PUZZLE_MAP.get(p.id)!
    const subs = imageBatchRows.filter((r) => r.puzzle_id === p.id).map((r) => ({
      id: r.id, teamId: r.team_id, teamName: r.team_name, expr: r.expr,
      stake: r.stake, verdict: r.verdict,
      ups: r.ups ?? 0, downs: r.downs ?? 0, submittedAt: r.submitted_at,
    }))
    puzzleData[p.id] = { solution: puzzle.correctPipeline, hints: [], submissions: subs }
  }

  return c.json({
    config, teams: teamsAdmin, batches, puzzleData,
    obs: {
      sockets:         room.sockets,
      connectedTeams:  room.connectedTeams,
      queuedActions:   room.queuedActions,
      hotLoaded:       room.hotLoaded,
      teams:           countsRow?.teams ?? teamsAdmin.length,
      submissions:     countsRow?.submissions ?? 0,
      votes:           countsRow?.votes ?? 0,
      hints:           countsRow?.hints ?? 0,
    },
  })
})

// ─── PATCH /api/admin/config ──────────────────────────────────────────────────

admin.patch('/config', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  const body = await c.req.json().catch(() => ({}))
  return routeToDO(c.env, 'config', body, 'PATCH')
})

// ─── Batch actions ────────────────────────────────────────────────────────────

admin.post('/batches/:id/open', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'open-batch', { batchId: c.req.param('id') })
})

admin.patch('/batches/:id', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  const body = await c.req.json().catch(() => ({}))
  return routeToDO(c.env, 'update-batch', { batchId: c.req.param('id'), ...body }, 'PATCH')
})

admin.post('/batches/:id/settle', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'settle-batch', { batchId: c.req.param('id') })
})

admin.post('/batches/:id/reopen', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'reopen-batch', { batchId: c.req.param('id') })
})

// ─── End game ─────────────────────────────────────────────────────────────────

admin.post('/end-game', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'end-game', {})
})

// ─── Reset game ───────────────────────────────────────────────────────────────

admin.post('/reset', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'reset', {})
})

// ─── Team management ──────────────────────────────────────────────────────────

admin.delete('/teams/:id', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'remove-team', { teamId: c.req.param('id') })
})

// For a team that lost its login on both laptops, or whose link leaked: signs out
// every laptop holding the old token, then the team claims it back from the home page.
admin.post('/teams/:id/reset-login', async (c) => {
  const deny = requireAdmin(c.env, c.req.header('Authorization'))
  if (deny) return deny
  return routeToDO(c.env, 'reset-login', { teamId: c.req.param('id') })
})

export { admin as adminRouter }

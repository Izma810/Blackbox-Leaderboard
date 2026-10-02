/**
 * Admin-only routes.
 *
 * Two-layer auth:
 *  1. Master password (ADMIN_PASSWORD env var) — required for all admin routes.
 *     Sent as:  Authorization: Bearer <ADMIN_PASSWORD>
 *  2. Per-room admin token — kept for backwards compat; also accepted on room routes.
 *     The master password is always accepted in place of a room token too.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { PUZZLES, getPuzzleInfo, PUZZLE_MAP } from '../game/puzzles'

const admin = new Hono<{ Bindings: Env }>()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBearerToken(authHeader: string | undefined): string {
  return (authHeader ?? '').replace(/^Bearer\s+/i, '').trim()
}

/** Verify master password from Authorization header. */
function isMasterAuth(env: Env, authHeader: string | undefined): boolean {
  const token = getBearerToken(authHeader)
  return token.length > 0 && token === env.ADMIN_PASSWORD
}

/**
 * Verify access to a specific room.
 * Accepts either the master password OR the room-specific admin token.
 */
async function canAccessRoom(
  env: Env,
  roomId: string,
  authHeader: string | undefined,
): Promise<boolean> {
  const token = getBearerToken(authHeader)
  if (!token) return false

  // Master password grants access to every room
  if (token === env.ADMIN_PASSWORD) return true

  // Per-room token fallback
  const row = await env.DB
    .prepare('SELECT id FROM rooms WHERE id = ? AND admin_token = ?')
    .bind(roomId, token)
    .first()
  return row !== null
}

// ─── POST /api/admin/auth ─────────────────────────────────────────────────────
// Validates the master password. Called by the frontend login form.

admin.post('/admin/auth', async (c) => {
  const body = await c.req.json<{ password: string }>().catch(() => null)
  if (!body?.password) return c.json({ error: 'Password required' }, 400)

  if (body.password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401)
  }

  return c.json({ ok: true })
})

// ─── GET /api/admin/puzzles ───────────────────────────────────────────────────
// Public metadata — no auth needed (descriptions only, no solutions).

admin.get('/admin/puzzles', (c) => {
  return c.json({ puzzles: PUZZLES.map(getPuzzleInfo) })
})

// ─── All room admin routes require master-password or room token ──────────────

// GET /api/rooms/:id/admin/state
admin.get('/rooms/:id/admin/state', async (c) => {
  const roomId = c.req.param('id')
  if (!await canAccessRoom(c.env, roomId, c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const doId = c.env.GAME_ROOM.idFromName(roomId)
  const stub = c.env.GAME_ROOM.get(doId)
  const res   = await stub.fetch(
    new Request(`https://do-internal/state?roomId=${roomId}`, {
      headers: { 'X-Room-Id': roomId },
    }),
  )
  const state = await res.json() as Record<string, unknown>

  // Attach the correct answer for the current round (admin only)
  const round = state.currentRound as { puzzleId?: string } | null
  let correctAnswer = null
  if (round?.puzzleId) {
    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    if (puzzle) {
      correctAnswer = { solution: puzzle.solution, hints: puzzle.hints }
    }
  }

  return c.json({ ...state, correctAnswer })
})

// PATCH /api/rooms/:id/admin/config
admin.patch('/rooms/:id/admin/config', async (c) => {
  const roomId = c.req.param('id')
  if (!await canAccessRoom(c.env, roomId, c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json().catch(() => ({}))
  return routeToDO(c.env, roomId, 'config', body, 'PATCH')
})

// POST /api/rooms/:id/admin/start-round
admin.post('/rooms/:id/admin/start-round', async (c) => {
  const roomId = c.req.param('id')
  if (!await canAccessRoom(c.env, roomId, c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json<{ puzzleId: string }>().catch(() => null)
  if (!body?.puzzleId) return c.json({ error: 'Missing puzzleId' }, 400)

  return routeToDO(c.env, roomId, 'start-round', { puzzleId: body.puzzleId })
})

// POST /api/rooms/:id/admin/advance-phase
admin.post('/rooms/:id/admin/advance-phase', async (c) => {
  const roomId = c.req.param('id')
  if (!await canAccessRoom(c.env, roomId, c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return routeToDO(c.env, roomId, 'advance-phase', {})
})

// POST /api/rooms/:id/admin/end-game
admin.post('/rooms/:id/admin/end-game', async (c) => {
  const roomId = c.req.param('id')
  if (!await canAccessRoom(c.env, roomId, c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return routeToDO(c.env, roomId, 'end-game', {})
})

// ─── DO proxy helper ─────────────────────────────────────────────────────────

async function routeToDO(
  env: Env,
  roomId: string,
  action: string,
  payload: unknown = {},
  method = 'POST',
): Promise<Response> {
  const doId = env.GAME_ROOM.idFromName(roomId)
  const stub = env.GAME_ROOM.get(doId)
  return stub.fetch(
    new Request(`https://do-internal/admin/${action}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Room-Id': roomId },
      body: JSON.stringify(payload),
    }),
  )
}

export { admin as adminRouter }

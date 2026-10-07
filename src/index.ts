import { Hono } from 'hono'
import type { Env } from './types'
import { authRouter } from './api/auth'
import { gameRouter } from './api/game'
import { adminRouter } from './api/admin'
import { getTeamIdByToken } from './db/d1'

export { GameRoomDO } from './durable-objects/GameRoomDO'

const app = new Hono<{ Bindings: Env }>()
const api  = new Hono<{ Bindings: Env }>()

// ─── WebSocket upgrade  GET /api/ws?token=… ───────────────────────────────────
// Browsers can't set headers on a WebSocket handshake, so the token rides in the query.

api.get('/ws', async (c) => {
  const teamId = await getTeamIdByToken(c.env.DB, c.req.query('token'))
  if (!teamId) return c.json({ error: 'This login is not valid any more' }, 401)

  const doId = c.env.GAME_ROOM.idFromName('main')
  const stub = c.env.GAME_ROOM.get(doId)

  // Pass teamId to the DO via header (preserving all WS upgrade headers)
  const headers = new Headers(c.req.raw.headers)
  headers.set('X-Team-Id', teamId)
  return stub.fetch(new Request(c.req.raw.url, { method: 'GET', headers }))
})

// ─── Health check ─────────────────────────────────────────────────────────────

api.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ─── REST routes ──────────────────────────────────────────────────────────────

api.route('/auth',  authRouter)
api.route('/',      gameRouter)
api.route('/admin', adminRouter)

api.notFound((c) => c.json({ error: 'Not found' }, 404))

app.route('/api', api)

app.onError((err, c) => {
  console.error('[Worker error]', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app

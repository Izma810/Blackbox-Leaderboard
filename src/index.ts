import { Hono } from 'hono'
import type { Env } from './types'
import { authRouter } from './api/auth'
import { gameRouter } from './api/game'
import { adminRouter } from './api/admin'
import { verifyToken } from './lib/crypto'

export { GameRoomDO } from './durable-objects/GameRoomDO'

const app = new Hono<{ Bindings: Env }>()
const api  = new Hono<{ Bindings: Env }>()

const SECRET = (env: Env) => env.SESSION_SECRET || 'dev_secret_change_me_in_production'

// ─── WebSocket upgrade  GET /api/ws?token=… ───────────────────────────────────

api.get('/ws', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Missing token' }, 401)

  const teamId = await verifyToken(token, SECRET(c.env))
  if (!teamId) return c.json({ error: 'Invalid or expired token' }, 401)

  const team = await c.env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first()
  if (!team) return c.json({ error: 'Team not found' }, 404)

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

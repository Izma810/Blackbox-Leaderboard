import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { roomsRouter } from './api/rooms'
import { gameRouter } from './api/game'
import { adminRouter } from './api/admin'
import { isPlayerAuthorised } from './db/d1'

// Re-export the Durable Object class — wrangler requires it as a named export
export { GameRoomDO } from './durable-objects/GameRoomDO'

const app = new Hono<{ Bindings: Env }>()

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// ─── WebSocket upgrade ────────────────────────────────────────────────────────
// GET /ws?roomId=X&playerId=Y&token=Z
// Browsers can't set headers on a WebSocket handshake, so the token rides in the query.
app.get('/ws', async (c) => {
  const { roomId, playerId, token } = c.req.query()

  if (!roomId || !playerId) {
    return c.json({ error: 'Missing roomId or playerId query params' }, 400)
  }

  if (!await isPlayerAuthorised(c.env.DB, roomId, playerId, token)) {
    return c.json({ error: 'Not a valid player session for this room' }, 401)
  }

  // Forward the raw request unchanged to the DO.
  // Do NOT reconstruct the Request — recreating it can drop hop-by-hop headers
  // (Upgrade, Connection) which are required for the WebSocket handshake.
  // roomId and playerId are already in the URL's search params so the DO can read them.
  const doId = c.env.GAME_ROOM.idFromName(roomId)
  const stub = c.env.GAME_ROOM.get(doId)
  return stub.fetch(c.req.raw)
})

// ─── REST API routes ──────────────────────────────────────────────────────────
app.route('/api/rooms', roomsRouter)
app.route('/api', gameRouter)
app.route('/api', adminRouter)

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error('[Worker error]', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app

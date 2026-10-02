/**
 * Game action routes: submit and vote.
 * Both are routed to the GameRoomDO for serialization and race-condition safety.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { getRoomById, getPlayerById } from '../db/d1'

const game = new Hono<{ Bindings: Env }>()

// ─── Helper: forward request to the room's DO ─────────────────────────────────

async function routeToDO(
  env: Env,
  roomId: string,
  action: string,
  payload: unknown,
): Promise<Response> {
  const doId = env.GAME_ROOM.idFromName(roomId)
  const stub = env.GAME_ROOM.get(doId)
  return stub.fetch(
    new Request(`https://do-internal/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Room-Id': roomId,
      },
      body: JSON.stringify(payload),
    }),
  )
}

// POST /api/rooms/:id/submit
game.post('/rooms/:id/submit', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json<{ playerId: string; expr: unknown }>().catch(() => null)

  if (!body?.playerId || typeof body.expr !== 'string') {
    return c.json({ error: 'Missing playerId or formula' }, 400)
  }

  // Quick sanity: player belongs to room
  const player = await c.env.DB
    .prepare('SELECT id FROM players WHERE id = ? AND room_id = ?')
    .bind(body.playerId, roomId).first()
  if (!player) return c.json({ error: 'Player not found in this room' }, 404)

  return routeToDO(c.env, roomId, 'submit', {
    playerId: body.playerId,
    expr:     body.expr,
  })
})

// POST /api/rooms/:id/vote
game.post('/rooms/:id/vote', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json<{
    playerId: string
    submissionId: string
    voteType: 'up' | 'down'
  }>().catch(() => null)

  if (!body?.playerId || !body.submissionId || !body.voteType) {
    return c.json({ error: 'Missing required fields: playerId, submissionId, voteType' }, 400)
  }

  const player = await c.env.DB
    .prepare('SELECT id FROM players WHERE id = ? AND room_id = ?')
    .bind(body.playerId, roomId).first()
  if (!player) return c.json({ error: 'Player not found in this room' }, 404)

  return routeToDO(c.env, roomId, 'vote', {
    playerId:     body.playerId,
    submissionId: body.submissionId,
    voteType:     body.voteType,
  })
})

// POST /api/rooms/:id/hint — buy the next hint for the current puzzle
game.post('/rooms/:id/hint', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json<{ playerId: string }>().catch(() => null)
  if (!body?.playerId) return c.json({ error: 'Missing playerId' }, 400)

  const player = await c.env.DB
    .prepare('SELECT id FROM players WHERE id = ? AND room_id = ?')
    .bind(body.playerId, roomId).first()
  if (!player) return c.json({ error: 'Player not found in this room' }, 404)

  return routeToDO(c.env, roomId, 'hint', { playerId: body.playerId })
})

export { game as gameRouter }

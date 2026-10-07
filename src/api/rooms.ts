import { Hono } from 'hono'
import type { Env } from '../types'
import { getRoomById } from '../db/d1'

const rooms = new Hono<{ Bindings: Env }>()

// POST /api/rooms — create a new room (master password required)
rooms.post('/', async (c) => {
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Admin authentication required to create a room' }, 401)
  }

  const body = await c.req.json<{
    name: string
    startingWallet?: number
    phase1Secs?: number
    postStake?: number
    postPayout?: number
    voteStake?: number
    backPayout?: number
    hintCost?: number
    votesPerRound?: number
    anonymousVoting?: boolean
    maxRounds?: number | null
  }>().catch(() => null)

  if (!body?.name?.trim()) {
    return c.json({ error: 'Room name is required' }, 400)
  }

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const adminToken = crypto.randomUUID()

  await c.env.DB.prepare(`
    INSERT INTO rooms (
      id, name, admin_token, status,
      starting_wallet, phase1_secs,
      poster_reward, post_payout, voter_reward, back_payout, hint_cost,
      votes_per_round, anonymous_voting, max_rounds, created_at
    ) VALUES (?, ?, ?, 'lobby', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name.trim(),
    adminToken,
    body.startingWallet ?? 1000,
    body.phase1Secs    ?? 300,
    body.postStake     ?? 100,
    body.postPayout    ?? 100,
    body.voteStake     ?? 50,
    body.backPayout    ?? 120,
    body.hintCost      ?? 40,
    body.votesPerRound ?? 3,
    body.anonymousVoting ? 1 : 0,
    body.maxRounds     ?? null,
    Date.now(),
  ).run()

  return c.json({ id, adminToken }, 201)
})

// POST /api/rooms/:id/join — join a room with a username.
// Rejoining as an existing player requires the token issued when they first joined.
rooms.post('/:id/join', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json<{ username: string; token?: unknown }>().catch(() => null)

  if (!body?.username?.trim()) {
    return c.json({ error: 'Username is required' }, 400)
  }

  const username = body.username.trim().slice(0, 30)

  const room = await getRoomById(c.env.DB, roomId)
  if (!room) return c.json({ error: 'Room not found' }, 404)
  if (room.status === 'finished') return c.json({ error: 'This room has ended' }, 410)

  // Check if username is already taken in this room
  const existing = await c.env.DB
    .prepare('SELECT id, token FROM players WHERE room_id = ? AND username = ?')
    .bind(roomId, username)
    .first<{ id: string; token: string | null }>()

  if (existing) {
    if (existing.token && body.token === existing.token) {
      return c.json({ playerId: existing.id, token: existing.token, reconnected: true })
    }
    if (existing.token === null) {
      // Joined before tokens existed: the first rejoin claims the name, then it's locked
      const token = crypto.randomUUID()
      const claimed = await c.env.DB
        .prepare('UPDATE players SET token = ? WHERE id = ? AND token IS NULL')
        .bind(token, existing.id).run()
      if (claimed.meta.changes === 1) {
        return c.json({ playerId: existing.id, token, reconnected: true })
      }
    }
    return c.json({ error: 'That name is already taken in this room. Pick another one.' }, 409)
  }

  const playerId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const inserted = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO players (id, room_id, username, wallet, total_score, is_connected, joined_at, token)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  `).bind(playerId, roomId, username, room.config.startingWallet, Date.now(), token).run()

  // Someone else took the name between our SELECT and INSERT
  if (inserted.meta.changes !== 1) {
    return c.json({ error: 'That name is already taken in this room. Pick another one.' }, 409)
  }

  return c.json({ playerId, token, reconnected: false }, 201)
})

// GET /api/rooms/:id — public room snapshot
rooms.get('/:id', async (c) => {
  const roomId = c.req.param('id')
  const room = await getRoomById(c.env.DB, roomId)
  if (!room) return c.json({ error: 'Room not found' }, 404)
  return c.json(room)
})

// GET /api/rooms/:id/leaderboard — final standings
rooms.get('/:id/leaderboard', async (c) => {
  const roomId = c.req.param('id')
  const room = await getRoomById(c.env.DB, roomId)
  if (!room) return c.json({ error: 'Room not found' }, 404)

  const rows = await c.env.DB
    .prepare('SELECT * FROM players WHERE room_id = ? ORDER BY wallet DESC, total_score DESC')
    .bind(roomId)
    .all<Record<string, unknown>>()

  const leaderboard = rows.results.map((r, idx) => ({
    rank:       idx + 1,
    playerId:   r.id,
    username:   r.username,
    wallet:     r.wallet,
    totalScore: r.total_score,
  }))

  return c.json({ leaderboard })
})

export { rooms as roomsRouter }

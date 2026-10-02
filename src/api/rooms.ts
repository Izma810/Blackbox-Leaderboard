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

// POST /api/rooms/:id/join — join a room with a username
rooms.post('/:id/join', async (c) => {
  const roomId = c.req.param('id')
  const body = await c.req.json<{ username: string }>().catch(() => null)

  if (!body?.username?.trim()) {
    return c.json({ error: 'Username is required' }, 400)
  }

  const username = body.username.trim().slice(0, 30)

  const room = await getRoomById(c.env.DB, roomId)
  if (!room) return c.json({ error: 'Room not found' }, 404)
  if (room.status === 'finished') return c.json({ error: 'This room has ended' }, 410)

  // Check if username is already taken in this room
  const existing = await c.env.DB
    .prepare('SELECT id, is_connected FROM players WHERE room_id = ? AND username = ?')
    .bind(roomId, username)
    .first<{ id: string; is_connected: number }>()

  if (existing) {
    // Reconnection: return existing playerId
    return c.json({ playerId: existing.id, reconnected: true })
  }

  const playerId = crypto.randomUUID()
  await c.env.DB.prepare(`
    INSERT INTO players (id, room_id, username, wallet, total_score, is_connected, joined_at)
    VALUES (?, ?, ?, ?, 0, 0, ?)
  `).bind(playerId, roomId, username, room.config.startingWallet, Date.now()).run()

  return c.json({ playerId, reconnected: false }, 201)
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

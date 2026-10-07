import { Hono } from 'hono'
import type { Env } from '../types'
import { validateRegistration, normalizeEntryNumber } from '../../shared/team'
import {
  hashPasscode, verifyPasscode, createToken, generateLoginId, generatePasscode,
} from '../lib/crypto'
import { getTeamById, getTeamByLoginId } from '../db/d1'

const auth = new Hono<{ Bindings: Env }>()

const SECRET = (env: Env) => env.SESSION_SECRET || 'dev_secret_change_me_in_production'

// ─── POST /api/auth/register ──────────────────────────────────────────────────

auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON' }, 400)

  const errors = validateRegistration(body)
  if (errors.length > 0) return c.json({ errors }, 400)

  const teamName  = (body.teamName as string).trim()
  const nameLower = teamName.toLowerCase()

  const nameConflict = await c.env.DB
    .prepare('SELECT id FROM teams WHERE name_lower = ?').bind(nameLower).first()
  if (nameConflict) return c.json({ error: 'A team with that name already exists' }, 409)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = body.members as [any, any]
  for (const m of members) {
    const en = normalizeEntryNumber(m.entryNumber)
    const enConflict = await c.env.DB
      .prepare('SELECT id FROM team_members WHERE entry_number = ?').bind(en).first()
    if (enConflict) return c.json({ error: `Entry number ${en} is already registered on another team` }, 409)
  }

  const cfgRow = await c.env.DB
    .prepare('SELECT starting_wallet FROM game_config WHERE id = 1')
    .first<{ starting_wallet: number }>()
  const startingWallet = cfgRow?.starting_wallet ?? 1000

  const loginId = generateLoginId()
  const passcode = generatePasscode()
  const { hash, salt } = await hashPasscode(passcode)
  const teamId = crypto.randomUUID()
  const now    = Date.now()

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO teams (id, login_id, passcode_hash, passcode_salt, name, name_lower, wallet, total_score, is_connected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).bind(teamId, loginId, hash, salt, teamName, nameLower, startingWallet, now),
    c.env.DB.prepare(
      'INSERT INTO team_members (id, team_id, name, entry_number, hostel, slot) VALUES (?, ?, ?, ?, ?, 1)',
    ).bind(
      crypto.randomUUID(), teamId,
      (members[0].name as string).trim(),
      normalizeEntryNumber(members[0].entryNumber),
      members[0].hostel,
    ),
    c.env.DB.prepare(
      'INSERT INTO team_members (id, team_id, name, entry_number, hostel, slot) VALUES (?, ?, ?, ?, ?, 2)',
    ).bind(
      crypto.randomUUID(), teamId,
      (members[1].name as string).trim(),
      normalizeEntryNumber(members[1].entryNumber),
      members[1].hostel,
    ),
  ])

  const team  = await getTeamById(c.env.DB, teamId)
  const token = await createToken(teamId, SECRET(c.env))

  // Notify DO so it broadcasts TEAM_JOINED to connected clients
  try {
    const doId = c.env.GAME_ROOM.idFromName('main')
    const stub = c.env.GAME_ROOM.get(doId)
    c.executionCtx.waitUntil(
      stub.fetch(new Request('https://do-internal/team-joined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      })),
    )
  } catch { /* non-critical */ }

  return c.json({ loginId, passcode, token, team }, 201)
})

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  const body = await c.req.json<{ loginId: string; passcode: string }>().catch(() => null)
  if (!body?.loginId || !body.passcode) {
    return c.json({ error: 'loginId and passcode are required' }, 400)
  }

  const row = await getTeamByLoginId(c.env.DB, body.loginId.trim().toUpperCase())
  if (!row) return c.json({ error: 'Invalid login ID or passcode' }, 401)

  const valid = await verifyPasscode(body.passcode.trim().toUpperCase(), row.passcodeHash, row.passcodeSalt)
  if (!valid) return c.json({ error: 'Invalid login ID or passcode' }, 401)

  const token = await createToken(row.id, SECRET(c.env))
  return c.json({ token, team: { id: row.id, loginId: row.loginId, name: row.name, members: row.members, wallet: row.wallet, totalScore: row.totalScore, isConnected: row.isConnected } })
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

auth.get('/me', async (c) => {
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const { verifyToken } = await import('../lib/crypto')
  const teamId = await verifyToken(token, SECRET(c.env))
  if (!teamId) return c.json({ error: 'Invalid or expired token' }, 401)

  const team = await getTeamById(c.env.DB, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  return c.json({ team })
})

export { auth as authRouter }
export { SECRET }

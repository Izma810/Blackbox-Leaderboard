/**
 * Team auth. Registering gives the team a secret token; holding it is being the
 * team. The second laptop gets it through the teammate link. If both laptops
 * lose it, the host resets the team's login and the team claims it back with its
 * name and a member's entry number.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { validateRegistration, normalizeEntryNumber } from '../../shared/team'
import { generateToken, hashToken } from '../lib/crypto'
import { getTeamById, getTeamIdByToken, bearerToken } from '../db/d1'

const auth = new Hono<{ Bindings: Env }>()

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

  const token  = generateToken()
  const teamId = crypto.randomUUID()
  const now    = Date.now()

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO teams (id, token_hash, name, name_lower, wallet, total_score, is_connected, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?)
    `).bind(teamId, await hashToken(token), teamName, nameLower, startingWallet, now),
    ...members.map((m, i) =>
      c.env.DB.prepare(
        'INSERT INTO team_members (id, team_id, name, entry_number, hostel, slot) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), teamId, (m.name as string).trim(), normalizeEntryNumber(m.entryNumber), m.hostel, i + 1),
    ),
  ])

  const team = await getTeamById(c.env.DB, teamId)

  // Notify DO so it broadcasts TEAM_JOINED to connected clients
  try {
    const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName('main'))
    c.executionCtx.waitUntil(
      stub.fetch(new Request('https://do-internal/team-joined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      })),
    )
  } catch { /* non-critical */ }

  return c.json({ token, team }, 201)
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Also how the second laptop signs in: it opens the teammate link, which carries the token.

auth.get('/me', async (c) => {
  const teamId = await getTeamIdByToken(c.env.DB, bearerToken(c.req.header('Authorization')))
  if (!teamId) return c.json({ error: 'This login is not valid any more' }, 401)

  const team = await getTeamById(c.env.DB, teamId)
  if (!team) return c.json({ error: 'Team not found' }, 404)

  return c.json({ team })
})

// ─── POST /api/auth/claim ─────────────────────────────────────────────────────
// Only works for a team whose login the host has just reset.

auth.post('/claim', async (c) => {
  const body = await c.req.json<{ teamName?: unknown; entryNumber?: unknown }>().catch(() => null)
  const teamName    = typeof body?.teamName === 'string' ? body.teamName.trim().toLowerCase() : ''
  const entryNumber = typeof body?.entryNumber === 'string' ? normalizeEntryNumber(body.entryNumber) : ''
  if (!teamName || !entryNumber) return c.json({ error: 'Team name and an entry number are required' }, 400)

  const NOT_CLAIMABLE = {
    error: "That team can't be claimed. Check the name and entry number, and ask the host to reset your team's login first.",
  }

  const row = await c.env.DB.prepare(`
    SELECT t.id, t.token_hash FROM teams t
    JOIN team_members m ON m.team_id = t.id
    WHERE t.name_lower = ? AND m.entry_number = ?
  `).bind(teamName, entryNumber).first<{ id: string; token_hash: string | null }>()
  if (!row || row.token_hash !== null) return c.json(NOT_CLAIMABLE, 409)

  const token = generateToken()
  const claimed = await c.env.DB
    .prepare('UPDATE teams SET token_hash = ? WHERE id = ? AND token_hash IS NULL')
    .bind(await hashToken(token), row.id).run()
  if (claimed.meta.changes !== 1) return c.json(NOT_CLAIMABLE, 409)

  return c.json({ token, team: await getTeamById(c.env.DB, row.id) })
})

export { auth as authRouter }

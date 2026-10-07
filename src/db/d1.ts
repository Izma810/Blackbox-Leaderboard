/**
 * Typed D1 query helpers.
 * All row-to-object conversions happen here so the rest of the codebase
 * works with clean TypeScript types (camelCase).
 */

import type { Room, PlayerInfo, Round, RoomConfig, PublicSubmission, VoteCount, VoteType } from '../types'

// ─── Row → type converters ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function rowToConfig(r: Row): RoomConfig {
  return {
    startingWallet:  r.starting_wallet,
    phase1Secs:      r.phase1_secs,
    // poster_reward / voter_reward are the stakes (column names predate payouts)
    postStake:       r.poster_reward,
    postPayout:      r.post_payout,
    voteStake:       r.voter_reward,
    backPayout:      r.back_payout,
    hintCost:        r.hint_cost,
    votesPerRound:   r.votes_per_round,
    anonymousVoting: r.anonymous_voting === 1,
    maxRounds:       r.max_rounds ?? null,
  }
}

export function rowToRoom(r: Row): Room {
  return {
    id:        r.id,
    name:      r.name,
    status:    r.status,
    config:    rowToConfig(r),
    createdAt: r.created_at,
  }
}

export function rowToPlayerInfo(r: Row): PlayerInfo {
  return {
    id:          r.id,
    username:    r.username,
    wallet:      r.wallet,
    totalScore:  r.total_score,
    isConnected: r.is_connected === 1,
  }
}

export function rowToRound(r: Row): Round {
  return {
    id:           r.id,
    roomId:       r.room_id,
    roundNumber:  r.round_number,
    puzzleId:     r.puzzle_id,
    phase:        r.phase,
    phaseEndsAt:  r.phase_ends_at ?? null,
    startedAt:    r.started_at,
    endedAt:      r.ended_at ?? null,
  }
}

// ─── Room queries ─────────────────────────────────────────────────────────────

export async function getRoomById(db: D1Database, id: string): Promise<Room | null> {
  const r = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first<Row>()
  return r ? rowToRoom(r) : null
}

export async function getRoomByAdminToken(db: D1Database, token: string): Promise<Room | null> {
  const r = await db.prepare('SELECT * FROM rooms WHERE admin_token = ?').bind(token).first<Row>()
  return r ? rowToRoom(r) : null
}

// ─── Player queries ───────────────────────────────────────────────────────────

export async function getPlayersByRoom(db: D1Database, roomId: string): Promise<PlayerInfo[]> {
  const res = await db
    .prepare('SELECT * FROM players WHERE room_id = ? ORDER BY joined_at ASC')
    .bind(roomId)
    .all<Row>()
  return res.results.map(rowToPlayerInfo)
}

export async function getPlayerById(db: D1Database, id: string): Promise<PlayerInfo | null> {
  const r = await db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first<Row>()
  return r ? rowToPlayerInfo(r) : null
}

/**
 * True if `token` is the secret issued to this player when they joined.
 * playerIds are public (they're in every broadcast), so they can't be the credential.
 */
export async function isPlayerAuthorised(
  db: D1Database,
  roomId: string,
  playerId: unknown,
  token: unknown,
): Promise<boolean> {
  if (typeof playerId !== 'string' || typeof token !== 'string' || !playerId || !token) return false
  const r = await db
    .prepare('SELECT 1 FROM players WHERE id = ? AND room_id = ? AND token = ?')
    .bind(playerId, roomId, token)
    .first()
  return r !== null
}

export async function getPlayerVoteCount(
  db: D1Database,
  roundId: string,
  voterId: string,
): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) as cnt FROM votes WHERE round_id = ? AND voter_id = ?')
    .bind(roundId, voterId)
    .first<Row>()
  return r?.cnt ?? 0
}

// ─── Round queries ────────────────────────────────────────────────────────────

export async function getCurrentRound(db: D1Database, roomId: string): Promise<Round | null> {
  const r = await db
    .prepare(`SELECT * FROM rounds WHERE room_id = ? AND ended_at IS NULL ORDER BY round_number DESC LIMIT 1`)
    .bind(roomId)
    .first<Row>()
  return r ? rowToRound(r) : null
}

export async function getRoundById(db: D1Database, id: string): Promise<Round | null> {
  const r = await db.prepare('SELECT * FROM rounds WHERE id = ?').bind(id).first<Row>()
  return r ? rowToRound(r) : null
}

export async function getCompletedRoundCount(db: D1Database, roomId: string): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ? AND ended_at IS NOT NULL')
    .bind(roomId)
    .first<Row>()
  return r?.cnt ?? 0
}

// ─── Submission queries ───────────────────────────────────────────────────────

export interface SubmissionRow {
  id: string
  round_id: string
  player_id: string
  username: string
  /** The formula as typed by the player */
  features_json: string
  r2_score: number | null
  base_score: number
  is_correct: number
  submitted_at: number
}

export async function getSubmissionsForRound(
  db: D1Database,
  roundId: string,
): Promise<SubmissionRow[]> {
  const res = await db
    .prepare(`
      SELECT s.*, p.username
      FROM submissions s
      JOIN players p ON p.id = s.player_id
      WHERE s.round_id = ?
      ORDER BY s.submitted_at ASC
    `)
    .bind(roundId)
    .all<SubmissionRow>()
  return res.results
}

export function buildPublicSubmissions(
  rows: SubmissionRow[],
  anonymousVoting: boolean,
): PublicSubmission[] {
  return rows.map((r, idx) => ({
    id:          r.id,
    playerId:    r.player_id,
    label:       anonymousVoting
      ? String.fromCharCode(65 + idx)   // A, B, C, …
      : r.username,
    expr:        r.features_json,
    submittedAt: r.submitted_at,
  }))
}

// ─── Vote queries ─────────────────────────────────────────────────────────────

export async function getVoteCountsForRound(
  db: D1Database,
  roundId: string,
): Promise<VoteCount[]> {
  const res = await db
    .prepare(`
      SELECT submission_id,
             SUM(CASE WHEN vote_type = 'up'   THEN 1 ELSE 0 END) as ups,
             SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downs
      FROM votes
      WHERE round_id = ?
      GROUP BY submission_id
    `)
    .bind(roundId)
    .all<Row>()

  return res.results.map((r) => ({
    submissionId: r.submission_id,
    ups:          r.ups ?? 0,
    downs:        r.downs ?? 0,
  }))
}

export async function getVoteCountForSubmission(
  db: D1Database,
  submissionId: string,
): Promise<{ ups: number; downs: number }> {
  const r = await db
    .prepare(`
      SELECT SUM(CASE WHEN vote_type = 'up'   THEN 1 ELSE 0 END) as ups,
             SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downs
      FROM votes WHERE submission_id = ?
    `)
    .bind(submissionId)
    .first<Row>()
  return { ups: r?.ups ?? 0, downs: r?.downs ?? 0 }
}

export async function getPlayerVotes(
  db: D1Database,
  roundId: string,
  voterId: string,
): Promise<Record<string, VoteType>> {
  const res = await db
    .prepare('SELECT submission_id, vote_type FROM votes WHERE round_id = ? AND voter_id = ?')
    .bind(roundId, voterId)
    .all<Row>()
  return Object.fromEntries(res.results.map((r) => [r.submission_id, r.vote_type as VoteType]))
}

/**
 * Typed D1 query helpers.
 * All row→type conversions live here so the rest of the codebase works with clean TS types.
 */
import type {
  GameConfig, TeamInfo, TeamMemberInfo, BatchInfo, BatchStatus,
  BatchId, PuzzleInfo, PublicSubmission, VoteCount, VoteType,
} from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

// ─── game_config ──────────────────────────────────────────────────────────────

export function rowToConfig(r: Row): GameConfig {
  return {
    status:          r.status,
    startingWallet:  r.starting_wallet,
    postStake:       r.post_stake,
    postPayout:      r.post_payout,
    voteStake:       r.vote_stake,
    backPayout:      r.back_payout,
    hintCost:        r.hint_cost,
    voteBudget:      r.vote_budget,
    anonymousVoting: r.anonymous_voting === 1,
  }
}

export async function getConfig(db: D1Database): Promise<GameConfig> {
  const r = await db.prepare('SELECT * FROM game_config WHERE id = 1').first<Row>()
  if (!r) throw new Error('game_config row missing')
  return rowToConfig(r)
}

// ─── teams ────────────────────────────────────────────────────────────────────

function rowToTeamInfo(r: Row, members: TeamMemberInfo[]): TeamInfo {
  return {
    id:          r.id,
    loginId:     r.login_id,
    name:        r.name,
    members,
    wallet:      r.wallet,
    totalScore:  r.total_score,
    isConnected: r.is_connected === 1,
  }
}

async function getMembersForTeam(db: D1Database, teamId: string): Promise<TeamMemberInfo[]> {
  const res = await db
    .prepare('SELECT name, hostel, slot FROM team_members WHERE team_id = ? ORDER BY slot ASC')
    .bind(teamId).all<Row>()
  return res.results.map((m) => ({ name: m.name, hostel: m.hostel, slot: m.slot as 1 | 2 }))
}

export async function getAllTeams(db: D1Database): Promise<TeamInfo[]> {
  const res = await db.prepare('SELECT * FROM teams ORDER BY created_at ASC').all<Row>()
  return Promise.all(res.results.map(async (r) => {
    const members = await getMembersForTeam(db, r.id)
    return rowToTeamInfo(r, members)
  }))
}

export async function getTeamById(db: D1Database, id: string): Promise<TeamInfo | null> {
  const r = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<Row>()
  if (!r) return null
  const members = await getMembersForTeam(db, id)
  return rowToTeamInfo(r, members)
}

export async function getTeamByLoginId(db: D1Database, loginId: string): Promise<(TeamInfo & { passcodeHash: string; passcodeSalt: string }) | null> {
  const r = await db.prepare('SELECT * FROM teams WHERE login_id = ?').bind(loginId).first<Row>()
  if (!r) return null
  const members = await getMembersForTeam(db, r.id)
  return { ...rowToTeamInfo(r, members), passcodeHash: r.passcode_hash, passcodeSalt: r.passcode_salt }
}

// ─── batches ──────────────────────────────────────────────────────────────────

export function rowToBatchInfo(r: Row, puzzles: PuzzleInfo[]): BatchInfo {
  const NAMES: Record<string, string> = { easy: 'Beginner', intermediate: 'Physics', image: 'Image Processing' }
  return {
    id:              r.id as BatchId,
    name:            NAMES[r.id] ?? r.id,
    status:          r.status as BatchStatus,
    submissionsOpen: r.submissions_open === 1,
    votingOpen:      r.voting_open === 1,
    puzzles,
  }
}

export async function getAllBatches(db: D1Database, puzzlesByBatch: Record<BatchId, PuzzleInfo[]>): Promise<BatchInfo[]> {
  const res = await db.prepare('SELECT * FROM batches ORDER BY rowid ASC').all<Row>()
  return res.results.map((r) => rowToBatchInfo(r, puzzlesByBatch[r.id as BatchId] ?? []))
}

export async function getBatchById(db: D1Database, id: BatchId): Promise<Row | null> {
  return db.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first<Row>()
}

// ─── submissions ──────────────────────────────────────────────────────────────

export interface SubmissionRow {
  id:           string
  puzzle_id:    string
  batch_id:     string
  team_id:      string
  team_name:    string
  expr:         string
  stake:        number
  r2_score:     number | null
  verdict:      string | null   // 'right' | 'close' | 'wrong' | null
  submitted_at: number
  ups?:         number
  downs?:       number
}

export async function getSubmissionsForPuzzle(
  db: D1Database,
  puzzleId: string,
): Promise<SubmissionRow[]> {
  const res = await db.prepare(`
    SELECT s.*, t.name as team_name,
           COALESCE(SUM(CASE WHEN v.vote_type='up'   THEN 1 ELSE 0 END), 0) as ups,
           COALESCE(SUM(CASE WHEN v.vote_type='down' THEN 1 ELSE 0 END), 0) as downs
    FROM submissions s
    JOIN teams t ON t.id = s.team_id
    LEFT JOIN votes v ON v.submission_id = s.id
    WHERE s.puzzle_id = ?
    GROUP BY s.id
    ORDER BY s.submitted_at ASC
  `).bind(puzzleId).all<SubmissionRow>()
  return res.results
}

export async function getSubmissionsForBatch(
  db: D1Database,
  batchId: BatchId,
): Promise<SubmissionRow[]> {
  const res = await db.prepare(`
    SELECT s.*, t.name as team_name,
           COALESCE(SUM(CASE WHEN v.vote_type='up'   THEN 1 ELSE 0 END), 0) as ups,
           COALESCE(SUM(CASE WHEN v.vote_type='down' THEN 1 ELSE 0 END), 0) as downs
    FROM submissions s
    JOIN teams t ON t.id = s.team_id
    LEFT JOIN votes v ON v.submission_id = s.id
    WHERE s.batch_id = ?
    GROUP BY s.id
    ORDER BY s.submitted_at ASC
  `).bind(batchId).all<SubmissionRow>()
  return res.results
}

export function buildPublicSubmission(
  row: SubmissionRow,
  anonymousVoting: boolean,
  labelIdx: number,
  settled: boolean,
): PublicSubmission {
  return {
    id:          row.id,
    teamId:      row.team_id,
    label:       anonymousVoting ? String.fromCharCode(65 + labelIdx) : row.team_name,
    expr:        row.expr,
    ups:         row.ups ?? 0,
    downs:       row.downs ?? 0,
    submittedAt: row.submitted_at,
    ...(settled && row.verdict !== null ? {
      verdict:  row.verdict as import('../types').Verdict,
      accuracy: row.r2_score != null ? Math.max(0, Math.min(1, 1 - Math.sqrt(1 - row.r2_score))) : 0,
    } : {}),
  }
}

// ─── votes ────────────────────────────────────────────────────────────────────

export async function getTeamVotesForPuzzle(
  db: D1Database,
  puzzleId: string,
  teamId: string,
): Promise<Record<string, VoteType>> {
  const res = await db
    .prepare('SELECT submission_id, vote_type FROM votes WHERE puzzle_id = ? AND voter_team_id = ?')
    .bind(puzzleId, teamId).all<Row>()
  return Object.fromEntries(res.results.map((r) => [r.submission_id, r.vote_type as VoteType]))
}

export async function getTeamVotesUsed(db: D1Database, teamId: string): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) as cnt FROM votes WHERE voter_team_id = ?')
    .bind(teamId).first<Row>()
  return r?.cnt ?? 0
}

export async function getVoteCountForSubmission(
  db: D1Database,
  submissionId: string,
): Promise<{ ups: number; downs: number }> {
  const r = await db.prepare(`
    SELECT SUM(CASE WHEN vote_type='up'   THEN 1 ELSE 0 END) as ups,
           SUM(CASE WHEN vote_type='down' THEN 1 ELSE 0 END) as downs
    FROM votes WHERE submission_id = ?
  `).bind(submissionId).first<Row>()
  return { ups: r?.ups ?? 0, downs: r?.downs ?? 0 }
}

// ─── hints ────────────────────────────────────────────────────────────────────

export async function getHintsBought(db: D1Database, puzzleId: string, teamId: string): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) as cnt FROM wallet_transactions WHERE puzzle_id = ? AND team_id = ? AND type = 'hint'`)
    .bind(puzzleId, teamId).first<Row>()
  return r?.cnt ?? 0
}

// ─── per-team submission map (for FULL_STATE) ─────────────────────────────────

export async function getTeamSubmissionMap(
  db: D1Database,
  teamId: string,
): Promise<Record<string, string | null>> {
  // Returns puzzleId → verdict string (null if not yet settled)
  const res = await db
    .prepare('SELECT puzzle_id, verdict FROM submissions WHERE team_id = ?')
    .bind(teamId).all<Row>()
  const map: Record<string, string | null> = {}
  for (const r of res.results) {
    map[r.puzzle_id] = r.verdict ?? null   // null = submitted but not yet settled
  }
  return map
}

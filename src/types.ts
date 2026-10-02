/**
 * Round lifecycle. 'submission' is the single live phase: players post formulas
 * and vote on each other's formulas at the same time until the timer ends.
 */
export type Phase = 'lobby' | 'submission' | 'results' | 'finished'

/** Verdict on a posted formula — see src/game/formula.ts */
export type Verdict = 'right' | 'close' | 'wrong'

export interface RoomConfig {
  startingWallet: number
  /** Length of the live round (posting + voting), in seconds */
  phase1Secs: number
  /** Coins a poster puts at risk (lost to the bank if wrong) */
  postStake: number
  /** Bank pays the poster this on top of their stake if right (half if close) */
  postPayout: number
  /** Coins put at risk per vote */
  voteStake: number
  /** Bank pays a backer this on top of their stake if right (half if close). Always > postPayout. */
  backPayout: number
  /** Price of each hint */
  hintCost: number
  votesPerRound: number
  anonymousVoting: boolean
  maxRounds: number | null
}

export interface Room {
  id: string
  name: string
  status: 'lobby' | 'active' | 'finished'
  config: RoomConfig
  createdAt: number
}

export interface PlayerInfo {
  id: string
  username: string
  wallet: number
  /** Number of correct formulas posted across all rounds */
  totalScore: number
  isConnected: boolean
}

export interface Round {
  id: string
  roomId: string
  roundNumber: number
  puzzleId: string
  phase: Phase
  phaseEndsAt: number | null
  startedAt: number
  endedAt: number | null
}

export interface PublicSubmission {
  id: string
  playerId: string
  /** username when named, "A"/"B"/"C" when anonymous */
  label: string
  /** The formula exactly as the player typed it */
  expr: string
  submittedAt: number
}

export interface VoteCount {
  submissionId: string
  ups: number
  downs: number
}

export type VoteType = 'up' | 'down'

export interface RoundResult {
  submissionId: string
  playerId: string
  label: string
  expr: string
  /** 1 − normalised error, clamped to [0, 1]. 1 = exact match. */
  accuracy: number
  verdict: Verdict
  ups: number
  downs: number
}

export interface WalletDelta {
  playerId: string
  username: string
  delta: number
  newBalance: number
}

export interface RoundSummary {
  results: RoundResult[]
  deltas: WalletDelta[]
  solution: string
}

export interface LeaderboardEntry {
  rank: number
  playerId: string
  username: string
  wallet: number
  totalScore: number
}

/** Puzzle data that is safe to send to players (no solution). */
export interface PuzzleForPlayers {
  id: string
  title: string
  description: string
  difficulty: 1 | 2 | 3
  columns: string[]
  X: Record<string, number[]>
  y: number[]
  /** Number of hints that can be bought (the text stays on the server) */
  hintCount: number
}

export interface RoomState {
  room: Room
  players: PlayerInfo[]
  currentRound: Round | null
  submissions: PublicSubmission[]
  voteCounts: VoteCount[]
  /** Votes cast by the player this state was built for (empty for admin views) */
  myVotes: Record<string, VoteType>
  /** Hints the player this state was built for has bought this round */
  myHints: string[]
  roundNumber: number
  /** Puzzle data for the active round — null when in lobby or finished. */
  puzzle: PuzzleForPlayers | null
  /** Settled results — only present during the results phase. */
  summary: RoundSummary | null
}

// ─── WebSocket protocol ──────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'FULL_STATE';       state: RoomState }
  | { type: 'PLAYER_JOINED';    player: PlayerInfo }
  | { type: 'PLAYER_UPDATED';   player: PlayerInfo }
  | { type: 'PLAYER_LEFT';      playerId: string }
  /** Sent on every phase transition. Carries puzzle data when a round starts. */
  | { type: 'PHASE_CHANGED';    phase: Phase; endsAt: number | null; puzzle?: PuzzleForPlayers }
  | { type: 'SUBMISSION_MADE';  submission: PublicSubmission }
  | { type: 'VOTE_UPDATE';      submissionId: string; ups: number; downs: number }
  | { type: 'ROUND_RESULTS';    summary: RoundSummary; players: PlayerInfo[] }
  | { type: 'GAME_ENDED';       leaderboard: LeaderboardEntry[] }
  | { type: 'ERROR';            message: string }
  | { type: 'PONG' }

// ─── Puzzle types ────────────────────────────────────────────────────────────

export interface PuzzleInfo {
  id: string
  title: string
  description: string
  difficulty: 1 | 2 | 3
  /** input column names shown to players */
  columns: string[]
}

export interface PuzzleData extends PuzzleInfo {
  /** Column arrays shown to players (the x-values) */
  X: Record<string, number[]>
  /** Output values shown to players */
  y: number[]
  /** Server-only — the hidden formula, revealed when the round ends */
  solution: string
  /** Server-only — sold to players one at a time, vaguest first */
  hints: string[]
}

// ─── Cloudflare env ──────────────────────────────────────────────────────────

export interface Env {
  DB: D1Database
  GAME_ROOM: DurableObjectNamespace
  ENVIRONMENT: string
  /** Master admin password — set via `wrangler secret put ADMIN_PASSWORD` in production */
  ADMIN_PASSWORD: string
}

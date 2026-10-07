export type GameStatus  = 'lobby' | 'active' | 'finished'
export type BatchId     = 'easy' | 'intermediate' | 'image'
export type BatchStatus = 'hidden' | 'open' | 'settled'
export type VoteType    = 'up' | 'down'
export type Verdict     = 'right' | 'close' | 'wrong'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GameConfig {
  status:          GameStatus
  startingWallet:  number
  postStake:       number
  postPayout:      number
  voteStake:       number
  backPayout:      number
  hintCost:        number
  voteBudget:      number
  anonymousVoting: boolean
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export interface TeamMemberInfo {
  name:   string
  hostel: string
  slot:   1 | 2
}

export interface TeamInfo {
  id:          string
  name:        string
  members:     TeamMemberInfo[]
  wallet:      number
  totalScore:  number
  isConnected: boolean
}

// ─── Batches & Puzzles ────────────────────────────────────────────────────────

export interface BatchInfo {
  id:               BatchId
  name:             string           // 'Easy' | 'Intermediate' | 'Advanced'
  status:           BatchStatus
  submissionsOpen:  boolean
  votingOpen:       boolean
  puzzles:          PuzzleInfo[]     // puzzles in this batch (no X/y data)
}

export interface NumericalPuzzleInfo {
  puzzleType:  'numerical'
  id:          string
  title:       string
  description: string
  difficulty:  1 | 2 | 3
  batchId:     BatchId
  columns:     string[]
}

export interface ImagePuzzleInfo {
  puzzleType:    'image'
  id:            string
  title:         string
  description:   string
  batchId:       BatchId
  imageNames:    string[]
  maxFilters:    number
  isCommutative: boolean
}

export type PuzzleInfo = NumericalPuzzleInfo | ImagePuzzleInfo

/** Full numerical puzzle data sent to players — no solution, includes X and y */
export interface PuzzleForPlayers extends NumericalPuzzleInfo {
  X:         Record<string, number[]>
  y:         number[]
  hintCount: number
}

/** Full image puzzle data sent to players */
export type ImagePuzzleForPlayers = ImagePuzzleInfo

/** Server-only puzzle definition */
export interface PuzzleData extends NumericalPuzzleInfo {
  X:        Record<string, number[]>
  y:        number[]
  solution: string
  hints:    string[]
}

// ─── Submissions & Votes ──────────────────────────────────────────────────────

export interface PublicSubmission {
  id:          string
  teamId:      string
  label:       string            // team name or A/B/C when anonymous
  expr:        string
  ups:         number
  downs:       number
  submittedAt: number
  verdict?:    Verdict           // present after settlement
  accuracy?:   number
}

export interface VoteCount {
  submissionId: string
  ups:   number
  downs: number
}

// ─── Settlement ───────────────────────────────────────────────────────────────

export interface BatchResult {
  submissionId: string
  teamId:       string
  label:        string
  expr:         string
  accuracy:     number
  verdict:      Verdict
  ups:          number
  downs:        number
}

export interface WalletDelta {
  teamId:     string
  teamName:   string
  delta:      number
  newBalance: number
}

export interface BatchSummary {
  batchId:         BatchId
  results:         Record<string, BatchResult[]>  // puzzleId → results
  deltas:          WalletDelta[]
  solutions:       Record<string, string>          // puzzleId → solution
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank:       number
  teamId:     string
  teamName:   string
  wallet:     number
  totalScore: number
}

// ─── Full game state (sent on WS connect) ─────────────────────────────────────

export interface GameState {
  config:         GameConfig
  teams:          TeamInfo[]
  batches:        BatchInfo[]
  /** My teamId (null for spectators) */
  myTeamId:       string | null
  /** Total votes this team has used globally */
  myVotesUsed:    number
  /** puzzleId → verdict | null (null = submitted but not settled) */
  mySubmissions:  Record<string, Verdict | null>
}

// ─── WebSocket protocol ───────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'FULL_STATE';      state: GameState }
  | { type: 'TEAM_JOINED';     team: TeamInfo }
  | { type: 'TEAM_UPDATED';    team: TeamInfo }
  | { type: 'TEAM_LEFT';       teamId: string }
  | { type: 'BATCH_UPDATED';   batch: BatchInfo }
  | { type: 'SUBMISSION_MADE'; puzzleId: string; submission: PublicSubmission }
  | { type: 'VOTE_CAST';       puzzleId: string; submissionId: string; ups: number; downs: number }
  | { type: 'BATCH_SETTLED';   batchId: BatchId; summary: BatchSummary; teams: TeamInfo[] }
  | { type: 'BATCH_REOPENED';  batchId: BatchId; teams: TeamInfo[] }
  | { type: 'GAME_ENDED';      leaderboard: LeaderboardEntry[] }
  | { type: 'GAME_RESET' }
  | { type: 'ERROR';           message: string }
  | { type: 'PONG' }

// ─── Cloudflare env ───────────────────────────────────────────────────────────

export interface Env {
  DB:              D1Database
  GAME_ROOM:       DurableObjectNamespace
  ENVIRONMENT:     string
  ADMIN_PASSWORD:  string
}

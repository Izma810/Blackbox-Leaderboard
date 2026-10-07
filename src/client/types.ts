// Mirror of src/types.ts — keep in sync.

export type GameStatus  = 'lobby' | 'active' | 'finished'
export type BatchId     = 'easy' | 'intermediate' | 'image'
export type BatchStatus = 'hidden' | 'open' | 'settled'
export type VoteType    = 'up' | 'down'
export type Verdict     = 'right' | 'close' | 'wrong'

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

export interface TeamMemberInfo {
  name:   string
  hostel: string
  slot:   1 | 2
}

export interface TeamInfo {
  id:          string
  loginId:     string
  name:        string
  members:     TeamMemberInfo[]
  wallet:      number
  totalScore:  number
  isConnected: boolean
}

export interface BatchInfo {
  id:              BatchId
  name:            string
  status:          BatchStatus
  submissionsOpen: boolean
  votingOpen:      boolean
  puzzles:         PuzzleInfo[]
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

export interface PuzzleForPlayers extends NumericalPuzzleInfo {
  X:         Record<string, number[]>
  y:         number[]
  hintCount: number
}

export type ImagePuzzleForPlayers = ImagePuzzleInfo

export interface PublicSubmission {
  id:          string
  teamId:      string
  label:       string
  expr:        string
  ups:         number
  downs:       number
  submittedAt: number
  verdict?:    Verdict
  accuracy?:   number
}

export interface VoteCount {
  submissionId: string
  ups:   number
  downs: number
}

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
  batchId:   BatchId
  results:   Record<string, BatchResult[]>
  deltas:    WalletDelta[]
  solutions: Record<string, string>
}

export interface LeaderboardEntry {
  rank:       number
  teamId:     string
  teamName:   string
  wallet:     number
  totalScore: number
}

export interface GameState {
  config:        GameConfig
  teams:         TeamInfo[]
  batches:       BatchInfo[]
  myTeamId:      string | null
  myVotesUsed:   number
  mySubmissions: Record<string, Verdict | null>
}

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

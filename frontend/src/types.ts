// Mirror of the worker types — keep in sync with src/types.ts

export type Phase = 'lobby' | 'submission' | 'results' | 'finished'

export type Verdict = 'right' | 'close' | 'wrong'

export type VoteType = 'up' | 'down'

export interface RoomConfig {
  startingWallet: number
  phase1Secs: number
  postStake: number
  postPayout: number
  voteStake: number
  backPayout: number
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
  label: string
  expr: string
  submittedAt: number
}

export interface VoteCount {
  submissionId: string
  ups: number
  downs: number
}

export interface RoundResult {
  submissionId: string
  playerId: string
  label: string
  expr: string
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
  myVotes: Record<string, VoteType>
  myHints: string[]
  roundNumber: number
  puzzle: PuzzleForPlayers | null
  summary: RoundSummary | null
}

export type ServerMessage =
  | { type: 'FULL_STATE';       state: RoomState }
  | { type: 'PLAYER_JOINED';    player: PlayerInfo }
  | { type: 'PLAYER_UPDATED';   player: PlayerInfo }
  | { type: 'PLAYER_LEFT';      playerId: string }
  | { type: 'PHASE_CHANGED';    phase: Phase; endsAt: number | null; puzzle?: PuzzleForPlayers }
  | { type: 'SUBMISSION_MADE';  submission: PublicSubmission }
  | { type: 'VOTE_UPDATE';      submissionId: string; ups: number; downs: number }
  | { type: 'ROUND_RESULTS';    summary: RoundSummary; players: PlayerInfo[] }
  | { type: 'GAME_ENDED';       leaderboard: LeaderboardEntry[] }
  | { type: 'ERROR';            message: string }
  | { type: 'PONG' }

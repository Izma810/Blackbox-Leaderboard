// Mirror of the worker types — keep in sync with src/types.ts

export type Phase = 'lobby' | 'submission' | 'voting' | 'results' | 'finished'

export type BinaryTransformKey = 'multiply' | 'divide' | 'add' | 'distance'

export type Feature =
  | string
  | { binary: BinaryTransformKey; a: string; b: string }

export interface RoomConfig {
  startingWallet: number
  phase1Secs: number
  phase2Secs: number
  posterReward: number
  voterReward: number
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
  features: Feature[]
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
  features: Feature[]
  r2Score: number
  baseScore: number
  isCorrect: boolean
}

export interface WalletDelta {
  playerId: string
  username: string
  delta: number
  type: string
  note: string
  newBalance: number
}

export interface LeaderboardEntry {
  rank: number
  playerId: string
  username: string
  wallet: number
  totalScore: number
}

export interface RoomState {
  room: Room
  players: PlayerInfo[]
  currentRound: Round | null
  submissions: PublicSubmission[]
  voteCounts: VoteCount[]
  roundNumber: number
  puzzle: PuzzleForPlayers | null
}

export type ServerMessage =
  | { type: 'FULL_STATE';       state: RoomState }
  | { type: 'PLAYER_JOINED';    player: PlayerInfo }
  | { type: 'PLAYER_LEFT';      playerId: string }
  | { type: 'PHASE_CHANGED';    phase: Phase; endsAt: number | null; puzzle?: PuzzleForPlayers }
  | { type: 'SUBMISSION_MADE';  submission: PublicSubmission }
  | { type: 'VOTE_UPDATE';      submissionId: string; ups: number; downs: number }
  | { type: 'ROUND_RESULTS';    results: RoundResult[]; deltas: WalletDelta[]; players: PlayerInfo[] }
  | { type: 'GAME_ENDED';       leaderboard: LeaderboardEntry[] }
  | { type: 'ERROR';            message: string }
  | { type: 'PONG' }

export interface PuzzleForPlayers {
  id: string
  title: string
  description: string
  difficulty: 1 | 2 | 3
  columns: string[]
  X: Record<string, number[]>
  y: number[]
}

// Unary transform options shown in the submission form
export const UNARY_TRANSFORM_OPTIONS = [
  { key: 'identity',    label: 'identity:col',    desc: 'x (no change)' },
  { key: 'square',      label: 'square:col',      desc: 'x²' },
  { key: 'cube',        label: 'cube:col',         desc: 'x³' },
  { key: 'sqrt',        label: 'sqrt:col',         desc: '√x' },
  { key: 'abs',         label: 'abs:col',          desc: '|x|' },
  { key: 'log',         label: 'log:col',          desc: 'ln(x)' },
  { key: 'log2',        label: 'log2:col',         desc: 'log₂(x)' },
  { key: 'reciprocal',  label: 'reciprocal:col',   desc: '1/x' },
  { key: 'sin',         label: 'sin:col',          desc: 'sin(x)' },
  { key: 'cos',         label: 'cos:col',          desc: 'cos(x)' },
  { key: 'sin_2pi',     label: 'sin_2pi:col',      desc: 'sin(2πx)' },
  { key: 'cos_2pi',     label: 'cos_2pi:col',      desc: 'cos(2πx)' },
  { key: 'sin_period7', label: 'sin_period7:col',  desc: 'sin(2πx/7)' },
  { key: 'cos_period7', label: 'cos_period7:col',  desc: 'cos(2πx/7)' },
  { key: 'exp',         label: 'exp:col',          desc: 'eˣ' },
  { key: 'floor10',     label: 'floor10:col',      desc: 'floor(x/10)·10' },
  { key: 'step',        label: 'step:col',         desc: '1 if x≥0 else 0' },
] as const

export const BINARY_TRANSFORM_OPTIONS = [
  { key: 'multiply', label: 'multiply',  desc: 'a × b' },
  { key: 'divide',   label: 'divide',    desc: 'a ÷ b' },
  { key: 'add',      label: 'add',       desc: 'a + b' },
  { key: 'distance', label: 'distance',  desc: '√(a²+b²)' },
] as const

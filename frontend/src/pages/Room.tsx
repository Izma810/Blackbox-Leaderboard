import { useReducer, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type {
  ServerMessage, RoomState, PlayerInfo, PublicSubmission,
  VoteCount, RoundResult, WalletDelta, LeaderboardEntry,
  Phase, PuzzleForPlayers,
} from '../types'
import { useWebSocket } from '../hooks/useWebSocket'
import Timer from '../components/Timer'
import PlayerList from '../components/PlayerList'
import PuzzleDisplay from '../components/PuzzleDisplay'
import SubmissionForm from '../components/SubmissionForm'
import VotingPanel from '../components/VotingPanel'
import ResultsPanel from '../components/ResultsPanel'

// ─── State ────────────────────────────────────────────────────────────────────

interface GameState {
  roomState:        RoomState | null
  puzzle:           PuzzleForPlayers | null   // puzzle for the active round
  phase:            Phase
  phaseEndsAt:      number | null
  roundResults:     RoundResult[] | null
  walletDeltas:     WalletDelta[] | null
  finalLeaderboard: LeaderboardEntry[] | null
  hasSubmitted:     boolean
  connected:        boolean
}

const initial: GameState = {
  roomState: null, puzzle: null, phase: 'lobby',
  phaseEndsAt: null, roundResults: null, walletDeltas: null,
  finalLeaderboard: null, hasSubmitted: false, connected: false,
}

type Action =
  | { type: 'SET_STATE';        state: RoomState }
  | { type: 'PLAYER_JOINED';    player: PlayerInfo }
  | { type: 'PLAYER_LEFT';      playerId: string }
  | { type: 'PHASE_CHANGED';    phase: Phase; endsAt: number | null; puzzle?: PuzzleForPlayers }
  | { type: 'SUBMISSION_MADE';  submission: PublicSubmission }
  | { type: 'VOTE_UPDATE';      submissionId: string; ups: number; downs: number }
  | { type: 'ROUND_RESULTS';    results: RoundResult[]; deltas: WalletDelta[]; players: PlayerInfo[] }
  | { type: 'GAME_ENDED';       leaderboard: LeaderboardEntry[] }
  | { type: 'SUBMITTED' }
  | { type: 'CONNECTED';        v: boolean }

function getMyPlayerId(roomId: string): string {
  return localStorage.getItem(`playerId:${roomId}`) ?? ''
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {

    case 'SET_STATE': {
      const rs = action.state
      return {
        ...state,
        roomState:        rs,
        puzzle:           rs.puzzle ?? state.puzzle,
        phase:            rs.currentRound?.phase ?? 'lobby',
        phaseEndsAt:      rs.currentRound?.phaseEndsAt ?? null,
        roundResults:     null,
        walletDeltas:     null,
        finalLeaderboard: null,
        hasSubmitted:     rs.submissions.some(
          (s) => s.playerId === getMyPlayerId(rs.room.id),
        ),
      }
    }

    case 'PLAYER_JOINED': {
      if (!state.roomState) return state
      const exists = state.roomState.players.some((p) => p.id === action.player.id)
      return {
        ...state,
        roomState: {
          ...state.roomState,
          players: exists
            ? state.roomState.players.map((p) =>
                p.id === action.player.id ? action.player : p,
              )
            : [...state.roomState.players, action.player],
        },
      }
    }

    case 'PLAYER_LEFT': {
      if (!state.roomState) return state
      return {
        ...state,
        roomState: {
          ...state.roomState,
          players: state.roomState.players.map((p) =>
            p.id === action.playerId ? { ...p, isConnected: false } : p,
          ),
        },
      }
    }

    case 'PHASE_CHANGED':
      return {
        ...state,
        phase:        action.phase,
        phaseEndsAt:  action.endsAt,
        // Carry the puzzle from the broadcast; keep old one if not included (e.g. results → lobby)
        puzzle:       action.puzzle ?? (action.phase === 'lobby' ? null : state.puzzle),
        // Clear submission flag when a new submission phase starts
        hasSubmitted: action.phase === 'submission' ? false : state.hasSubmitted,
        // Clear results when moving away from results
        roundResults:  action.phase !== 'results' ? null : state.roundResults,
        walletDeltas:  action.phase !== 'results' ? null : state.walletDeltas,
      }

    case 'SUBMISSION_MADE': {
      if (!state.roomState) return state
      const exists = state.roomState.submissions.some((s) => s.id === action.submission.id)
      return {
        ...state,
        roomState: {
          ...state.roomState,
          submissions: exists
            ? state.roomState.submissions
            : [...state.roomState.submissions, action.submission],
        },
      }
    }

    case 'VOTE_UPDATE': {
      if (!state.roomState) return state
      const existing = state.roomState.voteCounts.find(
        (v) => v.submissionId === action.submissionId,
      )
      return {
        ...state,
        roomState: {
          ...state.roomState,
          voteCounts: existing
            ? state.roomState.voteCounts.map((v) =>
                v.submissionId === action.submissionId
                  ? { ...v, ups: action.ups, downs: action.downs }
                  : v,
              )
            : [
                ...state.roomState.voteCounts,
                { submissionId: action.submissionId, ups: action.ups, downs: action.downs },
              ],
        },
      }
    }

    case 'ROUND_RESULTS':
      return {
        ...state,
        phase:        'results',
        roundResults: action.results,
        walletDeltas: action.deltas,
        // Apply the updated player list (wallets already settled in DB) so the
        // top bar and sidebar reflect the new balances without a page refresh
        roomState: state.roomState
          ? { ...state.roomState, players: action.players }
          : state.roomState,
      }

    case 'GAME_ENDED':
      return { ...state, phase: 'finished', finalLeaderboard: action.leaderboard }

    case 'SUBMITTED':
      return { ...state, hasSubmitted: true }

    case 'CONNECTED':
      return { ...state, connected: action.v }

    default:
      return state
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate   = useNavigate()
  const [state, dispatch] = useReducer(reducer, initial)

  const playerId = getMyPlayerId(roomId ?? '')

  useEffect(() => {
    if (!playerId) navigate('/')
  }, [playerId, navigate])

  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'FULL_STATE':
        dispatch({ type: 'SET_STATE', state: msg.state })
        break
      case 'PLAYER_JOINED':
        dispatch({ type: 'PLAYER_JOINED', player: msg.player })
        break
      case 'PLAYER_LEFT':
        dispatch({ type: 'PLAYER_LEFT', playerId: msg.playerId })
        break
      case 'PHASE_CHANGED':
        dispatch({ type: 'PHASE_CHANGED', phase: msg.phase, endsAt: msg.endsAt, puzzle: msg.puzzle })
        break
      case 'SUBMISSION_MADE':
        dispatch({ type: 'SUBMISSION_MADE', submission: msg.submission })
        break
      case 'VOTE_UPDATE':
        dispatch({ type: 'VOTE_UPDATE', submissionId: msg.submissionId, ups: msg.ups, downs: msg.downs })
        break
      case 'ROUND_RESULTS':
        dispatch({ type: 'ROUND_RESULTS', results: msg.results, deltas: msg.deltas, players: msg.players })
        break
      case 'GAME_ENDED':
        dispatch({ type: 'GAME_ENDED', leaderboard: msg.leaderboard })
        setTimeout(() => navigate(`/room/${roomId}/final`), 4000)
        break
    }
  }, [navigate, roomId])

  const onOpen  = useCallback(() => dispatch({ type: 'CONNECTED', v: true }),  [])
  const onClose = useCallback(() => dispatch({ type: 'CONNECTED', v: false }), [])

  useWebSocket({ roomId: roomId ?? '', playerId, onMessage, onOpen, onClose })

  // ── Loading / connecting ──────────────────────────────────────────────────
  if (!state.roomState) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500 text-sm">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${state.connected ? 'bg-brand-400' : 'bg-zinc-600'}`} />
          {state.connected ? 'Loading room…' : 'Connecting…'}
        </div>
      </div>
    )
  }

  const { roomState, puzzle } = state
  const me = roomState.players.find((p) => p.id === playerId)

  const phaseLabel: Record<Phase, string> = {
    lobby: 'LOBBY', submission: 'SUBMISSION', voting: 'VOTING',
    results: 'RESULTS', finished: 'FINISHED',
  }
  const phaseBadge: Record<Phase, string> = {
    lobby: 'badge-zinc', submission: 'badge-yellow',
    voting: 'badge-blue', results: 'badge-green', finished: 'badge-zinc',
  }

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-zinc-600 text-xs font-mono hidden sm:block">#{roomId}</span>
          <span className="text-zinc-300 font-semibold truncate">{roomState.room.name}</span>
          <span className={`badge text-xs shrink-0 ${phaseBadge[state.phase]}`}>
            {phaseLabel[state.phase]}
          </span>
          {roomState.currentRound && (
            <span className="text-zinc-600 text-xs shrink-0">Round {roomState.roundNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {me && (
            <div className="text-right">
              <div className="text-xs text-zinc-500">wallet</div>
              <div className="text-brand-400 font-bold tabular-nums text-sm">
                {me.wallet.toLocaleString()}
              </div>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${state.connected ? 'bg-brand-400' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-xs text-zinc-600">{state.connected ? 'live' : 'reconnecting…'}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">

          {state.phase === 'lobby' && (
            <LobbyView roomState={roomState} />
          )}

          {(state.phase === 'submission' || state.phase === 'voting') && (
            <ActiveRoundView
              roomState={roomState}
              puzzle={puzzle}
              phase={state.phase}
              phaseEndsAt={state.phaseEndsAt}
              playerId={playerId}
              hasSubmitted={state.hasSubmitted}
              onSubmitted={() => dispatch({ type: 'SUBMITTED' })}
            />
          )}

          {state.phase === 'results' && state.roundResults && (
            <div className="max-w-2xl mx-auto flex flex-col gap-4">
              <h2 className="text-xl font-bold text-zinc-100">Round Results</h2>
              <ResultsPanel
                results={state.roundResults}
                deltas={state.walletDeltas ?? []}
                myPlayerId={playerId}
              />
              <p className="text-zinc-500 text-sm text-center mt-2">
                Waiting for admin to start the next round…
              </p>
            </div>
          )}

          {state.phase === 'finished' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="text-3xl font-bold text-brand-400">Game Over!</div>
              <p className="text-zinc-400 text-sm">Redirecting to final leaderboard…</p>
            </div>
          )}
        </main>

        {/* ── Sidebar: players ─────────────────────────────────────────────── */}
        <aside className="w-60 border-l border-zinc-800 p-4 hidden lg:flex flex-col gap-4 overflow-y-auto shrink-0">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">
            Players ({roomState.players.length})
          </div>
          <PlayerList players={roomState.players} myPlayerId={playerId} showWallet />
        </aside>
      </div>
    </div>
  )
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ roomState }: { roomState: RoomState }) {
  return (
    <div className="max-w-lg mx-auto py-16 text-center flex flex-col items-center gap-6">
      <div>
        <div className="text-4xl mb-3 text-zinc-600">x → ??? → y</div>
        <h2 className="text-xl font-semibold text-zinc-300">Waiting for admin to start</h2>
        <p className="text-zinc-500 text-sm mt-2">
          {roomState.players.length} player{roomState.players.length !== 1 ? 's' : ''} connected
        </p>
      </div>
      <div className="card w-full max-w-xs">
        <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wider">Room ID</div>
        <code className="text-brand-400 font-bold text-xl block text-center py-1.5 bg-zinc-800 rounded-lg select-all">
          {roomState.room.id}
        </code>
        <p className="text-zinc-600 text-xs mt-2 text-center">Share this with other players</p>
      </div>
    </div>
  )
}

// ─── Active round (submission + voting) ───────────────────────────────────────

interface ActiveRoundViewProps {
  roomState:    RoomState
  puzzle:       PuzzleForPlayers | null
  phase:        'submission' | 'voting'
  phaseEndsAt:  number | null
  playerId:     string
  hasSubmitted: boolean
  onSubmitted:  () => void
}

function ActiveRoundView({
  roomState, puzzle, phase, phaseEndsAt, playerId, hasSubmitted, onSubmitted,
}: ActiveRoundViewProps) {
  const submittedCount = roomState.submissions.length
  const totalPlayers   = roomState.players.length

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">

      {/* Phase header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className={`text-xs uppercase tracking-widest font-semibold mb-1 ${
            phase === 'submission' ? 'text-yellow-400' : 'text-blue-400'
          }`}>
            {phase === 'submission' ? '— Phase 1: Submission —' : '— Phase 2: Voting —'}
          </div>
          <h2 className="text-lg font-bold text-zinc-100">
            {phase === 'submission'
              ? 'What is the hidden function?'
              : 'Vote on submissions'}
          </h2>
        </div>
        <Timer endsAt={phaseEndsAt} />
      </div>

      {/* Submission count */}
      <div className="text-sm text-zinc-400">
        <span className="text-zinc-200 font-medium">{submittedCount}</span>
        {' / '}
        <span>{totalPlayers}</span>
        {' players submitted'}
      </div>

      {/* Puzzle display */}
      {puzzle ? (
        <div className="card">
          <PuzzleDisplay puzzle={puzzle} previewRows={20} />
        </div>
      ) : (
        <div className="card text-zinc-600 text-sm italic text-center py-8">
          Loading puzzle…
        </div>
      )}

      {/* Submission form (phase 1, not yet submitted) */}
      {phase === 'submission' && !hasSubmitted && puzzle && (
        <div className="card">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-4">Your answer</div>
          <SubmissionForm
            columns={puzzle.columns}
            roomId={roomState.room.id}
            playerId={playerId}
            onSubmitted={onSubmitted}
          />
        </div>
      )}

      {phase === 'submission' && hasSubmitted && (
        <div className="card bg-brand-500/10 border-brand-500/30 text-center py-5">
          <div className="text-brand-400 font-semibold text-lg">✓ Submitted!</div>
          <div className="text-zinc-500 text-sm mt-1">
            Waiting for others… Voting starts when the timer ends.
          </div>
        </div>
      )}

      {/* Live submission feed — both phases */}
      {roomState.submissions.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">
            {phase === 'submission' ? 'Submissions so far (live)' : 'All submissions — vote below'}
          </div>

          {phase === 'submission' ? (
            <SubmissionFeed submissions={roomState.submissions} myPlayerId={playerId} />
          ) : (
            <VotingPanel
              submissions={roomState.submissions}
              voteCounts={roomState.voteCounts}
              myPlayerId={playerId}
              roomId={roomState.room.id}
              playerId={playerId}
              votesPerRound={roomState.room.config.votesPerRound}
              voterReward={roomState.room.config.voterReward}
              onVoteCast={() => {}}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Submission feed (phase 1 live list) ─────────────────────────────────────

function SubmissionFeed({
  submissions,
  myPlayerId,
}: {
  submissions: PublicSubmission[]
  myPlayerId: string
}) {
  return (
    <div className="flex flex-col gap-2">
      {submissions.map((sub, idx) => {
        const isOwn = sub.playerId === myPlayerId
        return (
          <div
            key={sub.id}
            className={`
              flex items-center gap-3 px-3 py-2 rounded-lg text-sm animate-slide-up
              ${isOwn
                ? 'bg-brand-500/10 border border-brand-500/30'
                : 'bg-zinc-800/60'}
            `}
          >
            <span className="text-zinc-600 text-xs w-5 text-center tabular-nums">{idx + 1}</span>
            <span className={`font-medium shrink-0 ${isOwn ? 'text-brand-400' : 'text-zinc-300'}`}>
              {sub.label}
            </span>
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {sub.features.map((f, i) => (
                <code
                  key={i}
                  className="text-xs bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-400"
                >
                  {typeof f === 'string' ? f : `${f.binary}(${f.a}, ${f.b})`}
                </code>
              ))}
            </div>
            <span className="text-zinc-700 text-xs shrink-0">
              {new Date(sub.submittedAt).toLocaleTimeString()}
            </span>
          </div>
        )
      })}
    </div>
  )
}

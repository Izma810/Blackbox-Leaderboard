import { useReducer, useEffect, useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type {
  ServerMessage, RoomState, PlayerInfo, PublicSubmission, RoundSummary,
  LeaderboardEntry, Phase, PuzzleForPlayers, VoteType,
} from '../types'
import { useWebSocket } from '../hooks/useWebSocket'
import Timer, { TimeBar } from '../components/Timer'
import PuzzlePanel from '../components/PuzzlePanel'
import FormulaInput from '../components/FormulaInput'
import HintPanel from '../components/HintPanel'
import EntryFeed from '../components/EntryFeed'
import ResultsPanel from '../components/ResultsPanel'
import { RulesContent, RulesDialog } from '../components/Rules'
import Leaderboard, { LeaderboardDialog, rankPlayers } from '../components/Leaderboard'
import RoundIntro from '../components/RoundIntro'
import StandingsReveal from '../components/StandingsReveal'
import { Formula } from '../lib/formula'
import { apiUrl } from '../lib/backend'

// ─── State ────────────────────────────────────────────────────────────────────

interface GameState {
  roomState:        RoomState | null
  puzzle:           PuzzleForPlayers | null
  phase:            Phase
  phaseEndsAt:      number | null
  summary:          RoundSummary | null
  finalLeaderboard: LeaderboardEntry[] | null
  connected:        boolean
  deleted:          boolean
  /** Round-start countdown to play (only for rounds that start while we watch) */
  intro:            { round: number; title: string } | null
  /** Play the animated standings for the round that just settled */
  reveal:           boolean
}

const initial: GameState = {
  roomState: null, puzzle: null, phase: 'lobby', phaseEndsAt: null,
  summary: null, finalLeaderboard: null, connected: false, deleted: false,
  intro: null, reveal: false,
}

type Action =
  | { type: 'SET_STATE';        state: RoomState }
  | { type: 'UPSERT_PLAYER';    player: PlayerInfo }
  | { type: 'PLAYER_LEFT';      playerId: string }
  | { type: 'PHASE_CHANGED';    phase: Phase; endsAt: number | null; puzzle?: PuzzleForPlayers }
  | { type: 'SUBMISSION_MADE';  submission: PublicSubmission }
  | { type: 'VOTE_UPDATE';      submissionId: string; ups: number; downs: number }
  | { type: 'MY_VOTE';          submissionId: string; vote: VoteType }
  | { type: 'MY_HINTS';         hints: string[] }
  | { type: 'ROUND_RESULTS';    summary: RoundSummary; players: PlayerInfo[] }
  | { type: 'GAME_ENDED';       leaderboard: LeaderboardEntry[] }
  | { type: 'CONNECTED';        v: boolean }
  | { type: 'ROOM_DELETED' }
  | { type: 'INTRO_DONE' }
  | { type: 'REVEAL_DONE' }

function getMyPlayerId(roomId: string): string {
  return localStorage.getItem(`playerId:${roomId}`) ?? ''
}

function withRoom(state: GameState, fn: (rs: RoomState) => RoomState): GameState {
  return state.roomState ? { ...state, roomState: fn(state.roomState) } : state
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SET_STATE': {
      const rs = action.state
      return {
        ...state,
        roomState:   rs,
        puzzle:      rs.puzzle,
        phase:       rs.room.status === 'finished' ? 'finished' : rs.currentRound?.phase ?? 'lobby',
        phaseEndsAt: rs.currentRound?.phaseEndsAt ?? null,
        summary:     rs.summary,
      }
    }

    case 'UPSERT_PLAYER':
      return withRoom(state, (rs) => ({
        ...rs,
        players: rs.players.some((p) => p.id === action.player.id)
          ? rs.players.map((p) => (p.id === action.player.id ? action.player : p))
          : [...rs.players, action.player],
      }))

    case 'PLAYER_LEFT':
      return withRoom(state, (rs) => ({
        ...rs,
        players: rs.players.map((p) => (p.id === action.playerId ? { ...p, isConnected: false } : p)),
      }))

    case 'PHASE_CHANGED': {
      const next: GameState = {
        ...state,
        phase:       action.phase,
        phaseEndsAt: action.endsAt,
        puzzle:      action.puzzle ?? (action.phase === 'lobby' ? null : state.puzzle),
        summary:     action.phase === 'results' ? state.summary : null,
        reveal:      action.phase === 'results' ? state.reveal : false,
      }
      // A new round starts with a clean board
      if (action.phase === 'submission') {
        const round = (state.roomState?.roundNumber ?? 0) + 1
        next.intro = action.puzzle ? { round, title: action.puzzle.title } : null
        return withRoom(next, (rs) => ({
          ...rs, submissions: [], voteCounts: [], myVotes: {}, myHints: [], roundNumber: rs.roundNumber + 1,
        }))
      }
      return next
    }

    case 'SUBMISSION_MADE':
      return withRoom(state, (rs) => ({
        ...rs,
        submissions: rs.submissions.some((s) => s.id === action.submission.id)
          ? rs.submissions
          : [...rs.submissions, action.submission],
      }))

    case 'VOTE_UPDATE':
      return withRoom(state, (rs) => {
        const entry = { submissionId: action.submissionId, ups: action.ups, downs: action.downs }
        return {
          ...rs,
          voteCounts: rs.voteCounts.some((v) => v.submissionId === action.submissionId)
            ? rs.voteCounts.map((v) => (v.submissionId === action.submissionId ? entry : v))
            : [...rs.voteCounts, entry],
        }
      })

    case 'MY_VOTE':
      return withRoom(state, (rs) => ({
        ...rs, myVotes: { ...rs.myVotes, [action.submissionId]: action.vote },
      }))

    case 'MY_HINTS':
      return withRoom(state, (rs) => ({ ...rs, myHints: action.hints }))

    case 'ROUND_RESULTS':
      return withRoom(
        {
          ...state, phase: 'results', phaseEndsAt: null, summary: action.summary,
          intro: null, reveal: action.summary.deltas.length > 0,
        },
        (rs) => ({ ...rs, players: action.players }),
      )

    case 'GAME_ENDED':
      return { ...state, phase: 'finished', finalLeaderboard: action.leaderboard }

    case 'CONNECTED':
      return { ...state, connected: action.v }

    case 'ROOM_DELETED':
      return { ...state, deleted: true }

    case 'INTRO_DONE':
      return { ...state, intro: null }

    case 'REVEAL_DONE':
      return { ...state, reveal: false }

    default:
      return state
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Room() {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(reducer, initial)
  const [showRules, setShowRules] = useState(false)
  const [showBoard, setShowBoard] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // Read once: it's cleared from storage if the room is deleted, and the page must not jump home then
  const [playerId] = useState(() => getMyPlayerId(roomId))

  useEffect(() => {
    if (!playerId) navigate('/')
  }, [playerId, navigate])

  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'FULL_STATE':      dispatch({ type: 'SET_STATE', state: msg.state }); break
      case 'PLAYER_JOINED':
      case 'PLAYER_UPDATED':  dispatch({ type: 'UPSERT_PLAYER', player: msg.player }); break
      case 'PLAYER_LEFT':     dispatch({ type: 'PLAYER_LEFT', playerId: msg.playerId }); break
      case 'PHASE_CHANGED':   dispatch({ type: 'PHASE_CHANGED', phase: msg.phase, endsAt: msg.endsAt, puzzle: msg.puzzle }); break
      case 'SUBMISSION_MADE': dispatch({ type: 'SUBMISSION_MADE', submission: msg.submission }); break
      case 'VOTE_UPDATE':     dispatch({ type: 'VOTE_UPDATE', submissionId: msg.submissionId, ups: msg.ups, downs: msg.downs }); break
      case 'ROUND_RESULTS':   dispatch({ type: 'ROUND_RESULTS', summary: msg.summary, players: msg.players }); break
      case 'ROOM_DELETED':    dispatch({ type: 'ROOM_DELETED' }); break
      case 'GAME_ENDED':
        dispatch({ type: 'GAME_ENDED', leaderboard: msg.leaderboard })
        setTimeout(() => navigate(`/room/${roomId}/final`), 4000)
        break
    }
  }, [navigate, roomId])

  const onOpen  = useCallback(() => dispatch({ type: 'CONNECTED', v: true }),  [])
  const onClose = useCallback(() => dispatch({ type: 'CONNECTED', v: false }), [])

  useWebSocket({ roomId, playerId, onMessage, onOpen, onClose })

  // A deleted room refuses the WebSocket, so check it exists rather than retrying forever
  useEffect(() => {
    fetch(apiUrl(`/api/rooms/${roomId}`))
      .then((r) => { if (r.status === 404) dispatch({ type: 'ROOM_DELETED' }) })
      .catch(() => {})
  }, [roomId])

  useEffect(() => {
    if (!state.deleted) return
    localStorage.removeItem(`playerId:${roomId}`)
    localStorage.removeItem(`username:${roomId}`)
  }, [state.deleted, roomId])

  const closeReveal = useCallback(() => dispatch({ type: 'REVEAL_DONE' }), [])

  const flash = useCallback((id: string) => {
    setHighlightId(id)
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1300)
  }, [])

  if (state.deleted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-4xl font-bold">This room was deleted</h1>
        <p className="max-w-sm text-ink-3">The host closed it for good. Ask them for a new room code to keep playing.</p>
        <button className="btn-primary mt-2" onClick={() => navigate('/')}>Back to home</button>
      </div>
    )
  }

  if (!state.roomState) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-3">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 animate-pulse rounded-full ${state.connected ? 'bg-up' : 'bg-ink-4'}`} />
          {state.connected ? 'Loading room…' : 'Connecting…'}
        </div>
      </div>
    )
  }

  const { roomState, puzzle, phase } = state
  const config = roomState.room.config
  const me = roomState.players.find((p) => p.id === playerId)
  const ranked = rankPlayers(roomState.players)
  const myRank = ranked.findIndex((p) => p.id === playerId) + 1
  const mySubmission = roomState.submissions.find((s) => s.playerId === playerId)
  const online = roomState.players.filter((p) => p.isConnected).length

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-lg font-bold tracking-tight">blackbox</span>
            <span className="h-5 w-px bg-line" aria-hidden />
            <span className="truncate font-semibold text-ink-2">{roomState.room.name}</span>
            {roomState.currentRound && phase !== 'finished' && (
              <span className="chip-neutral shrink-0">Round {roomState.roundNumber}</span>
            )}
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            {phase === 'submission' && <Timer endsAt={state.phaseEndsAt} />}

            {me && (
              <button
                onClick={() => setShowBoard(true)}
                title="Open the leaderboard"
                className="flex items-center gap-3 rounded-xl border-2 border-ink bg-white px-3 py-1.5 text-left shadow-pop transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-pop-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
              >
                <div className="leading-tight">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Wallet</div>
                  <div className="tabular font-display text-lg font-semibold">{me.wallet.toLocaleString()}</div>
                </div>
                {myRank > 0 && (
                  <div className="border-l border-line pl-3 leading-tight">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Rank</div>
                    <div className="tabular font-display text-lg font-semibold">
                      #{myRank}<span className="text-sm text-ink-4">/{ranked.length}</span>
                    </div>
                  </div>
                )}
              </button>
            )}

            <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setShowRules(true)}>
              Rules
            </button>

            <span
              className={`h-2.5 w-2.5 rounded-full ${state.connected ? 'bg-up' : 'animate-pulse bg-down'}`}
              title={state.connected ? 'Live' : 'Reconnecting…'}
              aria-label={state.connected ? 'Connected' : 'Reconnecting'}
            />
          </div>
        </div>
        {phase === 'submission' && <TimeBar endsAt={state.phaseEndsAt} totalSecs={config.phase1Secs} />}
      </header>

      {!state.connected && (
        <div className="bg-down px-4 py-2 text-center text-sm font-medium text-white">
          Connection lost. Reconnecting…
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {phase === 'lobby' && (
          <LobbyView roomState={roomState} online={online} playerId={playerId} />
        )}

        {phase === 'submission' && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
            <div className="flex flex-col gap-6">
              {puzzle ? <PuzzlePanel puzzle={puzzle} /> : <div className="card text-ink-3">Loading puzzle…</div>}

              {puzzle && !mySubmission && (
                <FormulaInput
                  key={roomState.currentRound?.id}
                  columns={puzzle.columns}
                  roomId={roomId}
                  playerId={playerId}
                  stake={config.postStake}
                  wallet={me?.wallet ?? 0}
                  onSubmitted={() => {}}
                  onDuplicate={flash}
                />
              )}

              {mySubmission && (
                <section className="card-pop flex flex-col gap-3 animate-pop-in">
                  <span className="chip-up w-fit">✓ Your claim is live</span>
                  <div className="font-display text-2xl font-medium break-words">
                    <Formula expr={mySubmission.expr} />
                  </div>
                  <p className="text-ink-2">
                    {config.postStake} coins staked. Now use your votes on the board. Back the formulas you trust, doubt the ones you don't.
                  </p>
                </section>
              )}

              {puzzle && (
                <HintPanel
                  roomId={roomId}
                  playerId={playerId}
                  hints={roomState.myHints}
                  hintCount={puzzle.hintCount}
                  cost={config.hintCost}
                  wallet={me?.wallet ?? 0}
                  onBought={(hints) => dispatch({ type: 'MY_HINTS', hints })}
                />
              )}
            </div>

            <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
              <Leaderboard
                players={roomState.players}
                myPlayerId={playerId}
                limit={5}
                title="Standings"
                onShowAll={() => setShowBoard(true)}
              />
              <EntryFeed
                submissions={roomState.submissions}
                voteCounts={roomState.voteCounts}
                myVotes={roomState.myVotes}
                myPlayerId={playerId}
                roomId={roomId}
                votesPerRound={config.votesPerRound}
                stake={config.voteStake}
                wallet={me?.wallet ?? 0}
                highlightId={highlightId}
                onVoted={(submissionId, vote) => dispatch({ type: 'MY_VOTE', submissionId, vote })}
              />
            </div>
          </div>
        )}

        {phase === 'results' && state.summary && (
          <div className="mx-auto grid max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex flex-col gap-6">
              <ResultsPanel summary={state.summary} myPlayerId={playerId} />
              <p className="text-center text-ink-3">Waiting for the host to start the next round…</p>
            </div>
            <div className="lg:sticky lg:top-24">
              <Leaderboard
                players={roomState.players}
                myPlayerId={playerId}
                deltas={state.summary.deltas}
                title="Standings after this round"
              />
            </div>
          </div>
        )}

        {phase === 'finished' && (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center animate-pop-in">
            <h1 className="text-5xl font-bold">Game over</h1>
            <p className="text-ink-3">Taking you to the final leaderboard…</p>
            <button className="btn-secondary mt-2" onClick={() => navigate(`/room/${roomId}/final`)}>
              See leaderboard now
            </button>
          </div>
        )}
      </main>

      {showRules && <RulesDialog config={config} onClose={() => setShowRules(false)} />}
      {state.intro && (
        <RoundIntro
          key={state.intro.round}
          round={state.intro.round}
          title={state.intro.title}
          onDone={() => dispatch({ type: 'INTRO_DONE' })}
        />
      )}
      {state.reveal && state.summary && phase === 'results' && (
        <StandingsReveal
          round={roomState.roundNumber}
          players={roomState.players}
          summary={state.summary}
          myPlayerId={playerId}
          onClose={closeReveal}
        />
      )}
      {showBoard && (
        <LeaderboardDialog players={roomState.players} myPlayerId={playerId} onClose={() => setShowBoard(false)} />
      )}
    </div>
  )
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyView({ roomState, online, playerId }: { roomState: RoomState; online: number; playerId: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <section className="flex flex-col items-center gap-5 py-6 text-center">
        <div className="flex items-center gap-3 font-display text-xl font-semibold text-ink-3 sm:text-2xl">
          <span>x</span>
          <span aria-hidden>→</span>
          <span className="rounded-xl bg-ink px-4 py-1.5 text-white">? ? ?</span>
          <span aria-hidden>→</span>
          <span>y</span>
        </div>
        <h1 className="text-4xl font-bold sm:text-5xl">Waiting for the host</h1>
        <p className="text-lg text-ink-2">
          <span className="font-semibold text-ink">{online}</span> player{online === 1 ? '' : 's'} here.
          Read the rules while you wait. The round starts as soon as the host is ready.
        </p>
        <button
          className="card-pop flex items-center gap-4 px-5 py-3 transition-transform hover:-translate-y-0.5"
          onClick={() => {
            navigator.clipboard?.writeText(roomState.room.id).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }).catch(() => {})
          }}
        >
          <span className="eyebrow">Room code</span>
          <span className="tabular font-display text-2xl font-semibold tracking-wider">{roomState.room.id}</span>
          <span className="chip-neutral">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card">
          <h2 className="mb-5 text-2xl font-semibold">How to play</h2>
          <RulesContent config={roomState.room.config} />
        </section>
        <Leaderboard players={roomState.players} myPlayerId={playerId} />
      </div>
    </div>
  )
}

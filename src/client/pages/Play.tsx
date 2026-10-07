import { useReducer, useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  ServerMessage, GameState, TeamInfo, BatchInfo, BatchSummary,
  PuzzleForPlayers, ImagePuzzleForPlayers, PublicSubmission, VoteType, BatchId, Verdict,
} from '../types'
import { useWebSocket }   from '../hooks/useWebSocket'
import { getTeam, getToken, clearSession, authFetch } from '../lib/session'
import TeammateLink       from '../components/TeammateLink'
import PuzzlePanel        from '../components/PuzzlePanel'
import FormulaInput       from '../components/FormulaInput'
import EntryFeed          from '../components/EntryFeed'
import HintPanel          from '../components/HintPanel'
import ImagePuzzleView    from '../components/ImagePuzzleView'
import Leaderboard, { LeaderboardDialog } from '../components/Leaderboard'

// ─── Puzzle detail (loaded via REST on demand) ────────────────────────────────

interface NumericalPuzzleDetail {
  puzzle:          PuzzleForPlayers
  submissions:     PublicSubmission[]
  myVotes:         Record<string, VoteType>
  myHints:         string[]
  submissionsOpen: boolean
  votingOpen:      boolean
  solution?:       string
}

interface ImagePuzzleDetail {
  puzzle:          ImagePuzzleForPlayers
  submissions:     PublicSubmission[]
  myVotes:         Record<string, VoteType>
  submissionsOpen: boolean
  votingOpen:      boolean
  solution?:       string[]
}

type PuzzleDetail = NumericalPuzzleDetail | ImagePuzzleDetail

// ─── Reducer ─────────────────────────────────────────────────────────────────

interface PlayState {
  gameState:       GameState | null
  connected:       boolean
  finalLeaderboard: import('../types').LeaderboardEntry[] | null
  batchSummaries:  Record<BatchId, BatchSummary>
}

const initial: PlayState = {
  gameState: null, connected: false, finalLeaderboard: null, batchSummaries: {} as Record<BatchId, BatchSummary>,
}

type Action =
  | { type: 'SET_STATE';      state: GameState }
  | { type: 'UPSERT_TEAM';    team: TeamInfo }
  | { type: 'BATCH_UPDATED';  batch: BatchInfo }
  | { type: 'BATCH_SETTLED';  batchId: BatchId; summary: BatchSummary; teams: TeamInfo[] }
  | { type: 'BATCH_REOPENED'; batchId: BatchId; teams: TeamInfo[] }
  | { type: 'GAME_ENDED';     leaderboard: import('../types').LeaderboardEntry[] }
  | { type: 'CONNECTED';      v: boolean }

function reducer(state: PlayState, action: Action): PlayState {
  switch (action.type) {
    case 'SET_STATE':
      return { ...state, gameState: action.state }

    case 'UPSERT_TEAM':
      if (!state.gameState) return state
      return {
        ...state,
        gameState: {
          ...state.gameState,
          teams: state.gameState.teams.some((t) => t.id === action.team.id)
            ? state.gameState.teams.map((t) => t.id === action.team.id ? action.team : t)
            : [...state.gameState.teams, action.team],
        },
      }

    case 'BATCH_UPDATED':
      if (!state.gameState) return state
      return {
        ...state,
        gameState: {
          ...state.gameState,
          batches: state.gameState.batches.map((b) => b.id === action.batch.id ? action.batch : b),
        },
      }

    case 'BATCH_SETTLED':
      if (!state.gameState) return state
      return {
        ...state,
        batchSummaries: { ...state.batchSummaries, [action.batchId]: action.summary },
        gameState: {
          ...state.gameState,
          teams: action.teams,
          batches: state.gameState.batches.map((b) =>
            b.id === action.batchId ? { ...b, status: 'settled', submissionsOpen: false, votingOpen: false } : b,
          ),
        },
      }

    case 'BATCH_REOPENED':
      if (!state.gameState) return state
      return {
        ...state,
        gameState: {
          ...state.gameState,
          teams: action.teams,
          batches: state.gameState.batches.map((b) =>
            b.id === action.batchId ? { ...b, status: 'open', submissionsOpen: true, votingOpen: true } : b,
          ),
        },
      }

    case 'GAME_ENDED':
      return { ...state, finalLeaderboard: action.leaderboard }

    case 'CONNECTED':
      return { ...state, connected: action.v }

    default: return state
  }
}

// ─── Batch / puzzle status helpers ───────────────────────────────────────────

const BATCH_ORDER: BatchId[] = ['easy', 'intermediate', 'image']

const DIFFICULTY_LABEL: Record<number, string> = { 1: 'Easy', 2: 'Intermediate', 3: 'Advanced' }

const VERDICT_CHIP: Record<Verdict, string> = {
  right: 'chip-up',
  close: 'chip-accent',
  wrong: 'chip-down',
}
const VERDICT_LABEL: Record<Verdict, string> = {
  right: '✓ Right',
  close: '≈ Close',
  wrong: '✗ Wrong',
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Play() {
  const navigate   = useNavigate()
  const myTeam     = getTeam()
  const [state, dispatch] = useReducer(reducer, initial)
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PuzzleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showTeammateLink, setShowTeammateLink] = useState(false)
  const [highlightSubId, setHighlightSubId] = useState<string | null>(null)
  const detailPuzzleRef = useRef<string | null>(null)

  const { gameState, connected, finalLeaderboard } = state

  // ─── WebSocket messages ─────────────────────────────────────────────────

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'FULL_STATE':
        dispatch({ type: 'SET_STATE', state: msg.state })
        break
      case 'TEAM_JOINED':
      case 'TEAM_UPDATED':
        dispatch({ type: 'UPSERT_TEAM', team: msg.team })
        break
      case 'BATCH_UPDATED':
        dispatch({ type: 'BATCH_UPDATED', batch: msg.batch })
        break
      case 'SUBMISSION_MADE':
        if (msg.puzzleId === detailPuzzleRef.current) {
          setDetail((d) => d ? { ...d, submissions: [...d.submissions.filter((s) => s.id !== msg.submission.id), msg.submission] } : d)
        }
        break
      case 'VOTE_CAST':
        if (msg.puzzleId === detailPuzzleRef.current) {
          setDetail((d) => d ? {
            ...d,
            submissions: d.submissions.map((s) =>
              s.id === msg.submissionId ? { ...s, ups: msg.ups, downs: msg.downs } : s,
            ),
          } : d)
        }
        break
      case 'BATCH_SETTLED':
        dispatch({ type: 'BATCH_SETTLED', batchId: msg.batchId, summary: msg.summary, teams: msg.teams })
        // Refresh puzzle detail if it's in the settled batch
        if (detailPuzzleRef.current) refreshDetail(detailPuzzleRef.current)
        break
      case 'BATCH_REOPENED':
        dispatch({ type: 'BATCH_REOPENED', batchId: msg.batchId, teams: msg.teams })
        if (detailPuzzleRef.current) refreshDetail(detailPuzzleRef.current)
        break
      case 'GAME_ENDED':
        dispatch({ type: 'GAME_ENDED', leaderboard: msg.leaderboard })
        setTimeout(() => navigate('/final'), 3000)
        break
      case 'GAME_RESET':
        clearSession()
        navigate('/')
        break
    }
  }, [navigate])

  const signOut = useCallback((reason: string) => {
    clearSession()
    navigate('/', { replace: true, state: { signedOut: reason } })
  }, [navigate])

  const onSocketClose = useCallback((code: number) => {
    dispatch({ type: 'CONNECTED', v: false })
    if (code === 4001) {
      signOut("This laptop was signed out because the host reset your team's login or removed your team.")
      return
    }
    // A revoked token is refused before the socket opens, which looks like an
    // ordinary dropped connection, so ask the server whether the login still works.
    if (code !== 1000 && code !== 4000) {
      authFetch('/api/auth/me').then((res) => {
        if (res.status === 401) signOut("This laptop's login doesn't work any more. The host may have reset it.")
      }).catch(() => { /* offline; the socket keeps retrying */ })
    }
  }, [signOut])

  useWebSocket({
    onMessage: handleMessage,
    onOpen:    () => dispatch({ type: 'CONNECTED', v: true }),
    onClose:   onSocketClose,
  })

  // ─── Load puzzle detail ─────────────────────────────────────────────────

  async function loadDetail(puzzleId: string) {
    detailPuzzleRef.current = puzzleId
    setDetailLoading(true)
    try {
      const res = await authFetch(`/api/puzzles/${puzzleId}`)
      if (!res.ok) { setDetail(null); return }
      const data = await res.json() as PuzzleDetail
      setDetail(data)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshDetail(puzzleId: string) {
    if (detailPuzzleRef.current !== puzzleId) return
    const res = await authFetch(`/api/puzzles/${puzzleId}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json() as PuzzleDetail
    setDetail(data)
  }

  function selectPuzzle(puzzleId: string) {
    setSelectedPuzzleId(puzzleId)
    setSidebarOpen(false)
    loadDetail(puzzleId)
  }

  // ─── Reload detail on my wallet change (for hint/vote coins update) ─────
  // Only my own team's wallet: keying on every team's would make each laptop
  // refetch the puzzle whenever anyone posts or votes.

  const myWallet = gameState?.teams.find((t) => t.id === gameState.myTeamId)?.wallet
  useEffect(() => {
    if (selectedPuzzleId) refreshDetail(selectedPuzzleId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myWallet])

  // ─── Derived values ─────────────────────────────────────────────────────

  const myTeamId   = gameState?.myTeamId ?? null
  const myGameTeam = gameState?.teams.find((t) => t.id === myTeamId)
  const config     = gameState?.config
  const batches    = gameState?.batches ?? []

  const visibleBatches = batches.filter((b) => b.status !== 'hidden')

  // ─── Redirects ──────────────────────────────────────────────────────────

  if (!myTeam) { navigate('/'); return null }

  // ─── Final leaderboard redirect ─────────────────────────────────────────

  if (finalLeaderboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-center">
        <div>
          <div className="text-5xl font-bold mb-4">Game over!</div>
          <p className="text-ink-3">Heading to the final leaderboard…</p>
        </div>
      </div>
    )
  }

  // ─── Empty state (no batches open yet) ──────────────────────────────────

  function WaitingState() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-8">
        <div className="font-display text-2xl font-semibold">Waiting for the game to start</div>
        <p className="text-ink-3 max-w-sm">
          The admin hasn't opened any batches yet. Hang tight — they'll appear in the sidebar when it's time.
        </p>
        <div className={`h-3 w-3 rounded-full ${connected ? 'bg-up' : 'bg-line'} animate-pulse`} />
      </div>
    )
  }

  // ─── Puzzle workspace ───────────────────────────────────────────────────

  const selectedPuzzle = selectedPuzzleId
    ? visibleBatches.flatMap((b) => b.puzzles).find((p) => p.id === selectedPuzzleId)
    : null

  const selectedBatch = selectedPuzzle
    ? batches.find((b) => b.id === selectedPuzzle.batchId)
    : null

  const mySubmissionVerdict = selectedPuzzleId
    ? (gameState?.mySubmissions?.[selectedPuzzleId] ?? undefined)
    : undefined

  const hasSubmitted = selectedPuzzleId ? selectedPuzzleId in (gameState?.mySubmissions ?? {}) : false

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button
          className="btn-ghost p-2 text-xl lg:hidden"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <span className="font-display font-bold tracking-tight">whackamodel</span>

        <div className="flex flex-1 items-center justify-end gap-3 text-sm">
          {myGameTeam && (
            <>
              <span className="hidden font-semibold sm:inline">{myGameTeam.name}</span>
              <span className="tabular font-display font-bold text-accent">
                {myGameTeam.wallet.toLocaleString()}
                <span className="ml-1 text-xs font-normal text-ink-3">coins</span>
              </span>
              {config && (
                <span className="hidden text-ink-3 sm:inline">
                  {gameState.myVotesUsed}/{config.voteBudget} votes
                </span>
              )}
            </>
          )}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowLeaderboard(true)}>
            Standings
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowTeammateLink(true)}>
            Teammate link
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => {
            if (!confirm('Log out this laptop? To sign back in, open the teammate link from your other laptop, or ask the host to reset your login.')) return
            clearSession(); navigate('/')
          }}>
            Log out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar overlay on mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`
          fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-line bg-white pt-16 lg:pt-0
          transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:translate-x-0 lg:pt-0
        `}>
          <div className="p-4">
            <div className="eyebrow mb-3">Puzzles</div>

            {visibleBatches.length === 0 ? (
              <p className="text-sm text-ink-3">No batches open yet.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {BATCH_ORDER.map((batchId) => {
                  const batch = batches.find((b) => b.id === batchId)
                  if (!batch || batch.status === 'hidden') return null
                  return (
                    <div key={batchId}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm font-semibold">{batch.name}</span>
                        <span className={`chip text-xs px-2 py-0.5 ${batch.status === 'settled' ? 'chip-neutral' : 'chip-accent'}`}>
                          {batch.status === 'settled' ? 'Settled' : batch.submissionsOpen ? 'Open' : 'Voting only'}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-0.5">
                        {batch.puzzles.map((puzzle) => {
                          const verdict = gameState?.mySubmissions?.[puzzle.id]
                          const submitted = puzzle.id in (gameState?.mySubmissions ?? {})
                          const isSelected = puzzle.id === selectedPuzzleId
                          return (
                            <li key={puzzle.id}>
                              <button
                                onClick={() => selectPuzzle(puzzle.id)}
                                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                  isSelected
                                    ? 'bg-accent-soft font-semibold text-ink'
                                    : 'text-ink-2 hover:bg-paper hover:text-ink'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{puzzle.title}</span>
                                  {submitted && verdict !== undefined && (
                                    <span className={`shrink-0 chip text-xs px-1.5 py-0.5 ${
                                      verdict === 'right' ? 'chip-up' :
                                      verdict === 'close' ? 'chip-accent' :
                                      verdict === null    ? 'chip-cobalt' : 'chip-down'
                                    }`}>
                                      {verdict === null ? '…' :
                                       verdict === 'right' ? '✓' :
                                       verdict === 'close' ? '≈' : '✗'}
                                    </span>
                                  )}
                                </div>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Main workspace */}
        <main className="flex-1 overflow-y-auto">
          {!selectedPuzzle ? (
            <WaitingState />
          ) : detailLoading ? (
            <div className="flex h-full items-center justify-center text-ink-3">Loading puzzle…</div>
          ) : !detail ? (
            <div className="flex h-full items-center justify-center text-ink-3">Could not load puzzle.</div>
          ) : detail.puzzle.puzzleType === 'image' ? (

            // ── Image puzzle workspace ──────────────────────────────────────
            <div className="mx-auto max-w-4xl p-4 pb-16 lg:p-6">
              <ImagePuzzleView
                puzzle={(detail as ImagePuzzleDetail).puzzle}
                submissions={detail.submissions}
                myVotes={detail.myVotes}
                myTeamId={myTeamId ?? ''}
                voteBudget={config?.voteBudget ?? 0}
                votesUsed={gameState?.myVotesUsed ?? 0}
                voteStake={config?.voteStake ?? 0}
                wallet={myGameTeam?.wallet ?? 0}
                submissionsOpen={detail.submissionsOpen}
                votingOpen={detail.votingOpen}
                postStake={config?.postStake ?? 0}
                hasSubmitted={hasSubmitted}
                settled={!!(detail as ImagePuzzleDetail).solution}
                solution={(detail as ImagePuzzleDetail).solution}
                onSubmitted={() => {
                  refreshDetail(selectedPuzzleId!)
                  dispatch({ type: 'SET_STATE', state: { ...gameState!, mySubmissions: { ...gameState!.mySubmissions, [selectedPuzzleId!]: null } } })
                }}
                onVoted={(subId, vote) => {
                  setDetail((d) => d ? { ...d, myVotes: { ...d.myVotes, [subId]: vote } } : d)
                  dispatch({ type: 'SET_STATE', state: { ...gameState!, myVotesUsed: (gameState?.myVotesUsed ?? 0) + 1 } })
                }}
              />
            </div>

          ) : (

            // ── Numerical puzzle workspace ──────────────────────────────────
            <div className="mx-auto max-w-3xl space-y-6 p-4 pb-16 lg:p-6">
              {selectedBatch && !detail.submissionsOpen && !detail.solution && (
                <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-3">
                  {detail.votingOpen
                    ? 'Submissions are closed — you can still vote.'
                    : 'This batch is closed. Waiting for settlement.'}
                </div>
              )}

              {(detail as NumericalPuzzleDetail).solution && (
                <div className="card-pop animate-pop-in">
                  <div className="eyebrow mb-2">Solution revealed</div>
                  <div className="font-display text-2xl font-semibold">
                    y = {(detail as NumericalPuzzleDetail).solution}
                  </div>
                  {mySubmissionVerdict !== undefined && mySubmissionVerdict !== null && (
                    <div className={`mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2 font-semibold text-sm ${
                      mySubmissionVerdict === 'right' ? 'bg-up-soft text-up' :
                      mySubmissionVerdict === 'close' ? 'bg-accent-soft text-accent-dark' :
                      'bg-down-soft text-down'
                    }`}>
                      {VERDICT_LABEL[mySubmissionVerdict]}
                      {mySubmissionVerdict === 'right' ? ' — your formula was correct!' :
                       mySubmissionVerdict === 'close' ? ' — right shape, wrong numbers' :
                       ' — not quite right'}
                    </div>
                  )}
                </div>
              )}

              <PuzzlePanel puzzle={(detail as NumericalPuzzleDetail).puzzle} />

              <HintPanel
                puzzleId={selectedPuzzleId!}
                hints={(detail as NumericalPuzzleDetail).myHints}
                hintCount={(detail as NumericalPuzzleDetail).puzzle.hintCount}
                cost={config?.hintCost ?? 0}
                wallet={myGameTeam?.wallet ?? 0}
                disabled={!!(detail as NumericalPuzzleDetail).solution}
                onBought={(hints) => setDetail((d) => d ? { ...d, myHints: hints } : d)}
              />

              {detail.submissionsOpen && !hasSubmitted && (
                <FormulaInput
                  columns={(detail as NumericalPuzzleDetail).puzzle.columns}
                  puzzleId={selectedPuzzleId!}
                  stake={config?.postStake ?? 0}
                  wallet={myGameTeam?.wallet ?? 0}
                  onSubmitted={() => {
                    refreshDetail(selectedPuzzleId!)
                    dispatch({ type: 'SET_STATE', state: { ...gameState!, mySubmissions: { ...gameState!.mySubmissions, [selectedPuzzleId!]: null } } })
                  }}
                  onDuplicate={(subId) => setHighlightSubId(subId)}
                />
              )}

              {hasSubmitted && !(detail as NumericalPuzzleDetail).solution && (
                <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-3">
                  Your team posted a formula for this puzzle. Voting is {detail.votingOpen ? 'open' : 'closed'}.
                </div>
              )}

              <EntryFeed
                submissions={detail.submissions}
                myTeamId={myTeamId ?? ''}
                myVotes={detail.myVotes}
                voteBudget={config?.voteBudget ?? 0}
                votesUsed={gameState?.myVotesUsed ?? 0}
                voteStake={config?.voteStake ?? 0}
                wallet={myGameTeam?.wallet ?? 0}
                votingOpen={detail.votingOpen}
                puzzleId={selectedPuzzleId!}
                highlightId={highlightSubId}
                settled={!!(detail as NumericalPuzzleDetail).solution}
                onVoted={(subId, vote) => {
                  setDetail((d) => d ? { ...d, myVotes: { ...d.myVotes, [subId]: vote } } : d)
                  dispatch({ type: 'SET_STATE', state: { ...gameState!, myVotesUsed: (gameState?.myVotesUsed ?? 0) + 1 } })
                }}
              />
            </div>
          )}
        </main>
      </div>

      {showLeaderboard && gameState && (
        <LeaderboardDialog
          teams={gameState.teams}
          myTeamId={myTeamId ?? ''}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      {showTeammateLink && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[12vh] animate-fade-in"
          onClick={() => setShowTeammateLink(false)}>
          <div role="dialog" aria-modal aria-label="Teammate link"
            className="card-pop flex w-full max-w-md flex-col gap-4 animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Sign in your teammate&rsquo;s laptop</h3>
            <TeammateLink token={getToken() ?? ''} />
            <button className="btn-secondary" onClick={() => setShowTeammateLink(false)} autoFocus>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

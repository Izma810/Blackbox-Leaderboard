import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PuzzleInfo {
  id: string
  title: string
  description: string
  difficulty: 1 | 2 | 3
  columns: string[]
}

interface AdminRoomState {
  room: {
    id: string
    name: string
    status: string
    config: {
      phase1Secs: number
      phase2Secs: number
      posterReward: number
      voterReward: number
      votesPerRound: number
      anonymousVoting: boolean
      maxRounds: number | null
      startingWallet: number
    }
  }
  players: Array<{
    id: string; username: string; wallet: number
    totalScore: number; isConnected: boolean
  }>
  currentRound: {
    id: string; phase: string; puzzleId: string
    roundNumber: number; phaseEndsAt: number | null
  } | null
  submissions: Array<{ id: string; label: string; features: unknown[]; playerId: string }>
  roundNumber: number
  correctAnswer: {
    solutionFeatures: unknown[]
    correctPowerMap: Record<string, number>
  } | null
}

interface SavedRoom { id: string; name: string }

const SESSION_KEY = 'adminPassword'
const ROOMS_KEY   = 'adminRooms'
const DIFF_LABEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Challenge' }
const DIFF_COLOR: Record<number, string>  = { 1: 'badge-green', 2: 'badge-yellow', 3: 'badge-red' }

// ─── Root component ───────────────────────────────────────────────────────────

export default function Admin() {
  const navigate = useNavigate()

  // Master password — stored in sessionStorage (cleared on tab close)
  const [password, setPassword] = useState<string>(
    () => sessionStorage.getItem(SESSION_KEY) ?? '',
  )
  const [isAuthed, setIsAuthed] = useState(false)

  // Verify on mount if we have a cached password
  useEffect(() => {
    if (password) verifyPassword(password).then(setIsAuthed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY)
    setPassword('')
    setIsAuthed(false)
  }

  if (!isAuthed) {
    return (
      <LoginPage
        onSuccess={(pwd) => {
          sessionStorage.setItem(SESSION_KEY, pwd)
          setPassword(pwd)
          setIsAuthed(true)
        }}
      />
    )
  }

  return <AdminPanel password={password} onLogout={handleLogout} navigate={navigate} />
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function verifyPassword(pwd: string): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    })
    return res.ok
  } catch {
    return false
  }
}

function authHeader(pwd: string): Record<string, string> {
  return { Authorization: `Bearer ${pwd}` }
}

function getSavedRooms(): SavedRoom[] {
  try { return JSON.parse(localStorage.getItem(ROOMS_KEY) ?? '[]') } catch { return [] }
}
function saveRoom(room: SavedRoom) {
  const rooms = getSavedRooms().filter((r) => r.id !== room.id)
  localStorage.setItem(ROOMS_KEY, JSON.stringify([room, ...rooms]))
}

// ─── Login page ───────────────────────────────────────────────────────────────

function LoginPage({ onSuccess }: { onSuccess: (pwd: string) => void }) {
  const navigate = useNavigate()
  const [input, setInput]     = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!input) return

    setLoading(true)
    const ok = await verifyPassword(input)
    setLoading(false)

    if (ok) {
      onSuccess(input)
    } else {
      setError('Incorrect password')
      setInput('')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <div className="text-zinc-600 text-xs uppercase tracking-widest mb-2">Restricted area</div>
        <h1 className="text-2xl font-bold text-zinc-100">Admin Login</h1>
        <p className="text-zinc-500 text-sm mt-1 max-w-xs mx-auto">
          This area is for instructors only. Players should join from the home page.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card w-full max-w-xs flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pwd" className="text-xs text-zinc-500">Admin password</label>
          <input
            id="pwd"
            type="password"
            className="input"
            placeholder="Enter admin password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-center">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading || !input}>
          {loading ? 'Verifying…' : 'Login'}
        </button>
      </form>

      <button
        className="text-zinc-700 hover:text-zinc-500 text-xs transition-colors"
        onClick={() => navigate('/')}
      >
        ← Back to player join page
      </button>
    </div>
  )
}

// ─── Admin panel (after login) ────────────────────────────────────────────────

function AdminPanel({
  password,
  onLogout,
  navigate,
}: {
  password: string
  onLogout: () => void
  navigate: ReturnType<typeof useNavigate>
}) {
  // Sidebar: saved rooms list + create new
  const [savedRooms, setSavedRooms]       = useState<SavedRoom[]>(getSavedRooms)
  const [activeRoomId, setActiveRoomId]   = useState<string>(getSavedRooms()[0]?.id ?? '')

  // Create room form
  const [showCreate, setShowCreate]   = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [creating, setCreating]       = useState(false)
  const [createErr, setCreateErr]     = useState('')

  // Active room state
  const [roomState, setRoomState]         = useState<AdminRoomState | null>(null)
  const [puzzles, setPuzzles]             = useState<PuzzleInfo[]>([])
  const [selectedPuzzle, setSelectedPuzzle] = useState('')
  const [actionErr, setActionErr]         = useState('')
  const [loading, setLoading]             = useState(false)
  const [editConfig, setEditConfig]       = useState(false)
  const [cfgDraft, setCfgDraft]           = useState<Record<string, unknown>>({})

  // Load puzzle list once
  useEffect(() => {
    fetch('/api/admin/puzzles')
      .then((r) => r.json())
      .then((d: any) => setPuzzles(d.puzzles ?? []))
      .catch(() => {})
  }, [])

  // Poll active room state every 3 s
  const fetchState = useCallback(async () => {
    if (!activeRoomId) return
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/admin/state`, {
        headers: authHeader(password),
      })
      if (res.ok) setRoomState(await res.json())
      else setRoomState(null)
    } catch {}
  }, [activeRoomId, password])

  useEffect(() => {
    setRoomState(null)
    setActionErr('')
    setEditConfig(false)
    if (!activeRoomId) return
    fetchState()
    const id = setInterval(fetchState, 3000)
    return () => clearInterval(id)
  }, [activeRoomId, fetchState])

  // ── Create room ────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateErr('')
    if (!newRoomName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(password) },
        body: JSON.stringify({ name: newRoomName.trim() }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok || !data.id) { setCreateErr(data.error ?? 'Failed'); return }

      const newRoom: SavedRoom = { id: data.id, name: newRoomName.trim() }
      saveRoom(newRoom)
      setSavedRooms(getSavedRooms())
      setActiveRoomId(data.id)
      setNewRoomName('')
      setShowCreate(false)
    } catch {
      setCreateErr('Network error')
    } finally {
      setCreating(false)
    }
  }

  // ── Room action ────────────────────────────────────────────────────────────
  async function doAction(action: string, body: unknown = {}) {
    setActionErr('')
    setLoading(true)
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/admin/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(password) },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) setActionErr(data.error ?? 'Action failed')
      else fetchState()
    } catch {
      setActionErr('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function saveConfig() {
    setActionErr('')
    setLoading(true)
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/admin/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(password) },
        body: JSON.stringify(cfgDraft),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) setActionErr(data.error ?? 'Failed')
      else { setEditConfig(false); fetchState() }
    } catch {
      setActionErr('Network error')
    } finally {
      setLoading(false)
    }
  }

  const cfg   = roomState?.room.config
  const phase = roomState?.currentRound?.phase ?? 'lobby'
  const phaseColor: Record<string, string> = {
    lobby: 'badge-zinc', submission: 'badge-yellow',
    voting: 'badge-blue', results: 'badge-green', finished: 'badge-zinc',
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs font-mono uppercase tracking-wider">Admin Panel</span>
          {roomState && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-300 font-semibold">{roomState.room.name}</span>
              <span className={`badge ${phaseColor[phase]}`}>{phase}</span>
              <span className="text-zinc-600 text-xs">Round {roomState.roundNumber}</span>
            </>
          )}
        </div>
        <button
          onClick={onLogout}
          className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
        >
          Sign out
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar: room list ─────────────────────────────────────── */}
        <aside className="w-56 border-r border-zinc-800 flex flex-col overflow-y-auto shrink-0">
          <div className="p-3 border-b border-zinc-800">
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="btn-primary w-full text-sm py-1.5"
            >
              {showCreate ? '✕ Cancel' : '+ New Room'}
            </button>
          </div>

          {showCreate && (
            <form onSubmit={handleCreate} className="p-3 border-b border-zinc-800 flex flex-col gap-2">
              <input
                className="input text-sm py-1.5"
                placeholder="Room name"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                maxLength={50}
                autoFocus
              />
              {createErr && <p className="text-red-400 text-xs">{createErr}</p>}
              <button type="submit" className="btn-secondary text-xs py-1" disabled={creating || !newRoomName.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </form>
          )}

          <div className="flex-1 overflow-y-auto py-1">
            {savedRooms.length === 0 && (
              <p className="text-zinc-600 text-xs italic px-3 py-4 text-center">
                No rooms yet.<br />Create one above.
              </p>
            )}
            {savedRooms.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRoomId(r.id)}
                className={`
                  w-full text-left px-3 py-2.5 border-b border-zinc-800/50 text-sm transition-colors
                  ${activeRoomId === r.id
                    ? 'bg-brand-500/10 text-brand-400 border-l-2 border-l-brand-500'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300'}
                `}
              >
                <div className="font-medium truncate">{r.name}</div>
                <div className="text-xs text-zinc-600 font-mono truncate">{r.id}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Main content ────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
          {!activeRoomId && (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm italic">
              Select or create a room
            </div>
          )}

          {activeRoomId && !roomState && (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              Loading…
            </div>
          )}

          {activeRoomId && roomState && (
            <>
              {/* Share + action buttons */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">Share room ID with players</div>
                  <div className="flex items-center gap-2">
                    <code className="text-brand-400 font-bold text-lg bg-zinc-800 px-3 py-1.5 rounded-lg select-all">
                      {activeRoomId}
                    </code>
                    <button
                      className="btn-secondary text-xs py-1.5"
                      onClick={() => navigator.clipboard.writeText(activeRoomId)}
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => doAction('advance-phase')}
                    className="btn-secondary text-sm"
                    disabled={loading || phase === 'lobby' || phase === 'finished'}
                  >
                    Force Next Phase
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('End the game? This shows the final leaderboard to all players.'))
                        doAction('end-game')
                    }}
                    className="btn-danger text-sm"
                    disabled={loading}
                  >
                    End Game
                  </button>
                </div>
              </div>

              {actionErr && (
                <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  {actionErr}
                </div>
              )}

              {/* Players + current round */}
              <div className="grid md:grid-cols-2 gap-4">
                {/* Players */}
                <div className="card flex flex-col gap-3">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">
                    Players ({roomState.players.length})
                  </div>
                  {roomState.players.length === 0 && (
                    <p className="text-zinc-600 text-sm italic">Waiting for players to join…</p>
                  )}
                  {roomState.players.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${p.isConnected ? 'bg-brand-400' : 'bg-zinc-600'}`} />
                        <span className="text-zinc-300 truncate">{p.username}</span>
                      </div>
                      <div className="text-right text-xs text-zinc-500 tabular-nums shrink-0 ml-2">
                        <div className="text-zinc-300 font-medium">{p.wallet.toLocaleString()}</div>
                        <div>score {p.totalScore}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Round info */}
                <div className="card flex flex-col gap-3">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">Current Round</div>
                  {!roomState.currentRound ? (
                    <p className="text-zinc-600 text-sm italic">No active round</p>
                  ) : (
                    <>
                      <div className="text-sm">
                        <span className="text-zinc-500">Puzzle </span>
                        <span className="text-zinc-200">{roomState.currentRound.puzzleId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500 text-sm">Phase</span>
                        <span className={`badge ${phaseColor[phase]}`}>{phase}</span>
                      </div>
                      {roomState.correctAnswer && (
                        <div className="bg-zinc-800/70 rounded-lg p-3">
                          <div className="text-xs text-yellow-500/80 uppercase tracking-wider mb-2">
                            Correct answer — admin only
                          </div>
                          {(roomState.correctAnswer.solutionFeatures as unknown[]).map((f, i) => (
                            <code key={i} className="block text-brand-400 text-sm">
                              {typeof f === 'string' ? f : JSON.stringify(f)}
                            </code>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-zinc-500">
                        Submissions: {roomState.submissions.length}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Start next round */}
              {(phase === 'lobby' || phase === 'results') && (
                <div className="card flex flex-col gap-4">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">
                    {phase === 'results' ? 'Start Next Round' : 'Start First Round'}
                  </div>

                  <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
                    {puzzles.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPuzzle(p.id === selectedPuzzle ? '' : p.id)}
                        className={`
                          text-left px-3 py-2.5 rounded-lg border transition-all text-sm
                          ${selectedPuzzle === p.id
                            ? 'border-brand-500 bg-brand-500/10 text-zinc-100'
                            : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'}
                        `}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{p.title}</span>
                          <span className={`badge text-xs shrink-0 ${DIFF_COLOR[p.difficulty]}`}>
                            {DIFF_LABEL[p.difficulty]}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-600 mt-0.5">
                          {p.id} · cols: <span className="text-zinc-500">{p.columns.join(', ')}</span>
                        </div>
                        <div className="text-xs text-zinc-600 italic mt-0.5 line-clamp-1">
                          {p.description}
                        </div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => doAction('start-round', { puzzleId: selectedPuzzle })}
                    className="btn-primary"
                    disabled={!selectedPuzzle || loading}
                  >
                    {loading
                      ? 'Starting…'
                      : selectedPuzzle
                        ? `Start — "${puzzles.find((p) => p.id === selectedPuzzle)?.title ?? selectedPuzzle}"`
                        : 'Select a puzzle above'}
                  </button>
                </div>
              )}

              {/* Config */}
              <div className="card flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">Room Config</div>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => {
                      if (!editConfig && cfg) {
                        setCfgDraft({
                          phase1_secs:      cfg.phase1Secs,
                          phase2_secs:      cfg.phase2Secs,
                          poster_reward:    cfg.posterReward,
                          voter_reward:     cfg.voterReward,
                          votes_per_round:  cfg.votesPerRound,
                          anonymous_voting: cfg.anonymousVoting ? 1 : 0,
                          max_rounds:       cfg.maxRounds,
                          starting_wallet:  cfg.startingWallet,
                        })
                      }
                      setEditConfig(!editConfig)
                    }}
                  >
                    {editConfig ? 'Cancel' : 'Edit'}
                  </button>
                </div>

                {cfg && !editConfig && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {([
                      ['Phase 1',      `${cfg.phase1Secs}s`],
                      ['Phase 2',      `${cfg.phase2Secs}s`],
                      ['Poster ±',     `${cfg.posterReward} coins`],
                      ['Voter ±',      `${cfg.voterReward} coins`],
                      ['Votes/round',  String(cfg.votesPerRound)],
                      ['Start wallet', `${cfg.startingWallet} coins`],
                      ['Max rounds',   cfg.maxRounds ? String(cfg.maxRounds) : '∞'],
                      ['Anonymous',    cfg.anonymousVoting ? 'Yes' : 'No'],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="bg-zinc-800/50 rounded-lg p-2.5">
                        <div className="text-zinc-600 mb-0.5">{k}</div>
                        <div className="text-zinc-300 font-medium">{v}</div>
                      </div>
                    ))}
                  </div>
                )}

                {editConfig && (
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ['Phase 1 (secs)',    'phase1_secs'],
                      ['Phase 2 (secs)',    'phase2_secs'],
                      ['Poster reward',     'poster_reward'],
                      ['Voter reward',      'voter_reward'],
                      ['Votes/round',       'votes_per_round'],
                      ['Start wallet',      'starting_wallet'],
                      ['Max rounds (0=∞)',  'max_rounds'],
                    ] as [string, string][]).map(([label, key]) => (
                      <label key={key} className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-500">{label}</span>
                        <input
                          type="number"
                          className="input text-sm py-1.5"
                          value={String(cfgDraft[key] ?? '')}
                          onChange={(e) =>
                            setCfgDraft((d) => ({
                              ...d,
                              [key]: e.target.value === '' ? null : Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    ))}
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-zinc-500">Anonymous voting</span>
                      <select
                        className="input text-sm py-1.5"
                        value={String(cfgDraft['anonymous_voting'] ?? 0)}
                        onChange={(e) =>
                          setCfgDraft((d) => ({ ...d, anonymous_voting: Number(e.target.value) }))
                        }
                      >
                        <option value="0">No — show usernames</option>
                        <option value="1">Yes — hide as A/B/C</option>
                      </select>
                    </label>
                    <div className="col-span-2">
                      <button
                        onClick={saveConfig}
                        className="btn-primary text-sm w-full"
                        disabled={loading}
                      >
                        {loading ? 'Saving…' : 'Save Config'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

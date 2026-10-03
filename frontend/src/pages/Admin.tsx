import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { RoomState } from '../types'
import { Formula } from '../lib/formula'
import Timer from '../components/Timer'
import { apiUrl } from '../lib/backend'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PuzzleInfo {
  id: string
  title: string
  description: string
  difficulty: 1 | 2 | 3
  columns: string[]
}

type AdminRoomState = RoomState & {
  correctAnswer: { solution: string; hints: string[] } | null
}

interface SavedRoom { id: string; name: string }

const SESSION_KEY = 'adminPassword'
const ROOMS_KEY   = 'adminRooms'
const DIFFICULTY: Record<number, { label: string; className: string }> = {
  1: { label: 'Warm-up', className: 'chip-up' },
  2: { label: 'Tricky',  className: 'chip-accent' },
  3: { label: 'Boss',    className: 'chip-down' },
}
const PHASE_LABEL: Record<string, { label: string; className: string }> = {
  lobby:      { label: 'Lobby',    className: 'chip-neutral' },
  submission: { label: 'Live',     className: 'chip-accent' },
  results:    { label: 'Results',  className: 'chip-up' },
  finished:   { label: 'Finished', className: 'chip-neutral' },
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function Admin() {
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

  return <AdminPanel password={password} onLogout={handleLogout} />
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function verifyPassword(pwd: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/admin/auth'), {
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
function forgetRoom(id: string) {
  localStorage.setItem(ROOMS_KEY, JSON.stringify(getSavedRooms().filter((r) => r.id !== id)))
}
function saveRoom(room: SavedRoom) {
  const rooms = getSavedRooms().filter((r) => r.id !== room.id)
  localStorage.setItem(ROOMS_KEY, JSON.stringify([room, ...rooms]))
}

// ─── Login page ───────────────────────────────────────────────────────────────

function LoginPage({ onSuccess }: { onSuccess: (pwd: string) => void }) {
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <div className="eyebrow mb-2">Host panel</div>
        <h1 className="text-4xl font-bold">Run a game</h1>
        <p className="mt-2 max-w-xs text-ink-3">
          For hosts only. Players join from the home page with a room code.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card-pop flex w-full max-w-sm flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="label">Host password</span>
          <input
            type="password"
            className="input"
            placeholder="Enter password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </label>

        {error && <div className="alert-error text-center" role="alert">{error}</div>}

        <button type="submit" className="btn-primary w-full py-3" disabled={loading || !input}>
          {loading ? 'Checking…' : 'Enter'}
        </button>
      </form>

      <Link to="/" className="text-sm text-ink-3 hover:text-ink">← Back to player page</Link>
    </div>
  )
}

// ─── Admin panel (after login) ────────────────────────────────────────────────

function AdminPanel({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [savedRooms, setSavedRooms]     = useState<SavedRoom[]>(getSavedRooms)
  const [activeRoomId, setActiveRoomId] = useState<string>(getSavedRooms()[0]?.id ?? '')

  const [showCreate, setShowCreate]   = useState(savedRooms.length === 0)
  const [newRoomName, setNewRoomName] = useState('')
  const [creating, setCreating]       = useState(false)
  const [createErr, setCreateErr]     = useState('')

  const [roomState, setRoomState]           = useState<AdminRoomState | null>(null)
  const [puzzles, setPuzzles]               = useState<PuzzleInfo[]>([])
  const [selectedPuzzle, setSelectedPuzzle] = useState('')
  const [actionErr, setActionErr]           = useState('')
  const [loading, setLoading]               = useState(false)
  const [editConfig, setEditConfig]         = useState(false)
  const [cfgDraft, setCfgDraft]             = useState<Record<string, unknown>>({})
  const [confirmEnd, setConfirmEnd]         = useState(false)
  const [copied, setCopied]                 = useState(false)
  const [missing, setMissing]               = useState(false)
  const [confirmDelete, setConfirmDelete]   = useState(false)

  useEffect(() => {
    fetch(apiUrl('/api/admin/puzzles'))
      .then((r) => r.json())
      .then((d: any) => setPuzzles(d.puzzles ?? []))
      .catch(() => {})
  }, [])

  // Poll active room state every 2 s
  const fetchState = useCallback(async () => {
    if (!activeRoomId) return
    try {
      const res = await fetch(apiUrl(`/api/rooms/${activeRoomId}/admin/state`), {
        headers: authHeader(password),
      })
      if (res.ok) setRoomState(await res.json())
      else {
        setRoomState(null)
        if (res.status === 404) setMissing(true)
      }
    } catch {}
  }, [activeRoomId, password])

  useEffect(() => {
    setRoomState(null)
    setActionErr('')
    setEditConfig(false)
    setConfirmEnd(false)
    setConfirmDelete(false)
    setMissing(false)
    if (!activeRoomId) return
    fetchState()
    const id = setInterval(fetchState, 2000)
    return () => clearInterval(id)
  }, [activeRoomId, fetchState])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateErr('')
    if (!newRoomName.trim()) return
    setCreating(true)
    try {
      const res = await fetch(apiUrl('/api/rooms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(password) },
        body: JSON.stringify({ name: newRoomName.trim() }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok || !data.id) { setCreateErr(data.error ?? 'Failed'); return }

      saveRoom({ id: data.id, name: newRoomName.trim() })
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

  async function doAction(action: string, body: unknown = {}) {
    setActionErr('')
    setLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/rooms/${activeRoomId}/admin/${action}`), {
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

  /** Drop a room from the sidebar and move to the next one */
  function removeFromList(id: string) {
    forgetRoom(id)
    const rest = getSavedRooms()
    setSavedRooms(rest)
    setActiveRoomId(rest[0]?.id ?? '')
    if (rest.length === 0) setShowCreate(true)
  }

  async function deleteRoom() {
    setActionErr('')
    setLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/rooms/${activeRoomId}`), {
        method: 'DELETE',
        headers: authHeader(password),
      })
      const data = await res.json() as { error?: string }
      // 404 means it's already gone — still clear it from the list
      if (!res.ok && res.status !== 404) { setActionErr(data.error ?? 'Could not delete the room'); return }
      removeFromList(activeRoomId)
    } catch {
      setActionErr('Network error')
    } finally {
      setLoading(false)
      setConfirmDelete(false)
    }
  }

  async function saveConfig() {
    setActionErr('')
    setLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/rooms/${activeRoomId}/admin/config`), {
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

  const cfg = roomState?.room.config
  const phase = roomState?.room.status === 'finished' ? 'finished' : roomState?.currentRound?.phase ?? 'lobby'
  const phaseInfo = PHASE_LABEL[phase] ?? PHASE_LABEL.lobby
  const players = roomState ? [...roomState.players].sort((a, b) => b.wallet - a.wallet) : []

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-lg font-bold tracking-tight">blackbox</span>
            <span className="chip-neutral">Host</span>
            {roomState && (
              <>
                <span className="h-5 w-px bg-line" aria-hidden />
                <span className="truncate font-semibold">{roomState.room.name}</span>
                <span className={phaseInfo.className}>{phaseInfo.label}</span>
                {roomState.currentRound && <span className="text-sm text-ink-3">Round {roomState.roundNumber}</span>}
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {phase === 'submission' && <Timer endsAt={roomState?.currentRound?.phaseEndsAt ?? null} />}
            <button onClick={onLogout} className="btn-ghost px-3 py-2 text-sm">Sign out</button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        {/* ── Rooms ─────────────────────────────────────────────────────────── */}
        <aside className="flex shrink-0 flex-col gap-3 border-b border-line p-4 md:w-64 md:border-b-0 md:border-r">
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary w-full py-2.5">
            {showCreate ? 'Cancel' : '+ New room'}
          </button>

          {showCreate && (
            <form onSubmit={handleCreate} className="flex flex-col gap-2 animate-fade-in">
              <input
                className="input py-2.5"
                placeholder="Room name"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                maxLength={50}
                autoFocus
              />
              {createErr && <p className="text-sm text-down">{createErr}</p>}
              <button type="submit" className="btn-secondary py-2" disabled={creating || !newRoomName.trim()}>
                {creating ? 'Creating…' : 'Create room'}
              </button>
            </form>
          )}

          <nav className="flex flex-col gap-1" aria-label="Your rooms">
            {savedRooms.length === 0 && !showCreate && (
              <p className="px-2 py-4 text-center text-sm text-ink-3">No rooms yet.</p>
            )}
            {savedRooms.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRoomId(r.id)}
                aria-current={activeRoomId === r.id}
                className={`rounded-xl px-3 py-2.5 text-left transition-colors ${
                  activeRoomId === r.id ? 'bg-ink text-white' : 'hover:bg-ink/5'
                }`}
              >
                <div className="truncate font-semibold">{r.name}</div>
                <div className={`tabular truncate text-xs ${activeRoomId === r.id ? 'text-white/60' : 'text-ink-4'}`}>{r.id}</div>
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Main ──────────────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
          {!activeRoomId && (
            <div className="flex flex-1 items-center justify-center text-ink-3">Create a room to get started.</div>
          )}

          {activeRoomId && !roomState && !missing && (
            <div className="flex flex-1 items-center justify-center text-ink-3">Loading…</div>
          )}

          {activeRoomId && missing && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <h2 className="text-2xl font-semibold">This room no longer exists</h2>
              <p className="max-w-sm text-ink-3">It was deleted, or the local database was reset.</p>
              <button className="btn-secondary mt-1" onClick={() => removeFromList(activeRoomId)}>
                Remove from list
              </button>
            </div>
          )}

          {activeRoomId && roomState && (
            <>
              {/* Share + controls */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <button
                  className="card-pop flex items-center gap-4 px-5 py-3 text-left transition-transform hover:-translate-y-0.5"
                  onClick={() => {
                    navigator.clipboard?.writeText(activeRoomId).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }).catch(() => {})
                  }}
                >
                  <span className="eyebrow">Room code</span>
                  <span className="tabular font-display text-2xl font-semibold tracking-wider">{activeRoomId}</span>
                  <span className="chip-neutral">{copied ? 'Copied!' : 'Copy'}</span>
                </button>

                <div className="flex flex-wrap gap-2">
                  {phase === 'submission' && (
                    <button onClick={() => doAction('advance-phase')} className="btn-secondary" disabled={loading}>
                      End round now
                    </button>
                  )}
                  {phase === 'results' && (
                    <button onClick={() => doAction('advance-phase')} className="btn-secondary" disabled={loading}>
                      Back to lobby
                    </button>
                  )}
                  {phase !== 'finished' && (
                    confirmEnd ? (
                      <>
                        <button onClick={() => { setConfirmEnd(false); doAction('end-game') }} className="btn-danger" disabled={loading}>
                          Yes, end the game
                        </button>
                        <button onClick={() => setConfirmEnd(false)} className="btn-ghost">Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmEnd(true)} className="btn-ghost text-down hover:text-down" disabled={loading}>
                        End game…
                      </button>
                    )
                  )}
                </div>
              </div>

              {actionErr && <div className="alert-error" role="alert">{actionErr}</div>}

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-w-0 flex-col gap-6">
                  {/* Current round */}
                  {roomState.currentRound && (
                    <section className="card flex flex-col gap-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="eyebrow mb-1">Round {roomState.roundNumber}</div>
                          <h2 className="text-xl font-semibold">{roomState.puzzle?.title ?? roomState.currentRound.puzzleId}</h2>
                        </div>
                        <span className={phaseInfo.className}>{phaseInfo.label}</span>
                      </div>

                      {roomState.correctAnswer && (
                        <div className="rounded-xl border-2 border-dashed border-accent bg-accent-soft/50 px-5 py-4">
                          <div className="eyebrow mb-1 text-accent-dark">Answer · host only</div>
                          <div className="font-display text-xl font-medium">
                            <Formula expr={roomState.correctAnswer.solution} />
                          </div>
                          <ol className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
                            {roomState.correctAnswer.hints.map((h, i) => (
                              <li key={i}><span className="font-semibold">Hint {i + 1}:</span> {h}</li>
                            ))}
                          </ol>
                        </div>
                      )}

                      <div>
                        <div className="eyebrow mb-3">Claims ({roomState.submissions.length})</div>
                        {roomState.submissions.length === 0 ? (
                          <p className="text-ink-3">No formulas posted yet.</p>
                        ) : (
                          <ul className="flex flex-col divide-y divide-line">
                            {roomState.submissions.map((s) => {
                              const c = roomState.voteCounts.find((v) => v.submissionId === s.id)
                              return (
                                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                  <div className="min-w-0">
                                    <div className="font-display text-lg font-medium"><Formula expr={s.expr} /></div>
                                    <div className="text-sm text-ink-3">{s.label}</div>
                                  </div>
                                  <div className="tabular flex gap-3 text-sm font-semibold">
                                    <span className="text-up">▲{c?.ups ?? 0}</span>
                                    <span className="text-down">▼{c?.downs ?? 0}</span>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Start round */}
                  {(phase === 'lobby' || phase === 'results') && (
                    <section className="card flex flex-col gap-4">
                      <div>
                        <div className="eyebrow mb-1">{phase === 'results' ? 'Next round' : 'First round'}</div>
                        <h2 className="text-xl font-semibold">Pick a puzzle</h2>
                      </div>

                      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {puzzles.map((p) => {
                          const d = DIFFICULTY[p.difficulty]
                          const selected = selectedPuzzle === p.id
                          return (
                            <button
                              key={p.id}
                              onClick={() => setSelectedPuzzle(selected ? '' : p.id)}
                              aria-pressed={selected}
                              className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${
                                selected ? 'border-ink bg-accent-soft shadow-pop' : 'border-line bg-white hover:border-ink-4'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-semibold">{p.title}</span>
                                {d && <span className={`${d.className} shrink-0`}>{d.label}</span>}
                              </div>
                              <div className="mt-1 line-clamp-2 text-sm text-ink-3">{p.description}</div>
                              <div className="mt-1.5 text-xs text-ink-4">inputs: {p.columns.join(', ')}</div>
                            </button>
                          )
                        })}
                      </div>

                      <button
                        onClick={() => doAction('start-round', { puzzleId: selectedPuzzle })}
                        className="btn-primary py-3"
                        disabled={!selectedPuzzle || loading}
                      >
                        {loading
                          ? 'Starting…'
                          : selectedPuzzle
                            ? `Start round: ${puzzles.find((p) => p.id === selectedPuzzle)?.title ?? selectedPuzzle}`
                            : 'Select a puzzle above'}
                      </button>
                    </section>
                  )}

                  {/* Settings */}
                  <section className="card flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-semibold">Room settings</h2>
                      <button
                        className="btn-ghost px-3 py-2 text-sm"
                        disabled={phase === 'submission'}
                        title={phase === 'submission' ? 'Settings are locked while a round is live' : undefined}
                        onClick={() => {
                          if (!editConfig && cfg) {
                            setCfgDraft({
                              phase1_secs:      cfg.phase1Secs,
                              poster_reward:    cfg.postStake,
                              post_payout:      cfg.postPayout,
                              voter_reward:     cfg.voteStake,
                              back_payout:      cfg.backPayout,
                              hint_cost:        cfg.hintCost,
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
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {([
                          ['Round length',  `${cfg.phase1Secs}s`],
                          ['Post stake',    `${cfg.postStake}`],
                          ['Post payout',   `${cfg.postPayout}`],
                          ['Vote stake',    `${cfg.voteStake}`],
                          ['Back payout',   `${cfg.backPayout}`],
                          ['Hint cost',     `${cfg.hintCost}`],
                          ['Votes / round', String(cfg.votesPerRound)],
                          ['Start wallet',  `${cfg.startingWallet}`],
                          ['Max rounds',    cfg.maxRounds ? String(cfg.maxRounds) : '∞'],
                          ['Anonymous',     cfg.anonymousVoting ? 'Yes' : 'No'],
                        ] as [string, string][]).map(([k, v]) => (
                          <div key={k} className="rounded-xl bg-paper px-4 py-3">
                            <div className="text-xs text-ink-3">{k}</div>
                            <div className="tabular font-display text-lg font-semibold">{v}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {editConfig && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {([
                          ['Round length (seconds)', 'phase1_secs'],
                          ['Post stake (coins)',      'poster_reward'],
                          ['Post payout, if right',   'post_payout'],
                          ['Vote stake (coins)',      'voter_reward'],
                          ['Back payout, if right (must beat post payout)', 'back_payout'],
                          ['Hint cost (coins)',       'hint_cost'],
                          ['Votes per round',         'votes_per_round'],
                          ['Starting wallet',         'starting_wallet'],
                          ['Max rounds (empty = ∞)',  'max_rounds'],
                        ] as [string, string][]).map(([label, key]) => (
                          <label key={key} className="flex flex-col gap-1.5">
                            <span className="label">{label}</span>
                            <input
                              type="number"
                              className="input py-2.5"
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
                        <label className="flex flex-col gap-1.5">
                          <span className="label">Player names on claims</span>
                          <select
                            className="select py-2.5"
                            value={String(cfgDraft['anonymous_voting'] ?? 0)}
                            onChange={(e) => setCfgDraft((d) => ({ ...d, anonymous_voting: Number(e.target.value) }))}
                          >
                            <option value="0">Show names</option>
                            <option value="1">Hide names (A, B, C…)</option>
                          </select>
                        </label>
                        <div className="sm:col-span-2">
                          <button onClick={saveConfig} className="btn-primary w-full py-3" disabled={loading}>
                            {loading ? 'Saving…' : 'Save settings'}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Delete */}
                  <section className="flex flex-col gap-4 rounded-2xl border-2 border-down/30 bg-down-soft/40 p-6">
                    <div>
                      <h2 className="text-xl font-semibold">Delete this room</h2>
                      <p className="mt-1 text-sm text-ink-2">
                        Removes the room, its players, rounds, formulas, votes and wallets for good.
                        Anyone still in the room is sent back to the home page.
                      </p>
                    </div>
                    {confirmDelete ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-down">
                          Delete “{roomState.room.name}” forever? This can't be undone.
                        </span>
                        <button onClick={deleteRoom} className="btn-danger" disabled={loading}>
                          {loading ? 'Deleting…' : 'Yes, delete it'}
                        </button>
                        <button onClick={() => setConfirmDelete(false)} className="btn-ghost">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(true)} className="btn-secondary w-fit text-down" disabled={loading}>
                        Delete room…
                      </button>
                    )}
                  </section>
                </div>

                {/* Players */}
                <section className="card flex h-fit flex-col gap-3">
                  <h2 className="text-xl font-semibold">Players ({players.length})</h2>
                  {players.length === 0 && <p className="text-ink-3">Waiting for players to join…</p>}
                  <ol className="flex flex-col divide-y divide-line">
                    {players.map((p, i) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="tabular w-5 text-sm text-ink-4">{i + 1}</span>
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${p.isConnected ? 'bg-up' : 'bg-line'}`}
                            title={p.isConnected ? 'Online' : 'Offline'}
                          />
                          <span className="truncate font-medium">{p.username}</span>
                        </div>
                        <span className="tabular font-display font-semibold">{p.wallet.toLocaleString()}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

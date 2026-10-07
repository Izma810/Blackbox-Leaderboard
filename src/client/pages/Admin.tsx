import { useState, useEffect, useCallback } from 'react'
import type { BatchId, BatchStatus } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminSubmission {
  id: string; teamId: string; teamName: string; expr: string; stake: number
  r2Score: number | null; verdict: string | null; ups: number; downs: number; submittedAt: number
}
interface PuzzleAdminData { solution: string; hints: string[]; submissions: AdminSubmission[] }
interface BatchAdminInfo {
  id: BatchId; name: string; status: BatchStatus; submissionsOpen: boolean; votingOpen: boolean
  puzzles: { id: string; title: string; difficulty: number; batchId: BatchId; columns: string[] }[]
}
interface MemberAdmin { name: string; entryNumber: string; hostel: string; slot: number }
interface TeamAdmin {
  id: string; name: string; wallet: number; totalScore: number; isConnected: boolean; awaitingReclaim: boolean
  members: { name: string; hostel: string; slot: number }[]
  membersAdmin: MemberAdmin[]
}
interface GameConfig {
  status: string; startingWallet: number; postStake: number; postPayout: number
  voteStake: number; backPayout: number; hintCost: number; voteBudget: number; anonymousVoting: boolean
}
interface AdminState {
  config: GameConfig; teams: TeamAdmin[]; batches: BatchAdminInfo[]
  puzzleData: Record<string, PuzzleAdminData>
}

const SESSION_KEY = 'adminPassword'
const BATCH_ORDER: BatchId[] = ['easy', 'intermediate', 'image']

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  const [password,  setPassword]  = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '')
  const [isAuthed,  setIsAuthed]  = useState(false)

  useEffect(() => {
    if (password) verifyPassword(password).then(setIsAuthed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY); setPassword(''); setIsAuthed(false)
  }

  if (!isAuthed) {
    return (
      <LoginPage onSuccess={(pwd) => {
        sessionStorage.setItem(SESSION_KEY, pwd)
        setPassword(pwd); setIsAuthed(true)
      }} />
    )
  }
  return <AdminPanel password={password} onLogout={handleLogout} />
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginPage({ onSuccess }: { onSuccess: (pwd: string) => void }) {
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      })
      if (res.ok) onSuccess(pwd)
      else setErr('Wrong password')
    } catch { setErr('Network error') }
    finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form onSubmit={submit} className="card-pop flex w-full max-w-sm flex-col gap-5">
        <h1 className="text-2xl font-bold">Admin</h1>
        <label className="flex flex-col gap-1.5">
          <span className="label">Password</span>
          <input type="password" className="input" value={pwd}
            onChange={(e) => setPwd(e.target.value)} autoFocus />
        </label>
        {err && <div className="alert-error">{err}</div>}
        <button type="submit" className="btn-primary" disabled={busy || !pwd}>{busy ? 'Checking…' : 'Log in'}</button>
      </form>
    </div>
  )
}

async function verifyPassword(pwd: string): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    })
    return res.ok
  } catch { return false }
}

// ─── Admin panel ──────────────────────────────────────────────────────────────

function AdminPanel({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [state,  setState]  = useState<AdminState | null>(null)
  const [error,  setError]  = useState('')
  const [busy,   setBusy]   = useState<string | null>(null)
  const [toast,  setToast]  = useState('')
  const auth = useCallback((init: RequestInit = {}) => ({
    ...init,
    headers: { 'Authorization': `Bearer ${password}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  }), [password])

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/state', auth())
      if (!res.ok) { setError('Failed to load state'); return }
      setState(await res.json() as AdminState)
    } catch { setError('Network error') }
  }, [auth])

  useEffect(() => { fetchState() }, [fetchState])
  useEffect(() => {
    const id = setInterval(fetchState, 3000)
    return () => clearInterval(id)
  }, [fetchState])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function doAction(path: string, method = 'POST', body?: unknown) {
    setBusy(path)
    try {
      const res = await fetch(path, auth({ method, body: body ? JSON.stringify(body) : undefined }))
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error'); return false }
      await fetchState()
      return true
    } catch { showToast('Network error'); return false }
    finally { setBusy(null) }
  }

  async function resetLogin(teamId: string, teamName: string) {
    if (!confirm(`Reset the login for "${teamName}"?\n\nBoth of their laptops get signed out. They then reclaim the team on the home page with the team name and a member's entry number. Only do this when the team is standing with you.`)) return
    if (await doAction(`/api/admin/teams/${teamId}/reset-login`)) {
      showToast(`Login reset. Have "${teamName}" reclaim the team now.`)
    }
  }

  if (!state) {
    return <div className="flex min-h-screen items-center justify-center text-ink-3">Loading…</div>
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-pop animate-slide-up">
          {toast}
        </div>
      )}

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl font-bold">Admin</h1>
          <div className="flex items-center gap-3">
            <span className={`chip ${state.config.status === 'active' ? 'chip-up' : state.config.status === 'finished' ? 'chip-neutral' : 'chip-cobalt'}`}>
              {state.config.status}
            </span>
            <button className="btn-ghost text-sm" onClick={onLogout}>Log out</button>
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {/* Batch cards */}
        <section>
          <div className="eyebrow mb-4">Batches</div>
          <div className="grid gap-4 sm:grid-cols-3">
            {BATCH_ORDER.map((batchId) => {
              const batch = state.batches.find((b) => b.id === batchId)
              if (!batch) return null
              const isBusy = (a: string) => busy === `/api/admin/batches/${batchId}/${a}`

              return (
                <div key={batchId} className="card flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg font-semibold">{batch.name}</h3>
                    <span className={`chip text-xs ${
                      batch.status === 'hidden'   ? 'chip-neutral' :
                      batch.status === 'settled'  ? 'chip-up'      : 'chip-accent'
                    }`}>
                      {batch.status}
                    </span>
                  </div>

                  <p className="text-xs text-ink-3">{batch.puzzles.length} puzzles</p>

                  {/* Controls */}
                  <div className="flex flex-col gap-2">
                    {batch.status === 'hidden' && (
                      <button className="btn-primary w-full py-2 text-sm"
                        disabled={isBusy('open')}
                        onClick={() => doAction(`/api/admin/batches/${batchId}/open`)}>
                        {isBusy('open') ? 'Opening…' : 'Open batch'}
                      </button>
                    )}

                    {batch.status === 'open' && (
                      <>
                        <div className="flex gap-2">
                          <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                            <input type="checkbox" checked={batch.submissionsOpen}
                              onChange={(e) => doAction(`/api/admin/batches/${batchId}`, 'PATCH', { submissionsOpen: e.target.checked })} />
                            Submissions
                          </label>
                          <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                            <input type="checkbox" checked={batch.votingOpen}
                              onChange={(e) => doAction(`/api/admin/batches/${batchId}`, 'PATCH', { votingOpen: e.target.checked })} />
                            Voting
                          </label>
                        </div>
                        <button className="btn-danger w-full py-2 text-sm"
                          disabled={isBusy('settle')}
                          onClick={() => { if (confirm(`Settle "${batch.name}"? This reveals answers and pays out.`)) doAction(`/api/admin/batches/${batchId}/settle`) }}>
                          {isBusy('settle') ? 'Settling…' : 'Settle batch'}
                        </button>
                      </>
                    )}

                    {batch.status === 'settled' && (
                      <button className="btn-secondary w-full py-2 text-sm"
                        disabled={isBusy('reopen')}
                        onClick={() => { if (confirm('Reopen this batch? Settlement payouts will be reversed.')) doAction(`/api/admin/batches/${batchId}/reopen`) }}>
                        {isBusy('reopen') ? 'Reopening…' : 'Reopen (undo settlement)'}
                      </button>
                    )}
                  </div>

                  {/* Puzzle list for this batch */}
                  {batch.puzzles.map((p) => {
                    const pd = state.puzzleData[p.id]
                    if (!pd) return null
                    return (
                      <details key={p.id} className="group">
                        <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-sm font-semibold hover:bg-paper flex items-center justify-between">
                          <span>{p.title}</span>
                          <span className="text-xs text-ink-3">{pd.submissions.length} claim{pd.submissions.length !== 1 ? 's' : ''}</span>
                        </summary>
                        <div className="mt-2 flex flex-col gap-1.5 px-3 pb-2 text-xs">
                          <div className="rounded bg-up-soft px-2 py-1 font-mono text-up">y = {pd.solution}</div>
                          {pd.submissions.map((s) => (
                            <div key={s.id}                           className={`flex items-center gap-2 rounded px-2 py-1 ${
                              s.verdict === 'right' ? 'bg-up-soft' : s.verdict === 'wrong' ? 'bg-down-soft' : s.verdict === 'close' ? 'bg-accent-soft' : 'bg-paper'
                            }`}>
                              <span className="font-semibold truncate max-w-[80px]">{s.teamName}</span>
                              <span className="font-mono text-ink-3 truncate flex-1">{s.expr}</span>
                              <span>▲{s.ups} ▼{s.downs}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </section>

        {/* Teams */}
        <section>
          <div className="eyebrow mb-4">Teams ({state.teams.length})</div>
          {state.teams.length === 0 ? (
            <p className="text-ink-3 text-sm">No teams registered yet.</p>
          ) : (
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead className="bg-paper text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Team</th>
                    <th className="px-4 py-3 text-left font-semibold">Members</th>
                    <th className="px-4 py-3 text-right font-semibold">Wallet</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.teams.map((t) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${t.isConnected ? 'bg-up' : 'bg-line'}`} />
                          <span className="font-semibold">{t.name}</span>
                        </div>
                        {t.awaitingReclaim && (
                          <span className="chip chip-accent mt-1 text-xs">Login reset, waiting to reclaim</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.membersAdmin.map((m, i) => (
                          <div key={i} className="text-xs text-ink-3">
                            {m.name} · <span className="font-mono">{m.entryNumber}</span> · {m.hostel}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right tabular font-semibold">{t.wallet.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button className="btn-ghost px-2 py-1 text-xs"
                            disabled={busy === `/api/admin/teams/${t.id}/reset-login`}
                            onClick={() => resetLogin(t.id, t.name)}>
                            Reset login
                          </button>
                          <button className="btn-ghost px-2 py-1 text-xs text-down"
                            disabled={busy === 'delete-' + t.id}
                            onClick={() => { if (confirm(`Delete team "${t.name}"?`)) doAction(`/api/admin/teams/${t.id}`, 'DELETE') }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Config */}
        <section>
          <div className="eyebrow mb-4">Settings</div>
          <ConfigEditor config={state.config} auth={auth} onSaved={fetchState} />
        </section>

        {/* Danger zone */}
        <section className="flex flex-col gap-3 rounded-2xl border-2 border-down/30 p-5">
          <div className="eyebrow text-down">Danger zone</div>
          <div className="flex flex-wrap gap-3">
            <button className="btn-danger"
              disabled={busy === 'end-game'}
              onClick={() => { if (confirm('End the game? All open batches will be settled.')) doAction('/api/admin/end-game') }}>
              {busy === 'end-game' ? 'Ending…' : 'End game'}
            </button>
            <button className="btn-danger"
              disabled={busy === 'reset'}
              onClick={() => { if (confirm('RESET the entire game? All teams, submissions and votes will be deleted.')) doAction('/api/admin/reset') }}>
              {busy === 'reset' ? 'Resetting…' : 'Reset game'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── Config editor ────────────────────────────────────────────────────────────

function ConfigEditor({ config, auth, onSaved }: {
  config: GameConfig
  auth: (init?: RequestInit) => RequestInit
  onSaved: () => void
}) {
  const [form, setForm] = useState({ ...config })
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const res = await fetch('/api/admin/config', auth({
        method: 'PATCH',
        body: JSON.stringify({
          starting_wallet:  form.startingWallet,
          post_stake:       form.postStake,
          post_payout:      form.postPayout,
          vote_stake:       form.voteStake,
          back_payout:      form.backPayout,
          hint_cost:        form.hintCost,
          vote_budget:      form.voteBudget,
          anonymous_voting: form.anonymousVoting ? 1 : 0,
        }),
      }))
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setErr(data.error ?? 'Error'); return }
      onSaved()
    } catch { setErr('Network error') }
    finally { setBusy(false) }
  }

  const F = ({ label, field, type = 'number' }: { label: string; field: keyof GameConfig; type?: string }) => (
    <label className="flex flex-col gap-1">
      <span className="label text-xs">{label}</span>
      {type === 'checkbox' ? (
        <input type="checkbox" checked={form[field] as boolean}
          onChange={(e) => setForm({ ...form, [field]: e.target.checked })} />
      ) : (
        <input type="number" className="input py-2 text-sm"
          value={form[field] as number}
          onChange={(e) => setForm({ ...form, [field]: Number(e.target.value) })} />
      )}
    </label>
  )

  return (
    <form onSubmit={save} className="card flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <F label="Starting wallet" field="startingWallet" />
        <F label="Post stake" field="postStake" />
        <F label="Post payout" field="postPayout" />
        <F label="Vote stake" field="voteStake" />
        <F label="Back payout" field="backPayout" />
        <F label="Hint cost" field="hintCost" />
        <F label="Vote budget (per team)" field="voteBudget" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.anonymousVoting}
          onChange={(e) => setForm({ ...form, anonymousVoting: e.target.checked })} />
        Anonymous voting (hide team names on claims)
      </label>
      {err && <div className="alert-error">{err}</div>}
      <button type="submit" className="btn-primary self-start" disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}

import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HOSTELS, validateRegistration, type MemberInput } from '../../../shared/team'
import { setSession } from '../lib/session'
import TeammateLink from '../components/TeammateLink'
import type { TeamInfo } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionResult { token: string; team: TeamInfo }

type Tab = 'register' | 'reclaim'

// ─── Member input block ───────────────────────────────────────────────────────

function MemberBlock({ index, value, onChange }: {
  index: number
  value: MemberInput
  onChange: (v: MemberInput) => void
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <legend className="px-1 font-semibold text-ink-2">Member {index + 1}</legend>
      <label className="flex flex-col gap-1.5">
        <span className="label">Full name</span>
        <input
          className="input"
          placeholder="e.g. Riya Sharma"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Entry number</span>
        <input
          className="input tabular tracking-wider"
          placeholder="e.g. 2023CS10123"
          value={value.entryNumber}
          onChange={(e) => onChange({ ...value, entryNumber: e.target.value.toUpperCase() })}
          maxLength={11}
          spellCheck={false}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Hostel</span>
        <select
          className="select"
          value={value.hostel}
          onChange={(e) => onChange({ ...value, hostel: e.target.value })}
        >
          <option value="">Select hostel…</option>
          {HOSTELS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </label>
    </fieldset>
  )
}

// ─── Teammate link screen (after registering or reclaiming) ───────────────────

function TeammateLinkScreen({ token, title, onDone }: { token: string; title: string; onDone: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="card-pop flex w-full max-w-md flex-col gap-6">
        <div className="text-center">
          <div className="mb-2 text-4xl">🎉</div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-ink-3">
            This laptop is signed in. Now sign in your teammate&rsquo;s laptop with the link below.
            You can copy it again later from the game screen.
          </p>
        </div>

        <TeammateLink token={token} />

        <button onClick={onDone} className="btn-primary">
          Let&rsquo;s play →
        </button>
      </div>
    </div>
  )
}

// ─── Main Home page ───────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()
  const signedOut = (useLocation().state as { signedOut?: string } | null)?.signedOut
  const [tab, setTab] = useState<Tab>(signedOut ? 'reclaim' : 'register')

  // Registration state
  const [teamName, setTeamName] = useState('')
  const [members, setMembers]   = useState<[MemberInput, MemberInput]>([
    { name: '', entryNumber: '', hostel: '' },
    { name: '', entryNumber: '', hostel: '' },
  ])
  const [regError,  setRegError]  = useState('')
  const [regBusy,   setRegBusy]   = useState(false)
  const [done,      setDone]      = useState<{ token: string; title: string } | null>(null)

  // Reclaim state
  const [claimName,  setClaimName]  = useState('')
  const [claimEntry, setClaimEntry] = useState('')
  const [claimError, setClaimError] = useState('')
  const [claimBusy,  setClaimBusy]  = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setRegError('')
    const errors = validateRegistration({ teamName, members })
    if (errors.length > 0) { setRegError(errors[0].message); return }

    setRegBusy(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName, members }),
      })
      const data = await res.json() as (SessionResult & { error?: string; errors?: { message: string }[] })
      if (!res.ok) {
        setRegError(data.error ?? data.errors?.[0]?.message ?? 'Registration failed')
        return
      }
      setSession(data.token, data.team)
      setDone({ token: data.token, title: 'Team registered!' })
    } catch {
      setRegError('Network error. Check your connection.')
    } finally {
      setRegBusy(false)
    }
  }

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault()
    setClaimError('')
    setClaimBusy(true)
    try {
      const res = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName: claimName, entryNumber: claimEntry }),
      })
      const data = await res.json() as (SessionResult & { error?: string })
      if (!res.ok) { setClaimError(data.error ?? 'Could not reclaim the team'); return }
      setSession(data.token, data.team)
      setDone({ token: data.token, title: 'Welcome back!' })
    } catch {
      setClaimError('Network error. Check your connection.')
    } finally {
      setClaimBusy(false)
    }
  }

  if (done) {
    return <TeammateLinkScreen {...done} onDone={() => navigate('/play')} />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center px-6 py-5">
        <span className="font-display text-xl font-bold tracking-tight">whackamodel</span>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-12 px-6 pb-16 lg:grid-cols-[1fr_1fr]">
        {/* Pitch */}
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-3 font-display text-lg font-semibold text-ink-3">
            <span>x</span><span aria-hidden>→</span>
            <span className="rounded-lg bg-ink px-3 py-1 text-white">? ? ?</span>
            <span aria-hidden>→</span><span>y</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            Crack the hidden function.<br />
            <span className="text-accent">Bet on who&rsquo;s right.</span>
          </h1>
          <p className="max-w-md text-ink-2">
            Two-person teams. One set of data. Find the formula — then stake coins on whether other teams got it right.
          </p>
          <ol className="grid max-w-md gap-3 sm:grid-cols-3">
            {[
              ['Register', 'Create your 2-person team'],
              ['Explore', 'Plot the data, find the shape'],
              ['Bet', 'Back or doubt other claims'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-sm font-semibold">{i + 1}</span>
                <div>
                  <div className="font-semibold">{title}</div>
                  <div className="text-sm text-ink-3">{body}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Auth card */}
        <div className="card-pop flex flex-col gap-5 sm:p-8">
          {/* Tabs */}
          <div className="flex rounded-xl bg-ink/5 p-1" role="tablist">
            {(['register', 'reclaim'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  tab === t ? 'bg-white text-ink shadow-soft' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {t === 'register' ? 'Register team' : 'Reclaim team'}
              </button>
            ))}
          </div>

          {signedOut && <div className="alert-error" role="alert">{signedOut}</div>}

          {tab === 'register' ? (
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="label">Team name</span>
                <input
                  className="input"
                  placeholder="Pick something memorable"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  maxLength={30}
                />
              </label>

              <MemberBlock index={0} value={members[0]}
                onChange={(v) => setMembers([v, members[1]])} />
              <MemberBlock index={1} value={members[1]}
                onChange={(v) => setMembers([members[0], v])} />

              {regError && <div className="alert-error" role="alert">{regError}</div>}

              <button type="submit" className="btn-primary w-full py-3.5" disabled={regBusy}>
                {regBusy ? 'Registering…' : 'Register team →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleClaim} className="flex flex-col gap-4">
              <p className="text-sm text-ink-3">
                Already registered? To sign in your second laptop, open the <strong>teammate link</strong> from
                the first one. If neither laptop is signed in any more, ask the host to reset your team&rsquo;s
                login, then reclaim it here.
              </p>
              <label className="flex flex-col gap-1.5">
                <span className="label">Team name</span>
                <input
                  className="input"
                  value={claimName}
                  onChange={(e) => setClaimName(e.target.value)}
                  maxLength={30}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label">Entry number of either member</span>
                <input
                  className="input tabular tracking-wider"
                  placeholder="e.g. 2023CS10123"
                  value={claimEntry}
                  onChange={(e) => setClaimEntry(e.target.value.toUpperCase())}
                  maxLength={11}
                  spellCheck={false}
                />
              </label>

              {claimError && <div className="alert-error" role="alert">{claimError}</div>}

              <button type="submit" className="btn-primary w-full py-3.5"
                disabled={claimBusy || !claimName.trim() || !claimEntry.trim()}>
                {claimBusy ? 'Reclaiming…' : 'Reclaim team →'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

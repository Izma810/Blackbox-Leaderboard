import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HOSTELS, validateRegistration, type MemberInput } from '../../../shared/team'
import { setSession } from '../lib/session'
import type { TeamInfo } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegisterResult { loginId: string; passcode: string; token: string; team: TeamInfo }
interface LoginResult    { token: string; team: TeamInfo }

type Tab = 'register' | 'login'

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

// ─── Credentials screen (shown once after registration) ───────────────────────

function CredentialsScreen({ loginId, passcode, onDone }: {
  loginId: string; passcode: string; onDone: () => void
}) {
  const [copied, setCopied] = useState(false)
  const text = `WhackAModel login\nTeam ID: ${loginId}\nPasscode: ${passcode}`

  function copy() {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="card-pop flex w-full max-w-md flex-col gap-6">
        <div className="text-center">
          <div className="mb-2 text-4xl">🎉</div>
          <h1 className="text-2xl font-bold">Team registered!</h1>
          <p className="mt-2 text-sm text-ink-3">
            Save these credentials. The passcode is shown <strong>only once</strong> and cannot be recovered.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-ink p-5 text-white">
          <div>
            <div className="eyebrow mb-1 text-white/50">Team Login ID</div>
            <div className="tabular text-2xl font-bold tracking-widest">{loginId}</div>
          </div>
          <div>
            <div className="eyebrow mb-1 text-white/50">Passcode</div>
            <div className="tabular text-2xl font-bold tracking-widest">{passcode}</div>
          </div>
        </div>

        <p className="text-center text-xs text-ink-4">
          Both teammates need these. Share them on WhatsApp, write them down — whatever works.
          Both laptops log in with the same ID and passcode.
        </p>

        <button onClick={copy} className="btn-secondary">
          {copied ? '✓ Copied!' : 'Copy credentials'}
        </button>

        <button onClick={onDone} className="btn-primary">
          I've saved these — let's play →
        </button>
      </div>
    </div>
  )
}

// ─── Main Home page ───────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('register')

  // Registration state
  const [teamName, setTeamName] = useState('')
  const [members, setMembers]   = useState<[MemberInput, MemberInput]>([
    { name: '', entryNumber: '', hostel: '' },
    { name: '', entryNumber: '', hostel: '' },
  ])
  const [regError,  setRegError]  = useState('')
  const [regBusy,   setRegBusy]   = useState(false)
  const [creds,     setCreds]     = useState<{ loginId: string; passcode: string } | null>(null)

  // Login state
  const [loginId,    setLoginId]    = useState('')
  const [passcode,   setPasscode]   = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginBusy,  setLoginBusy]  = useState(false)

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
      const data = await res.json() as (RegisterResult & { error?: string; errors?: { message: string }[] })
      if (!res.ok) {
        setRegError(data.error ?? data.errors?.[0]?.message ?? 'Registration failed')
        return
      }
      setSession(data.token, data.team)
      setCreds({ loginId: data.loginId, passcode: data.passcode })
    } catch {
      setRegError('Network error. Check your connection.')
    } finally {
      setRegBusy(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    setLoginBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: loginId.trim().toUpperCase(), passcode: passcode.trim().toUpperCase() }),
      })
      const data = await res.json() as (LoginResult & { error?: string })
      if (!res.ok) { setLoginError(data.error ?? 'Login failed'); return }
      setSession(data.token, data.team)
      navigate('/play')
    } catch {
      setLoginError('Network error. Check your connection.')
    } finally {
      setLoginBusy(false)
    }
  }

  if (creds) {
    return <CredentialsScreen {...creds} onDone={() => navigate('/play')} />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-display text-xl font-bold tracking-tight">whackamodel</span>
        <a href="/admin" className="btn-ghost px-3 py-2 text-sm">Admin →</a>
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
            {(['register', 'login'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  tab === t ? 'bg-white text-ink shadow-soft' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {t === 'register' ? 'Register team' : 'Log in'}
              </button>
            ))}
          </div>

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
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="label">Team login ID</span>
                <input
                  className="input tabular tracking-widest font-semibold"
                  placeholder="WM-XXXXX"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label">Passcode</span>
                <input
                  className="input tabular tracking-widest font-semibold"
                  placeholder="XXXXXX"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value.toUpperCase())}
                  autoComplete="current-password"
                  spellCheck={false}
                />
              </label>

              {loginError && <div className="alert-error" role="alert">{loginError}</div>}

              <button type="submit" className="btn-primary w-full py-3.5"
                disabled={loginBusy || !loginId.trim() || !passcode.trim()}>
                {loginBusy ? 'Logging in…' : 'Log in →'}
              </button>

              <p className="text-center text-xs text-ink-4">
                Your login ID and passcode were shown once when your team registered.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

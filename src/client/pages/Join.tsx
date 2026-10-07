import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setSession } from '../lib/session'
import type { TeamInfo } from '../types'

/** Landing page for the teammate link: /join#<token>. */
export default function Join() {
  const navigate = useNavigate()
  const [token] = useState(() => window.location.hash.slice(1).trim())
  const [error, setError] = useState('')

  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', '/join')
    if (!token) { setError('This link is incomplete. Ask your teammate to copy it again.'); return }

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json() as { team?: TeamInfo; error?: string }
        if (!res.ok || !data.team) {
          setError(res.status === 401
            ? "This link doesn't work any more. The host may have reset your team's login."
            : data.error ?? 'Could not sign in.')
          return
        }
        setSession(token, data.team)
        navigate('/play', { replace: true })
      })
      .catch(() => setError('Network error. Check your connection and open the link again.'))
  }, [navigate, token])

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="card-pop flex w-full max-w-md flex-col gap-4 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-bold">Couldn&rsquo;t join</h1>
            <div className="alert-error" role="alert">{error}</div>
            <a href="/" className="btn-secondary">Go to home page</a>
          </>
        ) : (
          <p className="text-ink-3">Signing you in…</p>
        )}
      </div>
    </div>
  )
}

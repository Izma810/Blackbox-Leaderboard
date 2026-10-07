import type { TeamInfo } from '../types'

const TOKEN_KEY = 'wm_token'
const TEAM_KEY  = 'wm_team'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getTeam(): TeamInfo | null {
  try {
    const raw = localStorage.getItem(TEAM_KEY)
    return raw ? JSON.parse(raw) as TeamInfo : null
  } catch {
    return null
  }
}

export function setSession(token: string, team: TeamInfo): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TEAM_KEY, JSON.stringify(team))
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TEAM_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

/** Opening this signs a laptop in as the team. The token sits in the #fragment, which browsers never send to the server. */
export function teammateLink(token: string): string {
  return `${window.location.origin}/join#${token}`
}

/** fetch() wrapper that injects the Authorization header and handles 401. */
export async function authFetch(
  url: string,
  init: RequestInit = {},
  on401?: () => void,
): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    on401?.()
  }
  return res
}

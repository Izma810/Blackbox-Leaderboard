/**
 * Where the Worker lives.
 *
 * Local dev: leave VITE_BACKEND_URL unset — requests stay relative and Vite's
 * proxy forwards them to `wrangler dev`.
 * Production (e.g. Vercel): set VITE_BACKEND_URL to the Worker's URL, such as
 * https://blackbox-leaderboard.<you>.workers.dev. The frontend then talks to
 * the Worker directly — Vercel can't proxy WebSockets, so this is required.
 */
const BACKEND = (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/+$/, '')

/** URL for an HTTP endpoint, e.g. apiUrl('/api/rooms') */
export function apiUrl(path: string): string {
  return BACKEND + path
}

/** WebSocket URL for a path, e.g. wsUrl('/ws?roomId=…') */
export function wsUrl(path: string): string {
  if (BACKEND) return BACKEND.replace(/^http/, 'ws') + path
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

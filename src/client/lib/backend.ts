/**
 * URL helpers for the API and WebSocket.
 *
 * The frontend and Worker are served from the same origin, so all paths are
 * relative. No VITE_BACKEND_URL or cross-origin configuration is needed.
 */

/** URL for an HTTP endpoint, e.g. apiUrl('/rooms') → '/api/rooms' */
export function apiUrl(path: string): string {
  return '/api' + path
}

/** WebSocket URL for a path, e.g. wsUrl('/ws?roomId=…') */
export function wsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api${path}`
}

/**
 * This browser's identity in a room. The token is the only proof that we are
 * this player — playerIds are public — so it must never be shown or shared.
 */
export interface Session {
  playerId: string
  token: string
  username: string
}

const key = (field: keyof Session, roomId: string) => `${field}:${roomId}`

export function getSession(roomId: string): Session | null {
  const playerId = localStorage.getItem(key('playerId', roomId))
  const token    = localStorage.getItem(key('token', roomId))
  if (!playerId || !token) return null
  return { playerId, token, username: localStorage.getItem(key('username', roomId)) ?? '' }
}

export function saveSession(roomId: string, session: Session) {
  localStorage.setItem(key('playerId', roomId), session.playerId)
  localStorage.setItem(key('token', roomId), session.token)
  localStorage.setItem(key('username', roomId), session.username)
}

export function clearSession(roomId: string) {
  for (const field of ['playerId', 'token', 'username'] as const) {
    localStorage.removeItem(key(field, roomId))
  }
}

/** The fields game actions must send to prove who is acting */
export function playerAuth(roomId: string): { playerId: string; token: string } {
  const s = getSession(roomId)
  return { playerId: s?.playerId ?? '', token: s?.token ?? '' }
}

/** Cryptographic helpers — run in the Cloudflare Workers runtime (Web Crypto API). */

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── HMAC-SHA256 ──────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  )
}

export async function hmacSign(message: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return toHex(sig)
}

// ─── Session tokens ───────────────────────────────────────────────────────────
// Format: base64(teamId + ':' + hmac)   — no expiry for simplicity

export async function createToken(teamId: string, secret: string): Promise<string> {
  const sig = await hmacSign(teamId, secret)
  return btoa(`${teamId}:${sig}`)
}

export async function verifyToken(token: string, secret: string): Promise<string | null> {
  try {
    const decoded = atob(token)
    const sep = decoded.indexOf(':')
    if (sep === -1) return null
    const teamId = decoded.slice(0, sep)
    const sig    = decoded.slice(sep + 1)
    if (!teamId) return null
    const expected = await hmacSign(teamId, secret)
    // Constant-time comparison to prevent timing attacks
    if (expected.length !== sig.length) return null
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
    return diff === 0 ? teamId : null
  } catch {
    return null
  }
}

// ─── PBKDF2 passcode hashing ─────────────────────────────────────────────────

async function pbkdf2(passcode: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 10_000, hash: 'SHA-256' },
    key, 256,
  )
  return toHex(bits)
}

export async function hashPasscode(passcode: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const salt = toHex(saltBytes.buffer)
  const hash = await pbkdf2(passcode, salt)
  return { hash, salt }
}

export async function verifyPasscode(passcode: string, hash: string, salt: string): Promise<boolean> {
  const computed = await pbkdf2(passcode, salt)
  if (computed.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

// ─── ID generators ────────────────────────────────────────────────────────────

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // no I, O, 0, 1 (confusable)

function randomString(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes).map((b) => ID_CHARS[b % ID_CHARS.length]).join('')
}

/** Human-readable team login ID, e.g. WM-7K3QX */
export function generateLoginId(): string {
  return `WM-${randomString(5)}`
}

/** 6-char one-time passcode shown at registration */
export function generatePasscode(): string {
  return randomString(6)
}

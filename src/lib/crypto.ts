/** Team session tokens — run in the Cloudflare Workers runtime (Web Crypto API). */

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * A team's secret. Whoever holds it is the team, so it is shared between the
 * two teammates' laptops via the teammate link and never shown to other teams.
 */
export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

/** Only the hash is stored, so a database leak doesn't hand out logins. */
export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

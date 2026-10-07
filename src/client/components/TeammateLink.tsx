import { useState } from 'react'
import { teammateLink } from '../lib/session'

export default function TeammateLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const link = teammateLink(token)

  function copy() {
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={link}
          onFocus={(e) => e.currentTarget.select()} aria-label="Teammate link" />
        <button type="button" onClick={copy} className="btn-secondary shrink-0 px-4">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-ink-4">
        Open this on your teammate&rsquo;s laptop to sign it in as your team. Send it only to your
        teammate: anyone with the link can play as you.
      </p>
    </div>
  )
}

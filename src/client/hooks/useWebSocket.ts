import { useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import type { ServerMessage } from '../types'
import { getToken } from '../lib/session'

interface UseWebSocketOptions {
  onMessage: (msg: ServerMessage) => void
  onOpen?:   () => void
  onClose?:  (code: number) => void
}

const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS   = 15_000

/**
 * When the server restarts, every laptop drops at the same instant. A random
 * spread (0.5–3 s at first) stops them all reconnecting in the same moment.
 */
function jittered(baseMs: number): number {
  return baseMs * (0.5 + Math.random() * 2.5)
}

export function useWebSocket({ onMessage, onOpen, onClose }: UseWebSocketOptions) {
  const wsRef      = useRef<WebSocket | null>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted  = useRef(false)
  const retryDelay = useRef(FIRST_RETRY_MS)

  const onMessageRef = useRef(onMessage)
  const onOpenRef    = useRef(onOpen)
  const onCloseRef   = useRef(onClose)
  useLayoutEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current    = onOpen
    onCloseRef.current   = onClose
  })

  const connect = useCallback(() => {
    if (unmounted.current) return
    const token = getToken()
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`

    let ws: WebSocket
    try { ws = new WebSocket(url) } catch { return }
    wsRef.current = ws

    ws.onopen = () => {
      retryDelay.current = FIRST_RETRY_MS
      onOpenRef.current?.()
    }

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data as string) as ServerMessage
        onMessageRef.current(msg)
      } catch {
        console.warn('[WS] Bad message:', evt.data)
      }
    }

    ws.onerror = () => { /* onerror always followed by onclose */ }

    ws.onclose = (evt) => {
      onCloseRef.current?.(evt.code)
      wsRef.current = null
      if (unmounted.current) return
      // 4000 = game reset (don't retry), 4001 = team removed or login reset (don't retry)
      if (evt.code === 4000 || evt.code === 4001) return

      // Keep retrying for as long as the page is open: giving up would leave a
      // laptop silently stuck offline mid-game after a long wifi drop.
      const delay = jittered(retryDelay.current)
      retryDelay.current = Math.min(retryDelay.current * 1.5, MAX_RETRY_MS / 3)
      timerRef.current = setTimeout(connect, delay)
    }
  }, []) // stable — token read dynamically each time

  useEffect(() => {
    unmounted.current  = false
    retryDelay.current = FIRST_RETRY_MS
    connect()

    return () => {
      unmounted.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}

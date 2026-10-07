import { useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import type { ServerMessage } from '../types'
import { wsUrl } from '../lib/backend'

interface UseWebSocketOptions {
  roomId: string
  playerId: string
  token: string
  onMessage: (msg: ServerMessage) => void
  onOpen?: () => void
  onClose?: (code: number) => void
}

export function useWebSocket({ roomId, playerId, token, onMessage, onOpen, onClose }: UseWebSocketOptions) {
  const wsRef       = useRef<WebSocket | null>(null)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted   = useRef(false)
  const retryDelay  = useRef(1000)
  const retryCount  = useRef(0)
  const MAX_RETRIES = 10

  // Keep callback refs stable so they never cause reconnects
  const onMessageRef = useRef(onMessage)
  const onOpenRef    = useRef(onOpen)
  const onCloseRef   = useRef(onClose)
  useLayoutEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current    = onOpen
    onCloseRef.current   = onClose
  })

  // connect is stable: only rebuilds when the room or session changes
  const connect = useCallback(() => {
    if (unmounted.current || !playerId || !token) return

    const params = new URLSearchParams({ roomId, playerId, token })
    const url = wsUrl(`/ws?${params}`)

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err)
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      retryDelay.current = 1000
      retryCount.current = 0
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

    ws.onerror = () => {
      // onerror is always followed by onclose — let onclose drive reconnection
    }

    ws.onclose = (evt) => {
      onCloseRef.current?.(evt.code)
      wsRef.current = null

      if (unmounted.current) return

      // Don't retry on auth errors (4xxx close codes) or if max retries exceeded
      if (evt.code === 4001 || evt.code === 4004) return
      if (retryCount.current >= MAX_RETRIES) {
        console.error('[WS] Max retries reached, giving up')
        return
      }

      retryCount.current++
      const delay = Math.min(retryDelay.current, 10_000)
      retryDelay.current = delay * 1.5
      timerRef.current = setTimeout(connect, delay)
    }
  }, [roomId, playerId, token])  // ONLY these — callbacks handled via refs above

  useEffect(() => {
    unmounted.current = false
    retryDelay.current = 1000
    retryCount.current = 0
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

import { useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import type { ServerMessage } from '../types'
import { getToken } from '../lib/session'

interface UseWebSocketOptions {
  onMessage: (msg: ServerMessage) => void
  onOpen?:   () => void
  onClose?:  () => void
}

export function useWebSocket({ onMessage, onOpen, onClose }: UseWebSocketOptions) {
  const wsRef      = useRef<WebSocket | null>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted  = useRef(false)
  const retryDelay = useRef(1000)
  const retryCount = useRef(0)
  const MAX_RETRIES = 10

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

    ws.onerror = () => { /* onerror always followed by onclose */ }

    ws.onclose = (evt) => {
      onCloseRef.current?.()
      wsRef.current = null
      if (unmounted.current) return
      // 4000 = game reset (don't retry), 4001 = auth error (don't retry)
      if (evt.code === 4000 || evt.code === 4001) return
      if (retryCount.current >= MAX_RETRIES) return

      retryCount.current++
      const delay = Math.min(retryDelay.current, 10_000)
      retryDelay.current = delay * 1.5
      timerRef.current = setTimeout(connect, delay)
    }
  }, []) // stable — token read dynamically each time

  useEffect(() => {
    unmounted.current  = false
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

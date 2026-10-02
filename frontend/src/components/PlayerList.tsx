import type { PlayerInfo } from '../types'

interface PlayerListProps {
  players: PlayerInfo[]
  myPlayerId: string
  showWallet?: boolean
}

export default function PlayerList({ players, myPlayerId, showWallet = true }: PlayerListProps) {
  if (players.length === 0) {
    return <p className="text-zinc-500 text-sm italic">No players yet…</p>
  }

  return (
    <div className="flex flex-col gap-1">
      {players.map((p) => (
        <div
          key={p.id}
          className={`
            flex items-center justify-between px-3 py-2 rounded-lg text-sm
            ${p.id === myPlayerId ? 'bg-brand-500/10 border border-brand-500/30' : 'bg-zinc-800/60'}
          `}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${p.isConnected ? 'bg-brand-400' : 'bg-zinc-600'}`}
            />
            <span className={p.id === myPlayerId ? 'text-brand-400 font-medium' : 'text-zinc-300'}>
              {p.username}
              {p.id === myPlayerId && <span className="text-zinc-500 text-xs ml-1">(you)</span>}
            </span>
          </div>
          {showWallet && (
            <span className="text-zinc-400 text-xs tabular-nums">
              {p.wallet.toLocaleString()} coins
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

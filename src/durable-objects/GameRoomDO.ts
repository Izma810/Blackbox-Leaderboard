import type {
  Env, ServerMessage, RoomState, PublicSubmission, RoundResult, RoundSummary,
  WalletDelta, LeaderboardEntry, PuzzleForPlayers, Round, Room, VoteType,
} from '../types'
import { PUZZLE_MAP, getPuzzleForPlayers } from '../game/puzzles'
import { compileFormula, judge, normalisedDistance, DUPLICATE_TOLERANCE } from '../game/formula'
import {
  getRoomById, getPlayersByRoom, getPlayerById, getCurrentRound,
  getSubmissionsForRound, buildPublicSubmissions, getVoteCountsForRound,
  getVoteCountForSubmission, getPlayerVoteCount, getPlayerVotes,
} from '../db/d1'

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Money rules. From room config: Ps = post stake, Pp = post payout,
 * Vs = vote stake, Bp = back payout (always > Pp, so backing a right answer
 * pays more than posting it).
 *
 *   Posting, voting and hints are paid for up front — the coins leave your
 *   wallet immediately. When the round ends each formula is judged and settled:
 *
 *              RIGHT                        CLOSE (right shape,         WRONG
 *                                           wrong numbers)
 *   poster     stake back + Pp              stake back + Pp/2           stake lost to bank
 *              + every doubter's stake                                  − Vs paid to each doubter
 *   backer     stake back + Bp              stake back + Bp/2           stake lost to bank
 *   doubter    stake goes to the poster     stake back                  stake back + Vs from poster
 */
export class GameRoomDO implements DurableObject {
  private connections = new Map<string, WebSocket>()  // playerId → WebSocket
  private ctx: DurableObjectState
  private env: Env
  /**
   * D1 calls are not covered by Durable Object input gates, so concurrent
   * requests can interleave across awaits. Every state-changing operation runs
   * through this queue to keep budget, wallet and duplicate checks race-free.
   */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  // ─── Main fetch dispatcher ────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Persist roomId on first request so the alarm handler can find it
    const roomId = request.headers.get('X-Room-Id') ?? url.searchParams.get('roomId') ?? ''
    if (roomId) {
      const stored = await this.ctx.storage.get<string>('roomId')
      if (!stored) await this.ctx.storage.put('roomId', roomId)
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(url, roomId)
    }

    // Internal HTTP actions
    const action = url.pathname.replace(/^\/+/, '')
    let body: Record<string, unknown> = {}
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try { body = await request.json() } catch { /* empty body is fine */ }
    }

    switch (action) {
      case 'submit':               return this.serialized(() => this.handleSubmit(roomId, body))
      case 'vote':                 return this.serialized(() => this.handleVote(roomId, body))
      case 'hint':                 return this.serialized(() => this.handleHint(roomId, body))
      case 'admin/start-round':    return this.serialized(() => this.handleStartRound(roomId, body))
      case 'admin/advance-phase':  return this.serialized(() => this.handleAdvancePhase(roomId))
      case 'admin/end-game':       return this.serialized(() => this.handleEndGame(roomId))
      case 'admin/config':         return this.serialized(() => this.handleUpdateConfig(roomId, body))
      case 'admin/delete':         return this.serialized(() => this.handleDeleteRoom(roomId))
      case 'state':                return this.handleGetState(roomId)
      default:                     return new Response('Not found', { status: 404 })
    }
  }

  // ─── Alarm (round timer) ──────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const roomId = await this.ctx.storage.get<string>('roomId')
    if (!roomId) return
    await this.serialized(async () => {
      const round = await getCurrentRound(this.env.DB, roomId)
      // Only the live phase is timed; ignore stale alarms
      if (round?.phase === 'submission') await this.transitionToResults(roomId, round)
    })
  }

  // ─── WebSocket handling ───────────────────────────────────────────────────

  private handleWebSocket(url: URL, roomId: string): Response {
    const playerId = url.searchParams.get('playerId') ?? ''

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()

    this.connections.set(playerId, server)

    server.addEventListener('message', (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data as string)
        if (msg.type === 'PING') server.send(JSON.stringify({ type: 'PONG' }))
      } catch { /* ignore malformed messages */ }
    })

    server.addEventListener('close', () => {
      if (this.connections.get(playerId) === server) this.connections.delete(playerId)
      this.ctx.waitUntil(this.onPlayerDisconnect(playerId))
    })

    server.addEventListener('error', () => {
      if (this.connections.get(playerId) === server) this.connections.delete(playerId)
    })

    // Send initial state and notify others asynchronously
    this.ctx.waitUntil(this.initConnection(server, playerId, roomId))

    return new Response(null, { status: 101, webSocket: client })
  }

  private async initConnection(server: WebSocket, playerId: string, roomId: string) {
    try {
      await this.env.DB
        .prepare('UPDATE players SET is_connected = 1 WHERE id = ?')
        .bind(playerId).run()

      const state = await this.buildRoomState(roomId, playerId)
      server.send(JSON.stringify({ type: 'FULL_STATE', state } satisfies ServerMessage))

      const player = state.players.find((p) => p.id === playerId)
      if (player) this.broadcast({ type: 'PLAYER_JOINED', player }, playerId)
    } catch (e) {
      console.error('[DO] initConnection error:', e)
    }
  }

  private async onPlayerDisconnect(playerId: string) {
    try {
      await this.env.DB
        .prepare('UPDATE players SET is_connected = 0 WHERE id = ?')
        .bind(playerId).run()
      this.broadcast({ type: 'PLAYER_LEFT', playerId })
    } catch (e) {
      console.error('[DO] onPlayerDisconnect error:', e)
    }
  }

  // ─── State builder ────────────────────────────────────────────────────────

  private async buildRoomState(roomId: string, playerId?: string): Promise<RoomState> {
    const [room, players, round] = await Promise.all([
      getRoomById(this.env.DB, roomId),
      getPlayersByRoom(this.env.DB, roomId),
      getCurrentRound(this.env.DB, roomId),
    ])

    if (!room) throw new Error('Room not found')

    let submissions: PublicSubmission[] = []
    let voteCounts: RoomState['voteCounts'] = []
    let myVotes: RoomState['myVotes'] = {}
    let myHints: string[] = []
    let summary: RoundSummary | null = null
    const puzzleData = round ? PUZZLE_MAP.get(round.puzzleId) : undefined

    if (round) {
      const rows = await getSubmissionsForRound(this.env.DB, round.id)
      submissions = buildPublicSubmissions(rows, room.config.anonymousVoting)
      voteCounts = await getVoteCountsForRound(this.env.DB, round.id)
      if (playerId) {
        myVotes = await getPlayerVotes(this.env.DB, round.id, playerId)
        const bought = await this.hintsBought(round.id, playerId)
        myHints = puzzleData?.hints.slice(0, bought) ?? []
      }
      if (round.phase === 'results') summary = await this.buildSummary(room, round)
    }

    const completedRounds = await this.env.DB
      .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ? AND ended_at IS NOT NULL')
      .bind(roomId).first<{ cnt: number }>()

    // Include puzzle data for active rounds (never includes solution)
    let puzzle: PuzzleForPlayers | null = null
    if (round) {
      const p = PUZZLE_MAP.get(round.puzzleId)
      if (p) puzzle = getPuzzleForPlayers(p)
    }

    return {
      room,
      players,
      currentRound: round,
      submissions,
      voteCounts,
      myVotes,
      myHints,
      roundNumber: (completedRounds?.cnt ?? 0) + (round ? 1 : 0),
      puzzle,
      summary,
    }
  }

  // ─── Submit handler ───────────────────────────────────────────────────────

  private async handleSubmit(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const playerId = body.playerId as string
    if (!playerId) return jsonRes({ error: 'Missing playerId' }, 400)

    const round = await getCurrentRound(this.env.DB, roomId)
    if (!round || round.phase !== 'submission') {
      return jsonRes({ error: 'The round is not live' }, 400)
    }

    const already = await this.env.DB
      .prepare('SELECT id FROM submissions WHERE round_id = ? AND player_id = ?')
      .bind(round.id, playerId).first()
    if (already) return jsonRes({ error: 'You already posted a formula this round' }, 409)

    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    if (!puzzle) return jsonRes({ error: 'Puzzle not found' }, 500)

    const expr = typeof body.expr === 'string' ? body.expr.trim() : ''
    let prediction: number[]
    try {
      ({ prediction } = compileFormula(expr, puzzle.X))
    } catch (e) {
      return jsonRes({ error: (e as Error).message }, 400)
    }

    const [room, player] = await Promise.all([
      getRoomById(this.env.DB, roomId),
      getPlayerById(this.env.DB, playerId),
    ])
    if (!room || !player) return jsonRes({ error: 'Room or player not found' }, 404)

    const stake = room.config.postStake
    if (player.wallet < stake) {
      return jsonRes({ error: `Posting costs ${stake} coins — you have ${player.wallet}` }, 403)
    }

    // Duplicate check: same predictions as an existing formula ⇒ same answer
    const existingRows = await getSubmissionsForRound(this.env.DB, round.id)
    const existing = buildPublicSubmissions(existingRows, room.config.anonymousVoting)
    for (const sub of existing) {
      let other: number[]
      try { ({ prediction: other } = compileFormula(sub.expr, puzzle.X)) } catch { continue }
      if (normalisedDistance(prediction, other, puzzle.y) < DUPLICATE_TOLERANCE) {
        return jsonRes({
          error: `${sub.label} already claimed this formula. Back it with an upvote, or try something different.`,
          duplicateOf: sub.id,
        }, 409)
      }
    }

    const submissionId = crypto.randomUUID()
    const now = Date.now()
    await this.env.DB.batch([
      this.env.DB
        .prepare(`INSERT INTO submissions (id, round_id, player_id, features_json, submitted_at)
                  VALUES (?, ?, ?, ?, ?)`)
        .bind(submissionId, round.id, playerId, expr, now),
      ...this.walletStmts(playerId, round.id, -stake, 'post_stake', 'Posted a formula', now),
    ])

    const publicSub: PublicSubmission = {
      id: submissionId,
      playerId,
      label: room.config.anonymousVoting ? String.fromCharCode(65 + existing.length) : player.username,
      expr,
      submittedAt: now,
    }

    this.broadcast({ type: 'SUBMISSION_MADE', submission: publicSub })
    await this.broadcastPlayer(playerId)

    return jsonRes({ ok: true, submissionId })
  }

  // ─── Vote handler ─────────────────────────────────────────────────────────

  private async handleVote(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const { playerId, submissionId, voteType } = body as {
      playerId: string; submissionId: string; voteType: VoteType
    }

    if (!playerId || !submissionId || !voteType) {
      return jsonRes({ error: 'Missing required fields' }, 400)
    }
    if (voteType !== 'up' && voteType !== 'down') {
      return jsonRes({ error: 'voteType must be "up" or "down"' }, 400)
    }

    const round = await getCurrentRound(this.env.DB, roomId)
    if (!round || round.phase !== 'submission') {
      return jsonRes({ error: 'The round is not live' }, 400)
    }

    const sub = await this.env.DB
      .prepare('SELECT player_id FROM submissions WHERE id = ? AND round_id = ?')
      .bind(submissionId, round.id).first<{ player_id: string }>()
    if (!sub) return jsonRes({ error: 'Submission not found' }, 404)
    if (sub.player_id === playerId) return jsonRes({ error: 'You cannot vote on your own formula' }, 403)

    const [room, player] = await Promise.all([
      getRoomById(this.env.DB, roomId),
      getPlayerById(this.env.DB, playerId),
    ])
    if (!room || !player) return jsonRes({ error: 'Room or player not found' }, 404)

    const usedVotes = await getPlayerVoteCount(this.env.DB, round.id, playerId)
    if (usedVotes >= room.config.votesPerRound) {
      return jsonRes({ error: 'You have used all your votes this round' }, 403)
    }

    const dupVote = await this.env.DB
      .prepare('SELECT 1 FROM votes WHERE round_id = ? AND voter_id = ? AND submission_id = ?')
      .bind(round.id, playerId, submissionId).first()
    if (dupVote) return jsonRes({ error: 'You already voted on this formula' }, 409)

    const stake = room.config.voteStake
    if (player.wallet < stake) {
      return jsonRes({ error: `A vote costs ${stake} coins — you have ${player.wallet}` }, 403)
    }

    const now = Date.now()
    await this.env.DB.batch([
      this.env.DB
        .prepare(`INSERT INTO votes (id, round_id, submission_id, voter_id, vote_type, voted_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), round.id, submissionId, playerId, voteType, now),
      ...this.walletStmts(
        playerId, round.id, -stake, 'vote_stake',
        voteType === 'up' ? 'Upvoted a formula' : 'Downvoted a formula', now,
      ),
    ])

    const counts = await getVoteCountForSubmission(this.env.DB, submissionId)
    this.broadcast({ type: 'VOTE_UPDATE', submissionId, ...counts })
    await this.broadcastPlayer(playerId)

    return jsonRes({ ok: true, votesRemaining: room.config.votesPerRound - usedVotes - 1 })
  }

  // ─── Hint handler ─────────────────────────────────────────────────────────

  private async handleHint(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const playerId = body.playerId as string
    if (!playerId) return jsonRes({ error: 'Missing playerId' }, 400)

    const round = await getCurrentRound(this.env.DB, roomId)
    if (!round || round.phase !== 'submission') {
      return jsonRes({ error: 'Hints are only available while a round is live' }, 400)
    }
    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    if (!puzzle) return jsonRes({ error: 'Puzzle not found' }, 500)

    const [room, player, bought] = await Promise.all([
      getRoomById(this.env.DB, roomId),
      getPlayerById(this.env.DB, playerId),
      this.hintsBought(round.id, playerId),
    ])
    if (!room || !player) return jsonRes({ error: 'Room or player not found' }, 404)
    if (bought >= puzzle.hints.length) return jsonRes({ error: 'You already have every hint' }, 409)

    const cost = room.config.hintCost
    if (player.wallet < cost) {
      return jsonRes({ error: `A hint costs ${cost} coins — you have ${player.wallet}` }, 403)
    }

    await this.env.DB.batch(
      this.walletStmts(playerId, round.id, -cost, 'hint', `Bought hint ${bought + 1}`, Date.now()),
    )
    await this.broadcastPlayer(playerId)

    return jsonRes({ ok: true, hints: puzzle.hints.slice(0, bought + 1) })
  }

  private async hintsBought(roundId: string, playerId: string): Promise<number> {
    const r = await this.env.DB
      .prepare(`SELECT COUNT(*) as cnt FROM wallet_transactions
                WHERE round_id = ? AND player_id = ? AND type = 'hint'`)
      .bind(roundId, playerId).first<{ cnt: number }>()
    return r?.cnt ?? 0
  }

  // ─── Admin: start round ───────────────────────────────────────────────────

  private async handleStartRound(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const { puzzleId } = body as { puzzleId: string }
    if (!puzzleId) return jsonRes({ error: 'Missing puzzleId' }, 400)
    if (!PUZZLE_MAP.has(puzzleId)) return jsonRes({ error: 'Unknown puzzle' }, 400)

    const room = await getRoomById(this.env.DB, roomId)
    if (!room) return jsonRes({ error: 'Room not found' }, 404)
    if (room.status === 'finished') return jsonRes({ error: 'Room is finished' }, 400)

    // Ensure no active round
    const active = await getCurrentRound(this.env.DB, roomId)
    if (active && active.phase !== 'results') {
      return jsonRes({ error: 'A round is still in progress' }, 409)
    }

    // Mark previous results-phase round as ended (if any)
    if (active?.phase === 'results') {
      await this.env.DB
        .prepare('UPDATE rounds SET ended_at = ? WHERE id = ?')
        .bind(Date.now(), active.id).run()
    }

    const cnt = await this.env.DB
      .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ?')
      .bind(roomId).first<{ cnt: number }>()
    const roundNumber = (cnt?.cnt ?? 0) + 1

    const roundId = crypto.randomUUID()
    const phaseEndsAt = Date.now() + room.config.phase1Secs * 1000
    await this.env.DB
      .prepare(`
        INSERT INTO rounds (id, room_id, round_number, puzzle_id, phase, phase_ends_at, started_at)
        VALUES (?, ?, ?, ?, 'submission', ?, ?)
      `)
      .bind(roundId, roomId, roundNumber, puzzleId, phaseEndsAt, Date.now())
      .run()

    const players = await getPlayersByRoom(this.env.DB, roomId)
    if (players.length > 0) {
      await this.env.DB.batch(players.map((p) =>
        this.env.DB
          .prepare('INSERT OR IGNORE INTO round_players (round_id, player_id) VALUES (?, ?)')
          .bind(roundId, p.id),
      ))
    }

    await this.env.DB
      .prepare('UPDATE rooms SET status = ? WHERE id = ?')
      .bind('active', roomId).run()

    await this.ctx.storage.setAlarm(phaseEndsAt)

    const puzzleForBroadcast = getPuzzleForPlayers(PUZZLE_MAP.get(puzzleId)!)
    this.broadcast({ type: 'PHASE_CHANGED', phase: 'submission', endsAt: phaseEndsAt, puzzle: puzzleForBroadcast })

    return jsonRes({ ok: true, roundId })
  }

  // ─── Admin: force-advance phase ───────────────────────────────────────────

  private async handleAdvancePhase(roomId: string): Promise<Response> {
    const round = await getCurrentRound(this.env.DB, roomId)
    if (round?.phase === 'submission') await this.transitionToResults(roomId, round)
    else if (round?.phase === 'results') await this.closeRound(round)
    return jsonRes({ ok: true })
  }

  // ─── Admin: end game ──────────────────────────────────────────────────────

  private async handleEndGame(roomId: string): Promise<Response> {
    await this.endGame(roomId)
    return jsonRes({ ok: true })
  }

  private async endGame(roomId: string) {
    const round = await getCurrentRound(this.env.DB, roomId)
    // Settle a live round before closing so no stakes are left hanging
    if (round?.phase === 'submission') await this.transitionToResults(roomId, round, false)
    if (round) {
      await this.env.DB
        .prepare('UPDATE rounds SET ended_at = ? WHERE id = ?')
        .bind(Date.now(), round.id).run()
    }

    await this.env.DB
      .prepare('UPDATE rooms SET status = ? WHERE id = ?')
      .bind('finished', roomId).run()

    const leaderboard = await this.buildLeaderboard(roomId)
    this.broadcast({ type: 'GAME_ENDED', leaderboard })
  }

  // ─── Admin: delete room ───────────────────────────────────────────────────

  private async handleDeleteRoom(roomId: string): Promise<Response> {
    const room = await getRoomById(this.env.DB, roomId)
    if (!room) return jsonRes({ error: 'Room not found' }, 404)

    const inRoom = (table: string, col: string, via: 'rounds' | 'players') =>
      this.env.DB
        .prepare(`DELETE FROM ${table} WHERE ${col} IN (SELECT id FROM ${via} WHERE room_id = ?)`)
        .bind(roomId)

    // Children first so foreign keys never point at deleted rows
    await this.env.DB.batch([
      inRoom('votes', 'round_id', 'rounds'),
      inRoom('submissions', 'round_id', 'rounds'),
      inRoom('round_players', 'round_id', 'rounds'),
      inRoom('wallet_transactions', 'player_id', 'players'),
      this.env.DB.prepare('DELETE FROM rounds WHERE room_id = ?').bind(roomId),
      this.env.DB.prepare('DELETE FROM players WHERE room_id = ?').bind(roomId),
      this.env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(roomId),
    ])

    // Kick everyone out and wipe this object's own storage (stored roomId, alarm)
    this.broadcast({ type: 'ROOM_DELETED' })
    for (const ws of this.connections.values()) {
      try { ws.close(4004, 'Room deleted') } catch { /* already closed */ }
    }
    this.connections.clear()
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()

    return jsonRes({ ok: true })
  }

  // ─── Admin: update config ─────────────────────────────────────────────────

  private async handleUpdateConfig(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const round = await getCurrentRound(this.env.DB, roomId)
    if (round && round.phase === 'submission') {
      return jsonRes({ error: 'Cannot change settings while a round is live' }, 409)
    }

    const allowed = [
      'phase1_secs', 'poster_reward', 'post_payout', 'voter_reward', 'back_payout', 'hint_cost',
      'votes_per_round', 'anonymous_voting', 'max_rounds', 'starting_wallet',
    ]

    // Backing a right answer must always pay more than posting it
    const room = await getRoomById(this.env.DB, roomId)
    if (!room) return jsonRes({ error: 'Room not found' }, 404)
    const postPayout = Number(body.post_payout ?? room.config.postPayout)
    const backPayout = Number(body.back_payout ?? room.config.backPayout)
    if (!(backPayout > postPayout)) {
      return jsonRes({ error: 'The back payout must be bigger than the post payout' }, 400)
    }
    const sets: string[] = []
    const vals: unknown[] = []

    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`)
        vals.push(body[key])
      }
    }

    if (sets.length === 0) return jsonRes({ error: 'Nothing to update' }, 400)
    vals.push(roomId)

    await this.env.DB
      .prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals).run()

    return jsonRes({ ok: true })
  }

  // ─── Get state (for admin full view) ─────────────────────────────────────

  private async handleGetState(roomId: string): Promise<Response> {
    const state = await this.buildRoomState(roomId)
    return jsonRes(state)
  }

  // ─── Round settlement ─────────────────────────────────────────────────────

  private async transitionToResults(roomId: string, round: Round, allowAutoEnd = true) {
    await this.ctx.storage.deleteAlarm()

    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    const room = await getRoomById(this.env.DB, roomId)
    if (!puzzle || !room) return

    const { postStake: Ps, postPayout: Pp, voteStake: Vs, backPayout: Bp } = room.config
    const now = Date.now()

    const [submissionRows, voteRows] = await Promise.all([
      getSubmissionsForRound(this.env.DB, round.id),
      this.env.DB
        .prepare('SELECT submission_id, voter_id, vote_type FROM votes WHERE round_id = ?')
        .bind(round.id)
        .all<{ submission_id: string; voter_id: string; vote_type: VoteType }>(),
    ])

    const stmts: D1PreparedStatement[] = []
    const pay = (playerId: string, delta: number, type: string, note: string) => {
      if (delta !== 0) stmts.push(...this.walletStmts(playerId, round.id, delta, type, note, now))
    }

    for (const row of submissionRows) {
      const { verdict, r2 } = judge(row.features_json, puzzle.X, puzzle.y, puzzle.solution)
      const votes = voteRows.results.filter((v) => v.submission_id === row.id)
      const backers = votes.filter((v) => v.vote_type === 'up')
      const doubters = votes.filter((v) => v.vote_type === 'down')

      stmts.push(
        this.env.DB
          .prepare('UPDATE submissions SET r2_score = ?, is_correct = ? WHERE id = ?')
          .bind(r2, verdict === 'right' ? 1 : 0, row.id),
      )

      if (verdict === 'right') {
        pay(row.player_id, Ps + Pp, 'post_win', 'Your formula was right: stake back plus payout')
        pay(row.player_id, Vs * doubters.length, 'post_doubter_income', 'Collected stakes from players who doubted you')
        stmts.push(
          this.env.DB
            .prepare('UPDATE players SET total_score = total_score + 1 WHERE id = ?')
            .bind(row.player_id),
        )
        for (const v of backers) pay(v.voter_id, Vs + Bp, 'back_win', 'Backed a right formula')
        // doubters' stakes were collected above and paid to the poster
      } else if (verdict === 'close') {
        pay(row.player_id, Ps + Math.round(Pp / 2), 'post_close', 'Right shape, wrong numbers: stake back plus half payout')
        for (const v of backers) pay(v.voter_id, Vs + Math.round(Bp / 2), 'back_close', 'Backed a nearly-right formula')
        for (const v of doubters) pay(v.voter_id, Vs, 'doubt_refund', 'Doubted a nearly-right formula: stake refunded')
      } else {
        // Poster's stake is kept by the bank; each doubter is paid by the poster
        pay(row.player_id, -Vs * doubters.length, 'post_doubter_payout', 'Paid players who called out your wrong formula')
        for (const v of doubters) pay(v.voter_id, 2 * Vs, 'doubt_win', 'Called out a wrong formula')
        // backers' stakes stay with the bank
      }
    }

    stmts.push(
      this.env.DB
        .prepare('UPDATE rounds SET phase = ?, phase_ends_at = NULL WHERE id = ?')
        .bind('results', round.id),
    )

    await this.env.DB.batch(stmts)

    const settledRound: Round = { ...round, phase: 'results', phaseEndsAt: null }
    const [summary, players] = await Promise.all([
      this.buildSummary(room, settledRound),
      getPlayersByRoom(this.env.DB, roomId),
    ])
    this.broadcast({ type: 'ROUND_RESULTS', summary, players })

    if (allowAutoEnd && room.config.maxRounds) {
      const completed = await this.env.DB
        .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ? AND ended_at IS NOT NULL')
        .bind(roomId).first<{ cnt: number }>()
      // +1 because the current round isn't ended yet
      if ((completed?.cnt ?? 0) + 1 >= room.config.maxRounds) await this.endGame(roomId)
    }
  }

  /** Results of a settled round, rebuilt from the DB so reconnecting clients see them too. */
  private async buildSummary(room: Room, round: Round): Promise<RoundSummary> {
    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    const [rows, voteCounts, players, deltaRows] = await Promise.all([
      getSubmissionsForRound(this.env.DB, round.id),
      getVoteCountsForRound(this.env.DB, round.id),
      getPlayersByRoom(this.env.DB, room.id),
      this.env.DB
        .prepare('SELECT player_id, SUM(delta) as delta FROM wallet_transactions WHERE round_id = ? GROUP BY player_id')
        .bind(round.id)
        .all<{ player_id: string; delta: number }>(),
    ])

    const subs = buildPublicSubmissions(rows, room.config.anonymousVoting)
    const results: RoundResult[] = subs.map((sub) => {
      const counts = voteCounts.find((v) => v.submissionId === sub.id)
      const judgement = puzzle
        ? judge(sub.expr, puzzle.X, puzzle.y, puzzle.solution)
        : { verdict: 'wrong' as const, accuracy: 0 }
      return {
        submissionId: sub.id,
        playerId:     sub.playerId,
        label:        sub.label,
        expr:         sub.expr,
        accuracy:     judgement.accuracy,
        verdict:      judgement.verdict,
        ups:          counts?.ups ?? 0,
        downs:        counts?.downs ?? 0,
      }
    })

    const playerMap = new Map(players.map((p) => [p.id, p]))
    const deltas: WalletDelta[] = deltaRows.results.flatMap((r) => {
      const p = playerMap.get(r.player_id)
      return p ? [{ playerId: p.id, username: p.username, delta: r.delta, newBalance: p.wallet }] : []
    })

    return { results, deltas, solution: puzzle?.solution ?? '' }
  }

  private async closeRound(round: Round) {
    await this.env.DB
      .prepare('UPDATE rounds SET ended_at = ? WHERE id = ?')
      .bind(Date.now(), round.id).run()
    this.broadcast({ type: 'PHASE_CHANGED', phase: 'lobby', endsAt: null })
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Wallet update + audit-log row, for inclusion in a batch. */
  private walletStmts(
    playerId: string, roundId: string, delta: number, type: string, note: string, now: number,
  ): D1PreparedStatement[] {
    return [
      this.env.DB
        .prepare('UPDATE players SET wallet = wallet + ? WHERE id = ?')
        .bind(delta, playerId),
      this.env.DB
        .prepare(`INSERT INTO wallet_transactions (id, player_id, round_id, type, delta, note, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), playerId, roundId, type, delta, note, now),
    ]
  }

  private async broadcastPlayer(playerId: string) {
    const player = await getPlayerById(this.env.DB, playerId)
    if (player) this.broadcast({ type: 'PLAYER_UPDATED', player })
  }

  private async buildLeaderboard(roomId: string): Promise<LeaderboardEntry[]> {
    const players = await getPlayersByRoom(this.env.DB, roomId)
    return players
      .sort((a, b) => b.wallet - a.wallet || b.totalScore - a.totalScore)
      .map((p, idx) => ({
        rank:       idx + 1,
        playerId:   p.id,
        username:   p.username,
        wallet:     p.wallet,
        totalScore: p.totalScore,
      }))
  }

  private broadcast(message: ServerMessage, excludePlayerId?: string) {
    const data = JSON.stringify(message)
    for (const [pid, ws] of this.connections) {
      if (pid === excludePlayerId) continue
      try {
        ws.send(data)
      } catch {
        this.connections.delete(pid)
      }
    }
  }
}

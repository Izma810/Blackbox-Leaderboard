import type {
  Env, ServerMessage, PlayerInfo, RoomState, Phase,
  PublicSubmission, Feature, RoundResult, WalletDelta, LeaderboardEntry,
  PuzzleForPlayers,
} from '../types'
import { PUZZLE_MAP, getPuzzleForPlayers } from '../game/puzzles'
import { buildFeatureMatrix, evaluateSubmission, fuzzyPowerScore } from '../game/scoring'
import { isTooSimilar } from '../game/similarity'
import {
  getRoomById, getPlayersByRoom, getCurrentRound, getRoundById,
  getSubmissionsForRound, buildPublicSubmissions, getVoteCountsForRound,
  getVoteCountForSubmission, getPlayerVoteCount, rowToRoom,
} from '../db/d1'

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export class GameRoomDO implements DurableObject {
  private connections = new Map<string, WebSocket>()  // playerId → WebSocket
  private ctx: DurableObjectState
  private env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
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
      return this.handleWebSocket(request, url, roomId)
    }

    // Internal HTTP actions
    const action = url.pathname.replace(/^\/+/, '')
    let body: Record<string, unknown> = {}
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try { body = await request.json() } catch { /* empty body is fine */ }
    }

    switch (action) {
      case 'submit':               return this.handleSubmit(roomId, body)
      case 'vote':                 return this.handleVote(roomId, body)
      case 'admin/start-round':    return this.handleStartRound(roomId, body)
      case 'admin/advance-phase':  return this.handleAdvancePhase(roomId)
      case 'admin/end-game':       return this.handleEndGame(roomId)
      case 'admin/config':         return this.handleUpdateConfig(roomId, body)
      case 'state':                return this.handleGetState(roomId)
      default:                     return new Response('Not found', { status: 404 })
    }
  }

  // ─── Alarm (phase timer) ──────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const roomId = await this.ctx.storage.get<string>('roomId')
    if (!roomId) return
    await this.advancePhase(roomId)
  }

  // ─── WebSocket handling ───────────────────────────────────────────────────

  private handleWebSocket(request: Request, url: URL, roomId: string): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

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
      this.connections.delete(playerId)
      this.ctx.waitUntil(this.onPlayerDisconnect(playerId))
    })

    server.addEventListener('error', () => {
      this.connections.delete(playerId)
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

      const state = await this.buildRoomState(roomId)
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

  private async buildRoomState(roomId: string): Promise<RoomState> {
    const [room, players, round] = await Promise.all([
      getRoomById(this.env.DB, roomId),
      getPlayersByRoom(this.env.DB, roomId),
      getCurrentRound(this.env.DB, roomId),
    ])

    if (!room) throw new Error('Room not found')

    let submissions: PublicSubmission[] = []
    let voteCounts: import('../types').VoteCount[] = []

    if (round) {
      const rows = await getSubmissionsForRound(this.env.DB, round.id)
      submissions = buildPublicSubmissions(rows, room.config.anonymousVoting)
      if (round.phase === 'voting' || round.phase === 'results') {
        voteCounts = await getVoteCountsForRound(this.env.DB, round.id)
      }
    }

    const completedRounds = await this.env.DB
      .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ? AND ended_at IS NOT NULL')
      .bind(roomId).first<{ cnt: number }>()

    // Include puzzle data for active rounds (never includes solution)
    let puzzle: PuzzleForPlayers | null = null
    if (round && round.phase !== 'finished') {
      const p = PUZZLE_MAP.get(round.puzzleId)
      if (p) puzzle = getPuzzleForPlayers(p)
    }

    return {
      room,
      players,
      currentRound: round,
      submissions,
      voteCounts,
      roundNumber: (completedRounds?.cnt ?? 0) + (round ? 1 : 0),
      puzzle,
    }
  }

  // ─── Submit handler ───────────────────────────────────────────────────────

  private async handleSubmit(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const { playerId, features } = body as { playerId: string; features: Feature[] }

    if (!playerId || !features?.length) {
      return jsonRes({ error: 'Missing playerId or features' }, 400)
    }

    const round = await getCurrentRound(this.env.DB, roomId)
    if (!round || round.phase !== 'submission') {
      return jsonRes({ error: 'Not in submission phase' }, 400)
    }

    // Idempotency: already submitted?
    const already = await this.env.DB
      .prepare('SELECT id FROM submissions WHERE round_id = ? AND player_id = ?')
      .bind(round.id, playerId).first()
    if (already) return jsonRes({ error: 'Already submitted for this round' }, 409)

    // Puzzle data
    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    if (!puzzle) return jsonRes({ error: 'Puzzle not found' }, 500)

    // Validate features can be applied to puzzle columns
    let newMatrix: number[][]
    try {
      newMatrix = buildFeatureMatrix(features, puzzle.X)
    } catch (e) {
      return jsonRes({ error: (e as Error).message }, 400)
    }

    // Similarity check against existing submissions
    const existingRows = await getSubmissionsForRound(this.env.DB, round.id)
    const existingMatrices = existingRows.map((r) =>
      buildFeatureMatrix(JSON.parse(r.features_json) as Feature[], puzzle.X),
    )
    if (isTooSimilar(newMatrix, existingMatrices)) {
      return jsonRes({ error: 'Too similar to an existing submission — pick a different approach' }, 409)
    }

    // Insert submission
    const submissionId = crypto.randomUUID()
    await this.env.DB
      .prepare(`
        INSERT INTO submissions (id, round_id, player_id, features_json, submitted_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(submissionId, round.id, playerId, JSON.stringify(features), Date.now())
      .run()

    // Build label for broadcast
    const room = await getRoomById(this.env.DB, roomId)
    const label = room?.config.anonymousVoting
      ? String.fromCharCode(65 + existingRows.length)  // A, B, C, …
      : ((await this.env.DB
            .prepare('SELECT username FROM players WHERE id = ?')
            .bind(playerId).first<{ username: string }>())?.username ?? playerId)

    const publicSub: PublicSubmission = {
      id: submissionId,
      playerId,
      label,
      features,
      submittedAt: Date.now(),
    }

    this.broadcast({ type: 'SUBMISSION_MADE', submission: publicSub })

    return jsonRes({ ok: true, submissionId })
  }

  // ─── Vote handler ─────────────────────────────────────────────────────────

  private async handleVote(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const { playerId, submissionId, voteType } = body as {
      playerId: string; submissionId: string; voteType: 'up' | 'down'
    }

    if (!playerId || !submissionId || !voteType) {
      return jsonRes({ error: 'Missing required fields' }, 400)
    }
    if (voteType !== 'up' && voteType !== 'down') {
      return jsonRes({ error: 'voteType must be "up" or "down"' }, 400)
    }

    const round = await getCurrentRound(this.env.DB, roomId)
    if (!round || round.phase !== 'voting') {
      return jsonRes({ error: 'Not in voting phase' }, 400)
    }

    // Cannot vote on own submission
    const sub = await this.env.DB
      .prepare('SELECT player_id FROM submissions WHERE id = ? AND round_id = ?')
      .bind(submissionId, round.id).first<{ player_id: string }>()
    if (!sub) return jsonRes({ error: 'Submission not found' }, 404)
    if (sub.player_id === playerId) return jsonRes({ error: 'Cannot vote on your own submission' }, 403)

    // Vote budget check
    const room = await getRoomById(this.env.DB, roomId)
    if (!room) return jsonRes({ error: 'Room not found' }, 404)

    const usedVotes = await getPlayerVoteCount(this.env.DB, round.id, playerId)
    if (usedVotes >= room.config.votesPerRound) {
      return jsonRes({ error: 'Vote budget exhausted' }, 403)
    }

    // Duplicate vote check (UNIQUE constraint handles this, but nice to give a clear error)
    const dupVote = await this.env.DB
      .prepare('SELECT 1 FROM votes WHERE round_id = ? AND voter_id = ? AND submission_id = ?')
      .bind(round.id, playerId, submissionId).first()
    if (dupVote) return jsonRes({ error: 'Already voted on this submission' }, 409)

    const voteId = crypto.randomUUID()
    await this.env.DB
      .prepare(`
        INSERT INTO votes (id, round_id, submission_id, voter_id, vote_type, voted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(voteId, round.id, submissionId, playerId, voteType, Date.now())
      .run()

    const counts = await getVoteCountForSubmission(this.env.DB, submissionId)
    this.broadcast({ type: 'VOTE_UPDATE', submissionId, ...counts })

    return jsonRes({ ok: true, votesRemaining: room.config.votesPerRound - usedVotes - 1 })
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

    // Get next round number
    const cnt = await this.env.DB
      .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ?')
      .bind(roomId).first<{ cnt: number }>()
    const roundNumber = (cnt?.cnt ?? 0) + 1

    // Create round
    const roundId = crypto.randomUUID()
    const phaseEndsAt = Date.now() + room.config.phase1Secs * 1000
    await this.env.DB
      .prepare(`
        INSERT INTO rounds (id, room_id, round_number, puzzle_id, phase, phase_ends_at, started_at)
        VALUES (?, ?, ?, ?, 'submission', ?, ?)
      `)
      .bind(roundId, roomId, roundNumber, puzzleId, phaseEndsAt, Date.now())
      .run()

    // Snapshot eligible players
    const players = await getPlayersByRoom(this.env.DB, roomId)
    if (players.length > 0) {
      const insertStmts = players.map((p) =>
        this.env.DB
          .prepare('INSERT OR IGNORE INTO round_players (round_id, player_id) VALUES (?, ?)')
          .bind(roundId, p.id),
      )
      await this.env.DB.batch(insertStmts)
    }

    // Update room status
    await this.env.DB
      .prepare('UPDATE rooms SET status = ? WHERE id = ?')
      .bind('active', roomId).run()

    // Schedule alarm for phase end
    await this.ctx.storage.setAlarm(phaseEndsAt)

    // Broadcast puzzle data with phase change so clients render immediately
    const puzzleForBroadcast = getPuzzleForPlayers(PUZZLE_MAP.get(puzzleId)!)
    this.broadcast({ type: 'PHASE_CHANGED', phase: 'submission', endsAt: phaseEndsAt, puzzle: puzzleForBroadcast })

    return jsonRes({ ok: true, roundId })
  }

  // ─── Admin: force-advance phase ───────────────────────────────────────────

  private async handleAdvancePhase(roomId: string): Promise<Response> {
    await this.advancePhase(roomId)
    return jsonRes({ ok: true })
  }

  // ─── Admin: end game ──────────────────────────────────────────────────────

  private async handleEndGame(roomId: string): Promise<Response> {
    // Close any active round first
    const round = await getCurrentRound(this.env.DB, roomId)
    if (round && round.phase !== 'results') {
      await this.advancePhase(roomId)   // force through to results
    }
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

    return jsonRes({ ok: true })
  }

  // ─── Admin: update config ─────────────────────────────────────────────────

  private async handleUpdateConfig(roomId: string, body: Record<string, unknown>): Promise<Response> {
    const round = await getCurrentRound(this.env.DB, roomId)
    if (round && round.phase === 'submission') {
      return jsonRes({ error: 'Cannot change config during submission phase' }, 409)
    }

    const allowed = [
      'phase1_secs', 'phase2_secs', 'poster_reward', 'voter_reward',
      'votes_per_round', 'anonymous_voting', 'max_rounds', 'starting_wallet',
    ]
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

  // ─── Phase transition engine ──────────────────────────────────────────────

  private async advancePhase(roomId: string): Promise<void> {
    const round = await getCurrentRound(this.env.DB, roomId)
    if (!round) return

    if (round.phase === 'submission') {
      await this.transitionToVoting(roomId, round)
    } else if (round.phase === 'voting') {
      await this.transitionToResults(roomId, round)
    } else if (round.phase === 'results') {
      await this.closeRound(roomId, round)
    }
  }

  private async transitionToVoting(roomId: string, round: { id: string; puzzleId: string }) {
    const room = await getRoomById(this.env.DB, roomId)
    if (!room) return

    const phaseEndsAt = Date.now() + room.config.phase2Secs * 1000
    await this.env.DB
      .prepare('UPDATE rounds SET phase = ?, phase_ends_at = ? WHERE id = ?')
      .bind('voting', phaseEndsAt, round.id).run()

    await this.ctx.storage.setAlarm(phaseEndsAt)

    // Keep puzzle in broadcast so reconnecting clients stay in sync
    const puzzleForBroadcast = getPuzzleForPlayers(PUZZLE_MAP.get(round.puzzleId)!)
    this.broadcast({ type: 'PHASE_CHANGED', phase: 'voting', endsAt: phaseEndsAt, puzzle: puzzleForBroadcast })
  }

  private async transitionToResults(roomId: string, round: { id: string; puzzleId: string }) {
    await this.ctx.storage.deleteAlarm()

    // Evaluate all submissions
    const puzzle = PUZZLE_MAP.get(round.puzzleId)
    if (!puzzle) return

    const submissionRows = await getSubmissionsForRound(this.env.DB, round.id)
    const room = await getRoomById(this.env.DB, roomId)
    if (!room) return

    type SubInfo = {
      id: string; playerId: string; features: Feature[]
      r2: number; baseScore: number; isCorrect: boolean
    }
    const evaluated: SubInfo[] = []

    for (const row of submissionRows) {
      const features = JSON.parse(row.features_json) as Feature[]
      let r2 = 0, baseScore = 0, isCorrect = false
      try {
        const result = evaluateSubmission(features, puzzle.X, puzzle.y)
        r2 = result.r2
        isCorrect = result.isCorrect
        baseScore = isCorrect
          ? result.baseScore
          : fuzzyPowerScore(features, puzzle.correctPowerMap)
      } catch { /* malformed features — score = 0 */ }

      evaluated.push({ id: row.id, playerId: row.player_id, features, r2, baseScore, isCorrect })
    }

    // Settle wallets  ── all in one atomic batch
    const now = Date.now()
    const playerDeltas: Map<string, number> = new Map()

    const txStmts = []

    for (const sub of evaluated) {
      // Update submission scores
      txStmts.push(
        this.env.DB
          .prepare('UPDATE submissions SET r2_score = ?, base_score = ?, is_correct = ? WHERE id = ?')
          .bind(sub.r2, sub.baseScore, sub.isCorrect ? 1 : 0, sub.id),
      )

      // Poster reward/penalty
      const posterDelta = sub.isCorrect ? room.config.posterReward : -room.config.posterReward
      playerDeltas.set(sub.playerId, (playerDeltas.get(sub.playerId) ?? 0) + posterDelta)

      txStmts.push(
        this.env.DB
          .prepare(`INSERT INTO wallet_transactions (id, player_id, round_id, type, delta, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            crypto.randomUUID(), sub.playerId, round.id,
            sub.isCorrect ? 'submission_reward' : 'submission_penalty',
            posterDelta,
            sub.isCorrect ? 'Correct submission' : 'Wrong submission',
            now,
          ),
      )

      // Voter rewards/penalties
      const votes = await this.env.DB
        .prepare('SELECT voter_id, vote_type FROM votes WHERE submission_id = ?')
        .bind(sub.id).all<{ voter_id: string; vote_type: string }>()

      for (const vote of votes.results) {
        let voterDelta = 0
        let txType = ''
        let txNote = ''

        if (sub.isCorrect) {
          if (vote.vote_type === 'up') {
            voterDelta = room.config.voterReward
            txType = 'upvote_correct_reward'
            txNote = 'Upvoted a correct submission'
          } else {
            voterDelta = -room.config.voterReward
            txType = 'downvote_correct_penalty'
            txNote = 'Downvoted a correct submission'
            // Loser pays poster
            playerDeltas.set(sub.playerId, (playerDeltas.get(sub.playerId) ?? 0) + room.config.voterReward)
          }
        } else {
          if (vote.vote_type === 'down') {
            voterDelta = room.config.voterReward
            txType = 'downvote_wrong_reward'
            txNote = 'Downvoted a wrong submission'
          } else {
            voterDelta = -room.config.voterReward
            txType = 'upvote_wrong_penalty'
            txNote = 'Upvoted a wrong submission'
          }
        }

        playerDeltas.set(vote.voter_id, (playerDeltas.get(vote.voter_id) ?? 0) + voterDelta)

        txStmts.push(
          this.env.DB
            .prepare(`INSERT INTO wallet_transactions (id, player_id, round_id, type, delta, note, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), vote.voter_id, round.id, txType, voterDelta, txNote, now),
        )
      }
    }

    // Apply wallet deltas & score updates
    for (const [pid, delta] of playerDeltas) {
      txStmts.push(
        this.env.DB
          .prepare('UPDATE players SET wallet = wallet + ? WHERE id = ?')
          .bind(delta, pid),
      )
    }

    // Add base scores to total_score
    for (const sub of evaluated) {
      txStmts.push(
        this.env.DB
          .prepare('UPDATE players SET total_score = total_score + ? WHERE id = ?')
          .bind(sub.baseScore, sub.playerId),
      )
    }

    // Move phase to results
    txStmts.push(
      this.env.DB
        .prepare('UPDATE rounds SET phase = ?, phase_ends_at = NULL WHERE id = ?')
        .bind('results', round.id),
    )

    await this.env.DB.batch(txStmts)

    // Build broadcast payload
    const playerRows = await getPlayersByRoom(this.env.DB, roomId)
    const playerMap = new Map(playerRows.map((p) => [p.id, p]))

    const anonymousVoting = room.config.anonymousVoting
    const results: RoundResult[] = evaluated.map((sub, idx) => ({
      submissionId: sub.id,
      playerId:     sub.playerId,
      label:        anonymousVoting
        ? String.fromCharCode(65 + idx)
        : (playerMap.get(sub.playerId)?.username ?? sub.playerId),
      features:     sub.features,
      r2Score:      sub.r2,
      baseScore:    sub.baseScore,
      isCorrect:    sub.isCorrect,
    }))

    const deltas: WalletDelta[] = []
    for (const [pid, delta] of playerDeltas) {
      const p = playerMap.get(pid)
      if (p) {
        deltas.push({
          playerId:   pid,
          username:   p.username,
          delta,
          type:       'round_settlement',
          note:       delta >= 0 ? `+${delta} coins` : `${delta} coins`,
          // playerRows is fetched AFTER the batch so p.wallet is already updated —
          // do NOT add delta again here
          newBalance: p.wallet,
        })
      }
    }

    // Include the full updated player list so clients update wallets immediately
    this.broadcast({ type: 'ROUND_RESULTS', results, deltas, players: playerRows })

    // Check if game should auto-end
    const room2 = await getRoomById(this.env.DB, roomId)
    if (room2?.config.maxRounds) {
      const completedCount = await this.env.DB
        .prepare('SELECT COUNT(*) as cnt FROM rounds WHERE room_id = ? AND ended_at IS NOT NULL')
        .bind(roomId).first<{ cnt: number }>()
      // +1 because current round isn't ended yet
      if ((completedCount?.cnt ?? 0) + 1 >= room2.config.maxRounds) {
        await this.handleEndGame(roomId)
      }
    }
  }

  private async closeRound(roomId: string, round: { id: string }) {
    await this.env.DB
      .prepare('UPDATE rounds SET ended_at = ? WHERE id = ?')
      .bind(Date.now(), round.id).run()
    // Signal clients that the room is back in lobby
    this.broadcast({ type: 'PHASE_CHANGED', phase: 'lobby', endsAt: null })
  }

  // ─── Leaderboard builder ──────────────────────────────────────────────────

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

  // ─── Broadcast helper ─────────────────────────────────────────────────────

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

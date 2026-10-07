import type {
  Env, ServerMessage, GameState, TeamInfo, BatchInfo, BatchSummary,
  BatchId, LeaderboardEntry, VoteType, Verdict,
} from '../types'
import { PUZZLE_MAP, PUZZLES_BY_BATCH, getPuzzleInfo, getPuzzleForPlayers, BATCH_NAMES } from '../game/puzzles'
import { IMAGE_PUZZLE_MAP, IMAGE_PUZZLES_BY_BATCH, getImagePuzzleInfo, ALL_TRANSFORM_NAMES } from '../game/imagePuzzles'
import { compileFormula, judge, isDuplicatePrediction } from '../game/formula'
import {
  getConfig, getAllTeams, getTeamById, getAllBatches, getBatchById,
  getSubmissionsForPuzzle, getSubmissionsForBatch, buildPublicSubmission,
  getTeamVotesUsed, getVoteCountForSubmission, getHintsBought,
  getTeamSubmissionMap, rowToBatchInfo,
} from '../db/d1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export class GameRoomDO implements DurableObject {
  /** teamId → Set<WebSocket> — multiple laptops per team */
  private connections = new Map<string, Set<WebSocket>>()
  private ctx:   DurableObjectState
  private env:   Env
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

  // ─── Main dispatcher ──────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    const action = url.pathname.replace(/^\/+/, '')
    let body: Row = {}
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try { body = await request.json() } catch { /* empty body */ }
    }

    switch (action) {
      case 'submit':              return this.serialized(() => this.handleSubmit(body))
      case 'vote':                return this.serialized(() => this.handleVote(body))
      case 'hint':                return this.serialized(() => this.handleHint(body))
      case 'team-joined':         return this.serialized(() => this.handleTeamJoined(body))
      case 'admin/open-batch':    return this.serialized(() => this.handleOpenBatch(body))
      case 'admin/update-batch':  return this.serialized(() => this.handleUpdateBatch(body))
      case 'admin/settle-batch':  return this.serialized(() => this.handleSettleBatch(body))
      case 'admin/reopen-batch':  return this.serialized(() => this.handleReopenBatch(body))
      case 'admin/end-game':      return this.serialized(() => this.handleEndGame())
      case 'admin/reset':         return this.serialized(() => this.handleReset())
      case 'admin/config':        return this.serialized(() => this.handleUpdateConfig(body))
      case 'admin/remove-team':   return this.serialized(() => this.handleRemoveTeam(body))
      default:                    return new Response('Not found', { status: 404 })
    }
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  private handleWebSocket(request: Request): Response {
    const teamId = request.headers.get('X-Team-Id') ?? ''
    if (!teamId) return new Response('Missing X-Team-Id', { status: 400 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()

    if (!this.connections.has(teamId)) this.connections.set(teamId, new Set())
    const sockets = this.connections.get(teamId)!
    const wasOnline = sockets.size > 0
    sockets.add(server)

    server.addEventListener('message', (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data as string)
        if (msg.type === 'PING') server.send(JSON.stringify({ type: 'PONG' }))
      } catch { /* ignore */ }
    })

    server.addEventListener('close', () => {
      sockets.delete(server)
      if (sockets.size === 0) {
        this.connections.delete(teamId)
        this.ctx.waitUntil(this.onTeamOffline(teamId))
      }
    })

    server.addEventListener('error', () => {
      sockets.delete(server)
      if (sockets.size === 0) this.connections.delete(teamId)
    })

    this.ctx.waitUntil(this.initConnection(server, teamId, wasOnline))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async initConnection(server: WebSocket, teamId: string, wasOnline: boolean) {
    try {
      if (!wasOnline) {
        await this.env.DB.prepare('UPDATE teams SET is_connected = 1 WHERE id = ?').bind(teamId).run()
      }
      const state = await this.buildGameState(teamId)
      server.send(JSON.stringify({ type: 'FULL_STATE', state } satisfies ServerMessage))
      if (!wasOnline) {
        const team = state.teams.find((t) => t.id === teamId)
        if (team) this.broadcastExcept({ type: 'TEAM_UPDATED', team }, new Set([teamId]))
      }
    } catch (e) {
      console.error('[DO] initConnection error:', e)
    }
  }

  private async onTeamOffline(teamId: string) {
    try {
      await this.env.DB.prepare('UPDATE teams SET is_connected = 0 WHERE id = ?').bind(teamId).run()
      const team = await getTeamById(this.env.DB, teamId)
      if (team) this.broadcast({ type: 'TEAM_UPDATED', team })
    } catch (e) {
      console.error('[DO] onTeamOffline error:', e)
    }
  }

  // ─── State builder ────────────────────────────────────────────────────────

  private async buildGameState(teamId?: string): Promise<GameState> {
    const [config, teams] = await Promise.all([
      getConfig(this.env.DB),
      getAllTeams(this.env.DB),
    ])

    const batchRows = await this.env.DB.prepare('SELECT * FROM batches ORDER BY rowid ASC').all<Row>()
    const batches: BatchInfo[] = batchRows.results.map((r) => {
      const numPuzzles = (PUZZLES_BY_BATCH[r.id as BatchId] ?? []).map(getPuzzleInfo)
      const imgPuzzles = (IMAGE_PUZZLES_BY_BATCH[r.id as BatchId] ?? []).map(getImagePuzzleInfo)
      return rowToBatchInfo(r, [...numPuzzles, ...imgPuzzles])
    })

    let myVotesUsed = 0
    let mySubmissions: Record<string, Verdict | null> = {}

    if (teamId) {
      const [votes, subs] = await Promise.all([
        getTeamVotesUsed(this.env.DB, teamId),
        getTeamSubmissionMap(this.env.DB, teamId),
      ])
      myVotesUsed   = votes
      mySubmissions = subs as Record<string, Verdict | null>
    }

    return { config, teams, batches, myTeamId: teamId ?? null, myVotesUsed, mySubmissions }
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  private async handleSubmit(body: Row): Promise<Response> {
    const { teamId, puzzleId, expr } = body as { teamId: string; puzzleId: string; expr: string }
    if (!teamId || !puzzleId || !expr) return jsonRes({ error: 'Missing fields' }, 400)

    // Route to image puzzle handler if applicable
    const imagePuzzle = IMAGE_PUZZLE_MAP.get(puzzleId)
    if (imagePuzzle) return this.handleImageSubmit(teamId, puzzleId, expr, imagePuzzle)

    const puzzle = PUZZLE_MAP.get(puzzleId)
    if (!puzzle) return jsonRes({ error: 'Unknown puzzle' }, 404)

    const batch = await getBatchById(this.env.DB, puzzle.batchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'This batch is not open' }, 400)
    if (!batch.submissions_open) return jsonRes({ error: 'Submissions are closed for this batch' }, 400)

    const already = await this.env.DB
      .prepare('SELECT id FROM submissions WHERE puzzle_id = ? AND team_id = ?')
      .bind(puzzleId, teamId).first()
    if (already) return jsonRes({ error: 'Your team already posted a formula for this puzzle' }, 409)

    let prediction: number[]
    try {
      ({ prediction } = compileFormula(expr.trim(), puzzle.X))
    } catch (e) {
      return jsonRes({ error: (e as Error).message }, 400)
    }

    const [config, team] = await Promise.all([
      getConfig(this.env.DB),
      getTeamById(this.env.DB, teamId),
    ])
    if (!team) return jsonRes({ error: 'Team not found' }, 404)
    if (team.wallet < config.postStake) {
      return jsonRes({ error: `Posting costs ${config.postStake} coins — you have ${team.wallet}` }, 403)
    }

    // Duplicate prediction check
    const existing = await getSubmissionsForPuzzle(this.env.DB, puzzleId)
    for (const sub of existing) {
      let other: number[]
      try { ({ prediction: other } = compileFormula(sub.expr, puzzle.X)) } catch { continue }
      if (isDuplicatePrediction(prediction, other, puzzle.y)) {
        return jsonRes({
          error: `${sub.team_name} already claimed an equivalent formula. Back it with an upvote instead.`,
          duplicateOf: sub.id,
        }, 409)
      }
    }

    const subId = crypto.randomUUID()
    const now   = Date.now()
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO submissions (id, puzzle_id, batch_id, team_id, expr, stake, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(subId, puzzleId, puzzle.batchId, teamId, expr.trim(), config.postStake, now),
      this.env.DB.prepare('UPDATE teams SET wallet = wallet - ? WHERE id = ?')
        .bind(config.postStake, teamId),
      this.env.DB.prepare(
        'INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), teamId, puzzle.batchId, puzzleId, 'post_stake', -config.postStake, 'Posted a formula', now),
    ])

    const [updatedTeam, allSubs] = await Promise.all([
      getTeamById(this.env.DB, teamId),
      getSubmissionsForPuzzle(this.env.DB, puzzleId),
    ])
    const publicSub = buildPublicSubmission(
      allSubs.find((s) => s.id === subId)!, config.anonymousVoting, allSubs.length - 1, false,
    )

    this.broadcast({ type: 'SUBMISSION_MADE', puzzleId, submission: publicSub })
    if (updatedTeam) this.broadcast({ type: 'TEAM_UPDATED', team: updatedTeam })

    return jsonRes({ ok: true, submissionId: subId })
  }

  // ─── Image puzzle submit ───────────────────────────────────────────────────

  private async handleImageSubmit(
    teamId: string, puzzleId: string, expr: string,
    puzzle: import('../game/imagePuzzles').ImagePuzzleDef,
  ): Promise<Response> {
    const batch = await getBatchById(this.env.DB, puzzle.batchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'This batch is not open' }, 400)
    if (!batch.submissions_open) return jsonRes({ error: 'Submissions are closed for this batch' }, 400)

    const already = await this.env.DB
      .prepare('SELECT id FROM submissions WHERE puzzle_id = ? AND team_id = ?')
      .bind(puzzleId, teamId).first()
    if (already) return jsonRes({ error: 'Your team already submitted an answer for this puzzle' }, 409)

    // Parse and validate filter list
    let filters: string[]
    try { filters = JSON.parse(expr) } catch { return jsonRes({ error: 'Invalid filter list' }, 400) }
    if (!Array.isArray(filters) || filters.some((f) => !ALL_TRANSFORM_NAMES.includes(f as never))) {
      return jsonRes({ error: 'One or more filters are not valid' }, 400)
    }
    if (filters.length === 0) return jsonRes({ error: 'Select at least one filter' }, 400)
    if (filters.length > puzzle.maxFilters) {
      return jsonRes({ error: `Maximum ${puzzle.maxFilters} filter(s) allowed` }, 400)
    }

    const [config, team] = await Promise.all([
      getConfig(this.env.DB),
      getTeamById(this.env.DB, teamId),
    ])
    if (!team) return jsonRes({ error: 'Team not found' }, 404)
    if (team.wallet < config.postStake) {
      return jsonRes({ error: `Posting costs ${config.postStake} coins — you have ${team.wallet}` }, 403)
    }

    const subId = crypto.randomUUID()
    const now   = Date.now()
    const normalised = JSON.stringify(filters)   // store as canonical JSON

    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO submissions (id, puzzle_id, batch_id, team_id, expr, stake, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(subId, puzzleId, puzzle.batchId, teamId, normalised, config.postStake, now),
      this.env.DB.prepare('UPDATE teams SET wallet = wallet - ? WHERE id = ?').bind(config.postStake, teamId),
      this.env.DB.prepare(
        'INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), teamId, puzzle.batchId, puzzleId, 'post_stake', -config.postStake, 'Submitted image puzzle answer', now),
    ])

    const [updatedTeam, allSubs] = await Promise.all([
      getTeamById(this.env.DB, teamId),
      getSubmissionsForPuzzle(this.env.DB, puzzleId),
    ])
    const publicSub = buildPublicSubmission(
      allSubs.find((s) => s.id === subId)!, config.anonymousVoting, allSubs.length - 1, false,
    )

    this.broadcast({ type: 'SUBMISSION_MADE', puzzleId, submission: publicSub })
    if (updatedTeam) this.broadcast({ type: 'TEAM_UPDATED', team: updatedTeam })

    return jsonRes({ ok: true, submissionId: subId })
  }

  // ─── Vote ─────────────────────────────────────────────────────────────────

  private async handleVote(body: Row): Promise<Response> {
    const { teamId, submissionId, voteType } = body as { teamId: string; submissionId: string; voteType: VoteType }
    if (!teamId || !submissionId || !voteType) return jsonRes({ error: 'Missing fields' }, 400)
    if (voteType !== 'up' && voteType !== 'down') return jsonRes({ error: 'Invalid voteType' }, 400)

    const sub = await this.env.DB
      .prepare('SELECT team_id, puzzle_id, batch_id FROM submissions WHERE id = ?')
      .bind(submissionId).first<{ team_id: string; puzzle_id: string; batch_id: string }>()
    if (!sub) return jsonRes({ error: 'Submission not found' }, 404)
    if (sub.team_id === teamId) return jsonRes({ error: 'You cannot vote on your own team\'s formula' }, 403)

    const batch = await getBatchById(this.env.DB, sub.batch_id as BatchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'This batch is not open' }, 400)
    if (!batch.voting_open) return jsonRes({ error: 'Voting is closed for this batch' }, 400)

    const [config, team] = await Promise.all([
      getConfig(this.env.DB),
      getTeamById(this.env.DB, teamId),
    ])
    if (!team) return jsonRes({ error: 'Team not found' }, 404)

    const votesUsed = await getTeamVotesUsed(this.env.DB, teamId)
    if (votesUsed >= config.voteBudget) {
      return jsonRes({ error: `You have used all ${config.voteBudget} votes` }, 403)
    }

    const dupVote = await this.env.DB
      .prepare('SELECT 1 FROM votes WHERE voter_team_id = ? AND submission_id = ?')
      .bind(teamId, submissionId).first()
    if (dupVote) return jsonRes({ error: 'You already voted on this formula' }, 409)

    if (team.wallet < config.voteStake) {
      return jsonRes({ error: `Voting costs ${config.voteStake} coins — you have ${team.wallet}` }, 403)
    }

    const now = Date.now()
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO votes (id, puzzle_id, batch_id, submission_id, voter_team_id, vote_type, stake, voted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), sub.puzzle_id, sub.batch_id, submissionId, teamId, voteType, config.voteStake, now),
      this.env.DB.prepare('UPDATE teams SET wallet = wallet - ? WHERE id = ?')
        .bind(config.voteStake, teamId),
      this.env.DB.prepare(
        'INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), teamId, sub.batch_id, sub.puzzle_id, 'vote_stake', -config.voteStake,
        voteType === 'up' ? 'Upvoted a formula' : 'Downvoted a formula', now),
    ])

    const [counts, updatedTeam] = await Promise.all([
      getVoteCountForSubmission(this.env.DB, submissionId),
      getTeamById(this.env.DB, teamId),
    ])

    this.broadcast({ type: 'VOTE_CAST', puzzleId: sub.puzzle_id, submissionId, ...counts })
    if (updatedTeam) this.broadcast({ type: 'TEAM_UPDATED', team: updatedTeam })

    return jsonRes({ ok: true, votesRemaining: config.voteBudget - votesUsed - 1 })
  }

  // ─── Hint ─────────────────────────────────────────────────────────────────

  private async handleHint(body: Row): Promise<Response> {
    const { teamId, puzzleId } = body as { teamId: string; puzzleId: string }
    if (!teamId || !puzzleId) return jsonRes({ error: 'Missing fields' }, 400)

    const puzzle = PUZZLE_MAP.get(puzzleId)
    if (!puzzle) return jsonRes({ error: 'Unknown puzzle' }, 404)

    const batch = await getBatchById(this.env.DB, puzzle.batchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'Hints only available while a batch is open' }, 400)

    const [config, team, bought] = await Promise.all([
      getConfig(this.env.DB),
      getTeamById(this.env.DB, teamId),
      getHintsBought(this.env.DB, puzzleId, teamId),
    ])
    if (!team) return jsonRes({ error: 'Team not found' }, 404)
    if (bought >= puzzle.hints.length) return jsonRes({ error: 'You already have every hint' }, 409)
    if (team.wallet < config.hintCost) {
      return jsonRes({ error: `A hint costs ${config.hintCost} coins — you have ${team.wallet}` }, 403)
    }

    const now = Date.now()
    await this.env.DB.batch([
      this.env.DB.prepare('UPDATE teams SET wallet = wallet - ? WHERE id = ?').bind(config.hintCost, teamId),
      this.env.DB.prepare(
        'INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), teamId, puzzle.batchId, puzzleId, 'hint', -config.hintCost,
        `Bought hint ${bought + 1}`, now),
    ])

    const updatedTeam = await getTeamById(this.env.DB, teamId)
    if (updatedTeam) this.broadcast({ type: 'TEAM_UPDATED', team: updatedTeam })

    return jsonRes({ ok: true, hints: puzzle.hints.slice(0, bought + 1) })
  }

  // ─── Team joined (called by auth.ts after registration) ───────────────────

  private async handleTeamJoined(body: Row): Promise<Response> {
    const team = await getTeamById(this.env.DB, body.teamId)
    if (team) this.broadcast({ type: 'TEAM_JOINED', team })
    return jsonRes({ ok: true })
  }

  // ─── Admin: open batch ────────────────────────────────────────────────────

  private async handleOpenBatch(body: Row): Promise<Response> {
    const batchId = body.batchId as BatchId
    const batch = await getBatchById(this.env.DB, batchId)
    if (!batch) return jsonRes({ error: 'Unknown batch' }, 404)
    if (batch.status !== 'hidden') return jsonRes({ error: 'Batch is already open or settled' }, 409)

    const now = Date.now()
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE batches SET status='open', submissions_open=1, voting_open=1, opened_at=? WHERE id=?",
      ).bind(now, batchId),
      this.env.DB.prepare("UPDATE game_config SET status='active' WHERE id=1 AND status='lobby'"),
    ])

    const updated = await getBatchById(this.env.DB, batchId)
    if (updated) {
      const numPs = (PUZZLES_BY_BATCH[batchId] ?? []).map(getPuzzleInfo)
      const imgPs = (IMAGE_PUZZLES_BY_BATCH[batchId] ?? []).map(getImagePuzzleInfo)
      const bi = rowToBatchInfo(updated, [...numPs, ...imgPs])
      this.broadcast({ type: 'BATCH_UPDATED', batch: bi })
    }
    return jsonRes({ ok: true })
  }

  // ─── Admin: update batch toggles ──────────────────────────────────────────

  private async handleUpdateBatch(body: Row): Promise<Response> {
    const batchId = body.batchId as BatchId
    const batch = await getBatchById(this.env.DB, batchId)
    if (!batch) return jsonRes({ error: 'Unknown batch' }, 404)
    if (batch.status !== 'open') return jsonRes({ error: 'Batch must be open to update' }, 409)

    const sets: string[] = []
    const vals: unknown[] = []
    if (body.submissionsOpen !== undefined) { sets.push('submissions_open = ?'); vals.push(body.submissionsOpen ? 1 : 0) }
    if (body.votingOpen      !== undefined) { sets.push('voting_open = ?');      vals.push(body.votingOpen      ? 1 : 0) }
    if (sets.length === 0) return jsonRes({ error: 'Nothing to update' }, 400)

    vals.push(batchId)
    await this.env.DB.prepare(`UPDATE batches SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()

    const updated = await getBatchById(this.env.DB, batchId)
    if (updated) {
      const numPs = (PUZZLES_BY_BATCH[batchId] ?? []).map(getPuzzleInfo)
      const imgPs = (IMAGE_PUZZLES_BY_BATCH[batchId] ?? []).map(getImagePuzzleInfo)
      const bi = rowToBatchInfo(updated, [...numPs, ...imgPs])
      this.broadcast({ type: 'BATCH_UPDATED', batch: bi })
    }
    return jsonRes({ ok: true })
  }

  // ─── Admin: settle batch ──────────────────────────────────────────────────

  private async handleSettleBatch(body: Row): Promise<Response> {
    const batchId = body.batchId as BatchId
    const batch = await getBatchById(this.env.DB, batchId)
    if (!batch) return jsonRes({ error: 'Unknown batch' }, 404)
    if (batch.status !== 'open') return jsonRes({ error: 'Batch is not open' }, 409)

    const config = await getConfig(this.env.DB)
    const { Ps: _Ps, Pp, Vs: _Vs, Bp } = {
      Ps: config.postStake, Pp: config.postPayout,
      Vs: config.voteStake, Bp: config.backPayout,
    }
    const Ps = config.postStake, Vs = config.voteStake

    const submissionRows = await getSubmissionsForBatch(this.env.DB, batchId)
    const voteRows = await this.env.DB
      .prepare('SELECT submission_id, voter_team_id, vote_type, stake FROM votes WHERE batch_id = ?')
      .bind(batchId).all<{ submission_id: string; voter_team_id: string; vote_type: string; stake: number }>()

    const stmts: import('@cloudflare/workers-types').D1PreparedStatement[] = []
    const walletDeltas = new Map<string, number>()
    const addDelta = (teamId: string, delta: number) =>
      walletDeltas.set(teamId, (walletDeltas.get(teamId) ?? 0) + delta)
    const now = Date.now()

    const pay = (teamId: string, delta: number, type: string, note: string, puzzleId: string) => {
      if (delta === 0) return
      addDelta(teamId, delta)
      stmts.push(
        this.env.DB.prepare(
          'INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), teamId, batchId, puzzleId, type, delta, note, now),
      )
    }

    const results: BatchSummary['results'] = {}

    const puzzleIds = [...new Set(submissionRows.map((s) => s.puzzle_id))]
    for (const puzzleId of puzzleIds) {
      const puzzle      = PUZZLE_MAP.get(puzzleId)
      const imagePuzzle = IMAGE_PUZZLE_MAP.get(puzzleId)
      if (!puzzle && !imagePuzzle) continue
      const puzzleSubs = submissionRows.filter((s) => s.puzzle_id === puzzleId)
      results[puzzleId] = []

      for (const row of puzzleSubs) {
        // Judge: numerical formula or image filter list?
        let verdict: Verdict, r2: number, accuracy: number
        if (imagePuzzle) {
          let submitted: string[]
          try { submitted = JSON.parse(row.expr) } catch { submitted = [] }
          const correct = imagePuzzle.correctPipeline
          const isRight = imagePuzzle.isCommutative
            ? JSON.stringify([...submitted].sort()) === JSON.stringify([...correct].sort())
            : JSON.stringify(submitted) === JSON.stringify(correct)
          verdict  = isRight ? 'right' : 'wrong'
          r2       = isRight ? 1 : 0
          accuracy = isRight ? 1 : 0
        } else {
          ;({ verdict, r2, accuracy } = judge(row.expr, puzzle!.X, puzzle!.y, puzzle!.solution))
        }
        const votes = voteRows.results.filter((v) => v.submission_id === row.id)
        const backers  = votes.filter((v) => v.vote_type === 'up')
        const doubters = votes.filter((v) => v.vote_type === 'down')

        stmts.push(
          this.env.DB.prepare('UPDATE submissions SET r2_score = ?, verdict = ? WHERE id = ?')
            .bind(r2, verdict, row.id),
        )

        if (verdict === 'right') {
          pay(row.team_id, Ps + Pp, 'post_win', 'Formula correct: stake back + payout', puzzleId)
          pay(row.team_id, Vs * doubters.length, 'post_doubter_income', 'Collected stakes from doubters', puzzleId)
          stmts.push(
            this.env.DB.prepare('UPDATE teams SET total_score = total_score + 1 WHERE id = ?').bind(row.team_id),
          )
          for (const v of backers) pay(v.voter_team_id, Vs + Bp, 'back_win', 'Backed a correct formula', puzzleId)
        } else if (verdict === 'close') {
          pay(row.team_id, Ps + Math.round(Pp / 2), 'post_close', 'Right shape, wrong numbers: stake back + half payout', puzzleId)
          for (const v of backers) pay(v.voter_team_id, Vs + Math.round(Bp / 2), 'back_close', 'Backed a close formula', puzzleId)
          for (const v of doubters) pay(v.voter_team_id, Vs, 'doubt_refund', 'Doubted a close formula: stake refunded', puzzleId)
        } else {
          pay(row.team_id, -(Vs * doubters.length), 'post_doubter_payout', 'Paid doubters for wrong formula', puzzleId)
          for (const v of doubters) pay(v.voter_team_id, 2 * Vs, 'doubt_win', 'Called out a wrong formula', puzzleId)
        }

        results[puzzleId].push({
          submissionId: row.id,
          teamId:       row.team_id,
          label:        row.team_name,
          expr:         row.expr,
          accuracy,
          verdict,
          ups:          row.ups ?? 0,
          downs:        row.downs ?? 0,
        })
      }
    }

    // Apply wallet deltas
    for (const [teamId, delta] of walletDeltas) {
      stmts.push(
        this.env.DB.prepare('UPDATE teams SET wallet = wallet + ? WHERE id = ?').bind(delta, teamId),
      )
    }

    stmts.push(
      this.env.DB.prepare("UPDATE batches SET status='settled', submissions_open=0, voting_open=0, settled_at=? WHERE id=?")
        .bind(now, batchId),
    )

    // Run all in one batch
    for (let i = 0; i < stmts.length; i += 80) {
      await this.env.DB.batch(stmts.slice(i, i + 80))
    }

    const [teams, solutions] = await Promise.all([
      getAllTeams(this.env.DB),
      Promise.resolve(Object.fromEntries(puzzleIds.map((id) => [id, PUZZLE_MAP.get(id)?.solution ?? '']))),
    ])

    // wallet deltas for summary
    const teamMap = new Map(teams.map((t) => [t.id, t]))
    const deltas = [...walletDeltas.entries()]
      .filter(([, d]) => d !== 0)
      .map(([teamId, delta]) => ({
        teamId,
        teamName:   teamMap.get(teamId)?.name ?? teamId,
        delta,
        newBalance: teamMap.get(teamId)?.wallet ?? 0,
      }))

    const summary: BatchSummary = { batchId, results, deltas, solutions }
    this.broadcast({ type: 'BATCH_SETTLED', batchId, summary, teams })

    return jsonRes({ ok: true })
  }

  // ─── Admin: reopen batch (undo settlement) ────────────────────────────────

  private async handleReopenBatch(body: Row): Promise<Response> {
    const batchId = body.batchId as BatchId
    const batch = await getBatchById(this.env.DB, batchId)
    if (!batch) return jsonRes({ error: 'Unknown batch' }, 404)
    if (batch.status !== 'settled') return jsonRes({ error: 'Batch is not settled' }, 409)

    const SETTLEMENT_TYPES = ['post_win','post_close','post_doubter_income','back_win','back_close','doubt_refund','post_doubter_payout','doubt_win']
    const placeholders = SETTLEMENT_TYPES.map(() => '?').join(',')

    // Sum settlement deltas per team
    const deltaRows = await this.env.DB
      .prepare(`SELECT team_id, SUM(delta) as net FROM wallet_transactions WHERE batch_id = ? AND type IN (${placeholders}) GROUP BY team_id`)
      .bind(batchId, ...SETTLEMENT_TYPES).all<{ team_id: string; net: number }>()

    const stmts: import('@cloudflare/workers-types').D1PreparedStatement[] = []

    // Reverse wallet changes
    for (const { team_id, net } of deltaRows.results) {
      if (net !== 0) {
        stmts.push(
          this.env.DB.prepare('UPDATE teams SET wallet = wallet - ? WHERE id = ?').bind(net, team_id),
        )
      }
    }

    // Decrement total_score for right submissions in this batch
    const rightSubs = await this.env.DB
      .prepare("SELECT DISTINCT team_id FROM submissions WHERE batch_id = ? AND verdict = 'right'")
      .bind(batchId).all<{ team_id: string }>()
    for (const { team_id } of rightSubs.results) {
      stmts.push(
        this.env.DB.prepare('UPDATE teams SET total_score = MAX(0, total_score - 1) WHERE id = ?').bind(team_id),
      )
    }

    // Delete settlement transactions
    stmts.push(
      this.env.DB.prepare(`DELETE FROM wallet_transactions WHERE batch_id = ? AND type IN (${placeholders})`)
        .bind(batchId, ...SETTLEMENT_TYPES),
    )

    // Clear verdict on submissions
    stmts.push(
      this.env.DB.prepare('UPDATE submissions SET r2_score = NULL, verdict = NULL WHERE batch_id = ?').bind(batchId),
    )

    // Reopen the batch
    stmts.push(
      this.env.DB.prepare("UPDATE batches SET status='open', submissions_open=1, voting_open=1, settled_at=NULL WHERE id=?")
        .bind(batchId),
    )

    for (let i = 0; i < stmts.length; i += 80) {
      await this.env.DB.batch(stmts.slice(i, i + 80))
    }

    const teams = await getAllTeams(this.env.DB)
    this.broadcast({ type: 'BATCH_REOPENED', batchId, teams })

    return jsonRes({ ok: true })
  }

  // ─── Admin: end game ──────────────────────────────────────────────────────

  private async handleEndGame(): Promise<Response> {
    // Settle any open batches first
    const openBatches = await this.env.DB
      .prepare("SELECT id FROM batches WHERE status = 'open'")
      .all<{ id: string }>()
    for (const { id } of openBatches.results) {
      await this.handleSettleBatch({ batchId: id })
    }

    await this.env.DB.prepare("UPDATE game_config SET status = 'finished' WHERE id = 1").run()

    const rows = await this.env.DB
      .prepare('SELECT id, name, wallet, total_score FROM teams ORDER BY wallet DESC, total_score DESC')
      .all<{ id: string; name: string; wallet: number; total_score: number }>()

    const leaderboard: LeaderboardEntry[] = rows.results.map((r, i) => ({
      rank:       i + 1,
      teamId:     r.id,
      teamName:   r.name,
      wallet:     r.wallet,
      totalScore: r.total_score,
    }))

    this.broadcast({ type: 'GAME_ENDED', leaderboard })
    return jsonRes({ ok: true })
  }

  // ─── Admin: reset game ────────────────────────────────────────────────────

  private async handleReset(): Promise<Response> {
    await this.env.DB.batch([
      this.env.DB.prepare('DELETE FROM wallet_transactions'),
      this.env.DB.prepare('DELETE FROM votes'),
      this.env.DB.prepare('DELETE FROM submissions'),
      this.env.DB.prepare('DELETE FROM team_members'),
      this.env.DB.prepare('DELETE FROM teams'),
      this.env.DB.prepare("UPDATE batches SET status='hidden', submissions_open=1, voting_open=1, opened_at=NULL, settled_at=NULL"),
      this.env.DB.prepare("UPDATE game_config SET status='lobby' WHERE id=1"),
    ])

    this.broadcast({ type: 'GAME_RESET' })
    for (const sockets of this.connections.values()) {
      for (const ws of sockets) {
        try { ws.close(4000, 'Game reset') } catch { /* already closed */ }
      }
    }
    this.connections.clear()
    return jsonRes({ ok: true })
  }

  // ─── Admin: update config ─────────────────────────────────────────────────

  private async handleUpdateConfig(body: Row): Promise<Response> {
    const allowed = ['starting_wallet','post_stake','post_payout','vote_stake','back_payout','hint_cost','vote_budget','anonymous_voting']
    const sets: string[] = []
    const vals: unknown[] = []

    for (const key of allowed) {
      if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(body[key]) }
    }
    if (sets.length === 0) return jsonRes({ error: 'Nothing to update' }, 400)

    const cfg = await getConfig(this.env.DB)
    const postPayout = Number(body.post_payout ?? cfg.postPayout)
    const backPayout = Number(body.back_payout ?? cfg.backPayout)
    if (!(backPayout > postPayout)) {
      return jsonRes({ error: 'back_payout must be greater than post_payout' }, 400)
    }

    vals.push(1)
    await this.env.DB.prepare(`UPDATE game_config SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
    return jsonRes({ ok: true })
  }

  // ─── Admin: remove team ───────────────────────────────────────────────────

  private async handleRemoveTeam(body: Row): Promise<Response> {
    const { teamId } = body as { teamId: string }
    // CASCADE deletes members, submissions, votes, transactions
    await this.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(teamId).run()

    // Kick their sockets
    const sockets = this.connections.get(teamId)
    if (sockets) {
      for (const ws of sockets) {
        try { ws.close(4001, 'Team removed') } catch { /* already closed */ }
      }
      this.connections.delete(teamId)
    }

    const teams = await getAllTeams(this.env.DB)
    // Broadcast updated team list via FULL_STATE to each connected team
    for (const [tid, socketSet] of this.connections) {
      const state = await this.buildGameState(tid)
      const msg = JSON.stringify({ type: 'FULL_STATE', state } satisfies ServerMessage)
      for (const ws of socketSet) {
        try { ws.send(msg) } catch { /* ignore */ }
      }
    }

    return jsonRes({ ok: true })
  }

  // ─── Broadcast helpers ────────────────────────────────────────────────────

  private broadcast(message: ServerMessage) {
    const data = JSON.stringify(message)
    for (const sockets of this.connections.values()) {
      for (const ws of sockets) {
        try { ws.send(data) } catch { /* closed */ }
      }
    }
  }

  private broadcastExcept(message: ServerMessage, excludeTeamIds: Set<string>) {
    const data = JSON.stringify(message)
    for (const [teamId, sockets] of this.connections) {
      if (excludeTeamIds.has(teamId)) continue
      for (const ws of sockets) {
        try { ws.send(data) } catch { /* closed */ }
      }
    }
  }
}

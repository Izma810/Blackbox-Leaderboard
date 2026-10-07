import type {
  Env, ServerMessage, GameState, GameConfig, TeamInfo, BatchInfo, BatchSummary,
  BatchId, LeaderboardEntry, VoteType, Verdict,
} from '../types'
import { PUZZLE_MAP, PUZZLES_BY_BATCH, getPuzzleInfo } from '../game/puzzles'
import { IMAGE_PUZZLE_MAP, IMAGE_PUZZLES_BY_BATCH, getImagePuzzleInfo, ALL_TRANSFORM_NAMES } from '../game/imagePuzzles'
import type { ImagePuzzleDef } from '../game/imagePuzzles'
import { answerKey, isCorrectImageAnswer } from '../game/imageEquivalence'
import { compileFormula, judge, isDuplicatePrediction } from '../game/formula'
import {
  getConfig, getAllTeams, getTeamById, getBatchById, getSubmissionsForBatch,
  buildPublicSubmission, rowToBatchInfo, type SubmissionRow,
} from '../db/d1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function batchInfo(r: Row): BatchInfo {
  const numPuzzles = (PUZZLES_BY_BATCH[r.id as BatchId] ?? []).map(getPuzzleInfo)
  const imgPuzzles = (IMAGE_PUZZLES_BY_BATCH[r.id as BatchId] ?? []).map(getImagePuzzleInfo)
  return rowToBatchInfo(r, [...numPuzzles, ...imgPuzzles])
}

/** A team's in-flight submits/votes/hints beyond this are refused, so one team can't flood the queue. */
const MAX_QUEUED_PER_TEAM = 5

const SETTLEMENT_TYPES = `'post_win','post_close','post_doubter_income','back_win','back_close','doubt_refund','post_doubter_payout','doubt_win'`

/**
 * Everything player actions need to check, kept in memory so a submit or vote
 * only touches D1 to write. This object is the only writer of game state
 * (auth.ts only inserts teams, and tells us), so the copy stays correct as
 * long as every write here also updates it. Admin actions and any failed
 * write just drop it, and it's reloaded from D1 on next use.
 */
interface HotState {
  config:       GameConfig
  batches:      Map<BatchId, Row>
  teams:        Map<string, TeamInfo>                 // registration order
  subs:         Map<string, SubmissionRow>            // with live ups/downs
  subsByPuzzle: Map<string, SubmissionRow[]>          // submission order, which sets anonymous labels
  votes:        Map<string, VoteType>                 // `${voterTeamId}:${submissionId}`
  votesUsed:    Map<string, number>
  hints:        Map<string, number>                   // `${teamId}:${puzzleId}` → hints bought
  predictions:  Map<string, number[] | null>          // compiled lazily for the duplicate check
}

export class GameRoomDO implements DurableObject {
  /** teamId → Set<WebSocket> — multiple laptops per team */
  private connections = new Map<string, Set<WebSocket>>()
  private ctx:   DurableObjectState
  private env:   Env
  private queue: Promise<unknown> = Promise.resolve()
  private hot:   HotState | null = null
  private queuedByTeam = new Map<string, number>()

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }

  /** Runs one at a time. Every read or write of `hot` must happen in here. */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      try {
        return await fn()
      } catch (e) {
        this.hot = null   // a write may or may not have landed; reload from D1
        throw e
      }
    }
    const run = this.queue.then(guarded, guarded)
    this.queue = run.catch(() => {})
    return run
  }

  private forTeam(teamId: unknown, fn: () => Promise<Response>): Promise<Response> {
    if (typeof teamId !== 'string' || !teamId) return Promise.resolve(jsonRes({ error: 'Missing fields' }, 400))
    const queued = this.queuedByTeam.get(teamId) ?? 0
    if (queued >= MAX_QUEUED_PER_TEAM) {
      return Promise.resolve(jsonRes({ error: 'Your team has too many actions in progress. Wait a moment and try again.' }, 429))
    }
    this.queuedByTeam.set(teamId, queued + 1)
    return this.serialized(fn).finally(() => {
      const left = (this.queuedByTeam.get(teamId) ?? 1) - 1
      if (left > 0) this.queuedByTeam.set(teamId, left)
      else this.queuedByTeam.delete(teamId)
    })
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
      case 'submit':              return this.forTeam(body.teamId, () => this.handleSubmit(body))
      case 'vote':                return this.forTeam(body.teamId, () => this.handleVote(body))
      case 'hint':                return this.forTeam(body.teamId, () => this.handleHint(body))
      case 'team-joined':         return this.serialized(() => this.handleTeamJoined(body))
      case 'admin/open-batch':    return this.serialized(() => this.handleOpenBatch(body))
      case 'admin/update-batch':  return this.serialized(() => this.handleUpdateBatch(body))
      case 'admin/settle-batch':  return this.serialized(() => this.handleSettleBatch(body))
      case 'admin/reopen-batch':  return this.serialized(() => this.handleReopenBatch(body))
      case 'admin/end-game':      return this.serialized(() => this.handleEndGame())
      case 'admin/reset':         return this.serialized(() => this.handleReset())
      case 'admin/config':        return this.serialized(() => this.handleUpdateConfig(body))
      case 'admin/remove-team':   return this.serialized(() => this.handleRemoveTeam(body))
      case 'admin/reset-login':   return this.serialized(() => this.handleResetLogin(body))
      default:                    return new Response('Not found', { status: 404 })
    }
  }

  // ─── In-memory state ──────────────────────────────────────────────────────

  private async state(): Promise<HotState> {
    if (!this.hot) this.hot = await this.loadState()
    return this.hot
  }

  private async loadState(): Promise<HotState> {
    const db = this.env.DB
    const [config, batchRows, teams, subRows, voteRows, hintRows] = await Promise.all([
      getConfig(db),
      db.prepare('SELECT * FROM batches ORDER BY rowid ASC').all<Row>(),
      getAllTeams(db),
      db.prepare(`
        SELECT s.*, t.name AS team_name FROM submissions s
        JOIN teams t ON t.id = s.team_id
        ORDER BY s.submitted_at ASC
      `).all<SubmissionRow>(),
      db.prepare('SELECT submission_id, voter_team_id, vote_type FROM votes').all<Row>(),
      db.prepare(`SELECT team_id, puzzle_id, COUNT(*) AS n FROM wallet_transactions WHERE type = 'hint' GROUP BY team_id, puzzle_id`).all<Row>(),
    ])

    const hot: HotState = {
      config,
      batches:      new Map(batchRows.results.map((r) => [r.id as BatchId, r])),
      teams:        new Map(teams.map((t) => [t.id, { ...t, isConnected: this.connections.has(t.id) }])),
      subs:         new Map(),
      subsByPuzzle: new Map(),
      votes:        new Map(),
      votesUsed:    new Map(),
      hints:        new Map(hintRows.results.map((r) => [`${r.team_id}:${r.puzzle_id}`, r.n as number])),
      predictions:  new Map(),
    }
    for (const s of subRows.results) {
      const sub = { ...s, ups: 0, downs: 0 }
      hot.subs.set(sub.id, sub)
      if (!hot.subsByPuzzle.has(sub.puzzle_id)) hot.subsByPuzzle.set(sub.puzzle_id, [])
      hot.subsByPuzzle.get(sub.puzzle_id)!.push(sub)
    }
    for (const v of voteRows.results) {
      hot.votes.set(`${v.voter_team_id}:${v.submission_id}`, v.vote_type)
      hot.votesUsed.set(v.voter_team_id, (hot.votesUsed.get(v.voter_team_id) ?? 0) + 1)
      const sub = hot.subs.get(v.submission_id)
      if (sub) { if (v.vote_type === 'up') sub.ups!++; else sub.downs!++ }
    }
    return hot
  }

  /** Teams register outside this object, so one can show up before its team-joined notice. */
  private async ensureTeam(hot: HotState, teamId: string): Promise<TeamInfo | null> {
    const cached = hot.teams.get(teamId)
    if (cached) return cached
    const fresh = await getTeamById(this.env.DB, teamId)
    if (fresh) hot.teams.set(teamId, { ...fresh, isConnected: this.connections.has(teamId) })
    return hot.teams.get(teamId) ?? null
  }

  private predictionFor(hot: HotState, sub: SubmissionRow, X: Parameters<typeof compileFormula>[1]): number[] | null {
    if (!hot.predictions.has(sub.id)) {
      let p: number[] | null
      try { p = compileFormula(sub.expr, X).prediction } catch { p = null }
      hot.predictions.set(sub.id, p)
    }
    return hot.predictions.get(sub.id)!
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
    sockets.add(server)

    server.addEventListener('message', (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data as string)
        if (msg.type === 'PING') server.send(JSON.stringify({ type: 'PONG' }))
      } catch { /* ignore */ }
    })

    // A kicked team's set is detached from `connections` up front, and the team may
    // already have a fresh set by the time these fire, so only clean up our own.
    server.addEventListener('close', () => {
      sockets.delete(server)
      if (sockets.size === 0 && this.connections.get(teamId) === sockets) {
        this.connections.delete(teamId)
        this.ctx.waitUntil(this.serialized(() => this.markOffline(teamId)).catch((e) => console.error('[DO] markOffline error:', e)))
      }
    })

    server.addEventListener('error', () => {
      sockets.delete(server)
      if (sockets.size === 0 && this.connections.get(teamId) === sockets) this.connections.delete(teamId)
    })

    this.ctx.waitUntil(this.serialized(() => this.initConnection(server, teamId)).catch((e) => console.error('[DO] initConnection error:', e)))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async initConnection(server: WebSocket, teamId: string) {
    const hot  = await this.state()
    const team = await this.ensureTeam(hot, teamId)
    const cameOnline = !!team && !team.isConnected && this.connections.has(teamId)
    if (cameOnline) {
      await this.env.DB.prepare('UPDATE teams SET is_connected = 1 WHERE id = ?').bind(teamId).run()
      team.isConnected = true
    }
    const state = await this.buildGameState(teamId)
    server.send(JSON.stringify({ type: 'FULL_STATE', state } satisfies ServerMessage))
    if (cameOnline) this.broadcastExcept({ type: 'TEAM_UPDATED', team }, new Set([teamId]))
  }

  private async markOffline(teamId: string) {
    if (this.connections.has(teamId)) return   // another laptop is still (or again) connected
    await this.env.DB.prepare('UPDATE teams SET is_connected = 0 WHERE id = ?').bind(teamId).run()
    const team = (await this.state()).teams.get(teamId)
    if (team) {
      team.isConnected = false
      this.broadcast({ type: 'TEAM_UPDATED', team })
    }
  }

  // ─── State builder ────────────────────────────────────────────────────────

  private async buildGameState(teamId?: string): Promise<GameState> {
    const hot = await this.state()
    const mySubmissions: Record<string, Verdict | null> = {}
    if (teamId) {
      for (const s of hot.subs.values()) {
        if (s.team_id === teamId) mySubmissions[s.puzzle_id] = (s.verdict as Verdict | null) ?? null
      }
    }
    return {
      config:      hot.config,
      teams:       [...hot.teams.values()],
      batches:     [...hot.batches.values()].map(batchInfo),
      myTeamId:    teamId ?? null,
      myVotesUsed: teamId ? hot.votesUsed.get(teamId) ?? 0 : 0,
      mySubmissions,
    }
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

    const hot = await this.state()
    const batch = hot.batches.get(puzzle.batchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'This batch is not open' }, 400)
    if (!batch.submissions_open) return jsonRes({ error: 'Submissions are closed for this batch' }, 400)

    const existing = hot.subsByPuzzle.get(puzzleId) ?? []
    if (existing.some((s) => s.team_id === teamId)) {
      return jsonRes({ error: 'Your team already posted a formula for this puzzle' }, 409)
    }

    let prediction: number[]
    try {
      ({ prediction } = compileFormula(expr.trim(), puzzle.X))
    } catch (e) {
      return jsonRes({ error: (e as Error).message }, 400)
    }

    const team = await this.ensureTeam(hot, teamId)
    if (!team) return jsonRes({ error: 'Team not found' }, 404)
    if (team.wallet < hot.config.postStake) {
      return jsonRes({ error: `Posting costs ${hot.config.postStake} coins — you have ${team.wallet}` }, 403)
    }

    // Duplicate prediction check
    for (const sub of existing) {
      const other = this.predictionFor(hot, sub, puzzle.X)
      if (other && isDuplicatePrediction(prediction, other, puzzle.y)) {
        return jsonRes({
          error: `${sub.team_name} already claimed an equivalent formula. Back it with an upvote instead.`,
          duplicateOf: sub.id,
        }, 409)
      }
    }

    const subId = await this.recordSubmission(hot, team, puzzleId, puzzle.batchId, expr.trim(), 'Posted a formula')
    hot.predictions.set(subId, prediction)
    return jsonRes({ ok: true, submissionId: subId })
  }

  // ─── Image puzzle submit ───────────────────────────────────────────────────

  private async handleImageSubmit(
    teamId: string, puzzleId: string, expr: string, puzzle: ImagePuzzleDef,
  ): Promise<Response> {
    const hot = await this.state()
    const batch = hot.batches.get(puzzle.batchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'This batch is not open' }, 400)
    if (!batch.submissions_open) return jsonRes({ error: 'Submissions are closed for this batch' }, 400)

    if ((hot.subsByPuzzle.get(puzzleId) ?? []).some((s) => s.team_id === teamId)) {
      return jsonRes({ error: 'Your team already submitted an answer for this puzzle' }, 409)
    }

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
    // The picker only lets a transform be chosen once. Repeats would also let a pipeline
    // slip past the duplicate check below (e.g. invert twice is the same as nothing).
    if (new Set(filters).size !== filters.length) {
      return jsonRes({ error: 'Each transform can be used only once' }, 400)
    }

    const team = await this.ensureTeam(hot, teamId)
    if (!team) return jsonRes({ error: 'Team not found' }, 404)
    if (team.wallet < hot.config.postStake) {
      return jsonRes({ error: `Posting costs ${hot.config.postStake} coins — you have ${team.wallet}` }, 403)
    }

    // Duplicate check: an answer that gives the same pictures as one already posted is a
    // duplicate, even if the transforms are listed in a different order.
    const mine = answerKey(puzzleId, filters)
    const existing = hot.subsByPuzzle.get(puzzleId) ?? []
    for (let i = 0; i < existing.length; i++) {
      let theirs: unknown
      try { theirs = JSON.parse(existing[i].expr) } catch { continue }
      if (!Array.isArray(theirs) || answerKey(puzzleId, theirs as string[]) !== mine) continue
      const who = buildPublicSubmission(existing[i], hot.config.anonymousVoting, i, false).label
      return jsonRes({
        error: `${who} already submitted an answer that gives the same result. Back it with an upvote, or try something different.`,
        duplicateOf: existing[i].id,
      }, 409)
    }

    const subId = await this.recordSubmission(
      hot, team, puzzleId, puzzle.batchId, JSON.stringify(filters), 'Submitted image puzzle answer',
    )
    return jsonRes({ ok: true, submissionId: subId })
  }

  private async recordSubmission(
    hot: HotState, team: TeamInfo, puzzleId: string, batchId: BatchId, stored: string, note: string,
  ): Promise<string> {
    const stake = hot.config.postStake
    const subId = crypto.randomUUID()
    const now   = Date.now()
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO submissions (id, puzzle_id, batch_id, team_id, expr, stake, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(subId, puzzleId, batchId, team.id, stored, stake, now),
      this.env.DB.prepare('UPDATE teams SET wallet = wallet - ? WHERE id = ?').bind(stake, team.id),
      this.env.DB.prepare(
        'INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), team.id, batchId, puzzleId, 'post_stake', -stake, note, now),
    ])

    const sub: SubmissionRow = {
      id: subId, puzzle_id: puzzleId, batch_id: batchId, team_id: team.id, team_name: team.name,
      expr: stored, stake, r2_score: null, verdict: null, submitted_at: now, ups: 0, downs: 0,
    }
    hot.subs.set(subId, sub)
    if (!hot.subsByPuzzle.has(puzzleId)) hot.subsByPuzzle.set(puzzleId, [])
    const list = hot.subsByPuzzle.get(puzzleId)!
    list.push(sub)
    team.wallet -= stake

    this.broadcast({
      type: 'SUBMISSION_MADE', puzzleId,
      submission: buildPublicSubmission(sub, hot.config.anonymousVoting, list.length - 1, false),
    })
    this.broadcast({ type: 'TEAM_UPDATED', team })
    return subId
  }

  // ─── Vote ─────────────────────────────────────────────────────────────────

  private async handleVote(body: Row): Promise<Response> {
    const { teamId, submissionId, voteType } = body as { teamId: string; submissionId: string; voteType: VoteType }
    if (!teamId || !submissionId || !voteType) return jsonRes({ error: 'Missing fields' }, 400)
    if (voteType !== 'up' && voteType !== 'down') return jsonRes({ error: 'Invalid voteType' }, 400)

    const hot = await this.state()
    const sub = hot.subs.get(submissionId)
    if (!sub) return jsonRes({ error: 'Submission not found' }, 404)
    if (sub.team_id === teamId) return jsonRes({ error: 'You cannot vote on your own team\'s formula' }, 403)

    const batch = hot.batches.get(sub.batch_id as BatchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'This batch is not open' }, 400)
    if (!batch.voting_open) return jsonRes({ error: 'Voting is closed for this batch' }, 400)

    const config = hot.config
    const team = await this.ensureTeam(hot, teamId)
    if (!team) return jsonRes({ error: 'Team not found' }, 404)

    const votesUsed = hot.votesUsed.get(teamId) ?? 0
    if (votesUsed >= config.voteBudget) {
      return jsonRes({ error: `You have used all ${config.voteBudget} votes` }, 403)
    }

    const voteKey = `${teamId}:${submissionId}`
    if (hot.votes.has(voteKey)) return jsonRes({ error: 'You already voted on this formula' }, 409)

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

    hot.votes.set(voteKey, voteType)
    hot.votesUsed.set(teamId, votesUsed + 1)
    if (voteType === 'up') sub.ups = (sub.ups ?? 0) + 1
    else sub.downs = (sub.downs ?? 0) + 1
    team.wallet -= config.voteStake

    this.broadcast({ type: 'VOTE_CAST', puzzleId: sub.puzzle_id, submissionId, ups: sub.ups ?? 0, downs: sub.downs ?? 0 })
    this.broadcast({ type: 'TEAM_UPDATED', team })

    return jsonRes({ ok: true, votesRemaining: config.voteBudget - votesUsed - 1 })
  }

  // ─── Hint ─────────────────────────────────────────────────────────────────

  private async handleHint(body: Row): Promise<Response> {
    const { teamId, puzzleId } = body as { teamId: string; puzzleId: string }
    if (!teamId || !puzzleId) return jsonRes({ error: 'Missing fields' }, 400)

    const puzzle = PUZZLE_MAP.get(puzzleId)
    if (!puzzle) return jsonRes({ error: 'Unknown puzzle' }, 404)

    const hot = await this.state()
    const batch = hot.batches.get(puzzle.batchId)
    if (!batch || batch.status !== 'open') return jsonRes({ error: 'Hints only available while a batch is open' }, 400)

    const config = hot.config
    const team = await this.ensureTeam(hot, teamId)
    if (!team) return jsonRes({ error: 'Team not found' }, 404)
    const hintKey = `${teamId}:${puzzleId}`
    const bought = hot.hints.get(hintKey) ?? 0
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

    hot.hints.set(hintKey, bought + 1)
    team.wallet -= config.hintCost
    this.broadcast({ type: 'TEAM_UPDATED', team })

    return jsonRes({ ok: true, hints: puzzle.hints.slice(0, bought + 1) })
  }

  // ─── Team joined (called by auth.ts after registration) ───────────────────

  private async handleTeamJoined(body: Row): Promise<Response> {
    const team = await this.ensureTeam(await this.state(), body.teamId)
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

    this.hot = null
    const updated = (await this.state()).batches.get(batchId)
    if (updated) this.broadcast({ type: 'BATCH_UPDATED', batch: batchInfo(updated) })
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

    this.hot = null
    const updated = (await this.state()).batches.get(batchId)
    if (updated) this.broadcast({ type: 'BATCH_UPDATED', batch: batchInfo(updated) })
    return jsonRes({ ok: true })
  }

  // ─── Admin: settle batch ──────────────────────────────────────────────────
  // Payouts are computed here, then written as a fixed handful of statements that
  // take the whole payout list as one JSON parameter. They go in a single
  // DB.batch, which D1 applies all-or-nothing: if it fails nothing was paid and
  // the batch is still open, so settling again is safe. It also stays well under
  // D1's per-request query cap however many teams and votes there are.

  private async handleSettleBatch(body: Row): Promise<Response> {
    const batchId = body.batchId as BatchId
    const batch = await getBatchById(this.env.DB, batchId)
    if (!batch) return jsonRes({ error: 'Unknown batch' }, 404)
    if (batch.status !== 'open') return jsonRes({ error: 'Batch is not open' }, 409)

    const config = await getConfig(this.env.DB)
    const Ps = config.postStake, Pp = config.postPayout
    const Vs = config.voteStake, Bp = config.backPayout

    const submissionRows = await getSubmissionsForBatch(this.env.DB, batchId)
    const voteRows = await this.env.DB
      .prepare('SELECT submission_id, voter_team_id, vote_type, stake FROM votes WHERE batch_id = ?')
      .bind(batchId).all<{ submission_id: string; voter_team_id: string; vote_type: string; stake: number }>()

    // Positional tuples keep the JSON parameter small; the SQL below reads them by index.
    const txns:     [string, string, string, string, number, string][] = []   // id, team, puzzle, type, delta, note
    const verdicts: [string, number, Verdict][] = []                          // submission, r2, verdict
    const walletDeltas = new Map<string, number>()
    const scoreDeltas  = new Map<string, number>()

    const pay = (teamId: string, delta: number, type: string, note: string, puzzleId: string) => {
      if (delta === 0) return
      walletDeltas.set(teamId, (walletDeltas.get(teamId) ?? 0) + delta)
      txns.push([crypto.randomUUID(), teamId, puzzleId, type, delta, note])
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
          // Right means the pipeline reproduces the correct pictures, in whatever order.
          const isRight = isCorrectImageAnswer(imagePuzzle, submitted)
          verdict  = isRight ? 'right' : 'wrong'
          r2       = isRight ? 1 : 0
          accuracy = isRight ? 1 : 0
        } else {
          ;({ verdict, r2, accuracy } = judge(row.expr, puzzle!.X, puzzle!.y, puzzle!.solution))
        }
        const votes = voteRows.results.filter((v) => v.submission_id === row.id)
        const backers  = votes.filter((v) => v.vote_type === 'up')
        const doubters = votes.filter((v) => v.vote_type === 'down')

        verdicts.push([row.id, r2, verdict])

        if (verdict === 'right') {
          pay(row.team_id, Ps + Pp, 'post_win', 'Formula correct: stake back + payout', puzzleId)
          pay(row.team_id, Vs * doubters.length, 'post_doubter_income', 'Collected stakes from doubters', puzzleId)
          scoreDeltas.set(row.team_id, (scoreDeltas.get(row.team_id) ?? 0) + 1)
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

    const now = Date.now()
    const db  = this.env.DB
    await db.batch([
      db.prepare(`
        INSERT INTO wallet_transactions (id, team_id, batch_id, puzzle_id, type, delta, note, created_at)
        SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2, json_extract(value, '$[2]'),
               json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'), ?3
        FROM json_each(?1)
      `).bind(JSON.stringify(txns), batchId, now),
      db.prepare(`
        UPDATE submissions SET r2_score = j.r2, verdict = j.verdict
        FROM (SELECT json_extract(value, '$[0]') AS id, json_extract(value, '$[1]') AS r2,
                     json_extract(value, '$[2]') AS verdict FROM json_each(?1)) AS j
        WHERE submissions.id = j.id
      `).bind(JSON.stringify(verdicts)),
      db.prepare(`
        UPDATE teams SET wallet = wallet + j.delta
        FROM (SELECT json_extract(value, '$[0]') AS team_id, json_extract(value, '$[1]') AS delta FROM json_each(?1)) AS j
        WHERE teams.id = j.team_id
      `).bind(JSON.stringify([...walletDeltas])),
      db.prepare(`
        UPDATE teams SET total_score = total_score + j.n
        FROM (SELECT json_extract(value, '$[0]') AS team_id, json_extract(value, '$[1]') AS n FROM json_each(?1)) AS j
        WHERE teams.id = j.team_id
      `).bind(JSON.stringify([...scoreDeltas])),
      db.prepare("UPDATE batches SET status='settled', submissions_open=0, voting_open=0, settled_at=? WHERE id=? AND status='open'")
        .bind(now, batchId),
    ])

    // Only the team list now (2 queries); end-game settles every batch in one
    // request, and a full reload per batch would push it past the query cap.
    this.hot = null
    const teams   = await getAllTeams(this.env.DB)
    const teamMap = new Map(teams.map((t) => [t.id, t]))
    const solutions = Object.fromEntries(puzzleIds.map((id) => [id, PUZZLE_MAP.get(id)?.solution ?? '']))

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
  // Same all-or-nothing approach as settling: five set-based statements in one batch.

  private async handleReopenBatch(body: Row): Promise<Response> {
    const batchId = body.batchId as BatchId
    const batch = await getBatchById(this.env.DB, batchId)
    if (!batch) return jsonRes({ error: 'Unknown batch' }, 404)
    if (batch.status !== 'settled') return jsonRes({ error: 'Batch is not settled' }, 409)

    const db = this.env.DB
    await db.batch([
      db.prepare(`
        UPDATE teams SET wallet = wallet - t.net
        FROM (SELECT team_id, SUM(delta) AS net FROM wallet_transactions
              WHERE batch_id = ?1 AND type IN (${SETTLEMENT_TYPES}) GROUP BY team_id) AS t
        WHERE teams.id = t.team_id
      `).bind(batchId),
      db.prepare(`
        UPDATE teams SET total_score = MAX(0, total_score - s.n)
        FROM (SELECT team_id, COUNT(*) AS n FROM submissions
              WHERE batch_id = ?1 AND verdict = 'right' GROUP BY team_id) AS s
        WHERE teams.id = s.team_id
      `).bind(batchId),
      db.prepare(`DELETE FROM wallet_transactions WHERE batch_id = ? AND type IN (${SETTLEMENT_TYPES})`).bind(batchId),
      db.prepare('UPDATE submissions SET r2_score = NULL, verdict = NULL WHERE batch_id = ?').bind(batchId),
      db.prepare("UPDATE batches SET status='open', submissions_open=1, voting_open=1, settled_at=NULL WHERE id=? AND status='settled'")
        .bind(batchId),
    ])

    this.hot = null
    const teams = await getAllTeams(this.env.DB)
    this.broadcast({ type: 'BATCH_REOPENED', batchId, teams })

    return jsonRes({ ok: true })
  }

  // ─── Admin: end game ──────────────────────────────────────────────────────

  private async handleEndGame(): Promise<Response> {
    // Each batch settles atomically on its own; if one fails, the ones before it
    // stay settled and ending again picks up the rest.
    const openBatches = await this.env.DB
      .prepare("SELECT id FROM batches WHERE status = 'open'")
      .all<{ id: string }>()
    for (const { id } of openBatches.results) {
      await this.handleSettleBatch({ batchId: id })
    }

    await this.env.DB.prepare("UPDATE game_config SET status = 'finished' WHERE id = 1").run()
    this.hot = null

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
    this.hot = null

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
    this.hot = null
    return jsonRes({ ok: true })
  }

  // ─── Admin: remove team ───────────────────────────────────────────────────

  private async handleRemoveTeam(body: Row): Promise<Response> {
    const { teamId } = body as { teamId: string }
    // CASCADE deletes members, submissions, votes, transactions
    await this.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(teamId).run()
    this.hot = null

    this.kickTeam(teamId, 'Team removed')

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

  // ─── Admin: reset login ───────────────────────────────────────────────────

  private async handleResetLogin(body: Row): Promise<Response> {
    const { teamId } = body as { teamId: string }
    const res = await this.env.DB.prepare('UPDATE teams SET token_hash = NULL WHERE id = ?').bind(teamId).run()
    if (res.meta.changes !== 1) return jsonRes({ error: 'Team not found' }, 404)

    if (this.kickTeam(teamId, 'Login reset by host')) await this.markOffline(teamId)
    return jsonRes({ ok: true })
  }

  /** Closes the team's sockets with 4001, which tells clients to sign out and not reconnect. */
  private kickTeam(teamId: string, reason: string): boolean {
    const sockets = this.connections.get(teamId)
    if (!sockets) return false
    this.connections.delete(teamId)
    for (const ws of sockets) {
      try { ws.close(4001, reason) } catch { /* already closed */ }
    }
    return true
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

# Blackbox Leaderboard — Complete Plan

## What Is This?

A real-time multiplayer game where players are shown a **hidden black-box function** that maps inputs to outputs (`x → ??? → y`). Players analyze data points lying on the curve and try to identify the hidden transform (e.g., `y = k·x²`). They don't need to guess `k` — just the shape of the function. Points are awarded based on R² score (how well their submitted transform fits the data), and a subsequent betting round lets players wager on each other's submissions.

---

## Game Flow

```
LOBBY
  Players join with a username. The host picks a puzzle and starts the round.

LIVE ROUND (one timer, default 300 s)
  Everyone sees the puzzle: a description, a scatter plot and the raw (x, y) data.
  Posting and voting happen at the same time:
    - POST: a player claims an exact formula, coefficients included
      (e.g. y = 2x² + 3·sin(x)). One post per player per round. Costs the post stake.
      A formula is rejected if its predictions are within 2% of an already-claimed
      formula, so 2x² blocks 2.01x², but 3x² is a different, valid claim.
    - VOTE: back (▲) or doubt (▼) anyone else's claim. Each vote costs the vote
      stake; each player has votes_per_round votes. Vote counts are public and live.
  Stakes leave the wallet immediately. The timer ending (or the host) closes the round.

RESULTS
  Every claim is judged against the data, the hidden formula is revealed,
  and all stakes are settled in one D1 batch.

LOBBY (next round) or FINISHED
  The host starts another round, or ends the game → final leaderboard by wallet.
```

---

## Formulas

Players type formulas: `2x^2 + 3sin(x)`, `x1/x2`, `sqrt(x1^2 + x2^2)`, `4sin(2pi x/7)`.
Implicit multiplication, `^`/`**`, `π`, `√`, `²`/`³` all work. The parser lives in
`shared/expression.ts` and is used by both the worker (judging) and the frontend
(live preview + error messages), so the two can never disagree.

## Judging

A claim's predictions p are compared with the true y using
`dist(p, y) = ‖p − y‖ / ‖y − mean(y)‖` (= √(1 − R²)).

- **Right**: `dist ≤ 0.02`.
- **Close**: not right, but refitting the claim's own coefficients plus a constant
  makes it right, i.e. right functions with wrong numbers (3x² + 1 when the answer is 2x²).
  Only if it uses no more terms than the real answer, so listing every function doesn't qualify.
- **Wrong**: anything else.
- **Duplicate** of an existing claim q if `dist(p, q) < 0.02`, so x·x is blocked once x² is taken.

See `src/game/formula.ts`.

## Settlement

Ps = post stake (100), Pp = post payout (100), Vs = vote stake (50),
Bp = back payout (120, must be > Pp). Stakes are paid up front.

| You…         | Right                               | Close    | Wrong                               |
|--------------|-------------------------------------|----------|-------------------------------------|
| posted it    | +Pp, plus Vs from every doubter     | +Pp/2    | −Ps, and pay every doubter Vs       |
| backed it ▲  | +Bp                                 | +Bp/2    | −Vs                                 |
| doubted it ▼ | −Vs, paid to the poster             | refunded | +Vs, paid by the poster             |

## Hints

Each puzzle has two hints, vaguest first. A player can buy them one at a time
during a live round (hint cost, default 40). Only the buyer sees them.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Real-time state & race-condition prevention | Cloudflare Durable Objects (`GameRoomDO`) |
| Persistent storage | Cloudflare D1 (SQLite) |
| Frontend | React + Vite (Cloudflare Pages) |
| Language | TypeScript throughout |
| Styling | Tailwind CSS |

### Why Durable Objects?

All game state mutations (submit, vote, phase advance, wallet settlement) are routed through the `GameRoomDO`. DOs execute single-threaded, meaning concurrent HTTP requests to submit or vote are automatically serialized — no race conditions possible. D1 transactions provide an additional safety net for wallet updates.

---

## Project Structure

```
/
├── src/                              ← Cloudflare Worker
│   ├── index.ts                      ← HTTP router + DO binding
│   ├── durable-objects/
│   │   └── GameRoomDO.ts             ← Core DO: WebSocket hub + state machine
│   ├── api/
│   │   ├── rooms.ts                  ← Create room, join room
│   │   ├── game.ts                   ← Submit answer, cast vote
│   │   └── admin.ts                  ← Admin-only handlers (protected by token)
│   ├── game/
│   │   ├── puzzles.ts                ← 25 puzzle definitions + pre-generated datasets
│   │   ├── transforms.ts             ← 17 unary + 4 binary transforms in TypeScript
│   │   ├── regression.ts             ← Pure TS least-squares linear regression
│   │   ├── scoring.ts                ← R², submission scoring, fuzzy power matching
│   │   └── similarity.ts             ← Pearson correlation similarity check
│   ├── db/
│   │   ├── schema.sql                ← D1 schema (run via wrangler d1 execute)
│   │   └── d1.ts                     ← Typed D1 query helpers
│   └── types.ts                      ← Shared TypeScript types
│
├── frontend/                         ← React + Vite app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx              ← Create room / join by ID
│   │   │   ├── Room.tsx              ← Main game view (phase-aware)
│   │   │   ├── Admin.tsx             ← Admin control panel
│   │   │   └── FinalLeaderboard.tsx  ← End-of-game standings
│   │   ├── components/
│   │   │   ├── PuzzleDisplay.tsx     ← Shows description + data table
│   │   │   ├── SubmissionForm.tsx    ← Feature selector UI
│   │   │   ├── VotingPanel.tsx       ← Submission cards + up/down buttons
│   │   │   ├── ResultsPanel.tsx      ← R² scores + wallet deltas
│   │   │   ├── Timer.tsx             ← Countdown display
│   │   │   ├── PlayerList.tsx        ← Connected players + wallet balances
│   │   │   └── WalletDisplay.tsx     ← Current player's wallet
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts       ← WS connection + message dispatch
│   │   └── types.ts                  ← Frontend-facing types
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── wrangler.toml                     ← DO bindings, D1 binding, routes
├── package.json
├── tsconfig.json
└── plan.md
```

---

## Database Schema (D1)

```sql
-- ─────────────────────────────────────────────
-- ROOMS
-- ─────────────────────────────────────────────
CREATE TABLE rooms (
  id                  TEXT    PRIMARY KEY,           -- nanoid
  name                TEXT    NOT NULL,
  admin_token         TEXT    NOT NULL UNIQUE,       -- UUID, returned on room creation
  status              TEXT    DEFAULT 'lobby',       -- lobby | active | finished
  max_rounds          INTEGER,                       -- NULL = admin ends manually
  starting_wallet     INTEGER DEFAULT 1000,
  phase1_secs         INTEGER DEFAULT 300,           -- submission phase duration
  phase2_secs         INTEGER DEFAULT 180,           -- voting phase duration
  poster_reward       INTEGER DEFAULT 200,           -- poster P&L amount
  voter_reward        INTEGER DEFAULT 50,            -- voter P&L amount
  votes_per_round     INTEGER DEFAULT 3,             -- vote budget per player per round
  anonymous_voting    INTEGER DEFAULT 0,             -- 0 = named, 1 = anonymous
  created_at          INTEGER NOT NULL
);

-- ─────────────────────────────────────────────
-- PLAYERS
-- ─────────────────────────────────────────────
CREATE TABLE players (
  id            TEXT    PRIMARY KEY,                 -- nanoid
  room_id       TEXT    NOT NULL REFERENCES rooms(id),
  username      TEXT    NOT NULL,
  wallet        INTEGER NOT NULL,                    -- current balance (persists across rounds)
  total_score   INTEGER DEFAULT 0,                   -- cumulative R²-based score
  is_connected  INTEGER DEFAULT 0,
  joined_at     INTEGER NOT NULL,
  UNIQUE(room_id, username)
);

-- ─────────────────────────────────────────────
-- ROUNDS
-- ─────────────────────────────────────────────
CREATE TABLE rounds (
  id            TEXT    PRIMARY KEY,
  room_id       TEXT    NOT NULL REFERENCES rooms(id),
  round_number  INTEGER NOT NULL,
  puzzle_id     TEXT    NOT NULL,
  phase         TEXT    DEFAULT 'submission',        -- submission | voting | results
  phase_ends_at INTEGER,                             -- unix ms; NULL = no auto-advance
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  UNIQUE(room_id, round_number)
);

-- Players present when a round starts (only they may submit)
CREATE TABLE round_players (
  round_id  TEXT NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY(round_id, player_id)
);

-- ─────────────────────────────────────────────
-- SUBMISSIONS
-- ─────────────────────────────────────────────
CREATE TABLE submissions (
  id            TEXT    PRIMARY KEY,
  round_id      TEXT    NOT NULL REFERENCES rounds(id),
  player_id     TEXT    NOT NULL REFERENCES players(id),
  features_json TEXT    NOT NULL,                    -- JSON: Feature[]
  r2_score      REAL,                                -- computed at results phase
  base_score    INTEGER DEFAULT 0,                   -- added to player total_score
  is_correct    INTEGER DEFAULT 0,                   -- 1 if r2 >= 0.92
  submitted_at  INTEGER NOT NULL,
  UNIQUE(round_id, player_id)                        -- one submission per player per round
);

-- ─────────────────────────────────────────────
-- VOTES
-- ─────────────────────────────────────────────
CREATE TABLE votes (
  id            TEXT NOT NULL PRIMARY KEY,
  round_id      TEXT NOT NULL REFERENCES rounds(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  voter_id      TEXT NOT NULL REFERENCES players(id),
  vote_type     TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
  voted_at      INTEGER NOT NULL,
  UNIQUE(round_id, voter_id, submission_id)          -- one vote per submission per voter
  -- votes_per_round budget enforced in DO before insert
);

-- ─────────────────────────────────────────────
-- WALLET TRANSACTIONS (full audit trail)
-- ─────────────────────────────────────────────
CREATE TABLE wallet_transactions (
  id          TEXT    PRIMARY KEY,
  player_id   TEXT    NOT NULL REFERENCES players(id),
  round_id    TEXT,
  type        TEXT    NOT NULL,
  -- submission_reward | submission_penalty
  -- upvote_correct_reward | upvote_wrong_penalty
  -- downvote_correct_penalty | downvote_wrong_reward
  delta       INTEGER NOT NULL,                      -- positive = earned, negative = lost
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX idx_players_room       ON players(room_id);
CREATE INDEX idx_rounds_room        ON rounds(room_id);
CREATE INDEX idx_submissions_round  ON submissions(round_id);
CREATE INDEX idx_votes_round        ON votes(round_id);
CREATE INDEX idx_votes_submission   ON votes(submission_id);
CREATE INDEX idx_txn_player         ON wallet_transactions(player_id);
```

---

## HTTP API

### Player-Facing

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/rooms` | — | `{ name, ...config? }` | `{ id, adminToken }` |
| `POST` | `/api/rooms/:id/join` | — | `{ username }` | `{ playerId }` |
| `GET` | `/api/rooms/:id` | — | — | Room state snapshot |
| `GET` | `/ws` | — | `?roomId=&playerId=` | WebSocket upgrade |
| `POST` | `/api/rooms/:id/submit` | — | `{ playerId, features }` | `{ ok }` |
| `POST` | `/api/rooms/:id/vote` | — | `{ playerId, submissionId, type }` | `{ ok, votesRemaining }` |
| `GET` | `/api/rooms/:id/leaderboard` | — | — | Final leaderboard |

### Admin-Facing (Bearer token required)

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/admin/puzzles` | — | List all 25 puzzles with metadata |
| `GET` | `/api/rooms/:id/admin/state` | — | Full room state + correct answers |
| `PATCH` | `/api/rooms/:id/admin/config` | `Partial<RoomConfig>` | Update settings between rounds |
| `POST` | `/api/rooms/:id/admin/start-round` | `{ puzzleId }` | Start a new round |
| `POST` | `/api/rooms/:id/admin/advance-phase` | — | Force-advance to next phase |
| `POST` | `/api/rooms/:id/admin/end-game` | — | End game → broadcast final leaderboard |

---

## WebSocket Protocol

### Connection

```
GET /ws?roomId=<id>&playerId=<id>
→ Worker validates player exists in room
→ Routes request to GameRoomDO via DO stub
→ DO upgrades to WebSocket
→ Server immediately sends FULL_STATE
```

### Server → Client Messages

```typescript
type ServerMessage =
  | { type: 'FULL_STATE';         state: RoomState }
  // Sent immediately on WS connect — includes all submissions made so far
  // (so a player who reconnects mid-phase sees everything they missed)

  | { type: 'PLAYER_JOINED';      player: PlayerInfo }
  | { type: 'PLAYER_LEFT';        playerId: string }
  | { type: 'PHASE_CHANGED';      phase: Phase; endsAt: number | null }

  | { type: 'SUBMISSION_MADE';    submission: PublicSubmission }
  // Broadcast immediately when ANY player submits during Phase 1.
  // Submissions are public and visible as they arrive (first-come-first-serve).
  // PublicSubmission includes label ('A','B',...) if anonymous_voting=true,
  // or the player's username if anonymous_voting=false.
  // This applies in both Phase 1 and Phase 2 (same visibility setting).

  | { type: 'VOTE_UPDATE';        submissionId: string; ups: number; downs: number }
  // Real-time vote counts during Phase 2. P&L NOT shown until Results.

  | { type: 'ROUND_RESULTS';      results: RoundResult[]; deltas: WalletDelta[] }
  // Broadcast at Results phase: R² scores, correctness, wallet deltas for everyone.

  | { type: 'GAME_ENDED';         leaderboard: LeaderboardEntry[] }
  | { type: 'ERROR';              message: string }
```

### Client → Server

Clients do NOT send game actions over WebSocket. Submit and vote go via HTTP POST (routed through the DO). WebSocket is receive-only for clients (plus a PING to keep alive).

---

## Durable Object: GameRoomDO

### Responsibilities

- Holds in-memory: `Map<playerId, WebSocket>` for all connected clients
- Owns the phase state machine
- Schedules phase auto-advance via **DO Alarms**
- Serializes all D1 writes (single-threaded = no race conditions)
- Validates all game actions (correct phase, player eligibility, vote budget)
- Broadcasts WebSocket messages to all connected clients

### State Machine

```
LOBBY
  ↓  admin POST /admin/start-round { puzzleId }
  │  → snapshot round_players, set phase_ends_at, schedule DO alarm

SUBMISSION_PHASE
  Each submission → immediately broadcast SUBMISSION_MADE to all clients
  Similarity check runs before insert: reject if Pearson > 0.95 with any existing submission
  ↓  DO alarm fires  OR  admin force-advances
  │  → no reveal needed (submissions already public); just transition phase

VOTING_PHASE
  ↓  DO alarm fires  OR  admin force-advances
  │  → evaluate all submissions (R², scoring)
  │  → settle wallets in single D1 transaction
  │  → broadcast ROUND_RESULTS

RESULTS_PHASE
  ↓  auto-advance after 10s  OR  admin starts next round
  │
  ├─ if max_rounds reached OR admin ends game:
  │    → broadcast GAME_ENDED with leaderboard
  │    → set room status = 'finished'
  │
  └─ otherwise:
       → back to LOBBY
```

### Race Condition Prevention

Every mutation is gated through the DO:

- HTTP `POST /submit` → routed to DO → DO validates (phase = submission, player eligible, not already submitted, similarity check) → writes to D1 → broadcasts `SUBMISSION_MADE` to all clients immediately
- HTTP `POST /vote` → routed to DO → DO validates (phase = voting, not own submission, votes remaining) → writes to D1 → broadcasts vote count
- DO alarm fires → DO executes phase transition → D1 transaction for wallet settlement → broadcasts results

Because the DO is single-threaded, two simultaneous vote requests cannot both "see" the same remaining vote count. The first one runs to completion before the second starts.

---

## Game Logic (TypeScript)

### Feature Transforms (`transforms.ts`)

```typescript
// Unary transforms
identity:     x => x
square:       x => x ** 2
cube:         x => x ** 3
sqrt:         x => Math.sqrt(Math.abs(x))
abs:          x => Math.abs(x)
log:          x => Math.log(Math.abs(x) + 1e-10)
log2:         x => Math.log2(Math.abs(x) + 1e-10)
reciprocal:   x => 1 / (x + 1e-10)
sin:          x => Math.sin(x)
cos:          x => Math.cos(x)
sin_2pi:      x => Math.sin(2 * Math.PI * x)
cos_2pi:      x => Math.cos(2 * Math.PI * x)
sin_period7:  x => Math.sin(2 * Math.PI * x / 7)
cos_period7:  x => Math.cos(2 * Math.PI * x / 7)
exp:          x => Math.exp(x)
floor10:      x => Math.floor(x / 10) * 10
step:         x => x >= 0 ? 1 : 0

// Binary transforms (combine two columns)
multiply:     (a, b) => a * b
divide:       (a, b) => a / (b + 1e-10)
add:          (a, b) => a + b
distance:     (a, b) => Math.sqrt(a ** 2 + b ** 2)
```

### Linear Regression (`regression.ts`)

Pure TypeScript least-squares. No external libraries.

```
Given feature matrix X (n × m) and target y (n):
  Add bias column of 1s → X_aug (n × m+1)
  β = (X_augᵀ · X_aug)⁻¹ · X_augᵀ · y
  ŷ = X_aug · β
```

Matrix inversion via Gaussian elimination (small matrices, very fast in V8).

### R² Score (`scoring.ts`)

```
ȳ     = mean(y)
SS_tot = Σ(yᵢ − ȳ)²
SS_res = Σ(yᵢ − ŷᵢ)²
R²    = 1 − SS_res / SS_tot
```

### Submission Scoring (`scoring.ts`)

```typescript
function scoreSubmission(r2: number, submittedFeatures: Feature[], puzzle: Puzzle): number {
  if (r2 >= 0.92) {
    const qualityBonus = Math.round(50 * (r2 - 0.92) / 0.08)
    return 100 + qualityBonus   // max 150
  }
  // Fuzzy power-family partial credit
  return fuzzyPowerScore(submittedFeatures, puzzle.solutionFeatures)
}
```

### Similarity Check (`similarity.ts`)

Before accepting a submission, check for near-duplicates:

1. Apply submitted transforms to puzzle x-values → feature vector F_new
2. For each existing submission in the round → feature vector F_existing
3. Compute Pearson correlation between F_new and F_existing
4. If any correlation > 0.95 → reject with `"Too similar to an existing submission"`

This prevents players from copying the same transform with a trivial scalar difference.

---

## Puzzle Data Strategy (`puzzles.ts`)

All 25 puzzle datasets are pre-generated (200 data points, seed=42) and bundled as TypeScript constants in the Worker. This avoids runtime data generation and any dependency on Python/numpy.

Structure per puzzle:
```typescript
type PuzzleData = {
  id: string
  title: string
  description: string          // cryptic hint shown to players
  difficulty: 1 | 2 | 3       // 1=beginner, 2=intermediate, 3=challenge
  columns: string[]            // input column names e.g. ['x'] or ['x1','x2']
  X: Record<string, number[]>  // input values (shown to players)
  y: number[]                  // output values (shown to players)
  // SERVER-SIDE ONLY (never sent to clients):
  solutionFeatures: Feature[]  // correct features
  correctPowerMap?: Record<string, number>  // for fuzzy scoring
}
```

The `X` and `y` values are shown to players in the UI. `solutionFeatures` is never sent to the frontend.

---

## Frontend Pages

### `/` — Home
- Create a new room (form: room name + optional config)
- Join an existing room (input: room ID + username)
- Stores `playerId` in `localStorage` for reconnection

### `/room/:id` — Game Room (phase-aware)

**Lobby phase:**
- Player list with connection status
- "Waiting for admin to start the round…"
- Room ID displayed for sharing

**Submission phase:**
- Puzzle description + data table (x, y values)
- Available transforms listed
- Feature builder UI (add/remove transforms, select columns)
- Submit button (disabled after submission)
- Timer countdown
- Live feed of submissions as they arrive (first-come-first-serve):
  - Shows player name or "Player A/B/C…" depending on anonymous_voting setting
  - Shows submitted features immediately on receipt
  - Your own submission is highlighted
  - If your submission is rejected for similarity, an error is shown inline

**Voting phase:**
- Same submission list (already visible from Phase 1, no new reveal)
- Up/Down vote buttons appear on each card (own card has no vote buttons)
- Vote budget indicator (e.g., "2 votes remaining")
- Live vote counts update in real-time via WebSocket
- Timer countdown
- Wallet balance shown (P&L NOT shown yet)

**Results phase:**
- Each submission: R² score, correctness indicator, base score earned
- Wallet delta table: what each player gained/lost and why
- Your updated wallet balance
- "Next round starting soon…" or end-of-game message

### `/admin/:token` — Admin Panel
- Room overview: current phase, round number, player list
- Config editor: timers, wallet amounts, votes_per_round, anonymous_voting toggle, max_rounds
- Puzzle selector: browse all 25 puzzles (title, difficulty, description)
- Controls: Start Round, Advance Phase, End Game
- Live view: submission count, vote counts per submission (admin sees everything)
- Correct answer revealed to admin during submission phase

### `/room/:id/final` — Final Leaderboard
- Ranked table: username, total wallet, total score, rounds played
- Round-by-round breakdown per player
- Shown automatically when admin ends game (via WebSocket GAME_ENDED)

---

## Admin Config Options (per room)

| Setting | Default | Description |
|---|---|---|
| `starting_wallet` | 1000 | Initial coins for each player |
| `phase1_secs` | 300 | Submission phase duration (seconds) |
| `phase2_secs` | 180 | Voting phase duration (seconds) |
| `poster_reward` | 200 | Coins poster earns/loses |
| `voter_reward` | 50 | Coins voter earns/loses |
| `votes_per_round` | 3 | Vote budget per player per round |
| `anonymous_voting` | false | Hide usernames in both submission and voting phases (show "Player A/B/C…" instead) |
| `max_rounds` | null | Auto-end after N rounds (null = manual) |

---

## The 25 Puzzles

### Beginner (difficulty 1)

| ID | Title | Hidden Rule |
|----|-------|-------------|
| `line_01` | Obedient Numbers | `y = k·x` |
| `line_02` | The Reluctant Ascent | `y = k·x` (negative k) |
| `square_01` | The Bend in the Road | `y = k·x²` |
| `sqrt_01` | Momentum Decay | `y = k·√x` |
| `log_01` | The Compressed Universe | `y = k·log(x)` |
| `distractor_01` | Four Suspects | `y = k·x₁` (x₂, x₃, x₄ are noise) |

### Intermediate (difficulty 2)

| ID | Title | Hidden Rule |
|----|-------|-------------|
| `almost_linear_01` | The Imposter Line | `y = x + 0.5·sin(x)` |
| `almost_linear_02` | Static on the Signal | `y = x + sin(x) + noise` |
| `reciprocal_01` | Vanishing Point | `y = k/x` |
| `abs_01` | The Symmetric Grudge | `y = k·|x|` |
| `cos_01` | The Quarter-Turn | `y = k·cos(x)` |
| `periodic_01` | The Repeating Rumour | `y = k·sin(x)` |
| `periodic_02` | Seven Days of Nothing | `y = k·sin(2πx/7)` |
| `product_01` | The Missing Third Variable | `y = k·x₁·x₂` |
| `ratio_01` | Speed Without Units | `y = k·x₁/x₂` |

### Challenge (difficulty 3)

| ID | Title | Hidden Rule |
|----|-------|-------------|
| `distance_01` | The Displacement Field | `y = k·√(x₁²+x₂²)` |
| `cubic_01` | Tripling the Problem | `y = k·x³` |
| `boss_multi` | The Hidden Tax | `y = x₁·x₂ + 2x₃` |
| `boss_sin_sum` | Interfering Signals | `y = sin(x) + sin(2x)` |
| `boss_multi_feat` | Chaos in Three Channels | `y = x₁² + log(x₂) + √x₃` |
| `period_boss` | The Noisy Calendar | `y = sin(2πx/7) + noise + distractor` |
| `polynomial_01` | The Bent Wire | `y = x² − 3x` |
| `phase_01` | The Hidden Angle | `y = sin(x) + cos(x)` |
| `almost_linear_02` | Static on the Signal | `y = x + sin(x) + noise` |
| `exp_01` | The Runaway Growth | `y = k·eˣ` (small x range) |

---

## Implementation Order

### Phase 1 — Scaffold & Data Layer
1. `wrangler.toml` — DO bindings, D1 binding, routes
2. `package.json` + `tsconfig.json` — Worker + frontend setup
3. `src/db/schema.sql` — full D1 schema
4. `src/game/transforms.ts` — all 17 unary + 4 binary transforms
5. `src/game/regression.ts` — least-squares linear regression
6. `src/game/scoring.ts` — R², submission score, fuzzy power matching
7. `src/game/similarity.ts` — Pearson correlation check
8. `src/game/puzzles.ts` — 25 pre-generated datasets + solution metadata

### Phase 2 — Backend
9. `src/types.ts` — all shared TypeScript types
10. `src/db/d1.ts` — typed D1 query helpers + transaction wrappers
11. `src/durable-objects/GameRoomDO.ts` — state machine, WS hub, alarms, mutations
12. `src/api/rooms.ts` — create room, join room
13. `src/api/game.ts` — submit, vote (routed through DO)
14. `src/api/admin.ts` — admin handlers (protected by token)
15. `src/index.ts` — main router + DO fetch forwarding

### Phase 3 — Frontend
16. `frontend/` scaffold — Vite + React + Tailwind + TypeScript
17. `frontend/src/hooks/useWebSocket.ts` — WS connection, reconnection, message dispatch
18. `frontend/src/pages/Home.tsx` — create/join room
19. `frontend/src/pages/Room.tsx` + all sub-components — full game view
20. `frontend/src/pages/Admin.tsx` — admin control panel
21. `frontend/src/pages/FinalLeaderboard.tsx` — end-of-game standings

---

## Key Design Decisions & Rationale

### Why R² and linear regression?
The hidden function has an unknown coefficient (e.g., `y = 7.3·x²`). Players only guess the **shape** (`x²`), not the number. Linear regression learns the coefficient automatically, and R² measures how well the submitted shape fits the data — a natural, continuous correctness score that enables partial credit and feeds into the betting mechanics.

### Why Durable Objects for race condition prevention?
All game state mutations (submit, vote, phase advance, wallet settlement) go through the DO. The DO's single-threaded execution model ensures that two simultaneous requests cannot corrupt shared state. D1 transactions provide additional atomicity for multi-row wallet updates.

### Why HTTP for submit/vote instead of WebSocket?
Mutations (submit, vote) need request-response semantics — the player needs to know if their action succeeded or failed (e.g., "too similar", "vote budget exhausted", "wrong phase"). HTTP gives clean error responses. WebSocket is used only for server-push events that all players need to see simultaneously.

### Why pre-generate puzzle datasets?
Eliminates runtime dependency on Python/numpy random number generation. All 25 datasets are small enough to bundle (each is 200 rows × 1–3 columns). Guarantees deterministic, identical data for every game session.

### Player reconnection
`playerId` is stored in `localStorage`. On reconnect, the player POSTs `/api/rooms/:id/join` with their existing username — the server returns the same `playerId` (or a new session token if needed). The DO sends a `FULL_STATE` message on WebSocket connection, restoring all UI state.

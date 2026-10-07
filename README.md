# Blackbox Leaderboard

> Everyone sees the same data. Crack the hidden function. Bet on who's right.

A real-time multiplayer game. A hidden formula maps inputs to outputs:

```
x  →  ??? BLACK BOX ???  →  y
```

Players see a scatter plot and the raw `(x, y)` rows. They race to claim the exact
formula (`2x^2`, `3sin(x)`, `x1/x2`, …), then spend coins backing or doubting each
other's claims. When the timer runs out every claim is judged against the data, the
answer is revealed and wallets are settled. Most coins at the end wins.

Built for first-year students to discover feature shapes by looking at data.

---

## How a game runs

1. **Host** logs in at `/admin` with the master password and creates a room.
   Players join at `/` with the room code and a name.
2. **Host starts a round** by picking one of the 25 puzzles.
3. **Live round** (one timer, 300 s by default). At the same time, players can:
   - **Post** one formula per round. Costs the post stake. A formula is rejected if
     its predictions are within 2% of a formula someone already claimed, so `x·x`
     is blocked once `x^2` is taken, but `3x^2` is a different claim from `2x^2`.
   - **Vote** ▲ back or ▼ doubt on other players' formulas. Each vote costs the
     vote stake; each player has a limited number of votes. Counts are public and live.
   - **Buy hints**, vaguest first. Only the buyer sees them.
4. **Results.** When the timer ends (or the host forces it) every claim is judged,
   the hidden formula is revealed, and all stakes are settled in one database batch.
5. The host starts another round, or ends the game and everyone sees the final leaderboard.

### Typing formulas

Write them the way you would on paper:

```
2x^2 + 3sin(x)      x1/x2      sqrt(x1^2 + x2^2)      4sin(2pi x/7)      y = -3x
```

- Implicit multiplication: `2x`, `3sin(x)`, `x(x+1)`, `2pi x`
- Powers: `^` or `**`, plus `²` and `³`
- Constants: `pi` / `π`, `e`
- Functions: `sin cos tan exp ln log log2 log10 sqrt √ abs floor ceil step`
- Input names are the puzzle's columns (`x`, or `x1`, `x2`, …)

The parser (`shared/expression.ts`) is shared by the worker and the browser, so the
live preview and error messages always agree with the judging.

### Judging

A claim's predictions `p` are compared with the true `y`:

```
dist(p, y) = ‖p − y‖ / ‖y − mean(y)‖        (= √(1 − R²))
```

| Verdict | Rule |
|---|---|
| **Right** | `dist ≤ 0.02` |
| **Close** | Not right, but refitting the claim's own coefficients plus a constant makes it right — the right functions with the wrong numbers (`3x^2 + 1` when the answer is `2x^2`). Only counts if it uses no more terms than the real answer. |
| **Wrong** | Anything else, including formulas that break on some rows (division by zero, `log` of a negative, overflow). |

See `src/game/formula.ts`.

### Settlement

All stakes leave the wallet the moment you post, vote or buy a hint.
With the defaults — post stake **Ps = 100**, post payout **Pp = 100**,
vote stake **Vs = 50**, back payout **Bp = 120** (must be bigger than Pp):

| You…         | Right                           | Close                 | Wrong                               |
|--------------|---------------------------------|-----------------------|-------------------------------------|
| posted it    | stake back + Pp, plus Vs from every doubter | stake back + Pp/2 | stake lost, and pay every doubter Vs |
| backed it ▲  | stake back + Bp                 | stake back + Bp/2     | stake lost                          |
| doubted it ▼ | stake goes to the poster        | stake back            | stake back + Vs from the poster     |

Each right post also adds 1 to the player's score, which breaks ties on the leaderboard.

### Room settings

Set when the room is created and editable between rounds from the admin panel.

| Setting | Default | Meaning |
|---|---|---|
| Starting wallet | 1000 | Coins each player starts with |
| Round length | 300 s | Length of the live round |
| Post stake / payout | 100 / 100 | See settlement |
| Vote stake / back payout | 50 / 120 | See settlement |
| Hint cost | 40 | Price per hint |
| Votes per round | 3 | Vote budget per player |
| Anonymous | off | Show claims as "A", "B", "C"… instead of names |
| Max rounds | none | Auto-end the game after N rounds |

---

## Player identity

Joining returns a `playerId` and a secret `token`, both stored in the browser's
`localStorage` for that room. `playerId`s are public — they appear in every
broadcast — so the **token is the credential**: it is required to rejoin under a
taken name, to open the WebSocket, and to post, vote or buy hints.

- Rejoining with the same name works only from the browser that holds the token.
  From anywhere else the name is taken.
- **Lost login** (cleared browser, new device): the host clicks **Reset login** next to
  the player in the admin panel. That signs out whoever holds the old token, and the
  next join with that name takes the account back with its wallet. Have the player
  join right after the reset — until they do, anyone could claim the name.
- Players created before tokens existed have none. The first join with their name
  claims it and gets a token; after that the name is locked.

---

## Architecture

| Layer | Technology |
|---|---|
| API + WebSocket entry | Cloudflare Worker ([Hono](https://hono.dev)) |
| Per-room state, timer, broadcasts | Cloudflare Durable Object (`GameRoomDO`), one per room |
| Storage | Cloudflare D1 (SQLite) |
| Frontend | React 18 + Vite + Tailwind, deployed on Vercel |

Every game action goes through the room's Durable Object. D1 calls are not covered
by Durable Object input gates, so the DO runs each state-changing action through a
promise queue (`serialized()`); two simultaneous votes can never both see the same
remaining budget or balance. The round timer is a DO alarm.

Clients only **receive** over the WebSocket (plus `PING`/`PONG` keep-alive). Actions
go over HTTP so the player gets a clear success or error response.

```
src/                          Cloudflare Worker
├── index.ts                  Router, CORS, /ws upgrade → DO
├── api/
│   ├── rooms.ts              Create room, join, room snapshot, leaderboard
│   ├── game.ts               Submit, vote, hint (token-checked, forwarded to DO)
│   └── admin.ts              Admin routes (master password or room admin token)
├── durable-objects/
│   └── GameRoomDO.ts         WebSocket hub, round state machine, settlement
├── game/
│   ├── formula.ts            Judging, duplicate detection, least-squares refit
│   └── puzzles.ts            25 puzzles; datasets generated at load (seeded PRNG)
├── db/
│   ├── schema.sql            Full schema for a fresh database
│   ├── migrations/           ALTERs for databases created before a change
│   └── d1.ts                 Typed query helpers, player auth check
└── types.ts                  Shared types and the WebSocket protocol

shared/
└── expression.ts             Formula tokenizer, parser, evaluator (worker + browser)

frontend/src/
├── pages/                    Home, Room, Admin, FinalLeaderboard
├── components/               Puzzle panel, plot, formula input, entry feed, hints, …
├── hooks/useWebSocket.ts     Connection with backoff reconnect
└── lib/
    ├── backend.ts            API / WebSocket base URL
    ├── session.ts            playerId + token in localStorage
    └── formula.tsx           Pretty-printing formulas
```

### Round state machine

```
lobby ──start-round──▶ submission ──timer alarm / advance-phase──▶ results
  ▲                                                                   │
  └────────────── advance-phase / start-round ────────────────────────┘
                                   end-game (or max rounds) ──▶ finished
```

Ending the game during a live round settles it first, so no stakes are left hanging.

---

## HTTP API

### Players

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/rooms/:id/join` | `{ username, token? }` | `{ playerId, token, reconnected }` — `409` if the name is taken and the token doesn't match |
| `GET` | `/api/rooms/:id` | — | Room and config |
| `GET` | `/api/rooms/:id/leaderboard` | — | `{ leaderboard }` |
| `POST` | `/api/rooms/:id/submit` | `{ playerId, token, expr }` | `{ ok, submissionId }` — `409` with `duplicateOf` if already claimed |
| `POST` | `/api/rooms/:id/vote` | `{ playerId, token, submissionId, voteType: 'up' \| 'down' }` | `{ ok, votesRemaining }` |
| `POST` | `/api/rooms/:id/hint` | `{ playerId, token }` | `{ ok, hints }` |
| `GET` | `/ws?roomId=&playerId=&token=` | — | WebSocket upgrade |

### Admin

Send `Authorization: Bearer <ADMIN_PASSWORD>`. Room routes also accept the room's
own admin token (returned when the room is created), except delete.

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/admin/auth` | `{ password }` | Check the master password |
| `GET` | `/api/admin/puzzles` | — | Puzzle list, no solutions (no auth) |
| `POST` | `/api/rooms` | `{ name, ...settings }` | Create a room → `{ id, adminToken }` |
| `GET` | `/api/rooms/:id/admin/state` | — | Full room state plus the current answer and hints |
| `PATCH` | `/api/rooms/:id/admin/config` | snake_case settings | Change settings (not while a round is live) |
| `POST` | `/api/rooms/:id/admin/start-round` | `{ puzzleId }` | Start a round |
| `POST` | `/api/rooms/:id/admin/advance-phase` | — | End the live round now, or close the results |
| `POST` | `/api/rooms/:id/admin/end-game` | — | Finish the game |
| `POST` | `/api/rooms/:id/admin/players/:playerId/reset-login` | — | Clear a player's token and sign them out (WebSocket close `4001`) |
| `DELETE` | `/api/rooms/:id` | — | Delete the room and all its data (master password only) |

### WebSocket messages (server → client)

`FULL_STATE` on connect (everything needed to rebuild the screen, including results
if the round is settled), then `PLAYER_JOINED`, `PLAYER_UPDATED`, `PLAYER_LEFT`,
`PHASE_CHANGED`, `SUBMISSION_MADE`, `VOTE_UPDATE`, `ROUND_RESULTS`, `GAME_ENDED`,
`ROOM_DELETED`, `PONG`. Types are in `src/types.ts`.

---

## Running locally

Needs Node 18+.

```bash
# Worker
npm install
echo 'ADMIN_PASSWORD=pick-something' > .dev.vars   # gitignored
npm run db:migrate                                 # create tables in the local D1
npm run dev                                        # http://localhost:8787

# Frontend (second terminal)
cd frontend
npm install
npm run dev                                        # http://localhost:5173
```

Vite proxies `/api`, `/ws` and `/health` to the worker, so leave `VITE_BACKEND_URL` unset locally.
Open `/admin`, log in with the password from `.dev.vars`, create a room, and join it from another tab.

## Deploying

**Worker (Cloudflare)**

```bash
npx wrangler d1 create blackbox-leaderboard   # once; put the id in wrangler.toml
npm run db:migrate:remote                      # fresh database only
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

**Upgrading an existing database** — run each migration newer than the database, once, in order:

```bash
npm run db:migrate:0002:remote   # payouts and hints
npm run db:migrate:0003:remote   # player tokens
```

**Frontend (Vercel)** — root directory `frontend`, build `npm run build`, output `dist`.
Set `VITE_BACKEND_URL` to the worker URL (e.g. `https://blackbox-leaderboard.<you>.workers.dev`).
This is required: Vercel can't proxy WebSockets, so the browser talks to the worker directly.

---

## Puzzles

25 puzzles, 200 rows each, generated deterministically when the worker loads.
The solutions and hints live in `src/game/puzzles.ts` and are never sent to players.

| Difficulty | Puzzles |
|---|---|
| **Warm-up** | `line_01` Obedient Numbers · `line_02` The Reluctant Ascent · `square_01` The Bend in the Road · `sqrt_01` Momentum Decay · `log_01` The Compressed Universe · `distractor_01` Four Suspects (x1–x4) |
| **Tricky** | `almost_linear_01` The Imposter Line · `almost_linear_02` Static on the Signal · `reciprocal_01` Vanishing Point · `abs_01` The Symmetric Grudge · `cos_01` The Quarter-Turn · `periodic_01` The Repeating Rumour · `periodic_02` Seven Days of Nothing · `product_01` The Missing Third Variable (x1, x2) · `ratio_01` Speed Without Units (x1, x2) |
| **Boss** | `distance_01` The Displacement Field (x1, x2) · `cubic_01` Tripling the Problem · `boss_multi` The Hidden Tax (x1–x3) · `boss_sin_sum` Interfering Signals · `boss_multi_feat` Chaos in Three Channels (x1–x3) · `period_boss` The Noisy Calendar (x, noise_col) · `polynomial_01` The Bent Wire · `phase_01` The Hidden Angle · `exp_01` The Runaway Growth · `step_01` The Great Divide |

### Adding a puzzle

Add an entry to `PUZZLE_DEFS` in `src/game/puzzles.ts`:

```ts
{
  id: 'my_puzzle_01',
  title: 'The Swinging Ramp',
  description: 'A cryptic one-liner shown to players.',
  difficulty: 2,
  columns: ['x'],
  generate(rng, n) {
    const x = randUniform(rng, 0, 10, n)
    return { X: { x: clean(x) }, y: clean(x.map((v) => v * Math.sin(v))) }
  },
  solution: 'x sin(x)',            // same syntax players type; must reproduce y
  hints: ['Vaguest hint first.', 'More specific second hint.'],
}
```

Append new puzzles at the end: each puzzle's random seed comes from its position in
the list, so inserting one in the middle changes the data of every puzzle after it.

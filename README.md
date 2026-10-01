# f(x) market

A live web game for about 250 players. A hidden "black box" model turns inputs `x` into an output `y`. Players guess the features it uses and post them as formulas (`x^2`, `sin(x)`). Other players bet on each post with upvotes and downvotes, which cost coins. An admin judges each feature correct or wrong, the platform pays out, and the final wallet balance decides the leaderboard.

Runs on Cloudflare Workers with one Durable Object (SQLite) per game.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.dev.vars.example` to `.dev.vars` and set the key.
4. Run `npm run dev`.
5. Open `http://localhost:8787` for players and `http://localhost:8787/admin.html` for admin.
6. Deleting `.wrangler` resets local data.

`npm run check` type-checks the server code.

## Deploy

1. Use a Cloudflare account on the Workers Paid plan ($5/month).
2. Run `npx wrangler login`.
3. Run `npx wrangler secret put ADMIN_KEY`.
4. Run `npm run deploy`.
5. Optionally, add a custom domain in the dashboard.

To run a second game, change `GAME_NAME` in `wrangler.jsonc` and redeploy. The new name gets a new, empty game.

## Before the event

1. Set the rules.
2. Add players and download the codes.
3. Do a test round.
4. Download a backup.
5. Open the game.

## During the event

- Judge features as they come in.
- Run the money check now and then.

## Folder structure

```
prediction-game/
├── package.json          scripts: dev, deploy, check
├── tsconfig.json
├── wrangler.jsonc        Cloudflare config
├── .dev.vars.example     template for the local admin key
├── .gitignore
├── README.md             this guide
├── src/
│   ├── index.ts          front door Worker: routing, auth, calls Game RPC methods
│   ├── game.ts           Game Durable Object: all rules and money logic
│   ├── schema.ts         exports SCHEMA (the database tables)
│   ├── formula.ts        formula parser, sampler, similarity, usability check
│   └── types.ts          Env interface and Result<T> type
└── public/
    ├── index.html        player page
    ├── app.js            player page logic
    ├── admin.html        admin page
    ├── admin.js          admin page logic
    └── styles.css        shared styles
```

## How a request flows

```
browser (public/app.js)
   │  POST /api/votes { featureId: 42, direction: "up" }
   ▼
front door (src/index.ts)          reads Bearer token or admin key
   │  env.GAME.get(env.GAME.idFromName(env.GAME_NAME || "game-1")).vote(token, 42, "up")
   ▼
Game object (src/game.ts)          one request at a time, transactionSync
   │  reads and writes its own SQLite tables
   ▼
Result → JSON response → page re-renders
```

## Why there are no race conditions

- **One object.** All data for a game (players, features, votes, ledger) lives in a single Durable Object. A vote changes a wallet and a feature together, so they must be in the same place.
- **One request at a time.** A Durable Object handles its requests one after another.
- **No outside waits.** Every action is a synchronous method that only touches its own SQLite storage. There is no `await` in the middle of an action, so another request can never slip in halfway.
- **`transactionSync`.** Every action runs inside a transaction. If any check fails partway, every change it made is undone.
- **Tested.** The acceptance tests fire 20 identical votes at the same moment; exactly one succeeds.

On top of that, every coin that moves goes through one helper that also writes a ledger row, and the database refuses negative balances. The money check compares every balance with its ledger.

## Game rules

| Event | Who pays | Who gets paid |
|---|---|---|
| Player added | — | Player gets the starting balance ("starting balance") |
| Post a feature | Poster pays `poster_stake` | Held until judging |
| Vote | Voter pays the current price for that side | Held until judging |
| **Judged correct** | — | Poster: stake back + reward `y` set by the admin |
| | | Each upvoter: stake back + `floor(stake × upvote_reward_ratio)` |
| | Downvoters lose their stakes | …which all go to the poster ("paid by downvoters") |
| **Judged wrong** | Upvoters lose their stakes (kept by the platform) | |
| | Poster loses the stake | Each downvoter: stake back + `floor(stake × downvote_reward_ratio)`, paid out of the poster's stake. If the total owed is more than the stake, downvoters share the stake in proportion. The rest stays with the platform. |

Other rules:

- One vote per player per feature. You can't vote on your own feature.
- Each player has a limit on posts and votes.
- When a feature reaches the vote cap, voting closes and it waits for judging. Open and closed features can both be judged.
- With dynamic pricing on, `price = round(base × (1 + votes on that side / cap))`.
- The game starts paused. While paused, players can log in and look but can't post or vote.

## Formula syntax

- Inputs: `x` (same as `x1`), or `x1` … `xN` when the game has N inputs.
- Operators: `+ - * / ^` and brackets. `**` also works as `^`.
- Implicit multiplication: `2x`, `3sin(x)`, `(x+1)(x-1)`.
- `-x^2` means `-(x^2)`; `2^3^2` means `2^(3^2)`.
- Functions (always with brackets): `sin cos tan exp log ln sqrt abs`. `log` and `ln` are both the natural log.
- Constants: `pi`, `e`.
- Numbers: `3`, `0.5`, `1e-3`.
- Limits: 200 characters, 200 tree nodes.

Formulas are read by a hand-written parser. Nothing is ever passed to `eval`.

## Duplicate check

Every formula is evaluated on the same 200 test inputs (seeded random values between `input_min` and `input_max`). A formula is rejected if:

- it gives no valid value for most inputs (fewer than 30 usable values), or
- it gives the same value for every input, or
- the correlation between its values and any earlier feature's values is at or above `duplicate_threshold` (default 0.99), in either direction.

Correlation ignores multipliers and added constants, so `x^2`, `5x^2` and `x^2 + 7` all count as the same feature.

## Database tables

| Table | Holds |
|---|---|
| `settings` | One row with the game rules and whether the game is open |
| `players` | Name, login code, balance, posts and votes used |
| `sessions` | Login tokens |
| `features` | Posted formulas, their sample values, vote counts, prices, status and payout |
| `votes` | Who voted which way on what, and the price paid |
| `ledger` | Every coin movement, with a reason. Each balance equals the sum of that player's rows |
| `price_history` | Up/down prices over time for each feature |

## API

Player routes use `Authorization: Bearer <token>`. Admin routes use the header `x-admin-key`.

### Player routes

| Method | Path | Body |
|---|---|---|
| POST | `/api/login` | `{ code }` |
| GET | `/api/state` | |
| POST | `/api/features` | `{ formula }` |
| POST | `/api/votes` | `{ featureId, direction }` |
| GET | `/api/features/:id/history` | |

### Admin routes

| Method | Path | Body |
|---|---|---|
| GET | `/api/admin/settings` | |
| POST | `/api/admin/settings` | any settings keys |
| GET | `/api/admin/players` | |
| POST | `/api/admin/players` | `{ names: string[] }` |
| GET | `/api/admin/features` | |
| POST | `/api/admin/judge` | `{ featureId, correct: boolean, payoutY }` (only the literal `true` counts as correct) |
| GET | `/api/admin/audit` | |
| GET | `/api/admin/export` | |

Errors come back as `{ "error": "..." }` with a matching HTTP status.

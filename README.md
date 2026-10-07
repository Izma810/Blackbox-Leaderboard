# WhackaModel

A live prediction-market game about reverse-engineering hidden functions. Two-person teams look at a dataset, post the formula they think produced it, and stake coins on whether other teams' formulas are right. There are also image puzzles, where teams guess the filter pipeline that turned one image into another.

The rules, payouts and default settings are in [GAME_GUIDE.md](GAME_GUIDE.md). This README covers running and hosting it.

## How it's built

- **Cloudflare Workers + [Hono](https://hono.dev)** serve the API under `/api/*` and the React app for everything else.
- **One Durable Object, `GameRoomDO`**, runs the single game room (`idFromName('main')`) that everyone plays in. Every submission, vote, hint and admin action goes through it one at a time, which is what keeps wallets consistent. It also holds every team's WebSocket and pushes live updates.
- **D1** (SQLite) stores teams, batches, submissions, votes and the wallet log.
- **React + Vite + Tailwind** for the frontend, built by the Cloudflare Vite plugin.

```
src/
  index.ts                  Worker entry: /api routes and the WebSocket upgrade
  api/                      auth.ts (register, teammate link, reclaim), game.ts (submit, vote, hint), admin.ts
  durable-objects/          GameRoomDO.ts: the game room
  db/                       schema.sql, reset.sql, d1.ts query helpers
  game/                     puzzle definitions, formula judging, image puzzles
  lib/crypto.ts             session token generation and hashing
  client/                   React app: pages/Home, Join, Play, Admin, FinalLeaderboard
shared/                     validation and expression parsing used by both sides
```

## Logging in

There are no passwords.

- Registering creates a random secret token for the team. The browser keeps it in `localStorage`; the database stores only its SHA-256 hash.
- The second laptop signs in by opening the **teammate link**, `/join#<token>`. The token is in the `#` part of the URL, which browsers never send to the server.
- If a team loses the login on both laptops, the host clicks **Reset login** on the admin page. That clears the stored hash and signs out every laptop still using the old token. The team then uses **Reclaim team** on the home page with its team name and either member's entry number, which issues a new token. Reclaiming only works while a team is in that reset state, so do the reset with the team standing next to you.

## Running locally

```bash
npm install
echo "ADMIN_PASSWORD=pick-something" > .dev.vars
npm run db:migrate          # creates the tables in a local D1 database
npm run dev                 # http://localhost:5173, admin page at /admin
```

## Deploying

```bash
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npm run db:migrate:remote   # first deploy only
npm run deploy
```

## Changing the schema

There are no incremental migrations. To apply changes to `src/db/schema.sql`, drop everything and recreate it. **This deletes all teams and game data.**

```bash
npx wrangler d1 execute blackbox-leaderboard --remote --file=src/db/reset.sql
npm run db:migrate:remote
```

(Use `--local` and `npm run db:migrate` for your local database.)

## Type-checking

```bash
npx tsc --noEmit -p tsconfig.worker.json
npx tsc --noEmit -p tsconfig.client.json
```

`npm run build` runs both and then builds the app.

import { DurableObject } from "cloudflare:workers";
import { SCHEMA } from "./schema";
import { FormulaError, checkUsable, compileFormula, sampleValues, similarity } from "./formula";
import type { Env, Result } from "./types";

// A mistake the player or admin can fix. `status` becomes the HTTP status.
export class GameError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type SqlValue = string | number | null | ArrayBuffer;

type Settings = {
  id: number;
  starting_balance: number;
  max_posts_per_player: number;
  max_votes_per_player: number;
  vote_cap_per_feature: number;
  base_vote_price: number;
  poster_stake: number;
  upvote_reward_ratio: number;
  downvote_reward_ratio: number;
  dynamic_pricing: number;
  num_inputs: number;
  input_min: number;
  input_max: number;
  duplicate_threshold: number;
  status: "open" | "closed";
};

type Player = {
  id: number;
  name: string;
  login_code: string;
  balance: number;
  posts_used: number;
  votes_used: number;
  created_at: string;
};

type Feature = {
  id: number;
  poster_id: number;
  formula: string;
  sample_values: string;
  status: "open" | "closed" | "correct" | "wrong";
  up_count: number;
  down_count: number;
  up_price: number;
  down_price: number;
  poster_stake: number;
  payout_y: number | null;
  created_at: string;
  judged_at: string | null;
};

type Vote = {
  id: number;
  player_id: number;
  feature_id: number;
  direction: "up" | "down";
  price_paid: number;
  created_at: string;
};

type FeatureView = {
  id: number;
  formula: string;
  status: string;
  up_count: number;
  down_count: number;
  up_price: number;
  down_price: number;
  poster_stake: number;
  payout_y: number | null;
  created_at: string;
  judged_at: string | null;
  poster_id: number;
  poster_name: string;
  my_vote: "up" | "down" | null;
};

// Settings the admin may change, grouped by what values they accept.
const WHOLE_NUMBER_SETTINGS = [
  "starting_balance",
  "max_posts_per_player",
  "max_votes_per_player",
  "vote_cap_per_feature",
  "base_vote_price",
  "poster_stake",
  "dynamic_pricing",
  "num_inputs",
];
const RATIO_SETTINGS = ["upvote_reward_ratio", "downvote_reward_ratio", "duplicate_threshold"];
const ANY_NUMBER_SETTINGS = ["input_min", "input_max"];

// No 0/O or 1/I/L, so codes are easy to read aloud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 60;

function now(): string {
  return new Date().toISOString();
}

// All data for one game lives here. Durable Objects handle one request at a time, and every
// action below is synchronous and wrapped in a transaction, so two clicks can never interleave.
export class Game extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  // ---------- Small helpers ----------

  private all<T>(query: string, ...values: SqlValue[]): T[] {
    return this.sql.exec(query, ...values).toArray() as unknown as T[];
  }

  private one<T>(query: string, ...values: SqlValue[]): T | null {
    const rows = this.all<T>(query, ...values);
    return rows.length > 0 ? rows[0] : null;
  }

  private run(query: string, ...values: SqlValue[]): void {
    this.sql.exec(query, ...values);
  }

  // Runs an action as one transaction. If it throws, every change it made is undone.
  private safely<T>(action: () => T): Result<T> {
    try {
      const data = this.ctx.storage.transactionSync(action);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof GameError) return { ok: false, status: err.status, error: err.message };
      if (err instanceof FormulaError) return { ok: false, status: 400, error: err.message };
      console.error("Unexpected error in Game:", err);
      return { ok: false, status: 500, error: "Something went wrong on the server. Try again." };
    }
  }

  // The only way coins move. Writing a ledger row every time means balances can always be audited.
  private moveMoney(playerId: number, amount: number, reason: string, featureId: number | null): void {
    if (amount === 0) return;
    this.run("UPDATE players SET balance = balance + ? WHERE id = ?", amount, playerId);
    this.run(
      "INSERT INTO ledger (player_id, amount, reason, feature_id, created_at) VALUES (?, ?, ?, ?, ?)",
      playerId,
      amount,
      reason,
      featureId,
      now(),
    );
  }

  private settings(): Settings {
    return this.one<Settings>("SELECT * FROM settings WHERE id = 1")!;
  }

  private playerFromToken(token: string): Player {
    const player = this.one<Player>(
      "SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?",
      String(token ?? ""),
    );
    if (!player) throw new GameError(401, "Your session has ended. Log in again with your code.");
    return player;
  }

  private requireOpen(settings: Settings): void {
    if (settings.status !== "open") throw new GameError(403, "The game isn't open right now.");
  }

  private findFeature(featureId: number): Feature {
    const id = Number(featureId);
    const feature = Number.isInteger(id)
      ? this.one<Feature>("SELECT * FROM features WHERE id = ?", id)
      : null;
    if (!feature) throw new GameError(404, "That feature doesn't exist.");
    return feature;
  }

  // Features as players see them. `viewerId` fills in my_vote; 0 means "nobody" (admin view).
  private featureList(viewerId: number): FeatureView[] {
    return this.all<FeatureView>(
      `SELECT f.id, f.formula, f.status, f.up_count, f.down_count, f.up_price, f.down_price,
              f.poster_stake, f.payout_y, f.created_at, f.judged_at, f.poster_id,
              p.name AS poster_name, v.direction AS my_vote
         FROM features f
         JOIN players p ON p.id = f.poster_id
         LEFT JOIN votes v ON v.feature_id = f.id AND v.player_id = ?
        ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END, f.id DESC`,
      viewerId,
    );
  }

  // Equal balances share a rank: 1, 2, 2, 4.
  private leaderboard(): { id: number; name: string; balance: number; rank: number }[] {
    const rows = this.all<{ id: number; name: string; balance: number }>(
      "SELECT id, name, balance FROM players ORDER BY balance DESC, name ASC",
    );
    const ranked: { id: number; name: string; balance: number; rank: number }[] = [];
    rows.forEach((row, index) => {
      const previous = ranked[index - 1];
      const rank = previous && previous.balance === row.balance ? previous.rank : index + 1;
      ranked.push({ ...row, rank });
    });
    return ranked;
  }

  // ---------- Player methods ----------

  login(code: string): Result<{ token: string; name: string }> {
    return this.safely(() => {
      const cleaned = String(code ?? "").trim().toUpperCase();
      const player = this.one<Player>("SELECT * FROM players WHERE login_code = ?", cleaned);
      if (!player) {
        throw new GameError(401, "That code doesn't match any player. Check it and try again.");
      }
      const token = crypto.randomUUID();
      this.run(
        "INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, ?)",
        token,
        player.id,
        now(),
      );
      return { token, name: player.name };
    });
  }

  state(token: string) {
    return this.safely(() => {
      const me = this.playerFromToken(token);
      const s = this.settings();
      return {
        me: {
          id: me.id,
          name: me.name,
          balance: me.balance,
          postsLeft: Math.max(0, s.max_posts_per_player - me.posts_used),
          votesLeft: Math.max(0, s.max_votes_per_player - me.votes_used),
        },
        game: {
          status: s.status,
          startingBalance: s.starting_balance,
          posterStake: s.poster_stake,
          basePrice: s.base_vote_price,
          voteCap: s.vote_cap_per_feature,
          numInputs: s.num_inputs,
          maxPosts: s.max_posts_per_player,
          maxVotes: s.max_votes_per_player,
        },
        features: this.featureList(me.id),
        leaderboard: this.leaderboard(),
      };
    });
  }

  postFeature(token: string, formulaText: string): Result<{ id: number; balance: number }> {
    return this.safely(() => {
      const s = this.settings();
      this.requireOpen(s);
      const me = this.playerFromToken(token);

      if (me.posts_used >= s.max_posts_per_player) {
        throw new GameError(400, `You've used all ${s.max_posts_per_player} of your posts.`);
      }

      const text = String(formulaText ?? "").trim();
      const formula = compileFormula(text, s.num_inputs);
      const values = sampleValues(formula, s.num_inputs, s.input_min, s.input_max);
      checkUsable(values);
      this.rejectDuplicate(values, s.duplicate_threshold);

      const stake = s.poster_stake;
      if (me.balance < stake) {
        throw new GameError(400, `Posting needs ${stake} coins and you have ${me.balance}.`);
      }

      const createdAt = now();
      const inserted = this.one<{ id: number }>(
        `INSERT INTO features (poster_id, formula, sample_values, up_price, down_price, poster_stake, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        me.id,
        text,
        JSON.stringify(values),
        s.base_vote_price,
        s.base_vote_price,
        stake,
        createdAt,
      )!;
      this.moveMoney(me.id, -stake, "poster stake", inserted.id);
      this.run("UPDATE players SET posts_used = posts_used + 1 WHERE id = ?", me.id);
      this.run(
        "INSERT INTO price_history (feature_id, up_price, down_price, recorded_at) VALUES (?, ?, ?, ?)",
        inserted.id,
        s.base_vote_price,
        s.base_vote_price,
        createdAt,
      );

      return { id: inserted.id, balance: me.balance - stake };
    });
  }

  // Compared against every feature ever posted, judged or not.
  private rejectDuplicate(values: (number | null)[], threshold: number): void {
    const existing = this.all<{ id: number; formula: string; sample_values: string }>(
      "SELECT id, formula, sample_values FROM features ORDER BY id",
    );
    for (const feature of existing) {
      const score = similarity(values, JSON.parse(feature.sample_values));
      if (score !== null && Math.abs(score) >= threshold) {
        throw new GameError(
          409,
          `Too similar to feature #${feature.id} (${feature.formula}), which is already posted.`,
        );
      }
    }
  }

  vote(token: string, featureId: number, direction: string): Result<{ balance: number }> {
    return this.safely(() => {
      const s = this.settings();
      this.requireOpen(s);
      const me = this.playerFromToken(token);

      if (direction !== "up" && direction !== "down") throw new GameError(400, "Vote up or down.");
      const feature = this.findFeature(featureId);
      if (feature.status !== "open") throw new GameError(409, "Voting on this feature has closed.");
      if (feature.poster_id === me.id) throw new GameError(400, "You can't vote on your own feature.");
      if (me.votes_used >= s.max_votes_per_player) {
        throw new GameError(400, `You've used all ${s.max_votes_per_player} of your votes.`);
      }
      const earlier = this.one<Vote>(
        "SELECT * FROM votes WHERE player_id = ? AND feature_id = ?",
        me.id,
        feature.id,
      );
      if (earlier) throw new GameError(409, "You've already voted on this feature.");

      const price = direction === "up" ? feature.up_price : feature.down_price;
      if (me.balance < price) {
        throw new GameError(400, `This vote costs ${price} coins and you have ${me.balance}.`);
      }

      this.moveMoney(me.id, -price, `${direction}vote stake`, feature.id);
      this.run(
        "INSERT INTO votes (player_id, feature_id, direction, price_paid, created_at) VALUES (?, ?, ?, ?, ?)",
        me.id,
        feature.id,
        direction,
        price,
        now(),
      );
      this.run("UPDATE players SET votes_used = votes_used + 1 WHERE id = ?", me.id);

      const upCount = feature.up_count + (direction === "up" ? 1 : 0);
      const downCount = feature.down_count + (direction === "down" ? 1 : 0);
      this.run("UPDATE features SET up_count = ?, down_count = ? WHERE id = ?", upCount, downCount, feature.id);

      if (s.dynamic_pricing === 1) {
        this.updatePrices(feature, upCount, downCount, s);
      }
      if (upCount + downCount >= s.vote_cap_per_feature) {
        this.run("UPDATE features SET status = 'closed' WHERE id = ?", feature.id);
      }

      return { balance: me.balance - price };
    });
  }

  // The more votes a side has, the more the next vote on that side costs.
  private updatePrices(feature: Feature, upCount: number, downCount: number, s: Settings): void {
    const cap = Math.max(1, s.vote_cap_per_feature);
    const upPrice = Math.round(s.base_vote_price * (1 + upCount / cap));
    const downPrice = Math.round(s.base_vote_price * (1 + downCount / cap));
    if (upPrice === feature.up_price && downPrice === feature.down_price) return;

    this.run("UPDATE features SET up_price = ?, down_price = ? WHERE id = ?", upPrice, downPrice, feature.id);
    this.run(
      "INSERT INTO price_history (feature_id, up_price, down_price, recorded_at) VALUES (?, ?, ?, ?)",
      feature.id,
      upPrice,
      downPrice,
      now(),
    );
  }

  priceHistory(featureId: number) {
    return this.safely(() => {
      const feature = this.findFeature(featureId);
      return this.all<{ up_price: number; down_price: number; recorded_at: string }>(
        "SELECT up_price, down_price, recorded_at FROM price_history WHERE feature_id = ? ORDER BY id",
        feature.id,
      );
    });
  }

  // ---------- Admin methods ----------

  adminSettings(): Result<Settings> {
    return this.safely(() => this.settings());
  }

  updateSettings(changes: Record<string, unknown>): Result<Settings> {
    return this.safely(() => {
      const current = this.settings();
      const entries = changes && typeof changes === "object" ? Object.entries(changes) : [];

      for (const [key, raw] of entries) {
        if (key === "status") {
          if (raw !== "open" && raw !== "closed") throw new GameError(400, "status must be open or closed.");
          this.run("UPDATE settings SET status = ? WHERE id = 1", raw);
          continue;
        }
        const value = this.validSettingValue(key, raw);
        if (key === "starting_balance" && value !== current.starting_balance) {
          const players = this.one<{ n: number }>("SELECT COUNT(*) AS n FROM players")!;
          if (players.n > 0) {
            throw new GameError(409, "Starting balance can't change after players have been added.");
          }
        }
        // `key` is safe to put in the SQL: validSettingValue only accepts names from the lists above.
        this.run(`UPDATE settings SET ${key} = ? WHERE id = 1`, value);
      }

      const updated = this.settings();
      if (updated.input_min >= updated.input_max) {
        throw new GameError(400, "input_min must be below input_max.");
      }
      return updated;
    });
  }

  private validSettingValue(key: string, raw: unknown): number {
    const known =
      WHOLE_NUMBER_SETTINGS.includes(key) || RATIO_SETTINGS.includes(key) || ANY_NUMBER_SETTINGS.includes(key);
    if (!known) throw new GameError(400, `"${key}" isn't a setting.`);

    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new GameError(400, `${key} must be a number.`);
    }
    if (WHOLE_NUMBER_SETTINGS.includes(key) && (!Number.isInteger(value) || value < 0)) {
      throw new GameError(400, `${key} must be a whole number, 0 or more.`);
    }
    if (RATIO_SETTINGS.includes(key) && value < 0) {
      throw new GameError(400, `${key} can't be negative.`);
    }
    if (key === "num_inputs" && (value < 1 || value > 9)) {
      throw new GameError(400, "num_inputs must be between 1 and 9.");
    }
    return value;
  }

  addPlayers(names: string[]): Result<{ name: string; code: string }[]> {
    return this.safely(() => {
      if (!Array.isArray(names)) throw new GameError(400, "Send a list of names.");
      const s = this.settings();
      const added: { name: string; code: string }[] = [];

      for (const rawName of names) {
        const name = String(rawName ?? "").trim();
        if (name === "") continue;
        if (name.length > MAX_NAME_LENGTH) {
          throw new GameError(400, `Names can be at most ${MAX_NAME_LENGTH} characters: "${name}".`);
        }
        if (this.one("SELECT id FROM players WHERE name = ?", name)) {
          throw new GameError(409, `A player named "${name}" already exists.`);
        }

        const code = this.newLoginCode();
        const inserted = this.one<{ id: number }>(
          "INSERT INTO players (name, login_code, balance, created_at) VALUES (?, ?, 0, ?) RETURNING id",
          name,
          code,
          now(),
        )!;
        // Start at 0 and pay the starting balance through the ledger, so the ledger explains every coin.
        this.moveMoney(inserted.id, s.starting_balance, "starting balance", null);
        added.push({ name, code });
      }
      return added;
    });
  }

  private newLoginCode(): string {
    for (;;) {
      const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
      let code = "";
      for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (!this.one("SELECT id FROM players WHERE login_code = ?", code)) return code;
    }
  }

  listPlayers() {
    return this.safely(() =>
      this.all<Pick<Player, "id" | "name" | "login_code" | "balance" | "posts_used" | "votes_used">>(
        "SELECT id, name, login_code, balance, posts_used, votes_used FROM players ORDER BY name",
      ),
    );
  }

  adminFeatures(): Result<FeatureView[]> {
    return this.safely(() => this.featureList(0));
  }

  judge(featureId: number, correct: boolean, payoutY: number) {
    return this.safely(() => {
      const feature = this.findFeature(featureId);
      if (feature.status === "correct" || feature.status === "wrong") {
        throw new GameError(409, `Feature #${feature.id} has already been judged ${feature.status}.`);
      }

      const s = this.settings();
      const votes = this.all<Vote>("SELECT * FROM votes WHERE feature_id = ? ORDER BY id", feature.id);
      const upvotes = votes.filter((v) => v.direction === "up");
      const downvotes = votes.filter((v) => v.direction === "down");

      let y: number | null = null;
      if (correct) {
        y = Math.floor(Number(payoutY));
        if (!Number.isFinite(y) || y < 0) throw new GameError(400, "Payout must be 0 or more.");
        this.payCorrect(feature, y, upvotes, downvotes, s);
      } else {
        this.payWrong(feature, downvotes, s);
      }

      const status = correct ? "correct" : "wrong";
      this.run(
        "UPDATE features SET status = ?, payout_y = ?, judged_at = ? WHERE id = ?",
        status,
        y,
        now(),
        feature.id,
      );
      return { id: feature.id, status, upvoters: upvotes.length, downvoters: downvotes.length };
    });
  }

  // Correct: poster and upvoters win. Downvoters' stakes go to the poster.
  private payCorrect(feature: Feature, y: number, upvotes: Vote[], downvotes: Vote[], s: Settings): void {
    this.moveMoney(feature.poster_id, feature.poster_stake, "poster stake returned", feature.id);
    this.moveMoney(feature.poster_id, y, "poster reward", feature.id);

    for (const vote of upvotes) {
      const reward = Math.floor(vote.price_paid * s.upvote_reward_ratio);
      this.moveMoney(vote.player_id, vote.price_paid, "upvote stake returned", feature.id);
      this.moveMoney(vote.player_id, reward, "upvote reward", feature.id);
    }

    let downvoteStakes = 0;
    for (const vote of downvotes) downvoteStakes += vote.price_paid;
    this.moveMoney(feature.poster_id, downvoteStakes, "paid by downvoters", feature.id);
  }

  // Wrong: downvoters win, paid out of the poster's stake. Upvoters and the poster lose their stakes.
  private payWrong(feature: Feature, downvotes: Vote[], s: Settings): void {
    let totalOwed = 0;
    const owed = downvotes.map((vote) => {
      const amount = Math.floor(vote.price_paid * s.downvote_reward_ratio);
      totalOwed += amount;
      return amount;
    });

    // The poster's stake is the most downvoters can win; if they're owed more, they share it.
    const share = totalOwed > feature.poster_stake ? feature.poster_stake / totalOwed : 1;

    downvotes.forEach((vote, i) => {
      this.moveMoney(vote.player_id, vote.price_paid, "downvote stake returned", feature.id);
      this.moveMoney(vote.player_id, Math.floor(owed[i] * share), "paid by poster", feature.id);
    });
  }

  audit() {
    return this.safely(() => {
      const s = this.settings();
      const players = this.all<{ id: number; name: string; balance: number; ledger_total: number }>(
        `SELECT p.id, p.name, p.balance, COALESCE(SUM(l.amount), 0) AS ledger_total
           FROM players p LEFT JOIN ledger l ON l.player_id = p.id
          GROUP BY p.id ORDER BY p.name`,
      );
      const mismatches = players.filter((p) => p.balance !== p.ledger_total);

      let totalBalance = 0;
      for (const p of players) totalBalance += p.balance;
      const totalStarting = players.length * s.starting_balance;

      // Coins currently locked in features that haven't been judged yet.
      const stakes = this.one<{ total: number }>(
        "SELECT COALESCE(SUM(poster_stake), 0) AS total FROM features WHERE status IN ('open', 'closed')",
      )!;
      const voteStakes = this.one<{ total: number }>(
        `SELECT COALESCE(SUM(v.price_paid), 0) AS total
           FROM votes v JOIN features f ON f.id = v.feature_id
          WHERE f.status IN ('open', 'closed')`,
      )!;
      const heldInEscrow = stakes.total + voteStakes.total;

      return {
        allCorrect: mismatches.length === 0,
        mismatches,
        players,
        totalBalance,
        totalStarting,
        heldInEscrow,
        platformNet: totalStarting - totalBalance - heldInEscrow,
      };
    });
  }

  exportAll() {
    return this.safely(() => ({
      exportedAt: now(),
      settings: this.settings(),
      players: this.all<Player>("SELECT * FROM players ORDER BY id"),
      features: this.all<Omit<Feature, "sample_values">>(
        `SELECT id, poster_id, formula, status, up_count, down_count, up_price, down_price,
                poster_stake, payout_y, created_at, judged_at
           FROM features ORDER BY id`,
      ),
      votes: this.all<Vote>("SELECT * FROM votes ORDER BY id"),
      ledger: this.all("SELECT * FROM ledger ORDER BY id"),
      price_history: this.all("SELECT * FROM price_history ORDER BY id"),
    }));
  }
}

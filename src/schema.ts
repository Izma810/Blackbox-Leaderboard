// The whole database for one game. Every statement is "IF NOT EXISTS" / "OR IGNORE",
// so running this on every start is safe and never wipes data.
export const SCHEMA = `
-- One row only (id = 1): the rules of this game.
CREATE TABLE IF NOT EXISTS settings (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  starting_balance       INTEGER NOT NULL DEFAULT 1000,  -- coins each player starts with
  max_posts_per_player   INTEGER NOT NULL DEFAULT 5,
  max_votes_per_player   INTEGER NOT NULL DEFAULT 30,
  vote_cap_per_feature   INTEGER NOT NULL DEFAULT 50,    -- voting closes once a feature has this many votes
  base_vote_price        INTEGER NOT NULL DEFAULT 10,
  poster_stake           INTEGER NOT NULL DEFAULT 100,   -- coins a poster puts at risk per feature
  upvote_reward_ratio    REAL    NOT NULL DEFAULT 1.0,   -- reward for a right upvote, as a multiple of its price
  downvote_reward_ratio  REAL    NOT NULL DEFAULT 1.0,   -- reward for a right downvote, as a multiple of its price
  dynamic_pricing        INTEGER NOT NULL DEFAULT 0,     -- 1 = prices rise as a side gets more votes
  num_inputs             INTEGER NOT NULL DEFAULT 1,     -- how many inputs (x1..xN) the black box takes
  input_min              REAL    NOT NULL DEFAULT -10,   -- range of test inputs for the duplicate check
  input_max              REAL    NOT NULL DEFAULT 10,
  duplicate_threshold    REAL    NOT NULL DEFAULT 0.99,  -- |correlation| at or above this counts as a duplicate
  status                 TEXT    NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed'))
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  login_code  TEXT    NOT NULL UNIQUE,             -- the 6-character code a player logs in with
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),  -- the database itself refuses negative wallets
  posts_used  INTEGER NOT NULL DEFAULT 0,
  votes_used  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT    PRIMARY KEY,                 -- random id kept in the player's browser
  player_id   INTEGER NOT NULL REFERENCES players(id),
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  poster_id      INTEGER NOT NULL REFERENCES players(id),
  formula        TEXT    NOT NULL,
  sample_values  TEXT    NOT NULL,                 -- JSON list of outputs on the shared test inputs (for duplicates)
  status         TEXT    NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'closed', 'correct', 'wrong')),  -- closed = vote cap reached, not judged yet
  up_count       INTEGER NOT NULL DEFAULT 0,
  down_count     INTEGER NOT NULL DEFAULT 0,
  up_price       INTEGER NOT NULL,                 -- current price of the next upvote
  down_price     INTEGER NOT NULL,
  poster_stake   INTEGER NOT NULL,                 -- copied from settings at posting time
  payout_y       INTEGER,                          -- poster's reward; set only when judged correct
  created_at     TEXT    NOT NULL,
  judged_at      TEXT
);

CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id),
  feature_id  INTEGER NOT NULL REFERENCES features(id),
  direction   TEXT    NOT NULL CHECK (direction IN ('up', 'down')),
  price_paid  INTEGER NOT NULL,                    -- the stake; payouts are based on this
  created_at  TEXT    NOT NULL,
  UNIQUE (player_id, feature_id)                   -- one vote per player per feature
);
CREATE INDEX IF NOT EXISTS votes_by_feature ON votes(feature_id);

-- Every coin that moves gets a row here, so balance always equals the sum of a player's rows.
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id),
  amount      INTEGER NOT NULL,                    -- positive = coins in, negative = coins out
  reason      TEXT    NOT NULL,
  feature_id  INTEGER REFERENCES features(id),     -- NULL for things like the starting balance
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_by_player ON ledger(player_id);

CREATE TABLE IF NOT EXISTS price_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id   INTEGER NOT NULL REFERENCES features(id),
  up_price     INTEGER NOT NULL,
  down_price   INTEGER NOT NULL,
  recorded_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS history_by_feature ON price_history(feature_id);
`;

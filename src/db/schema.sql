-- ─────────────────────────────────────────────
-- ROOMS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL,
  admin_token       TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL DEFAULT 'lobby',
  max_rounds        INTEGER,
  starting_wallet   INTEGER NOT NULL DEFAULT 1000,
  phase1_secs       INTEGER NOT NULL DEFAULT 300,
  phase2_secs       INTEGER NOT NULL DEFAULT 180,   -- unused since posting and voting merged
  poster_reward     INTEGER NOT NULL DEFAULT 100,   -- post stake
  voter_reward      INTEGER NOT NULL DEFAULT 50,    -- vote stake
  post_payout       INTEGER NOT NULL DEFAULT 100,   -- bank pays a right poster
  back_payout       INTEGER NOT NULL DEFAULT 120,   -- bank pays a right backer (> post_payout)
  hint_cost         INTEGER NOT NULL DEFAULT 40,
  votes_per_round   INTEGER NOT NULL DEFAULT 3,
  anonymous_voting  INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);

-- ─────────────────────────────────────────────
-- PLAYERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id            TEXT    PRIMARY KEY,
  room_id       TEXT    NOT NULL REFERENCES rooms(id),
  username      TEXT    NOT NULL,
  wallet        INTEGER NOT NULL,
  total_score   INTEGER NOT NULL DEFAULT 0,
  is_connected  INTEGER NOT NULL DEFAULT 0,
  joined_at     INTEGER NOT NULL,
  UNIQUE(room_id, username)
);

-- ─────────────────────────────────────────────
-- ROUNDS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rounds (
  id            TEXT    PRIMARY KEY,
  room_id       TEXT    NOT NULL REFERENCES rooms(id),
  round_number  INTEGER NOT NULL,
  puzzle_id     TEXT    NOT NULL,
  phase         TEXT    NOT NULL DEFAULT 'submission',
  phase_ends_at INTEGER,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  UNIQUE(room_id, round_number)
);

-- Players who were present when round started (only they may submit)
CREATE TABLE IF NOT EXISTS round_players (
  round_id  TEXT NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY(round_id, player_id)
);

-- ─────────────────────────────────────────────
-- SUBMISSIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT    PRIMARY KEY,
  round_id      TEXT    NOT NULL REFERENCES rounds(id),
  player_id     TEXT    NOT NULL REFERENCES players(id),
  features_json TEXT    NOT NULL,                   -- the formula as typed
  r2_score      REAL,
  base_score    INTEGER NOT NULL DEFAULT 0,
  is_correct    INTEGER NOT NULL DEFAULT 0,
  submitted_at  INTEGER NOT NULL,
  UNIQUE(round_id, player_id)
);

-- ─────────────────────────────────────────────
-- VOTES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  id            TEXT    PRIMARY KEY,
  round_id      TEXT    NOT NULL REFERENCES rounds(id),
  submission_id TEXT    NOT NULL REFERENCES submissions(id),
  voter_id      TEXT    NOT NULL REFERENCES players(id),
  vote_type     TEXT    NOT NULL CHECK(vote_type IN ('up', 'down')),
  voted_at      INTEGER NOT NULL,
  UNIQUE(round_id, voter_id, submission_id)
);

-- ─────────────────────────────────────────────
-- WALLET TRANSACTIONS (audit log)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id          TEXT    PRIMARY KEY,
  player_id   TEXT    NOT NULL REFERENCES players(id),
  round_id    TEXT,
  type        TEXT    NOT NULL,
  delta       INTEGER NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_players_room      ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_room       ON rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_round_players     ON round_players(round_id);
CREATE INDEX IF NOT EXISTS idx_submissions_round ON submissions(round_id);
CREATE INDEX IF NOT EXISTS idx_votes_round       ON votes(round_id);
CREATE INDEX IF NOT EXISTS idx_votes_submission  ON votes(submission_id);
CREATE INDEX IF NOT EXISTS idx_txn_player        ON wallet_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_txn_round         ON wallet_transactions(round_id);

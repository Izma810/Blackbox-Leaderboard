-- ─────────────────────────────────────────────
-- GAME CONFIG  (singleton row, id always = 1)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_config (
  id               INTEGER PRIMARY KEY CHECK(id = 1),
  status           TEXT    NOT NULL DEFAULT 'lobby',    -- lobby | active | finished
  starting_wallet  INTEGER NOT NULL DEFAULT 1000,
  post_stake       INTEGER NOT NULL DEFAULT 100,
  post_payout      INTEGER NOT NULL DEFAULT 100,
  vote_stake       INTEGER NOT NULL DEFAULT 50,
  back_payout      INTEGER NOT NULL DEFAULT 120,        -- must always > post_payout
  hint_cost        INTEGER NOT NULL DEFAULT 40,
  vote_budget      INTEGER NOT NULL DEFAULT 10,         -- total votes per team for the whole game
  anonymous_voting INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO game_config (id) VALUES (1);

-- ─────────────────────────────────────────────
-- TEAMS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id            TEXT    PRIMARY KEY,
  login_id      TEXT    NOT NULL UNIQUE,
  passcode_hash TEXT    NOT NULL,
  passcode_salt TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  name_lower    TEXT    NOT NULL UNIQUE,
  wallet        INTEGER NOT NULL,
  total_score   INTEGER NOT NULL DEFAULT 0,
  is_connected  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- ─────────────────────────────────────────────
-- TEAM MEMBERS  (exactly 2 per team)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id            TEXT    PRIMARY KEY,
  team_id       TEXT    NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  entry_number  TEXT    NOT NULL UNIQUE,
  hostel        TEXT    NOT NULL,
  slot          INTEGER NOT NULL CHECK(slot IN (1, 2)),
  UNIQUE(team_id, slot)
);

-- ─────────────────────────────────────────────
-- BATCHES  (3 fixed rows — easy / intermediate / advanced)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batches (
  id               TEXT    PRIMARY KEY,            -- 'easy' | 'intermediate' | 'advanced'
  status           TEXT    NOT NULL DEFAULT 'hidden', -- hidden | open | settled
  submissions_open INTEGER NOT NULL DEFAULT 1,
  voting_open      INTEGER NOT NULL DEFAULT 1,
  opened_at        INTEGER,
  settled_at       INTEGER
);
INSERT OR IGNORE INTO batches (id) VALUES ('easy');
INSERT OR IGNORE INTO batches (id) VALUES ('intermediate');
INSERT OR IGNORE INTO batches (id) VALUES ('image');

-- ─────────────────────────────────────────────
-- SUBMISSIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT    PRIMARY KEY,
  puzzle_id     TEXT    NOT NULL,
  batch_id      TEXT    NOT NULL REFERENCES batches(id),
  team_id       TEXT    NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  expr          TEXT    NOT NULL,
  stake         INTEGER NOT NULL,               -- coins paid at submission time
  r2_score      REAL,                           -- filled on settlement
  verdict       TEXT,                           -- 'right' | 'close' | 'wrong' | null (null = not settled)
  submitted_at  INTEGER NOT NULL,
  UNIQUE(puzzle_id, team_id)
);

-- ─────────────────────────────────────────────
-- VOTES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  id              TEXT    PRIMARY KEY,
  puzzle_id       TEXT    NOT NULL,
  batch_id        TEXT    NOT NULL REFERENCES batches(id),
  submission_id   TEXT    NOT NULL REFERENCES submissions(id),
  voter_team_id   TEXT    NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  vote_type       TEXT    NOT NULL CHECK(vote_type IN ('up', 'down')),
  stake           INTEGER NOT NULL,             -- coins paid at vote time
  voted_at        INTEGER NOT NULL,
  UNIQUE(voter_team_id, submission_id)
);

-- ─────────────────────────────────────────────
-- WALLET TRANSACTIONS  (audit log)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id         TEXT    PRIMARY KEY,
  team_id    TEXT    NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  batch_id   TEXT,
  puzzle_id  TEXT,
  type       TEXT    NOT NULL,
  delta      INTEGER NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_teams_login      ON teams(login_id);
CREATE INDEX IF NOT EXISTS idx_members_team     ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_subs_puzzle      ON submissions(puzzle_id);
CREATE INDEX IF NOT EXISTS idx_subs_team        ON submissions(team_id);
CREATE INDEX IF NOT EXISTS idx_subs_batch       ON submissions(batch_id);
CREATE INDEX IF NOT EXISTS idx_votes_sub        ON votes(submission_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter      ON votes(voter_team_id);
CREATE INDEX IF NOT EXISTS idx_txn_team         ON wallet_transactions(team_id);
CREATE INDEX IF NOT EXISTS idx_txn_batch        ON wallet_transactions(batch_id);

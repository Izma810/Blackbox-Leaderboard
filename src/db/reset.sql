-- Drop old tables (order matters for foreign keys)
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS round_players;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS rooms;
-- Drop new tables (clean slate)
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS batches;
DROP TABLE IF EXISTS game_config;

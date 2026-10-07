-- For databases created before player tokens existed.
-- Fresh databases get this column from schema.sql — don't run this on them.
-- Existing players have no token yet; the next join with their username claims it.
ALTER TABLE players ADD COLUMN token TEXT;

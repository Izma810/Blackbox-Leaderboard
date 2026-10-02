-- For databases created before payouts and hints existed.
-- Fresh databases get these columns from schema.sql — don't run this on them.
ALTER TABLE rooms ADD COLUMN post_payout INTEGER NOT NULL DEFAULT 100;
ALTER TABLE rooms ADD COLUMN back_payout INTEGER NOT NULL DEFAULT 120;
ALTER TABLE rooms ADD COLUMN hint_cost   INTEGER NOT NULL DEFAULT 40;

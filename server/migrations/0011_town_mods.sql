-- 0011: supply shocks (docs/shopkeeper-economy.md Phase 3).
-- Apply with: wrangler d1 execute taiao --remote --file=migrations/0011_town_mods.sql
-- (NEVER `d1 migrations apply` in this repo — tracking table unseeded.)
-- The worker fails soft while this table is absent (no mods = calm world),
-- so deploy order doesn't matter.

-- One active shock per (town, tag): the daily cron rolls them on towns that
-- actually trade, /api/admin/shopevent writes story events by hand. The
-- price effects EMERGE in econ-core (shrunken floor + hotter demand), never
-- get scripted directly, and die when expires_at passes or when player
-- imports refill the shelf.
CREATE TABLE IF NOT EXISTS town_mods (
  town        TEXT NOT NULL,
  tag         TEXT NOT NULL,        -- item tag (client itemTag keyspace)
  kind        TEXT NOT NULL,        -- flavour id: caravan_cut, mine_trouble,
                                    -- blight, bumper, surplus_barge, ...
  floor_mult  REAL NOT NULL DEFAULT 1,  -- scales the standing-floor SHELF
  demand_mult REAL NOT NULL DEFAULT 1,  -- scales believed baseline demand
  started_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (town, tag)
);

-- 0010: the living till (docs/shopkeeper-economy.md Phase 1).
-- Apply with: wrangler d1 execute taiao --remote --file=migrations/0010_shop_economy.sql
-- (NEVER `d1 migrations apply` in this repo — tracking table unseeded.)

-- One till per town (Phase 2 may split per shop type — hence the shop
-- column, 'town' for now). Seeded on first trade with EconCore.operatingCash
-- so the worker and every client agree on the number.
CREATE TABLE IF NOT EXISTS shop_till (
  town        TEXT NOT NULL,
  shop        TEXT NOT NULL DEFAULT 'town',
  cash        INTEGER NOT NULL,
  operating   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (town, shop)
);

-- Lazily-decayed demand/supply beliefs per (town, item). Rows exist only
-- once players trade that item there; prices are NEVER stored, always
-- computed (shared/econ-core.js).
CREATE TABLE IF NOT EXISTS shop_flow (
  town        TEXT NOT NULL,
  item        TEXT NOT NULL,
  ema_in      REAL NOT NULL DEFAULT 0,   -- units/day players sell to the town
  ema_out     REAL NOT NULL DEFAULT 0,   -- units/day players buy from it
  day_in      INTEGER NOT NULL DEFAULT 0, -- today's raw flow (belief caps)
  day_out     INTEGER NOT NULL DEFAULT 0,
  day_start   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (town, item)
);

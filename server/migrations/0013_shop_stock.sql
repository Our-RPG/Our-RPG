-- 0013: the finite shopkeeper shelf (docs/shopkeeper-economy.md §20).
-- Apply with: wrangler d1 execute taiao --remote --file=migrations/0013_shop_stock.sql
-- (NEVER `d1 migrations apply` in this repo — tracking table unseeded.)
--
-- ONE stock count per (town, item): the shopkeeper's own opening inventory
-- plus everything players have sold in. This is the single number the buy AND
-- sell price move along, so a buy-then-sell round trip returns it — and the
-- price — to exactly where it started. Seeded ONCE, deterministically
-- (EconCore.openingStock, so client and worker agree sight unseen); thereafter
-- it only moves on real trades (purchases deplete, player sells replenish) and
-- NOTHING auto-restocks it — row existence means "already seeded", so a
-- bought-out item stays at 0 until a player sells more. Not swept by the stale
-- cron: an item's depleted/overstocked state is meant to persist.
CREATE TABLE IF NOT EXISTS shop_stock (
  town        TEXT NOT NULL,                        -- client townKeyOf "cx,cy"
  item        TEXT NOT NULL,
  qty         INTEGER NOT NULL,                      -- units on the shelf (>= 0)
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (town, item)
);

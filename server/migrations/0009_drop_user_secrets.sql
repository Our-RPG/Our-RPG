-- Migration 0009 — drop the server-side PixelLab key store (revert of Phase 8).
-- The Workshop briefly stored each player's PixelLab key (encrypted) so the
-- server could generate on their behalf. We reverted that: the key now lives
-- ONLY in the browser (the security-preserving choice). This migration removes
-- the key store, purging any keys that were saved during that window.
--
-- The gen_jobs.driver column added at the same time is left in place — it's a
-- harmless unused column and dropping it isn't worth the risk.
--
-- Run ONCE against the deployed database, and also delete the now-unused secret:
--   wrangler d1 execute taiao --remote --file=migrations/0009_drop_user_secrets.sql
--   wrangler secret delete PIXELLAB_ENC_KEY

DROP TABLE IF EXISTS user_secrets;

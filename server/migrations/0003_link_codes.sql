-- Migration 0003 — one-time Workshop sign-in codes (Phase 5).
-- The Workshop site is a different origin from the game (itch or a local
-- file host), so localStorage session tokens can't cross over. A logged-in
-- player mints a short code in-game (POST /api/link/code); pasting it into
-- the Workshop's sign-in form redeems it for a real session
-- (POST /api/link/redeem) — no password needed there. Fresh installs get
-- this from schema.sql; run this ONCE against an already-deployed database:
--
--   wrangler d1 execute taiao --file=migrations/0003_link_codes.sql          # local
--   wrangler d1 execute taiao --remote --file=migrations/0003_link_codes.sql # prod
--
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS link_codes (
  code_hash   TEXT PRIMARY KEY,                      -- sha256hex of the code
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

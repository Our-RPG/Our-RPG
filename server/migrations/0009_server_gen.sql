-- Migration 0009 — server-side sprite generation (Phase 8).
-- The Workshop's PixelLab pipeline moves from the browser to the server: the
-- player stores their PixelLab key here (encrypted), and the server drives the
-- whole generation — create, poll, download art, add to the gallery — so a
-- sprite finishes and syncs to the player's gallery even if the tab is closed,
-- and shows up wherever they next log in.
--
-- 1. user_secrets — the player's PixelLab key, AES-GCM encrypted with the
--    PIXELLAB_ENC_KEY worker secret. Plaintext is never stored and never
--    returned to the client (only a "set / not set" + masked hint).
-- 2. gen_jobs.driver — 'server' rows are advanced by the every-minute cron
--    poller; legacy 'client' rows (older browser-driven jobs) are left alone.
--
-- Run ONCE against an already-deployed database (ALTER has no IF NOT EXISTS):
--   wrangler d1 execute taiao --remote --file=migrations/0009_server_gen.sql
-- Also set the encryption secret once:
--   wrangler secret put PIXELLAB_ENC_KEY   # a base64 32-byte random value

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id),
  pixellab_key_enc TEXT,                     -- "base64(iv):base64(ciphertext)"; null once cleared
  updated_at       INTEGER NOT NULL
);

ALTER TABLE gen_jobs ADD COLUMN driver TEXT NOT NULL DEFAULT 'client';   -- 'server' = cron-driven pipeline

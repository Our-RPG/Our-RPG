-- Migration 0004 — server-tracked PixelLab generation jobs (Phase 6).
-- The Workshop's "generate a sprite" flow used to live entirely in one open
-- browser tab: a hard refresh mid-generation lost the card and any PixelLab
-- job id needed to resume it. This table is a lightweight, durable status
-- board — the client (BYO PixelLab key) still drives the actual generation;
-- the server just records start/progress/complete/fail so the card survives
-- a refresh (or shows up in another tab/device for the same account).
-- Fresh installs get this from schema.sql; run this ONCE against an
-- already-deployed database:
--
--   wrangler d1 execute taiao --file=migrations/0004_gen_jobs.sql          # local
--   wrangler d1 execute taiao --remote --file=migrations/0004_gen_jobs.sql # prod
--
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS gen_jobs (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  sprite_type   TEXT NOT NULL,                       -- character|monster|object|ui
  sprite_id     TEXT NOT NULL,
  label         TEXT NOT NULL,                       -- display name (sprite id, or state/costume name)
  subject       TEXT,                                -- gen:<type>:<key> when adding to an EXISTING sprite; null for a brand-new one
  prompt        TEXT NOT NULL,
  body_type     TEXT,                                -- humanoid|quadruped (monster only)
  seed          TEXT,
  pixellab_kind TEXT NOT NULL,                        -- character|object8|object1|image — which PixelLab call/poll shape
  pixellab_ref  TEXT,                                 -- characterId or background_job_id, once known (resumable kinds only)
  status        TEXT NOT NULL DEFAULT 'generating',   -- generating|completed|failed|deleted
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_user ON gen_jobs(user_id, status, created_at);

-- 0015: tutorial + play-pulse analytics (server/src/analytics.js + the Workshop
-- Statistics tab + the thorough raw stream that rides the existing telemetry pipe).
-- Apply with: wrangler d1 execute taiao --remote --file=migrations/0015_analytics.sql
-- (NEVER `d1 migrations apply` in this repo — tracking table unseeded.)
-- The worker fails soft while these tables are absent.
--
-- DESIGN: one row per tutorial SESSION (upsert by session_id) + one row per
-- (session, stage). The client re-POSTs the growing summary as checkpoints and a
-- final flush, so upsert-by-session means a re-send OVERWRITES rather than
-- double-counting. Public aggregates (means, stddev, funnel) are computed by SQL
-- GROUP BY on read — no running counters to keep consistent. The EXTREMELY
-- DETAILED per-player play-by-play does NOT live here: it rides the telemetry
-- pipe to R2 tele/<day>/ (admin-token only), plus a structured per-session
-- summary at R2 tutorial/<day>/<session>.json. D1 holds only the aggregate-able
-- numbers behind the public Statistics page.

-- One row per tutorial attempt. is_guest ~ always 1 (the tutorial runs on a
-- silent guest), kept for completeness. final_idx = frontier stage index at
-- finalize (15 = graduated all keepers). graduated = reached the Bifrost.
CREATE TABLE IF NOT EXISTS tut_sessions (
  session_id     TEXT PRIMARY KEY,
  uid            INTEGER,
  is_guest       INTEGER NOT NULL DEFAULT 1,
  build          TEXT,
  started_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  graduated      INTEGER NOT NULL DEFAULT 0,
  final_idx      INTEGER NOT NULL DEFAULT 0,       -- frontier stage reached (0..15)
  stages_reached INTEGER NOT NULL DEFAULT 0,       -- distinct stages worked on
  total_ms       INTEGER NOT NULL DEFAULT 0,       -- wall time in the tutorial
  active_ms      INTEGER NOT NULL DEFAULT 0,       -- seconds with an action/goal-progress
  idle_ms        INTEGER NOT NULL DEFAULT 0,       -- seconds AFK (no input ≥90s)
  walk_tiles     INTEGER NOT NULL DEFAULT 0,
  kills          INTEGER NOT NULL DEFAULT 0,
  deaths         INTEGER NOT NULL DEFAULT 0,
  talks          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tut_sessions_grad ON tut_sessions(graduated, updated_at);

-- One row per (session, stage). idx = keeper index 0..14 (stage order); stage =
-- keeper id ("guide","bush",…"ferry"). ms = wall time spent with this stage as
-- the frontier. completed = the keeper's stage was finished. These GROUP BY idx
-- for per-stage mean/stddev/funnel on the public stats endpoint.
CREATE TABLE IF NOT EXISTS tut_stage_stats (
  session_id  TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  stage       TEXT NOT NULL,
  ms          INTEGER NOT NULL DEFAULT 0,
  active_ms   INTEGER NOT NULL DEFAULT 0,
  idle_ms     INTEGER NOT NULL DEFAULT 0,
  walk_tiles  INTEGER NOT NULL DEFAULT 0,
  gather      INTEGER NOT NULL DEFAULT 0,
  craft       INTEGER NOT NULL DEFAULT 0,
  kills       INTEGER NOT NULL DEFAULT 0,
  deaths      INTEGER NOT NULL DEFAULT 0,
  talks       INTEGER NOT NULL DEFAULT 0,
  enters      INTEGER NOT NULL DEFAULT 1,           -- times frontier entered this stage
  completed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_tut_stage_idx ON tut_stage_stats(idx);

-- Latest Play Pulse aggregate per device (the I-key report). One row per device,
-- upserted; the public /api/pulse/stats tallies verdicts across all rows in JS.
CREATE TABLE IF NOT EXISTS pulse_reports (
  device      TEXT PRIMARY KEY,
  uid         INTEGER,
  updated_at  INTEGER NOT NULL,
  sessions    INTEGER NOT NULL DEFAULT 0,
  total_sec   INTEGER NOT NULL DEFAULT 0,
  data_json   TEXT NOT NULL                          -- compact [{key,label,verdict,like,dislike}]
);
CREATE INDEX IF NOT EXISTS idx_pulse_updated ON pulse_reports(updated_at);

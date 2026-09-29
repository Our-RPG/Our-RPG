-- Migration 0007 — index users.last_seen.
-- The world-roster dialogue's "seen in the last 24 hours" list queries
-- users WHERE last_seen >= now()-24h ORDER BY last_seen DESC (server/src/
-- players.js). last_seen is now also kept fresh on every authed request
-- (util.authToken), so this keeps that scan cheap. Additive, matches the
-- schema's index-only-adds convention.
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

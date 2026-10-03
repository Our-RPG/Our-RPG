-- 0014: bug reports (studio/js/pages/bugs.js + server/src/bugs.js).
-- Apply with: wrangler d1 execute taiao --remote --file=migrations/0014_bug_reports.sql
-- (NEVER `d1 migrations apply` in this repo — tracking table unseeded.)
-- The worker fails soft while these tables are absent (the Bugs tab just shows
-- "couldn't reach the server"), so deploy order doesn't matter.
--
-- A bug report is a player-filed note of something that went wrong. Other
-- players confirm "I've hit this too" (bug_votes — a me-too tally, switchable)
-- and add specifics/further context (bug_comments). Everything is small text,
-- so unlike code submissions there's no R2 payload — the body lives in D1.
-- A human triages: status stays confirm-and-comment-able until a curator moves
-- it to fixed / closed. The community can flag abuse (bug_flags → auto-hide).

CREATE TABLE IF NOT EXISTS bug_reports (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,                         -- short bug title
  area        TEXT NOT NULL,                         -- gameplay|graphics|world|multiplayer|account|workshop|audio|performance|other
  body        TEXT NOT NULL,                         -- what happened / steps / expected vs actual
  status      TEXT NOT NULL DEFAULT 'open',          -- open|confirmed|fixed|closed|flagged
  flags       INTEGER NOT NULL DEFAULT 0,            -- distinct community flag count
  review_note TEXT,                                  -- a curator's triage note
  reviewed_at INTEGER,                               -- when a curator last acted
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_status ON bug_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_bug_area ON bug_reports(area, status);
CREATE INDEX IF NOT EXISTS idx_bug_user ON bug_reports(user_id, created_at);

-- "I've experienced this too": one me-too per user per bug; switchable (delete
-- to retract). The tally is COUNT(*) on read — never a stored column — exactly
-- like endorsements / submission_votes.
CREATE TABLE IF NOT EXISTS bug_votes (
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bug_id, user_id)
);

-- Specifics / further context anyone can add to a bug (repro steps, their
-- platform, a workaround). Plain text, newest-last on read.
CREATE TABLE IF NOT EXISTS bug_comments (
  id         INTEGER PRIMARY KEY,
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_comment_bug ON bug_comments(bug_id, created_at);

-- One community flag per user per bug. bug_reports.flags caches the distinct
-- count; auto-hide needs FLAG_HIDE_AT distinct flaggers.
CREATE TABLE IF NOT EXISTS bug_flags (
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bug_id, user_id)
);

-- 0012: code submissions (studio/js/pages/code.js + server/src/submissions.js).
-- Apply with: wrangler d1 execute taiao --remote --file=migrations/0012_code_submissions.sql
-- (NEVER `d1 migrations apply` in this repo — tracking table unseeded.)
-- The worker fails soft while these tables are absent (the Code tab just shows
-- "couldn't reach the server"), so deploy order doesn't matter.
--
-- A code submission is a community patch: a git diff + an extensive write-up +
-- optional screenshots, proposed for ANY part of the project EXCEPT the NPC
-- engine, admin controls, and koha (server/src/submissions.js AREAS). Diffs and
-- the write-up live in R2 at submissions/{id}.json; screenshots at
-- submissions/{id}/shot{n}.{ext}. Only metadata + the community vote tally live
-- here. Nothing is ever applied automatically — a human reviews every one
-- (status stays community-voteable; a curator moves it to merged/declined).

CREATE TABLE IF NOT EXISTS code_submissions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,                         -- submission title
  summary     TEXT NOT NULL,                         -- one-line pitch for the list
  area        TEXT NOT NULL,                         -- game|worldgen|workshop|server|accounts|multiplayer|tools|docs|other
  size        INTEGER NOT NULL,                      -- bytes of the stored JSON payload (diff + description)
  diff_lines  INTEGER NOT NULL DEFAULT 0,            -- line count of the diff (shown in the list)
  shots       INTEGER NOT NULL DEFAULT 0,            -- screenshot count (R2 submissions/{id}/shot{n})
  status      TEXT NOT NULL DEFAULT 'open',          -- open|reviewing|merged|declined|flagged
  flags       INTEGER NOT NULL DEFAULT 0,            -- distinct community flag count
  review_note TEXT,                                  -- a curator's note on the verdict
  reviewed_at INTEGER,                               -- when a curator last acted
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_sub_status ON code_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_code_sub_area ON code_submissions(area, status);
CREATE INDEX IF NOT EXISTS idx_code_sub_user ON code_submissions(user_id, created_at);

-- One vote per user per submission; switchable (delete to un-vote). The tally
-- is COUNT(*) on read — never a stored column — exactly like endorsements.
CREATE TABLE IF NOT EXISTS submission_votes (
  submission_id INTEGER NOT NULL REFERENCES code_submissions(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (submission_id, user_id)
);

-- One community flag per user per submission. code_submissions.flags caches the
-- distinct count; auto-hide needs FLAG_HIDE_AT distinct flaggers.
CREATE TABLE IF NOT EXISTS submission_flags (
  submission_id INTEGER NOT NULL REFERENCES code_submissions(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (submission_id, user_id)
);

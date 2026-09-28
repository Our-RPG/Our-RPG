-- Migration 0002 — one community flag per user per proposal.
-- Before this, `POST /api/workshop/flag` blindly incremented proposals.flags,
-- so a single account could flag the same proposal three times and auto-hide
-- it alone. proposal_flags records WHO flagged; proposals.flags becomes a
-- cached count of distinct flaggers. Fresh installs get this from schema.sql;
-- run this ONCE against an already-deployed database:
--
--   wrangler d1 execute taiao --file=migrations/0002_proposal_flags.sql          # local
--   wrangler d1 execute taiao --remote --file=migrations/0002_proposal_flags.sql # prod
--
-- Safe to re-run (IF NOT EXISTS). Existing anonymous flag counts are left as
-- they are — curators have already seen anything they hid.

CREATE TABLE IF NOT EXISTS proposal_flags (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);

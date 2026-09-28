-- Migration 0001 — moderation gate for user-uploaded proposals.
-- Adds proposals.source so the server can tell PixelLab-generated art
-- (auto-published to 'open') from user uploads (held at 'pending' until a
-- curator approves). Fresh installs get this from schema.sql; run this ONCE
-- against an already-deployed database:
--
--   wrangler d1 execute taiao --file=migrations/0001_proposal_source.sql          # local
--   wrangler d1 execute taiao --remote --file=migrations/0001_proposal_source.sql # prod
--
-- SQLite has no "ADD COLUMN IF NOT EXISTS"; re-running this after it has been
-- applied is expected to error harmlessly ("duplicate column name: source").

ALTER TABLE proposals ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_user ON proposals(user_id, created_at);

-- Taiao Phase-1 server schema (Cloudflare D1 / SQLite).
-- Apply with:  wrangler d1 execute taiao --file=schema.sql  (add --remote for prod)
-- Everything here is additive-friendly: new columns/tables over ALTERs, no
-- destructive migrations. Times are unix milliseconds (matches the client's
-- wall-clock convention).

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  username    TEXT NOT NULL COLLATE NOCASE UNIQUE,   -- 3-20 chars [A-Za-z0-9_-]
  pass_hash   TEXT NOT NULL,                         -- argon2id$v1$m=..,t=..,p=..$saltB64$hashB64
  email       TEXT,                                  -- OPTIONAL, recovery only; null is normal
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  flags       TEXT NOT NULL DEFAULT ''               -- space-separated: 'curator' 'banned' ...
);

-- Bearer sessions. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- WebAuthn credentials (optional passkeys).
CREATE TABLE IF NOT EXISTS passkeys (
  cred_id     TEXT PRIMARY KEY,                      -- base64url credential id
  user_id     INTEGER NOT NULL REFERENCES users(id),
  pubkey_jwk  TEXT NOT NULL,                         -- ES256 public key as JWK JSON
  counter     INTEGER NOT NULL DEFAULT 0,
  label       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

-- Short-lived WebAuthn challenges (registration + login).
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge   TEXT PRIMARY KEY,                      -- base64url
  user_id     INTEGER,                               -- null for discoverable login
  kind        TEXT NOT NULL,                         -- 'reg' | 'auth'
  expires_at  INTEGER NOT NULL
);

-- One-time Workshop sign-in codes (Phase 5). A logged-in player mints a code
-- in-game; the Workshop site (a different origin — localStorage can't cross
-- over) redeems it for a real session. Single-use, short-lived.
CREATE TABLE IF NOT EXISTS link_codes (
  code_hash   TEXT PRIMARY KEY,                      -- sha256hex of the code
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Save vault: metadata here, blobs in R2 at saves/{user_id}/{slot}/{version}.
CREATE TABLE IF NOT EXISTS saves (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  slot        TEXT NOT NULL,                         -- client character slot id
  version     INTEGER NOT NULL,                      -- monotonic per (user, slot)
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot, version)
);

-- Latest per-skill XP snapshot per user (opt-in upload alongside saves).
CREATE TABLE IF NOT EXISTS xp_snapshots (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skill       TEXT NOT NULL,
  xp          INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill)
);
CREATE INDEX IF NOT EXISTS idx_xp_skill ON xp_snapshots(skill, xp);

-- Workshop: one vote per user per (subject, field). `choice` is the voted
-- value serialised exactly as the client stores it locally.
CREATE TABLE IF NOT EXISTS workshop_votes (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  subject     TEXT NOT NULL,                         -- e.g. 'obj:kereru' / 'mon:harrier'
  field       TEXT NOT NULL,                         -- e.g. 'sprite_set' / 'drop:feather'
  choice      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, subject, field)
);
CREATE INDEX IF NOT EXISTS idx_votes_subject ON workshop_votes(subject, field);

-- Workshop proposals ("Submit proposal" — the old Export JSON payload).
-- Payload lives in R2 at proposals/{id}; metadata + licence grant here.
CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  subject     TEXT NOT NULL,
  kind        TEXT NOT NULL,                         -- 'values' | 'sprites' | 'mixed'
  title       TEXT NOT NULL,
  licence     TEXT NOT NULL,                         -- 'CC-BY-SA-4.0' | 'GPL-3.0-or-later'
  size        INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',          -- pending|open|flagged|accepted|declined
  source      TEXT NOT NULL DEFAULT 'upload',        -- 'pixellab' (auto-open) | 'upload' (needs moderation)
  flags       INTEGER NOT NULL DEFAULT 0,            -- community flag count
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_subject ON proposals(subject, status);
-- Curator moderation queue: user-uploaded art lands in 'pending' until a
-- curator approves it; PixelLab-generated art skips straight to 'open'.
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_user ON proposals(user_id, created_at);

CREATE TABLE IF NOT EXISTS endorsements (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);

-- One community flag per user per proposal. proposals.flags caches the
-- distinct count; auto-hide needs FLAG_HIDE_AT distinct flaggers.
CREATE TABLE IF NOT EXISTS proposal_flags (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);

-- §6.1-B offline action summaries. Phase 1 only STORES them (validated=0);
-- Phase 2 turns on the plausibility envelope and starts setting validated.
CREATE TABLE IF NOT EXISTS action_summaries (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  payload     TEXT NOT NULL,                         -- JSON, docs/action-summary.md
  validated   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_summaries_user ON action_summaries(user_id, started_at);

-- Koha transparency: real monthly costs, hand-entered (admin endpoint or
-- `wrangler d1 execute`). The transparency page reads straight from this.
CREATE TABLE IF NOT EXISTS koha_costs (
  month       TEXT PRIMARY KEY,                      -- 'YYYY-MM'
  usd_cents   INTEGER NOT NULL,
  note        TEXT NOT NULL DEFAULT ''
);

-- Fixed-window rate limiting (coarse; fine at Phase-1 scale).
CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT PRIMARY KEY,
  win_start   INTEGER NOT NULL,
  count       INTEGER NOT NULL
);

-- Weekly workshop digests (also posted to GitHub Discussions when configured).
CREATE TABLE IF NOT EXISTS digests (
  id          INTEGER PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  markdown    TEXT NOT NULL,
  posted_url  TEXT
);

-- ============================== Phase 2 ====================================
-- One world, actually shared: shop ledger, validated XP, ranks, seeds.
-- (The region mutation ledger lives in Durable Object storage, not D1.)

-- Per-town player-added shop stock. The client's computed base stock is the
-- standing floor (BANK_PERMANENTS pattern) and never reaches the server —
-- these rows are only what players sold INTO the world, provenance attached.
CREATE TABLE IF NOT EXISTS shop_units (
  id          INTEGER PRIMARY KEY,
  town        TEXT NOT NULL,                         -- client townKeyOf "cx,cy"
  item        TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  maker       TEXT,                                  -- maker's name (provenance)
  maker_rank  INTEGER,                               -- §8 ratchet: rank at sale time
  quality     INTEGER,                               -- 0-100 or null
  seller_id   INTEGER NOT NULL REFERENCES users(id),
  sold_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_units_town_item ON shop_units(town, item, sold_at);

-- §6.1-B: envelope-clamped XP — the only XP ranks and the economy count.
CREATE TABLE IF NOT EXISTS validated_xp (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skill       TEXT NOT NULL,
  xp          INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill)
);
CREATE INDEX IF NOT EXISTS idx_vxp_skill ON validated_xp(skill, xp);

-- Per-user validation high-water mark (overlapping summaries count once).
CREATE TABLE IF NOT EXISTS user_validation (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id),
  validated_until INTEGER NOT NULL
);

-- Server-issued seed batches for rank-bearing rolls (rare drops, quality).
CREATE TABLE IF NOT EXISTS seed_batches (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  batch       INTEGER NOT NULL,
  seed        TEXT NOT NULL,                         -- 16 bytes hex
  issued_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, batch)
);

-- §8 percentile standings, recomputed daily from validated_xp.
CREATE TABLE IF NOT EXISTS ranks (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skill       TEXT NOT NULL,
  level       INTEGER NOT NULL,                      -- 16-32
  top_pct     REAL,
  grace_until INTEGER,                               -- 14-day demotion grace
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill)
);
CREATE TABLE IF NOT EXISTS rank_meta (
  skill       TEXT PRIMARY KEY,
  qualifying  INTEGER NOT NULL,
  active      INTEGER NOT NULL,                      -- 1 once ≥1000 qualify
  computed_at INTEGER NOT NULL
);

-- ============================== Phase 6 ====================================
-- PixelLab generation jobs, tracked server-side so the Workshop's "generating"
-- card survives a hard refresh (or a closed tab) instead of living only in
-- that one browser's memory. The server never talks to PixelLab itself — the
-- client still drives the actual generation with its own BYO PixelLab key —
-- this is just a durable status board: start (before the PixelLab call),
-- progress (the async job/character id, once known, for resuming polling),
-- then complete (result payload, mirrors the proposals R2 pattern) or fail.
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

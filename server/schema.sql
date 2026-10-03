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
-- the world-roster "seen in last 24h" scan (server/src/players.js)
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

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

-- Code submissions (the studio's "Code" tab; server/src/submissions.js). A git
-- diff + an extensive write-up + optional screenshots, proposed for any part of
-- the project EXCEPT the NPC engine, admin controls, and koha. Diff + write-up
-- live in R2 at submissions/{id}.json; screenshots at submissions/{id}/shot{n}.
-- Metadata + the community vote tally here. Nothing applies automatically — a
-- human reviews every one (status open|reviewing → merged|declined by a curator).
CREATE TABLE IF NOT EXISTS code_submissions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,                         -- submission title
  summary     TEXT NOT NULL,                         -- one-line pitch for the list
  area        TEXT NOT NULL,                         -- game|worldgen|workshop|server|accounts|multiplayer|tools|docs|other
  size        INTEGER NOT NULL,                      -- bytes of the stored JSON payload
  diff_lines  INTEGER NOT NULL DEFAULT 0,            -- line count of the diff
  shots       INTEGER NOT NULL DEFAULT 0,            -- screenshot count
  status      TEXT NOT NULL DEFAULT 'open',          -- open|reviewing|merged|declined|flagged
  flags       INTEGER NOT NULL DEFAULT 0,            -- distinct community flag count
  review_note TEXT,                                  -- a curator's note on the verdict
  reviewed_at INTEGER,                               -- when a curator last acted
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_sub_status ON code_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_code_sub_area ON code_submissions(area, status);
CREATE INDEX IF NOT EXISTS idx_code_sub_user ON code_submissions(user_id, created_at);

-- One vote per user per submission; switchable (delete to un-vote). Tally is
-- COUNT(*) on read, never a stored column.
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

-- The finite shopkeeper shelf (migration 0013): ONE stock count per (town,
-- item) = the shop's own opening stock + everything players sold in. The
-- single number the buy AND sell price move along, so a buy-then-sell round
-- trip returns both to where they began. Seeded once (EconCore.openingStock),
-- then only moved by trades; nothing auto-restocks it.
CREATE TABLE IF NOT EXISTS shop_stock (
  town        TEXT NOT NULL,
  item        TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (town, item)
);

-- The living till (docs/shopkeeper-economy.md): one shared cash balance per
-- town ('shop' column reserved for a Phase-2 per-shopkeeper split), seeded
-- deterministically on first trade. Player sells drain it, buys refill it,
-- the daily cron drifts it back toward operating cash.
CREATE TABLE IF NOT EXISTS shop_till (
  town        TEXT NOT NULL,
  shop        TEXT NOT NULL DEFAULT 'town',
  cash        INTEGER NOT NULL,
  operating   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (town, shop)
);

-- Supply shocks (Phase 3): one active shock per (town, tag), rolled by the
-- daily cron on trading towns or written by /api/admin/shopevent. Price
-- effects emerge in econ-core (floor_mult shrinks the shelf, demand_mult
-- heats beliefs) — nothing scripts a price directly.
CREATE TABLE IF NOT EXISTS town_mods (
  town        TEXT NOT NULL,
  tag         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  floor_mult  REAL NOT NULL DEFAULT 1,
  demand_mult REAL NOT NULL DEFAULT 1,
  started_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (town, tag)
);

-- Lazily-decayed demand/supply beliefs per (town, item) — sparse, created on
-- first trade of that item there. Prices are never stored, always computed
-- from these EMAs by shared/econ-core.js (client and worker, same math).
CREATE TABLE IF NOT EXISTS shop_flow (
  town        TEXT NOT NULL,
  item        TEXT NOT NULL,
  ema_in      REAL NOT NULL DEFAULT 0,   -- units/day players sell to the town
  ema_out     REAL NOT NULL DEFAULT 0,   -- units/day players buy from it
  day_in      INTEGER NOT NULL DEFAULT 0, -- today's raw flow (belief caps)
  day_out     INTEGER NOT NULL DEFAULT 0,
  day_start   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (town, item)
);

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

-- ============================== Phase 7 ====================================
-- The contributor's private PixelLab gallery. Once a PixelLab key is signed
-- into the Workshop, the Profile page lists everything that PixelLab account
-- has ever generated (PixelLab's own GET /v2/characters + /v2/objects),
-- auto-sorts it into character/monster/object/item buckets, and lets the player
-- pin the ones they want to keep. Metadata + a small thumbnail here; the full
-- rotation art bundle rides in R2 at profile/<id>.json. Private and inert —
-- promoting an item into the game is still the explicit "upload to game" flow.
-- Also the destination for EVERY sprite generated through the Workshop's
-- PixelLab pipeline (client hooks GenJobs.execute), each carrying a proposed
-- sprite_id + category tag; from here a player can delete, regenerate (keeps the
-- old, adds the new), or publish to the public catalogue (published_sprites).
CREATE TABLE IF NOT EXISTS profile_gallery (
  id                  INTEGER PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  category            TEXT NOT NULL,                  -- character|monster|object|item (heuristic; PixelLab only knows character vs object)
  source              TEXT NOT NULL DEFAULT 'pixellab', -- provenance of the art
  pixellab_kind       TEXT NOT NULL,                  -- character|object (library) or character|object8|object1|image (pipeline)
  pixellab_id         TEXT NOT NULL,                  -- PixelLab character/object id (library) or "job:<genJobId>" (pipeline) — dedupe key
  sprite_id           TEXT,                           -- proposed sprite id (regenerate/publish key)
  subject             TEXT,                           -- gen:<kind>:<folder> when the gen targeted an existing sprite; else null
  body_type           TEXT,                           -- humanoid|quadruped (monsters), for regenerate
  seed                TEXT,                           -- generation seed, for regenerate
  name                TEXT,                           -- display name (PixelLab name, or a slug of the prompt)
  prompt              TEXT,
  thumb               TEXT,                           -- small south-facing data URL for the grid (full art rides in R2)
  published_sprite_id TEXT,                           -- the public sprite_id once this item has been published
  created_at          INTEGER NOT NULL,               -- when the art was generated
  added_at            INTEGER NOT NULL,               -- when it was pinned/added to this profile
  UNIQUE(user_id, pixellab_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_gallery_user ON profile_gallery(user_id, category, created_at);

-- The PUBLIC sprite catalogue behind our-rpg.com/workshop/sprites. A player
-- publishes a gallery item here with a globally UNIQUE sprite_id (server appends
-- -2, -3, … on collision) and the chosen tag. Metadata + thumbnail here; full
-- rotation art in R2 at published/<id>.json. Direct publish, no voting — separate
-- from the proposals ballot box.
CREATE TABLE IF NOT EXISTS published_sprites (
  id            INTEGER PRIMARY KEY,
  sprite_id     TEXT NOT NULL UNIQUE,                 -- globally unique public id
  user_id       INTEGER NOT NULL REFERENCES users(id),
  category      TEXT NOT NULL,                        -- the chosen tag: character|monster|object|item
  name          TEXT,
  prompt        TEXT,
  thumb         TEXT,
  created_at    INTEGER NOT NULL,
  published_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_sprites_cat ON published_sprites(category, published_at);
CREATE INDEX IF NOT EXISTS idx_published_sprites_user ON published_sprites(user_id, published_at);

-- Player bug reports (studio/js/pages/bugs.js + server/src/bugs.js). A report is
-- small text (no R2 payload); other players confirm "me too" (bug_votes,
-- switchable) and add context (bug_comments). A curator triages status. See
-- migrations/0014_bug_reports.sql for the authoritative comments.
CREATE TABLE IF NOT EXISTS bug_reports (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  area        TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  flags       INTEGER NOT NULL DEFAULT 0,
  review_note TEXT,
  reviewed_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_status ON bug_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_bug_area ON bug_reports(area, status);
CREATE INDEX IF NOT EXISTS idx_bug_user ON bug_reports(user_id, created_at);
CREATE TABLE IF NOT EXISTS bug_votes (
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bug_id, user_id)
);
CREATE TABLE IF NOT EXISTS bug_comments (
  id         INTEGER PRIMARY KEY,
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_comment_bug ON bug_comments(bug_id, created_at);
CREATE TABLE IF NOT EXISTS bug_flags (
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bug_id, user_id)
);

-- Tutorial + play-pulse analytics (server/src/analytics.js + Workshop Statistics
-- tab). One row per tutorial session (upsert) + one per (session,stage); public
-- aggregates computed by SQL GROUP BY. Detailed per-player play-by-play rides the
-- telemetry pipe to R2, NOT here. See migrations/0015_analytics.sql for details.
CREATE TABLE IF NOT EXISTS tut_sessions (
  session_id     TEXT PRIMARY KEY,
  uid            INTEGER,
  is_guest       INTEGER NOT NULL DEFAULT 1,
  build          TEXT,
  started_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  graduated      INTEGER NOT NULL DEFAULT 0,
  final_idx      INTEGER NOT NULL DEFAULT 0,
  stages_reached INTEGER NOT NULL DEFAULT 0,
  total_ms       INTEGER NOT NULL DEFAULT 0,
  active_ms      INTEGER NOT NULL DEFAULT 0,
  idle_ms        INTEGER NOT NULL DEFAULT 0,
  walk_tiles     INTEGER NOT NULL DEFAULT 0,
  kills          INTEGER NOT NULL DEFAULT 0,
  deaths         INTEGER NOT NULL DEFAULT 0,
  talks          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tut_sessions_grad ON tut_sessions(graduated, updated_at);
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
  enters      INTEGER NOT NULL DEFAULT 1,
  completed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_tut_stage_idx ON tut_stage_stats(idx);
CREATE TABLE IF NOT EXISTS pulse_reports (
  device      TEXT PRIMARY KEY,
  uid         INTEGER,
  updated_at  INTEGER NOT NULL,
  sessions    INTEGER NOT NULL DEFAULT 0,
  total_sec   INTEGER NOT NULL DEFAULT 0,
  data_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pulse_updated ON pulse_reports(updated_at);

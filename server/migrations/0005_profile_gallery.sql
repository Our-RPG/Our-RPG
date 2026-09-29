-- Migration 0005 — the contributor's private PixelLab gallery (Phase 7).
-- Once a player has signed a PixelLab API key into the Workshop, the Profile
-- page can list EVERYTHING that PixelLab account has ever generated (via
-- PixelLab's own GET /v2/characters and GET /v2/objects), auto-sorted into
-- character / monster / object / item buckets, and let them cherry-pick which
-- ones to keep on their own profile. This table is that private shelf: metadata
-- + a small south-facing thumbnail in D1, the full rotation art bundle in R2 at
-- profile/<id>.json (same split the proposals/gen_jobs tables use). Nothing here
-- is public and nothing auto-enters the game — a gallery item is promoted to a
-- community proposal only if the player later chooses to (the existing
-- "upload to game" flow).
--
-- The server still never talks to PixelLab: the client lists + downloads the
-- art with the player's own BYO key and posts the finished bundle here.
--
-- Fresh installs get this from schema.sql; run this ONCE against an
-- already-deployed database:
--
--   wrangler d1 execute taiao --file=migrations/0005_profile_gallery.sql          # local
--   wrangler d1 execute taiao --remote --file=migrations/0005_profile_gallery.sql # prod
--
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS profile_gallery (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  category      TEXT NOT NULL,                        -- character|monster|object|item (heuristic; PixelLab only knows character vs object)
  source        TEXT NOT NULL DEFAULT 'pixellab',     -- provenance of the art
  pixellab_kind TEXT NOT NULL,                        -- character|object — which PixelLab list it came from
  pixellab_id   TEXT NOT NULL,                        -- the PixelLab character/object id — dedupe key
  name          TEXT,                                 -- display name (PixelLab name, or a slug of the prompt)
  prompt        TEXT,
  thumb         TEXT,                                 -- small south-facing data URL for the grid (full art rides in R2)
  created_at    INTEGER NOT NULL,                     -- PixelLab's own created_at, so the shelf sorts by when it was generated
  added_at      INTEGER NOT NULL,                     -- when it was pinned to this profile
  UNIQUE(user_id, pixellab_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_gallery_user ON profile_gallery(user_id, category, created_at);

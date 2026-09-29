-- Migration 0006 — the gallery becomes the sprite hub + public publishing (Phase 7b).
-- Two changes:
--
-- 1. profile_gallery gains the fields needed to REGENERATE and PUBLISH an item:
--    the proposed sprite_id, the gen subject (for states/icons on an existing
--    sprite), body_type + seed (so a regenerate reproduces the recipe), and
--    published_sprite_id (set once an item has been published, so the UI can
--    show "published as X"). Every sprite generated through the Workshop's
--    PixelLab pipeline is now auto-added here (client hooks GenJobs.execute),
--    so these mirror the gen_jobs recipe columns.
--
-- 2. published_sprites — the PUBLIC catalogue behind our-rpg.com/workshop/sprites.
--    When a player publishes a gallery item it lands here with a globally UNIQUE
--    sprite_id (the server appends -2, -3, … on collision) and the chosen tag
--    (category). Metadata + thumbnail here; full rotation art in R2 at
--    published/<id>.json. This is a direct publish (no voting) — distinct from
--    the proposals/ballot-box flow, which stays as-is.
--
-- Run ONCE against an already-deployed database (ALTER ... ADD COLUMN is not
-- IF-NOT-EXISTS-guarded, so this migration is not re-runnable):
--
--   wrangler d1 execute taiao --remote --file=migrations/0006_gallery_publish.sql

ALTER TABLE profile_gallery ADD COLUMN sprite_id           TEXT;   -- proposed sprite id (regenerate/publish key)
ALTER TABLE profile_gallery ADD COLUMN subject             TEXT;   -- gen:<kind>:<folder> when the gen targeted an existing sprite; else null
ALTER TABLE profile_gallery ADD COLUMN body_type           TEXT;   -- humanoid|quadruped (monsters), for regenerate
ALTER TABLE profile_gallery ADD COLUMN seed                TEXT;   -- generation seed, for regenerate
ALTER TABLE profile_gallery ADD COLUMN published_sprite_id TEXT;   -- the public sprite_id once this item has been published

CREATE TABLE IF NOT EXISTS published_sprites (
  id            INTEGER PRIMARY KEY,
  sprite_id     TEXT NOT NULL UNIQUE,                 -- globally unique public id (collisions get -2, -3, … appended)
  user_id       INTEGER NOT NULL REFERENCES users(id),
  category      TEXT NOT NULL,                        -- the chosen tag: character|monster|object|item
  name          TEXT,
  prompt        TEXT,
  thumb         TEXT,                                 -- small south-facing data URL for the catalogue grid
  created_at    INTEGER NOT NULL,                     -- when the art was generated
  published_at  INTEGER NOT NULL                      -- when it went public
);
CREATE INDEX IF NOT EXISTS idx_published_sprites_cat ON published_sprites(category, published_at);
CREATE INDEX IF NOT EXISTS idx_published_sprites_user ON published_sprites(user_id, published_at);

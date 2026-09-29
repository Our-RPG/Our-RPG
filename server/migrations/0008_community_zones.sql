-- Community-baked zones (the Workshop's in-browser "Generate zone" pipeline).
-- One row per zone; status 'baking' rows carry live progress + a lease so a
-- refreshed tab (or another signed-in player) can resume an abandoned bake;
-- 'live' rows are published — manifest/map/pages live in R2 under
-- zones/<zx>_<zy>/*, checkpoints under zonebake/<zx>_<zy>/*.
CREATE TABLE IF NOT EXISTS community_zones (
  zx             INTEGER NOT NULL,
  zy             INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'baking',   -- baking | live
  stage          INTEGER NOT NULL DEFAULT 0,          -- current pass 0..5 (terrain,npcs,cities,monsters,merge,biomes)
  pct            REAL    NOT NULL DEFAULT 0,          -- overall 0..100
  msg            TEXT,                                -- human progress line
  holder_user_id INTEGER,                             -- current lease holder
  holder_name    TEXT,
  lease_until    INTEGER NOT NULL DEFAULT 0,          -- unix ms; stale lease => resumable by anyone
  contributors   TEXT,                                -- JSON array of usernames who advanced the bake
  npc_count      INTEGER,
  city_count     INTEGER,
  monster_count  INTEGER,
  quest_count    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  published_at   INTEGER,
  PRIMARY KEY (zx, zy)
);

#!/usr/bin/env bash
# Our RPG — build the our-rpg.com site: the game at /play, a marketing
# homepage at /home (root "/" redirects there), koha (donations) at /koha,
# and the Workshop at /workshop — one static tree (dist/site/) any static
# host can serve. Cloudflare Pages is the intended host, with the
# taiao-server worker routed at our-rpg.com/api/* (see server/wrangler.toml)
# so the API is same-origin.
#
#   tools/build_ourrpg_site.sh
#   npx wrangler pages deploy dist/site --project-name=our-rpg   # user-run
#
# Layout (matches studio/tools/build_site.mjs's ASSET_BASE contract):
#   /            tiny redirect stub -> /home (index.html)
#   /home        marketing homepage (home.html, config-free static page)
#   /play        the game itself (play.html — same asset-relative layout
#                index.html used to have at the root: css/, fonts/,
#                dist/bundle.js, libs/, assets/*; a bare file with no
#                trailing slash resolves those paths identically to "/")
#   /koha        donations page (koha.html — Stripe Checkout, same-origin
#                fetches to /api/koha/*, no build-time config needed)
#   /js          zone-worker importScripts targets (from the studio build)
#   /workshop    the Workshop app
#
# The game bundle is built ONLINE by default — server + workshop URLs baked.
# Override TAIAO_SERVER_URL / TAIAO_WORKSHOP_URL for another deployment, and
# export TAIAO_TURNSTILE_SITEKEY if the worker has TURNSTILE_SECRET set.
set -euo pipefail
cd "$(dirname "$0")/.."

export TAIAO_SERVER_URL="${TAIAO_SERVER_URL:-https://our-rpg.com}"
export TAIAO_WORKSHOP_URL="${TAIAO_WORKSHOP_URL:-https://our-rpg.com/workshop}"

node tools/build.mjs

# Workshop first: build_site.mjs wipes and repopulates dist/site — workshop/
# + root assets/ (sheets + audio) + worker-dep js/ + a root redirect page the
# game overlay overwrites below.
node studio/tools/build_site.mjs --out dist/site

# Game overlay at the root — same file set as the itch zip (lean where the
# studio build hasn't already placed the layer locally; sw.js prefers local
# files and falls back to the CDN for anything absent, e.g. paperdolls).
copy()    { mkdir -p "dist/site/$(dirname "$1")"; cp "$1" "dist/site/$1"; }
copydir() { mkdir -p "dist/site/$1"; cp -R "$1"/. "dist/site/$1/"; }

cp index.html dist/site/play.html   # the game, now served at /play (same asset
                                     # layout as root — a bare file with no
                                     # trailing slash resolves relative paths
                                     # identically to "/")
cp home.html dist/site/home.html    # marketing homepage, served at /home
cp koha.html dist/site/koha.html    # donations (Stripe Checkout), served at /koha
cat > dist/site/index.html <<'EOF'  # root -> /home (overwrites the studio build's redirect page)
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=/home">
  <title>Our RPG</title>
  <link rel="canonical" href="/home">
</head>
<body>
  <p>Redirecting to <a href="/home">Our RPG</a>…</p>
  <script>location.replace("/home");</script>
</body>
</html>
EOF
copy sw.js
copy _headers            # Pages header rules: shell files revalidate (no 4h HTTP-cache pinning)
copydir css
copydir fonts
copy dist/bundle.js
copy libs/three.min.js
copy libs/lua/wasmoon.js   # Lua runtime (quests/dialogue/routines) — index.html loads it as a vendor tag
copy libs/lua/glue.wasm    # wasmoon's wasm binary — without it Lua init fails (HTML fallback != wasm)
# the game's own web workers (chunk/terrain gen + road/map painting). The
# importScripts deps they pull (/js/data.js, /js/world/terrain|erosion|
# citygrow|features.js) are already placed by the studio build's WORKER_DEPS.
copy js/world/roadworker.js
copy js/world/chunkworker.js
copydir assets/sheets
copy assets/bifrost.webm
copy assets/birdsong/CREDITS.txt
copy assets/sfx/CREDITS.txt
copy assets/music/CREDITS.txt
for f in assets/LICENSE-*.txt; do copy "$f"; done
[ -f LICENSE ] && copy LICENSE
[ -f LICENSE-assets.md ] && copy LICENSE-assets.md

echo
echo "dist/site ready ($(du -sh dist/site | cut -f1)) — deploy with:"
echo "  npx wrangler pages deploy dist/site --project-name=our-rpg"

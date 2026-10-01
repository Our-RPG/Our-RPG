#!/usr/bin/env bash
# Our RPG — build the our-rpg.com site: the game at the root, the Workshop
# at /workshop, one static tree (dist/site/) any static host can serve.
# Cloudflare Pages is the intended host, with the taiao-server worker routed
# at our-rpg.com/api/* (see server/wrangler.toml) so the API is same-origin.
#
#   tools/build_ourrpg_site.sh
#   npx wrangler pages deploy dist/site --project-name=our-rpg   # user-run
#
# Layout (matches studio/tools/build_site.mjs's ASSET_BASE contract):
#   /            index.html, sw.js, css/, fonts/, dist/bundle.js, libs/,
#                assets/* (game art; audio layers placed by the studio build)
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

copy index.html          # overwrites the studio build's redirect page
copy sw.js
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

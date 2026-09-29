#!/usr/bin/env bash
# Taiao — build the web-distribution zip (itch.io upload).
#
#   tools/build_web_zip.sh          # dist/taiao-web.zip, CDN-lean (default)
#   tools/build_web_zip.sh --full   # include audio + paperdolls locally
#
# The itch build is an EMBED of the canonical our-rpg.com deployment: bake
# the online config into it by exporting first —
#   TAIAO_SERVER_URL=https://our-rpg.com
#   TAIAO_WORKSHOP_URL=https://our-rpg.com/workshop
# (unset = fully-offline build: accounts/sync/koha/workshop doors all no-op).
#
# The lean zip ships only what must be same-origin-local; everything else
# streams from the Taiao-cdn repo via the service worker's remote fallback
# (sw.js REMOTE_PREFIXES) on first use and caches:
#
#   shipped:   index.html, sw.js, css/, fonts/, dist/bundle.js,
#              libs/three.min.js, assets/sheets/ (all runtime
#              art), assets/bifrost.webm (the graduation cinematic — the one
#              big file we refuse to gamble on a CDN fetch for), license +
#              credits texts.
#   streamed:  sfx / ambience / music (2.6M), birdsong (15M), paperdolls
#              (51M), NPC dialogue bank + MiniLM + npcml runtime (~230M).
#
# ⚠ BEFORE shipping a lean zip, run tools/publish_cdn_assets.sh so the CDN
#   actually holds the streamed layers — otherwise the game runs but stays
#   silent and simple-villagered even online. --full needs no CDN publish
#   (only the ML dialogue layer stays remote, as it does for repo clones).
#
# Webp audit note (2026-09-16): all 42 sheets are already max-effort
# LOSSLESS webp (re-encode at method=6 is byte-identical). Lossy re-encodes
# GREW most sheets (flat-colour pixel art favours VP8L); only gi-item-icons
# (-47% @q95) and mix-npcs-0 (-15% @q90) would shrink, at real quality risk
# on 32px icon art — not taken. The diet is packaging, not recompression.
set -euo pipefail
cd "$(dirname "$0")/.."

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

node tools/build.mjs

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

copy() { mkdir -p "$STAGE/$(dirname "$1")"; cp "$1" "$STAGE/$1"; }
copydir() { mkdir -p "$STAGE/$1"; cp -R "$1"/. "$STAGE/$1/"; }

copy index.html
copy sw.js
copydir css
copydir fonts
copy dist/bundle.js
copy libs/three.min.js
copydir assets/sheets
copy assets/bifrost.webm
# attribution ships even when the audio it describes streams from the CDN
copy assets/birdsong/CREDITS.txt
copy assets/sfx/CREDITS.txt
copy assets/music/CREDITS.txt
for f in assets/LICENSE-*.txt; do copy "$f"; done
copy LICENSE 2>/dev/null || true
copy LICENSE-assets.md 2>/dev/null || true

if [ "$FULL" = 1 ]; then
  for f in assets/sfx/*.ogg; do copy "$f"; done
  for f in assets/ambience/*.ogg; do copy "$f"; done
  for f in assets/music/*.ogg; do copy "$f"; done
  copydir js/sprites/paperdolls
fi

OUT="dist/taiao-web$([ "$FULL" = 1 ] && echo -full || true).zip"
rm -f "$OUT"
(cd "$STAGE" && zip -q -r -9 - .) > "$OUT"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1)) — staged tree:"
du -sh "$STAGE"/* | sed "s|$STAGE/|  |"

# itch.io page — copy + setup checklist

Everything needed to publish the itch.io page. The **Body** section below is
the page description, ready to paste into itch's editor (itch renders this
subset of markdown fine). Claims here must stay TRUE — this page follows the
README's "truthful front page" rule: nothing promised that isn't in the build.

---

## Setup checklist (itch dashboard)

- **Title:** Our RPG — *tagline:* "An endless, living world that can never
  be taken from you."
- **Classification:** Game → Role Playing. **Kind of project:** HTML —
  "This file will be played in the browser".
- **Pricing: $0, donations OFF.** The optional birdsong layer is CC BY-NC-SA
  (non-commercial); taking money on the page that distributes the game is a
  line we don't need to test. Support goes through
  [our-rpg.com/koha](https://our-rpg.com/koha) linked from the body instead.
- **Embed:** 1280×720 minimum, **fullscreen button ON**, mobile-friendly
  OFF (it isn't — say so, don't fake it). Enable "SharedArrayBuffer support"
  only if testing shows the ML dialogue layer wants it; the game itself
  doesn't.
- **Cover image:** `~/Downloads/our-rpg-itch-shots/00-cover-630x500.png` — a
  golden-hour canyon vista (layered orange mesas, distant water, gem-strewn
  floor), already sized 630×500. (A Bifrost still is the alternate.)
- **Lead GIF:** record the Bifrost crossing — `tools/record_bifrost.js`
  already drives the cinematic headlessly; capture ~8 s of the pull,
  convert with `ffmpeg -i bifrost.webm -vf "fps=15,scale=640:-1" bifrost.gif`
  and keep it under ~8 MB so itch autoplays it. Place it FIRST in the body.
- **Screenshots (6):** staged and captured headlessly (see
  `~/Downloads/our-rpg-itch-shots/`, 1920×1080 unless noted):
  `01-golden-canyon` (endless-world vista), `02-living-forest` (the varied
  living bush), `03-night-explorer` (a candle-lit wanderer at a moonlit pool),
  `04-canyon-adventurer` (character in the gem badlands), `05-split-selves`
  (five selves working one field — the **X**-split mechanic, 1920×1000),
  `06-world-map` (the named, road-webbed explorable world). Re-stageable via
  the `scenes*.mjs` directors in the scratch dir.
- **Tags:** rpg, open-world, sandbox, crafting, pixel-art, singleplayer,
  relaxing, new-zealand.
- **Upload:** the web zip from `tools/build_web_zip.sh` (see asset-diet
  notes) — index.html at the zip root.

---

## Body

*(lead GIF here — the Bifrost crossing)*

**The game's home is [our-rpg.com/play](https://our-rpg.com/play)** — this
page embeds the very same build. The Workshop, where the community makes the
game's art and votes it into everyone's world, lives at
[our-rpg.com/workshop](https://our-rpg.com/workshop).

**Our RPG** began life as *Taiao*, te reo Māori for the natural world — and
the natural world is still what it's made of. It's a browser-native RPG in
the spirit of old-school tile-based MMOs — RPG MO, early RuneScape —
rendered HD-2D: a WebGL world with a tilted chase camera, depth fog, and
billboarded pixel art. No install.

This build (same as our-rpg.com/play) is a shared, live world past the
tutorial island: it needs a free account (no email required) and shares
anonymous gameplay telemetry by default — an off switch lives in the
Settings tab. Clone [the repo](https://github.com/dataversion5372/Taiao)
instead for the fully offline, account-free, telemetry-free solo game this
started as; your save then lives in your browser alone.

The world is **endless and alive**. Terrain streams in forever across
15,000²-tile named worlds; weather fronts drift on real isobars; the sun's
shadows follow your latitude and season all the way to a polar midnight sun;
rivers flood after long rain; snow settles and melts; native birds of
Aotearoa fly, perch, and sing — real field recordings, mixed spatially into a
dawn chorus. Everyone plays the same seed: a place you find is a place a
friend can visit.

| The world, by the numbers | |
|---|---|
| Trainable skills | **61** |
| Items | **3,286** |
| Recipes | **2,785** across 45 crafts |
| Creatures | **448**, including 33 bosses |
| Biomes | **37** |
| Crops · resource node types | **161 · 170** |
| Tiers of fish / trees / ores / herbs / runes… | **32 each** (fish: 33) — one unlock per level |

New characters wake on **Tūhura Isle**, a hand-built tutorial island of
fifteen keepers, and leave it by a crossing you'll want to see for yourself.
Then: press **X** to split into five bodies working in parallel; speak spells
out loud (hold **V**); run a workshop economy where goods carry their
maker's name; press **I** and see what the game thinks you love.

### Yours, forever — that's a feature

Our RPG is **free software**: the entire game — code (GPL-3.0), art and audio
(CC BY-SA) — lives at
**[github.com/dataversion5372/Taiao](https://github.com/dataversion5372/Taiao)**.
Clone it and it runs from a folder on your machine, offline, for as long as
computers run JavaScript. No publisher can delist it, no server shutdown can
brick it, and if you don't like a thing you can change it. The optional
community server is GPL too and self-hostable — the strongest form of the
promise. If this game matters to you, the repo *is* the game.

### Honest requirements

- **Desktop browser only** — recent Firefox, Chrome/Edge, or Safari with
  hardware acceleration on. **WebGL required.** No touch controls, no
  gamepad: **mouse + keyboard**.
- ~60 MB of game all told, and you're playing well before it finishes —
  the world starts after ~15 MB; the rest of the art streams in behind you.
  Birdsong and music arrive quietly later and cache. Without them the game
  still works — quieter skies.
- An **Accessibility** section in the Settings tab offers a UI text-size slider
  and a reduced-motion mode (static Bifrost crossing, no shakes or eased
  zooms); the system prefers-reduced-motion setting is honoured by default.
- **Saves are in your browser's storage.** Clearing site data for itch.io
  deletes them, and the itch embed and our-rpg.com are separate origins with
  separate saves — your account's cloud save is the bridge between them.
  (Playing from a clone of the repo skips all of this: no account, no
  server, your save stays in a browser profile you control.)
- **An account is required past Tūhura Isle** on this build (free, no email
  needed) — the world beyond the tutorial island is shared and live, with
  other real players in it.
- **Gameplay telemetry is on by default** — anonymous moves, clicks,
  crafting, fights and menu use (no chat text, no personal data; see
  [docs/telemetry.md](https://github.com/dataversion5372/Taiao/blob/main/docs/telemetry.md)).
  There's a per-player off switch in the Settings tab.
- Made for long sessions and slow evenings; combat exists but this is a
  gathering-crafting-wandering game first.

### Controls

Click to walk · click things to use them · **right-click everything** ·
**Enter** talk · **X** split · **Tab** switch selves · **V** speak a spell ·
**M** map · **J** journal · **B** bestiary · **I** Play Pulse ·
**K** postcard (a framed, shareable snapshot — everyone plays the same
world, so its coordinates work for any friend) · **?** full guide in the
sidebar.

### Credits & licensing

Art from Kenney.nl and Clint Bellanger (CC0) plus custom PixelLab and
hand-drawn sheets (CC BY-SA). Sound effects CC0. Bird recordings from
xeno-canto recordists (CC BY-NC-SA, distributed as an optional layer,
individually credited). Full credits in the repo.
Community: [the Workshop](https://our-rpg.com/workshop) ·
[GitHub Discussions](https://github.com/dataversion5372/Taiao/discussions) ·
Koha (support): [our-rpg.com/koha](https://our-rpg.com/koha) —
[what it funds](https://github.com/dataversion5372/Taiao/blob/main/docs/koha.md).

---

## Post-publish

- ⚠ Run `tools/publish_cdn_assets.sh` BEFORE uploading the lean zip — the
  zip ships without sfx/ambience/music/paperdolls and streams them from
  Taiao-cdn; until that publish runs, the CDN doesn't hold them.
- Verify the SW registers and caches under the itch subdirectory (sw.js is
  scope-relative as of taiao-v6) — check DevTools → Application → Cache
  Storage on the live page.
- Devlog #1: the Bifrost gif + "the repo is the game" story, cross-linked
  from the README.

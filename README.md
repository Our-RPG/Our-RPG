# Our RPG

*It began as **Taiao** — te reo Māori for the natural world, the living
world — and its world still carries that whakapapa: the birds, the koha,
the isle of Tūhura. The new name says the other true thing: this RPG
belongs to the people who play and build it.*

An offline, single-player RPG in the spirit of old-school tile-based browser MMOs
(RPG MO / early RuneScape), rendered HD-2D style: a WebGL world with a tilted
chase camera, depth fog, and billboarded pixel-art sprites, drawn by the game's
own three.js renderer (`js/render3d.js`). It runs entirely in your browser —
no server, no accounts, no telemetry, saves locally.

The world is **endless**: terrain streams in chunk by chunk in every direction,
forever, across 15,000²-tile named worlds with their own registry of towns,
roads, banks, portals and points of interest — and it is **alive**. Weather
fronts drift across it with real isobars and wind; the sun's shadows and colour
follow your latitude and the season, all the way to a midnight sun at the
poles; native birds sing, fly, and perch; rivers flood after long rain; snow
settles on roofs and melts again. Everyone plays the same world (seed 1337) —
a place you find is a place a friend can visit.

## Play

```
git clone https://github.com/dataversion5372/Taiao.git
cd Taiao
python3 tools/serve.py        # http://localhost:8899  (any static server works)
```

On a Mac you can just double-click **`Start Our RPG.command`**. A local server is
required because browsers refuse WebGL textures from `file://` pages. Needs a
WebGL-capable browser; hardware acceleration on.

New characters wake on **Tūhura Isle**, a hand-built tutorial island of fifteen
keepers — and leave it by a crossing you'll want to see for yourself.

## The world, by the numbers

| | |
|---|---|
| Trainable skills | **61** |
| Items | **2,942** |
| Recipes | **2,482** across 45 crafts |
| Creatures | **423**, including 33 bosses |
| Biomes | **37** |
| Crops · resource node types | **160 · 143** |
| Tiers of fish / trees / ores / herbs / runes / textiles… | **32 each**, one unlock per level |

## The living-world systems

- **Weather** — deterministic drifting fronts, geostrophic wind, orographic
  rain; a live barometer in the HUD and a full synoptic chart (isobars, fronts,
  wind barbs) on the world map.
- **Sun & seasons** — latitude-true solar geometry: shadow direction and length,
  golden-hour colour temperature, polar midnight sun; timezones (256 tiles/hour)
  with a continuous day/night terminator.
- **Birds of Aotearoa** — tūī, kākā, kea, ruru, pīwakawaka and dozens more fly,
  perch and sing (real field recordings, spatially mixed into a dawn chorus);
  extinct birds — huia, moa, pouākai — sing through their closest living
  relatives. Only an arrow can reach a bird on the wing.
- **Split selves** — press **X** to divide into up to five bodies, each with its
  own pack and gear, queueing real work in parallel. One soul, many hands.
- **Spoken magic** — spells are sentences of runes; type them, or hold **V**
  and say them aloud.
- **NPCs that answer** — villagers reply by in-browser semantic retrieval over
  tens of thousands of written lines (an optional local layer; see below), each
  with a stable personality, quirk, and life of their own — beds, doors,
  ladders, schedules.
- **A working economy** — production quality from inputs, skill, mastery, tool
  and station; goods that carry their maker's name; road-web bank networks;
  town delivery contracts; passive workshop jobs.
- **A world with consequences** — crops, kilns and livestock run on the real
  clock; heavy industry makes you *stink* until shopkeepers bar the door and
  you scrub with the right soap; locks, keys and night-time shop hours.
- **Boats** — from coracles ("a woven bowl that floats — mostly") to
  men-o'-war with real multi-tile hulls, rowing, river drift, and sea-bridge
  causeways to duck under.
- **Player Pulse** — press **I**: the game quietly journals what you seem to
  love and avoid, on your device only.

## What's in this repo — and what isn't

Everything needed to play is tracked: code, sprite atlases, sound effects,
ambience beds, music, fonts. Two heavier layers live in the companion
**[Taiao-cdn](https://github.com/dataversion5372/Taiao-cdn)** repo instead of
this one — and you don't need to do anything about that: when the game runs
from a tree that lacks them, its service worker **streams each file in
lazily** from Taiao-cdn the first time it's wanted, then caches it for good.
Fully offline (or with the fetch blocked), the game still runs fine — quiet
skies, and villagers who speak from a small built-in starter pool baked into
`js/gameplay/npc-chat.js`:

- **Bird recordings** — originally from [xeno-canto](https://xeno-canto.org)
  via `tools/fetch_birdsong.py`. The recordings are **CC BY-NC-SA**
  (non-commercial) and so are distributed from Taiao-cdn rather than inside
  this repository's CC BY-SA asset grant; the per-clip attribution text
  ships both here (`assets/birdsong/CREDITS.txt`) and beside the audio.
- **NPC dialogue bank + embedding model + ONNX runtime** (~150 MB, fetched
  only when an NPC is actually in earshot) — build pipeline in
  `tools/npc_dialogue/` (see its README for provenance and licensing notes).
  The starter pool remains the offline fallback, so chat (including the Sky
  Knoll's Skywatcher) always works.

Maintainers refresh Taiao-cdn with `tools/publish_cdn_assets.sh`.

## Building & hacking

The code layer is plain classic scripts, concatenated in the order listed in
`tools/bundle.list` and minified with esbuild:

```
npm install          # esbuild only
node tools/build.mjs # -> dist/bundle.js  (rerun after any js/ edit)
```

`DEV_MODE` (`js/main/assets.js`) is a compile-time switch for the development
tools (max skills, cheats panel, separate dev save). A headless-testing recipe
lives in `.claude/skills/verify/`.

The game builds and runs completely offline with no server at all. An
optional Cloudflare Worker (`server/`) adds accounts, a save vault, synced
workshop votes, and a shared world layer — see
[docs/SPEC.md](docs/SPEC.md) for what it does and [server/README.md](server/README.md)
for how to run it.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
The in-game **object workshop** (right-click → "Edit …") lets anyone
re-sprite objects and vote on their behaviour locally, then bundle a
proposal with **"Export my proposal"** and submit it as an issue for a
maintainer to fold in by hand; the [artist walkthrough](docs/artist-guide.md)
covers the whole loop, and [GOVERNANCE.md](GOVERNANCE.md) covers how that
review works and how curators get involved. If you build something — art,
code, worlds, maps of far places — it can carry your name in-game, the same
way a crafted barrel carries its cooper's.

Questions or ideas that don't fit an issue yet belong in
[GitHub Discussions](https://github.com/dataversion5372/Taiao/discussions) —
the project's one community channel, also linked from
[our-rpg.com/home](https://our-rpg.com/home). This project follows
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Credits

- **Art**: [Kenney.nl](https://kenney.nl) "Roguelike/RPG pack" & "Roguelike
  Characters" (CC0); "Tiny Creatures" by Clint Bellanger —
  [clintbellanger.net](https://clintbellanger.net) (CC0); painted biome
  terrain, item, and creature tilesheets custom-generated for this game with
  [PixelLab](https://www.pixellab.ai), plus hand-drawn sprites (all released
  under this repo's CC BY-SA grant). License texts in `assets/`.
- **Sound effects**: CC0, from Kenney.nl audio packs and OpenGameArt
  (rubberduck; Iwan Gabovitch) — every file credited in
  `assets/sfx/CREDITS.txt`.
- **Bird recordings** (optional layer, not distributed with this repo — see
  "What's in this repo" above): xeno-canto recordists, CC BY-NC-SA,
  individually credited in `assets/birdsong/CREDITS.txt`, which ships even
  though the clips it describes don't; `tools/fetch_birdsong.py` regenerates
  it alongside the audio if you fetch your own copy.
- **Font**: [OpenDyslexic](https://opendyslexic.org) (SIL OFL 1.1 —
  `fonts/OFL.txt`), the default UI face.
- **Vendored libraries**: [three.js](https://threejs.org) r147 (MIT);
  [XaoS.js](https://github.com/xaos-project/XaoSjs) fractal zoomer (GPL —
  Jan Hubicka, Thomas Marsh, Andrea Medeghini, John B. Langston III) — it
  powers the graduation crossing.
- Code written by Claude.

## Licensing

Our RPG is free — and licensed so that it stays that way, permanently.
No one, including its original creator, can ever close it, take it from
its community, or sell it out from under the people who play and build it.
If its stewardship ever went wrong, anyone could fork it and carry on.

- **Code** — [GNU GPL-3.0-or-later](LICENSE). You may play, study, modify
  and share it; anything built from it must stay just as free.
- **Original assets** made for Our RPG (the painted terrain/item/fish
  tilesheets, generated sprite atlases, docs and dialogue written for the
  game) — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/):
  share and adapt with credit, under the same terms.
- **Third-party assets** keep their own licenses: Kenney.nl and Tiny
  Creatures art are CC0 (license texts in `assets/`), three.js is MIT,
  XaoS.js is GPL, OpenDyslexic is SIL OFL 1.1, sound effects are CC0
  (credited in `assets/sfx/CREDITS.txt`), and the optional bird-recording
  layer is xeno-canto CC BY-NC-SA, individually credited alongside the
  clips — the NC term means that layer may never be sold by anyone.

None of this requires your money to keep working. If you ever want to leave
something for the road anyway, [docs/koha.md](docs/koha.md) says, honestly,
what it would and wouldn't fund — koha (a gift, freely given) is at
[our-rpg.com/koha](https://our-rpg.com/koha).

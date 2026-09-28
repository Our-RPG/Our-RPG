# Taiao Workshop

A standalone companion app for the Taiao game — formerly "PixelLab Studio":
generate and customise the game's sprites with the
[PixelLab.ai](https://www.pixellab.ai) API, give characters names, bios,
spawning rules and triggers, design alternative **costumes / states**, and let
the community **vote** on which costumes make it into the game — crediting
each winning costume to its maker.

It resembles the flow of `pixellab.ai/create-character` and
`pixellab.ai/create-object`, and adds variant states, animations and
8-direction rotations in the same manner.

## Running it

The studio is plain HTML/JS — no build step. Serve the **game repo root** (so
the studio can read the game's roster data at `../js/sprites/…`) and open
`/studio/`:

```bash
cd /Users/finndwyer/RPG
python3 -m http.server 8899        # origin the Taiao worker already allows
# → http://localhost:8899/studio/
```

Port **8899** matters: the Taiao worker's `ALLOWED_ORIGINS` already permits
`http://localhost:8899`, so community voting works in dev. When you deploy the
studio somewhere public, add that origin to the worker's `ALLOWED_ORIGINS`.

## Deploying

The studio also builds into a fully self-contained static site (one prebuilt
bundle + every runtime asset) that any static host can serve — see
[`DEPLOY.md`](./DEPLOY.md) for the build/deploy steps, wiring the new origin
into the server, and why passkeys are per-domain by design.

## Two accounts, kept apart

- **PixelLab API key** — generates the art. Stored **only in this browser**
  (localStorage, obfuscated at rest) and sent **only** to `api.pixellab.ai`
  over TLS. Get one at [pixellab.ai/account](https://pixellab.ai/account).
  Never sent to the Taiao server. Clear it on shared machines (Settings →
  Forget key).
- **Taiao account** — the same login as the game, used for community voting and
  crediting. Only needed to vote or share a costume; browsing is public.

## Ideas — mechanic proposals + a BYO-key AI copilot

The **Ideas** tab is a fourth proposal pillar alongside art/data/sounds/quests: a player
pitches a rough mechanic or system idea and, optionally, develops it into a grounded design
doc with an AI copilot — their **own Anthropic API key**, entered in Settings, stored only in
this browser and sent only to `api.anthropic.com`, never to the Taiao server — before
submitting it as a normal `taiao-mechanic/1` proposal on the existing "data" lane (auto-open
for voting; curators can adopt, same as everything else here). The copilot is grounded in
`js/context-pack.js`, a codebase digest (every real source file's own narrated header
comment, not the full source) built by `tools/gen_context.mjs`; re-run
`node studio/tools/gen_context.mjs` whenever files or systems change so the copilot keeps
citing what actually exists instead of what used to.

## A communal data browser + workshop

The studio is a **shared, public space** — anyone can browse and view every
in-game asset and everyone's generations, no login needed. It loads a slice of
the game's own data layer (`data.js`, `content.js`, the sprite atlases, …) so
**all in-game code data is viewable on the site**. There is no separate
"community" tab — everything here is already communal.

**One tab per asset type**, each a catalog of everything the game currently
ships, drawn from the game's own atlases via a self-contained SPR resolver:

- **Characters** (223) · **Objects** (593) · **Monsters** (385) · **Biomes**
  (234 ground tiles, labelled with real biome names) · **Icons** (350 map/gear
  icons) · **Sounds** (198).

The **Sounds** tab is a table: each clip has an inline play button, its category,
its **trigger** — the real in-game event id that plays it (the exact key passed to
`sfx()`/`SFX.play()` in `js/audio.js`; a file's id is its base name with the variant
number stripped, e.g. `swing0.ogg` → `swing`) — and a **keep/remove** vote. Players
can also **upload their own sounds** (audio file + name + category + event-id
trigger) as workshop proposals, which appear as extra votable rows.

The **Triggers** tab is a catalog of every real in-game trigger — the named event
moments the game fires (the `sfx()` event ids from `js/audio.js`). Firing a trigger
runs a whole set of **events**, not just a sound: e.g. `arrowhit` deals ranged
damage to the target, awards Archery/Health XP, may kill the monster, and plays the
arrowhit sound. The table lists each trigger with its event count and a summary of
the effects (no categories, no inline audio). Clicking a trigger opens its page
(`triggers/trigger.html?id=<id>`) listing **all events fired when it triggers** —
authored from the game code (combat, gathering, crafting, items, movement, doors,
portals, progression…) in `GAME_TRIGGER_EVENTS` (js/pages/triggers.js) — plus the
`play_sound` event with its variant clips (one chosen at random), and any
**community-proposed events** (votable keep/remove, with a propose-an-event form).
Each page also shows the **actual game code** that fires the trigger: the studio is
served from the game repo root, so the page fetches the real source file and renders
the block around the trigger's call site (with its file:line + function). The
catalog also includes **non-sound triggers** — real game moments that fire effects
but play no sound (monster spawn/respawn, aggro, status/burn ticks, husbandry
harvest/breed/feed, player respawn, quest accept/advance, quest-points, XP gain,
autosave, …). The trigger ids in the Sounds table link straight here.

Click any asset for its **detail page** — the game's own art plus its raw
in-game data (the actual code object).

**Monsters** are listed **once per spawn biome**: a creature that spawns in
Desert, Swamp and Wetlands appears as "Adder (Desert)", "Adder (Swamp)" and
"Adder (Wetlands)" — three listings, each with its own page and id
(`<monsterKey>$<biome>`), so the community can vote a **different level and drop
table per biome**. In the actual game they are all the one monster ("Adder"),
sharing one sprite and base stats. Which biomes a monster inhabits is read from
**both** of the game's biome sources: the `BIOME_MOB_NAMES` wild-spawn tables (plus
the custom-mob and bird additions loaded at runtime) and the `ANIMAL_BIOME` map in
`js/world/features.js` that places husbandry livestock and tendable exotics (camels
in deserts, alpacas in the cold highlands, waterfowl in wetlands, griffons/aurochs/
wyrmlings in their wilds). `features.js` isn't loaded here, so that map is mirrored
in `providers-extra.js`. The lookup resolves every listed name to its real monster
key (display names don't always slugify to their key) and carries each habitat down
to a monster's raised variants — elite (`_v`), juvenile (`_baby`) and giant-baby
(`_v_baby`) — so no wild or farmable monster is left biomeless. Creatures the game
defines but never seeds in the wild by biome (bosses, summons, celestials, the
dragon/knight/elemental families and a handful of unplaced beasts) are given
**sensible default habitats** via a third map, `STUDIO_EXTRA_BIOME`, in
`providers-extra.js` — so every monster has biome listings to vote on. Those
defaults are studio proposals, not mirrored from game code, and the community can
vote to change them.

Each listing shows a full sheet: name, level, derived height/width/speed,
billboard scale, HP/hit/defence/attack-speed, XP, aggression, respawn delay,
variants, the **drop table**, husbandry/harvest yield (dropped on death —
butchering is no longer a skill), and **spawn biomes + boundary rules** — plus
temperament/flight/stat votes and community animations & triggers.
Single-sprite monsters repeat their one sprite across all 8 directions
(mirrored on the west-facing side); the **Sprites** tab collapses a monster's
biome variants back into one shared-art row. **Objects** show name, examine text,
crafting-station role, resource-node text and the 8-direction sprites.

The **Items** tab is purely gameplay data (like World Objects / Monsters): each row
is an item — icon + name (→ its item page), item id, a **Sprite** link across to the
Sprites tab, and its gameplay fields (equip slot, use/heals, stack, value). Item
**art and provenance** (Human/AI, artist/prompter) live on the **Sprites** tab,
which now lists item icons too — deduped to one row per icon key (its sprite id),
since many items share an icon. Item sprite pages are keyed by icon key so they
never clash with an object of the same name (e.g. the *chair* item vs the *chair*
object).

**Characters** get the fullest treatment:

- the **original prompt** (the source art key it was generated from);
- **every state × all 8 directions** (Idle from the character sheet, other
  outfits from the packed outfit sheets);
- a **player / NPC** vote and per-**stat** votes (height, weight, speed,
  toughness — the real values from `character-stats.js`);
- **animations** and **animation-event / state-change triggers** contributed by
  the community, with the ability to **attach an animation to a state** in a
  draft;
- every community **generation & costume** for it, with voting.

A state can also be **carved** instead of generated: the editor's **Subtract**
dialog diffs two aligned looks of the *same* character per direction — a
"costume" (keep what's new) minus a "base" (subtract away) — rather than the
old single, misaligned game sprite. Either side can be a project state, the
project's own base art, or, when the project's folder matches a real game
character, that character's actual Idle/outfit sheet — pixel-aligned per
direction, unlike a lone SPR sprite (the same frame reused for every
direction), which is kept only as a fallback for characters the studio
doesn't recognise. An optional despeckle pass mops up the stray
anti-aliased pixels a diff between two not-quite-identical frames tends to
leave. The result is a **part**: a transparent overlay (a helm, a cloak, a
pauldron…) tagged with equip-item **trigger(s)**. Once shared and accepted,
the game's wardrobe-parts runtime (`js/gameplay/wardrobe-parts.js`) draws it
over a matching character's billboard the instant one of those items is
equipped — merged into the existing armour-overlay render slot in
`render3d.js` rather than given a mesh of its own.

Generatable types (characters, objects, monsters) also carry a collapsible
**Create** panel — 8-direction sprites (`create-character-v3` /
`create-8-direction-object`), a quick frame (`generate-image-pixflux`),
animations (`animate-with-text-v3`), rotations (`generate-8-rotations-v3`) — plus
**community generations** and **your drafts** (local until you publish).

Shared work rides the game's existing **workshop** unchanged: each shared item
is a **proposal** (art + maker, CC BY-SA 4.0); costume/generation votes are
**endorsements**, and player/NPC & stat votes are exclusive **ballots**. Rival
depictions sit together; the most-voted is crowned and credited to its maker.
Nothing auto-applies — a curator reviews every accepted piece (see
`../GOVERNANCE.md`).

**Provenance & disclosure.** Every upload-sourced submission (costume art,
icons, sounds) is asked one honest question before it leaves the browser:
*my own work*, or *AI-made — disclosed*? (`Taiao.submitProposal`'s
`provenance` arg, `askProvenance()` in `js/util.js`.) Upload your own work,
or AI work you disclose as AI — either ships. Undisclosed AI art gets removed
when found, and repeat offenders lose the bench; curators decline anything
flagged that way on review. Accepted costumes show a small "hand-made" /
"AI-made · disclosed" badge alongside their credit. (This is separate from
the Sprites tab's Human/AI column above, which classifies already-*shipped*
art by its spritesheet, not what a maker declared at submit time.)

### How the game data is loaded

`index.html` pulls in a curated, load-clean slice of the game's data files
(verified to populate `SPR`, `MONSTERS`, `OBJ_MAP`, `BIOME_GROUND_VARIANTS`,
`MAP_ICON_TYPES`, `CHAR_STATS`, …). `js/game-shim.js` predefines the sheet
metadata those files expect (normally set by the game's `main/assets.js`, which
we don't load because it boots the live game canvas). `js/sound-manifest.js` is
generated by scanning `assets/{sfx,birdsong,ambience,music}`. All of it is
optional — served apart from the game, the affected catalogs are simply empty.

Finished art is meant to drop into
`assets/families_source/<folder>/<state>/rotations/<dir>.png` for a pull
request. **Download set** on a project exports everything (art inline as data
URLs) as a JSON bundle to work from.

## Files

```
studio/
  index.html            app shell (loads the game data slice + the scripts below)
  css/studio.css        the atelier theme (ngahere night + aurora + bone; Fraunces & Big Shoulders)
  fonts/                two vendored OFL variable fonts (see fonts/LICENSE.txt)
  js/
    game-shim.js        predefines sheet metadata for the game data files
    sound-manifest.js   generated list of assets/{sfx,birdsong,ambience,music}
    config.js           endpoints, PixelLab enums, game vocabulary
    util.js             DOM kit, image/base64 + lazy-thumbnail helpers
    store.js            IndexedDB draft library
    pixellab.js         PixelLab client + in-browser key storage
    taiao.js            Taiao auth + workshop (proposals, endorsements, ballots)
    fx.js               atmosphere: hero night-sky canvas, reveals, sprite frieze
    roster.js           game characters/objects: catalog, states×dirs, stats
    providers.js        per-type providers (character/object) + registry
    providers-extra.js  SPR resolver + monster/tile/ui/sound providers
    dupe-scan.js         the "declares 8 directions, wears one sprite" audit (Needs art hub)
    pages/…             home · profile · settings · catalog (any type) · detail · editor · zones
    page-shell.js       multi-page shell: top bar, tab routing, page dispatch
  tools/
    prerender-zone.mjs   offline zone bake: terrain PNG + features (+ NPCs)
    zone-npcs.mjs        headless NPC extractor for a zone (real world engine)
    bake-common.mjs      shared pass list + page template (bake-server.mjs ∩ bake-zone.mjs)
    bake-server.mjs      local bake server behind the Zones tab's "Generate zone" button
    bake-zone.mjs        CLI twin of that button — one command, six passes, NPC pages too
    update-zone-index.mjs  rebuilds items-index.json's `zonenpc` (static NPC-page ids)
```

No secrets are committed; the studio is inert until you add your own PixelLab
key and (optionally) sign in.

## Zones tab — baked terrain, features & NPCs

The **Zones** tab shows a whole 15000×15000-tile zone from the game's *real*
world engine (seed 1337). Each zone is a static page `studio/zones/<zx>.<zy>.html`
(e.g. `0.0.html`), one per baked manifest. The coordinate form **Views** a baked
zone or **Generates** an unbaked one: entering coords that aren't baked shows a
"Generate zone" button that streams a live progress bar from the local **bake
server** and, when done, writes that zone's page and flips to "View zone" (one
bake at a time). The bake server can't run inside the static file server, so run
it alongside:

```
# terminal 1 — serve the repo root (static)
python3 -m http.server 8899
# terminal 2 — the zone bake server (port 8898), which the Zones tab talks to
node studio/tools/bake-server.mjs
```

It runs the same passes below (terrain+features → NPCs → cities → monsters → merge
→ biomes) — tables + overview parity, ~1–2 h; NOT the multi-hour deep-zoom tile
bake. Because generating a zone is expensive, everything is pre-baked to
`studio/assets/zones/` and the page just loads it.

**From a terminal**, the one-command CLI twin of that button is
`bake-zone.mjs` — same six passes, same order (`tools/bake-common.mjs` is the
one shared pass list + page template, so the button and the CLI can't drift
apart), and it automatically regenerates the NPC static pages + page shell
afterwards so the whole studio is locally consistent in one shot:

```
node studio/tools/bake-zone.mjs --zx 1 --zy 0            # bake zone 1,0
node studio/tools/bake-zone.mjs --zx 1 --zy 0 --fast      # cities pass skips POIs
node studio/tools/bake-zone.mjs --zx 1 --zy 0 --min 3e6   # custom shire-merge threshold
```

NPCs is the slow pass (~15–40 min, the real chunk engine); the rest are minutes
each. See `DEPLOY.md` → "Baking new zones" for the full story (what it produces,
committing vs. not, publishing the bake for good).

You can also run the individual passes by hand (what `bake-zone.mjs` does under
the hood):

```
# terrain PNG + settlements/roads/rivers (fast — minutes)
node studio/tools/prerender-zone.mjs --zx 0 --zy 0

# add the zone's NPCs to that manifest (SLOW — the real chunk engine runs over
# every settlement across CPU cores; ~15–40 min per zone)
node studio/tools/prerender-zone.mjs --zx 0 --zy 0 --npcsonly
#   …or bake terrain + features + NPCs in one pass with --npcs
```

`tools/zone-npcs.mjs` is the NPC extractor (also usable standalone). It runs the
game's actual `deriveNpcs` (shopkeepers, bankers, the Registrar/Weaver, quest
givers) plus the ported resident/quest-giver placement, so each NPC lands on its
**exact spawn tile**.

Every NPC is then bound to its **nearest city** (the city-centre spawn fountain)
and named **`<name> of <City>`** — e.g. `Nezahual of Merskmersk`. Base names are
made unique **per city** (a duplicate is swapped for a culturally-similar unused
name from the `js/world/npc-names.js` pools), so no two NPCs of a city share a
name, while the `of <City>` suffix separates same-named folk across cities.
Hand-authored singletons (the Registrar, Weaver, Newhaven quest-givers, Sten)
keep their curated names. The manifest's `npcs[]` carries each NPC's zone-local
`lx,ly`, role, title, home settlement, bound `city`, and mix-roster index.

Everything else in the zone is bound to its nearest city too. Everything else is bound to its nearest city fountain too — the area a fountain
owns is its **shire**. Two more passes build the shire dossiers:

- `--citiesonly` writes `cities[]`: per shire, its size in tiles, bound
  settlements, the stations their buildings hold (with per-instance coordinates),
  the POIs nearest the fountain, and the **banks** grouped by banking company
  (road-connected network) with each bank's coordinates and the network's **main
  branch**. (`--nopois` skips the slow POI generation.)
- `--monstersonly [--radius 130]` writes `monsters[]`: the REAL monster spawn
  instances the engine seeds in the wild around each fountain (generated by the
  chunk pipeline), each with its tile, biome, level and aggression.

The **zone map** draws the shires as translucent Voronoi overlays (each fountain's
catchment) with boundaries and labels; **double-click a shire** to zoom the map
viewer to its bounds.

The Zones tab also shows one **collapsible “<City> shire” section** per fountain.
Expanding it renders **tables** — biomes, NPCs, monsters, banks, stations, quests,
towns/villages and POIs. The **biomes** table lists how many tiles of each biome the
shire covers (its share of the shire); the **NPCs** table lists every bound NPC with
its sprite, single name, coordinates, shopkeeper/quest-start flags and home settlement
(each name links to that NPC's own page). The votable columns carry a 🗳 vote glyph (keep/remove a row, flip a
monster's aggression, remove or propose a spawn/instance) riding the game's normal
workshop ballot. A row's **locations** cell expands to every instance's
coordinates + biome, each individually votable. In the Quests table each row shows the quest's **name** (a link to the **Quests**
tab), its **quest start** (the giver) and a **code** expander with the full
QuestScript source.

Every quest has a **unique name** and a **unique snake_case id**, and full
QuestScript. The hand-authored Newhaven quests + objects use their `.qs` source;
each procedural wilderness encounter is a **proper multi-act quest** — accept →
objective → complication → a branching moral/strategic choice → distinct endings —
generated deterministically from the giver's position + the local bestiary, in one
of three story frameworks (the raiders' trail / winter stores / the beast of the
shire), using only items & mobs the game already ships. `allQuests()` is the single
canonical source shared by the Zones tab and the **Quests** tab, so links always
match. Some givers hand out a short **series** — 2–3 chained quests from the same
NPC, each gated on finishing the previous one — and quests may also require a
**skill level** or a **quest-point** total before they can be accepted; these gates
are real QuestScript (`quests[prev] < 4`, `skill_lvl(Skill) < N`, `qp() < N`, using
the `skill_lvl` stdlib reader) injected at the accept branch with tailored refusal
dialogue. The **Quests** tab lists *every* quest in the game (currently all loaded
from zone 0,0) in one **table**: quest name (links to its detail card), the
quest-start NPC (with its sprite, full name, linking to that NPC's page), start
coordinates, **prerequisites** (prior quest links · skill icon + level · quest
points), and **rewards** — one line per reward type with its real game icon (the
coin item icon, the skill's own icon for XP), an absolute quantity each. The detail
card shows the same facts plus the whole QuestScript.

Finally, small shires are consolidated: starting from the smallest, any shire
below **2,250,000 tiles** is absorbed into its closest neighbouring fountain until
every remaining shire meets the threshold, then NPC names are recalibrated so no
two NPCs in a (merged) shire share a name. This is a pure post-process over the
baked manifest (no chunk-gen).

```
node studio/tools/prerender-zone.mjs --zx 0 --zy 0 --npcsonly       # NPCs (~15-40 min)
node studio/tools/prerender-zone.mjs --zx 0 --zy 0 --citiesonly     # shire dossiers (+POIs)
node studio/tools/prerender-zone.mjs --zx 0 --zy 0 --monstersonly   # real wild monster spawns
node studio/tools/prerender-zone.mjs --zx 0 --zy 0 --mergeshires    # consolidate + rename (--min N)
node studio/tools/prerender-zone.mjs --zx 0 --zy 0 --biomesonly     # per-shire biome tile histograms (--step N)
```

`--biomesonly` re-samples the zone grid over each fountain's catchment and classifies
every sample by biome, attributing it to the shire that now owns that fountain — so it
can be run on an already-merged manifest (each shire's biome tile counts sum to its
`areaTiles`). Fresh `--citiesonly` bakes and `--mergeshires` now compute/merge biomes
automatically.

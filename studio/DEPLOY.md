# Deploying Our RPG Workshop

> **Canonical deployment (2026-09-29): the Workshop ships as part of the
> our-rpg.com site.** `tools/build_ourrpg_site.sh` at the repo root builds
> one static tree — game at `/`, Workshop at `/workshop` — and the
> taiao-server worker is routed at `our-rpg.com/api/*` (see
> `server/wrangler.toml`), so the Workshop calls the API **same-origin: the
> CORS/ALLOWED_ORIGINS and pages.dev steps below only matter for a
> standalone-Pages deployment**, which is now the fallback path, not the
> primary one. The build mechanics below (build_site.mjs, zone baking, gap
> pushing, D1 migrations, secrets) all still apply unchanged.

The Workshop (`studio/`) is plain HTML/JS with no build step for local dev
(`python3 -m http.server 8899` at the repo root, see `studio/README.md`), but
shipping it as its own public site needs one prebuilt bundle instead of
~150 dev `<script>` tags, plus every asset it fetches at runtime. That's what
`studio/tools/build_site.mjs` assembles, into `studio/dist/site/` (gitignored
— it's a deploy artifact, not source, same as `dist/bundle.js` for the game
in spirit but never itself committed).

## Build order

```bash
node tools/build.mjs                    # regenerates js/lua/lua-src-gen.js (needed below)
node studio/tools/gen_gaps.mjs          # refreshes studio/js/gaps-data.js (needs-art gating)
node studio/tools/build_site.mjs        # assembles studio/dist/site/  (add --tiles for deep-zoom)
```

`build_site.mjs` refuses to run if `js/lua/lua-src-gen.js` is missing (it's
gitignored — every fresh checkout needs step 1 at least once). It prints a
per-step file/size report and a final tree summary when it finishes.

## Baking new zones

A zone only shows up in the Workshop (Zones/NPC/Quests tabs, and the site
build) once it's baked locally — the game's real world generation runs
offline into `studio/assets/zones/zone_<zx>_<zy>.{json,png}`. One command
does the whole thing:

```bash
node studio/tools/bake-zone.mjs --zx 1 --zy 0        # bake zone 1,0
node studio/tools/bake-zone.mjs --zx 1 --zy 0 --fast # skip per-POI names (faster)
```

It runs the same six passes as the Zones tab's "Generate zone" button
(terrain & features → NPCs → shire dossiers & POIs → monster spawns → merge
shires → biome histograms — `studio/tools/bake-common.mjs` is the one shared
pass list, so the button and the CLI can never drift apart), then
automatically regenerates the NPC static pages (`update-zone-index.mjs`) and
the page shell (`gen_pages.mjs`) — one command leaves the whole studio
locally consistent: zone page, NPC pages, quests visible (quests read the
zone JSON directly at runtime, no index step of their own).

Expected wall-time per pass (real multi-core machine): terrain & features a
minute or two; **NPCs is the long one, 15–40 minutes** (the real in-game NPC
pipeline); cities/monsters/merge/biomes a few minutes each. Budget the
better part of an hour for a whole zone.

`--min <tiles>` overrides the shire-merge threshold (default 4,500,000,
matching `prerender-zone.mjs`'s own default).

Baking is a **local** step — `bake-server.mjs`/`bake-zone.mjs` both need
the real game code on disk and run outside any deployed site. Once a zone is
baked:

- Committing `studio/assets/zones/zone_<zx>_<zy>.{json,png}` to git is
  **optional, your call** — the Workshop reads them straight off disk either
  way. Deep-zoom tile pyramids (`assets/zones/*_tiles/`) are a different
  story and stay off git / out of the site bundle by default (see below).
- **Publish for good** = rebuild and redeploy the site so everyone sees it:
  ```bash
  node studio/tools/build_site.mjs
  npx wrangler pages deploy studio/dist/site --project-name taiao-workshop
  ```
  (see "Build order" / "Deploy" above — `build_site.mjs` copies whatever's
  under `studio/assets/zones/` into the site automatically.)

## Deploy

```bash
npx wrangler pages deploy studio/dist/site --project-name taiao-workshop
```

Any static host works — the output is just files — but the repo already
targets Cloudflare Pages alongside the existing Worker (`server/`).

## Wiring the new origin into the server

Passkeys and CORS are both origin-gated, so the freshly deployed domain has
to be added to the Worker before sign-in works there:

1. Add the Pages origin to `ALLOWED_ORIGINS` in `server/wrangler.toml:34`
   (a commented example line is already there) and `wrangler deploy` the
   worker.
2. Apply the new migrations against the production database (if not already
   applied): migrations `0002` and `0003` —
   ```bash
   wrangler d1 execute taiao --remote --file=server/migrations/0002_proposal_flags.sql
   wrangler d1 execute taiao --remote --file=server/migrations/0003_link_codes.sql
   ```
3. Push the current gap manifest to the live server (needs `$ADMIN_TOKEN`):
   ```bash
   ADMIN_TOKEN=... node studio/tools/gen_gaps.mjs --push
   ```

## Passkeys are per-domain — that's intentional

WebAuthn scopes a credential to the domain it was created on
(`server/src/passkeys.js` `rpIdFor`). A passkey registered on itch stays an
itch passkey; a passkey registered on the Workshop domain is a *separate*
credential there. This isn't a bug to work around — it's what keeps a stolen
Workshop-domain credential from being usable against the game's origin, and
vice versa.

Itch players who want to reach the Workshop without registering a second
passkey (or a password) sign in with a **Workshop code** instead: the game's
Account panel (`Workshop code` button, next to `Add a passkey`) mints a
one-time, 10-minute code; pasting it into the Workshop's Settings page
(`Sign in with code`) redeems it for a real session there. This exists
specifically because itch serves the game from its own origin and this
browser's `localStorage` session token can't cross over to the Workshop's
domain — see `server/src/link.js`.

## Custom domains

Point a custom domain at the Pages project in the Cloudflare dashboard, then
add *that* domain (not just the `*.pages.dev` one) to `ALLOWED_ORIGINS` —
passkeys and CORS both check the real serving origin, not the Pages project
name.

## Deep-zoom zone tiles are excluded by default

`assets/zones/*_tiles/` (per-zone deep-zoom imagery) runs to roughly 650MB
and does not belong in the site bundle or in git. `build_site.mjs` skips
those directories unless you pass `--tiles`; in production they belong on
R2 or a CDN (the same pattern the game itself uses for birdsong audio — see
`docs/`/README "CDN asset layers") — never committed, never shipped inline
with the rest of the static site.

## `studio/dist/` is gitignored

The whole build output directory is a deploy artifact. Re-run the build
order above any time the game data, the studio's own pages, or its assets
change before redeploying — nothing under `studio/dist/` is meant to be
hand-edited or committed.

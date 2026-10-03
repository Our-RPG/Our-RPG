# Taiao systems spec — Phases 0-2

*Status: all three phases below are built, merged to `main`, and verified
(see [Verification log](#verification-log)). This document is the canonical
in-repo reference for the "audit §N" section numbers cited throughout the
code — those citations point here now, not to an external design doc.*

Taiao's offline game is complete and self-sufficient; everything in this
document is optional, additive infrastructure from the *codebase's*
perspective. The client always builds with `TAIAO_SERVER_URL` empty by
default, and every net-facing module is written to no-op cleanly in that
case — logged-out play, or a build with no server configured at all, is
exactly the serverless game this project started as. But the canonical
hosted deployment (our-rpg.com, and the itch.io embed that mirrors it)
builds *with* `TAIAO_SERVER_URL` set, so for anyone playing there this
infrastructure isn't optional at all past the tutorial island — see
`js/net/gate-ui.js`. Nothing here is required reading to play or to hack on
the game; it matters if you're standing up your own server or auditing what
it does.

## Phase 0 — keep the magic (client-only)

No server involved; ships in every build.

- **Post-Bifrost goals arc** (`js/gameplay/goals-arc.js`, `GoalsArc`) — a
  "first days in Newhaven" quest thread that picks up where the tutorial
  island's goal ladder leaves off.
- **Smith forge ledger** halved with a perfect-firing bonus (`js/skills/*`,
  `js/gameplay/tutorial.js`).
- **25 easter eggs** (`js/gameplay/eggs.js`, `Eggs`) — cheap-by-design
  secrets riding existing systems (decor examine, the POI lattice,
  birdflight, the split roster, the bank). Discovered, never announced;
  first discovery per save lands in `player.quests.flags` and is reported
  to Play Pulse (`Pulse.noteEgg`). Deliberately carries no Māori narrative
  figures — that waits for cultural consultation, tracked as **§6.5** below.
- **Generative music layer + Bifrost theme** (`js/gameplay/music.js`,
  `MUSIC`) — synthesized live from world state (latitude, daylight, cloud
  cover, wind, storms), not a recording; cinematic themes are recorded
  tracks in `assets/music/`.
- **Ambience beds** (wind/ocean) and the **Dream Forest pocket interior**
  (`js/gameplay/dream.js`).
- **Te Kairaranga, the Weaver** (`js/gameplay/wizard.js`, `Wizard`) — a
  plaza NPC beside the Registrar who teaches the chant-magic sentence
  grammar and gifts a wand + starter runes, fixing chant magic being
  otherwise undiscoverable (the isle deliberately teaches no magic).
- **Settings** (`js/main/settings.js`) — font/UI scale and a reduced-motion
  preference (`reducedMotion()`), read by `bifrost.js` and `dream.js`.
- **Web-zip build + CDN asset streaming** — `tools/build_web_zip.sh`
  produces a self-contained static bundle (verified: ~60 MB, builds
  cleanly); `sw.js` streams two heavy optional layers (bird recordings,
  the NPC dialogue bank + embedding model) from the companion
  **Taiao-cdn** repo lazily, caching after first fetch, with the game
  fully playable offline if that fetch never happens. `docs/itch-page.md`
  is the itch.io listing draft.

## Phase 1 — the tiny server that counts

One Cloudflare Worker (`server/`: Workers + D1 + R2), entirely optional.
Logged out, nothing on this path ever runs. Licensed GPL-3.0-or-later like
the rest of the repo — the server being open and self-hostable is part of
the "can never be taken from you" story ([GOVERNANCE.md](../GOVERNANCE.md)).

- **Accounts** — username + password (argon2id via `@noble/hashes`),
  optional WebAuthn passkeys, optional recovery email
  (`server/src/auth.js`, `server/src/passkeys.js`).
- **Save vault** — versioned save blobs in R2, last 15 versions per
  `(user, slot)`, restorable on any device (`server/src/saves.js`,
  `js/net/savesync.js`).
- **Collective workshop sync (§3)** — the client's local ballot-box
  (`js/gameplay/objedit.js`) syncs votes up and pulls community tallies
  down when logged in (`server/src/workshop.js`, `js/net/worksync.js`); a
  weekly digest (Mondays 09:00 UTC) posts to GitHub Discussions when
  `GITHUB_TOKEN`/`GITHUB_REPO` are set, and is always readable at
  `GET /api/workshop/digest/latest`. Votes inform the curator; they never
  auto-apply — [GOVERNANCE.md](../GOVERNANCE.md) still means a human reads
  every proposal.
- **§10 — the curator submission path, in two rungs:**
  - *Rung 1* (client-only, no account needed): the object workshop's
    **"Export my proposal"** button (`js/gameplay/objedit.js`) bundles
    votes/props/uploaded art for one object into a downloadable `.json`,
    submitted by hand as a GitHub issue
    (`.github/ISSUE_TEMPLATE/workshop_proposal.md`,
    [CONTRIBUTING.md](../CONTRIBUTING.md),
    [docs/artist-guide.md](artist-guide.md)).
  - *Rung 2* (logged in): the same payload can instead go straight to the
    server's curator queue — `POST /api/workshop/proposal` with an explicit
    licence grant (`CC-BY-SA-4.0` or `GPL-3.0-or-later`), browsable via
    `GET /api/workshop/proposals`/`proposal?id=`, endorsable, and
    community-flaggable (auto-hides at 3 flags pending review). Both rungs
    land in the same human-reviewed pipeline; rung 2 just skips the issue.
- **XP snapshots** — opt-in per-skill XP uploaded alongside a save
  (`server/src/xp.js`); public provisional distributions and leaderboards
  (`GET /api/xp/dist`, `GET /api/xp/leaderboard`). The fixed level curve
  still governs gameplay — this only starts a public record.
- **§9 — Koha transparency** — real monthly infrastructure cost, publicly
  readable at `GET /api/koha/transparency` (`server/src/koha.js`), entered
  by hand via `POST /api/admin/cost`. The in-game "keepers' letter"
  (`js/gameplay/koha.js`, `Koha`) quotes this live number: first mention at
  10 attentive hours (Play Pulse's AFK-weighted total), repeats at most
  every 40, never in the first session, never mid-action, delivered at a
  bank visit or a quiet idle moment, with a "please never mention this
  again" that's honoured forever (`localStorage taiao_koha_v1`). Requires a
  server build — without live numbers and a way to give, the letter simply
  never exists. See also [docs/koha.md](koha.md).
- **§6.1-B — offline action summaries** — the honest answer to "encrypted
  offline progress" (which can't exist: a client always holds its own
  keys). The client records a compact per-session, per-hour summary of
  gains (`js/net/actionlog.js`, format in
  [docs/action-summary.md](action-summary.md)) and uploads it riding along
  with save-vault pushes; Phase 1 stores rows unvalidated
  (`action_summaries.validated = 0`) so Phase 2 validation starts with full
  history, no cold start.

## Phase 2 — one world, actually shared

Everything in Phase 1 still works untouched. Phase 2 adds four systems,
all inert for logged-out players (**§7**):

- **§4 — region mutation ledger** (`server/src/region.js`,
  `js/net/regionsync.js`) — one Durable Object per 256²-tile region (8×8
  chunks) holds the SHARED delta types: `node:x,y` (resource depletion),
  `decor:x,y` (picked decoration), `heat:x,y,l` (station heat). Crops,
  placed furniture and door unlocks stay personal by policy (no griefing,
  no land claims yet). Records are latest-wins, server-time-stamped; the
  client converts at the sync boundary via a measured clock offset so
  local wall-clock saves stay untouched. `v: null` deletes a record via a
  tombstone. Hourly compaction drops expired records — absence of a record
  *is* the default (healed) state.
- **Shop stock ledger** (`server/src/shops.js`, `js/net/shopsync.js`) — the
  no-trading economy: a per-town ledger of player-added stock on top of
  the client's computed floor (`BANK_PERMANENTS`-style — the floor never
  reaches the server, so staples are always buyable for a new player).
  Sells append (merged by maker+quality), buys decrement FIFO. Units carry
  the maker's name and their **§8 provenance ratchet** — rank at sale
  time, so a rank-32 blade stays a rank-32 artifact even if the smith
  later slips. Unsold stock quietly rots after 120 days.
- **§6.1-B envelope validation** goes live (`server/src/envelope.js`) —
  stored action summaries are clamped to the maximum legitimate XP/minute
  for the attentive time claimed (a per-skill rate, `~2×` margin over the
  game's own tick tables) and accumulate into `validated_xp` — the only XP
  percentile ranks ever count. Runs on every save upload plus a daily
  cron sweep for strays. Overlapping/duplicate summary windows are clamped
  against a per-user high-water mark, so re-uploading the same hour twice
  validates it once (verified — see below).
- **§8 — percentile standings** (`server/src/ranks.js`) — levels 17-32,
  computed from `validated_xp`: a level-16 floor plus a 90-day window,
  *provisional* until 1,000 qualifying players exist for that skill
  (`PROVISIONAL_BELOW`, `server/src/xp.js`), 14-day demotion grace, daily
  recompute at 14:30 UTC. `server/src/seeds.js` issues server-side seed
  batches (16 bytes, `POST /api/seeds/next`) that rank-bearing rolls
  consume client-side (`js/net/seedroll.js`) instead of `Math.random()`,
  so a claimed rare drop can be replayed and audited later. Unranked/
  offline play never needs a seed — those outcomes just aren't
  rank/economy-bearing.

### §6.5 — not yet built

Cultural consultation for any content touching Māori narrative figures.
Explicitly out of scope for the eggs system and everything else shipped so
far (`js/gameplay/eggs.js`); tracked here so it isn't lost, not because
anything currently in the repo needs it retroactively.

## Endpoint reference

See [server/README.md](../server/README.md#endpoints) for the full route
table — verified against `server/src/index.js`'s actual `ROUTES` map
(exact match, no drift) as part of this pass.

## Verification log

Everything below was exercised directly (not just read), on 2026-09-16,
against this working tree:

- **Client build**: `node tools/build.mjs` with `TAIAO_SERVER_URL` unset
  and set both succeed; the unset build reports "Server: disabled" and
  `Server.enabled() === false` at runtime; rebuilding with no source
  changes reproduces `dist/bundle.js` byte-for-byte.
- **Client boot**: headless Firefox (`.claude/skills/verify/`) boot with
  the full Phase 0-2 bundle — zero console/page errors over ~15s idle,
  including the new `Wizard`, `MUSIC`, `GoalsArc`, `Eggs`, `Server`,
  `SaveSync`, `ActionLog`, `AccountUI` globals and `reducedMotion()`.
- **Object workshop → export**: "Export my proposal" downloads a correct
  `taiao-proposal-<type>-<key>.json`; warns instead of exporting when
  there's nothing to export.
- **Server, local `wrangler dev` against a fresh local D1/R2/Durable
  Object**: schema applies cleanly; register/login/`/api/me`; save vault
  put/list/get with version increment; workshop votes + tally; proposal
  submit/get/endorse/flag; **weekly digest** cron produces a real
  markdown digest from live vote/proposal data; region ledger push/pull
  round-trip including tombstone deletion via `v: null`; shop trade
  sell→stock→buy→stock round-trip with correct FIFO decrement; seed batch
  issuance; **envelope validation** — a within-envelope summary credits in
  full, an inflated summary (10,000,000 claimed XP in a 60s window)
  correctly clamps to the rate×time allowance *and* correctly clips
  against the previous summary's high-water mark so overlapping windows
  don't double-count; percentile ranks recompute (correctly `active:
  false` below the 1,000-qualifying-player threshold); admin endpoints
  correctly reject missing/wrong tokens (403) and accept the right one;
  daily Phase-2 cron tick runs clean; CORS allows the configured origin
  and rejects others (403).
- **Koha pipeline end-to-end**: admin sets a real monthly cost →
  `/api/koha/transparency` reports it → the in-game keepers' letter
  (`Koha._open()`) renders that exact live figure with zero errors.
- **Client/server contract**: every `Server.call()` site in `js/net/*.js`
  was cross-checked against `server/src/index.js`'s route table — full
  match, including `/api/health` (handled outside `ROUTES`, as the
  client comment expects).
- **Fixed while verifying**: `.gitignore` had a duplicated Phase-1 block
  (harmless) and no rule for `server/.dev.vars` (the file wrangler expects
  local secrets in) — added, since an ADMIN_TOKEN or Turnstile secret
  landing in that file is exactly the kind of thing that shouldn't get
  committed by accident.

### Not exercised this pass

- **WebAuthn passkeys** (`server/src/passkeys.js`) — needs a real
  browser authenticator; reviewed by reading, not run.
- **GitHub digest posting** (`GITHUB_TOKEN`/`GITHUB_REPO`) — the digest
  *generation* was verified; posting to Discussions needs a live token
  and wasn't exercised against the real repo.
- **Turnstile bot-check** on register/login — optional, no sitekey
  configured in this pass.
- **A real Cloudflare deploy** (`wrangler deploy`) — verified against
  local `wrangler dev` only, which is what the tooling supports without
  provisioning real Cloudflare resources.

## Open items

- **§6.5** cultural consultation, once any content wants to draw on Māori
  narrative figures rather than natural fauna / common-usage te reo.
- Nothing else is known-broken or half-shipped as of this pass — see
  individual `server/src/*.js` file headers for design rationale on any
  given system.

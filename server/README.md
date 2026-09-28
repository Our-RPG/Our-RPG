# Our RPG server (Phase 1)

See [docs/SPEC.md](../docs/SPEC.md) for the full Phase 0-2 systems spec —
this file is the deploy/run guide; that one is the "what it does and why."

The tiny server that counts. One Cloudflare Worker giving the game:

- **Accounts** — username + password (argon2id), optional passkeys, optional
  recovery email. The game runs logged-out exactly as before; an account is
  never required to play.
- **Save vault** — versioned save blobs in R2 (last 15 versions per slot),
  restore on any device.
- **Collective workshop** — votes and proposals sync up, community tallies
  come down; a weekly digest posts to GitHub Discussions. Votes inform the
  curator, they never auto-apply (see [GOVERNANCE.md](../GOVERNANCE.md)).
- **XP snapshots** — opt-in per-skill XP with each save; public provisional
  distributions and leaderboards (the fixed curve still governs gameplay).
- **Koha transparency** — real monthly costs, public at
  `/api/koha/transparency`, feeding the in-game keepers' letter.
- **Action summaries** — clients upload the §6.1-B offline action summaries
  with saves; Phase 1 stores them so Phase-2 validation starts with history.

Licensed GPL-3.0-or-later like the rest of the repo — the server being open
(and self-hostable) is part of the "can never be taken from you" story.

## First deploy

```sh
cd server
npm install
npx wrangler login

# 1. Create the database and bucket, then paste the D1 id into wrangler.toml.
npx wrangler d1 create taiao
npx wrangler r2 bucket create taiao-vault

# 2. Apply the schema (drop --remote to run against local dev storage).
npx wrangler d1 execute taiao --remote --file=schema.sql

# 3. Secrets — all optional, features degrade gracefully without them.
npx wrangler secret put TURNSTILE_SECRET   # enables bot checks on register/login
npx wrangler secret put ADMIN_TOKEN        # enables /api/admin/*
npx wrangler secret put GITHUB_TOKEN       # + GITHUB_REPO var: weekly digest → Discussions

# 4. Set ALLOWED_ORIGINS and RP_ID in wrangler.toml for the real game origin
#    (RP_ID is the bare domain the GAME is served from, e.g. our-rpg.example).

npx wrangler deploy
```

The Workers **paid** plan ($5/mo) is assumed: pure-JS argon2id costs
~100–200 ms of CPU per login, over the free plan's 10 ms budget. That $5 is
most of the koha transparency number, which is the point.

## Local development

```sh
npm run dev                       # wrangler dev on http://localhost:8787
npx wrangler d1 execute taiao --file=schema.sql   # local schema
```

Then build the client against it:

```sh
TAIAO_SERVER_URL=http://localhost:8787 node tools/build.mjs
```

With `TAIAO_SERVER_URL` unset the client builds with the server disabled and
behaves exactly like the serverless game.

## Client wiring (already done in `js/net/`)

- `SERVER_URL` is injected by `tools/build.mjs` from `$TAIAO_SERVER_URL`;
  empty string = every net feature no-ops.
- Auth is a Bearer token in `localStorage` (`taiao_session_v1`); CORS is
  origin-allowlisted; the service worker ignores cross-origin requests so
  nothing is cached.

## Maintainer chores

```sh
# Enter this month's real cost (cents) for the transparency page:
curl -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"month":"2026-09","usd_cents":1100,"note":"Workers paid plan + R2 storage"}' \
  https://<worker>/api/admin/cost

# Review the flag queue / set a proposal's status:
curl -H "authorization: Bearer $ADMIN_TOKEN" https://<worker>/api/admin/flagged
curl -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"id":12,"status":"accepted"}' https://<worker>/api/admin/proposal
```

The weekly digest fires Mondays 09:00 UTC (see `wrangler.toml`); it is also
readable in-game and at `/api/workshop/digest/latest`.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/register` `login` `logout`, `GET /api/me`, `POST /api/password` | — / session | accounts |
| `POST /api/passkey/…` | mixed | WebAuthn add/login/remove |
| `PUT /api/save`, `GET /api/save/list`, `GET /api/save/blob` | session | vault (+ xp + summaries piggyback on PUT) |
| `GET /api/xp/dist?skill=&min=`, `GET /api/xp/leaderboard?skill=` | public | provisional distributions |
| `POST /api/workshop/votes`, `GET /api/workshop/tally?subject=` | session / public | ballot box |
| `POST /api/workshop/proposal`, `GET …/proposals`, `GET …/proposal?id=`, `POST …/endorse`, `POST …/flag` | mixed | proposals + curator flag queue |
| `GET /api/workshop/digest/latest` | public | weekly digest |
| `GET /api/koha/transparency` | public | real costs + 30-day players |
| `POST /api/region/push?r=`, `GET /api/region/pull?rs=` | session | Phase 2: region mutation ledger (Durable Object per region) |
| `GET /api/shop/stock?town=`, `POST /api/shop/trade` | public / session | Phase 2: per-town finite stock, provenance-stamped |
| `POST /api/seeds/next` | session | Phase 2: server-issued seeds for rank-bearing rolls |
| `GET /api/xp/validated` | session | Phase 2: envelope-validated XP (what ranks count) |
| `GET /api/ranks/skill?skill=`, `GET /api/ranks/me` | public / session | Phase 2: §8 percentile standings (daily recompute) |
| `POST /api/admin/cost`, `GET /api/admin/flagged`, `POST /api/admin/proposal` | ADMIN_TOKEN | maintainer chores |

## Phase 2 — one world, actually shared

Everything above the Phase-1 line still works untouched; Phase 2 adds four
systems (audit §7 Phase 2), all inert for logged-out players:

- **Region mutation ledger** (`src/region.js`) — one Durable Object per
  256²-tile region holds the SHARED delta types: node depletion/respawn,
  picked decor, station heat. Latest-wins records, server-stamped times
  (server time is canonical for shared timers — clients convert at the sync
  boundary), hourly compaction of healed records. Crops, placed furniture
  and door unlocks stay personal by the sharing policy. Deploy note: the
  `[durable_objects]` binding + `v2-region-ledger` migration in
  `wrangler.toml` ship it; no extra resources to create.
- **Shop stock ledger** (`src/shops.js`) — per-town player-added units with
  the maker's name, rank-at-sale (the §8 provenance ratchet) and quality;
  purchases decrement FIFO; the client's computed base stock is the
  BANK_PERMANENTS-style floor that never reaches the server, so staples are
  always buyable. This is the no-trading economy.
- **Envelope validation** (`src/envelope.js`) — §6.1-B goes live: stored
  action summaries are clamped to the maximum legitimate XP/min for the
  attentive time claimed (overlap-proof high-water mark) and accumulate into
  `validated_xp` — the only XP ranks count. Runs on upload + daily sweep.
  `XP_PER_MIN` is hand-tuned with ~2× headroom; retune with xp rebalances.
- **Percentile standings** (`src/ranks.js`) — §8 levels 17-32 recomputed
  daily (14:30 UTC cron) from validated XP: level-16 floor + 90-day window,
  provisional under 1,000 qualifying players per skill, 14-day demotion
  grace, `rank_meta` activation skill by skill. `src/seeds.js` issues the
  audited seed batches rank-bearing rolls consume client-side.

Client counterparts: `js/net/regionsync.js`, `shopsync.js`, `seedroll.js`,
plus supply-term hooks in `js/skills/market.js` and mutation notes in
`gathering.js` / `decor-pickup.js` / `firemaking.js`.

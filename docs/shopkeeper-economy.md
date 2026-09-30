# Shopkeeper Economy — living merchants for Our RPG

Refined design for making shopkeepers small economic agents (finite cash,
adaptive stock targets, demand-driven prices) instead of vending machines.
This document adapts the general "realistic shopkeeper" plan to Our RPG's
actual architecture — many players share every shopkeeper, the game is
client-authoritative with an envelope, and trades sync asynchronously.

Status: **Phases 1–2 BUILT** (2026-09-30; Phase 1 deployed and live, Phase 2
deploy pending — see §17/§18 for the as-built deltas). Phase 3 remains design.

---

## 0. What already exists (build on it, don't replace it)

| Existing piece | Where | Role in the new system |
|---|---|---|
| Per-town shared stock ledger (player-added units, provenance, FIFO, 120-day rot) | `server/src/shops.js`, D1 `shop_units` | Becomes the shared **inventory** axis. Unchanged. |
| Client base stock floor (`SHOP_STOCK` + biome surplus; server never sees it) | `js/skills/market.js` | Stays: the **standing floor** that guarantees staples and feeds `inv_eff`. New players can never starve — this invariant survives. |
| Glut multipliers `buyMult`/`sellMult` (log-damped by player stock qty) | `js/net/shopsync.js:62` | **Replaced** by the price engine. These two functions are the only price hooks market.js consumes — the integration surface is tiny. |
| Biome market profiles (demand tags, surplus tags, themed stock) | `market.js` `MARKET_PROFILES` | Becomes the **regional market** layer — already half of "mining town: cheap ore, dear fish". |
| Town contracts (hash-derived "town wants X at premium") | `market.js townContracts` | Re-pointed at real shortages (Phase 2): contracts become the *emergent* "merchant advertises what they need" channel. |
| Reputation tiers (sell cap, buy discount) | `market.js repTier` | Kept, applied after the engine price (a per-player modifier on a shared price). |
| Per-shop-type buy gates (`SHOP_TYPES[k].buys`) | `market.js` | Becomes **specialization**: specialists buy their category at full confidence; general store buys broadly at a discount. |
| Async trade queue, offline-safe, DEV-inert | `shopsync.js` | Philosophy preserved: prices computable with zero round-trips; server state only *modulates* a deterministic baseline. |
| Daily cron tick (2:30 am NZT) + stale sweep | `wrangler.toml`, `shops.js sweepStale` | The **only** scheduled economic tick. Everything else is lazy. |

Naming note: `market.js` uses "sell price" for what the shop pays the player.
To avoid that ambiguity this doc always says **shopPays** (player → shop) and
**shopCharges** (shop → player).

---

## 1. Architecture: three layers

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Deterministic baseline (client, pure, offline-safe)           │
│    base value, biome profile, personality params, floor stock —  │
│    all hash-derived from (townKey, shopType). Zero storage.      │
├──────────────────────────────────────────────────────────────────┤
│ 2. Shared market state (server, SPARSE, lazy-decayed)            │
│    D1: shop_units (exists) + shop_till + shop_flow.              │
│    Rows exist only for (town,item) pairs players have touched.   │
├──────────────────────────────────────────────────────────────────┤
│ 3. Price engine (ONE implementation, two consumers)              │
│    shared/econ-core.js — pure functions (state, now) → prices.   │
│    Client uses it for display + optimistic trades; the Worker    │
│    runs the SAME file at flush time to clamp cash movement.      │
└──────────────────────────────────────────────────────────────────┘
```

**Why this shape (the multiplayer answer).** Many players face one
shopkeeper, so prices must be a *pure function of shared state*, not
per-client mutable state. Two players at the same stall then agree on the
price to within one stock-sync interval (30 s TTL, `shopsync.js:19`), and
price inertia (§8) bounds how far they can disagree. No live locking, no
price server round-trip per browse — the async-first design survives intact.

**Parity pattern.** `shared/econ-core.js` is written like
`studio/js/zone-bake-core.js`: plain script, `"use strict"`, IIFE attaching
one global (`EconCore`), no DOM/node/module APIs. The game bundle includes it
via `tools/bundle.list`; the Worker gets a two-line ESM shim
(`server/src/econ-core.js` → `import "../../shared/econ-core.js"; export
default globalThis.EconCore`) — esbuild/wrangler handles side-effect scripts
fine. One file, byte-identical math both sides, exactly the ZoneBakeCore
precedent. Add it to `GEN_FILES`/`WORLDGEN_SIG` only if prices ever feed
cached worldgen (they don't today).

---

## 2. Data structures

### 2.1 Server (D1) — two new tables, both sparse

```sql
-- 00NN_shop_economy.sql
-- One till per (town, shop). Created on first trade, seeded by econ-core
-- from the town hash (the Worker computes the same seed the client shows).
CREATE TABLE shop_till (
  town       TEXT NOT NULL,        -- townKeyOf cx,cy (same keyspace as shop_units)
  shop       TEXT NOT NULL,        -- shop type key ('market','weaponsmith',...)
  cash       INTEGER NOT NULL,     -- coins, integer only
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (town, shop)
);

-- Flow memory per (town, item): lazily-decayed EMAs + acquisition cost.
-- A row exists only once players have traded that item in that town.
CREATE TABLE shop_flow (
  town       TEXT NOT NULL,
  item       TEXT NOT NULL,
  ema_in     REAL NOT NULL DEFAULT 0,  -- units/day players SELL to the shop
  ema_out    REAL NOT NULL DEFAULT 0,  -- units/day players BUY from the shop
  avg_cost   REAL NOT NULL DEFAULT 0,  -- shop's rolling acquisition cost/unit
  day_in     INTEGER NOT NULL DEFAULT 0,  -- today's raw in-flow (manipulation cap, §5)
  day_out    INTEGER NOT NULL DEFAULT 0,
  day_start  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (town, item)
);
```

No `current_price` column anywhere: **prices are never stored**, always
computed. That kills a whole class of staleness/consistency bugs and most of
the rough plan's tick pyramid.

Reminder from [[community-zone-baking]]: apply per-file with
`wrangler d1 execute taiao --remote --file=migrations/00NN_shop_economy.sql`,
never `d1 migrations apply`.

### 2.2 Extended stock read

`GET /api/shop/stock` response gains two keys (same 30 s cache):

```
{ items: {id: {qty, units:[...]}},          // as today
  flow:  {id: {in, out, cost}},              // decayed-to-now EMAs
  till:  {market: 1180, weaponsmith: 460},   // cash per shop in town
  now }
```

### 2.3 Client / engine structs (computed, not stored)

```
ShopParams (hash-derived, §10)          ItemView (assembled per render)
{ reserveRatio      0.15–0.40           { value          ITEMS[id].value
  operatingCash     seed cash            floorQty        client floor stock
  spreadBase        0.18–0.45            playerQty       ledger qty
  inertiaHalfLife   2–12 h               invEff          floorQty + playerQty
  daysOfSupply      3–10                 emaOut, emaIn   from flow (decayed)
  bigTicketFrac     0.10–0.35            baselineDemand  hash+profile units/day
  offSpecDiscount   0.5–0.85             targetStock     §4
  priceExp  {stock:0.45, demand:0.35} }  avgCost }
```

---

## 3. The price engine (shared/econ-core.js)

All functions pure: `(view, params, till, now) → number`. Integer coins out.

```
mid(view)        = view.value * demandMult(profile, id) * regionMult(townKey)
                   -- demandMult exists (market.js:148); regionMult is a new
                   -- hash-derived ±10% town wobble so identical neighbours differ

stockPressure    = clamp( (targetStock / max(invEff, 1)) ^ priceExp.stock, 0.55, 1.9 )
demandPressure   = clamp( (max(emaOut, 0.1) / baselineDemand) ^ priceExp.demand, 0.75, 1.5 )

shopCharges(id)  = round( mid * stockPressure * demandPressure )        -- ≥ 1

liquidity        = clamp( (till.cash - reserve) / operatingCash, 0.15, 1.25 )
                   -- reserve = operatingCash * reserveRatio
                   -- >1 is deliberate: a cash-flush shop with empty shelves
                   -- pays a visible premium — the feedback loop players see

stockNeed        = clamp( targetStock / max(invEff, 1), 0.10, 1.5 )

shopPays(id)     = round( min(
                     shopCharges(id) * (1 - spread(id)),               -- hard spread floor
                     mid * (1 - spreadBase) * stockNeed * liquidity * conf(id)
                   ) )

spread(id)       = spreadBase * (perishable(id) ? 1.25 : 1) ; never < 0.15
conf(id)         = 1.0 if the shop's SHOP_TYPES.buys matches the item,
                   offSpecDiscount otherwise (general store: 0.9 broad)
```

**Asymmetry** (per the plan): `shopPays` collapses fast on oversupply because
`stockNeed` bottoms at 0.10 while `shopCharges`' `stockPressure` bottoms at
0.55. **Refusal:** if `invEff ≥ 3 × targetStock` or the till can't cover one
unit above reserve, the shop refuses the item — with a dialogue line, not a
1-coin insult (§11).

Per-player modifiers apply *after* the shared price: reputation
(`repMult`/`buyDisc`), quality `qMult` — unchanged from today, so the shared
price stays identical for everyone and personal perks layer on top.

### 3.1 Bulk / marginal pricing

Big lots reprice in **chunks of 5** (matches the bank-click grammar players
already know: click/Shift/Alt = 1/5/all). Chunk *k* of a sale is priced with
`invEff' = invEff + 5k` (and `till' = till − paid so far`); a purchase
symmetrically with `invEff' = invEff − 5k`. Dumping 100 fish therefore walks
down the curve — first fish ~18, last ~6 — in one closed-form loop, no
stored state, and both sides of the parity engine agree on the total. The
trade UI shows the blended total before confirming.

---

## 4. Adaptive stock targets

```
targetStock = clamp( floorQty + emaOut * daysOfSupply,
                     floorQty,                 -- never targets below the floor
                     MAX_TOWN_ITEM_QTY / 8 )
baselineDemand = hash(town,item) → 0.5–4 units/day, scaled by profile demand tag
```

`emaOut` is real player purchases (all players — this is where multiplayer
*helps*: a busy town genuinely consumes more, so its shopkeeper genuinely
pays more for restock). An item nobody buys decays toward `baselineDemand`'s
floor and the shop quietly stops wanting it.

---

## 5. Demand estimation — lazy EMAs, no tick loop

The rough plan's tick pyramid (per-transaction, minutes, hourly, daily) is
overkill here and the hourly tier is actively hostile to a Worker+D1 stack.
Replace it with **closed-form lazy decay**:

* Store `(ema, updated_at)`. On any read or write:
  `ema *= exp(-(now - updated_at) / τ)` with **τ = 3 days** (wall-clock, per
  [[wall-clock-persistence]] — the world runs on `Date.now()`).
* On a trade flush, after decaying: `ema += accepted_qty / τ_days`.
* Nothing ever iterates over all shops. An untouched row is *exactly* as if
  it had been ticked hourly — the exponential is the same either way.

**Manipulation cap (multi-account defence):** each flush also bumps
`day_in`/`day_out` (reset when `now - day_start > 24 h`). The EMA increment
only counts flow up to `cap = max(20, 4 × baselineDemand)` units per day per
(town,item) — beyond that, stock still moves (real supply!) but *beliefs*
stop updating. Pumping demand with two accounts cycling an item hits the cap
in minutes; meanwhile the spread taxes every cycle.

**Elasticity:** skip runtime estimation. Fixed per-tag exponents in
`priceExp` (staple food less elastic than luxury gear) deliver the plan's
"don't always price high" behaviour at zero cost. The engine's pure-function
shape leaves room for a future candidate-price search
(`argmax_p demand(p)·(p − avgCost)`), but ship without it — with hundreds of
players the *real* players are the elasticity discovery mechanism.

---

## 6. Cash & liquidity — the till is shared state

* **Seed:** first trade creates the till: `operatingCash = hash(town,shop) →`
  roughly 40–120 × the median item value the shop deals in (market ~1,500
  coins; weaponsmith ~2,500; item values run 1–430, median ~12). The Worker
  computes the seed with econ-core so it matches what the client displayed.
* **Player sells → till drains. Player buys → till fills.** Atomically, with
  the reserve as a hard floor:
  ```sql
  UPDATE shop_till SET cash = cash - ?paid, updated_at = ?now
   WHERE town=? AND shop=? AND cash - ?paid >= ?reserve
  ```
  If the guard fails, the Worker re-runs econ-core with the actual till and
  accepts a **partial quantity** (maybe zero), returning
  `{accepted, paid}` per line — the same shape as today's `sold`/`bought`
  reconciliation, so `shopsync.js` extends rather than changes.
* **Daily cron drift** (rides the existing 2:30 am tick, one SQL pass over
  *existing* rows only): `cash += (operatingCash − cash) × 0.25`. Fiction:
  the shopkeeper banks profit / draws on savings / settles with NPC
  suppliers overnight. This guarantees a drained till is a **1–3 day
  condition, not a permanent grief**: a crowd that sells a town dry creates
  a real, visible, *temporary* shortage of coin — which is the gameplay.

Coins on the player side stay client+envelope, as everywhere else in the
game. The server is authoritative about the *shop's* money only.

### 6.1 Capital allocation — two rules, not an optimizer

The plan's utility-scoring allocator is more machinery than the fiction
needs. Two rules produce the same visible behaviour:

1. **Big-ticket rule:** one line's payout ≤ `bigTicketFrac × spendable`
   (spendable = cash − reserve). A 300-coin sword against an 800-coin
   spendable till with `bigTicketFrac 0.25` caps at 200 — the shopkeeper
   *offers 200* and says why ("I couldn't tie up more coin in one blade").
2. **Liquidity is global per till:** every payout shrinks `liquidity` for
   the *next* line (and the next player — shared state). Fast-moving staples
   keep decent offers longest because their `stockNeed` is refreshed by real
   `emaOut`; the slow sword's offer collapses first. Priority-by-utility
   falls out for free.

---

## 7. Buying from players — worked curve

Fishmonger, snapper: value 10, targetStock 30 (floor 6 + emaOut 3.4 × 7 d),
spreadBase 0.25, operatingCash 1200, cash 1100:

| invEff | stockNeed | shopPays | shopCharges |
|---|---|---|---|
| 2  | 1.50 | 17 | 31 |
| 10 | 1.50 (clamped) | 15 | 25 |
| 30 | 1.00 | 9  | 17 |
| 60 | 0.50 | 4  | 13 |
| 90+ | refuse | — | 11 |

The plan's example table, reproduced by the formula rather than authored.

---

## 8. Price inertia & multi-player consistency

Two distinct smoothing problems; solve each where it lives:

* **Within one trade:** the chunk-of-5 marginal walk (§3.1) *is* the
  progressive repricing — no smoothing constant needed, and it's
  deterministic for the parity check.
* **Between syncs / between players:** raw engine output would step whenever
  a 30 s stock refresh lands. Display and charge
  `price = lerp(prev, target, 1 − 2^(−Δt / inertiaHalfLife))` where `prev`
  rides on the flow row implicitly — cheaper: because *inputs* (EMAs) already
  decay smoothly and stock moves in integer nibbles, inertia only needs to
  damp the stock term: use `invSmooth = ema of invEff with τ = inertiaHalfLife`
  folded into the same lazy-decay row (one more REAL column if testing shows
  visible stepping; ship without it first).
* **Flush-time drift guard:** a client might trade against a 30 s-stale
  price. The Worker recomputes with current state and accepts the client's
  implied per-unit price if within **±15%** of its own figure (envelope
  style); otherwise it reprices the line and returns the correction. Honest
  clients never notice; a replayed stale price can't be farmed.
* **Fairness under contention:** D1 serializes flushes; first flush gets the
  better curve position. That's the correct fiction (first to the stall gets
  the price) and requires no code.

---

## 9. Regional markets, NPC flows, supply shocks

* **Regional:** biome profiles already price ore cheap in mining towns and
  fish cheap on the coast. Add the ±10% `regionMult` town wobble and the
  per-town till/flow state — arbitrage between two coastal villages now
  exists because *their players* behave differently. Transport friction is
  physical (walking/boats), no tax needed.
* **NPC production/consumption — aggregated, in the daily cron,** touched
  rows only:
  ```
  ema_out += producedByTown(town,item) is WRONG — instead:
  inventory drift: player stock rots via sweepStale (exists);
  demand drift:    ema_out decays toward baselineDemand (lazy, free);
  till drift:      §6.
  ```
  That trio *is* the aggregate NPC economy: the floor stock models NPC
  supply, `baselineDemand` models NPC consumption, the till drift models the
  shopkeeper's off-screen NPC trade. No simulated farmers needed for v1.
* **Supply shocks (Phase 3):** a small `town_mod (town, tag, floor_mult,
  demand_mult, expires)` table written by scripted events (Lua layer —
  quests/triggers already live in `scripts/**/*.lua`, so a "goblins hold the
  mine" quest can set `floor_mult 0.2` on `metal` for a week). The engine
  multiplies `floorQty` and `baselineDemand` by it; scarcity, higher
  shopPays, and the player-import correction loop all *emerge* from the
  existing formulas, exactly as the plan asks. Delivered to clients in the
  stock read.

---

## 10. Personality — hash-derived, zero storage

`shopParams(townKey, shopType)` seeds a mulberry32 from the same FNV hash
`townContracts` uses, then blends one of four presets (weights biased by
shop type) with ±20% jitter:

| Preset | reserveRatio | spread | inertia | daysSupply | bigTicket | typical host |
|---|---|---|---|---|---|---|
| Conservative | 0.40 | 0.30 | 12 h | 9 | 0.10 | general store |
| Opportunist  | 0.15 | 0.22 | 2 h  | 4 | 0.35 | market stall |
| Luxury       | 0.30 | 0.45 | 8 h  | 14 | 0.50 | weaponsmith |
| High-turnover| 0.20 | 0.16 | 3 h  | 3 | 0.15 | fishmonger/farm |

Deterministic → every player meets the *same* merchant, offline included,
and it costs nothing. Personality only bends parameters; one engine.

---

## 11. Show, don't tell — dialogue & UI hooks

Every refusal or strong modifier maps to a canned line (extend the 40-role
bank pattern, [[npc-canned-dialogue-bank]]; lines chosen by state, hash-varied):

| State | Line flavour |
|---|---|
| `invEff ≥ 3×target` | "I've already got three gathering dust upstairs." |
| big-ticket cap hit | "I'd take it — but only for {offer}. Can't tie up more in one piece." |
| `liquidity < 0.3` | "Coin's short till I shift some stock. Come back in a day or two." |
| `stockNeed > 1.3` | "Bring me {item} — those I can shift." *(also seeds a contract)* |
| off-spec item | "Not my trade. The {rightShop} might bite." |

UI: the market panel shows a small ▲/▼ trend glyph per item (engine price vs
mid) and the shopkeeper's till mood (flush / fine / short) — enough for
players to *read* the economy without a spreadsheet. No numeric forecasts,
in the spirit of [[no-bake-eta]]: state, not predictions.

---

## 12. Anti-exploit map

| Exploit | Defence |
|---|---|
| Sell-then-buy-back profit | Hard spread ≥ 15% at every instant; both prices from one state. |
| Tiny-transaction price nudging | Prices are pure functions of qty/EMAs; a tiny trade moves invEff by 1 — nothing to nudge. Rate limit 240/h (exists). |
| Two-account demand pumping | Per-(town,item) daily EMA cap (§5); spread taxes every cycle; shared state means no per-player market to reset. |
| Till duplication / double-pay | Single atomic guarded UPDATE per flush line; partial-accept reconciliation. |
| Stale-price replay | ±15% flush-time envelope, server reprices beyond it (§8). |
| Merchant state reset | State is server-side; DEV_MODE/local sim never syncs (exists). |
| Bulk dumping | Marginal chunk curve + refusal at 3×target + `MAX_TOWN_ITEM_QTY` (exists). |
| Negative/absurd prices | Every factor clamped; integer coins; `shopCharges ≥ 1`; `shopPays ≥ 0` with refusal below 1. |
| Draining a town's till as grief | Reserve floor + 25%/day drift restores it; shortage is temporary and visible. |

---

## 13. Pseudocode

### 13.1 Transaction flow

```
CLIENT (market.js render + confirm)
  view  = assemble(town, id)              # floor, ledger qty, flow, till (≤30s old)
  quote = EconCore.quoteLot(view, params, till, lot)   # chunk-of-5 walk, blended total
  show quote (+ rep/quality per-player modifiers, trend glyphs, dialogue if refused)
  on confirm: apply coins/items locally (envelope), ShopSync.noteSell/noteBuy
              queue line {item, qty, unitPriceImplied}

SERVER (shops.trade, per flushed line)         # extends the existing loop
  decay flow row; read till (seed if absent)
  sQuote = EconCore.quoteLot(serverView, params, till, lot)
  if |clientImplied − sQuote.unit| / sQuote.unit > 0.15: use sQuote  # drift guard
  if selling to shop:
      accepted = min(qty, room, tillAfford(sQuote, reserve), refuseChecks)
      guarded UPDATE shop_till; upsert shop_units (exists); update flow EMAs+dayCaps
  if buying from shop:
      accepted = min(qty, ledger+floor availability)      # floor part: no ledger write, but
      UPDATE shop_till cash += paid; decrement units FIFO (exists); update flow
  reply line: {accepted, paid, stockNow, till, flow}

CLIENT reconcile (shopsync.flush, extends existing r.stock adoption)
  adopt stockNow/till/flow; if accepted < sent: refund items/coins diff, toast
  "The fishmonger could only take 34 of them."
```

### 13.2 Ticks

```
ON READ/WRITE (lazy, closed-form)   ema *= exp(-dt/τ); dayCounters roll at 24h
DAILY CRON (exists, 2:30 am NZT — one pass over EXISTING rows only)
  sweepStale()                                       # exists
  UPDATE shop_till SET cash = cash + (operating − cash)/4          # needs operating
      → store operating_cash on the till row at seed time to keep this pure SQL
  DELETE shop_flow WHERE both EMAs < ε AND updated_at old          # sparse forever
  regenerate town contracts from top stockNeed items (Phase 2)
NO hourly tick. NO per-frame work. NO global iteration outside the cron.
```

### 13.3 D1 cost envelope

Per flushed trade line: ~2 reads + 3 writes (today: ~2 + 2). At the
concurrency ceiling (~2,000 players, rate cap 240 trades/h each, realistically
a few trades/min/player) shop traffic stays in the tens of statements/sec —
well inside D1. Stock reads stay one cached query (30 s, `CACHE` header
exists).

---

## 14. Example trace — the fish dump and the recovery

Fishmonger, snapper as in §7. Day 0, till 1,180 / reserve 300.

```
t0    Player A sells 60 snapper.
      Chunks walk 17→15→12→9→6→4; A receives 634 coins; till 546.
      invEff 62, ema_in jumps (capped), stockNeed 0.48.
t+1m  Player B (same stall) offers snapper: quoted 4, refused past 90 —
      B sees the SAME market A left behind. B's better move is visible:
      shopCharges dropped to 13, or carry fish inland where stockNeed > 1.
t+2h  Player C buys 25 cheap snapper for a cooking grind: till 871,
      ema_out rises → targetStock drifts 30→38 → shopPays recovering.
t+1d  Cron: till → 953. Rot hasn't hit (120 d). Prices ~mid ±10%.
t+4d  ema_in decayed; if C's cooking demand persists, the town now
      PAYS MORE for snapper than before the dump — demand discovered.
```

And the shortage loop: a mine-shock `town_mod` cuts the metal floor →
`invEff` collapses → `shopPays(iron)` climbs to ~1.6× neighbouring towns →
player imports walk it back down. No scripted prices anywhere.

---

## 15. Tuning & player-feel recommendations

1. **Clamp the world, not the moment.** Staples (food/tools tags) get tight
   pressure clamps (~0.7–1.4) so a new player's economy is stable; luxury
   tags get the wide ones (0.55–1.9). Tune per *tag*, never per item.
2. **Half the system is legibility.** Ship the dialogue lines and trend
   glyphs in the same phase as the formulas — an unexplained price change
   reads as a bug; an explained one reads as a living world.
3. **Watch it before tuning it.** Emit `Tele.ev("shopquote", …)` on trades
   (existing telemetry → R2 pipeline) and add a price-dispersion panel to
   `tools/telemetry_dash.mjs`. Tune τ and exponents from real dumps, not
   guesses.
4. **Protect the tutorial.** Tūhura Isle shops (and DEV_MODE) run pure
   baseline — no shared state, fixed friendly prices. The gate is already
   there (`live()` in shopsync).
5. **Reputation must stay a perk, not an exploit:** `buyDisc` applies after
   the spread check against the *player's own* effective prices, so high rep
   can narrow but never invert their personal spread.
6. **Start blunt, sharpen later.** Ship with big spreads (0.25+) and strong
   clamps; loosen as telemetry shows margins players actually chase. It is
   far easier to make a stingy merchant generous than to un-crash an economy.

## 16. Phasing

* **Phase 1 — the living till (core loop):** econ-core + shim, migration
  (`shop_till`, `shop_flow`), trade-flush integration with partial accept,
  replace `buyMult`/`sellMult` call sites, chunk-of-5 quotes, reconcile UX,
  telemetry event. *Emergent behaviours unlocked: fish-dump saturation,
  cash-flow feedback, shortage premiums.*
* **Phase 2 — the person behind the counter:** personalities, dialogue
  lines, trend glyphs, big-ticket rule, contracts-from-shortage, dashboard
  panel.
* **Phase 3 — the wider world:** `town_mod` supply shocks wired to Lua
  events, optional invSmooth inertia column, candidate-price elasticity
  search if telemetry says fixed exponents feel flat.

## 17. Phase 1 as built (2026-09-30)

Files: `shared/econ-core.js` (engine) + `server/src/econ-core.js` (ESM shim),
`server/src/shops.js` (till/flow settlement), `server/migrations/
0010_shop_economy.sql` + `server/schema.sql`, `server/src/index.js` (cron),
`js/skills/market.js` (quotes, dialogue, taper), `js/net/shopsync.js`
(flow/till sync, paid lines), `js/net/livesync.js` (arg forwarding),
`tools/bundle.list`.

Deliberate deltas from the design above:

* **One till per town**, not per (town, shop) — the stock ledger is per-town,
  so a per-town till matches the fiction; the `shop` column ('town') reserves
  the Phase-2 split.
* **No server-side repricing / ±15% drift guard.** `ITEMS` is generated at
  runtime across the content pipeline, so the worker cannot know item values.
  The shared state defends itself instead: the reserve floor and 4× cap live
  inside the till UPDATE statement (race-safe), one account can draw at most
  35% of a till's operating cash per day (`takeBudget` on the rate_limits
  table, count = coins), belief EMAs saturate at `dayCap`, and a saturated
  shelf is refused server-side. A cheater inflating `paid` can bleed at most
  the daily budget from one town — which the next cron drift refills.
* **Neutral parity is an invariant, not an aim.** The pressure ratio is
  constructed to be exactly 1 with no player stock/flow, and demandPressure
  only ever *raises* charges (≥1) — so offline, DEV_MODE, logged-out, and
  untouched towns price byte-identically to the legacy formulas. The
  headless check asserts this across a whole market's floor stock.
* **The marginal walk and refusal apply only on a live synced market**
  (`till` non-null). Offline there is no shared shelf to saturate, so
  sell-all stays flat-priced — no friction without economics.
* **Marginal pricing on sells only.** Buys reprice per stock sync (30 s)
  through stockPressure, which is where the buy side's economics live.
* **Partial accepts are absorbed, not refunded.** The client's own quote
  already respects the till and shelf, so a server-side shortfall only
  happens on a race between two players; it is silently absorbed exactly
  like the legacy MAX_TOWN_ITEM_QTY room cap. Old clients (no `paid` field)
  still shelve goods and move no cash.

Deploy checklist (user-run):
1. `cd server && wrangler d1 execute taiao --remote --file=migrations/0010_shop_economy.sql`
2. `wrangler deploy` (worker: new stock/trade shapes, cron dailyTick)
3. Publish the rebuilt game bundle (dist/bundle.js) via the usual Pages path.
   Order matters little: old client + new server = legacy free-shelving;
   new client + old server = quotes fall back to neutral (no flow/till in
   stock reads) — both degrade to today's behaviour.

Deployed 2026-09-30: migration 0010 applied, worker b95593f6, Pages f9457413.

## 18. Phase 2 as built (2026-09-30)

Personalities, legible economics, the big-ticket rule, shortage contracts,
and the dashboard lens. No schema change — Phase 2 is pure parameters + UI.

* **Personality = `EconCore.shopParams(townKey)`** — one hash-derived
  temperament per town (the till is per-town, so the "head trader" carries
  it): four archetypes (*steady, keen, particular, brisk* ≈ the design's
  conservative/opportunist/luxury/market-trader) with ±20% per-field jitter
  over daysOfSupply, reserveRatio, refuseAt, opMult (till size),
  bigTicketFrac, expStock. **Invariant preserved by construction:**
  personality bends only dynamic parameters, never the neutral anchors
  (payBase / surplusMult / spreadMin), and the pressure ratio normalises
  days out of the neutral state — tested across 120 towns × 4 items that
  every personality prices neutral byte-identically to legacy. Existing
  deployed tills keep their stored operating cash; opMult shapes new seeds
  only.
* **Big-ticket rule** — one sell line draws at most
  `bigTicketFrac × spendable` (25-coin floor so tiny tills still trade).
  Enforced in the client walk (with a `bigTicket` flag → "I couldn't tie up
  that much coin in one line of stock") AND as a server backstop clamp.
* **Legibility** — ▲/▼ trend glyphs on buy slots vs the neutral anchor with
  a plain-words tooltip; "they're short of these — good coin!" markers on
  sell slots at stockNeed ≥ 1.25; one mood line per market visit (the
  keeper names their hottest shortage, or their till state). All gated on a
  live-synced market; offline shows none of it.
* **Contracts-from-shortage** — the general store posts up to two ⚡ URGENT
  notices for items whose live stockNeed ≥ 1.3 (candidates: its own shelf +
  the top wanted-tag pools). Keys are `town:sh:item` so completion persists
  in player.contractsDone; needs are shared state, so every player sees the
  same notice, and filling it removes the shortage that created it.
  Self-limiting as an exploit: pumping demand costs real buys (spread +
  belief day-caps), the reward key completes once, and fulfilment consumes
  real goods.
* **Dashboard** — the Shops card (tools/telemetry_dash_template.html) now
  shows average unit price beside volume for buys and sells, from the
  existing trades aggregation; falling sell averages = glutting shelves.

Files: shared/econ-core.js, server/src/shops.js, js/skills/market.js,
js/net/shopsync.js, tools/telemetry_dash_template.html. Verified: engine
suite (31 checks incl. the personality-parity sweep), server integration
(20 checks incl. the big-ticket backstop), headless offline parity (12),
and a simulated-live headless pass over glyphs/mood/urgent/taper (7).

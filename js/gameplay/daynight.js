// ===== Taiao — day/night cycle + light model =====
// A global clock drives a sun phase; how much of each cycle is daytime depends on
// LATITUDE (world tile y). The renderer (render3d.js drawNight) reads daylightNow()
// to darken the scene at night, and reads the light helpers here to punch fire/
// candle/bioluminescence light back into the dark.
//
// Latitude → day:night ratio (per design):
//   y=0      1:1  (equator)      y=-3750  3:1     y=-7500  1:0 (endless day)
//   y=+3750  1:3                 y=+7500  0:1 (endless night)
// …and the pattern REPEATS as a triangle wave, so every second pole is endless
// day and every other endless night: dayFraction(y) = |1 - ((y+7500)/15000 mod 2)|.
"use strict";

// one full day→night→day cycle in wall-clock ms (uses the game's `now`, which is
// real time and keeps advancing while the tab is closed)
const DAY_MS = 64 * 60 * 1000;      // 64 min real time = 24 h game time (~32 min day + ~32 min night at the equator)
const LAT_HALFDAY = 7500;           // |y| of the first endless-day / endless-night poles
const LAT_PERIOD = 4 * LAT_HALFDAY; // 30000 tiles between like poles

// sun phase 0..1 across the cycle: 0 = midnight, 0.5 = noon.
// __timeOffsetMs (cheats panel) shifts the whole cycle — clocks, sun, shadows,
// bedtime, shop locks all follow, while wall-clock timers (crops, fires) don't.
function dayPhase() {
  // Tūhura Isle (gameplay/tutorial.js): the tutorial pocket keeps a STAGED
  // clock — always dawn at first, rolled forward as the tutorial progresses.
  // Null everywhere else / once graduated, so the real clock is untouched.
  if (typeof Tutorial !== "undefined") {
    const tp = Tutorial.phaseOverride();
    if (tp != null) return tp;
  }
  return (((_clockMs() % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
}
// the world clock in ms, with every shift applied — the base for the sun, the
// moon's slower cycle and the aurora slots, so a time cheat moves all three.
// player.timeShiftMs: a PERSISTED whole-world clock shift (graduation's
// overnight crossing lands the player in a Newhaven morning; the shift
// sticks so their days stay anchored to that arrival, not the wall clock)
function _clockMs() {
  const off = ((typeof window !== "undefined" && window.__timeOffsetMs) || 0) +
    ((typeof player !== "undefined" && player.timeShiftMs) || 0);
  return (typeof now !== "undefined" ? now : Date.now()) + off;
}

// ---- TIMEZONES: local time varies with LONGITUDE (world tile x) ----
// One timezone band is TZ_TILES wide and shifts the clock — and the sun — by a
// whole hour: 256 tiles east = +1h, 256 tiles west = -1h. 24 bands × 256 = 6144
// tiles wrap back to the same local time. Bands are centred on the origin, so
// Newhaven (0,0) is the reference zone. CLOCKS step by whole-hour zone, but the
// SUN sweeps continuously with longitude (sunPhase) — so like the real world,
// solar noon drifts up to ±30 min off the clock across a zone, and the
// terminator is a smooth curve rather than timezone-wide steps.
const TZ_TILES = 256;                                            // tiles per 1-hour timezone band
function tzZone(x) { return Math.round((x || 0) / TZ_TILES); }  // timezone band index (each = 1 hour)
function tzOffsetMin(x) { return tzZone(x) * 60; }              // minutes ahead of the origin zone
function _px() { return (typeof player !== "undefined" && player) ? player.x : 0; }
function localPhase(x) {
  if (x == null) x = _px();
  // Dream Forest (gameplay/dream.js): while dreaming, clock queries about the
  // far-off interior answer for the DOOR the player entered by — the wall
  // clock never jumps four timezones the instant they cross a waystone
  if (typeof Dream !== "undefined" && Dream.fxX) { const fx = Dream.fxX(x); if (fx != null) x = fx; }
  const p = dayPhase() + tzZone(x) / 24;                        // 1 hour = 1/24 of a day
  return p - Math.floor(p);                                     // wrap to 0..1
}
// the SUN's phase at longitude x: continuous (TZ_TILES tiles = 1/24 of a day,
// no rounding to zones), so daylight slides smoothly as you travel east/west.
function sunPhase(x) {
  if (x == null) x = _px();
  // Dream Forest: the interior keeps the door's sun (see localPhase above) —
  // light stays continuous across the silent entry swap
  if (typeof Dream !== "undefined" && Dream.fxX) { const fx = Dream.fxX(x); if (fx != null) x = fx; }
  const p = dayPhase() + (x || 0) / (TZ_TILES * 24);
  return p - Math.floor(p);                                     // wrap to 0..1
}

// wall-of-the-world clock: the LOCAL sun phase mapped to a 24h day, ticking in
// 1-min steps (00:00 at midnight/phase 0, 12:00 at noon/phase 0.5). Local time
// varies with longitude x (see TIMEZONES above); day LENGTH varies with latitude.
function clockTime(x) {
  const mins = Math.floor(localPhase(x) * 1440) % 1440;   // minute of the LOCAL day, 0..1439
  const hh = Math.floor(mins / 60), mm = mins % 60;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
// the small hours: townsfolk turn in to bed. 20:00–04:00 on the LOCAL clock at
// longitude x (each town by its own timezone; defaults to the player's).
function isBedtime(x) {
  const ph = localPhase(x);
  return ph >= 20 / 24 || ph < 4 / 24;
}

// fraction of the cycle that is daytime at world-tile latitude y (triangle wave)
function dayFraction(y) {
  // Tūhura Isle pocket: a flat 50% latitude — even day and night — while the
  // tutorial is live and the player stands on the isle (nothing else is
  // on screen there, so the global override is safe)
  if (typeof Tutorial !== "undefined" && Tutorial.flatSky()) return 0.5;
  // Dream Forest interior: day length answers for the entry door's latitude
  if (typeof Dream !== "undefined" && Dream.fxY) { const fy = Dream.fxY(y); if (fy != null) y = fy; }
  const u = ((y + LAT_HALFDAY) / (2 * LAT_HALFDAY)) % 2;
  const uu = u < 0 ? u + 2 : u;
  return Math.abs(1 - uu);          // 0 (endless night) … 1 (endless day)
}

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// daylight ∈ [0,1] at latitude y right now: 1 = full day, 0 = full night, with a
// smooth twilight band. Endless-day poles read ~1 always, endless-night ~0.
function daylightAt(y, phase) {
  const D = dayFraction(y);
  if (D >= 0.999) return 1;
  if (D <= 0.001) return 0;
  const ph = (phase == null) ? dayPhase() : phase;       // longitude-local phase when given
  const sun = Math.cos(2 * Math.PI * (ph - 0.5));        // +1 noon … -1 midnight
  const thr = Math.cos(Math.PI * D);                      // day/night boundary for this day-length
  const tw = 0.14;                                        // twilight softness
  return smoothstep(thr - tw, thr + tw, sun);
}
function daylightNow() {
  if (typeof window !== "undefined" && window.__dayOverride != null) return window.__dayOverride; // debug/testing hook
  const px = _px(), py = (typeof player !== "undefined" && player) ? player.y : 0;
  return daylightAt(py, sunPhase(px));                    // sun sweeps smoothly with longitude
}

// a short human label for the current sky (HUD). Uses the SUN's phase at x.
function skyLabel(y, x) {
  const ph = sunPhase(x);
  const L = daylightAt(y, ph);
  if (dayFraction(y) >= 0.999) return "Endless day";
  if (dayFraction(y) <= 0.001) return "Endless night";
  if (L > 0.85) return "Day";
  if (L > 0.25) return ph < 0.5 ? "Dawn" : "Dusk";
  return "Night";
}

// ---- the MOON ------------------------------------------------------------
// One lunar cycle every 8 game days (~8.5 real hours): the moon lags the sun
// by its age, so a new moon hugs the sun (invisible) and the full moon rises
// at sunset, exactly like the real sky. It rides the same flattened azimuth
// circle as the sun (render3d matches), and its up-window widens toward the
// endless-night pole — the polar winter keeps a long-riding moon for company,
// mirroring the midnight sun on the other side of the world.
const MOON_CYCLE = 8 * DAY_MS;
function moonState(x) {
  if (x == null) x = _px();
  const t = _clockMs();
  const age = (((t % MOON_CYCLE) + MOON_CYCLE) % MOON_CYCLE) / MOON_CYCLE; // 0 new … 0.5 full … 1 new
  const illum = 0.5 * (1 - Math.cos(2 * Math.PI * age));                   // lit fraction of the disc
  const mp = sunPhase(x) - age;
  const mph = mp - Math.floor(mp);                    // moon phase-of-day: 0.5 = moon-noon
  const y = (typeof player !== "undefined" && player) ? player.y : 0;
  const D = dayFraction(y);
  const Dm = Math.max(0.06, Math.min(0.97, 1.03 - D)); // up-window: long where nights are long
  const u = (mph - (0.5 - Dm / 2)) / Dm;               // 0 moonrise … 1 moonset
  if (u <= 0 || u >= 1) return { up: false, elev: 0, illum, age, dx: 0, dz: 0 };
  const th = 2 * Math.PI * (mph - 0.25);
  const mx = Math.cos(th), mz = 0.55 * Math.sin(th);   // same S/N flattening as the sun
  const n = Math.hypot(mx, mz) || 1;
  // elevation 0..1 (1 = zenith), deliberately LOW — the zoom-tilt sky band
  // only reaches ~6° above the horizon, so the moon rides inside it (a big
  // low moon, like the sun's own flattened arc, never lost off the top).
  const elev = Math.sin(Math.PI * u) * (0.025 + 0.045 * Math.sin(Math.PI * Math.min(0.999, Dm)));
  return { up: true, elev, illum, age, dx: mx / n, dz: mz / n };  // dx/dz point TOWARD the moon
}
// how much moonlight is falling right now, 0..1: needs the moon up and clear
// of the horizon, scaled by its phase; cloud cover smothers it.
function moonlightNow() {
  const m = moonState(_px());
  if (!m.up) return 0;
  let k = m.illum * Math.min(1, m.elev / 0.035);
  if (typeof weatherNow === "function") { const w = weatherNow(); if (w) k *= 1 - 0.85 * w.cloud; }
  return k;
}

// ---- AURORA events --------------------------------------------------------
// Deterministic random displays in the auroral ovals: the bands 8%–17% of the
// pole-to-pole span from EACH pole (both the endless-day and endless-night
// side — "83%–92% latitude" is the same band measured from the other pole).
// Time is sliced into 20-minute slots hashed on the world clock; ~30% of
// slots host a display, easing in and out inside its slot, each with its own
// peak strength. Returns raw activity 0..1 — the renderer gates it by night
// darkness and cloud cover (an aurora is always THERE, just invisible by day).
const AURORA_SLOT_MS = 20 * 60 * 1000;
function auroraNow(y) {
  if (typeof window !== "undefined" && window.__auroraOverride != null)
    return +window.__auroraOverride;                    // debug/testing hook (cheats console)
  if (y == null) y = (typeof player !== "undefined" && player) ? player.y : 0;
  const D = dayFraction(y);                             // 0..1 pole-to-pole position
  const p = Math.min(D, 1 - D);                         // distance from the NEAREST pole
  const band = smoothstep(0.065, 0.08, p) * (1 - smoothstep(0.17, 0.185, p));
  if (band <= 0) return 0;
  const t = _clockMs();
  const s = Math.floor(t / AURORA_SLOT_MS);
  if (_hash01(s * 0.618, 7.13) > 0.30) return 0;        // this slot: quiet sky
  const f = (t - s * AURORA_SLOT_MS) / AURORA_SLOT_MS;
  const env = smoothstep(0, 0.15, f) * (1 - smoothstep(0.85, 1, f));
  const peak = 0.55 + 0.45 * _hash01(s * 1.37, 3.71);
  return band * env * peak;
}

// ---- bioluminescent biomes: glow softly at night even with no fire ----
const BIO_BIOMES = {
  "Giant Mushroom Forest": { r: 42, g: 210, b: 150 },  // teal-green fungal glow
  "Dream Forest":          { r: 150, g: 120, b: 245 },  // violet dream glow
};
function bioBiomeGlow(name) { return BIO_BIOMES[name] || null; }

// ---- bioluminescent monsters: keyword → glow colour. Any monster whose kind or
// name matches lights up faintly in the dark. ----
const BIO_MOB = [
  [/wisp|spectre|specter|ghost|wraith|phantom|spirit|shade|banshee/, { r: 150, g: 220, b: 255 }],
  [/jelly|slime|ooze|gel/,                                          { r: 120, g: 255, b: 180 }],
  [/glow|lantern|spore|fungal|mush|myconid/,                        { r: 90, g: 240, b: 140 }],
  [/ember|magma|lava|flame|cinder|fire|phoenix/,                    { r: 255, g: 150, b: 60 }],
  [/crystal|prism|astral|star|celestial|seraph/,                    { r: 170, g: 200, b: 255 }],
  [/wyrmling|drake|dragon/,                                         { r: 255, g: 120, b: 90 }],
  [/fae|fairy|pixie|sprite|dream/,                                  { r: 200, g: 130, b: 255 }],
];
function monGlow(mon) {
  if (!mon) return null;
  const key = ((mon.kind || "") + " " + ((typeof MONSTERS !== "undefined" && MONSTERS[mon.kind] && MONSTERS[mon.kind].name) || "")).toLowerCase();
  for (const [re, col] of BIO_MOB) if (re.test(key)) return col;
  return null;
}

// ---- carried light: candles (ITEMS[id].light — numeric = brightness tier,
// `true` = tier 1). The player only casts light when a lit candle is held in the
// MAIN or OFF hand (weapon/shield slots), nothing else. ----
function lightBrightness(id) {
  const it = typeof ITEMS !== "undefined" && ITEMS[id];
  if (!it || !it.light) return 0;
  return typeof it.light === "number" ? it.light : 1;
}
// a lit candle you're carrying (firemaking.js lightCandle sets candleLitUntil /
// candleBright; the wick burns down and then it's dark again). Its brightness is
// what casts the glow around you at night (collectNightLights).
function candleInHand() {
  if (typeof player === "undefined" || !player) return 0;
  var NOW = (typeof now !== "undefined") ? now : Date.now();
  // a lit candle carried in the OFFHAND (shield) slot glows the whole time it's
  // held — no burn-down; equip one to carry light around.
  var off = player.equip && player.equip.shield;
  var offBright = off ? lightBrightness(off) : 0;
  // (legacy) a candle "lit" from the pack burns down on a wall-clock timer.
  var burnBright = (player.candleLitUntil && NOW < player.candleLitUntil) ? (player.candleBright || 1) : 0;
  return Math.max(offBright, burnBright);
}

// ---- light TIERS ----------------------------------------------------------
// A candle's brightness tier b (ITEMS[id].light, 1..9 across the 32 chandlery
// levels) sets BOTH how far its pool reaches (r, tiles) and how much darkness
// it lifts (s): a rushlight is a dim puddle, a cathedral candle floods a yard.
// gr/gs is the tight warm core at the flame (see drawNight) — scaled gently so
// finer candles read brighter without stacking into a colour-wash flare.
function candleLight(b) {
  b = Math.max(1, b || 1);
  return { r: 2 + b * 1.15, s: Math.min(1, 0.5 + b * 0.055), gr: 0.9 + b * 0.09, gs: 0.1 + b * 0.02 };
}
// A fire's light rides its FUEL TIER (the stoked log, 0..31) plus how hot it
// currently burns (hf = heat/HEAT_MAX, decays as the fire dies): better logs
// throw a wider, stronger pool, and every fire fades as it burns down.
function fireLight(tier, hf) {
  tier = Math.max(0, tier || 0); hf = Math.max(0, Math.min(1.2, hf || 0));
  return { r: 2.5 + tier * 0.14 + hf * 4.5, s: Math.min(1, 0.55 + hf * 0.4), gr: 1.4 + hf * 0.9, gs: 0.14 + hf * 0.06 };
}

// ---- is the player standing in a village/city? (towns are lamp-lit at night) ----
function inSettlement(x, y) {
  if (!(typeof world !== "undefined" && world && world.villagesNearPt)) return false;
  for (const v of world.villagesNearPt(x, y, 40)) {
    const dx = x - v.x, dy = y - v.y;
    if (dx * dx + dy * dy < v.R * v.R) return true;
  }
  return false;
}
function _hash01(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

// one shared read of "how dark is it for the player right now", so the main view
// and the minimap agree. dark ∈ [0,1]; 1 = completely black. Bioluminescent
// biomes and lamp-lit towns keep a dim ambient (capped darkness).
// deep night is DARK — just a sliver of moon/starlight so you can barely make
// out terrain shapes; the real light at night comes from fires and the
// villagers' candles. A tiny ambient floor stops it going 100% pure black.
const NIGHT_MAX_DARK = 0.99;   // deep night is near-absolute black — you need a light to see
// golden hour stays LUMINOUS: while the sun is above the horizon the ambient
// veil is mostly held off (a low sun means long gold light, not gloom), then
// eases in across the first minute after sundown so dusk still falls gently.
// Eased on wall time so the sundown flip never pops.
let _veilK = 1, _veilT = 0;
function _sunUpNow() {
  const y = (typeof player !== "undefined" && player) ? player.y : 0;
  const D = dayFraction(y);
  if (D <= 0.001) return false;
  if (D >= 0.999) return true;
  const u = (sunPhase(_px()) - (0.5 - D / 2)) / D;
  return u > 0 && u < 1;
}
function nightState() {
  const L = daylightNow();
  let dark = Math.min(1 - L, NIGHT_MAX_DARK);   // ambient floor: only a whisper above pure black
  const tv = (typeof now !== "undefined" ? now : Date.now());
  const dtv = Math.max(0, Math.min(1000, tv - _veilT)); _veilT = tv;
  _veilK += ((_sunUpNow() ? 0.32 : 1) - _veilK) * (dtv / 45000);
  dark *= _veilK;
  // moonlight: a clear night under a high full moon is a shade less black —
  // a gentle lift only (deep night stays properly dark; fires still rule).
  dark *= 1 - 0.12 * moonlightNow();
  const biome = (typeof world !== "undefined" && world && world.biomeNameAt)
    ? world.biomeNameAt(player.x, player.y) : "";
  const bio = bioBiomeGlow(biome);
  // bioluminescent biomes stay just as dark as anywhere — the glow comes from
  // the individual mushrooms/trees/rocks/monsters, not a biome-wide wash.
  const town = inSettlement(player.x, player.y);
  // towns keep a faint even ambient so the whole settlement reads as dimly lit
  // (the villagers' candles then add their soft pools on top). Not bright — just
  // enough that a lamp-lit town never sinks to the near-black of open wilderness.
  if (town) dark = Math.min(dark, 0.9);
  return { dark, bio, town, L };
}

// world-space light sources (in PIXEL coords so the main view can project them;
// the minimap divides by tile size). {px,py, r(tiles), s(erase strength), col}.
// memoized per game-frame timestamp: both drawNight (overlay) and
// renderMinimap call this every night frame — building the list twice
// doubled the cost of everything below. Callers only map over the result,
// never mutate it, so sharing one array is safe.
let _nlAt = -1, _nlOut = null;
function collectNightLights() {
  const out = [];
  if (typeof player === "undefined" || !player) return out;
  const PXf = (typeof PX === "function") ? PX : (t) => t * 48;
  const NOW = (typeof now !== "undefined") ? now : Date.now();
  if (NOW === _nlAt && _nlOut) return _nlOut;
  const HM = (typeof HEAT_MAX !== "undefined") ? HEAT_MAX : 1000;
  const c = candleInHand();
  if (c > 0) { const cl = candleLight(c); out.push({ px: player.px, py: player.py, r: cl.r, s: cl.s, col: [255, 222, 150], gr: cl.gr, gs: cl.gs }); }
  // candles/lamps the player has SET DOWN on the ground or a table: each burns
  // as a warm world light on the player's current storey.
  if (typeof placed !== "undefined" && placed && placed.length) {
    const plv = player.level | 0;
    for (const p of placed) {
      const it = typeof ITEMS !== "undefined" && ITEMS[p.id];
      if (!it || !it.light) continue;
      if ((p.level | 0) !== plv) continue;
      if (Math.abs(p.x - player.x) > 46 || Math.abs(p.y - player.y) > 46) continue;
      const cl = candleLight(lightBrightness(p.id));
      out.push({ px: PXf(p.x + 0.5), py: PXf(p.y + 0.5), r: cl.r, s: cl.s, col: [255, 222, 150], gr: cl.gr, gs: cl.gs });
    }
  }
  // fires: campfires (dyn nodes) and stoked station pilot fires share the same
  // tiered curve. A campfire's heat record lives in stationHeat too, so track
  // its tiles and skip them in the station pass — one light per fire.
  const fireSeen = new Set();
  if (typeof dynNodes !== "undefined") for (const d of dynNodes) {
    if (d.type !== "campfire") continue;
    const hf = (typeof stationHeatNow === "function") ? stationHeatNow(d) / HM : 0.5;
    if (hf <= 0) continue;
    const rec = (typeof stationHeat !== "undefined" && typeof heatKey === "function") ? stationHeat.get(heatKey(d)) : null;
    if (typeof heatKey === "function") fireSeen.add(heatKey(d));
    const fl = fireLight(rec ? rec.tier : (d.logTier || 0), hf);
    out.push({ px: PXf(d.x + 0.5), py: PXf(d.y + 0.5), r: fl.r, s: fl.s, col: [255, 168, 78], gr: fl.gr, gs: fl.gs });
  }
  if (typeof stationHeat !== "undefined") for (const [key, rec] of stationHeat) {
    if (fireSeen.has(key)) continue;
    const p = key.split(","); if ((+p[2]) !== (player.level | 0)) continue;
    const frac = 1 - (NOW - rec.stokedAt) / rec.burnMs; if (frac <= 0) continue;
    const hf = (rec.peak * frac) / HM;
    const fl = fireLight(rec.tier, hf);
    out.push({ px: PXf(+p[0] + 0.5), py: PXf(+p[1] + 0.5), r: fl.r, s: fl.s, col: [255, 168, 78], gr: fl.gr, gs: fl.gs });
  }
  if (typeof monGlow === "function" && typeof monsters !== "undefined") for (const m of monsters) {
    if (!m.alive) continue;
    // a light only matters on the overlay or the minimap window (±56 tiles)
    // — skip the rest of the array before any lookup
    if (Math.abs(m.x - player.x) > 56 || Math.abs(m.y - player.y) > 56) continue;
    // a monster glows if it's an inherently luminous kind (monGlow) OR it's
    // standing in a bioluminescent biome (everything there glows). The biome
    // half is cached per monster at its SPAWN tile: biomeNameAt is six
    // uncached noise-field evaluations, and re-running it per monster per
    // frame was the single biggest night cost. Monsters wander ≤4 tiles from
    // spawn, so the spawn-tile biome is the same answer.
    let col = monGlow(m);
    if (!col) {
      if (m._bioGlow === undefined)
        m._bioGlow = (world && world.biomeNameAt)
          ? bioBiomeGlow(world.biomeNameAt(m.sx != null ? m.sx : m.x, m.sy != null ? m.sy : m.y)) || null
          : null;
      col = m._bioGlow;
    }
    if (!col) continue;
    const sc = (typeof MONSTERS !== "undefined" && MONSTERS[m.kind]) ? MONSTERS[m.kind].scale || 1 : 1;
    out.push({ px: PXf(m.x + 0.5), py: PXf(m.y + 0.5), r: 2 + sc * 0.8, s: 0.72, col: [col.r, col.g, col.b] });
  }
  // candle-lit windows throughout the village/city the player is standing in
  for (const l of settlementLights()) out.push(l);
  // a warm candle in the hand of every villager currently on lamplighting duty
  // (carrying candles out at dusk / gathering them at dawn — set by render3d)
  if (typeof world !== "undefined" && world && world.npcs) for (const npc of world.npcs) {
    if (!npc._lamp) continue;
    out.push({ px: (npc.px != null ? npc.px : PXf(npc.x)), py: (npc.py != null ? npc.py : PXf(npc.y)), r: 2.2, s: 0.8, col: [255, 202, 120] });
  }
  _nlAt = NOW; _nlOut = out;
  return out;
}

// ---- lamplighter routine timing ----
// villagers work the candles only during the twilight transitions: they carry
// them OUT and place them as dusk falls, and GATHER them as dawn breaks.
function daylightTrend(x) { return sunPhase(x) < 0.5 ? +1 : -1; }   // +1 dawn (rising), -1 dusk (falling), by the SUN
function lampMode() {                                             // "place" | "collect" | null
  if (typeof player === "undefined" || !player || !inSettlement(player.x, player.y)) return null;
  const L = daylightNow();
  if (L <= 0.05 || L >= 0.72) return null;                        // fully placed (night) or fully stored (day)
  return daylightTrend() < 0 ? "place" : "collect";
}
// the settlement the player is in + its candle-STORE building (nearest the
// village centre) — where villagers fetch candles from and return them to.
function currentSettlement() {
  if (!(typeof world !== "undefined" && world && world.villagesNearPt) || typeof player === "undefined" || !player) return null;
  for (const v of world.villagesNearPt(player.x, player.y, 40)) {
    const dx = player.x - v.x, dy = player.y - v.y;
    if (dx * dx + dy * dy >= v.R * v.R) continue;
    let store = null, bd = Infinity;
    for (const b of (v.buildings || [])) {
      const cx = b.x0 + b.w / 2, cy = b.y0 + b.h / 2, d = (cx - v.x) * (cx - v.x) + (cy - v.y) * (cy - v.y);
      if (d < bd) { bd = d; store = { x: Math.round(cx), y: Math.round(cy) }; }
    }
    return { v, store: store || { x: v.x, y: v.y } };
  }
  return null;
}

// ---- village candle SPOTS: real positions where villagers set out candles,
// both inside buildings and scattered around outside. Deterministic + cached
// per village (layout never changes), each with its own dusk-lighting moment. ----
const _spotCache = new Map();     // "vx,vy" → [{x,y,inside,thr,tier,stand}]
// Villagers set out BASIC candles on floor stands at dusk, in STRATEGIC spots —
// one by each house door (the wall facing the street/centre) and a lit ring
// around the town square/well — not scattered at random.
const CANDLE_STANDS = ["candlestand_iron", "candlestand_wood", "candlestand_brass"];
function candleBrightFor(req) { return 1 + Math.floor((req || 2) / 4); }
function villageCandleSpots(v) {
  const key = v.x + "," + v.y;
  let spots = _spotCache.get(key);
  if (spots) return spots;
  spots = [];
  const seen = new Set();
  const push = (x, y, inside) => {
    x = Math.round(x); y = Math.round(y);
    // never on water: no stand in the village pond / river / a flooded strip
    if (typeof world !== "undefined" && world && world.isWater && world.isWater(x, y)) return;
    const dk = x + "," + y; if (seen.has(dk)) return; seen.add(dk);   // one stand per tile
    const tier = 14 + Math.floor(_hash01(x * 2.3, y * 3.1) * 7);   // fine candles: tier 14..20 (brightness 4..6)
    spots.push({
      x, y, inside, tier,
      thr: 0.1 + _hash01(x * 1.7, y * 1.3) * 0.42,
      // outdoor candles sit on a floor stand the villagers carry out; indoor
      // ones just stand on the furniture (glow through the roof)
      stand: inside ? null : CANDLE_STANDS[Math.floor(_hash01(y * 5.1, x * 4.7) * CANDLE_STANDS.length)],
    });
  };
  // an outdoor stand must sit on open ground — never inside a building footprint
  // (a wall or doorway), so guard every street/square candle against all houses.
  const inBld = (x, y) => (v.buildings || []).some(bd =>
    x >= bd.x0 - 0.5 && x < bd.x0 + bd.w + 0.5 && y >= bd.y0 - 0.5 && y < bd.y0 + bd.h + 0.5);
  const pushOut = (x, y) => { x = Math.round(x); y = Math.round(y); if (!inBld(x, y)) push(x, y, false); };
  for (const b of (v.buildings || [])) {
    const cx = b.x0 + b.w / 2, cy = b.y0 + b.h / 2;
    // a soft candle inside for the through-roof window glow
    push(cx, cy, true);
    // one stand just OUTSIDE the wall that faces the town centre, set to ONE
    // SIDE of the doorway (never dead-centre where the door is) so it lights the
    // street the villager steps out onto without blocking the entrance.
    const dx = v.x - cx, dy = v.y - cy;
    const side = _hash01(cx, cy) < 0.5 ? -1 : 1;
    let ox, oy;
    if (Math.abs(dx) >= Math.abs(dy)) { ox = cx + Math.sign(dx || 1) * (b.w / 2 + 1.4); oy = cy + side * (b.h * 0.34); }
    else { ox = cx + side * (b.w * 0.34); oy = cy + Math.sign(dy || 1) * (b.h / 2 + 1.4); }
    pushOut(ox, oy);
  }
  // a lit ring of stands around the town square / well at the settlement centre
  const squareR = Math.min(7, Math.max(3, v.R * 0.2));
  const nRing = v.kind === "city" ? 10 : 6;
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * Math.PI * 2;
    pushOut(v.x + Math.cos(a) * squareR, v.y + Math.sin(a) * squareR);
  }
  // FULL COVERAGE: a jittered grid of stands over the whole settlement so no
  // street or corner is left dark — spaced so their big pools overlap. Building
  // footprints are skipped (pushOut), duplicate tiles deduped (push).
  const step = 8, vRy = v.Ry != null ? v.Ry : v.R; // rectangular walls (Newhaven)
  for (let gx = -v.R; gx <= v.R; gx += step)
    for (let gy = -v.R; gy <= v.R; gy += step) {
      if (gx * gx + gy * gy > v.R * v.R || Math.abs(gy) > vRy - 2) continue;
      pushOut(v.x + gx + (_hash01(gx * 1.3, gy * 2.7) - 0.5) * 3.5,
              v.y + gy + (_hash01(gy * 1.9, gx * 3.3) - 0.5) * 3.5);
    }
  _spotCache.set(key, spots);
  return spots;
}
// ---- lamplighter-DELIVERED candle state -----------------------------------
// While the player watches a settlement through dusk/dawn, outdoor stands no
// longer pop in/out by the clock: a stand (and its light) appears the moment a
// lamplighter ARRIVES carrying it from the storage room, and vanishes when one
// picks it up at dawn to carry it back inside (render3d assignLampTasks calls
// lampSpotSet on those arrivals). Unwatched settlements stay clock-driven
// (s.thr) so distant towns are always fully lit at night and cleared by day
// whether or not anyone was there to see the shuttle.
const _lampOv = new Map();          // "vx,vy" → Map("x,y" → delivered?:bool)
function _lampOvFor(v) {
  const k = v.x + "," + v.y;
  let m = _lampOv.get(k);
  if (!m) { m = new Map(); _lampOv.set(k, m); }
  return m;
}
function lampSpotSet(v, x, y, placedNow) { _lampOvFor(v).set(x + "," + y, !!placedNow); }
function lampSpotPlaced(v, x, y) { return _lampOvFor(v).get(x + "," + y); }   // true | false | undefined

// candle spots near the player that are currently LIT, for the settlement the
// player is standing in. reach = tile radius to include (screen ~ 42).
function litCandlesNear(reach) {
  const out = [];
  if (typeof world === "undefined" || !world || !world.villagesNearPt || typeof player === "undefined" || !player) return out;
  const dark = (typeof nightState === "function") ? nightState().dark : 1;
  if (dark <= 0.02) { if (_lampOv.size) _lampOv.clear(); return out; }   // day: all in storage; fresh cycle
  reach = reach || 42;
  const mode = (typeof lampMode === "function") ? lampMode() : null;
  const cur = mode ? currentSettlement() : null;
  for (const v of world.villagesNearPt(player.x, player.y, 40)) {
    // include any settlement whose candles can reach the view — so lit streets
    // appear as you APPROACH a town at night, not only once you cross into it.
    if (Math.abs(player.x - v.x) > v.R + reach || Math.abs(player.y - v.y) > v.R + reach) continue;
    // the settlement the player is standing in during twilight: outdoor stands
    // are DELIVERY-driven (lamplighters physically carry them out/in)
    const ov = (cur && cur.v.x === v.x && cur.v.y === v.y) ? _lampOvFor(v) : null;
    for (const s of villageCandleSpots(v)) {
      if (Math.abs(s.x - player.x) > reach || Math.abs(s.y - player.y) > reach * 0.78) continue;
      if (ov && !s.inside) {
        const st = ov.get(s.x + "," + s.y);
        // dusk: dark until a villager sets the stand down; dawn: lit until one
        // carries it away (spots never visited fall back to the clock at the
        // window's end, when lampMode returns null)
        if (mode === "place" ? st !== true : st === false) continue;
      } else if (daylightTrend() > 0 ? dark < 1 - s.thr : dark < s.thr) {
        // clock-driven, and ASYMMETRIC: through dusk (falling) spots light one
        // by one as dark passes thr; through dawn (rising) they're gathered one
        // by one while it's still dark (dark < 1−thr) — every outdoor stand is
        // gone well before mid-morning. This branch is also what a spot
        // already carried off by a villager (st === false) falls into once the
        // collect window closes, so picked-up stands can never REAPPEAR in the
        // morning sun (they used to: morning dark ≈ 0.28 still beat low thr).
        continue;
      }
      out.push(s);
    }
  }
  // Tūhura's Harbour Village (gameplay/tutorial.js villageLamps): the
  // keepers' lamp stands ride the same clock stagger — the isle's staged
  // dusk lights them one by one as the keepers come home to the tents.
  if (typeof Tutorial !== "undefined" && Tutorial.villageLamps)
    for (const s of Tutorial.villageLamps()) {
      if (Math.abs(s.x - player.x) > reach || Math.abs(s.y - player.y) > reach * 0.78) continue;
      if (daylightTrend() > 0 ? dark < 1 - s.thr : dark < s.thr) continue;
      out.push(s);
    }
  return out;
}
// candle LIGHTS for the light-map (pixel coords). Inside candles glow softer.
function settlementLights() {
  const out = [];
  const PXf = (typeof PX === "function") ? PX : (t) => t * 48;
  for (const s of litCandlesNear(42)) {
    const b = candleBrightFor(s.tier);
    // `r` illuminates the DARKNESS around the stand (a moderate pool so the
    // street is visible); `gr`/`gs` are a small, tight WARM GLOW right at the
    // flame — so the candle reads as a glowing point instead of the whole area
    // flaring into a colour wash.
    // fine candles throw a big pool of light (tier 14-20 → b 4-6 → ~11-16 tiles
    // outdoors); indoor ones are smaller (they glow out through the roof).
    const r = s.inside ? 3 + b * 0.9 : 4 + b * 2.0;
    // `r` (RANGE) is unchanged — the town stays lit right across; `s` is the
    // BRIGHTNESS (how much darkness each pool lifts). Kept deliberately LOW so a
    // lamp-lit town reads as WELL COVERED but DIM, not a field of bright pools.
    out.push({ px: PXf(s.x + 0.5), py: PXf(s.y + 0.5), r, s: s.inside ? 0.08 : 0.1, col: [255, 200, 130], gr: 1.2, gs: 0.07 });
  }
  return out;
}
// the physical placed candles to RENDER as world objects (render3d reads this).
function settlementCandleObjects() { return litCandlesNear(38); }
// the lit lamplighter candle standing on a tile right now (or null) — village
// candles aren't decor tiles, so the context menu asks here to offer Examine.
function candleSpotAt(x, y) {
  for (const s of litCandlesNear(42)) if (s.x === x && s.y === y) return s;
  return null;
}

// paint a darkness layer with circular light holes onto `ctx`. lights are in the
// SAME pixel space as ctx: {x,y,r,s}. Uses an offscreen buffer so the holes are
// clean even circles and the result composites in one draw.
const _dkBufs = new Map();     // "w×h" → {cv,ctx}, so main-view + minimap don't thrash one buffer
function paintDarkness(ctx, w, h, dark, lights, nightCol) {
  w = Math.round(w); h = Math.round(h);
  if (dark <= 0.01 || w <= 0 || h <= 0) return;
  const bk = w + "x" + h;
  let buf = _dkBufs.get(bk);
  if (!buf) { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; buf = { cv, ctx: cv.getContext("2d") }; _dkBufs.set(bk, buf); }
  const _dkCv = buf.cv, d = buf.ctx;
  d.setTransform(1, 0, 0, 1, 0, 0);
  d.clearRect(0, 0, w, h);
  d.globalCompositeOperation = "source-over";
  d.globalAlpha = dark; d.fillStyle = nightCol || "rgb(4,6,16)"; d.fillRect(0, 0, w, h); d.globalAlpha = 1;
  d.globalCompositeOperation = "destination-out";
  for (const li of (lights || [])) {
    if (li.r <= 0) continue;
    const g = d.createRadialGradient(li.x, li.y, 0, li.x, li.y, li.r);
    g.addColorStop(0, `rgba(0,0,0,${li.s})`);
    g.addColorStop(0.55, `rgba(0,0,0,${li.s * 0.55})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    d.fillStyle = g;
    d.beginPath(); d.arc(li.x, li.y, li.r, 0, Math.PI * 2); d.fill();
  }
  d.globalCompositeOperation = "source-over";
  ctx.drawImage(_dkCv, 0, 0, w, h);
}

// is this NPC asleep in bed right now? True only when it's bedtime at the NPC's
// OWN longitude AND it has actually settled onto its sleeping spot — its bed
// (residents; upstairs bedrooms need the matching storey too) or its home post
// (shopkeepers / ambient townsfolk / quest-givers). A sleeper won't greet,
// answer or be talked to. (An NPC still walking home at night is NOT asleep.)
function npcAsleep(npc) {
  if (!npc || typeof isBedtime !== "function" || !isBedtime(npc.x)) return false;
  const bed = npc._bed || npc._home;
  if (!bed) return false;
  const bedLv = npc._bed ? (npc._bedLevel | 0) : 0;
  return (npc.level | 0) === bedLv && npc.x === bed[0] && npc.y === bed[1];
}
// a shopkeeper's shop is CLOSED overnight (bedtime hours in the shop's timezone),
// so you can't trade with them until morning — regardless of where they're stood.
function shopClosed(npc) { return typeof isBedtime === "function" && isBedtime(npc && npc.x); }

if (typeof window !== "undefined") Object.assign(window, {
  DAY_MS, dayPhase, tzZone, tzOffsetMin, localPhase, sunPhase, clockTime, isBedtime, dayFraction, daylightAt, daylightNow, skyLabel,
  moonState, moonlightNow, auroraNow,
  bioBiomeGlow, monGlow, lightBrightness, candleInHand, candleLight, fireLight, inSettlement,
  nightState, collectNightLights, settlementLights, settlementCandleObjects, candleSpotAt, paintDarkness,
  lampMode, currentSettlement, lampSpotSet, lampSpotPlaced, npcAsleep, shopClosed,
});

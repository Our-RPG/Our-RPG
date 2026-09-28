// ===== world terrain noise and biome classification =====
"use strict";

// ---------- Tūhura Isle: the hand-shaped tutorial island ----------
// New characters wake here (gameplay/tutorial.js) and are led through the
// tutorial in a FIXED ORDER: the isle is a long serpentine chain of twelve
// zone "pods" (one per tutor — Landing, the Bush, the Cove, the Forge, the
// Springs, the Lagoon, the Bank, the Farm Vale, the Warden's Pit, the Sky
// Knoll, the Portal Crown, the Harbour), joined by narrow fenced isthmuses.
// A dirt path runs the whole spine; each isthmus gate only opens when the
// previous tutor is done (Tutorial.barred gates by chain position, so the
// water flanking a fence is barred too — no swimming around).
//
// The island is carved at the TERRAIN level — an override on the elevation/
// climate fields below shaped as a TUBE around the pod-centre polyline —
// so erosion, biome classify, water depth, the renderer, the world map and
// BOTH warm workers (which importScripts this exact file) all agree on its
// shape. features.js excludes procedural settlements/POIs/portals/icons via
// tutIsleAtMap, and chunks.js stamps path/fences/stations/tutors.
// All values in MAP units (= game tiles / 2) unless suffixed g.
var TUT_ISLE = (() => {
  // RINGED ISLE (user redesign 2026-09-16): ONE circular island — ten outer
  // ring sectors, four middle-ring chambers, and the crown at the very
  // centre. The 15-keeper journey weaves in and out of the rings:
  //   outer 1 → middle 2 → outer 3·4·5 → middle 6 → CENTRE 7 → middle 8 →
  //   outer 9·10·11 → middle 12 → outer 13·14·15 (the Harbour).
  // Ring boundaries and sector spokes are FENCES with gate arches where the
  // journey path crosses (tutFenceAt / tutGateArchAt below feed chunks.js
  // painting and tutorial.js barred()). All units are MAP units (game/2).
  // ISLAND CENTRE (relocated 2026-09-18): the isle is A SEPARATE MAP, not a
  // feature of the main world — it sits in a far open-sea basin ~6400 game
  // tiles WSW of Newhaven (probed offline against seed 1337: ~90% natural
  // water inside the whole carve disc, still world block (0,0) so boot-time
  // world naming is unchanged, well clear of DREAM_WORLD's rect). Nothing
  // physical connects it to the mainland: the widened private-ocean carve
  // (M below) drowns everything within sight, and Tutorial.barred() mists
  // the SEAL_D disc against all travel in both directions. Saves from the
  // old seat (game -760,1000) are translated on load — storage.js
  // migrateTutIsleCoords must match any future move of these constants,
  // and the game-tile delta from the old seat must stay a whole number of
  // 32-tile chunks (seen-chunk keys translate by integer chunk counts) and
  // a whole number of map units (the rounded fence/gate geometry then
  // translates exactly). Current delta: game (-5408, +736) = chunks (-169, +23).
  const CX = -3084, CY = 868;        // island centre
  const RC = 16, RM = 32, RO = 54;   // centre wall / middle ring / coast radii
  const D2R = Math.PI / 180;
  // pod seats (degrees, screen convention: -90 = north/up, +x east).
  // Pod 2 (Fisher) sits at -42° — nudged OFF the river ray (-36°) so the
  // camp stands on the west bank of its own river.
  const OUTER_ANG = { 0: -72, 2: -42, 3: 0, 4: 36, 8: 72, 9: 108, 10: 144, 12: 180, 13: -144, 14: -108 };
  const MID_ANG   = { 1: -90, 5: 0, 7: 90, 11: 180 };
  const SPOKES = [];                 // outer-sector boundary angles (deg)
  for (let k = 0; k < 10; k++) SPOKES.push(-90 + 36 * k);
  const MIDWALLS = [-45, 45, 135, 225]; // middle-chamber boundary angles (deg)
  const seat = (ang, rad) => ({ mx: Math.round(CX + Math.cos(ang * D2R) * rad),
                                my: Math.round(CY + Math.sin(ang * D2R) * rad) });
  const pods = [];
  for (let i = 0; i < 15; i++) {
    let ang = 0, rad = 0, r = 10;
    if (i === 6) { r = RC - 3; }                                          // the CENTRE crown
    else if (MID_ANG[i] !== undefined) { ang = MID_ANG[i]; rad = (RC + RM) / 2; r = 8; }
    else { ang = OUTER_ANG[i]; rad = (RM + RO) / 2; r = 10; }
    pods.push({ ...seat(ang, rad), r, ang, rad });
  }
  // per-pod climate + relief flavour (same consumers as ever, new seats).
  // EVERY pod gets its own biome (user req 2026-09-16): hum/tmp/farm/wrd are
  // the per-pod targets tutMix drives the climate fields to (temperature and
  // weirdField grew per-pod reads for this), chosen so classify() lands each
  // zone in a different biome — with ONE deliberate exception: the Landing
  // (0) and the Harbour (14) SHARE the plains, because they form a single
  // open village shore with no fence between them (see the -90° spoke skip
  // in _tutFenceBuild). Margins clear the ±0.04 humidity wobble.
  pods[0].hum = 0.38;                                    // Landing → GRASS
  pods[1].hum = 0.64; pods[1].tmp = 0.50;                // the Bush chamber → FOREST
  pods[2].hum = 0.76; pods[2].tmp = 0.70;                // the Cove → WETLAND (rivermouth flats)
  pods[3].hum = 0.26; pods[3].tmp = 0.60;                // the Forge → BADLANDS
  pods[4].hum = 0.63; pods[4].tmp = 0.70;                // the Lagoon → JUNGLE
  pods[5].hum = 0.51;                                    // the Bank camp → MEADOW
  pods[6].hum = 0.40; pods[6].farm = 0.75; pods[6].civ = 0.60; // Farm Vale = the CENTRE → FARM
  pods[7].hum = 0.60; pods[7].farm = 0.80;               // Woodcrafting → CHERRY orchard
  pods[8].hum = 0.63; pods[8].tmp = 0.70; pods[8].farm = 0.75; // Cooking → BAMBOO grove
  pods[9].hum = 0.78;                                    // the Warden's Pit → SWAMP
  pods[10].hum = 0.35; pods[10].tmp = 0.70; pods[10].farm = 0.85; // the Springs → OASIS
  pods[11].hum = 0.45; pods[11].tmp = 0.36;              // the Sky Knoll → TUNDRA
  pods[12].hum = 0.62; pods[12].tmp = 0.36;              // Candle Hollow → TAIGA
  pods[13].wrd = 0.18;                                   // Portal Crown → RUINS
  pods[14].hum = 0.38;                                   // the Harbour → PLAINS, same shore as the Landing
  const outward = (i, k) => ({ dx: Math.round(Math.cos(pods[i].ang * D2R) * k),
                               dy: Math.round(Math.sin(pods[i].ang * D2R) * k) });
  pods[4].pool = { ...outward(4, 6), r: 4.5, d: 0.16 };  // Vrixa's lagoon, toward the SE coast
  pods[10].pool = { ...outward(10, 5), r: 3.5, d: 0.10 };// Nala's wash-springs, SW
  pods[11].bump = { r: 7, h: 0.06 };                     // Ravenna's sky knoll (W chamber)
  pods[12].bump = { r: 6, h: 0.05 };                     // the candle hollow rise
  pods[13].bump = { r: 6, h: 0.05 };                     // the portal crown
  // THE RIVER: a RADIAL stream on the -36° ray — springing just outside the
  // centre wall, running out through the Bank chamber's northern reach and
  // the whole Fisher sector, opening FREELY to the sea (the weir arcs are
  // gone, user req 2026-09-16: no fences downstream of the Bush→Cove river
  // gate). The upstream reach through the Bank chamber is a FENCED corridor
  // (bank fence lines below) entered through the -45° chamber wall's water
  // gap: the journey itself now RIDES the river — gate 1 stands mid-channel
  // where the middle ring crosses the water, and the current carries the
  // Bushman's graduate down into the Cove. The path still bridges the river
  // once, between pods 2→3.
  const RA = -36 * D2R;
  // the spring rises RIGHT AGAINST the centre wall (user req 2026-09-16:
  // rSrc RC+2 → RC+0.5, water extent from RC−0.0) — no dry strip behind the
  // source to walk around; the wall's posts stand in the springhead water
  const rSrc = RC + 0.5, rCross = (RM + RO) / 2, rMouth = RO + 1.5;
  const rpt = t => ({ x: CX + Math.cos(RA) * t, y: CY + Math.sin(RA) * t });
  const river = {
    ux: Math.cos(RA), uy: Math.sin(RA),  // downstream unit vector (source → sea)
    rSrc, rCross, rMouth, waterR: 2.6,
    src: rpt(rSrc), cross: rpt(rCross), mouth: rpt(rMouth),
  };
  // the JOURNEY PATH: pod → gate → pod polyline; gate i sits at s = i + 0.5.
  const wrapMid = (a, b) => { let d = ((b - a + 540) % 360) - 180; return a + d / 2; };
  const zone = i => i === 6 ? 2 : (MID_ANG[i] !== undefined ? 1 : 0); // 0 outer, 1 middle, 2 centre
  const gates = [];
  const angDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  for (let i = 0; i + 1 < 15; i++) {
    const za = zone(i), zb = zone(i + 1);
    let g;
    if (i === 1) {
      // the RIVER GATE (user req 2026-09-16): gate 1 (Bush → Cove) stands
      // IN THE RIVER, mid-channel where the middle ring crosses the water —
      // the ring fence runs bank-to-bank across the course and only this
      // arch opens (once the Bushman is done); the way into the Cove is to
      // ride the current down through it.
      const rg = rpt(RM);
      g = { mx: Math.round(rg.x), my: Math.round(rg.y) };
    } else if (za === 0 && zb === 0) {
      // adjacent outer sectors: the gate must sit ON the shared SPOKE fence
      // — snap the seats' mid-angle to the nearest sector boundary (a seat
      // can be nudged off-centre, e.g. the Fisher's river-bank camp)
      const mid = wrapMid(pods[i].ang, pods[i + 1].ang);
      let sp = SPOKES[0];
      for (const a of SPOKES) if (angDist(a, mid) < angDist(sp, mid)) sp = a;
      g = seat(sp, (RM + RO) / 2);
    } else if (za === 2 || zb === 2) {   // centre wall crossing
      g = seat(za === 2 ? pods[i + 1].ang : pods[i].ang, RC);
    } else {                              // outer ↔ middle: on the RM ring
      g = seat(wrapMid(pods[i].ang, pods[i + 1].ang), RM);
    }
    gates.push({ x: g.mx, y: g.my, i });
  }
  // BACKTRACK SHORTCUTS (user req 2026-09-16): extra arches SHARING a
  // journey gate's index, so each unbars the moment that stage completes —
  // opening loops back through earlier pods. All appended AFTER the 14
  // journey gates so the path loop's gates[i] indexing is untouched;
  // classify/tutGateArchAt/barred()/the map overlay scan the whole array.
  // Entries are [gateIndex, fence angle°, radius] seat() placements on real
  // fence lines (1-based pod names in the comments match the user's table):
  const SHORTCUTS = [
    [6,  45,   (RC + RM) / 2], // Kenji's shortcut: Bank ↔ Wood chambers (45° wall) — the split-selves reunion lane
    [1,  -54,  (RM + RO) / 2], // gate 2 also opens: Landing(1) ↔ Cove(3), the -54° spoke
    [4,  0,    RM],            // gate 5 also opens: Forge(4) ↔ Bank chamber(6), the RM ring at 0°
    [5,  -90,  RC],            // gate 6 also opens: Bush chamber(2) ↔ Farm crown(7), the centre wall at -90°
    [7,  54,   (RM + RO) / 2], // gate 8 also opens: Lagoon(5) ↔ Cooking(9), the 54° spoke
    [10, 225,  (RC + RM) / 2], // gate 11 also opens: Bush(2) ↔ Sky Knoll(12) chambers, the 225° wall
    [10, 135,  (RC + RM) / 2], // gate 11 also opens: Wood(8) ↔ Sky Knoll(12) chambers, the 135° wall
    [10, 180,  RC],            // gate 11 also opens: Farm crown(7) ↔ Sky Knoll(12), the centre wall at 180°
    [12, -130.5, RM],          // gate 13 also opens: Bush chamber(2) ↔ Portal Crown sector(14), the RM band they share (-135..-126°)
    // (the user's Warden(10) ↔ Sky Knoll(12) pair has NO shared border —
    // the Wood chamber and Springs sector lie between them — so it has no
    // arch; by gate 11 the war→soap→sky gates 9+10 already chain the route)
  ];
  for (const [i, ang, rad] of SHORTCUTS) {
    const sc = seat(ang, rad);
    gates.push({ x: sc.mx, y: sc.my, i, shortcut: true });
  }
  // the Bush(2) ↔ Bank chamber(6) shortcut (with gate 5) is special: the
  // -45° chamber wall runs BESIDE the fenced river corridor, so the lane
  // needs THREE arches in a row — through the wall, through the west bank
  // fence, a wade across the channel, and through the east bank fence.
  {
    const t = 28, side = river.waterR + 1.2;   // aligned at radial t≈28
    const wall = seat(-45, 28.5);
    gates.push({ x: wall.mx, y: wall.my, i: 4, shortcut: true });
    for (const s of [-side, side])
      gates.push({ x: CX + river.ux * t - river.uy * s,
                   y: CY + river.uy * t + river.ux * s, i: 4, shortcut: true });
  }
  const path = [];                        // [{x, y, s}]
  for (let i = 0; i < 15; i++) {
    if (i === 6) {
      // the crown vertex is nudged SE of centre: the 5×5 FENCED FARM (user
      // req 2026-09-16, tutorial.js stamps) occupies the exact centre, and
      // the dirt path's east→south dog-leg skirts its fence past the gate
      path.push({ x: pods[6].mx + 2.5, y: pods[6].my + 2.5, s: 6 });
    } else path.push({ x: pods[i].mx, y: pods[i].my, s: i });
    if (i === 1) {
      // detour to the RIVER ENTRY: from the Bush camp the path leads through
      // the -45° chamber wall's water gap onto the upstream corridor, then
      // runs DOWN THE RIVER (mid-channel — no dirt is painted on water) to
      // the river gate and on to the Fisher's bank.
      const re = rpt(23);
      path.push({ x: re.x, y: re.y, s: 1.25 });
    }
    if (i < 14) path.push({ x: gates[i].x, y: gates[i].y, s: i + 0.5 });
  }
  // THE SWIM-MASTER'S ISLET (user req 2026-09-16): a lone motu off the
  // Lagoon sector's coast, on pod 4's outward radial (36°). Its distance is
  // PER-CHARACTER — tutIsletFor() below places it just past the chosen
  // body's bare-lungs swim range, so a swimmer without the snorkel blacks
  // out a few strokes short of its beach, whatever form they wear. The
  // default here is the neutral (form-less) body; gameplay/tutorial.js
  // recomputes it the moment a character is chosen (and purges the region's
  // chunks — see chunks.js, which also never persists nor worker-injects
  // isletZone chunks, so the geometry can stay character-dependent).
  const IA = 36 * D2R;
  const isletZone = (() => {   // superset rect (map units) of every possible seat
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const t of [50, 118]) for (const s of [-12, 12]) {
      const zx = CX + Math.cos(IA) * t - Math.sin(IA) * s;
      const zy = CY + Math.sin(IA) * t + Math.cos(IA) * s;
      x0 = Math.min(x0, zx); x1 = Math.max(x1, zx);
      y0 = Math.min(y0, zy); y1 = Math.max(y1, zy);
    }
    return { x0, y0, x1, y1 };
  })();
  // private-ocean margin: the carve holds FULL deep sea out to D=380 and
  // fades 380..400 (tutW below), so from anywhere a sealed-out sailor can
  // stand (the SEAL_D mist wall) every tile within render range — far-clip
  // 200 game tiles, chunk ring 256 — is featureless carved deep, and from
  // the isle (land + islet, rad ≤ ~115) no natural coast is ever in sight.
  const M = 410;
  // THE SEAL (map units past the coast, so rad = RO + SEAL_D = 280 = 560
  // game tiles): outside a live tutorial, Tutorial.barred() mists this whole
  // disc — no foot, hull or portal crosses it in either direction — and
  // gameplay/world.js partitions the world map by the same disc, so isle
  // chunks and mainland chunks can never share one map view. Chosen so the
  // Swim-Master's islet (seated up to rad ~115 for the fastest bodies) stays
  // ≥ 330 game tiles from any standable water: beyond view, beyond reach.
  const SEAL_D = 226;
  return {
    pods, river, gates, path,
    CX, CY, RC, RM, RO, SPOKES, MIDWALLS, IA, isletZone, SEAL_D,
    islet: null, // seeded below via tutIsletFor(1, 1); re-seated per character
    gx: pods[0].mx * 2, gy: pods[0].my * 2,
    bbox: { x0: CX - RO - M, x1: CX + RO + M, y0: CY - RO - M, y1: CY + RO + M },
  };
})();
// Seat the Swim-Master's islet for a body with the given move-speed and
// height multipliers (character-stats.js playerStats). All in MAP units.
// The swim maths mirror movement.js exactly:
//   · a wading step is 190ms/tile ÷ speedMul × 1.25 still-water drag
//   · AIR is 15 seconds at drain 1 (state.js AIR_MAX) → bare-lungs range
//     = 15000 / 237.5 × speedMul = 63.2 game tiles = 31.6 map units
//   · drowning starts where the water tops the mouth (MOUTH_Y 1.1 × height;
//     depth = (LAND_E − e) / (1 − LAND_E) × 12.5 with LAND_E 0.483), so a
//     taller body wades a little further out before the clock starts
// The islet's shore then sits drainStart + swimRange + 2.5 map units past
// the waterline: every body drowns ~5 tiles short. The snorkel halves the
// drain (potteryglass.js diveDrain 0.5), doubling the range — with it, any
// body crosses with air to spare.
function tutIsletFor(speedMul, heightMul) {
  const T = TUT_ISLE;
  const mouthY = 1.1 * (heightMul || 1);
  const eSub = 0.483 - mouthY / 24.18;          // elevation where the water tops the mouth
  const D = eSub >= 0.445
    ? -1.85 + (0.483 - eSub) / 0.0205           // still in the shore taper
    : (0.44 - eSub) / 0.005;                    // out on the shallows shelf
  const drainStart = Math.max(0, D + 1.85);     // map units past the waterline (D −1.85)
  const swim = 31.58 * (speedMul || 1);
  const shoreR = Math.min(112, (T.RO - 1.85) + drainStart + swim + 2.5);
  const r = shoreR + 2.5;                       // islet centre (land radius 2.5)
  return { x: T.CX + Math.cos(T.IA) * r, y: T.CY + Math.sin(T.IA) * r, r: 2.5 };
}
TUT_ISLE.islet = tutIsletFor(1, 1);
// river-ray coordinates of a MAP point: t = radial distance along the ray
// (map units from the island centre), perp = signed distance off the water
// course (positive = clockwise side). Meaningful when t is in the river's
// extent; consumers gate on that themselves.
function tutRiverCoord(x, y) {
  const T = TUT_ISLE, Rv = T.river;
  const dx = x - T.CX, dy = y - T.CY;
  return { t: dx * Rv.ux + dy * Rv.uy, perp: -dx * Rv.uy + dy * Rv.ux };
}
// Signed-distance sample of the ringed isle at MAP point (x,y), or null when
// outside the bounding box (hot-path early-out — elevation() calls this for
// every tile). Return contract unchanged from the old chain isle:
//   d — distance to the journey path · s — chain position (gate i at i+0.5) ·
//   D — signed distance to the coast (<0 land) · i — the pod whose ZONE the
//   point sits in (per-pod climate) · ox/oy — seaward normal ·
//   pRiver 0(source)…1(mouth) · riverLine — distance to the water course.
function tutIsleSD(x, y) {
  const T = TUT_ISLE, B = T.bbox;
  if (x < B.x0 || x > B.x1 || y < B.y0 || y > B.y1) return null;
  const dx = x - T.CX, dy = y - T.CY;
  const rad = Math.hypot(dx, dy);
  const D = rad - T.RO;
  // journey-path scan (d + s)
  const P = T.path;
  let bd2 = Infinity, bs = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const ax = P[i].x, ay = P[i].y;
    const vx = P[i + 1].x - ax, vy = P[i + 1].y - ay;
    let t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ddx = x - ax - vx * t, ddy = y - ay - vy * t;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bd2) { bd2 = d2; bs = P[i].s + (P[i + 1].s - P[i].s) * t; }
  }
  // zone containment → pod index for climate/relief
  const ang = Math.atan2(dy, dx) / (Math.PI / 180); // -180..180, -90 = north
  let zi = 6;
  if (rad > T.RC) {
    const table = rad <= T.RM
      ? { 1: -90, 5: 0, 7: 90, 11: 180 }
      : { 0: -72, 2: -36, 3: 0, 4: 36, 8: 72, 9: 108, 10: 144, 12: 180, 13: -144, 14: -108 };
    let best = 1e9;
    for (const k in table) {
      const ad = Math.abs(((ang - table[k] + 540) % 360) - 180);
      if (ad < best) { best = ad; zi = +k; }
    }
  }
  const ox = rad > 0.001 ? dx / rad : 0, oy = rad > 0.001 ? dy / rad : 1;
  // radial river coords (inline for speed on the hot path)
  const Rv = T.river;
  const rt = dx * Rv.ux + dy * Rv.uy, rp = -dx * Rv.uy + dy * Rv.ux;
  const inExt = rt >= Rv.rSrc - 0.5 && rt <= Rv.rMouth + 0.5;
  const pRiver = inExt ? (Math.max(Rv.rSrc, Math.min(Rv.rMouth, rt)) - Rv.rSrc) / (Rv.rMouth - Rv.rSrc) : -1;
  const riverLine = inExt ? Math.abs(rp) : 1e9;
  return { d: Math.sqrt(bd2), s: bs, D, i: zi, ox, oy, pRiver, riverLine };
}
// ---- fence & gate geometry (consumed by chunks.js painting + tutorial.js) ----
// SINGLE-FILE fences (user req): each ring/spoke/wall/weir is walked
// parametrically and rounded to GAME tiles — one post per step, never
// side-by-side doubles. An 8-connected 1-wide line is watertight here:
// pathing.js findPath and movement.js both forbid diagonal corner-cutting,
// so no one slips between two diagonally-adjacent posts. Built lazily once
// (the geometry is seed-independent and static).
let _tutFenceMap = null; // "gx,gy" -> {kind, gate}
function _tutFenceBuild() {
  const T = TUT_ISLE, Rv = T.river;
  const M = new Map();
  const put = (gx, gy, kind, gate) => {
    const k = gx + "," + gy;
    const cur = M.get(k);
    if (!cur || (cur.gate === -1 && gate !== -1)) M.set(k, { kind, gate });
  };
  // classification at a MAP point: null = gap (river water), else gate flag.
  // Only the CHAMBER WALLS gap over the water — the -45° wall's gap is the
  // sanctioned river entry from the Bush chamber. The rings now run BANK TO
  // BANK across the course (user req 2026-09-16): the middle ring carries
  // journey gate 1 mid-channel (the river gate), and the centre wall stands
  // solid (the spring rises just outside it, so no water ever reaches it).
  const classify = (mx, my, kind) => {
    if (kind === "wall") {
      const rc = tutRiverCoord(mx, my);
      if (Math.abs(rc.perp) < Rv.waterR + 1.4 && rc.t > Rv.rSrc - 2) return null;
    }
    for (const g of T.gates)
      if (Math.hypot(mx - g.x, my - g.y) < 1.6) return { gate: g.i };
    return { gate: -1 };
  };
  const walk = (fn, t0, t1, dt, kind) => {
    let px = null, py = null;
    for (let t = t0; t <= t1 + 1e-9; t += dt) {
      const [mx, my] = fn(Math.min(t, t1));
      const gx = Math.round(mx * 2), gy = Math.round(my * 2);
      if (gx === px && gy === py) continue;
      const c = classify(mx, my, kind);
      if (c) put(gx, gy, kind, c.gate);
      px = gx; py = gy;
    }
  };
  const D2R = Math.PI / 180;
  // the two ring fences (centre wall + middle ring)
  for (const rr of [T.RC, T.RM])
    walk(a => [T.CX + Math.cos(a) * rr, T.CY + Math.sin(a) * rr],
      0, Math.PI * 2, 0.1 / rr, "ring");
  // outer-sector spokes — out past the waterline (D −1.85) into the surf to
  // RO+7, where the water is over anyone's head: no more knee-deep wading
  // around a spoke's last post to skip a gate
  for (const a of T.SPOKES) {
    // NO fence between the Landing and the Harbour (user req 2026-09-16):
    // pods 0 and 14 share one open plains shore — the village spans both
    if (a === -90) continue;
    const ux = Math.cos(a * D2R), uy = Math.sin(a * D2R);
    walk(t => [T.CX + ux * t, T.CY + uy * t], T.RM + 0.6, T.RO + 7, 0.12, "spoke");
  }
  // middle-chamber walls ("wall": these alone gap over the river — the -45°
  // wall's gap is where the Bushman's graduate steps down to the water)
  for (const a of T.MIDWALLS) {
    const ux = Math.cos(a * D2R), uy = Math.sin(a * D2R);
    walk(t => [T.CX + ux * t, T.CY + uy * t], T.RC + 0.6, T.RM - 0.6, 0.12, "wall");
  }
  // river-bank fences: the upstream reach runs THROUGH the Bank chamber, so
  // its corridor is fenced along both banks (perp ±waterR+1.2) — a swimmer
  // waiting on the river gate can't climb out into the pod-6 camp early.
  // The east line runs the full reach (tucked under the centre-wall ring at
  // its head); the west line only below the -45° wall's crossing (upstream
  // of that the wall itself is the boundary, and its water gap the way in).
  for (const [side, t0] of [[Rv.waterR + 1.2, 15.0], [-(Rv.waterR + 1.2), 24.6]])
    walk(t => [T.CX + Rv.ux * t - Rv.uy * side, T.CY + Rv.uy * t + Rv.ux * side],
      t0, T.RM + 0.6, 0.12, "bank");
  return M;
}
// What stands at MAP point (x,y)? null, or {kind, gate}: kind
// "ring"|"spoke"|"wall"|"bank"; gate >= 0 = journey-gate arch (gate index),
// -1 = plain fence post. (The weir arcs and their swim-latch gates are gone
// — 2026-09-16, no fences downstream of the river gate.)
function tutFenceAt(x, y) {
  if (!_tutFenceMap) _tutFenceMap = _tutFenceBuild();
  return _tutFenceMap.get(Math.round(x * 2) + "," + Math.round(y * 2)) || null;
}
// journey-gate arch at MAP point? → gate index or -1 (tutorial.js barred())
function tutGateArchAt(x, y) {
  for (const g of TUT_ISLE.gates)
    if (Math.hypot(x - g.x, y - g.y) < 1.6) return g.i;
  return -1;
}
// inside the island's influence footprint? (features.js exclusions) — the
// whole private-ocean disc, so no village/POI/portal/icon/road seeds in it
function tutIsleAtMap(x, y) {
  const q = tutIsleSD(x, y);
  return !!q && q.D < 400;
}
// inside the SEALED disc? GAME-TILE coords (player.x/y). The seal is the
// "separate map" boundary: Tutorial.barred() mists it against feet, hulls
// and portals in BOTH directions, and gameplay/world.js partitions the
// world-map fog by it — a chunk inside the seal belongs to the isle's own
// map and never renders on the wide world's, nor the reverse.
function inTutSeal(gx, gy) {
  if (typeof tutIsleSD !== "function") return false;
  const q = tutIsleSD(gx / 2, gy / 2);
  return !!q && q.D < TUT_ISLE.SEAL_D;
}
// isle land + a little surrounding water (D<60 matches chunks.js's spawn-
// strip band, wide enough to also cover the Swim-Master's islet). Used to
// keep the isle's own creatures calm regardless of tutorial state (user req:
// EVERY animal on Tūhura Isle is non-aggressive, permanently, not just
// during the tutorial) — gameplay/monsters.js's aggro gate and render3d.js's
// name-label colour both read this. Takes GAME-TILE coords (player.x/y,
// monster m.x/y), not map units.
function onTutIsle(gx, gy) {
  if (typeof tutIsleSD !== "function") return false;
  const q = tutIsleSD(gx / 2, gy / 2);
  return !!q && q.D < 60;
}

// ---------- The Dream Forest interior: many doors, one forest ----------
// Every Dream Forest patch in the wide world is a DOOR into the same hidden
// interior (gameplay/dream.js): a column of six forest discs — five "depth
// levels" and the Heart — carved far off in the tutorial isle's world block
// (already named at boot, so no world-naming freeze on entry; same longitude
// for every level, so the sun never jumps between them). Players are moved
// between the discs by SILENT relocations that only ever fire at a waystone
// glade — an identical stamped clearing (chunks.js) present at every door and
// level — so the screen shows the same pixels before and after every swap:
// all of the magic happens off-screen. Level discs are ringed by impassable
// bramble (Dream.barred), and the walk between a level's IN and OUT glades
// grows by ~110 game tiles per level, so the forest is quadratically bigger
// inside than its little door patch could ever hold.
// All values here in MAP units (= game tiles / 2).
var DREAM_WORLD = (() => {
  const CX = -3800;                     // column x — block (-1,0), far from the isle
  const Y0 = 2300, DY = 500;            // level-0 centre y, centre-to-centre spacing
  const D2R = Math.PI / 180;
  // per-level secret bearing IN → OUT (degrees); nothing on screen encodes it —
  // only the waystone's moss whisper (dream.js) names the true direction
  const PSI = [61, 198, 335, 112, 249];
  const LVL = [];
  for (let i = 0; i < 5; i++) {
    const D = 55 * (i + 1);             // IN↔OUT separation (map units)
    const cx = CX, cy = Y0 + DY * i;
    const ux = Math.cos(PSI[i] * D2R), uy = Math.sin(PSI[i] * D2R);
    LVL.push({
      cx, cy, R: D / 2 + 65, psi: PSI[i],
      IN:  { x: cx - ux * D / 2, y: cy - uy * D / 2 },
      OUT: { x: cx + ux * D / 2, y: cy + uy * D / 2 },
    });
  }
  // the Heart: the reward glade-village at the bottom of the dream
  const HEART = { cx: CX, cy: Y0 + DY * 5, R: 75, IN: { x: CX, y: Y0 + DY * 5 - 48 } };
  // region rect: every disc + blend margin. Kept well inside block (-1,0).
  const RECT = { x0: CX - 260, x1: CX + 260, y0: Y0 - 260, y1: HEART.cy + 260 };
  const GLADE_R = 26;                   // identical-stamp radius (map units; 52 game)
  return { CX, Y0, DY, LVL, HEART, RECT, GLADE_R };
})();
// signed sample of the interior at MAP (x,y): null outside the region rect
// (hot-path early-out — every terrain field calls this per tile), else
// { lvl (0-4, 5 = Heart), cx, cy, R, r (distance to the level centre), w
// (override weight, fading to natural terrain over the rect's outer 20) }.
function dreamSD(x, y) {
  const R = DREAM_WORLD.RECT;
  if (x < R.x0 || x > R.x1 || y < R.y0 || y > R.y1) return null;
  const idx = Math.max(0, Math.min(5, Math.round((y - DREAM_WORLD.Y0) / DREAM_WORLD.DY)));
  const L = idx === 5 ? DREAM_WORLD.HEART : DREAM_WORLD.LVL[idx];
  const edge = Math.min(x - R.x0, R.x1 - x, y - R.y0, R.y1 - y);
  return {
    lvl: idx, cx: L.cx, cy: L.cy, R: L.R,
    r: Math.hypot(x - L.cx, y - L.cy),
    w: Math.min(1, edge / 20),
  };
}
// inside the interior's influence? (features.js exclusions + road costing +
// gameplay/world.js seenBounds — the region never seeds villages/POIs/portals
// and never counts toward the explored world-map view)
function dreamZoneAtMap(x, y) {
  const R = DREAM_WORLD.RECT;
  return x >= R.x0 - 10 && x <= R.x1 + 10 && y >= R.y0 - 10 && y <= R.y1 + 10;
}

// Callers (1):
//  world.js:22
function createWorldTerrain() {
  const S = WORLD_SEED;
  // ---------- noise (exact port) ----------
  function hash2i(x, y, s) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const rand2 = (x, y, s) => hash2i(x, y, s) / 4294967296;
  function valueNoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rand2(xi, yi, s), b = rand2(xi + 1, yi, s);
    const c = rand2(xi, yi + 1, s), d = rand2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const ROT_C = Math.cos(0.6), ROT_S = Math.sin(0.6);
  function fbm(x, y, s, octaves) {
    let total = 0, amp = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      total += valueNoise(x, y, s + i * 101) * amp;
      max += amp;
      amp *= 0.5;
      const nx = (x * ROT_C - y * ROT_S) * 2;
      const ny = (x * ROT_S + y * ROT_C) * 2;
      x = nx; y = ny;
    }
    return total / max;
  }

  // ---------- terrain generation ----------
  function originBlend(x, y, v, target) {
    const d2 = x * x + y * y;
    if (d2 >= 40000) return v;
    const d = Math.sqrt(d2) / 200;
    const inner = Math.max(0, Math.min(1, (0.65 - d) / 0.3));
    const noisy = (1 - d) * (0.4 + fbm(x * 0.025, y * 0.025, S + 701, 2) * 1.1);
    const w = Math.min(1, Math.max(inner, noisy)) * 0.95;
    return v + (target - v) * w;
  }

  // ---------- Tūhura Isle overrides (TUT_ISLE + tutIsleSD, top of file) ----
  // Override weight from a tube sample: 1 across the isle AND its whole
  // private ocean (out to D=380), fading to natural terrain across 380..400.
  // (bands widened 120/130 → 380/400 with the 2026-09-18 relocation: the
  // moat must now outrun RENDER RANGE from the SEAL_D mist wall, not just
  // swim range from the shore — a sealed-out sailor pressed against the
  // mist at D=226 sees carved deep sea to the horizon in every direction,
  // and the fade seam to natural terrain lands beyond their farthest view)
  const tutW = q => q.D <= 380 ? 1 : (400 - q.D) / 20;
  const tutMix = (q, v, target) => v + (target - v) * tutW(q);
  // Target elevation from the tube: grassy plateau (soft noise) with per-pod
  // relief (knolls, pools), a beach taper to the coast, then shallows sloping
  // to deep sea — a guaranteed moat whatever nature put here.
  function tutElev(x, y, q) {
    // the Swim-Master's ISLET (TUT_ISLE.islet, per-character seat): a steep
    // little dome rising out of the deep — grass crown, one ring of beach,
    // and water over anyone's head within ~1.5 map units of its shore, so
    // the drowning clock runs right up to the sand.
    const I = TUT_ISLE.islet;
    if (I && q.D > 3) {
      const pd = Math.hypot(x - I.x, y - I.y);
      if (pd < 4.5) {
        const sea = q.D >= 9 ? Math.max(0.335, 0.40 - (q.D - 9) * 0.0009)
                             : 0.44 - q.D / 9 * 0.045;
        return Math.max(sea, 0.535 - 0.00832 * pd * pd);
      }
    }
    // deep ring, sloping ever deeper with distance — the isle's private
    // ocean has no far shore, just water darkening to the horizon
    if (q.D >= 9) return Math.max(0.335, 0.40 - (q.D - 9) * 0.0009);
    if (q.D >= 0) return 0.44 - q.D / 9 * 0.045;     // shallows sloping away
    let e = 0.527 + (fbm(x * 0.09, y * 0.09, S + 881, 2) - 0.5) * 0.02;
    // shore taper → a sand ring at the coast, reaching plateau by D=-4 so even
    // the river's banks stay solidly dry and walkable up to the source
    if (q.D > -4) e -= (q.D + 4) / 4 * 0.082;         // 0.527 at D=-4 → ~0.445 at D=0
    const p = TUT_ISLE.pods[q.i];
    if (p.bump) {
      const bd = Math.hypot(x - p.mx, y - p.my);
      e += Math.max(0, 1 - bd / p.bump.r) * p.bump.h;
    }
    if (p.pool) {
      const pd = Math.hypot(x - p.mx - p.pool.dx, y - p.my - p.pool.dy);
      e -= Math.max(0, 1 - pd / p.pool.r) * p.pool.d;
    }
    // a straight E–W water CHANNEL spanning the pod (the isle continues along
    // both banks): flat-bottomed within halfW, feathering over the last unit —
    // deep enough to drown, so a bankside archer must SHOOT across it.
    if (p.channel) {
      const cd = Math.abs(y - p.my - p.channel.dy);
      if (cd < p.channel.halfW)
        e -= Math.max(0, Math.min(1, p.channel.halfW - cd)) * p.channel.d;
    }
    // THE RIVER: carve the water course down the valley — shallow + wadeable
    // (so riding the current never drowns), a touch deeper toward the mouth.
    // Only within the source→mouth extent; feathers over the last tile.
    if (q.pRiver >= 0 && q.riverLine < TUT_ISLE.river.waterR + 1) {
      const floor = 0.467 - q.pRiver * 0.02;   // 0.467 at the spring → 0.447 at the mouth
      const w = Math.max(0, Math.min(1, TUT_ISLE.river.waterR + 1 - q.riverLine));
      e = e + (floor - e) * w;
    }
    // TERRACED FORD (Phase 7 item 8): the feather above drops ~4 stepClimbOK
    // tiers (STEP_H=0.5 world units each) across just ~2 game tiles —
    // steeper than the ONE-tier-per-step climb the player (and the
    // pathfinder) allow, so on foot the only legal crossing was the bridge.
    // The journey path fords the water once, on the pod-2→gate-2 leg (the
    // Fisher's camp to the next journey gate — TUT_ISLE.path's s:2→s:2.5
    // segment; its straight chord crosses the river ray a shade short of
    // rCross). The ford's own LINE (through pod 2 and gate 2, extended both
    // ways — not the general path, which also runs alongside the river
    // elsewhere without fording it, e.g. the river-ride reach near the
    // source, and would wrongly pull those banks down too) gives a local
    // "across the ford" axis: fT is position along it (in fractions of the
    // pod-to-gate span, unclamped so it keeps growing past both ends) and
    // fPerp the perpendicular offset. fT0 solves analytically for where the
    // axis crosses the river (perp-to-river == 0), so bankDist below —
    // along-axis distance from the wading line — stays a sane "distance
    // from the water" measure all the way out to the dry banks, including
    // right at pod 2 itself (only ~4.7 map units from the crossing), unlike
    // q.riverLine (measured from the infinite RIVER line) which diverges
    // from the true crossing fast off the path. fPerp is gated generously
    // (8 map units — wider than the ford ever visibly needs) because
    // Math.min against the natural terrain is what actually bounds the
    // effect: past the point the staircase would climb above the plateau,
    // min() just keeps picking the plateau, so a loose fPerp gate costs
    // nothing — whereas a TIGHT one cuts the staircase off mid-climb
    // wherever the path's approach to pod 2 (a different angle, and a
    // different distance-from-water schedule, than a straight crossing)
    // happens to graze it, reopening the very cliff this is fixing.
    // Outside fPerp's reach the feather above stands untouched (a
    // deliberate crossing, not a general riverbank fix).
    if (q.pRiver >= 0 && q.riverLine > TUT_ISLE.river.waterR) {
      const fA = TUT_ISLE.pods[2], fB = TUT_ISLE.gates[2];
      const fvx = fB.x - fA.mx, fvy = fB.y - fA.my, fL = Math.hypot(fvx, fvy);
      const fdx = x - fA.mx, fdy = y - fA.my;
      const fT = (fdx * fvx + fdy * fvy) / (fL * fL);
      const fPerp = Math.abs(fdx * fvy - fdy * fvx) / fL;
      if (fPerp <= 8.0) {
        // the line's own perp-to-river at each end (opposite signs — one
        // end sits on each bank) pin the water crossing at fT0 by lerp
        const perpAt = (px, py) => -(px - TUT_ISLE.CX) * TUT_ISLE.river.uy + (py - TUT_ISLE.CY) * TUT_ISLE.river.ux;
        const pA = perpAt(fA.mx, fA.my), pB = perpAt(fB.x, fB.y);
        const fT0 = pA / (pA - pB);
        const bankDist = Math.abs(fT - fT0) * fL;   // map units from the ford's wading line
        const floor = 0.467 - q.pRiver * 0.02;
        const TIER_E = 0.02 * (1 - LAND_E);   // one stepClimbOK-legal render tier, raw elevation
        const GAME_TILE = 0.5;                // map units per game tile
        const step = Math.floor(Math.max(0, bankDist - TUT_ISLE.river.waterR) / GAME_TILE) + 1;
        e = Math.min(e, floor + step * TIER_E);
      }
    }
    return e;
  }

  // Ridge noise produces sharp mountain chains (SimpleHydrology-inspired)
  function ridgeNoise(x, y, s, octaves) {
    let total = 0, amp = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      total += (1 - Math.abs(valueNoise(x, y, s + i * 101) * 2 - 1)) * amp;
      max += amp; amp *= 0.5;
      const nx = (x * ROT_C - y * ROT_S) * 2;
      const ny = (x * ROT_S + y * ROT_C) * 2;
      x = nx; y = ny;
    }
    return total / max;
  }

  // Elevation: domain-warped FBM continents + ridge mountain chains (Azgaar-inspired)
  function elevation(x, y) {
    const wx = x + (fbm(x * 0.008, y * 0.008, S + 201, 2) - 0.5) * 90;
    const wy = y + (fbm(x * 0.008, y * 0.008, S + 211, 2) - 0.5) * 90;
    const cont   = fbm(wx * 0.0028, wy * 0.0028, S, 4);
    const detail = fbm(x  * 0.02,   y  * 0.02,   S + 7, 4);
    const ridge  = ridgeNoise(wx * 0.006, wy * 0.006, S + 400, 4);
    let e = cont * 0.72 + detail * 0.28;
    e += ridge * Math.max(0, cont - 0.50) * 0.40;    // ridges on high terrain
    const isl = fbm(wx * 0.016, wy * 0.016, S + 301, 3);
    if (isl > 0.60) e += (isl - 0.60) * 0.55;
    const v = originBlend(x, y, Math.max(0, Math.min(1, e)), 0.565);
    const q = tutIsleSD(x, y);
    if (q && q.D < 400) return tutMix(q, v, tutElev(x, y, q));
    // Dream Forest interior (DREAM_WORLD, top of file): gentle dry rolls —
    // never a beach (>0.497), never highlands (<0.615), so the whole region
    // classifies B.DREAM and no water ever cuts a level disc
    const dq = dreamSD(x, y);
    if (dq) return v + (0.525 + (fbm(x * 0.05, y * 0.05, S + 911, 2) - 0.5) * 0.035 - v) * dq.w;
    return v;
  }

  // Latitude: triangle wave maps Y → 0 (equatorial/warm) to 1 (polar/cold),
  // with the same equator (y = k·LAT_PERIOD) and pole (half-period) positions
  // the old |sin| curve had. The triangle is UNIFORM in y — |sin| lingered
  // near 1, which made ~60% of all land polar.
  const LAT_PERIOD = 7500; // map-coordinate units per equator-to-pole cycle (15000 game tiles)
  function latitudeAt(y) {
    const t = ((y / LAT_PERIOD) % 1 + 1) % 1; // 0..1 within one period
    return 1 - Math.abs(2 * t - 1);           // 0 at equator, 1 at the pole
  }

  // Temperature: latitude bands + altitude lapse rate. warmCurve squeezes the
  // cold end of the latitude range so the polar belt is only the quarter of
  // the world nearest each pole — warm:polar LAND lands at ~3:1 once the
  // altitude lapse is accounted for (tuned by offline measurement: knee at
  // lat 0.75 → 0.44, steep polar tail beyond).
  function warmCurve(lat) {
    return lat < 0.75 ? lat * (0.44 / 0.75) : 0.44 + (lat - 0.75) * (0.56 / 0.25);
  }
  function temperature(x, y) {
    const lat  = latitudeAt(y);
    const e    = elevation(x, y);
    const latT = 1 - warmCurve(lat);
    const altC = Math.max(0, (e - LAND_E) / (1 - LAND_E)) * 0.55;
    const noise = fbm(x * 0.003, y * 0.003, S + 57, 2) * 0.18 - 0.09;
    const v = originBlend(x, y, Math.max(0, Math.min(1, latT - altC + noise)), 0.52);
    // Tūhura Isle: forced climate whatever the latitude says — per-POD now
    // (each zone's unique biome needs its own temperature band)
    const q = tutIsleSD(x, y);
    if (q && q.D < 400) return tutMix(q, v, TUT_ISLE.pods[q.i].tmp || 0.52);
    const dq = dreamSD(x, y);          // Dream interior: the temperate DREAM band
    if (dq) return v + (0.50 - v) * dq.w;
    return v;
  }

  // Humidity: latitude bands + valley drainage + basin flow (SimpleHydrology-inspired)
  function humidity(x, y) {
    const e   = elevation(x, y);
    const lat = latitudeAt(y);
    // ITCZ pattern: wet equatorial, drying toward the poles (this curve alone
    // has no subtropical dry dip — local dryness comes from `noise` below)
    const latHum = Math.cos(lat * Math.PI * 0.5) * 0.55
                 + Math.pow(Math.sin(lat * Math.PI), 2) * 0.18;
    // Local valley concavity: tiles lower than immediate neighbours drain inward → wetter
    const STEP = 5;
    const eAvg = (elevation(x + STEP, y) + elevation(x - STEP, y) +
                  elevation(x, y + STEP) + elevation(x, y - STEP)) * 0.25;
    const concavity = Math.max(0, eAvg - e) * 3;
    // Regional basin drainage proxy: smooth large-scale field approximating discharge
    // accumulation from SimpleHydrology — river-basin lows collect catchment moisture.
    const basinFlow = Math.max(0, 0.5 - fbm(x * 0.0018, y * 0.0018, S + 333, 2)) * 0.32 * (1 - e);
    // Coastal lowlands: humid sea air near water edges
    const coastHum = (e >= LAND_E && e < LAND_E + 0.06)
      ? (1 - (e - LAND_E) / 0.06) * 0.08 : 0;
    // Rain shadow: high terrain intercepts moisture
    const altDry = Math.max(0, (e - 0.57) * 2.8);
    // `noise` was one-sided (`fbm*0.28`, always >=0) — a spot could only ever
    // be WETTER than its latitude/altitude baseline, never drier. That made
    // Badlands/Canyon/Steppe/Red Desert (all warm-and-dry) mathematically
    // unreachable: everywhere warm enough for them already sits at a baseline
    // humidity too high, and altDry (rain-shadow) alone is too weak to close
    // the gap. Kept the original term (`noiseBase`, preserves its upward bias
    // so existing wet biomes don't just get starved) and added a genuine
    // SIGNED variance term (`noiseVar`, different frequency+seed so it isn't
    // just a rescale of the same field) so a spot can swing locally drier too
    // — deserts and rainforest can now coexist at the same latitude, like
    // real regional climate variation, instead of humidity being a pure
    // function of latitude.
    const noiseBase = fbm(x * 0.0045, y * 0.0045, S + 31, 3) * 0.28;
    const noiseVar  = (fbm(x * 0.006, y * 0.006, S + 191, 2) - 0.5) * 1.6;
    const noise = noiseBase + noiseVar;
    const v = originBlend(x, y,
      Math.max(0, Math.min(1, latHum + concavity * 0.25 + basinFlow + coastHum + noise - altDry)), 0.45);
    // Tūhura Isle: humidity per zone pod — the Bush pod runs FOREST-wet, the
    // Farm Vale pod dry enough for FARM fields, the rest grass/meadow. Gentle
    // noise keeps the biome seams at the gates organic.
    const q = tutIsleSD(x, y);
    if (q && q.D < 400) {
      const wob = (fbm(x * 0.07, y * 0.07, S + 883, 2) - 0.5) * 0.08;
      return tutMix(q, v, (TUT_ISLE.pods[q.i].hum || 0.50) + wob);
    }
    const dq = dreamSD(x, y);          // Dream interior: forest-wet
    if (dq) return v + (0.64 - v) * dq.w;
    return v;
  }

  const civField = (x, y) => {
    const v = originBlend(x, y, fbm(x * 0.0012, y * 0.0012, S + 601, 2), 0.72);
    const q = tutIsleSD(x, y);
    if (q && q.D < 400) return tutMix(q, v, TUT_ISLE.pods[q.i].civ || 0.35);
    const dq = dreamSD(x, y);
    if (dq) return v + (0.30 - v) * dq.w;
    return v;
  };
  const weirdField = (x, y) => {
    const v = originBlend(x, y, fbm(x * 0.002, y * 0.002, S + 901, 2), 0.5);
    const q = tutIsleSD(x, y);
    // no fantasy biomes on the isle — but the Portal Crown runs LOW weird
    // (wrd 0.18 → the Ruins biome) for its ancient-stones look
    const p = q && q.D < 400 ? TUT_ISLE.pods[q.i] : null;
    if (p) return tutMix(q, v, p.wrd != null ? p.wrd : 0.45);
    const dq = dreamSD(x, y);          // Dream interior: deep in the weird band
    if (dq) return v + (0.90 - v) * dq.w;
    return v;
  };
  const farmField = (x, y) => {
    const v = fbm(x * 0.025, y * 0.025, S + 501, 3);
    const q = tutIsleSD(x, y);
    if (q && q.D < 400) return tutMix(q, v, TUT_ISLE.pods[q.i].farm || 0.35);
    const dq = dreamSD(x, y);
    if (dq) return v + (0.30 - v) * dq.w;
    return v;
  };

  // Biome classifier: Whittaker latitude × altitude × humidity matrix
  function classify(e, hum, temp, f, c, w) {
    // Water
    if (e < 0.40)   return B.DEEP;
    if (e < LAND_E) return (temp > 0.68 && e > 0.44 && w > 0.62) ? B.REEF : B.WATER;
    // Beach
    if (e < 0.497)  return B.SAND;
    // Extreme high terrain
    if (e > ROCK_E) {
      if (w > 0.74)    return B.VOLCANO;
      if (temp < 0.22) return B.GLACIER;
      if (temp < 0.42) return B.SNOW;
      return B.ROCK;
    }
    // Upper highlands
    if (e > 0.615) {
      if (temp < 0.22) return B.GLACIER;
      if (temp < 0.38) return B.SNOW;
      if (hum  < 0.32 && temp > 0.55) return B.CANYON;
      if (hum  > 0.58 && temp < 0.52) return B.MOOR;
      if (e    > 0.64) return B.ROCKY;
    }
    // Fantasy biomes (weirdField-driven)
    if (w > 0.76) {
      if (hum  > 0.53) return temp > 0.55 ? B.MUSHROOM : temp < 0.42 ? B.ASH : B.DREAM;
      if (temp > 0.64 && hum < 0.48) return B.SALT;
      if (temp < 0.34) return B.CRYSTAL;
      return temp > 0.55 ? B.BONE : B.LABYRINTH;
    }
    if (w < 0.24) return temp < 0.50 ? B.WILD : B.RUINSB;
    // Cold / boreal (latitude-driven)
    if (temp < 0.24) return e > 0.58 ? B.GLACIER : B.SNOW;
    if (temp < 0.32) return hum > 0.50 ? B.TAIGA : B.TUNDRA;
    if (temp < 0.42) return hum > 0.55 ? B.TAIGA : hum > 0.35 ? B.TUNDRA : B.SNOW;
    // Tropical
    if (temp > 0.65) {
      if (hum < 0.26) return B.REDDESERT;
      if (hum < 0.44) return f > 0.78 ? B.OASIS : B.DESERT;
      if (hum < 0.58) return B.SAVANNA;
      if (hum < 0.70) return f > 0.64 ? B.BAMBOO : B.JUNGLE; // was 0.74 — its parent
        // hum-band shrank once dry tropical spots could peel off into Desert/Red
        // Desert (see humidity() above), so Bamboo needs a bigger farmField share
        // of what's left to keep its own frequency from dropping too
      return B.WETLAND;
    }
    // Temperate
    if (temp > 0.56 && hum < 0.32) return B.BADLANDS;
    if (hum < 0.28) return B.STEPPE;
    if (hum > 0.72) return B.SWAMP;
    if (hum > 0.55) return (f > 0.70 && temp > 0.44) ? B.CHERRY : B.FOREST; // was 0.80, same reason as Bamboo above
    if (f > 0.62 && c > 0.48) return B.FARM;
    if (hum > 0.46) return B.MEADOW;
    return B.GRASS;
  }

  const biomeAtTile = (x, y) => classify(
    elevation(x, y), humidity(x, y), temperature(x, y),
    farmField(x, y), civField(x, y), weirdField(x, y));

  return {
    S, hash2i, rand2, valueNoise, fbm, originBlend, ridgeNoise,
    elevation, latitudeAt, temperature, humidity, civField, weirdField,
    farmField, classify, biomeAtTile,
  };
}

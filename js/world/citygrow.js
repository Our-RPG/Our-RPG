// ===== organic settlement growth (evolving-city bottom-up accretion) =====
"use strict";
// Deterministic re-implementation of the "evolving city generation" idea
// (Tarquiscani's demo — algorithm re-derived from its public description,
// no code reused): a settlement is GROWN room by room. Each step either
// expands an existing building with one more room, or founds a new building
// sharing a wall with one in the same block; when a block is full, a new
// block opens across an alley. Every step re-proves the invariant that every
// building keeps a door-capable wall reaching "the outside", so nothing is
// ever landlocked — alleys, courtyards and row-houses all emerge from the
// accretion order alone.
//
// Everything here is a pure function of the caller-provided integer seed
// (mulberry32) — no Math.random, no clocks — so villageInfo stays a pure
// function of (vcx, vcy, WORLD_SEED).
//
// Coordinates are GAME TILES. Rooms are wall-inclusive rects; two adjacent
// rooms SHARE their 1-tile wall line (roomB.x === roomA.x + roomA.w - 1).
//
// Output (per building, in placement order):
//   { rooms: [{x,y,w,h,s}], door: {x,y,angle}, idoors: [{x,y}],
//     ladder: {x,y}|null, x0, y0, w, h }   // x0..h = bounding box

// Callers (2): features.js villageInfo, labgen.js (shares mulberry32)
function cgMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// tileClass(x, y) -> 0 free-buildable, 1 reserved (walkable, never built on:
// prefab margins, field), 2 solid (water/river: blocks walking AND building),
// 3 artery (walkable reserve that is GUARANTEED connected to the wider world:
// the plaza and the cross roads through the gates — flood-fill seeds)
function growSettlement(opts) {
  const { cx, cy, R, seed, budget, tileClass } = opts;
  const rng = cgMulberry32(seed);
  const ROOM_MIN = opts.roomMin || 5, ROOM_MAX = opts.roomMax || 9;
  const ALLEY = 2;                       // min clear tiles between blocks
  const BLOCK_ROOMS = opts.blockRooms || 9; // rooms before a block is "full"
  const MAX_BLOCKS = opts.maxBlocks || 10;
  const NEWBLD_P = opts.newBldP != null ? opts.newBldP : 0.38;

  // local grid over the town disc
  const ox = cx - R - 3, oy = cy - R - 3, N = 2 * (R + 3) + 1;
  const NN = N * N;
  const inG = (x, y) => x >= ox && y >= oy && x < ox + N && y < oy + N;
  const gi = (x, y) => (y - oy) * N + (x - ox);

  // terrain / reservation classes, sampled once
  const cls = new Uint8Array(NN);
  const edgeCls = opts.walled ? 2 : 1; // walled: the ring band is masonry
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const wx = ox + x, wy = oy + y;
      const dx = wx - cx, dy = wy - cy;
      // square bound — the city wall ring is Chebyshev (|dx|==R), gates on axes
      cls[y * N + x] = (Math.max(Math.abs(dx), Math.abs(dy)) > R - 3) ? edgeCls
        : tileClass(wx, wy);
    }

  const wallG = new Uint8Array(NN);    // any room perimeter here
  const intG  = new Int16Array(NN);    // building id + 1 of room interior
  const blkNear = new Uint16Array(NN); // bitmask: block b within ALLEY tiles

  const buildings = []; // {rooms, block, wallSet:Set<gi>, intSet:Set<gi>}
  const blocks = [];    // {buildings:[], roomCount}

  const markRoom = (b, bi, r) => {
    b.rooms.push(r);
    blocks[b.block].roomCount++;
    const bit = 1 << b.block;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const k = gi(x, y);
        const edge = x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1;
        if (edge) { wallG[k] = 1; b.wallSet.add(k); }
        else { intG[k] = bi + 1; b.intSet.add(k); }
        for (let ny = -ALLEY; ny <= ALLEY; ny++)
          for (let nx = -ALLEY; nx <= ALLEY; nx++) {
            const qx = x + nx - ox, qy = y + ny - oy;
            if (qx >= 0 && qy >= 0 && qx < N && qy < N)
              blkNear[qy * N + qx] |= bit;
          }
      }
    // a room interior "eats" any shared-line tile it fully encloses: never
    // happens by construction (interiors checked empty before placement)
  };

  // ---- placement legality --------------------------------------------------
  // rect tiles: interior must be class-0 and empty; perimeter must be class-0
  // and either empty or an existing wall (shared line). New wall tiles must
  // not press flat against foreign masonry (no 2-thick walls), and the whole
  // rect must keep ALLEY clear tiles to every OTHER block.
  function rectLegal(r, blockId) {
    const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    if (!inG(r.x, r.y) || !inG(x1, y1)) return false;
    const notMyBlock = ~(1 << blockId);
    for (let y = r.y; y <= y1; y++)
      for (let x = r.x; x <= x1; x++) {
        const k = gi(x, y);
        if (cls[k] !== 0) return false;
        if (intG[k]) return false;
        if (blkNear[k] & notMyBlock) return false;
        const edge = x === r.x || x === x1 || y === r.y || y === y1;
        if (!edge && wallG[k]) return false;
        if (edge && !wallG[k]) {
          // brand-new wall tile: the outward 4-neighbours must not already be
          // masonry (else two walls touch without sharing a line)
          if (x === r.x  && inG(x - 1, y) && (wallG[gi(x - 1, y)] || intG[gi(x - 1, y)])) return false;
          if (x === x1   && inG(x + 1, y) && (wallG[gi(x + 1, y)] || intG[gi(x + 1, y)])) return false;
          if (y === r.y  && inG(x, y - 1) && (wallG[gi(x, y - 1)] || intG[gi(x, y - 1)])) return false;
          if (y === y1   && inG(x, y + 1) && (wallG[gi(x, y + 1)] || intG[gi(x, y + 1)])) return false;
        }
      }
    return true;
  }

  // shared-wall score of rect against a set of wall tiles
  function sharedScore(r, wallSet) {
    let n = 0;
    const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    for (let x = r.x; x <= x1; x++) {
      if (wallSet.has(gi(x, r.y))) n++;
      if (wallSet.has(gi(x, y1))) n++;
    }
    for (let y = r.y + 1; y < y1; y++) {
      if (wallSet.has(gi(r.x, y))) n++;
      if (wallSet.has(gi(x1, y))) n++;
    }
    return n;
  }

  // does rect share a DOOR-CAPABLE line with building b? (a shared tile whose
  // two flanking tiles are rect-interior and b-interior)
  function doorableWith(r, b, bi) {
    const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    for (let x = r.x + 1; x < x1; x++) {
      if (b.intSet.has(gi(x, r.y - 1)) && wallG[gi(x, r.y)]) return true;
      if (b.intSet.has(gi(x, y1 + 1)) && wallG[gi(x, y1)]) return true;
    }
    for (let y = r.y + 1; y < y1; y++) {
      if (b.intSet.has(gi(r.x - 1, y)) && wallG[gi(r.x, y)]) return true;
      if (b.intSet.has(gi(x1 + 1, y)) && wallG[gi(x1, y)]) return true;
    }
    return false;
  }

  // ---- the outside & access invariant --------------------------------------
  // BFS over walkable tiles (not wall, not interior, not solid) from the grid
  // border; returns the flooded mask. Buildings must each keep a wall tile
  // with flooded outside on one side and their own interior opposite.
  const floodBuf = new Uint8Array(NN);
  const floodQ = new Int32Array(NN);
  function floodOutside() {
    floodBuf.fill(0);
    let qn = 0;
    const push = k => { if (!floodBuf[k] && cls[k] !== 2 && !wallG[k] && !intG[k]) { floodBuf[k] = 1; floodQ[qn++] = k; } };
    // seeds: every artery tile (plaza / cross roads reach the world through
    // the gates), plus — for unwalled settlements — the open grid border
    for (let k = 0; k < NN; k++) if (cls[k] === 3) push(k);
    for (let x = 0; x < N; x++) { push(x); push((N - 1) * N + x); }
    for (let y = 0; y < N; y++) { push(y * N); push(y * N + N - 1); }
    for (let h = 0; h < qn; h++) {
      const k = floodQ[h], kx = k % N, ky = (k / N) | 0;
      if (kx > 0) push(k - 1);
      if (kx < N - 1) push(k + 1);
      if (ky > 0) push(k - N);
      if (ky < N - 1) push(k + N);
    }
    return floodBuf;
  }
  function doorSpots(b, bi, flood) {
    const out = [];
    for (const k of b.wallSet) {
      const kx = k % N, ky = (k / N) | 0;
      if (ky > 0 && ky < N - 1) {
        if (flood[k - N] && intG[k + N] === bi + 1) out.push({ k, angle: 1 }); // outside to the north
        if (flood[k + N] && intG[k - N] === bi + 1) out.push({ k, angle: 3 });
      }
      if (kx > 0 && kx < N - 1) {
        if (flood[k - 1] && intG[k + 1] === bi + 1) out.push({ k, angle: 0 });
        if (flood[k + 1] && intG[k - 1] === bi + 1) out.push({ k, angle: 2 });
      }
    }
    return out;
  }
  function allAccessible() {
    const flood = floodOutside();
    for (let i = 0; i < buildings.length; i++)
      if (!doorSpots(buildings[i], i, flood).length) return false;
    return true;
  }

  // try to commit a room; roll back if it breaks anyone's outside access
  function tryCommit(bi, r) {
    const b = buildings[bi];
    const savedWall = [], savedInt = [];
    const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    for (let y = r.y; y <= y1; y++)
      for (let x = r.x; x <= x1; x++) {
        const k = gi(x, y);
        const edge = x === r.x || x === x1 || y === r.y || y === y1;
        if (edge) { if (!wallG[k]) { wallG[k] = 1; savedWall.push(k); } }
        else { intG[k] = bi + 1; savedInt.push(k); }
      }
    // temp interiors for access test only — b.intSet updated on success
    const okAccess = (() => {
      const flood = floodOutside();
      for (let i = 0; i < buildings.length; i++) {
        const bb = buildings[i];
        // test with the candidate's tiles folded in for building bi
        if (i === bi) {
          let ok = doorSpots(bb, i, flood).length > 0;
          if (!ok) // the new room's own walls may host the door
            for (const k of savedWall) {
              const kx = k % N, ky = (k / N) | 0;
              if ((ky > 0 && flood[k - N] && intG[k + N] === i + 1) ||
                  (ky < N - 1 && flood[k + N] && intG[k - N] === i + 1) ||
                  (kx > 0 && flood[k - 1] && intG[k + 1] === i + 1) ||
                  (kx < N - 1 && flood[k + 1] && intG[k - 1] === i + 1)) { ok = true; break; }
            }
          if (!ok) return false;
        } else if (!doorSpots(bb, i, flood).length) return false;
      }
      return true;
    })();
    if (!okAccess) {
      for (const k of savedWall) wallG[k] = 0;
      for (const k of savedInt) intG[k] = 0;
      return false;
    }
    for (const k of savedWall) wallG[k] = 0; // markRoom re-writes + records sets
    for (const k of savedInt) intG[k] = 0;
    markRoom(b, bi, r);
    return true;
  }

  // ---- candidate enumeration ------------------------------------------------
  const rSize = () => ROOM_MIN + Math.floor(rng() * (ROOM_MAX - ROOM_MIN + 1));
  // all rects sharing a full wall line with room `a` on each of its 4 sides
  function slideCandidates(a, w, h) {
    const out = [];
    // east & west: candidate column coincides with a's edge column
    for (const [ax] of [[a.x + a.w - 1], [a.x - w + 1]]) {
      for (let y = a.y - h + 3; y <= a.y + a.h - 3; y++)
        out.push({ x: ax, y, w, h });
    }
    for (const [ay] of [[a.y + a.h - 1], [a.y - h + 1]]) {
      for (let x = a.x - w + 3; x <= a.x + a.w - 3; x++)
        out.push({ x, y: ay, w, h });
    }
    return out;
  }

  function bestCandidate(anchorRooms, wallSet, blockId, needDoorable, bldForDoor, bldIdx) {
    const w = rSize(), h = rSize();
    const seen = new Set();
    const cands = [];
    for (const a of anchorRooms)
      for (const r of slideCandidates(a, w, h)) {
        const key = r.x + "," + r.y;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!rectLegal(r, blockId)) continue;
        const sc = sharedScore(r, wallSet);
        if (sc < 3) continue; // must genuinely share a wall run
        if (needDoorable && !doorableWith(r, bldForDoor, bldIdx)) continue;
        cands.push({ r, sc });
      }
    cands.sort((p, q) => q.sc - p.sc || p.r.y - q.r.y || p.r.x - q.r.x);
    return cands;
  }

  // ---- seed + growth loop ----------------------------------------------------
  function newBuilding(blockId) {
    const b = { rooms: [], block: blockId, wallSet: new Set(), intSet: new Set() };
    buildings.push(b);
    blocks[blockId].buildings.push(buildings.length - 1);
    return buildings.length - 1;
  }

  function seedBlockAt(px, py) {
    // walk a spiral around (px,py) for the first legal spot of a fresh room
    const w = rSize(), h = rSize();
    for (let rad = 0; rad <= 10; rad++)
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const r = { x: px + dx - (w >> 1), y: py + dy - (h >> 1), w, h };
          if (!rectLegal(r, blocks.length)) continue;
          blocks.push({ buildings: [], roomCount: 0 });
          const bi = newBuilding(blocks.length - 1);
          if (tryCommit(bi, r)) return bi;
          // rollback bookkeeping: drop the empty building + block
          buildings.pop(); blocks.pop();
        }
    return -1;
  }

  // starter blocks around the plaza (three for a walled city, one for a
  // village), each retried around the dial — rivers can void whole sectors
  let totalRooms = 0;
  const nSeeds = opts.walled ? 4 : 1; // one starter block per city quarter
  const aBase = rng() * Math.PI * 2;
  for (let sI = 0; sI < nSeeds; sI++) {
    for (let att = 0; att < 12; att++) {
      const a0 = aBase + sI * (Math.PI * 2 / nSeeds) + (att ? rng() * 0.9 : 0);
      const seedD = Math.min(R * 0.55, 12 + rng() * 8) + att;
      if (seedBlockAt(Math.round(cx + Math.cos(a0) * seedD),
                      Math.round(cy + Math.sin(a0) * seedD)) >= 0) { totalRooms++; break; }
    }
  }

  let failStreak = 0;
  while (totalRooms < budget && failStreak < 45 && buildings.length) {
    const act = rng();
    let placed = false;
    if (act >= NEWBLD_P) {
      // EXPAND: a random building gains a room (rule: block not full)
      const bi = Math.floor(rng() * buildings.length);
      const b = buildings[bi];
      if (b.rooms.length < (opts.roomCap || 6) &&
          blocks[b.block].roomCount < BLOCK_ROOMS + 3) {
        const cands = bestCandidate(b.rooms, b.wallSet, b.block, true, b, bi);
        for (const c of cands.slice(0, 6))
          if (tryCommit(bi, c.r)) { placed = true; break; }
      }
    } else {
      // NEW BUILDING in a non-full block, sharing a wall with a neighbour…
      const open = blocks.map((bl, i) => i).filter(i => blocks[i].roomCount < BLOCK_ROOMS);
      if (open.length) {
        const blockId = open[Math.floor(rng() * open.length)];
        const host = blocks[blockId].buildings[Math.floor(rng() * blocks[blockId].buildings.length)];
        const hb = buildings[host];
        const wallUnion = new Set();
        for (const i2 of blocks[blockId].buildings)
          for (const k of buildings[i2].wallSet) wallUnion.add(k);
        const cands = bestCandidate(hb.rooms, wallUnion, blockId, false, null, 0);
        for (const c of cands.slice(0, 6)) {
          const bi = newBuilding(blockId);
          if (tryCommit(bi, c.r)) { placed = true; break; }
          buildings.pop(); blocks[blockId].buildings.pop();
        }
      }
      // …or, when everything is full, break ground for a NEW block anywhere
      // on the disc — quadrants the accretion hasn't reached fill in instead
      // of a single lobe crawling outward and leaving half the city bare
      if (!placed && blocks.length < MAX_BLOCKS) {
        const ang = rng() * Math.PI * 2;
        const rr2 = (0.25 + rng() * 0.62) * (R - 6);
        if (seedBlockAt(Math.round(cx + Math.cos(ang) * rr2),
                        Math.round(cy + Math.sin(ang) * rr2)) >= 0) placed = true;
      }
    }
    if (placed) { totalRooms++; failStreak = 0; }
    else failStreak++;
  }

  // ---- doors, interior connectivity, storeys --------------------------------
  const flood = floodOutside();
  const out = [];
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (!b.rooms.length) continue;
    // exterior door: prefer south-facing, then the spot closest to town centre
    const spots = doorSpots(b, bi, flood);
    if (!spots.length) continue; // cannot happen (invariant), but never emit a doorless building
    spots.sort((p, q) => {
      const ps = (p.angle === 3 ? 0 : 1), qs = (q.angle === 3 ? 0 : 1);
      if (ps !== qs) return ps - qs;
      const pd = Math.abs(p.k % N + ox - cx) + Math.abs(((p.k / N) | 0) + oy - cy);
      const qd = Math.abs(q.k % N + ox - cx) + Math.abs(((q.k / N) | 0) + oy - cy);
      return pd - qd || p.k - q.k;
    });
    const dk = spots[0];
    const door = { x: dk.k % N + ox, y: ((dk.k / N) | 0) + oy, angle: dk.angle };

    // interior doors: spanning tree over the room-adjacency graph, rooted at
    // the room behind the exterior door; door tile = middle of the shared run
    const nR = b.rooms.length;
    const roomOf = (x, y) => b.rooms.findIndex(r =>
      x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);
    const rootRoom = Math.max(0, roomOf(
      door.x + (dk.angle === 0 ? 1 : dk.angle === 2 ? -1 : 0),
      door.y + (dk.angle === 1 ? 1 : dk.angle === 3 ? -1 : 0)));
    const idoors = [];
    const linked = new Set([rootRoom]);
    const edges = [];
    for (let i = 0; i < nR; i++)
      for (let j = i + 1; j < nR; j++) {
        const A = b.rooms[i], Br = b.rooms[j];
        const tiles = [];
        if (Br.x === A.x + A.w - 1 || A.x === Br.x + Br.w - 1) {
          const wx = Br.x === A.x + A.w - 1 ? Br.x : A.x;
          const yy0 = Math.max(A.y + 1, Br.y + 1), yy1 = Math.min(A.y + A.h - 2, Br.y + Br.h - 2);
          for (let y = yy0; y <= yy1; y++) tiles.push({ x: wx, y });
        } else if (Br.y === A.y + A.h - 1 || A.y === Br.y + Br.h - 1) {
          const wy = Br.y === A.y + A.h - 1 ? Br.y : A.y;
          const xx0 = Math.max(A.x + 1, Br.x + 1), xx1 = Math.min(A.x + A.w - 2, Br.x + Br.w - 2);
          for (let x = xx0; x <= xx1; x++) tiles.push({ x, y: wy });
        }
        if (tiles.length) edges.push({ i, j, t: tiles[tiles.length >> 1] });
      }
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) {
        const a = linked.has(e.i), c = linked.has(e.j);
        if (a === c) continue;
        linked.add(a ? e.j : e.i);
        idoors.push(e.t);
        grew = true;
      }
    }
    // occasional loop archway in bigger houses (never the sole connection)
    for (const e of edges)
      if (linked.has(e.i) && linked.has(e.j) && !idoors.includes(e.t) &&
          nR >= 4 && rng() < 0.18) idoors.push(e.t);

    // storeys: one count per BUILDING (collision is 2-D; mixed heights inside
    // one house would let an upstairs walk cross into a roofless room), with
    // variety coming from the footprint + between-building differences.
    // Capitals (maxStoreys 4) skew tall — proper city terraces.
    const sRoll = rng();
    const s = opts.maxStoreys >= 4
      ? (sRoll < 0.12 ? 4 : sRoll < 0.36 ? 3 : sRoll < 0.76 ? 2 : 1)
      : opts.maxStoreys >= 3
      ? (sRoll < 0.24 ? 3 : sRoll < 0.68 ? 2 : 1)
      : (opts.maxStoreys >= 2 && sRoll < 0.62 ? 2 : 1);
    for (const r of b.rooms) r.s = s;

    // ladder: an interior tile of the root room, against its north wall, off
    // the exterior-door column and clear of interior archways
    let ladder = null;
    if (s > 1) {
      const rr = b.rooms[rootRoom];
      for (let x = rr.x + 1; x < rr.x + rr.w - 1 && !ladder; x++) {
        const y = rr.y + 1;
        if (x === door.x) continue;
        if (idoors.some(d2 => (d2.x === x || d2.x === x + 1 || d2.x === x - 1) && Math.abs(d2.y - y) <= 1)) continue;
        ladder = { x, y };
      }
      if (!ladder) ladder = { x: rr.x + 1, y: rr.y + 1 };
    }

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of b.rooms) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    out.push({ rooms: b.rooms, door, idoors, ladder,
      x0, y0, w: x1 - x0, h: y1 - y0, block: b.block });
  }

  // ---- upper-storey links between NEIGHBOURING buildings --------------------
  // Where two different buildings share a party wall and both flanking rooms
  // are >= 2 storeys, sometimes cut an archway through the FIRST floor (and
  // the second, for tall pairs): whole terraces connect upstairs. The tile is
  // recorded in BOTH records (each building's geometry carves its own side,
  // and passable() may resolve the tile to either bbox); at ground level it
  // stays a solid wall (idoor.s >= 1 never stamps a gap).
  const sharedRunTiles = (ra, rb) => {
    const tiles = [];
    if (rb.x === ra.x + ra.w - 1 || ra.x === rb.x + rb.w - 1) {
      const wx = rb.x === ra.x + ra.w - 1 ? rb.x : ra.x;
      const y0 = Math.max(ra.y + 1, rb.y + 1), y1 = Math.min(ra.y + ra.h - 2, rb.y + rb.h - 2);
      for (let y = y0; y <= y1; y++) tiles.push({ x: wx, y });
    } else if (rb.y === ra.y + ra.h - 1 || ra.y === rb.y + rb.h - 1) {
      const wy = rb.y === ra.y + ra.h - 1 ? rb.y : ra.y;
      const x0 = Math.max(ra.x + 1, rb.x + 1), x1 = Math.min(ra.x + ra.w - 2, rb.x + rb.w - 2);
      for (let x = x0; x <= x1; x++) tiles.push({ x, y: wy });
    }
    return tiles;
  };
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const A = out[i], B2 = out[j];
      if (A.block !== B2.block) continue;
      if (A.x0 + A.w < B2.x0 || B2.x0 + B2.w < A.x0 ||
          A.y0 + A.h < B2.y0 || B2.y0 + B2.h < A.y0) continue;
      let linked = false;
      for (const ra of A.rooms) {
        if (linked) break;
        if ((ra.s || 1) < 2) continue;
        for (const rb of B2.rooms) {
          if ((rb.s || 1) < 2) continue;
          const tiles = sharedRunTiles(ra, rb);
          if (!tiles.length || rng() >= 0.35) continue;
          const t = tiles[tiles.length >> 1];
          A.idoors.push({ x: t.x, y: t.y, s: 1 });
          B2.idoors.push({ x: t.x, y: t.y, s: 1 });
          if (Math.min(ra.s, rb.s) >= 3 && rng() < 0.5) {
            A.idoors.push({ x: t.x, y: t.y, s: 2 });
            B2.idoors.push({ x: t.x, y: t.y, s: 2 });
          }
          linked = true;
          break;
        }
      }
    }
  return { buildings: out };
}

// ===== labyrinth generation: carved hedge mazes + the Great Labyrinth =====
"use strict";
// Two deterministic maze systems for the LABYRINTH biome:
//
// 1) createLabMaze(hash2i, rand2, S).hedgeWallAt(wx, wy) — the biome-wide
//    hedge field on the existing 4-tile lattice, but CARVED (recursive
//    backtracker per 16x16-cell supercell, lightly braided) instead of the
//    old 30%-random edges: locally a real maze, globally always traversable
//    (every supercell is fully connected internally and opens one hash-agreed
//    gate to each neighbouring supercell).
//
// 2) …greatLabBuilding(mx, my) — the Great Labyrinth POI: one multi-room
//    stone building (kind "greatlab") whose cells form a TRUE 3-D maze: a
//    spanning tree over (cell × floor) nodes. Horizontal tree edges become
//    per-storey interior archways ({x,y,s} — passable() honours the storey),
//    vertical edges become ladders ({x,y,s}). Floors 0 and 1 are severed
//    across the middle row, so the unique entrance→exit path is FORCED over
//    the top floor: in the door, up, across, down, out the far side. Fully
//    connected (no unreachable cell) and solvable by construction.
//
// Everything is a pure function of position + WORLD_SEED (cgMulberry32 from
// citygrow.js; no Math.random, no clocks).

// Callers (3): chunks.js (hedges + greatlab stamp), map.js (hedge mirror),
// features.js/world consumers via the instances those two create
function createLabMaze(hash2i, rand2, S) {
  const SC = 16;                 // maze cells per supercell side (cell = 4 tiles)
  const scCache = new Map();     // "scx,scy" -> {vOpen, hOpen}
  const fdiv = (a, b) => Math.floor(a / b);
  const mod = (a, b) => ((a % b) + b) % b;

  // perfect maze over one supercell's 16x16 cells: iterative backtracker,
  // then ~10% braiding so the hedges read as winding lanes, not pure tree
  function mazeFor(scx, scy) {
    const key = scx + "," + scy;
    let mz = scCache.get(key);
    if (mz) return mz;
    const rng = cgMulberry32(hash2i(scx, scy, S ^ 0xeb7));
    // vOpen[j*SC+i] = the wall between cell (i-1,j) and (i,j) is open (i>=1)
    // hOpen[j*SC+i] = the wall between cell (i,j-1) and (i,j) is open (j>=1)
    const vOpen = new Uint8Array(SC * SC), hOpen = new Uint8Array(SC * SC);
    const seen = new Uint8Array(SC * SC);
    const stack = [Math.floor(rng() * SC * SC)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const ci = cur % SC, cj = (cur / SC) | 0;
      const opts = [];
      if (ci > 0 && !seen[cur - 1]) opts.push(0);
      if (ci < SC - 1 && !seen[cur + 1]) opts.push(1);
      if (cj > 0 && !seen[cur - SC]) opts.push(2);
      if (cj < SC - 1 && !seen[cur + SC]) opts.push(3);
      if (!opts.length) { stack.pop(); continue; }
      const d = opts[Math.floor(rng() * opts.length)];
      let nxt;
      if (d === 0) { nxt = cur - 1; vOpen[cur] = 1; }
      else if (d === 1) { nxt = cur + 1; vOpen[cur + 1] = 1; }
      else if (d === 2) { nxt = cur - SC; hOpen[cur] = 1; }
      else { nxt = cur + SC; hOpen[cur + SC] = 1; }
      seen[nxt] = 1;
      stack.push(nxt);
    }
    for (let j = 0; j < SC; j++)
      for (let i = 1; i < SC; i++) if (!vOpen[j * SC + i] && rng() < 0.10) vOpen[j * SC + i] = 1;
    for (let j = 1; j < SC; j++)
      for (let i = 0; i < SC; i++) if (!hOpen[j * SC + i] && rng() < 0.10) hOpen[j * SC + i] = 1;
    mz = { vOpen, hOpen };
    if (scCache.size > 256) scCache.clear();
    scCache.set(key, mz);
    return mz;
  }

  // is the hedge wall standing on GAME tile (wx, wy)? (4-tile lattice: tiles
  // with wx%4==0 carry the vertical walls, wy%4==0 the horizontal ones;
  // lattice posts — both zero — always stand, so gaps are always full cells)
  function hedgeWallAt(wx, wy) {
    const onX = mod(wx, 4) === 0, onY = mod(wy, 4) === 0;
    if (!onX && !onY) return false;
    if (onX && onY) return true;
    const cx = fdiv(wx, 4), cy = fdiv(wy, 4);
    if (onX) {
      // vertical wall between cells (cx-1,cy) and (cx,cy)
      const scy = fdiv(cy, SC);
      if (mod(cx, SC) === 0) // supercell border: one gate per border segment
        return mod(cy, SC) !== hash2i(cx, scy, S ^ 0xeb8) % SC;
      return !mazeFor(fdiv(cx, SC), scy).vOpen[mod(cy, SC) * SC + mod(cx, SC)];
    }
    const scx = fdiv(cx, SC);
    if (mod(cy, SC) === 0)
      return mod(cx, SC) !== hash2i(scx, cy, S ^ 0xeb9) % SC;
    return !mazeFor(scx, fdiv(cy, SC)).hOpen[mod(cy, SC) * SC + mod(cx, SC)];
  }

  // ---- the Great Labyrinth (POI "greatlab") --------------------------------
  const C = 9;      // cells per side
  const F = 3;      // floors
  const PITCH = 3;  // room pitch: 4x4 wall-inclusive rooms sharing wall lines
  const SIZE = C * PITCH + 1; // 28-tile footprint
  const glCache = new Map();
  // (mx, my) = POI seat in MAP coords; the building record is in game tiles
  function greatLabBuilding(mx, my) {
    const key = mx + "," + my;
    let rec = glCache.get(key);
    if (rec) return rec;
    const gx0 = mx * 2 - (SIZE >> 1), gy0 = my * 2 - (SIZE >> 1);
    const rng = cgMulberry32(hash2i(mx, my, S ^ 0xeba));
    const rooms = [];
    for (let j = 0; j < C; j++)
      for (let i = 0; i < C; i++)
        rooms.push({ x: gx0 + i * PITCH, y: gy0 + j * PITCH, w: PITCH + 1, h: PITCH + 1, s: F });
    // 3-D spanning tree over (i, j, f). Horizontal edges on floors 0 and 1
    // may not cross the middle ROW boundary — the unique path from the south
    // entrance to the north exit must climb to the top floor and back down.
    const N3 = C * C * F;
    const id = (i, j, f) => (f * C + j) * C + i;
    const seen = new Uint8Array(N3);
    const edges = []; // {a:{i,j,f}, d:0 east|1 south|2 up}
    const cutJ = C >> 1; // severed between rows cutJ-1 and cutJ on floors < F-1
    const start = id(C >> 1, C - 1, 0);
    seen[start] = 1;
    const stack = [start];
    const treeH = [], treeV = [];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const ci = cur % C, cj = ((cur / C) | 0) % C, cf = (cur / (C * C)) | 0;
      const opts = [];
      const blockRow = (j1, j2) => cf < F - 1 && Math.min(j1, j2) === cutJ - 1 && Math.max(j1, j2) === cutJ;
      if (ci > 0 && !seen[id(ci - 1, cj, cf)]) opts.push([-1, 0, 0]);
      if (ci < C - 1 && !seen[id(ci + 1, cj, cf)]) opts.push([1, 0, 0]);
      if (cj > 0 && !seen[id(ci, cj - 1, cf)] && !blockRow(cj, cj - 1)) opts.push([0, -1, 0]);
      if (cj < C - 1 && !seen[id(ci, cj + 1, cf)] && !blockRow(cj, cj + 1)) opts.push([0, 1, 0]);
      if (cf > 0 && !seen[id(ci, cj, cf - 1)]) opts.push([0, 0, -1]);
      if (cf < F - 1 && !seen[id(ci, cj, cf + 1)]) opts.push([0, 0, 1]);
      if (!opts.length) { stack.pop(); continue; }
      // mild vertical preference makes the ladder shafts a real feature
      let pick = opts[Math.floor(rng() * opts.length)];
      const vOpts = opts.filter(o => o[2] !== 0);
      if (vOpts.length && rng() < 0.25) pick = vOpts[Math.floor(rng() * vOpts.length)];
      const [di, dj, df] = pick;
      const ni = ci + di, nj = cj + dj, nf = cf + df;
      seen[id(ni, nj, nf)] = 1;
      stack.push(id(ni, nj, nf));
      if (df !== 0) treeV.push({ i: ci, j: cj, f: Math.min(cf, nf) });
      else treeH.push({ i: Math.min(ci, ni), j: Math.min(cj, nj), f: cf, east: di !== 0 });
    }
    // horizontal passages -> per-storey interior archways through shared walls
    const idoors = [];
    for (const e of treeH) {
      if (e.east) {
        const wx = gx0 + (e.i + 1) * PITCH;             // shared wall column
        const wy = gy0 + e.j * PITCH + 1 + Math.floor(rng() * (PITCH - 1));
        idoors.push({ x: wx, y: wy, s: e.f });
      } else {
        const wy = gy0 + (e.j + 1) * PITCH;             // shared wall row
        const wx = gx0 + e.i * PITCH + 1 + Math.floor(rng() * (PITCH - 1));
        idoors.push({ x: wx, y: wy, s: e.f });
      }
    }
    // vertical passages -> one ladder per edge, inside the cell
    const ladders = treeV.map(e => ({
      x: gx0 + e.i * PITCH + 1 + Math.floor(rng() * (PITCH - 1)),
      y: gy0 + e.j * PITCH + 1 + Math.floor(rng() * (PITCH - 1)),
      s: e.f,
    }));
    // entrance (south wall of the start cell) and exit (north wall, top row)
    const door = { x: gx0 + (C >> 1) * PITCH + 1 + (PITCH >> 1), y: gy0 + SIZE - 1, angle: 3 };
    const door2 = { x: gx0 + (C >> 1) * PITCH + 1 + (PITCH >> 1), y: gy0, angle: 1 };
    rec = { x0: gx0, y0: gy0, w: SIZE, h: SIZE, rooms, idoors, door, door2, ladders,
      stone: true, stoneDoor: true, kind: "greatlab", roof: "roof_gray" };
    if (glCache.size > 64) glCache.clear();
    glCache.set(key, rec);
    return rec;
  }

  return { hedgeWallAt, greatLabBuilding, GREATLAB_SIZE: SIZE };
}

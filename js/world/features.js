// ===== world rivers, roads, settlements, POIs, and biome surface helpers =====
"use strict";

// Callers (1):
//  world.js:23
function createWorldFeatures(ctx) {
  const {
    S, hash2i, rand2, valueNoise, fbm, originBlend, ridgeNoise,
    elevation, latitudeAt, temperature, humidity, civField, weirdField,
    farmField, classify, biomeAtTile,
  } = ctx;
  const DEEP_E = 0.40;
  const GRID8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

  function gridRoute(o) {
    const step = o.step;
    const gBest = new Map(), eMap = o.eCache || new Map();
    const elevAt = (key, x, y) => {
      let e = eMap.get(key);
      if (e === undefined) { e = elevation(x, y); eMap.set(key, e); }
      return e;
    };
    const heap = [];
    const less = (a, b) => a.f !== b.f ? a.f < b.f : a.seq < b.seq;
    const push = n => {
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(heap[i], heap[p])) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    };
    let seq = 0;
    const hw = o.hw || 1;
    const hf = o.tx === undefined ? () => 0 :
      (x, y) => Math.hypot(o.tx - x, o.ty - y) * hw;
    for (const [ax, ay] of o.starts) {
      const gx = Math.round(ax / step), gy = Math.round(ay / step);
      const key = gx + "," + gy;
      if (gBest.has(key)) continue;
      gBest.set(key, 0);
      push({ gx, gy, g: 0, f: hf(gx * step, gy * step), parent: null, seq: seq++ });
    }
    let goalN = null, budget = o.maxNodes, pruned = false;
    while (heap.length && budget-- > 0) {
      const n = pop();
      const key = n.gx + "," + n.gy;
      if (n.g > gBest.get(key)) continue;
      const x = n.gx * step, y = n.gy * step;
      if (o.goal(x, y, elevAt(key, x, y))) { goalN = n; break; }
      if (n.g > o.maxDist) { pruned = true; continue; }
      for (let k = 0; k < 8; k++) {
        const gx = n.gx + GRID8[k][0], gy = n.gy + GRID8[k][1];
        const nkey = gx + "," + gy;
        const nx = gx * step, ny = gy * step;
        const c = o.cost(elevAt(nkey, nx, ny), nx, ny);
        if (c === Infinity) continue;
        const g = n.g + step * (k < 4 ? 1 : Math.SQRT2) * c;
        const prev = gBest.get(nkey);
        if (prev !== undefined && prev <= g) continue;
        gBest.set(nkey, g);
        push({ gx, gy, g, f: g + hf(nx, ny), parent: n, seq: seq++ });
      }
    }
    if (!goalN) {
      if (o.flags) {
        o.flags.exhausted = heap.length === 0 && !pruned;
        o.flags.visited = gBest;
      }
      return null;
    }
    const pts = [];
    for (let n = goalN; n; n = n.parent) pts.push([n.gx * step, n.gy * step]);
    return pts.reverse();
  }

  function shapePath(pts, seed, amp, world) {
    for (let it = 0; it < 2; it++) {
      const out = [pts[0]];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
                 [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    const n = pts.length - 1;
    if (n < 2 || !amp) return pts;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(n, i + 1)];
      const tx = pb[0] - pa[0], ty = pb[1] - pa[1];
      const l = Math.hypot(tx, ty) || 1;
      const nz = world ? fbm(pts[i][0] * 0.06, pts[i][1] * 0.06, S + 433, 2)
                       : fbm(i * 0.045, seed, S + 431, 2);
      // plateau envelope (ramp only near the ends): merged roads sharing tiles
      // must jitter identically mid-span regardless of each path's total length
      const off = (nz - 0.5) * 2 * amp * Math.min(1, i / 8, (n - i) / 8);
      out.push([pts[i][0] - ty / l * off, pts[i][1] + tx / l * off]);
    }
    return out;
  }
  function polyBBox(pts, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }

  const RIVCELL = 192, RIV_DIST = 1200, RIV_RANGE = RIV_DIST + 64;
  const riverCache = new Map();

  function waterBody(x, y, e) {
    if (e >= LAND_E) return false;
    let wet = 0;
    if (elevation(x + 6, y) < LAND_E) wet++;
    if (elevation(x - 6, y) < LAND_E) wet++;
    if (elevation(x, y + 6) < LAND_E) wet++;
    if (elevation(x, y - 6) < LAND_E) wet++;
    return wet >= 2;
  }

  function riverTrace(rcx, rcy) {
    const key = rcx + "," + rcy;
    if (riverCache.has(key)) return riverCache.get(key);
    let out = null;
    let sx = -1, sy = -1;
    for (let a = 0; a < 10; a++) {
      const px = rcx * RIVCELL + Math.floor(rand2(rcx * 11 + a, rcy, S ^ 0x41a1) * RIVCELL);
      const py = rcy * RIVCELL + Math.floor(rand2(rcx, rcy * 11 + a, S ^ 0x41a2) * RIVCELL);
      if (elevation(px, py) > 0.70 && temperature(px, py) < 0.60) { sx = px; sy = py; break; }
    }
    if (sx !== -1) {
      for (let a = 0; a < 12; a++) {
        let bx = sx, by = sy, be = elevation(sx, sy);
        for (let k = 0; k < 8; k++) {
          const ang = k * Math.PI / 4;
          const nx = Math.round(sx + Math.cos(ang) * 3), ny = Math.round(sy + Math.sin(ang) * 3);
          const ne = elevation(nx, ny);
          if (ne > be) { be = ne; bx = nx; by = ny; }
        }
        if (bx === sx && by === sy) break;
        sx = bx; sy = by;
      }
      const route = gridRoute({
        starts: [[sx, sy]], step: 10,
        goal: (x, y, e) => waterBody(x, y, e),
        cost: (e, x, y) => 1 + Math.max(0, e - LAND_E) * 4 +
                           fbm(x * 0.013, y * 0.013, S + 919, 2) * 0.6,
        maxNodes: 22000, maxDist: RIV_DIST,
      });
      if (route && route.length > 2) {
        const sh = shapePath(route, (rcx * 53 + rcy * 97) & 1023, 3);
        const pts = sh.map((p, i) => [p[0], p[1], 1.1 + 0.5 * i / sh.length]);
        out = { polys: [pts], bbox: polyBBox(pts, 6), key: "R" + key };
      }
    }
    riverCache.set(key, out);
    return out;
  }

  const LKCELL = 192, LK_STEP = 6, LK_MAXCELLS = 1500, LK_MINCELLS = 6;
  const lakeCellCache = new Map(), lakeBodyCache = new Map(), oceanSeen = new Set();

  function lakeFill(wx, wy) {
    const q = [[Math.round(wx / LK_STEP), Math.round(wy / LK_STEP)]];
    const set = new Set([q[0][0] + "," + q[0][1]]);
    const cells = [];
    for (let qi = 0; qi < q.length; qi++) {
      const [gx, gy] = q[qi];
      const e = elevation(gx * LK_STEP, gy * LK_STEP);
      if (e >= LAND_E) continue;
      if (e < DEEP_E || cells.length >= LK_MAXCELLS) {
        for (const k of set) oceanSeen.add(k);
        return null;
      }
      cells.push([gx, gy]);
      for (let k = 0; k < 4; k++) {
        const nx = gx + GRID8[k][0], ny = gy + GRID8[k][1];
        const nk = nx + "," + ny;
        if (!set.has(nk)) { set.add(nk); q.push([nx, ny]); }
      }
    }
    if (cells.length < LK_MINCELLS) return null;
    let cx = Infinity, cy = Infinity;
    for (const [gx, gy] of cells)
      if (gy < cy || (gy === cy && gx < cx)) { cx = gx; cy = gy; }
    return { cells, set, id: cx + "," + cy };
  }

  function lakeOutflows(lkx, lky) {
    const key = lkx + "," + lky;
    if (lakeCellCache.has(key)) return lakeCellCache.get(key);
    const out = [], seen = new Set();
    for (let iy = 0; iy < 8; iy++) for (let ix = 0; ix < 8; ix++) {
      const px = lkx * LKCELL + ix * 24 + 12, py = lky * LKCELL + iy * 24 + 12;
      const gk = Math.round(px / LK_STEP) + "," + Math.round(py / LK_STEP);
      if (oceanSeen.has(gk) || seen.has(gk)) continue;
      const e = elevation(px, py);
      if (e >= LAND_E || e < DEEP_E) continue;
      const lake = lakeFill(px, py);
      if (!lake) continue;
      for (const k of lake.set) seen.add(k);
      let flow;
      if (lakeBodyCache.has(lake.id)) flow = lakeBodyCache.get(lake.id);
      else {
        const starts = lake.cells.slice()
          .sort((a, b) => a[1] - b[1] || a[0] - b[0])
          .map(c => [c[0] * LK_STEP, c[1] * LK_STEP]);
        const route = gridRoute({
          starts, step: LK_STEP,
          goal: (x, y, e2) => e2 < LAND_E && waterBody(x, y, e2) &&
            !lake.set.has(Math.round(x / LK_STEP) + "," + Math.round(y / LK_STEP)),
          cost: (e2, x, y) => 1 + Math.max(0, e2 - LAND_E) * 4 +
                              fbm(x * 0.013, y * 0.013, S + 919, 2) * 0.6,
          maxNodes: 22000, maxDist: RIV_DIST,
        });
        flow = null;
        if (route && route.length > 2) {
          const sh = shapePath(route, hash2i(lkx, lky, S ^ 0x77aa) & 1023, 2.5);
          const pts = sh.map(p => [p[0], p[1], 2.8]);
          flow = { polys: [pts], bbox: polyBBox(pts, 8), key: "L" + lake.id };
        }
        lakeBodyCache.set(lake.id, flow);
      }
      if (flow) out.push(flow);
    }
    lakeCellCache.set(key, out);
    return out;
  }

  function riversNear(tx0, ty0, tx1, ty1) {
    const out = [], seen = new Set();
    const add = rv => {
      if (!rv || seen.has(rv.key)) return;
      seen.add(rv.key);
      if (rv.bbox[0] <= tx1 && rv.bbox[2] >= tx0 &&
          rv.bbox[1] <= ty1 && rv.bbox[3] >= ty0) out.push(rv);
    };
    const c0x = Math.floor((tx0 - RIV_RANGE) / RIVCELL), c1x = Math.floor((tx1 + RIV_RANGE) / RIVCELL);
    const c0y = Math.floor((ty0 - RIV_RANGE) / RIVCELL), c1y = Math.floor((ty1 + RIV_RANGE) / RIVCELL);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        add(riverTrace(cx, cy));
        for (const fl of lakeOutflows(cx, cy)) add(fl);
      }
    return out;
  }

  const ROAD_LINK_CELLS = 2, ROAD_MAX_LEN = 520;
  const CITY_LINK_CELLS = 14, CITY_MAX_LEN = CITY_LINK_CELLS * VCELL;
  const ROAD_STEP = 6, ROAD_W = 1.4, WATER_COST = 8;
  const roadCache = new Map(), roadECache = new Map(), coarseECache = new Map();

  // Roads route on elevation alone (the original network) — they may run
  // beside or weave across rivers; every road∧river tile becomes a bridge.
  // The one place they may never go is the Dream Forest interior (terrain.js
  // DREAM_WORLD): its flat carve would otherwise read as prime road country.
  function roadCost(e, x, y) {
    if (x != null && dreamZoneAtMap(x, y)) return Infinity;
    if (e < DEEP_E || e > 0.78) return Infinity;
    if (e < LAND_E) return WATER_COST;
    return 1 + Math.max(0, e - 0.60) * 2.2;
  }
  function cityGates(v) {
    const R = v.R + 2;
    if (v.layout === 1) {
      const d = R * 0.75;
      return [[v.x - d, v.y - d], [v.x + d, v.y + d],
              [v.x - d, v.y + d], [v.x + d, v.y - d]];
    }
    return [[v.x - R, v.y], [v.x + R, v.y], [v.x, v.y - R], [v.x, v.y + R]];
  }
  function roadAnchor(v, ox, oy) {
    if (v.kind !== "city") return [v.x, v.y];
    let best = null, bd = Infinity;
    for (const g of cityGates(v)) {
      const d = (g[0] - ox) * (g[0] - ox) + (g[1] - oy) * (g[1] - oy);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  const COARSE_STEP = 24, TUBE_R = 8;
  const compCache = new Map();

  function coarseRoute(A, B, len, maxNodes) {
    const skey = Math.round(A[0] / COARSE_STEP) + "," + Math.round(A[1] / COARSE_STEP);
    const comp = compCache.get(skey);
    if (comp) {
      const bx = Math.round(B[0] / COARSE_STEP), by = Math.round(B[1] / COARSE_STEP);
      let ok = false;
      for (let dy = -1; dy <= 1 && !ok; dy++)
        for (let dx = -1; dx <= 1 && !ok; dx++)
          if (comp.has((bx + dx) + "," + (by + dy))) ok = true;
      if (!ok) return null;
    }
    const flags = {};
    const route = gridRoute({
      starts: [A], step: COARSE_STEP, tx: B[0], ty: B[1],
      goal: (x, y) => (x - B[0]) * (x - B[0]) + (y - B[1]) * (y - B[1]) <= 1200,
      cost: roadCost, hw: 1.2, eCache: coarseECache,
      maxNodes, maxDist: len * 4 + 300, flags,
    });
    if (!route && flags.exhausted)
      compCache.set(skey, new Set(flags.visited.keys()));
    return route;
  }
  function tubeSet(coarse) {
    const tube = new Set();
    for (const p of coarse) {
      const gx = Math.round(p[0] / ROAD_STEP), gy = Math.round(p[1] / ROAD_STEP);
      for (let dy = -TUBE_R; dy <= TUBE_R; dy++)
        for (let dx = -TUBE_R; dx <= TUBE_R; dx++)
          tube.add((gx + dx) + "," + (gy + dy));
    }
    return tube;
  }
  function fineRoute(A, B, len, tube, corr) {
    // With a corridor the cheapest tiles cost 0.5, so hw must drop to 0.5 to
    // stay admissible — otherwise A* beelines and ignores the corridor.
    return gridRoute({
      starts: [A], step: ROAD_STEP, tx: B[0], ty: B[1],
      goal: (x, y) => (x - B[0]) * (x - B[0]) + (y - B[1]) * (y - B[1]) <= 81,
      cost: (e, x, y) => {
        const key = Math.round(x / ROAD_STEP) + "," + Math.round(y / ROAD_STEP);
        if (!tube.has(key)) return Infinity;
        const c = roadCost(e, x, y);
        return corr && c !== Infinity && corr.has(key) ? c * 0.5 : c;
      },
      hw: corr ? 0.5 : 1, eCache: roadECache,
      maxNodes: corr ? 60000 : 30000, maxDist: len * 4 + 300,
    });
  }

  function roadProbe(a, b) {
    if (b.vcx < a.vcx || (b.vcx === a.vcx && b.vcy < a.vcy)) { const t = a; a = b; b = t; }
    const A = roadAnchor(a.v, b.v.x, b.v.y), B = roadAnchor(b.v, a.v.x, a.v.y);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const city = a.v.kind === "city" && b.v.kind === "city";
    const coarse = coarseRoute(A, B, len, city ? 20000 : 6000);
    if (!coarse) return null;
    const route = fineRoute(A, B, len, tubeSet(coarse), null);
    if (!route) return null;
    return { a, b, A, B, route, coarse,
             key: a.vcx + "," + a.vcy + "|" + b.vcx + "," + b.vcy };
  }

  const primaryCityCache = new Map();
  function primaryCity(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (primaryCityCache.has(key)) return primaryCityCache.get(key);
    const v = villageNode(vcx, vcy);
    let best = null, bd = Infinity;
    if (v)
      for (let dy = -ROAD_LINK_CELLS; dy <= ROAD_LINK_CELLS; dy++)
        for (let dx = -ROAD_LINK_CELLS; dx <= ROAD_LINK_CELLS; dx++) {
          if (!dx && !dy) continue;
          const u = villageNode(vcx + dx, vcy + dy);
          if (!u || u.kind !== "city") continue;
          const d2 = (u.x - v.x) * (u.x - v.x) + (u.y - v.y) * (u.y - v.y);
          if (d2 < ROAD_MAX_LEN * ROAD_MAX_LEN && d2 < bd) {
            bd = d2;
            best = (vcx + dx) + "," + (vcy + dy);
          }
        }
    primaryCityCache.set(key, best);
    return best;
  }

  const selCache = new Map();
  function roadSelection(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (selCache.has(key)) return selCache.get(key);
    const out = [];
    const v = villageNode(vcx, vcy);
    if (v) {
      const me = { v, vcx, vcy };
      const city = v.kind === "city";
      const range = city ? CITY_LINK_CELLS : ROAD_LINK_CELLS;
      const myCity = city ? null : primaryCity(vcx, vcy);
      const cands = [];
      for (let dy = -range; dy <= range; dy++)
        for (let dx = -range; dx <= range; dx++) {
          if (!dx && !dy) continue;
          const u = villageNode(vcx + dx, vcy + dy);
          if (!u) continue;
          if (city && u.kind !== "city") continue;
          const d2 = (u.x - v.x) * (u.x - v.x) + (u.y - v.y) * (u.y - v.y);
          if (city || d2 < ROAD_MAX_LEN * ROAD_MAX_LEN)
            cands.push({ v: u, vcx: vcx + dx, vcy: vcy + dy, d2 });
        }
      cands.sort((p, q) => p.d2 - q.d2);
      let cityLinked = false;
      for (const u of cands) {
        if (out.length >= 2) break;
        if (u.v.kind === "city") {
          if (!city && cityLinked) continue;
        } else if (myCity && primaryCity(u.vcx, u.vcy) === myCity) {
          continue;
        }
        const pe = roadProbe(me, u);
        if (pe) {
          out.push(pe);
          if (u.v.kind === "city") cityLinked = true;
        }
      }
    }
    selCache.set(key, out);
    return out;
  }

  // Every canonically-earlier edge whose probe route passes within ~a tube
  // width of pe's — not just edges sharing a settlement: independent roads
  // funnelling through the same corridor must see each other to merge.
  const NEARBY = TUBE_R * ROAD_STEP;
  function nearbyEarlierEdges(pe) {
    const nearKeys = new Set();
    for (const p of pe.route) {
      const gx = Math.round(p[0] / NEARBY), gy = Math.round(p[1] / NEARBY);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) nearKeys.add((gx + dx) + "," + (gy + dy));
    }
    const c0x = Math.min(pe.a.vcx, pe.b.vcx) - CITY_LINK_CELLS,
          c1x = Math.max(pe.a.vcx, pe.b.vcx) + CITY_LINK_CELLS,
          c0y = Math.min(pe.a.vcy, pe.b.vcy) - CITY_LINK_CELLS,
          c1y = Math.max(pe.a.vcy, pe.b.vcy) + CITY_LINK_CELLS;
    const out = [], seen = new Set();
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++)
        for (const oe of roadSelection(cx, cy)) {
          if (seen.has(oe.key) || !laneEarlier(oe, pe)) continue;
          seen.add(oe.key);
          for (const p of oe.route)
            if (nearKeys.has(Math.round(p[0] / NEARBY) + "," +
                             Math.round(p[1] / NEARBY))) { out.push(oe); break; }
        }
    return out;
  }

  const edgeFinalCache = new Map();
  function laneEarlier(oe, pe) {
    return oe.route.length !== pe.route.length
      ? oe.route.length > pe.route.length
      : oe.key < pe.key;
  }
  function edgeFinal(pe) {
    if (edgeFinalCache.has(pe.key)) return edgeFinalCache.get(pe.key);
    const ctx = nearbyEarlierEdges(pe);
    let route = pe.route;
    if (ctx.length) {
      const tube = tubeSet(pe.coarse);
      const corr = new Set();
      for (const oe of ctx) {
        for (const k of tubeSet(oe.coarse)) tube.add(k);
        // corridor over the earlier edge's FINAL route (it may itself have been
        // re-laned) — following the probe route leaves us parallel to the road
        // that actually gets drawn
        for (const p of edgeFinal(oe).route)
          corr.add(Math.round(p[0] / ROAD_STEP) + "," + Math.round(p[1] / ROAD_STEP));
      }
      const len = Math.hypot(pe.B[0] - pe.A[0], pe.B[1] - pe.A[1]);
      const rr = fineRoute(pe.A, pe.B, len, tube, corr);
      if (rr) route = rr;
    }
    route = route.slice();
    route[0] = pe.A;
    route.push(pe.B);
    const pts = shapePath(route, 0, 1.2, true);
    const rp = { pts, bbox: polyBBox(pts, 3), key: pe.key, route };
    edgeFinalCache.set(pe.key, rp);
    return rp;
  }

  function settlementRoads(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (roadCache.has(key)) return roadCache.get(key);
    const out = roadSelection(vcx, vcy).map(edgeFinal);
    roadCache.set(key, out);
    return out;
  }
  // ---- road warm worker support ----
  // _roadWarm runs INSIDE the worker: finish every village cell's roads in a
  // pad-cell box around the player and emit each one (the per-cell product is
  // plain {pts,bbox,key} data, safe to postMessage). _roadCellInject runs on
  // the MAIN thread: adopt a worker-finished cell unless it was already
  // computed locally (identical values either way — same code, same seed).
  const _warmedCells = new Set();
  function _roadWarm(mx, my, pad, emit) {
    const ccx = Math.floor(mx / VCELL), ccy = Math.floor(my / VCELL);
    // pass 1 — enumerate the village cells this warm will actually compute
    // (villageNode is a cheap probe), outward ring by ring so the cells
    // nearest the player finish first. Knowing the count up front lets each
    // emit carry (done, total): the boot loading bar's real road progress.
    const todo = [];
    for (let r = 0; r <= pad; r++)
      for (let cy = ccy - r; cy <= ccy + r; cy++)
        for (let cx = ccx - r; cx <= ccx + r; cx++) {
          if (Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)) !== r) continue;
          const key = cx + "," + cy;
          if (_warmedCells.has(key)) continue;
          _warmedCells.add(key);
          if (!villageNode(cx, cy)) continue; // no village -> cheap everywhere
          todo.push([cx, cy, key]);
        }
    // pass 2 — the expensive part (road selection + city-link A* per cell)
    for (let i = 0; i < todo.length; i++)
      emit(todo[i][2], settlementRoads(todo[i][0], todo[i][1]), i + 1, todo.length);
  }
  function _roadCellInject(key, out) {
    if (!roadCache.has(key)) roadCache.set(key, out);
  }
  // cache growth beacon: the far-LOD road ribbon redraws only when this moves
  const _roadCacheSize = () => roadCache.size;
  const ROAD_SCAN = Math.ceil(CITY_MAX_LEN / VCELL);
  // Non-forcing roadsNear for the far-LOD vista (render3d buildFarRibbons):
  // reads ONLY village cells the road cache already holds (computed locally or
  // injected by the road worker) and counts the cold ones instead of running
  // their city-link A* — which, over a far-LOD rect on a freshly visited
  // region, is a 5+ second synchronous main-thread freeze. The caller draws
  // what's cached and retries once the worker has injected the rest.
  function roadsNearCached(tx0, ty0, tx1, ty1) {
    const out = [], seen = new Set();
    let missing = 0;
    const c0x = Math.floor(tx0 / VCELL) - ROAD_SCAN, c1x = Math.floor(tx1 / VCELL) + ROAD_SCAN;
    const c0y = Math.floor(ty0 / VCELL) - ROAD_SCAN, c1y = Math.floor(ty1 / VCELL) + ROAD_SCAN;
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const v = villageNode(cx, cy);
        if (!v) continue;
        if (v.kind !== "city" &&
            (v.x < tx0 - ROAD_MAX_LEN - 32 || v.x > tx1 + ROAD_MAX_LEN + 32 ||
             v.y < ty0 - ROAD_MAX_LEN - 32 || v.y > ty1 + ROAD_MAX_LEN + 32)) continue;
        const cached = roadCache.get(cx + "," + cy);
        if (!cached) { missing++; continue; }
        for (const rp of cached) {
          if (seen.has(rp.key)) continue;
          seen.add(rp.key);
          if (rp.bbox[0] <= tx1 && rp.bbox[2] >= tx0 &&
              rp.bbox[1] <= ty1 && rp.bbox[3] >= ty0) out.push(rp);
        }
      }
    return { roads: out, missing };
  }
  function roadsNear(tx0, ty0, tx1, ty1) {
    const out = [], seen = new Set();
    const c0x = Math.floor(tx0 / VCELL) - ROAD_SCAN, c1x = Math.floor(tx1 / VCELL) + ROAD_SCAN;
    const c0y = Math.floor(ty0 / VCELL) - ROAD_SCAN, c1y = Math.floor(ty1 / VCELL) + ROAD_SCAN;
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const v = villageNode(cx, cy);
        if (!v) continue;
        if (v.kind !== "city" &&
            (v.x < tx0 - ROAD_MAX_LEN - 32 || v.x > tx1 + ROAD_MAX_LEN + 32 ||
             v.y < ty0 - ROAD_MAX_LEN - 32 || v.y > ty1 + ROAD_MAX_LEN + 32)) continue;
        for (const rp of settlementRoads(cx, cy)) {
          if (seen.has(rp.key)) continue;
          seen.add(rp.key);
          if (rp.bbox[0] <= tx1 && rp.bbox[2] >= tx0 &&
              rp.bbox[1] <= ty1 && rp.bbox[3] >= ty0) out.push(rp);
        }
      }
    return out;
  }

  function nearPoly(pts, x, y, r) {
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1];
      const vx = pts[i][0] - ax, vy = pts[i][1] - ay;
      const tt = Math.max(0, Math.min(1,
        ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      const dx = x - ax - vx * tt, dy = y - ay - vy * tt;
      const rr = r + (pts[i][2] || 0);
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }
  function riverNearPt(x, y, r) {
    for (const rv of riversNear(x, y, x, y))
      for (const pts of rv.polys) if (nearPoly(pts, x, y, r)) return true;
    return false;
  }
  function roadNearPt(x, y, r) {
    for (const rp of roadsNear(x, y, x, y))
      if (nearPoly(rp.pts, x, y, r + ROAD_W)) return true;
    return false;
  }

  // ---- BANK NETWORKS -------------------------------------------------------
  // Settlements joined by the road web share one bank vault; a landmass roads
  // can never leave (an island ringed by deep water, a basin walled by peaks)
  // is its own separate network with its own vault. Rather than walking the
  // actual road graph (unbounded on the infinite mainland, and each edge costs
  // an A* probe), we flood the COARSE terrain grid with the exact passability
  // roads route on (roadCost: deep water and high peaks block, shallow fords
  // don't) — road reachability and this flood agree on what's connectable.
  //   · flood stays under budget → a FINITE pocket → id "isle:<min cell>"
  //     (the component's canonical cell, stable from any start point in it)
  //   · budget exceeded → the endless mainland web → id "main"
  // Deterministic (seeded elevation, fixed visit order) and cached for every
  // cell the flood visits (they're all in the same component by construction).
  const NET_BUDGET = 4000;             // coarse cells ≈ isles up to ~4000 game tiles across
  const netCache = new Map();          // "cx,cy" (COARSE_STEP cell) → network id
  function bankNetId(gx, gy) {
    let c0x = Math.round(gx * 0.5 / COARSE_STEP), c0y = Math.round(gy * 0.5 / COARSE_STEP);
    const pass = (cx, cy) => roadCost(elevation(cx * COARSE_STEP, cy * COARSE_STEP),
      cx * COARSE_STEP, cy * COARSE_STEP) !== Infinity;
    // a chest can sit on a pier / cliff edge whose coarse sample is impassable:
    // nudge to the nearest passable cell so the flood has somewhere to start
    if (!pass(c0x, c0y)) {
      let fx = null, fy = null;
      for (let r = 1; r <= 3 && fx === null; r++)
        for (let dy = -r; dy <= r && fx === null; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (pass(c0x + dx, c0y + dy)) { fx = c0x + dx; fy = c0y + dy; break; }
      if (fx === null) return "main";  // open ocean — shouldn't happen for a real chest
      c0x = fx; c0y = fy;
    }
    const k0 = c0x + "," + c0y;
    const hit = netCache.get(k0);
    if (hit) return hit;
    const seen = new Set([k0]);
    const q = [[c0x, c0y]];
    let minX = c0x, minY = c0y, id = null;
    for (let i = 0; i < q.length; i++) {
      if (seen.size > NET_BUDGET) { id = "main"; break; }
      const [cx, cy] = q[i];
      if (cy < minY || (cy === minY && cx < minX)) { minX = cx; minY = cy; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = nx + "," + ny;
        if (seen.has(k) || !pass(nx, ny)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    if (!id) id = "isle:" + minX + "," + minY;
    for (const k of seen) netCache.set(k, id);   // every visited cell shares it
    return id;
  }
  // river test for a single GAME tile (same polyline proximity the chunk
  // generator carves water from)
  function riverAtPt(x, y) {
    const mx = x * 0.5, my = y * 0.5;
    for (const rv of riversNear(mx - 1, my - 1, mx + 1, my + 1))
      for (const pts of rv.polys)
        if (nearPoly(pts, mx, my, 0)) return true;
    return false;
  }
  // Door column for a river-spanning building's wall row: the closest-to-
  // centre x whose wall tile is NOT part of the hollow river passage, so the
  // door never opens onto open water. When the channel crosses this row and
  // `oppositeTo` (the other door's column) is given, prefer a column on the
  // OTHER side of the channel — so a river running through the building
  // lengthwise still leaves a door on each bank. Pure function of position —
  // chunk stamping and buildingMeta both call this and always agree.
  function solidDoorX(x0, w, yRow, oppositeTo) {
    const cx = x0 + (w >> 1);
    const hollow = x => riverAtPt(x, yRow) || riverAtPt(x + 1, yRow) || riverAtPt(x - 1, yRow) ||
      riverAtPt(x, yRow + 1) || riverAtPt(x, yRow - 1);
    const cand = [];
    for (let d = 0; d <= (w >> 1); d++)
      for (const x of d ? [cx - d, cx + d] : [cx])
        if (x > x0 && x < x0 + w - 1 && !hollow(x)) cand.push(x);
    if (!cand.length) return cx;
    if (oppositeTo != null) {
      let lo = Infinity, hi = -Infinity;
      for (let x = x0; x < x0 + w; x++)
        if (riverAtPt(x, yRow)) { if (x < lo) lo = x; if (x > hi) hi = x; }
      if (lo <= hi) { // channel crosses this row
        const side = oppositeTo < lo ? cand.filter(x => x > hi)
          : oppositeTo > hi ? cand.filter(x => x < lo) : null;
        if (side && side.length) return side[0];
      }
    }
    return cand[0];
  }
  // Downstream flow direction at a GAME-tile position on/near a river: the
  // nearest polyline segment's direction (polylines run source → sea, and
  // lake outflows lake → sea, so the segment direction IS the current).
  // Returns a unit [fx, fy] in game coords, or null off the rivers.
  const flowCache = new Map();
  function riverFlowAt(x, y) {
    const ck = x + "," + y;
    let v = flowCache.get(ck);
    if (v !== undefined) return v;
    const mx = x * 0.5, my = y * 0.5;
    let best = null, bd = Infinity;
    // the current dies where the river meets open water: natural sea/lake
    // tiles (elevation already below the coast) have no downstream pull even
    // when a polyline's mouth segment runs past them
    if (elevation(mx, my) < LAND_E) {
      flowCache.set(ck, null);
      return null;
    }
    for (const rv of riversNear(mx - 2, my - 2, mx + 2, my + 2))
      for (const pts of rv.polys)
        for (let i = 1; i < pts.length; i++) {
          const ax = pts[i - 1][0], ay = pts[i - 1][1];
          const vx = pts[i][0] - ax, vy = pts[i][1] - ay;
          const tt = Math.max(0, Math.min(1,
            ((mx - ax) * vx + (my - ay) * vy) / (vx * vx + vy * vy || 1)));
          const dx = mx - ax - vx * tt, dy = my - ay - vy * tt;
          const d2 = dx * dx + dy * dy, rr = (pts[i][2] || 0) + 2;
          if (d2 < rr * rr && d2 < bd) {
            const len = Math.hypot(vx, vy) || 1;
            best = [vx / len, vy / len];
            bd = d2;
          }
        }
    if (flowCache.size > 100000) flowCache.clear();
    flowCache.set(ck, best);
    return best;
  }
  // transpose of solidDoorX: a door ROW on a west/east wall column
  function solidDoorY(y0, h, xCol) {
    const cy = y0 + (h >> 1);
    const hollow = y => riverAtPt(xCol, y) || riverAtPt(xCol, y + 1) || riverAtPt(xCol, y - 1) ||
      riverAtPt(xCol + 1, y) || riverAtPt(xCol - 1, y);
    for (let d = 0; d <= (h >> 1); d++)
      for (const y of d ? [cy - d, cy + d] : [cy])
        if (y > y0 && y < y0 + h - 1 && !hollow(y)) return y;
    return cy;
  }
  // Door pair for a river-spanning building — one door per bank. If the
  // channel runs north-south through the footprint, the west and east walls
  // each sit on their own bank, so the doors go there (LocAngle WEST=0,
  // EAST=2); otherwise the south and north walls do (SOUTH=3, NORTH=1).
  // Pure function of position — chunk stamping and buildingMeta must agree.
  function riverDoors(x0, y0, w, h) {
    const x1 = x0 + w - 1, y1 = y0 + h - 1;
    const rowHasRiver = y => { for (let x = x0; x <= x1; x++) if (riverAtPt(x, y)) return true; return false; };
    const colHasRiver = x => { for (let y = y0; y <= y1; y++) if (riverAtPt(x, y)) return true; return false; };
    const ns = rowHasRiver(y0) && rowHasRiver(y1);
    const ew = colHasRiver(x0) && colHasRiver(x1);
    if (ns && !ew)
      return [
        { x: x0, y: solidDoorY(y0, h, x0), angle: 0 },
        { x: x1, y: solidDoorY(y0, h, x1), angle: 2 },
      ];
    const s = solidDoorX(x0, w, y1);
    return [
      { x: s, y: y1, angle: 3 },
      { x: solidDoorX(x0, w, y0, s), y: y0, angle: 1 },
    ];
  }
  // For a GAME-tile position on (or beside) a spring-fed river, the arc
  // distance in game tiles from the river's spring (pts[0]) to the nearest
  // point of the polyline, plus the spring position in game tiles. Lake
  // outflows ("L" keys) have no spring and are skipped. Only the first
  // SRC_SCAN map units of each river are walked — past that the water has
  // already reached its base level, so callers never need the distance.
  const SRC_SCAN = 60;
  function riverSourceAt(x, y) {
    const mx = x * 0.5, my = y * 0.5;
    let best = null;
    for (const rv of riversNear(mx - 2, my - 2, mx + 2, my + 2)) {
      if (!rv.key || rv.key[0] !== "R") continue;
      for (const pts of rv.polys) {
        let acc = 0;
        for (let i = 1; i < pts.length && acc < SRC_SCAN; i++) {
          const ax = pts[i - 1][0], ay = pts[i - 1][1];
          const vx = pts[i][0] - ax, vy = pts[i][1] - ay;
          const len = Math.hypot(vx, vy);
          const tt = Math.max(0, Math.min(1,
            ((mx - ax) * vx + (my - ay) * vy) / (vx * vx + vy * vy || 1)));
          const dx = mx - ax - vx * tt, dy = my - ay - vy * tt;
          const rr = (pts[i][2] || 0) + 1.5;
          if (dx * dx + dy * dy < rr * rr) {
            const d = (acc + len * tt) * 2;
            if (!best || d < best.d) best = { d, sx: pts[0][0] * 2, sy: pts[0][1] * 2 };
          }
          acc += len;
        }
      }
    }
    return best;
  }

  // ---------- settlements (port; Newhaven fixed at origin) ----------
  const NAME_A = [
    "Ask","Asken","Aak","Aaken","Beork","Beorken","Beam","Lind","Thorn","Thyrn",
    "Hasel","Alm","Eeow","Iiw","Eorth","Fearn","Riied","Reod","Braar","Braambel",
    "Gors","Gras","Moos","Mistel","Wudu","Wudan","Holt","Bearu","Skeaga","Weald",
    "Wold","Moor","Moores","Haath","Haathen","Fenn","Fennes","Mersk","Merskes","Mere",
    "Meres","Saa","Saas","Ea","Ean","Burna","Burnan","Brook","Brookes","Stream",
    "Water","Wateres","Ford","Fordes","Brykug","Brykuges","Weg","Weges","Diik",
    "Diikes","Geat","Geates","Meark","Mearkes","Gemaare","Staan","Staanes","Klif",
    "Klifes","Krag","Karr","Duun","Duunes","Beorg","Beorges","Hlaaw","Hlaawes","Hooh",
    "Hoohes","Harykug","Harykuges","Denu","Dene","Dal","Kumb","Kumbes","Nas","Nases",
    "Oora","Ooran","Eeg","Eeges","Land","Londes","Aker","Akeres","Kroft","Kroftes",
    "Kot","Kotes","Haga","Hagan","Tuun","Tuunes","Haam","Haames","Burh","Burges",
    "Kaster","Kastres","Stede","Stedes","Stoow","Stoowes","Wiik","Wiikes","Heall",
    "Healle","Mynster","Mynstres","Eald","Ield","Niiwe","Niwe","East","Easter","West","Wester","North","Norther",
    "Suuth","Suuther","Middel","Upp","Nider","Heah","Hean","Laag","Lag","Lagen",
    "Braad","Braadan","Smal","Smale","Deop","Deopan","Keald","Kealden","Haat","Haaten",
    "Hwiit","Hwiitan","Blak","Blakan","Sweart","Sweartan","Greene","Greenan","Bruun",
    "Bruunan","Read","Readan","Graag","Graagan","Fealu","Fager","Beorht","Torht",
    "Dimm","Dyrne","Wiid","Wiidan","Mikel","Lyytel","Lyytilan","Maare","Maaran",
    "Freorig","Skeort","Skearp","Heard","Sooft","Stille","Wild","Wilde","Ruuh",
    "Ruugan","Smook","Smookan","Wulf","Wulfes","Harafn","Harafnes","Beorn","Beornes","Eofor","Eofores","Hors",
    "Horses","Hart","Heortes","Hind","Hinde","Kuu","Kuuan","Ox","Oxan","Skeap",
    "Skeapes","Gaat","Gaates","Fox","Foxes","Hara","Haran","Bera","Beran","Otter",
    "Otteres","Wyrm","Wyrmes","Snaka","Snakan","Naadre","Naadran","Fisk","Fiskes",
    "Hafok","Hafokes","Earn","Earnes","Swan","Swanes","Goos","Gooses","Harook",
    "Harookes","Kulfre","Kulfran","Dufe","Dufan","Beo","Beon","Myyra","Myyran",
    "Frosk","Froskes","Athel","Athelrad","Alf","Alfrad","Alfred","Ead","Eadgar","Eadmund","Eadwine",
    "Eadrik","Eadbald","Eadweard","Os","Osgaar","Oswine","Osweald","Wiig","Wiiges",
    "Wiigmund","Wiigstan","Sig","Sige","Siges","Sigerik","Sigewulf","Here",
    "Heremund","Hereward","Hild","Hilde","Mild","Keol","Keoles","Keolwulf",
    "Ken","Keen","Kenred","Kyne","Kynewulf","Kynig","Kween","Kwen","God","Godes",
    "Godrik","Godwine","Leof","Leofes","Leofwine","Leofrik","Wynn","Wyn","Wynes",
    "Frith","Frith","Frithes","Gar","Gaares","Alla","Allan","Offa","Offan","Penda",
    "Pendan","Kad","Kades","Kuth","Kuuth","Kuuthared","Dun","Dunn","Dunnan","Hegest",
    "Hegestes","Horsa","Horsan","Sax","Saxes","Saxan","Theod","Theodes",
    "Theodrik","Harood","Haroodgar","Harodwulf","Raad","Raades","Maar","Maares","Wald",
    "Wealdes",
  ];
  const NAME_B = [
    "haam","haame","haamstede","haamtuun","tuun","tuune","tuunstede","tuunhaam",
    "worth","weorth","worth","worthig","leah","leage","lea","leahstede",
    "hyrst","hyrste","burh","burg","byrig","burhstede","keaster","kaster",
    "brykug","brykuge","ford","forda","wiik","wiike","wik","stede","stedeham",
    "stoow","stoowe","denu","dene","dal","dale","duun","duune","kumb","kumbe",
    "mere","maare","wella","wiella","wyll","wylla","burna","burne","brook","brooke",
    "ea","ean","stream","streame","laku","lakan","siik","siike","pyll","pol","flood",
    "feld","felde","aker","akere","land","lond","londe","wudu","wuda","weald",
    "wealde","wold","holt","holte","bearu","bearwe","skeaga","skeage","graaf",
    "graf","graf","krofte","kroft","haga","hagan","haath","haathe","moor","moore",
    "mersk","merske","fenn","fenne","riied","reod","mos","moos","harykug","harykuge",
    "klif","klife","beorg","beorge","hlaaw","hlaawe","hooh","hoohe","hyll","hylle",
    "hlink","hlinke","slad","slade","nas","nasse","oora","ooran","eeg","eege","iieg",
    "iiege","skeat","skeate","snad","stybb","stybbes","kot","kote","arn","erne",
    "heall","healle","sele","huus","hus","mynster","minster","kirike","kirikan",
    "geat","geat","gate","weg","wege","pad","path","raad","raade","straat","straate",
    "diik","diike","dik","geard","gearde","weall","wealle","meark","mearke","gemaare",
    "setil","setile","sate","thorp","tharop","mylne","mylene","port","porte","wikstoow",
    "keapstoow","keapwiik","haam","tuun","worth","weorth","leah","hyrst","burh","burg","kaster","keaster",
    "wiik","stede","stoow","kot","heall","sele","huus","mynster","kirike","thorp",
    "tharop","setil","geard","duun","denu","dal","kumb","feld","aker","land","lond","wudu","weald","wold",
    "holt","bearu","skeaga","graaf","kroft","haga","haath","moor","mersk","fenn",
    "harykug","klif","beorg","hlaaw","hooh","hyll","hlink","slad","nas","oora","eeg",
    "iieg","skeat","snad","mere","wella","wiella","wyll","burna","brook","ea","stream","laku","siik",
    "pyll","pol","flood","ford","brykug",
  ];
  const REAL_NAMES = new Set();
  function genName(hx, hy, sa, sb) {
    const ai = hash2i(hx, hy, S ^ sa) % NAME_A.length;
    let bi = hash2i(hx, hy, S ^ sb) % NAME_B.length;
    let name = NAME_A[ai] + NAME_B[bi];
    while (REAL_NAMES.has(name)) {
      bi = (bi + 1) % NAME_B.length;
      name = NAME_A[ai] + NAME_B[bi];
    }
    return name;
  }
  // Station roster. Cities only have ~12-16 buildings, so no single city can
  // host every trade: each city carries the ESSENTIALS plus a per-city
  // rotation through the full artisan roster, so every station type exists
  // somewhere in any region of a few cities. (The old fixed-order roster
  // meant its tail — toolsmith, bindery, chandlery… — never spawned at all.)
  const CITY_ESSENTIALS = ["bank", "anvil", "furnace", "altar", "workbench",
    "campfire", "cauldron", "alchtable"];
  const CITY_ARTISANS = ["loom", "tanrack", "mill", "fletchers_bench",
    "sawmill", "seasoning_yard", "malthouse", "brewery", "cooperage", "bakehouse",
    "spinning_wheel", "dyeworks", "fulling_mill", "tailors_bench", "creamery",
    "ropewalk", "sail_loft", "shipyard", "charcoal_clamp", "lime_kiln", "masons_yard",
    "pottery_kiln", "glass_furnace", "assay_furnace", "drawbench", "jewelers_bench",
    "leather_bench", "cobblers_bench", "saddlers_bench", "toolsmith", "locksmith_bench",
    "paper_mill", "bindery", "chandlery", "soap_works", "curing_shed"];
  const CITY_STATIONS = [...CITY_ESSENTIALS, ...CITY_ARTISANS]; // full list (guides/audits)
  const villageCache = new Map();
  // Nameless settlement probe: centre / kind / radius only. This is the
  // cheapest layer — the world name registry enumerates thousands of these,
  // so it must not touch naming (or anything that consults the registry).
  const seatCache = new Map();
  function villageSeat(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (seatCache.has(key)) return seatCache.get(key);
    let seat = null;
    if (vcx === 0 && vcy === 0) {
      seat = { x: 0, y: 0, kind: "city", R: 34 };
    } else {
      const x = vcx * VCELL + 34 + Math.floor(rand2(vcx, vcy, S ^ 0x5222) * (VCELL - 68));
      const y = vcy * VCELL + 34 + Math.floor(rand2(vcx, vcy, S ^ 0x5333) * (VCELL - 68));
      const e = elevation(x, y), t = temperature(x, y), wf = weirdField(x, y);
      let kind = null, R = 0;
      // Tūhura Isle (terrain.js) is hand-built — no procedural settlements
      if (e >= 0.51 && e <= 0.70 && t >= 0.28 && wf > 0.28 && wf < 0.72 && !tutIsleAtMap(x, y)) {
        const civ = Math.max(0, civField(x, y) - 0.40);
        const r0 = rand2(vcx, vcy, S ^ 0x5111);
        if (r0 < civ * 0.7) kind = "city";
        else if (r0 < civ * 2.0) kind = "village";
        if (kind === "city") R = 19 + hash2i(vcx, vcy, S ^ 0x5666) % 6;
      }
      if (kind) seat = { x, y, kind, R };
    }
    seatCache.set(key, seat);
    return seat;
  }
  // is (x,y) in MAP coords clear of every settlement footprint (+12)? The
  // light equivalent of the old villagesNearForMap(x,y,x,y,42) proximity
  // loop — byte-identical results (same cells, same radii), but built on
  // villageSeat so POI existence never touches naming or building layout.
  function villageClearMapAt(x, y) {
    const c0x = Math.floor((x - 42) / VCELL), c1x = Math.floor((x + 42) / VCELL);
    const c0y = Math.floor((y - 42) / VCELL), c1y = Math.floor((y + 42) / VCELL);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const s2 = villageSeat(cx, cy);
        if (!s2) continue;
        const r = (s2.kind === "city" ? s2.R + 7 : 17) + 12;
        const dx = x - s2.x, dy = y - s2.y;
        if (dx * dx + dy * dy < r * r) return false;
      }
    return true;
  }
  // ---- WORLDS: the named-location registry ---------------------------------
  // The infinite map is partitioned into ZONES: 15000×15000-tile blocks with
  // zone (0,0) centred on the origin. Every named location — settlements and
  // every "<Name> <Suffix>" landmark/portal — is tied to the zone its anchor
  // stands in (a `zone: "wx,wy"` field on the record) and draws its name
  // from that zone's registry:
  //   · within one zone, names are unique (allocated per suffix bucket by a
  //     full-cycle walk of the pool, so full display names never repeat),
  //   · zones are 4-coloured by parity, and each colour owns a disjoint
  //     quarter of the NAME_A×NAME_B combo space — the 8 neighbouring zones
  //     therefore share NO names, and the nearest place that can repeat a
  //     name is two zones (≥ 15000 tiles) away.
  // (NPC character names get the same per-zone uniqueness — see NpcNames /
  // js/world/npc-names.js — reusing this registry's per-zone `used` scoping.)
  // Generic flavour venues (inns, guild halls, shacks/camps, wrecks, fairy
  // rings) keep their chain-style names: their pools are far too small to
  // promise uniqueness, and they read as establishments, not places.
  // Map.html mirrors the allocation with IDENTICAL pools and enumeration
  // order, so the standalone map shows exactly the in-game names.
  const ZONE_T = 15000;                    // game tiles per world side
  const ZONE_M = ZONE_T / 2;              // map units per world side
  const zoneOf = (gx, gy) => [Math.floor((gx + ZONE_T / 2) / ZONE_T),
                               Math.floor((gy + ZONE_T / 2) / ZONE_T)];
  const zoneOfMap = (mx, my) => [Math.floor((mx + ZONE_M / 2) / ZONE_M),
                                  Math.floor((my + ZONE_M / 2) / ZONE_M)];
  const zoneRegCache = new Map();          // "wx,wy" → { vNames, vCount, pNames, used, namer0 }
  function zoneReg(wx, wy) {
    const key = wx + "," + wy;
    let r = zoneRegCache.get(key);
    if (!r) { r = { vNames: null, vCount: 0, pNames: null, used: null, namer0: null }; zoneRegCache.set(key, r); }
    return r;
  }
  // Name allocator for one suffix bucket of one world: a full-cycle walk of
  // the whole NAME_A×NAME_B combo space (step coprime with its size), taking
  // only strings this world's COLOUR owns. Ownership is decided by hashing
  // the STRING, not the combo index — nested pool entries make different
  // combos collide as strings ("Ask"+"enholt" = "Asken"+"holt"), and a
  // string must belong to exactly one colour class or neighbouring worlds
  // could share it. `used` (shared by all of the world's buckets) also keeps
  // every base unique within the world.
  function zoneBucketNamer(wx, wy, bucket, used) {
    let hb = 0x9d0b;
    for (let i = 0; i < bucket.length; i++) hb = (hb * 131 + bucket.charCodeAt(i)) >>> 0;
    const NB2 = NAME_B.length, TOTAL = NAME_A.length * NB2;
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const start = hash2i(wx, wy, S ^ hb) % TOTAL;
    let step = 1 + hash2i(wy + 11, wx - 7, S ^ hb ^ 0x51ce) % (TOTAL - 1);
    while (gcd(step, TOTAL) !== 1) step++;
    const color = ((wx & 1) << 1) | (wy & 1);
    let i = 0;
    return () => {
      for (let tries = 0; tries < TOTAL; tries++) {
        const p = (start + (i++) * step) % TOTAL;
        const name = NAME_A[(p / NB2) | 0] + NAME_B[p % NB2];
        let h = 0;
        for (let j = 0; j < name.length; j++) h = (h * 131 + name.charCodeAt(j)) >>> 0;
        if ((h & 3) !== color || used.has(name)) continue;
        used.add(name);
        return name;
      }
      // colour class exhausted (a world would need ~20k+ names) — fall back
      // to a deterministic reuse rather than failing
      const p = (start + (i++) * step) % TOTAL;
      return NAME_A[(p / NB2) | 0] + NAME_B[p % NB2];
    };
  }
  // pass 1: settlements, scanned in cell reading order. Newhaven (the fixed
  // origin city) is skipped — its name is not drawn from any pool.
  // GENERATOR CORE: yields [rowsDone, rowsTotal] once per cell row so the
  // async boot driver (genZoneNamesAsync) can paint a real progress bar
  // through the multi-second pass; the sync wrappers just drain it. Names are
  // a pure function of (world, seed) and each run allocates its own local
  // map/namer, so a sync pass overtaking a half-finished async one computes
  // the identical result — last publish wins harmlessly.
  function* _settleSteps(wx, wy, reg) {
    if (reg.vNames) return;
    const m = new Map(); // filled locally, published at the end (re-entrancy)
    reg.used = new Set();
    reg.namer0 = zoneBucketNamer(wx, wy, "", reg.used); // bucket "" continues in the POI pass
    const namer = reg.namer0;
    const mx0 = wx * ZONE_M - ZONE_M / 2, my0 = wy * ZONE_M - ZONE_M / 2;
    const c0x = Math.floor((mx0 - VCELL) / VCELL), c1x = Math.floor((mx0 + ZONE_M + VCELL) / VCELL);
    const c0y = Math.floor((my0 - VCELL) / VCELL), c1y = Math.floor((my0 + ZONE_M + VCELL) / VCELL);
    let k = 0, lastName = null;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (cx === 0 && cy === 0) continue;
        const s2 = villageSeat(cx, cy);
        if (!s2 || s2.x < mx0 || s2.x >= mx0 + ZONE_M || s2.y < my0 || s2.y >= my0 + ZONE_M) continue;
        lastName = namer();
        m.set(cx + "," + cy, lastName);
        k++;
      }
      yield [cy - c0y + 1, c1y - c0y + 1, lastName];
    }
    // publish only if a concurrent sync pass didn't get there first (the
    // async boot run yields to rAF, and a map-label lookup mid-yield can
    // drain the sync wrapper) — results are identical either way
    if (!reg.vNames) { reg.vNames = m; reg.vCount = k; }
  }
  function zoneSettlePass(wx, wy) {
    const reg = zoneReg(wx, wy);
    for (const _ of _settleSteps(wx, wy, reg)) { /* drain synchronously */ }
    return reg;
  }
  // pass 2: registry-named POIs, continuing bucket "" AFTER the settlements
  // (fishvillages share the empty suffix with settlement names). Flavour
  // venues consume no pool entries. rawType is used — the lazy inn→shack
  // demotion (roadNear) swaps between two flavour types and must not force
  // road generation across a whole world here.
  const POI_FLAVOUR = new Set(["guild", "inn", "shack", "campsite", "hermitage", "shipwreck", "fairyring"]);
  // generator core, same contract as _settleSteps (caller ensures the settle
  // pass ran first — namer0/used continue into bucket "")
  function* _poiSteps(wx, wy, reg) {
    if (reg.pNames) return;
    const m = new Map(); // filled locally, published at the end (re-entrancy)
    const buckets = new Map([["", reg.namer0]]); // continue after the settlements
    const mx0 = wx * ZONE_M - ZONE_M / 2, my0 = wy * ZONE_M - ZONE_M / 2;
    const p0x = Math.floor((mx0 - PCELL) / PCELL), p1x = Math.floor((mx0 + ZONE_M + PCELL) / PCELL);
    const p0y = Math.floor((my0 - PCELL) / PCELL), p1y = Math.floor((my0 + ZONE_M + PCELL) / PCELL);
    let lastName = null;
    for (let py2 = p0y; py2 <= p1y; py2++) {
      for (let px2 = p0x; px2 <= p1x; px2++) {
        const s2 = poiSeat(px2, py2);
        if (!s2 || POI_FLAVOUR.has(s2.rawType)) continue;
        if (s2.x < mx0 || s2.x >= mx0 + ZONE_M || s2.y < my0 || s2.y >= my0 + ZONE_M) continue;
        const bucket = s2.rawType === "portal" ? " Portal" : (POI_SUFFIX[s2.rawType] || "");
        let nb = buckets.get(bucket);
        if (!nb) { nb = zoneBucketNamer(wx, wy, bucket, reg.used); buckets.set(bucket, nb); }
        lastName = nb();
        m.set(px2 + "," + py2, lastName);
      }
      yield [py2 - p0y + 1, p1y - p0y + 1, lastName];
    }
    if (!reg.pNames) { // see _settleSteps' publish guard
      reg.pNames = m;
      _wnPersist(wx, wy, reg); // freshly computed — remember it for future boots
    }
  }
  function zonePoiPass(wx, wy) {
    const reg = zoneSettlePass(wx, wy);
    for (const _ of _poiSteps(wx, wy, reg)) { /* drain synchronously */ }
    return reg;
  }
  // Async boot warm-up for the world holding MAP point (mx,my): the same two
  // passes, but yielding to the compositor every ~40ms with a real progress
  // fraction — the loading bar's "Naming the world…" stage. tick() gets
  // 0..0.5 through settlements, 0.5..1 through POIs. Instant no-op when the
  // registry is already computed/hydrated (every warm boot).
  async function genZoneNamesAsync(mx, my, tick) {
    const [wx, wy] = zoneOfMap(mx, my);
    const reg = zoneReg(wx, wy);
    // _bootYield (main/state.js): paints when visible, hidden-tab-safe
    const paint = typeof _bootYield === "function" ? _bootYield
      : () => new Promise(r => setTimeout(r, 0));
    let last = performance.now();
    for (const [row, rows, name] of _settleSteps(wx, wy, reg))
      if (performance.now() - last > 40) {
        if (tick) tick(0.5 * (row / rows), name);
        await paint();
        last = performance.now();
      }
    for (const [row, rows, name] of _poiSteps(wx, wy, reg))
      if (performance.now() - last > 40) {
        if (tick) tick(0.5 + 0.5 * (row / rows), name);
        await paint();
        last = performance.now();
      }
    if (tick) tick(1);
  }
  // WORKER-side full naming pass (roadworker "names" message): compute — and
  // persist, workers have IndexedDB — the registry for the zone holding MAP
  // point (mx,my), with coarse progress ticks; returns the plain arrays so
  // the main thread can adopt them without re-reading IDB. Pure function of
  // (world, seed): identical to the main-thread pass it replaces on the boot
  // path, where it used to be ~8s of loading-bar time instead of overlapping
  // the sheet decode + atlas bake.
  function genZoneNamesData(mx, my, tick) {
    const [wx, wy] = zoneOfMap(mx, my);
    const reg = zoneReg(wx, wy);
    let i = 0;
    for (const [row, rows, name] of _settleSteps(wx, wy, reg))
      if (tick && !(++i & 3)) tick(0.5 * (row / rows), name);
    for (const [row, rows, name] of _poiSteps(wx, wy, reg))
      if (tick && !(++i & 3)) tick(0.5 + 0.5 * (row / rows), name);
    if (tick) tick(1);
    return { wx, wy, v: [...reg.vNames], vc: reg.vCount, p: [...reg.pNames] };
  }
  // MAIN-thread adoption of a worker-computed registry (no-op if a local
  // pass got there first — identical data either way). Persistence happens
  // HERE, not in the worker: the boot terminates the worker the moment the
  // result lands, which killed the worker's own async IDB put mid-flight.
  function _zoneNamesInject(d) {
    const reg = zoneReg(d.wx, d.wy);
    if (reg.pNames) return;
    reg.vNames = new Map(d.v);
    reg.vCount = d.vc;
    reg.pNames = new Map(d.p);
    _wnPersist(d.wx, d.wy, reg);
  }
  // is the zone holding MAP point (mx,my) already fully named (hydrated or
  // computed)? Decides whether boot needs a naming pass at all.
  function zoneNamed(mx, my) {
    const [wx, wy] = zoneOfMap(mx, my);
    return !!zoneReg(wx, wy).pNames;
  }
  // ---- registry persistence (IndexedDB) ------------------------------------
  // A freshly computed world registry is written to IDB and restored on
  // later boots (preloadZoneNames below, awaited by main.js init), so the
  // ~8s full-world POI pass is paid once per world EVER, not per session.
  // Map.html reads the same store and shows the exact in-game names instead
  // of recomputing with its (drifted) terrain copy. Pure deterministic data.
  // AUTO-VERSIONED alongside the chunk/map caches (2026-09-16): village and
  // POI names anchor to features/terrain output, so a world-gen change must
  // re-key the registry too (a ~8s regen per visited world, only after a
  // REAL generation change). Read lazily so workers — which importScripts
  // this file and receive the signature via their init message — agree with
  // the main thread on the store name.
  // NOTE: the concept is now "zone", but this IDB store name is a PERSISTED key on
  // every player's machine — kept as 'ioe-worldnames-' so the rename doesn't orphan
  // existing caches (a rename would force a one-time regen). Internal only.
  const _wnDbName = () =>
    'ioe-worldnames-' + (typeof WORLDGEN_SIG !== 'undefined' ? WORLDGEN_SIG : 'dev');
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB.databases)
      indexedDB.databases().then(dbs => {
        for (const d of dbs || [])
          if (d && d.name && d.name.startsWith('ioe-worldnames-') && d.name !== _wnDbName())
            try { indexedDB.deleteDatabase(d.name); } catch (e) { /* best effort */ }
      }).catch(() => { /* enumeration unsupported */ });
  } catch (e) { /* best effort */ }
  function _wnOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(_wnDbName(), 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore('w');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function _wnPersist(wx, wy, reg) {
    _wnOpen().then(db => {
      const tx = db.transaction('w', 'readwrite');
      tx.objectStore('w').put({ v: [...reg.vNames], vc: reg.vCount, p: [...reg.pNames] }, wx + "," + wy);
    }).catch(() => { /* private mode etc. — recomputed next boot */ });
  }
  async function preloadZoneNames() {
    try {
      const db = await _wnOpen();
      const store = db.transaction('w').objectStore('w');
      const [keys, vals] = await Promise.all([
        new Promise((res, rej) => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
        new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
      ]);
      keys.forEach((k, i) => {
        const [wx, wy] = String(k).split(",").map(Number);
        const reg = zoneReg(wx, wy);
        if (reg.pNames) return;                 // already computed this session
        reg.vNames = new Map(vals[i].v);
        reg.vCount = vals[i].vc;
        reg.pNames = new Map(vals[i].p);
      });
    } catch (e) { /* first run — worlds compute (and persist) on demand */ }
  }
  function zoneSettlementName(vcx, vcy, seat) {
    const [wx, wy] = zoneOfMap(seat.x, seat.y);
    return zoneSettlePass(wx, wy).vNames.get(vcx + "," + vcy);
  }
  function zonePoiBase(pcx, pcy, seat) {
    const [wx, wy] = zoneOfMap(seat.x, seat.y);
    return zonePoiPass(wx, wy).pNames.get(pcx + "," + pcy) ||
      genName(pcx, pcy, 0x9106, 0x9107); // unreachable safety net
  }
  // Light settlement probe WITH its registry name and world tie. villageInfo
  // uses it as its head, and mainBranchFor() scans hundreds of cells with it.
  const headCache = new Map();
  function villageHead(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (headCache.has(key)) return headCache.get(key);
    const seat = villageSeat(vcx, vcy);
    let head = null;
    if (seat) {
      const [wx, wy] = zoneOfMap(seat.x, seat.y);
      const name = (vcx === 0 && vcy === 0) ? "Newhaven" : zoneSettlementName(vcx, vcy, seat);
      head = { ...seat, name, zone: wx + "," + wy };
    }
    headCache.set(key, head);
    return head;
  }
  // Ultra-light settlement view for ROAD topology (map coords): position,
  // kind, radius and gate layout only — everything roadAnchor/roadSelection
  // consume, and byte-identical to villageForMap's values. The road planner
  // runs on this instead of villageForMap so the road graph never re-enters
  // villageInfo: villageInfo itself consults the road graph (roadNetId) to
  // place bank main branches, and a villageForMap call mid-layout would
  // recurse forever.
  const villageNodeCache = new Map();
  function villageNode(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (villageNodeCache.has(key)) return villageNodeCache.get(key);
    const head = villageHead(vcx, vcy);
    let v = null;
    if (head) {
      const origin = vcx === 0 && vcy === 0;
      const layout = head.kind === "city"
        ? (origin ? 0 : hash2i(vcx, vcy, S ^ 0x5fff) % 3)
        : hash2i(vcx, vcy, S ^ 0x5f01) % 3;
      v = { x: head.x, y: head.y, kind: head.kind, name: head.name, layout,
            R: head.kind === "city" ? head.R : 17 };
    }
    villageNodeCache.set(key, v);
    return v;
  }
  // ---- bank networks over the ROAD WEB -------------------------------------
  // The bank fiction follows the ROADS the player actually sees: EVERY
  // settlement joined by the drawn road web shares one bank — long-haul
  // trunk roads and sea-overpass decks carry the bank just like village
  // lanes (a road is a road; if you can walk it, the coin wagons can too).
  // Only a settlement no road chain reaches at all (Keolwulfduun across its
  // shallow strait — terrain-fordable, but no road goes there) runs its own
  // bank. roadNetId floods the REAL road graph (roadSelection edges, both
  // directions — selection is asymmetric) with a settlement budget: small
  // components get a canonical "roadnet:<min cell>" id; blowing the budget
  // means the endless mainland web → "main".
  const ROADNET_BUDGET = 40;        // settlements — only a freak mega-web exceeds this
                                    // (it then degenerates to sharing "main")
  const roadNetCache = new Map();   // "vcx,vcy" (village cell) → net id
  const netMembersCache = new Map(); // net id → [[vcx,vcy]...] (finite nets only)
  // Longest contiguous open-water span along an edge's route (map units) —
  // debug/diagnostic only (see _edgeSeaSpans); no gameplay rule reads it any
  // more. The route is resampled every 2 map units (route points are
  // ROAD_STEP=6 apart): rivers under bridges run a few units wide, sea
  // crossings run tens.
  function edgeSeaSpan(pe) {
    if (pe._seaSpan !== undefined) return pe._seaSpan;
    let span = 0, run = 0;
    for (let i = 1; i < pe.route.length; i++) {
      const ax = pe.route[i - 1][0], ay = pe.route[i - 1][1];
      const bx2 = pe.route[i][0], by2 = pe.route[i][1];
      const len = Math.hypot(bx2 - ax, by2 - ay), n = Math.max(1, Math.ceil(len / 2));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        if (elevation(ax + (bx2 - ax) * t, ay + (by2 - ay) * t) < LAND_E) {
          run += len / n;
          if (run > span) span = run;
        } else run = 0;
      }
    }
    pe._seaSpan = span;
    return span;
  }
  function roadNetId(vcx0, vcy0) {
    const k0 = vcx0 + "," + vcy0;
    const hit = roadNetCache.get(k0);
    if (hit) return hit;
    if (!villageHead(vcx0, vcy0)) return null;
    const seen = new Map([[k0, [vcx0, vcy0]]]);
    const q = [[vcx0, vcy0]];
    const push = (cx, cy) => {
      const k = cx + "," + cy;
      if (!seen.has(k)) { seen.set(k, [cx, cy]); q.push([cx, cy]); }
    };
    let id = null;
    for (let i = 0; i < q.length && !id; i++) {
      if (seen.size > ROADNET_BUDGET) { id = "main"; break; }
      const [cx, cy] = q[i];
      // outgoing: the roads this settlement itself chose to build
      for (const pe of roadSelection(cx, cy)) {
        push(pe.a.vcx, pe.a.vcy); push(pe.b.vcx, pe.b.vcy);
      }
      // incoming: neighbours whose own selection built a road to us. Cities
      // only ever select cities (roadSelection), and villages only reach
      // ROAD_LINK_CELLS, so most of the ring is skipped without probing.
      const meKind = villageHead(cx, cy).kind;
      for (let dy = -CITY_LINK_CELLS; dy <= CITY_LINK_CELLS; dy++)
        for (let dx = -CITY_LINK_CELLS; dx <= CITY_LINK_CELLS; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (seen.has(nx + "," + ny)) continue;
          const h = villageHead(nx, ny);
          if (!h) continue;
          if (h.kind === "city" && meKind !== "city") continue;
          if (h.kind !== "city" &&
              (Math.abs(dx) > ROAD_LINK_CELLS || Math.abs(dy) > ROAD_LINK_CELLS)) continue;
          for (const pe of roadSelection(nx, ny))
            if ((pe.a.vcx === cx && pe.a.vcy === cy) ||
                (pe.b.vcx === cx && pe.b.vcy === cy)) { push(nx, ny); break; }
        }
    }
    if (!id) {
      if (seen.has("0,0")) {
        // whatever finite web holds Newhaven IS "main" — saved vaults and
        // accounts are keyed by that id, and the spawn bank must stay stable
        id = "main";
      } else {
        let mx = Infinity, my = Infinity;
        for (const [, [cx, cy]] of seen)
          if (cy < my || (cy === my && cx < mx)) { mx = cx; my = cy; }
        id = "roadnet:" + mx + "," + my;    // canonical: min member in reading order
      }
      netMembersCache.set(id, [...seen.values()]);
    }
    for (const k of seen.keys()) roadNetCache.set(k, id);
    return id;
  }
  // debug/verification: trace the road-web BFS from a cell with a custom
  // budget, returning every settlement reached and the edges that got there
  function _roadNetTrace(vcx0, vcy0, budget) {
    const seen = new Map([[vcx0 + "," + vcy0, [vcx0, vcy0, "start"]]]);
    const q = [[vcx0, vcy0]];
    for (let i = 0; i < q.length && seen.size <= budget; i++) {
      const [cx, cy] = q[i];
      const push = (nx2, ny2, via) => {
        const k = nx2 + "," + ny2;
        if (!seen.has(k)) { seen.set(k, [nx2, ny2, via]); q.push([nx2, ny2]); }
      };
      for (const pe of roadSelection(cx, cy)) {
        push(pe.a.vcx, pe.a.vcy, "out:" + cx + "," + cy);
        push(pe.b.vcx, pe.b.vcy, "out:" + cx + "," + cy);
      }
      const meKind = villageHead(cx, cy).kind;
      for (let dy = -CITY_LINK_CELLS; dy <= CITY_LINK_CELLS; dy++)
        for (let dx = -CITY_LINK_CELLS; dx <= CITY_LINK_CELLS; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (seen.has(nx + "," + ny)) continue;
          const h = villageHead(nx, ny);
          if (!h) continue;
          if (h.kind === "city" && meKind !== "city") continue;
          if (h.kind !== "city" &&
              (Math.abs(dx) > ROAD_LINK_CELLS || Math.abs(dy) > ROAD_LINK_CELLS)) continue;
          for (const pe of roadSelection(nx, ny))
            if ((pe.a.vcx === cx && pe.a.vcy === cy) ||
                (pe.b.vcx === cx && pe.b.vcy === cy)) { push(nx, ny, "in:" + cx + "," + cy); break; }
        }
    }
    return [...seen.values()].map(([cx, cy, via]) => {
      const h = villageHead(cx, cy);
      return { cell: [cx, cy], name: h && h.name, kind: h && h.kind, via };
    });
  }
  // debug/verification: a world's full name allocation — settlements and
  // registry-named POIs with their cells, for uniqueness/parity checks
  function _zoneNameDump(wx, wy) {
    const reg = zonePoiPass(wx, wy);
    return {
      settlements: [...reg.vNames.entries()],
      pois: [...reg.pNames.entries()],
    };
  }
  // debug/verification: the selected edges of a settlement with their
  // longest contiguous water spans (map units)
  function _edgeSeaSpans(vcx, vcy) {
    const nm = (cx, cy) => ((villageHead(cx, cy) || {}).name || "?") + "@" + cx + "," + cy;
    return roadSelection(vcx, vcy).map(pe => ({
      a: nm(pe.a.vcx, pe.a.vcy), b: nm(pe.b.vcx, pe.b.vcy),
      span: Math.round(edgeSeaSpan(pe) * 10) / 10,
    }));
  }
  // members of a finite net, re-derivable from the id alone (a saved net id
  // from an earlier session recomputes its component from the canonical cell)
  function ensureRoadNet(net) {
    const mm = /^roadnet:(-?\d+),(-?\d+)$/.exec(net);
    if (mm && !netMembersCache.has(net)) roadNetId(+mm[1], +mm[2]);
    return netMembersCache.get(net) || null;
  }
  function netMemberList(net) {
    const cells = ensureRoadNet(net);
    if (!cells) return null;
    return cells
      .slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]) // reading order: stable naming
      .map(([cx, cy]) => {
        const h = villageHead(cx, cy);
        return { vcx: cx, vcy: cy, x: h.x * 2, y: h.y * 2, name: h.name, kind: h.kind };
      });
  }
  // Bank network for an arbitrary GAME-tile position (what a chest resolves
  // to): the road component of the NEAREST settlement on the same terrain
  // component. Nothing settled within reach → the terrain-flood id itself, a
  // free unstaffed hermit vault (uninhabited isles keep their own vaults).
  const NEAR_SETTLE_CELLS = 6;
  function bankNetAt(gx, gy) {
    const terr = bankNetId(gx, gy);
    const mx = gx * 0.5, my = gy * 0.5;
    const c0x = Math.floor(mx / VCELL), c0y = Math.floor(my / VCELL);
    let best = null, bd = Infinity, bestR = Infinity;
    for (let r = 0; r <= NEAR_SETTLE_CELLS; r++) {
      if (best && r > bestR + 1) break;  // a farther ring can't beat the found one
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const h = villageHead(c0x + dx, c0y + dy);
          if (!h) continue;
          if (bankNetId(h.x * 2, h.y * 2) !== terr) continue; // across deep water
          const d2 = (h.x - mx) * (h.x - mx) + (h.y - my) * (h.y - my);
          if (d2 < bd) { bd = d2; best = [c0x + dx, c0y + dy]; bestR = r; }
        }
    }
    if (!best) return terr;
    return roadNetId(best[0], best[1]) || terr;
  }
  // ---- bank MAIN BRANCHES ---------------------------------------------------
  // A network with at least one CITY has a main branch there: a grand
  // 3-storey hall, and the whole network is named after that city ("Bank of
  // Newhaven"). Newhaven is always the main branch of its own network.
  // Village-only networks have no main branch (bankNetInfo still names them);
  // hermit ids ("isle:*") have nothing at all.
  const mainBranchCache = new Map(); // net id → { x, y, vcx, vcy, name } | null
  function mainBranchFor(net) {
    if (!net) return null;
    let hit = mainBranchCache.get(net);
    if (hit !== undefined) return hit;
    const branchOf = (vcx, vcy) => {
      const h = villageHead(vcx, vcy);
      return { x: h.x * 2, y: h.y * 2, vcx, vcy, name: h.name };
    };
    let found = null;
    if (net === "main") {
      // Newhaven anchors the endless web; in a freak world where the origin
      // city sits on a small pocket, spiral for the first city that IS on it
      if (roadNetId(0, 0) === "main") found = branchOf(0, 0);
      else outer: for (let r = 0; r <= 10; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const h = villageHead(dx, dy);
            if (!h || h.kind !== "city") continue;
            if (roadNetId(dx, dy) !== "main") continue;
            found = branchOf(dx, dy);
            break outer;
          }
    } else {
      const members = ensureRoadNet(net);
      if (members) {
        let bx = null, by = null;
        for (const [cx, cy] of members) {
          const h = villageHead(cx, cy);
          if (!h || h.kind !== "city") continue;
          if (cx === 0 && cy === 0) { bx = 0; by = 0; break; } // Newhaven's guarantee
          if (bx === null || cy < by || (cy === by && cx < bx)) { bx = cx; by = cy; }
        }
        if (bx !== null) found = branchOf(bx, by);
      }
    }
    mainBranchCache.set(net, found);
    return found;
  }
  // Display + signup info for a network, or null for a hermit vault:
  //   { title, branch|null, members|null }
  // City nets: "Bank of Newhaven". Tiny village-only webs: "Bank of Braadford
  // and Hildford" / "Bank of A, B, and C" — their account is opened with the
  // clerk at any member village's bank (no main branch to travel to).
  function bankNetInfo(net) {
    if (!net) return null;
    const branch = mainBranchFor(net);
    if (branch) return { title: "Bank of " + branch.name, branch, members: netMemberList(net) };
    const members = netMemberList(net);
    if (!members || !members.length) return null;
    const names = members.map(m => m.name).sort(); // alphabetical: "Braadford and Hildford"
    const title = "Bank of " + (names.length === 1 ? names[0]
      : names.length === 2 ? names[0] + " and " + names[1]
      : names.slice(0, 2).join(", ") + ", and " + names[2]);
    return { title, branch: null, members };
  }
  function villageInfo(vcx, vcy) {
    const key = vcx + "," + vcy;
    if (villageCache.has(key)) return villageCache.get(key);
    let v = null;
    const head = villageHead(vcx, vcy);
    const kind = head ? head.kind : null;
    const x = head ? head.x : 0, y = head ? head.y : 0;
    const R = head ? head.R : 0, name = head ? head.name : "";
    if (kind) {
      const origin = vcx === 0 && vcy === 0;
      const buildings = []; // in map coords (x/y = top-left corner)
      const stoneBias = 0.25 + rand2(vcx, vcy, S ^ 0x5aef) * 0.55;
      // Biome-based settlement character: environment shapes architecture materials
      const vBiome = biomeAtTile(x, y);
      const vIsDesert = [B.DESERT, B.REDDESERT, B.BADLANDS, B.CANYON, B.SALT, B.STEPPE].includes(vBiome);
      const vIsForest = [B.FOREST, B.JUNGLE, B.BAMBOO, B.CHERRY, B.MUSHROOM].includes(vBiome);
      const vIsCold   = [B.TUNDRA, B.SNOW, B.GLACIER, B.TAIGA].includes(vBiome);
      const adjStoneBias = vIsDesert ? Math.min(0.95, stoneBias + 0.35)
        : vIsForest ? Math.max(0.05, stoneBias - 0.20)
        : vIsCold   ? Math.min(0.85, stoneBias + 0.10)
        : stoneBias;
      let layout = 0, wall = false, keep = false, well = true, field = null;
      let cityStreets = []; // secondary road network (map-coord offsets from centre)
      if (kind === "city") {
        // is this city its ROAD network's MAIN BRANCH? Then one inner block
        // is given over to the grand 3-storey bank hall (kind "mainbank").
        // roadNetId/mainBranchFor run on villageHead/villageNode + the road
        // planner only — they never re-enter villageInfo, so no recursion.
        const mb = mainBranchFor(roadNetId(vcx, vcy));
        const isMainBranch = !!mb && mb.vcx === vcx && mb.vcy === vcy;
        layout = origin ? 0 : hash2i(vcx, vcy, S ^ 0x5fff) % 3;
        wall = origin ? true : layout !== 1 && rand2(vcx, vcy, S ^ 0x5eee) < 0.62;
        keep = !origin && rand2(vcx, vcy, S ^ 0x5abc) < 0.32;
        well = !keep;
        if (keep) {
          const kw = 8 + hash2i(vcx, vcy, S ^ 0x5b01) % 3;
          buildings.push({ x: x - (kw >> 1), y: y - (kw >> 1), w: kw, h: kw, stone: true, stoneDoor: true, kind: "keep" });
        }
        // Block-grid street network (evolving-city-generation style):
        // streets at i*streetStep; buildings fill the blocks BETWEEN streets
        // at (i+0.5)*streetStep so streets and buildings never overlap.
        const streetStep = 8; // spacing between parallel streets (map coords)
        const halfStep   = streetStep >> 1; // 4 map coords — offset to block centre
        const g0 = Math.max(2, Math.floor((R - halfStep) / streetStep));
        const sizeInner = 3 + hash2i(vcx, vcy, S ^ 0x5b02) % 2; // 3-4 map units
        const sizeOuter = 2 + hash2i(vcx, vcy, S ^ 0x5b03) % 2; // 2-3 map units
        // Secondary streets at non-zero integer multiples of streetStep
        for (let i = -g0; i <= g0; i++) {
          if (i !== 0) {
            cityStreets.push({ ox: i * streetStep });
            cityStreets.push({ oy: i * streetStep });
          }
        }
        // Buildings in blocks between streets; gx2/gy2 index the LEFT/TOP street
        // of each block, block centre = (gx2+0.5)*streetStep from city centre.
        for (let gy2 = -g0; gy2 < g0; gy2++) {
          for (let gx2 = -g0; gx2 < g0; gx2++) {
            const bCx = gx2 * streetStep + halfStep; // x offset (map coords)
            const bCy = gy2 * streetStep + halfStep; // y offset (map coords)
            if (isMainBranch && gx2 === 1 && gy2 === 1) {
              // the main branch bank hall claims this whole block — always
              // built, clear of the keep at the centre and of the cross roads
              buildings.push({ x: x + bCx - 3, y: y + bCy - 3, w: 7, h: 7,
                stone: true, stoneDoor: true, kind: "mainbank" });
              continue;
            }
            const blockDist = Math.max(Math.abs(bCx), Math.abs(bCy)) / streetStep;
            const isInner = blockDist < 1;
            const isMid   = blockDist < 2;
            const blockDensity = isInner ? 0.95 : isMid ? 0.78 : 0.52;
            if (rand2(vcx * 31 + gx2, vcy * 37 + gy2, S ^ 0x5777) > blockDensity) continue;
            const bSize = isInner ? sizeInner : sizeOuter;
            const bw = bSize + hash2i(vcx + gx2, vcy + gy2, S ^ 0x5888) % 3;
            const bh = bSize + hash2i(vcx - gx2, vcy - gy2, S ^ 0x5999) % 3;
            const offX = Math.floor(rand2(gx2, gy2, S ^ (vcx * 131 + vcy)) * 2) - 1;
            const offY = Math.floor(rand2(gy2, gx2, S ^ (vcy * 131 + vcx)) * 2) - 1;
            buildings.push({
              x: x + bCx + offX - (bw >> 1),
              y: y + bCy + offY - (bh >> 1),
              w: bw, h: bh,
              stone: isInner || rand2(vcx + gx2 * 13, vcy + gy2 * 29, S ^ 0x5bbb) < adjStoneBias,
            });
          }
        }
      } else {
        layout = hash2i(vcx, vcy, S ^ 0x5f01) % 3;
        well = rand2(vcx, vcy, S ^ 0x5f03) < 0.75;
        const theta = rand2(vcx, vcy, S ^ 0x5f02) * Math.PI;
        const n = 3 + (hash2i(vcx, vcy, S ^ 0x5666) % 5);
        for (let i = 0; i < n; i++) {
          const bw = 3 + (hash2i(vcx + i, vcy - i, S ^ 0x5999) % 3);
          const bh = 3 + (hash2i(vcx - i, vcy + i, S ^ 0x5aaa) % 3);
          let bx2, by2;
          if (layout === 1) {
            const tt = (i - (n - 1) / 2) * 8;
            const side = (i % 2 ? 1 : -1) * (3 + rand2(vcx, vcy * 3 + i, S ^ 0x5f04) * 2);
            bx2 = x + Math.round(Math.cos(theta) * tt - Math.sin(theta) * side);
            by2 = y + Math.round(Math.sin(theta) * tt + Math.cos(theta) * side);
          } else if (layout === 2) {
            const ang = rand2(vcx * 3 + i, vcy, S ^ 0x5f05) * Math.PI * 2;
            const dist = 4 + rand2(vcx, vcy * 5 + i, S ^ 0x5f06) * 11;
            bx2 = x + Math.round(Math.cos(ang) * dist);
            by2 = y + Math.round(Math.sin(ang) * dist);
          } else {
            const ang = (i / n) * Math.PI * 2 + (rand2(vcx * 7 + i, vcy, S ^ 0x5777) - 0.5);
            const dist = 6 + rand2(vcx, vcy * 7 + i, S ^ 0x5888) * 8;
            bx2 = x + Math.round(Math.cos(ang) * dist);
            by2 = y + Math.round(Math.sin(ang) * dist);
          }
          buildings.push({ x: bx2 - (bw >> 1), y: by2 - (bh >> 1), w: bw, h: bh,
            stone: rand2(vcx + i * 13, vcy + i * 29, S ^ 0x5bbb) < adjStoneBias });
        }
        if (rand2(vcx, vcy, S ^ 0x5f07) < 0.45)
          field = { x: x + 8 + hash2i(vcx, vcy, S ^ 0x5f08) % 5,
                    y: y - 14 + hash2i(vcx, vcy, S ^ 0x5f09) % 6,
                    w: 6 + hash2i(vcx, vcy, S ^ 0x5f0a) % 4,
                    h: 4 + hash2i(vcx, vcy, S ^ 0x5f0b) % 3 };
      }
      // assign stations & traders to buildings (game-specific, not in Map.html)
      const jobs = [];
      if (kind === "city") {
        jobs.push(...CITY_ESSENTIALS);
        jobs.splice(1, 0, "trader");
        if (!origin) jobs.push("trader");
        // remaining buildings walk the artisan roster from a per-city offset,
        // so different cities carry different trades and all of them exist
        const rot = hash2i(vcx, vcy, S ^ 0x5e07) % CITY_ARTISANS.length;
        for (let i = 0; i < CITY_ARTISANS.length; i++)
          jobs.push(CITY_ARTISANS[(rot + i) % CITY_ARTISANS.length]);
      } else {
        jobs.push("bank", "trader",
          rand2(vcx, vcy, S ^ 0x5ccc) < 0.5 ? "anvil" : "furnace",
          "campfire",
          CITY_ARTISANS[hash2i(vcx, vcy, S ^ 0x5e06) % CITY_ARTISANS.length]);
      }
      // scale from map coords to game tiles (2x), keeping x0/y0 for stampBuilding
      const gBuildings = buildings.map((b, i) => ({
        ...b, x0: b.x * 2, y0: b.y * 2, w: Math.max(7, b.w * 2), h: Math.max(7, b.h * 2),
        job: jobs[i] || null,
      }));
      // the main branch hall owns the city's "bank" job — swap whatever the
      // index-based walk dealt it with the roster's bank holder, so the keep
      // (or first block house) that used to hold the chest gets that job back
      if (kind === "city") {
        const gi = gBuildings.findIndex(b2 => b2.kind === "mainbank");
        if (gi >= 0) {
          const bi = gBuildings.findIndex(b2 => b2.job === "bank");
          if (bi >= 0 && bi !== gi) gBuildings[bi].job = gBuildings[gi].job;
          gBuildings[gi].job = "bank";
        }
      }
      // every city trade building hosts a SECOND trade from further down the
      // rotation — a 12-16 building city then carries ~14 artisan stations,
      // so every station type reliably exists within a few cities' reach
      if (kind === "city") {
        let next = gBuildings.length;
        for (const b of gBuildings) {
          if (!b.job || b.job === "trader" || b.job === "bank") continue;
          if (b.w * b.h >= 49 && jobs[next]) b.job2 = jobs[next++];
        }
      }
      v = { x: x * 2, y: y * 2, name, kind, wall, keep, layout, well, field, origin,
        zone: head.zone, // the 15000² zone block this settlement is tied to
        R: (kind === "city" ? R : 17) * 2,
        buildings: gBuildings,
        streets: cityStreets.length ? cityStreets.map(st => ({
          ox: st.ox !== undefined ? st.ox * 2 : undefined,
          oy: st.oy !== undefined ? st.oy * 2 : undefined,
        })) : null };
    }
    villageCache.set(key, v);
    return v;
  }
  function villagesNear(tx0, ty0, tx1, ty1, pad) {
    const out = [];
    const c0x = Math.floor((tx0 - pad) / VCELL), c1x = Math.floor((tx1 + pad) / VCELL);
    const c0y = Math.floor((ty0 - pad) / VCELL), c1y = Math.floor((ty1 + pad) / VCELL);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const v = villageInfo(cx, cy);
        if (v) out.push(v);
      }
    return out;
  }

  // ---------- points of interest (exact Map.html port) ----------
  // These biome sets match Map.html exactly for POI dispatch (differ from GRASS_LIKE_B etc.)
  const POI_GRASS  = new Set([B.GRASS, B.FARM, B.MEADOW, B.SAVANNA, B.MOOR]);
  const POI_FOREST = new Set([B.FOREST, B.JUNGLE, B.TAIGA, B.DREAM, B.MUSHROOM, B.ASH, B.BAMBOO, B.CHERRY]);
  const POI_SWAMP  = new Set([B.SWAMP, B.WETLAND, B.WILD]);
  const POI_DESERT = new Set([B.DESERT, B.BADLANDS, B.CANYON, B.STEPPE, B.REDDESERT]);
  const POI_ROCK   = new Set([B.ROCK, B.ROCKY, B.VOLCANO]);
  // NOTE: "portal" is deliberately absent — portals place on their own
  // sparse lattice (portalSite above). The freed slots went to three new
  // POI kinds: runecircle (wild runecrafting altar + essence — the mage's
  // waystation), banditcamp (tents + a stealable stash), huntercamp
  // (a hunting lodge with workbench + tanning rack).
  const POI_TABLES = {
    grass:  [["shack",.07],["farmstead",.17],["windmill",.23],["orchard",.29],
             ["vineyard",.35],["graveyard",.40],["campsite",.45],["fairyring",.49],
             ["standing",.53],["stonecircle",.57],["pond",.62],["inn",.68],
             ["shrine",.72],["apiary",.76],["wishingwell",.80],["banditcamp",.83],
             ["battlefield",.86],["statue",.885],["garden",.91],["arena",.93],
             ["observatory",.945],["manor",.965],["guild",.978],["maze",.99],
             ["ruins",1]],
    forest: [["shack",.09],["campsite",.18],["fairyring",.26],["graveyard",.32],
             ["ruins",.40],["standing",.45],["barrow",.51],["hermitage",.57],
             ["lumbercamp",.65],["pond",.71],["shrine",.76],["wizardtower",.81],
             ["huntercamp",.85],["wishingwell",.88],["statue",.905],["runecircle",.93],
             ["manor",.955],["guild",.975],["stonecircle",.99],["hotspring",1]],
    swamp:  [["shack",.13],["graveyard",.26],["ruins",.38],["standing",.46],
             ["obelisk",.54],["shrine",.61],["pond",.68],["tarpit",.76],
             ["gallows",.83],["barrow",.89],["banditcamp",.95],["manor",1]],
    desert: [["ruins",.16],["obelisk",.30],["campsite",.41],["standing",.50],
             ["banditcamp",.57],["shrine",.64],["arena",.70],["crater",.76],
             ["totem",.81],["tarpit",.85],["geyser",.90],["barrow",.94],
             ["guild",.965],["wizardtower",1]],
    cold:   [["shack",.15],["huntercamp",.28],["standing",.38],["ruins",.48],
             ["lumbercamp",.58],["hotspring",.68],["crater",.74],["geyser",.81],
             ["beacon",.88],["barrow",.93],["runecircle",.97],["watchtower",1]],
    rock:   [["watchtower",.20],["minecamp",.40],["ruins",.52],["standing",.60],
             ["crater",.70],["hotspring",.77],["geyser",.85],["beacon",.925],
             ["observatory",.95],["shack",1]],
    ruinsb: [["ruins",.5],["statue",.68],["barrow",.82],["runecircle",1]],
    bone:   [["graveyard",.45],["ruins",.7],["barrow",.9],["banditcamp",1]],
    crystal:[["standing",.35],["stonecircle",.6],["runecircle",.85],["shrine",1]],
  };
  // detect the nearest coast direction (in map-coord units) — identical to Map.html coastDir
  function coastDirAt(x, y) {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]])
      if (elevation(x + dx * 7, y + dy * 7) < LAND_E) return [dx, dy];
    return null;
  }
  function riverNear(x, y) { return riverNearPt(x, y, 4); }
  function roadNear(x, y)  { return roadNearPt(x, y, 5); }

  const GUILD_NAMES = ["Warriors' Guild","Wizards' Guild","Rangers' Guild",
    "Crafting Guild","Mining Guild","Fishing Guild","Cooking Guild",
    "Woodcutting Guild","Smiths' Guild","Alchemists' Guild"];
  const POI_SUFFIX = {
    manor: " Manor", fishvillage: "", lighthouse: " Lighthouse",
    watermill: " Mill", windmill: " Windmill", farmstead: " Farm",
    orchard: " Orchard", graveyard: " Graveyard", pond: " Pond",
    shrine: " Shrine", ruins: " Ruins", standing: " Stone",
    obelisk: " Obelisk", wizardtower: " Tower", watchtower: " Outpost",
    minecamp: " Mine", maze: " Maze", lumbercamp: " Lumberyard",
    battlefield: " Battlefield", arena: " Arena", totem: " Totem",
    apiary: " Apiary", crater: " Crater", hotspring: " Springs",
    statue: " Statue", portal: " Portal", garden: " Garden",
    tarpit: " Tar Pits", stonecircle: " Stone Circle", barrow: " Barrow",
    geyser: " Geyser", beacon: " Beacon", vineyard: " Vineyard",
    gallows: " Gallows", observatory: " Observatory",
    wishingwell: " Wishing Well", runecircle: " Runestones",
    banditcamp: " Bandit Camp", huntercamp: " Hunting Lodge",
  };
  const INN_ADJ = ["Rusty", "Golden", "Jolly", "Sleeping", "Wandering", "Crooked",
    "Salty", "Merry", "Hooded", "Broken"];
  const INN_NOUN = ["Anchor", "Oak", "Goblin", "Dragon", "Tankard", "Pheasant",
    "Lantern", "Kettle", "Unicorn", "Boar"];
  // ---------- ancient portals: a sparse dedicated lattice ----------
  // Portals no longer roll from the POI tables (two adjacent 30-unit cells
  // could both land one — 60 game tiles apart). They place on their own
  // coarse grid so NO TWO PORTALS generate closer than 250 map units
  // (= 500 game tiles): each 250-cell rolls one jittered candidate, and a
  // candidate survives only if no candidate in the 8 neighbouring cells
  // sits within 250 units with a lower priority hash (deterministic
  // Poisson-disk-lite; slight over-suppression, spacing guaranteed).
  const PORTAL_CELL = 250, PORTAL_MIN_D = 250;
  const portalCandCache = new Map();
  function portalCandidate(pgx, pgy) {
    const key = pgx + "," + pgy;
    if (portalCandCache.has(key)) return portalCandCache.get(key);
    let c = null;
    // a few deterministic jitter attempts to find valid ground in the cell
    for (let i = 0; i < 6 && !c; i++) {
      const x = pgx * PORTAL_CELL + 10 + Math.floor(rand2(pgx * 7 + i, pgy, S ^ 0x7a01) * (PORTAL_CELL - 20));
      const y = pgy * PORTAL_CELL + 10 + Math.floor(rand2(pgx, pgy * 7 + i, S ^ 0x7a02) * (PORTAL_CELL - 20));
      if (elevation(x, y) < LAND_E || riverNearPt(x, y, 2)) continue;
      if (tutIsleAtMap(x, y)) continue; // the isle stamps its own portal (chunks.js)
      // the Dream interior seeds nothing; door glades keep their stamp clear
      if (dreamZoneAtMap(x, y) || !dreamGateClearAt(x, y, 8)) continue;
      if (villageClearMapAt(x, y)) c = { x, y, pri: rand2(pgx, pgy, S ^ 0x7a03) };
    }
    portalCandCache.set(key, c);
    return c;
  }
  function portalSite(pgx, pgy) {
    const c = portalCandidate(pgx, pgy);
    if (!c) return null;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const o = portalCandidate(pgx + dx, pgy + dy);
        if (o && Math.hypot(o.x - c.x, o.y - c.y) < PORTAL_MIN_D &&
            (o.pri < c.pri || (o.pri === c.pri && (dx < 0 || (dx === 0 && dy < 0))))) return null;
      }
    return c;
  }

  // ---------- Dream Forest doors: waystone glades in the strange old woods ----------
  // A sparse lattice (same Poisson-lite pattern as portals) rolls one
  // candidate per 400-unit cell. True wild B.DREAM patches are vanishingly
  // rare (the weird>0.76 band barely intersects the hum/temp window), so a
  // door stands wherever an old FOREST-family wood grows strange — weirdField
  // ≥ 0.62 — with solid dry land across the glade stamp's whole footprint
  // (the stamp brings its own darkening ring of dreamwood, chunks.js, so the
  // approach reads as the forest turning toward the stone). Roughly one door
  // per few thousand tiles of weird-leaning forest: rare enough to be a
  // legend, common enough to be found. Crossing the glade's waystone is the
  // door into the shared interior (terrain.js DREAM_WORLD, gameplay/dream.js).
  // NOTE: this path is reachable from the seat probes (poiSeat/portal
  // exclusion) — it must never touch ROADS or NAMING.
  const DREAMGATE_CELL = 400;
  const DREAMGATE_B = new Set([B.FOREST, B.TAIGA, B.JUNGLE, B.CHERRY, B.MUSHROOM, B.DREAM]);
  const dreamGateCache = new Map();
  function dreamGateSite(dgx, dgy) {
    const key = dgx + "," + dgy;
    if (dreamGateCache.has(key)) return dreamGateCache.get(key);
    let c = null;
    for (let i = 0; i < 8 && !c; i++) {
      const x = dgx * DREAMGATE_CELL + 40 + Math.floor(rand2(dgx * 7 + i, dgy, S ^ 0xd201) * (DREAMGATE_CELL - 80));
      const y = dgy * DREAMGATE_CELL + 40 + Math.floor(rand2(dgx, dgy * 7 + i, S ^ 0xd202) * (DREAMGATE_CELL - 80));
      if (dreamZoneAtMap(x, y) || tutIsleAtMap(x, y)) continue;   // interior/isle never seed doors
      if (!DREAMGATE_B.has(biomeAtTile(x, y)) || weirdField(x, y) < 0.62) continue;
      let ok = true;
      // woods on every near side, dry land across the whole stamp + margin
      for (let a = 0; a < 8 && ok; a++) {
        const c15 = biomeAtTile(Math.round(x + Math.cos(a * Math.PI / 4) * 15),
                                Math.round(y + Math.sin(a * Math.PI / 4) * 15));
        if (!DREAMGATE_B.has(c15) && c15 !== B.MEADOW && c15 !== B.GRASS) ok = false;
        if (elevation(Math.round(x + Math.cos(a * Math.PI / 4) * 27),
                      Math.round(y + Math.sin(a * Math.PI / 4) * 27)) < LAND_E + 0.004) ok = false;
      }
      if (!ok || elevation(x, y) < LAND_E + 0.004) continue;
      if (riverNearPt(x, y, 28) || !villageClearMapAt(x, y)) continue;
      c = { x, y };
    }
    dreamGateCache.set(key, c);
    return c;
  }
  // every door glade in a MAP-unit rect (chunk stamping + gameplay/dream.js)
  function dreamGatesNear(x0, y0, x1, y1) {
    const out = [];
    const c0x = Math.floor(x0 / DREAMGATE_CELL), c1x = Math.floor(x1 / DREAMGATE_CELL);
    const c0y = Math.floor(y0 / DREAMGATE_CELL), c1y = Math.floor(y1 / DREAMGATE_CELL);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const g = dreamGateSite(cx, cy);
        if (g && g.x >= x0 && g.x <= x1 && g.y >= y0 && g.y <= y1) out.push(g);
      }
    return out;
  }
  // clear of every door glade's stamp (+pad map units)? POIs/portals must not
  // collide with the standardized clearing
  function dreamGateClearAt(x, y, pad) {
    const r = 26 + (pad || 8);
    const c0x = Math.floor((x - r) / DREAMGATE_CELL), c1x = Math.floor((x + r) / DREAMGATE_CELL);
    const c0y = Math.floor((y - r) / DREAMGATE_CELL), c1y = Math.floor((y + r) / DREAMGATE_CELL);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const g = dreamGateSite(cx, cy);
        if (g && Math.hypot(g.x - x, g.y - y) < r) return false;
      }
    return true;
  }

  // Nameless POI probe: existence, anchor, RAW type and coast direction —
  // everything but the display name. The world name registry enumerates a
  // whole world of these (62,500 cells), so this path must never touch
  // naming or ROADS: the inn→shack demotion (a roadNear test between two
  // FLAVOUR types that draw no pool name) stays lazy in poiInfo.
  const poiSeatCache = new Map();
  function poiSeat(pcx, pcy) {
    const key = pcx + "," + pcy;
    if (poiSeatCache.has(key)) return poiSeatCache.get(key);
    let seat = null;
    // the portal lattice overrides the cell's ordinary roll: a surviving
    // portal site landing inside THIS cell IS the cell's POI
    const px0 = pcx * PCELL, py0 = pcy * PCELL;
    outer: for (const pgy of new Set([Math.floor(py0 / PORTAL_CELL), Math.floor((py0 + PCELL - 1) / PORTAL_CELL)]))
      for (const pgx of new Set([Math.floor(px0 / PORTAL_CELL), Math.floor((px0 + PCELL - 1) / PORTAL_CELL)])) {
        const site = portalSite(pgx, pgy);
        if (site && Math.floor(site.x / PCELL) === pcx && Math.floor(site.y / PCELL) === pcy) {
          seat = { x: site.x, y: site.y, rawType: "portal", dir: null };
          break outer;
        }
      }
    if (!seat) {
      const x = pcx * PCELL + 5 + Math.floor(rand2(pcx, pcy, S ^ 0x9101) * (PCELL - 10));
      const y = pcy * PCELL + 5 + Math.floor(rand2(pcx, pcy, S ^ 0x9102) * (PCELL - 10));
      const e = elevation(x, y);
      if (rand2(pcx, pcy, S ^ 0x9103) < 0.30 + civField(x, y) * 0.30 &&
          e >= LAND_E && !riverNearPt(x, y, 2) && villageClearMapAt(x, y) &&
          !tutIsleAtMap(x, y) && // the tutorial isle is hand-built (terrain.js)
          !dreamZoneAtMap(x, y) && dreamGateClearAt(x, y, 8)) { // so is the Dream interior + its door glades
        const b = biomeAtTile(x, y);
        const pick = rand2(pcx, pcy, S ^ 0x9104);
        const pick2 = rand2(pcx, pcy, S ^ 0x9109);
        const cd = coastDirAt(x, y);
        let type = null;
        if (cd && e < 0.53 && pick < 0.28) type = "fishvillage";
        else if (cd && e < 0.53 && pick < 0.36) type = "lighthouse";
        else if (cd && e < 0.53 && pick < 0.42) type = "shipwreck";
        else if (pick < 0.44 && riverNear(x, y) &&
                 (POI_GRASS.has(b) || b === B.FOREST)) type = "watermill";
        else {
          const tbl = POI_GRASS.has(b) ? POI_TABLES.grass :
            POI_FOREST.has(b) ? POI_TABLES.forest :
            POI_SWAMP.has(b) ? POI_TABLES.swamp :
            POI_DESERT.has(b) ? POI_TABLES.desert :
            (b === B.TUNDRA || b === B.SNOW || b === B.GLACIER) ? POI_TABLES.cold :
            b === B.CRYSTAL ? POI_TABLES.crystal :
            POI_ROCK.has(b) ? POI_TABLES.rock :
            b === B.RUINSB ? POI_TABLES.ruinsb :
            b === B.BONE ? POI_TABLES.bone :
            b === B.SAND ? (cd ? [["fishvillage",1]] : [["ruins",1]]) : null;
          if (tbl) for (const [t2, w] of tbl) { if (pick2 < w) { type = t2; break; } }
        }
        if (type) seat = { x, y, rawType: type, dir: cd };
      }
    }
    poiSeatCache.set(key, seat);
    return seat;
  }
  const poiCache = new Map();
  function poiInfo(pcx, pcy) {
    const key = pcx + "," + pcy;
    if (poiCache.has(key)) return poiCache.get(key);
    let p = null;
    const seat = poiSeat(pcx, pcy);
    if (seat) {
      let type = seat.rawType;
      // lazy demotion: an inn nowhere near a road is just somebody's shack
      // (both are flavour venues, so the name registry is unaffected)
      if (type === "inn" && !roadNear(seat.x, seat.y)) type = "shack";
      const PERSON_SUF = ["","ric","win","bert","mund","a","eth","gar","ina","or"];
      const person = NAME_A[hash2i(pcx, pcy, S ^ 0x910c) % NAME_A.length] +
                     PERSON_SUF[hash2i(pcx, pcy, S ^ 0x9110) % PERSON_SUF.length];
      let name;
      if (type === "guild")
        name = GUILD_NAMES[hash2i(pcx, pcy, S ^ 0x9108) % GUILD_NAMES.length];
      else if (type === "inn")
        name = "The " + INN_ADJ[hash2i(pcx, pcy, S ^ 0x910a) % INN_ADJ.length] +
               " " + INN_NOUN[hash2i(pcx, pcy, S ^ 0x910b) % INN_NOUN.length];
      else if (type === "shack") name = "Old " + person + "'s Shack";
      else if (type === "campsite") name = person + "'s Camp";
      else if (type === "hermitage") name = person + "'s Hermitage";
      else if (type === "shipwreck") {
        const SHIP_NOUN = ["Gull","Maiden","Serpent","Pearl","Marlin",
                           "Tempest","Rose","Fortune","Petrel","Wanderer"];
        name = "Wreck of the " +
               INN_ADJ[hash2i(pcx, pcy, S ^ 0x9112) % INN_ADJ.length] + " " +
               SHIP_NOUN[hash2i(pcx, pcy, S ^ 0x9113) % SHIP_NOUN.length];
      }
      else if (type === "fairyring")
        name = "Fairy Ring " + "ABCD"[hash2i(pcx, pcy, S ^ 0x910d) % 4] +
               "IJKL"[hash2i(pcx, pcy, S ^ 0x910e) % 4] +
               "PQRS"[hash2i(pcx, pcy, S ^ 0x910f) % 4];
      else name = zonePoiBase(pcx, pcy, seat) +
        (type === "portal" ? " Portal" : (POI_SUFFIX[type] || ""));
      const [wwx, wwy] = zoneOfMap(seat.x, seat.y);
      p = { x: seat.x, y: seat.y, type, name, dir: seat.dir, zone: wwx + "," + wwy };
    }
    poiCache.set(key, p);
    return p;
  }

  // ---------- wilderness icons ----------
  const iconCache = new Map();
  function wildIcon(icx, icy) {
    const key = icx + "," + icy;
    if (iconCache.has(key)) return iconCache.get(key);
    let icon = null;
    const x = icx * ICELL + 8 + Math.floor(rand2(icx, icy, S ^ 0x1c02) * (ICELL - 16));
    const y = icy * ICELL + 8 + Math.floor(rand2(icx, icy, S ^ 0x1c03) * (ICELL - 16));
    // no wilderness clusters/camps on the hand-built tutorial isle (terrain.js)
    if (!tutIsleAtMap(x, y) && rand2(icx, icy, S ^ 0x1c01) < 0.2 + civField(x, y) * 0.6) {
      const b = biomeAtTile(x, y);
      const pick = rand2(icx, icy, S ^ 0x1c04);
      let type = null;
      if (WATER_LIKE_B.has(b)) type = "fish";
      else if (ROCK_LIKE_B.has(b)) type = pick < 0.8 ? "mine" : "camp";
      else if (FOREST_LIKE_B.has(b)) type = pick < 0.75 ? "tree" : "camp";
      else if (DESERT_LIKE_B.has(b)) type = pick < 0.7 ? "camp" : "mine";
      else type = "camp";
      let clear = true;
      for (const v of villagesNear(x, y, x, y, 42)) {
        const dx = x - v.x, dy = y - v.y, rr = v.R + 8;
        if (dx * dx + dy * dy < rr * rr) { clear = false; break; }
      }
      if (clear) icon = { x, y, type };
    }
    iconCache.set(key, icon);
    return icon;
  }

  // biome families
  const GRASS_LIKE_B = new Set([B.GRASS, B.FARM, B.MEADOW, B.SAVANNA, B.MOOR, B.STEPPE, B.OASIS]);
  const FOREST_LIKE_B = new Set([B.FOREST, B.JUNGLE, B.TAIGA, B.DREAM, B.MUSHROOM, B.ASH, B.BAMBOO, B.CHERRY]);
  const DESERT_LIKE_B = new Set([B.DESERT, B.BADLANDS, B.CANYON, B.REDDESERT, B.SALT]);
  const ROCK_LIKE_B = new Set([B.ROCK, B.ROCKY, B.VOLCANO, B.SNOW, B.CRYSTAL]);
  const SWAMP_LIKE_B = new Set([B.SWAMP, B.WETLAND, B.WILD]);
  const WATER_LIKE_B = new Set([B.WATER, B.DEEP, B.REEF]);

  // Which biomes each husbandry animal spawns in (chunks.js filters the herd roll
  // by the chunk's biome) — so camels roam deserts, alpacas the cold highlands,
  // waterfowl the wetlands, etc., instead of every animal in every field.
  const ANIMAL_BIOME = {
    chicken:  new Set([B.GRASS, B.FARM, B.MEADOW]),
    cow:      new Set([B.GRASS, B.FARM, B.MEADOW]),
    pig:      new Set([B.GRASS, B.FARM, B.MEADOW, B.FOREST]),
    rabbit:   new Set([B.GRASS, B.FARM, B.MEADOW, B.FOREST]),
    quail:    new Set([B.GRASS, B.FARM, B.MEADOW, B.STEPPE]),
    duck:     new Set([B.GRASS, B.FARM, B.MEADOW, B.WETLAND, B.SWAMP]),
    goose:    new Set([B.GRASS, B.FARM, B.MEADOW, B.WETLAND, B.TUNDRA]),
    turkey:   new Set([B.GRASS, B.FARM, B.FOREST, B.SAVANNA]),
    sheep:    new Set([B.GRASS, B.FARM, B.MEADOW, B.MOOR, B.STEPPE]),
    goat:     new Set([B.GRASS, B.FARM, B.MEADOW, B.MOOR, B.STEPPE, B.ROCKY]),
    bee:      new Set([B.MEADOW, B.GRASS, B.FOREST, B.CHERRY, B.JUNGLE]),
    camel:    new Set([B.DESERT, B.REDDESERT, B.OASIS, B.SALT, B.CANYON, B.BADLANDS]),
    buffalo:  new Set([B.SAVANNA, B.STEPPE, B.GRASS, B.WETLAND]),
    alpaca:   new Set([B.STEPPE, B.MOOR, B.ROCKY, B.TUNDRA, B.TAIGA]),
    // exotics (dangerous, tendable) — kept to their wilds
    griffon:  new Set([B.ROCK, B.ROCKY, B.VOLCANO, B.CANYON]),
    aurochs:  new Set([B.STEPPE, B.SAVANNA, B.TAIGA, B.FOREST]),
    wyrmling: new Set([B.VOLCANO, B.ASH, B.BADLANDS, B.CRYSTAL]),
  };

  // atlas variant — exact port of Map.html variantAt / variantCellsAt
  const RCELL = 300;
  function atlasVariantAt(tx, ty) {
    const fxR = tx / RCELL - 0.5, fyR = ty / RCELL - 0.5;
    const rcx0 = Math.floor(fxR), rcy0 = Math.floor(fyR);
    let fx = fxR - rcx0, fy = fyR - rcy0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const v = (rx, ry) => hash2i(rx, ry, S ^ 0x7a22) % 4;
    const v00 = v(rcx0, rcy0), v10 = v(rcx0 + 1, rcy0);
    const v01 = v(rcx0, rcy0 + 1), v11 = v(rcx0 + 1, rcy0 + 1);
    const r = rand2(tx, ty, S ^ 0x7a2f);
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy;
    if (r < w00) return v00;
    if (r < w00 + w10) return v10;
    if (r < w00 + w10 + w01) return v01;
    return v11;
  }

  // Selected tile column (0-indexed) per biome — one design, four colour variants
  const BIOME_ATLAS_COL = [
    2,  // 0  DEEP
    6,  // 1  WATER
    4,  // 2  SAND
    2,  // 3  GRASS
    4,  // 4  FOREST
    12, // 5  SWAMP
    0,  // 6  DESERT
    4,  // 7  ROCK
    0,  // 8  SNOW
    1,  // 9  TUNDRA
    5,  // 10 FARM
    0,  // 11 BADLANDS
    12, // 12 JUNGLE
    15, // 13 MEADOW
    1,  // 14 SAVANNA
    9,  // 15 ROCKY
    3,  // 16 LABYRINTH
    10, // 17 VOLCANO
    2,  // 18 WILD
    8,  // 19 TAIGA
    0,  // 20 OASIS
    9,  // 21 REEF
    5,  // 22 RUINSB
    0,  // 23 SALT
    10, // 24 WETLAND
    2,  // 25 CANYON
    6,  // 26 STEPPE
    13, // 27 REDDESERT
    15, // 28 MUSHROOM
    0,  // 29 BONE
    6,  // 30 DREAM
    14, // 31 ASH
    11, // 32 MOOR
    9,  // 33 GLACIER
    0,  // 34 BAMBOO
    4,  // 35 CHERRY
    5,  // 36 CRYSTAL
  ];

  // Large-scale regional personality: returns 0-5, selects biomes.png slot variant
  // PERCELL >> RCELL so whole geographic regions share the same visual identity
  const PERCELL = 700;
  function personalityAt(tx, ty) {
    const fxP = tx / PERCELL - 0.5, fyP = ty / PERCELL - 0.5;
    const pcx0 = Math.floor(fxP), pcy0 = Math.floor(fyP);
    let fx = fxP - pcx0, fy = fyP - pcy0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const v = (rx, ry) => hash2i(rx, ry, S ^ 0x9a7b) % 6;
    const v00 = v(pcx0, pcy0), v10 = v(pcx0 + 1, pcy0);
    const v01 = v(pcx0, pcy0 + 1), v11 = v(pcx0 + 1, pcy0 + 1);
    const r = rand2(tx, ty, S ^ 0x9a7f);
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy;
    if (r < w00) return v00;
    if (r < w00 + w10) return v10;
    if (r < w00 + w10 + w01) return v01;
    return v11;
  }

  function biomeGround(b, x, y) {
    const acol = BIOME_ATLAS_COL[b] ?? 0;
    // WATER biomes (Deep 0 / Sea 1 / Reef 21) get ONE fixed variant each:
    // the per-tile atlasVariantAt roll dithered open water across clashing
    // blue arts (render3d's bg_* fallback tints) and every sea/river read as
    // a checkerboard instead of a surface. Land keeps the roll — its variant
    // arts are same-design tints and the dither reads as organic texture.
    // (Literals, not WATER_BIOME_IDS — this also runs in the road worker,
    // which never loads biome-tiles.js.)
    const av = b === 0 ? 1 : b === 1 ? 0 : b === 21 ? 2 : atlasVariantAt(x, y);
    return `at_${b}_${av}_${acol}`;
  }
  // [treeDensity, treeSprOverride, rockDensity, decor: [sprite, density, blocked]]
  const BIOME_VEG = {
    [B.GRASS]: [0.02, null, 0, [["flower_white", 0.008], ["bush", 0.004, 1], ["nz_rangiora", 0.012]]],
    // the ngahere is DENSE: thick koru/kawakawa understory, mossed rocks and
    // litter underfoot (tree ferns come through the tree pool — see treeDens)
    [B.FOREST]: [0.19, null, 0, [["leaflitter", 0.024], ["mushroom", 0.014], ["fallen_log", 0.014], ["moss_rock", 0.014], ["berrybush", 0.008, 1], ["flower_blue", 0.005], ["flower_purple", 0.003], ["nz_koru", 0.032], ["nz_kawakawa", 0.026], ["nz_rangiora", 0.018], ["nz_horoeka", 0.02]]],
    [B.SWAMP]: [0.05, null, 0, [["mushroom", 0.02], ["skull", 0.003], ["moss_rock", 0.01], ["fallen_log", 0.01]]],
    [B.DESERT]: [0.004, null, 0.004, [["boulder", 0.006]]],
    [B.ROCK]: [0, null, 0.03, [["boulder", 0.03], ["rock_dead", 0.008]]],
    [B.SNOW]: [0.01, null, 0.01, [["boulder", 0.015]]],
    [B.TUNDRA]: [0.02, null, 0.004, [["boulder", 0.008]]],
    [B.FARM]: [0.002, null, 0, [["wheat_plant", 0.032], ["herb_plant", 0.008], ["haybale", 0.008, 1], ["scarecrow", 0.002, 1], ["flower_orange", 0.018], ["flower_white", 0.010]]],
    [B.BADLANDS]: [0.004, null, 0.02, [["boulder", 0.015], ["skull", 0.004]]],
    [B.JUNGLE]: [0.34, null, 0, [["mushroom", 0.012], ["bush", 0.02, 1], ["nz_koru", 0.02], ["moss_rock", 0.01], ["fallen_log", 0.008]]],
    [B.MEADOW]: [0.012, null, 0, [["flower_white", 0.03], ["flower_orange", 0.02], ["flower_blue", 0.02], ["nz_toetoe", 0.02]]],
    [B.SAVANNA]: [0.02, null, 0, [["bush", 0.01, 1]]],
    [B.ROCKY]: [0.008, null, 0.025, [["boulder", 0.025], ["nz_wharariki", 0.014]]],
    [B.LABYRINTH]: [0, null, 0, []],
    [B.VOLCANO]: [0, null, 0.03, [["boulder", 0.02], ["campfire", 0.004, 1], ["skull", 0.006]]],
    [B.WILD]: [0.02, null, 0.008, [["skull", 0.01], ["gravestone", 0.005, 1], ["rock_dead", 0.01]]],
    [B.TAIGA]:  [0.20, null, 0.004, [["boulder", 0.006], ["moss_rock", 0.01], ["fallen_log", 0.006], ["mushroom", 0.008]]],
    [B.OASIS]: [0.08, null, 0, [["flower_blue", 0.02]]],
    [B.RUINSB]: [0.008, null, 0.008, [["boulder", 0.02], ["gravestone", 0.008, 1], ["wall_wood", 0.012, 1]]],
    [B.SALT]: [0, null, 0.004, [["boulder", 0.006]]],
    [B.WETLAND]: [0.03, null, 0, [["bush", 0.01, 1], ["nz_toetoe", 0.02], ["moss_rock", 0.008], ["mushroom", 0.01]]],
    [B.CANYON]: [0.003, null, 0.02, [["boulder", 0.02]]],
    [B.STEPPE]: [0.006, null, 0.004, [["bush2", 0.01, 1], ["nz_wharariki", 0.014], ["nz_toetoe", 0.014]]],
    [B.REDDESERT]: [0.002, null, 0.015, [["boulder", 0.02], ["skull", 0.005]]],
    [B.MUSHROOM]: [0.22, ["mushroom_big", "mushroom_big2", "mush_brown", "mush_purple", "mush_amber", "mush_teal"], 0, [["mush_amber", 0.03], ["mushroom_big2", 0.03], ["mush_teal", 0.02], ["mushroom", 0.04]]],
    [B.BONE]: [0.004, null, 0, [["skull", 0.05], ["gravestone", 0.02, 1], ["boulder", 0.008]]],
    // Dream Forest wears its own trees (dreamwood-dominant pool — the twisted
    // silhouettes are the biome's signature and the interior's landmark), with
    // glowcaps and ghost-pale flora on the floor (gameplay/dream.js)
    [B.DREAM]: [0.20, ["tree_dreamwood", "tree_dreamwood", "tree_duskwood", "tree_silverleaf"], 0,
      [["flower_purple", 0.03], ["mushroom_big2", 0.02], ["forage_glowcap", 0.012], ["herb_ghostflower", 0.006], ["mushroom", 0.015]]],
    [B.ASH]: [0.18, null, 0.006, [["skull", 0.01], ["campfire", 0.002, 1]]],
    [B.MOOR]: [0.015, null, 0.006, [["flower_purple", 0.05], ["bush", 0.01, 1], ["nz_wharariki", 0.02]]],
    [B.GLACIER]: [0, null, 0.008, [["boulder", 0.02]]],
    [B.BAMBOO]: [0.30, null, 0, [["bush", 0.01, 1]]],
    [B.CHERRY]: [0.20, null, 0, [["flower_purple", 0.03], ["flower_white", 0.02]]],
    [B.CRYSTAL]: [0, null, 0.012, [["crystal_shard", 0.04], ["boulder", 0.008]]],
    [B.SAND]: [0.042, null, 0, [["seashell", 0.022], ["coral_red", 0.006], ["boulder", 0.002], ["nz_wharariki", 0.012], ["nz_toetoe", 0.012]]],
  };

  // tiers still climb away from Newhaven, with rare rich patches
  function localTierCap(x, y, count) {
    const dist = Math.max(Math.abs(x), Math.abs(y)) / CHUNK;
    let cap = 2 + dist * 1.2 + (fbm(x * 0.012, y * 0.012, S + 0x77, 2) - 0.5) * 8;
    if (rand2(x >> 5, y >> 5, S ^ 0x66) < 0.10) cap += 6 + rand2(x >> 3, y >> 3, S ^ 0x67) * 12;
    return Math.max(1, Math.min(count - 1, Math.round(cap)));
  }
  const rollTier = (cap, rng) => Math.floor(Math.pow(rng(), 2.3) * (cap + 1));

  // Map-coord view of a village, derived from the SAME villageInfo() data
  // chunks.js actually stamps into the world (previously this reimplemented
  // village/building layout from scratch — a second, independently-hashed
  // algorithm that drifted from the real one, so the map/minimap showed
  // buildings that didn't match what was actually in the game).
  const villageForMapCache = new Map();
  function villageForMap(vcx, vcy) {
    const key = `${vcx},${vcy}`;
    if (villageForMapCache.has(key)) return villageForMapCache.get(key);
    const info = villageInfo(vcx, vcy);
    let v = null;
    if (info) {
      // map coords are game tiles / 2 (see villageInfo's `gBuildings` scaling)
      const buildings = info.buildings.map(b => ({
        x: b.x0 / 2, y: b.y0 / 2, w: b.w / 2, h: b.h / 2, stone: !!b.stone, job: b.job, job2: b.job2,
        gx0: b.x0, gy0: b.y0,
      }));
      // Trader buildings get their SHOP-TYPE icon, mirroring the exact hash the
      // real shopkeeper spawn uses (chunks.js deriveNpcs) so map & game agree.
      const shopIconFor = b => {
        if (typeof SHOP_ICON === "undefined") return "store";
        if (Math.abs(b.gx0) < 70 && Math.abs(b.gy0) < 70) return SHOP_ICON.general || "store"; // origin = general store
        const KEYS = (typeof SHOP_TYPE_KEYS !== "undefined") ? SHOP_TYPE_KEYS : ["general"];
        const stype = hash2i(b.gx0, b.gy0, S ^ 0x5107) % 3 !== 0 ? "general"
          : KEYS[hash2i(b.gx0, b.gy0, S ^ 0x5108) % KEYS.length];
        return SHOP_ICON[stype] || "store";
      };
      const bc = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const icons = [];
      for (const b of buildings) {
        if (b.job === "trader") icons.push({ ...bc(b), type: shopIconFor(b) });
        else if (b.job && typeof STATION_ICON !== "undefined" && STATION_ICON[b.job])
          icons.push({ ...bc(b), type: STATION_ICON[b.job] });
      }
      const x = info.x / 2, y = info.y / 2;
      if (rand2(vcx, vcy, S ^ 0x5ddd) < 0.5) icons.push({ x: x + 4, y: y - 3, type: "quest" });
      icons.push({ x: x - 3, y: y + 3, type: "water" });
      v = { x, y, name: info.name, kind: info.kind, buildings, icons,
            layout: info.layout, wall: info.wall, keep: info.keep, well: info.well, field: info.field,
            R: info.R / 2, r: info.kind === 'city' ? info.R / 2 + 7 : 17 };
    }
    villageForMapCache.set(key, v);
    return v;
  }
  function villagesNearForMap(tx0, ty0, tx1, ty1, pad) {
    const out = [];
    const c0x=Math.floor((tx0-pad)/VCELL), c1x=Math.floor((tx1+pad)/VCELL);
    const c0y=Math.floor((ty0-pad)/VCELL), c1y=Math.floor((ty1+pad)/VCELL);
    for (let cy2=c0y; cy2<=c1y; cy2++)
      for (let cx2=c0x; cx2<=c1x; cx2++) { const v=villageForMap(cx2,cy2); if(v) out.push(v); }
    return out;
  }
  // ---- zoomed-out macro-tile PIXELS (shared main thread + road worker) ----
  // The exact colour pipeline of the world map's macro tiles as pure math on
  // a plain buffer: js/world/map.js renderMacro AND the worker's "macro"
  // message both call this, so off-thread tiles are pixel-identical.
  function macroPixels(step, mx, my, MPX, MAP_COLORS, MAP_WATER, showIsle) {
    const MT = MPX * step;
    const bx = mx * MT, by = my * MT;
    const EG = MPX + 2;                    // margin for coastline + hillshade lookups
    const eG = new Float32Array(EG * EG);
    // Tūhura Isle is a SEPARATE map (terrain.js inTutSeal): macro tiles are
    // painted straight from terrain, so without this mask a tile straddling
    // the seal would show the isle's landmass to a sealed-out sailor. Unless
    // the VIEWER is on the isle themselves (showIsle — map.js decides from
    // the player's side, and the Bifrost cinematic pins it for its takeoff
    // bake), sample the sealed disc as flat deep sea instead — that silences
    // the pixel colour, the coastline outline test AND the hillshade in one
    // place. Seal-touching tiles are never persisted and never rendered by
    // the road worker (map.js reroutes them main-thread, like the islet
    // zone), so the two variants can share the plain cache key safely.
    const _seal = !showIsle && typeof inTutSeal === "function";
    for (let gy = 0; gy < EG; gy++)
      for (let gx = 0; gx < EG; gx++) {
        const wx = bx + (gx - 1) * step, wy = by + (gy - 1) * step;
        eG[gy * EG + gx] = _seal && inTutSeal(wx * 2, wy * 2) ? 0.335 : elevation(wx, wy);
      }
    const d = new Uint8ClampedArray(MPX * MPX * 4);
    // biome sampled once per BLOCK cell (classify + its field inputs are the
    // expensive part); coarse steps sample finer so the zoomed-out map reads
    // as terrain, not colour blocks. Water/coast/hillshade stay per-pixel.
    const BLOCK = step >= 2 ? 4 : 8;
    for (let by2 = 0; by2 < MPX; by2 += BLOCK) {
      for (let bx2 = 0; bx2 < MPX; bx2 += BLOCK) {
        const cx = Math.min(MPX - 1, bx2 + (BLOCK >> 1));
        const cy = Math.min(MPX - 1, by2 + (BLOCK >> 1));
        const gic = (cy + 1) * EG + (cx + 1);
        const ec = eG[gic];
        let blockCol = null;
        if (ec >= LAND_E) {
          const wxc = bx + cx * step, wyc = by + cy * step;
          const b = classify(ec, humidity(wxc, wyc), temperature(wxc, wyc), farmField(wxc, wyc), civField(wxc, wyc), weirdField(wxc, wyc));
          blockCol = MAP_COLORS[b];
        }
        const yEnd = Math.min(MPX, by2 + BLOCK), xEnd = Math.min(MPX, bx2 + BLOCK);
        for (let py = by2; py < yEnd; py++) {
          for (let px = bx2; px < xEnd; px++) {
            const gi = (py + 1) * EG + (px + 1);
            const e = eG[gi];
            let r, g, bl;
            if (e < LAND_E) {
              if (eG[gi + 1] >= LAND_E || eG[gi - 1] >= LAND_E || eG[gi + EG] >= LAND_E || eG[gi - EG] >= LAND_E) {
                r = 32; g = 46; bl = 68;   // coastline outline
              } else {
                const s = e < 0.34 ? MAP_WATER[0] : e < 0.41 ? MAP_WATER[1] : e < 0.45 ? MAP_WATER[2] : MAP_WATER[3];
                r = s[0]; g = s[1]; bl = s[2];
              }
            } else {
              const col = blockCol || MAP_COLORS[0];
              const sh = Math.max(-26, Math.min(26, (e - eG[gi + EG + 1]) * 260 / step));
              r = col[0] + sh; g = col[1] + sh; bl = col[2] + sh;
            }
            const o = (py * MPX + px) * 4;
            d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
          }
        }
      }
    }
    return d;
  }

  function poisNearForMap(tx0, ty0, tx1, ty1, pad) {
    const out = [];
    const c0x=Math.floor((tx0-pad)/PCELL), c1x=Math.floor((tx1+pad)/PCELL);
    const c0y=Math.floor((ty0-pad)/PCELL), c1y=Math.floor((ty1+pad)/PCELL);
    for (let cy2=c0y; cy2<=c1y; cy2++)
      for (let cx2=c0x; cx2<=c1x; cx2++) { const p=poiInfo(cx2,cy2); if(p) out.push(p); }
    return out;
  }
  function iconsNearForMap(tx0, ty0, tx1, ty1) {
    const out = [];
    for (const v of villagesNearForMap(tx0, ty0, tx1, ty1, 42))
      for (const ic of (v.icons || [])) out.push(ic);
    for (const p of poisNearForMap(tx0, ty0, tx1, ty1, 26)) {
      const IT = {
        minecamp:'mine', pond:'fish', shrine:'altar', lumbercamp:'tree',
        fishvillage:'fish', windmill:'windmill', wizardtower:'altar',
        farmstead:'workbench', inn:'range', manor:'quest', ruins:'quest',
        orchard:'orchard',
        graveyard:'quest', campsite:'quest', battlefield:'quest', arena:'quest',
        barrow:'quest', hotspring:'water', crater:'mine', obelisk:'quest',
        stonecircle:'altar', watchtower:'quest', gallows:'quest',
        shack:'quest', standing:'quest', fairyring:'quest', hermitage:'cauldron',
        totem:'quest', apiary:'garden', statue:'quest', portal:'quest',
        garden:'garden', tarpit:'water', geyser:'water', beacon:'quest',
        vineyard:'garden', wishingwell:'water', observatory:'quest',
        lighthouse:'fish', watermill:'windmill', shipwreck:'quest',
        guild:'quest', maze:'quest',
      };
      const t = IT[p.type];
      if (t) out.push({ x: p.x, y: p.y, type: t });
      // BANK-CHEST icons: exact mirrors of the chunk generator's deterministic
      // chest placements (chunks.js POI cases), so every chest shows a bank
      // icon without generating the chunk. Hash inputs are the POI centre in
      // GAME tiles (= map × 2), salts S^0x9119 (new chests) / S^0x9118 (the
      // older inn/minecamp chests); offsets are the game-tile chest offsets
      // halved into map coords. The guild house IS a bank building.
      const gx = p.x * 2, gy = p.y * 2;
      const CHEST = { manor: [1, 0, 3.5], wizardtower: [0.5, 0, 2], watchtower: [0.4, 0, 2],
        lighthouse: [0.45, 1, 1.5], campsite: [0.2, 1, 1], guild: [1, 0, 0] };
      const pc = CHEST[p.type];
      if (pc && (pc[0] >= 1 || rand2(gx, gy, S ^ 0x9119) < pc[0]))
        out.push({ x: p.x + pc[1], y: p.y + pc[2], type: "bank" });
      else if (p.type === "fishvillage" && rand2(gx, gy, S ^ 0x9119) < 0.55) {
        const cd = p.dir || [0, 1];
        out.push({ x: p.x - cd[0] * 2, y: p.y - cd[1] * 2, type: "bank" });
      } else if ((p.type === "inn" && rand2(gx, gy, S ^ 0x9118) < 0.4) ||
                 (p.type === "minecamp" && rand2(gx, gy, S ^ 0x9118) < 0.3))
        out.push({ x: p.x + 1.5, y: p.y + 1.5, type: "bank" });
    }
    // WAYSIDE bank chests (chunks.js lattice: one candidate per 192×192 GAME
    // tiles, 30% materialise). Water candidates are skipped as an openTile
    // proxy; settlement-adjacent ones are suppressed just like in the chunk.
    const w0x = Math.floor(tx0 * 2 / 192), w1x = Math.floor(tx1 * 2 / 192);
    const w0y = Math.floor(ty0 * 2 / 192), w1y = Math.floor(ty1 * 2 / 192);
    for (let wcy = w0y; wcy <= w1y; wcy++)
      for (let wcx = w0x; wcx <= w1x; wcx++) {
        if (rand2(wcx, wcy, S ^ 0xBA7C) > 0.3) continue;
        const gx = wcx * 192 + Math.floor(rand2(wcx * 3 + 1, wcy, S ^ 0xBA7D) * 192);
        const gy = wcy * 192 + Math.floor(rand2(wcy * 3 + 1, wcx, S ^ 0xBA7E) * 192);
        const mx = gx / 2, my = gy / 2;
        if (elevation(mx, my) < LAND_E) continue;
        let inTown = false;
        for (const v of villagesNear(mx, my, mx, my, 40)) {
          const dx = mx - v.x, dy = my - v.y;
          if (dx * dx + dy * dy < (v.R + 8) * (v.R + 8)) { inTown = true; break; }
        }
        if (!inTown) out.push({ x: mx, y: my, type: "bank" });
      }
    // Tūhura Isle: the tutorial's stamped bank chests + the arrival pier.
    // The stamps live in gameplay/tutorial.js in GAME tiles — halve into map
    // coords. typeof-guarded: tutorial.js evaluates after this file in the
    // bundle, but icon queries only run at draw time.
    if (typeof TUT_CONTENT !== "undefined" && typeof TUT_ISLE !== "undefined") {
      const B = TUT_ISLE.bbox;
      if (B.x1 >= tx0 && B.x0 <= tx1 && B.y1 >= ty0 && B.y0 <= ty1) {
        for (const st of TUT_CONTENT.stamps)
          if (st.node === "bank") out.push({ x: st.x / 2, y: st.y / 2, type: "bank" });
        // pier icon mid-deck along pod 14's outward radial (k=22 game tiles)
        const hp = TUT_ISLE.pods[14], ha = hp.ang * Math.PI / 180;
        out.push({ x: hp.mx + Math.cos(ha) * 11, y: hp.my + Math.sin(ha) * 11, type: "pier" });
      }
    }
    const c0x=Math.floor(tx0/ICELL), c1x=Math.floor(tx1/ICELL);
    const c0y=Math.floor(ty0/ICELL), c1y=Math.floor(ty1/ICELL);
    for (let cy2=c0y; cy2<=c1y; cy2++)
      for (let cx2=c0x; cx2<=c1x; cx2++) { const ic=wildIcon(cx2,cy2); if(ic) out.push(ic); }
    return out;
  }

  return {
    DEEP_E, GRID8, ROAD_W, gridRoute, shapePath, polyBBox, waterBody, riverTrace,
    lakeFill, lakeOutflows, riversNear, roadsNear, roadsNearCached, nearPoly, riverNearPt, riverSourceAt,
    riverAtPt, solidDoorX, riverDoors, riverFlowAt, _roadWarm, _roadCellInject, _roadCacheSize,
    roadNearPt, riverNear, roadNear, bankNetId, bankNetAt, bankNetInfo, roadNetId, mainBranchFor, _roadNetTrace, _edgeSeaSpans, zoneOf, _zoneNameDump, preloadZoneNames, genZoneNamesAsync, genZoneNamesData, _zoneNamesInject, zoneNamed, macroPixels, genName, villageInfo, villagesNear,
    poiInfo, wildIcon, atlasVariantAt, personalityAt, biomeGround, BIOME_VEG,
    dreamGateSite, dreamGatesNear, dreamGateClearAt,
    GRASS_LIKE_B, FOREST_LIKE_B, DESERT_LIKE_B, ROCK_LIKE_B, SWAMP_LIKE_B,
    WATER_LIKE_B, localTierCap, rollTier, villageForMap, villagesNearForMap,
    poisNearForMap, iconsNearForMap,
  };
}

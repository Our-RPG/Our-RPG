// ===== Taiao — nature ambience (rain / wind / ocean) =====
// Synthesized loop beds (assets/ambience/, built by tools/make_ambience.py —
// shaped noise, fully original audio) mixed live from the world's real state:
//   rain  — the weather field's precipitation, when it's falling as rain
//   wind  — geostrophic wind speed at the player
//   ocean — how much open sea (deep/ocean/reef) rings the player
// Every level eases toward its target (~1.5 s) so weather rolls in and out
// instead of switching, steps indoors muffle the lot, and the whole layer
// sits under the "Nature sounds" slider (audio.js sfxNatureVol) alongside
// the birdsong.
"use strict";

const AMBIENCE = (() => {
  const BASE = "assets/ambience/";
  // beds retired — birdsong alone carries the outdoors; the targets() math
  // below is kept for the day a bed earns its way back.
  const KEYS = [];
  const els = {};
  const cur = { rain: 0, wind: 0, ocean: 0 };
  let tgt = { rain: 0, wind: 0, ocean: 0 };
  let nextAt = 0;

  const chains = {};
  function el(k) {
    let a = els[k];
    if (!a) {
      a = els[k] = new Audio(BASE + k + ".ogg");
      a.loop = true; a.volume = 0;
      // through the nature bus: a soft fixed low-pass takes the edge off the
      // patter and the bus compressor tucks it under the birdsong layer
      chains[k] = (typeof SFX !== "undefined" && SFX.natureChain) ? SFX.natureChain(a) : null;
      if (chains[k]) SFX.natureSet(chains[k], 0, 0, k === "rain" ? 7000 : 9000);
    }
    return a;
  }

  function targets() {
    const out = { rain: 0, wind: 0, ocean: 0 };
    const w = typeof weatherNow === "function" ? weatherNow() : null;
    if (w) {
      // softened: rain sits back as a bed under the birds, never a wall
      if (w.kind === "rain") out.rain = (0.2 + 0.8 * w.precip) * 0.7;
      const kn = (typeof windKn === "function") ? windKn(w.wind)
        : Math.hypot(w.wind.x, w.wind.y) * 10;
      // ~7 kn prevailing westerly = a faint airy bed; a deep low's flank howls
      out.wind = Math.min(1, kn / 26) * (w.kind === "snow" ? 1.15 : 1);
    }
    // sea: sample a ring of tiles around the player for open-water biomes
    if (typeof world !== "undefined" && world && world.biomeAt && typeof B !== "undefined") {
      const SEA = [B.DEEP, B.WATER, B.REEF];
      let hit = 0;
      const N = 16, R = 10;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * 2 * Math.PI;
        const bx = world.biomeAt(Math.round(player.x + Math.cos(a) * R),
                                 Math.round(player.y + Math.sin(a) * R));
        if (SEA.indexOf(bx) >= 0) hit++;
      }
      out.ocean = (hit / N) * 0.9;
    }
    // four walls muffle the weather (an open doorway's worth still seeps in)
    if (world && world.insideBuilding && world.insideBuilding(player.x, player.y)) {
      out.rain *= 0.4; out.wind *= 0.3; out.ocean *= 0.3;
    }
    return out;
  }

  function tick() {
    if (typeof player === "undefined" || !player || typeof gameReady === "undefined" || !gameReady) return;
    if (now >= nextAt) { nextAt = now + 900; tgt = targets(); }
    const nv = typeof sfxNatureVol === "function" ? sfxNatureVol() : 1;
    for (const k of KEYS) {
      const want = Math.min(1, (tgt[k] || 0) * nv);
      cur[k] += (want - cur[k]) * 0.04; // ~1.5 s ease at 60 fps
      if (cur[k] < 0.004 && !els[k]) continue; // never even created: stay silent
      const a = el(k);
      if (chains[k]) SFX.natureSet(chains[k], Math.min(1, Math.max(0, cur[k])));
      else a.volume = Math.min(1, Math.max(0, cur[k]));
      if (cur[k] > 0.012 && a.paused) {
        const p = a.play();
        if (p && p.catch) p.catch(() => {}); // pre-gesture autoplay block
      } else if (cur[k] <= 0.006 && !a.paused) a.pause();
    }
  }
  return { tick };
})();

function ambienceTick() { AMBIENCE.tick(); }

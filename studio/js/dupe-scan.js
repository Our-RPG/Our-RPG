// ===== Our RPG Workshop — the dupe-direction audit =====
// gen_gaps.mjs's "needs-directions" gap only catches a monster that HONESTLY
// admits it has one sprite (MONSTERS[key].dirSpr is falsy). It misses the
// sneakier case: something that DECLARES eight directions (occupies 8 dir-
// frame slots in its atlas — every object and every character/NPC by
// construction, or a monster with dirSpr:true) but was never actually given
// distinct per-direction art, so all eight frames render the same sprite.
// That's still "needs art" — the direction slots are just silently wasted.
//
// This is the browser-side scanner (needs a live DOM + the game's sheets
// loaded, so it can't run in gen_gaps.mjs's headless vm — see --scan there,
// which drives a real headless Firefox against this same code instead).
// Reuses catalog.js probeDirectional's exact trick: render dirs [0,2,4] (a
// mirror-only west-ish facing tells nothing — south/east/north are the real
// non-mirror set), byte-compare via getImageData, retry while blank (sheets
// load lazily).
"use strict";

const DupeScan = (function () {
  const DIRS = [0, 2, 4], SZ = 24, MAX_RETRIES = 8, RETRY_MS = 200, CHUNK = 40;

  const isBlank = d => { for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false; return true; };
  const sameData = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  const nextFrame = () => new Promise(res => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => res());
    else setTimeout(res, 0);
  });

  // Probe one subject's draw() at the three non-mirror facings; resolves true
  // when every rendered facing is non-blank AND byte-identical (a dupe).
  function probeSame(draw) {
    return new Promise(resolve => {
      let tries = 0;
      const attempt = () => {
        const datas = DIRS.map(d => {
          const cv = el("canvas", { width: SZ, height: SZ });
          try { draw(cv, d); } catch (_) {}
          try { return cv.getContext("2d").getImageData(0, 0, SZ, SZ).data; } catch (_) { return null; }
        });
        const good = datas.filter(d => d && !isBlank(d));
        if (!good.length && tries < MAX_RETRIES) { tries++; setTimeout(attempt, RETRY_MS); return; }
        if (good.length < 2) { resolve(false); return; }   // only one facing ever renders → not real 8-dir art, not a dupe claim either
        resolve(good.every(d => sameData(d, good[0])));
      };
      attempt();
    });
  }

  // Every subject in the game that DECLARES eight directions, each carrying
  // its own draw(canvas, dirIndex) closure over the right provider entry.
  function subjects() {
    const out = [];
    const objP = typeof Providers !== "undefined" ? Providers.get("object") : null;
    if (objP) for (const e of objP.list()) out.push({ type: "object", key: e.key, name: e.name || e.key, draw: (cv, d) => objP.draw(cv, e, d) });

    const chP = typeof Providers !== "undefined" ? Providers.get("character") : null;
    if (chP) for (const e of chP.list()) out.push({ type: "character", key: e.key, name: e.name || e.common || e.key, draw: (cv, d) => chP.draw(cv, e, d) });

    // Monsters: only bases that DECLARE 8-direction art (dirSpr true) — a
    // monster without dirSpr is honestly single-sprite (gen_gaps.mjs already
    // flags those as "needs 8-direction art"; that's a different gap). Skip
    // _v/_baby variants (they reuse their base's directional art verbatim —
    // WESTISH mirror-only doesn't apply here since dirSpr monsters have 8
    // real mcd_ keys, not a mirrored billboard) and dedupe the (monster,biome)
    // listing entries down to one probe per base.
    const moP = typeof Providers !== "undefined" ? Providers.get("monster") : null;
    if (moP && moP.baseOf && moP.isDir) {
      const seen = new Set();
      for (const e of moP.list()) {
        const base = moP.baseOf(e.key);
        if (seen.has(base)) continue;
        seen.add(base);
        if (/(_v|_baby|_v_baby)$/.test(base)) continue;
        if (!moP.isDir({ key: base })) continue;
        const name = (moP.entry(base) || {}).name || base;
        out.push({ type: "monster", key: base, name, draw: (cv, d) => moP.draw(cv, { key: base }, d) });
      }
    }
    return out;
  }

  // DupeScan.run({ onProgress(done,total), onFound(gap) }) -> Promise<gap[]>
  async function run(opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
    const onFound = typeof opts.onFound === "function" ? opts.onFound : () => {};
    const subs = subjects();
    const gaps = [];
    let done = 0;
    onProgress(0, subs.length);
    for (let i = 0; i < subs.length; i += CHUNK) {
      const chunk = subs.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async s => {
        let dupe = false;
        try { dupe = await probeSame(s.draw); } catch (_) { dupe = false; }
        done++;
        if (dupe) {
          const gap = { subject: "gen:" + s.type + ":" + s.key, type: s.type, key: s.key, name: s.name, reason: "8 directions declared, one sprite repeated" };
          gaps.push(gap);
          onFound(gap);
        }
      }));
      onProgress(done, subs.length);
      await nextFrame();   // stay responsive — this touches thousands of entries
    }
    return gaps;
  }

  return { run };
})();

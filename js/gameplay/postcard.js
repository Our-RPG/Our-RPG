// ===== Our RPG — postcards =====
// A shareable snapshot with a caption baked in: world seed, tile coordinates
// and the nearest named place (or biome, in the wilds). Three entry points:
//   - the minimap "Postcard" button — a screenshot of wherever you're standing
//   - Play Pulse's "Export card" — a drawn summary card, no game frame needed
//   - the Bifrost crossing's arrival — a one-shot "save this crossing" keepsake
// Capture technique matches bifrost.js's snapLive(): drive render() ourselves
// then drawImage the #game canvas in the SAME task, so the WebGL drawing
// buffer is still valid without needing preserveDrawingBuffer.
"use strict";

const Postcard = (function () {
  function nearestPlace(x, y) {
    try {
      if (typeof world === "undefined" || !world.villagesNearPt) return null;
      const vs = world.villagesNearPt(x, y, 220);
      if (!vs || !vs.length) return null;
      let best = null, bd = Infinity;
      for (const v of vs) {
        if (!v || !v.name) continue;
        const d = Math.hypot(v.x - x, v.y - y);
        if (d < bd) { bd = d; best = v; }
      }
      return best ? { name: best.name, dist: bd } : null;
    } catch (e) { return null; }
  }

  function biomeLabel(x, y) {
    try {
      return (typeof world !== "undefined" && world.biomeNameAt) ? world.biomeNameAt(x, y) : null;
    } catch (e) { return null; }
  }

  function captionMeta() {
    const x = Math.round((typeof player !== "undefined" ? player.x : 0) || 0);
    const y = Math.round((typeof player !== "undefined" ? player.y : 0) || 0);
    const seed = (typeof WORLD_SEED !== "undefined") ? WORLD_SEED : 1337;
    const place = nearestPlace(x, y);
    const biome = biomeLabel(x, y);
    const where = place ? (place.dist < 6 ? place.name : `near ${place.name}`) : (biome || "the wilds");
    return {
      title: "Our RPG",
      where,
      coordsLabel: `(${x}, ${y})`,
      seedLabel: `world ${seed}`,
      dateLabel: new Date().toLocaleDateString(),
      x, y,
    };
  }

  // ---------- shared frame + caption bar, drawn onto any canvas ----------
  function drawFrame(ctx, w, h) {
    const pad = Math.max(10, Math.round(w * 0.012));
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(2, Math.round(w * 0.0035));
    ctx.strokeRect(pad / 2, pad / 2, w - pad, h - pad);
  }

  function drawCaptionBar(ctx, w, h, meta) {
    const barH = Math.max(68, Math.round(h * 0.115));
    const y0 = h - barH;
    const g = ctx.createLinearGradient(0, y0, 0, h);
    g.addColorStop(0, "rgba(10,8,16,0)");
    g.addColorStop(0.4, "rgba(10,8,16,0.82)");
    g.addColorStop(1, "rgba(10,8,16,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, barH);
    const fs1 = Math.max(14, Math.round(barH * 0.28));
    const fs2 = Math.max(10, Math.round(barH * 0.18));
    const fs3 = Math.max(9, Math.round(barH * 0.15));
    const padX = barH * 0.3;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffe97a";
    ctx.font = `bold ${fs1}px sans-serif`;
    ctx.fillText(`${meta.title} — ${meta.where}`, padX, h - barH * 0.58);
    ctx.fillStyle = "#c9c0dd";
    ctx.font = `${fs2}px sans-serif`;
    ctx.fillText(`${meta.coordsLabel} · ${meta.seedLabel} · ${meta.dateLabel}`, padX, h - barH * 0.36);
    // the quiet invitation: every postcard doubles as a working set of
    // directions, because the whole community plays the one seed
    ctx.fillStyle = "#8f86a8";
    ctx.font = `italic ${fs3}px sans-serif`;
    ctx.fillText("everyone plays this same world — a place you find is a place a friend can visit", padX, h - barH * 0.16);
  }

  function download(canvas, filename) {
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }

  function toast(msg, kind) {
    try { if (typeof log === "function") { log(msg, kind || "gold"); return; } } catch (e) {}
  }

  // ---------- world-view screenshot ----------
  function captureWorld() {
    try {
      if (typeof render === "function") render();
      const game = document.getElementById("game");
      if (!game || !game.width) { toast("Couldn't capture a postcard just now — try again in a moment.", "warn"); return; }
      const cv = document.createElement("canvas");
      cv.width = game.width; cv.height = game.height;
      const ctx = cv.getContext("2d");
      ctx.drawImage(game, 0, 0, cv.width, cv.height);
      const overlay = document.getElementById("overlay");
      if (overlay && overlay.width) ctx.drawImage(overlay, 0, 0, cv.width, cv.height);
      const meta = captionMeta();
      drawCaptionBar(ctx, cv.width, cv.height, meta);
      drawFrame(ctx, cv.width, cv.height);
      download(cv, `our-rpg-postcard-${meta.x}_${meta.y}.png`);
      toast("Postcard saved — its coordinates work in any copy of the world.");
    } catch (e) { console.error("postcard capture:", e); toast("Couldn't save a postcard this time.", "warn"); }
  }

  // ---------- Bifrost crossing keepsake ----------
  // Grabbed a beat after arrival at Newhaven (not mid-cinematic — the pillar
  // and sky are pre-rendered video/canvas layers composited in the DOM,
  // and reproducing that stack flat would mean touching the fragile recorder
  // pipeline; the arrival frame uses the same safe render()+drawImage path
  // as captureWorld() and still marks the moment honestly).
  let keepsakeCv = null;
  function captureBifrostKeepsake() {
    try {
      if (typeof render === "function") render();
      const game = document.getElementById("game");
      if (!game || !game.width) return null;
      const cv = document.createElement("canvas");
      cv.width = game.width; cv.height = game.height;
      const ctx = cv.getContext("2d");
      ctx.drawImage(game, 0, 0, cv.width, cv.height);
      const overlay = document.getElementById("overlay");
      if (overlay && overlay.width) ctx.drawImage(overlay, 0, 0, cv.width, cv.height);
      const meta = captionMeta();
      meta.title = "Our RPG — crossed the Bifrost";
      drawCaptionBar(ctx, cv.width, cv.height, meta);
      drawFrame(ctx, cv.width, cv.height);
      return cv;
    } catch (e) { console.error("bifrost keepsake:", e); return null; }
  }

  function showKeepsakeToast() {
    let el = document.getElementById("bifrostkeepsake");
    if (el) el.remove();
    el = document.createElement("div");
    el.id = "bifrostkeepsake";
    el.style.cssText = "position:absolute;right:14px;bottom:64px;z-index:60;background:#241d38;border:1px solid #6b5c8a;color:#ffe97a;padding:8px 12px;font-size:12px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4);";
    el.textContent = "🌈 Save this crossing";
    el.onclick = () => {
      if (keepsakeCv) download(keepsakeCv, "our-rpg-bifrost-crossing.png");
      el.remove();
    };
    (document.getElementById("gamecol") || document.body).appendChild(el);
    setTimeout(() => { if (el && el.parentNode) el.remove(); }, 20000);
  }

  function offerBifrostKeepsake() {
    // let the arrival scene (landShake + the crossfade to the live world) settle first
    setTimeout(() => {
      keepsakeCv = captureBifrostKeepsake();
      if (keepsakeCv) showKeepsakeToast();
    }, 650);
  }

  // ---------- exportable Play Pulse card ----------
  function renderPulseCard(report) {
    const W = 900, H = 620;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1c1626"); bg.addColorStop(1, "#100c16");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#ffe97a";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("Play Pulse", 36, 56);
    ctx.fillStyle = "#a99cc4";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${report.sessions} sessions · ${report.cellsSeen} regions roamed · observed on-device only`, 36, 80);

    const order = ["loved", "liked", "cooling", "disliked", "dropped"];
    const colr = { loved: "#7dff9a", liked: "#c6f07d", cooling: "#ffd97d", disliked: "#ff7d7d", dropped: "#ff9d7d" };
    const label = { loved: "Loved", liked: "Enjoyed", cooling: "Cooling off", disliked: "Disliked", dropped: "Tried & dropped" };
    const groups = {};
    for (const v of report.verdicts) (groups[v.verdict] = groups[v.verdict] || []).push(v);

    let y = 122, drewAny = false;
    for (const key of order) {
      const rows = (groups[key] || []).slice(0, 5);
      if (!rows.length) continue;
      drewAny = true;
      ctx.fillStyle = colr[key];
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(label[key], 36, y);
      y += 24;
      ctx.font = "13px sans-serif";
      for (const v of rows) {
        ctx.fillStyle = "#e8dcff";
        ctx.fillText(`• ${v.label}`, 52, y);
        y += 20;
      }
      y += 12;
      if (y > H - 60) break;
    }
    if (!drewAny) {
      ctx.fillStyle = "#a99cc4";
      ctx.font = "14px sans-serif";
      ctx.fillText("Not enough play observed yet.", 36, 140);
    }
    ctx.fillStyle = "#5d5478";
    ctx.font = "11px sans-serif";
    ctx.fillText(`Our RPG — world ${(typeof WORLD_SEED !== "undefined") ? WORLD_SEED : 1337} — ${new Date().toLocaleDateString()}`, 36, H - 24);
    return cv;
  }

  function exportPulseCard(report) {
    const cv = renderPulseCard(report);
    download(cv, "our-rpg-pulse-card.png");
    toast("Pulse card saved.");
  }

  function wire() {
    const btn = document.getElementById("postcardbtn");
    if (btn) btn.onclick = captureWorld;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  return { captureWorld, offerBifrostKeepsake, exportPulseCard };
})();

if (typeof window !== "undefined") window.Postcard = Postcard;

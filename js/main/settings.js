// User settings beyond audio: UI text scale + motion preference.
// Same shape as audio.js's volume settings — camelCase taiaoXxx localStorage
// keys, bound to controls in the help tab (#panel-help "Accessibility"), read
// once at boot and applied live on change.
//
// UI SCALE: css/style.css puts `zoom: var(--ui-scale, 1)` on the sidebar and
// on the DOM text overlays that share #gamecol with the canvas (#log,
// #ctxmenu, #hovertext, the modals). zoom reflows text, padding and layout
// together; the #game/#overlay canvases are deliberately outside the set so
// world rendering stays at native resolution (in-world labels are canvas-
// drawn and scale with camZoom, not with this).
//
// MOTION: reducedMotion() is the ONE global the rest of the game asks —
// bifrost.js (static crossing, no landShake), dream.js (snap the compass
// lie, no canopy zoom-ease, no white fade), render3d.js (no sheet-lightning
// strobe in storms). Default follows the OS prefers-reduced-motion signal;
// the help-tab select can force it either way.
"use strict";

function _settingNum(key, def, lo, hi) {
  let v = NaN;
  try { v = parseFloat(localStorage.getItem(key)); } catch (e) {}
  return (v >= lo && v <= hi) ? v : def;
}

let uiFontScale = _settingNum("taiaoFontScale", 1, 0.7, 2);

function applyFontScale() {
  try { document.documentElement.style.setProperty("--ui-scale", String(uiFontScale)); } catch (e) {}
}

function reducedMotion() {
  let o = null;
  try { o = localStorage.getItem("taiaoMotion"); } catch (e) {}
  if (o === "reduce") return true;
  if (o === "full") return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}

function initSettingsUi() {
  applyFontScale();
  const fs = document.getElementById("fontscale");
  if (fs) {
    fs.value = String(Math.round(uiFontScale * 100));
    fs.addEventListener("input", () => {
      uiFontScale = Math.min(2, Math.max(0.7, fs.value / 100));
      applyFontScale();
      try { localStorage.setItem("taiaoFontScale", String(uiFontScale)); } catch (e) {}
    });
  }
  const ms = document.getElementById("motionsel");
  if (ms) {
    let cur = "auto";
    try { cur = localStorage.getItem("taiaoMotion") || "auto"; } catch (e) {}
    ms.value = (cur === "reduce" || cur === "full") ? cur : "auto";
    ms.addEventListener("change", () => {
      try {
        if (ms.value === "auto") localStorage.removeItem("taiaoMotion");
        else localStorage.setItem("taiaoMotion", ms.value);
      } catch (e) {}
    });
  }
  // Community layer toggle — js/main/proposal-overlay.js reads this key at
  // boot. Checkbox semantics (not a select, so no "auto" third state):
  // absent or "1" = on (default ON), "0" = off. Applying a change needs a
  // reload (the overlay only runs once, early in boot), so we just hint that
  // rather than trying to live-toggle already-patched sprites/sounds.
  const cs = document.getElementById("communitysel");
  if (cs) {
    let cur = null;
    try { cur = localStorage.getItem("taiao_community_layer_v1"); } catch (e) {}
    cs.checked = cur !== "0";
    cs.addEventListener("change", () => {
      try { localStorage.setItem("taiao_community_layer_v1", cs.checked ? "1" : "0"); } catch (e) {}
      const st = document.getElementById("community-status");
      if (st) st.textContent = "Reload to apply.";
    });
  }
  // Taiao Workshop help-tab block — build-time TAIAO_WORKSHOP_URL (empty in
  // offline builds, tools/build.mjs) decides whether this shows at all.
  const wsBlock = document.getElementById("help-workshop-block");
  if (wsBlock) {
    if (typeof TAIAO_WORKSHOP_URL !== "undefined" && TAIAO_WORKSHOP_URL) {
      const wsLink = document.getElementById("help-workshop");
      if (wsLink) wsLink.href = TAIAO_WORKSHOP_URL;
    } else wsBlock.style.display = "none";
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSettingsUi);
else initSettingsUi();

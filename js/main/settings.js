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

// ---- Account: the ONE logout control in the game (user req) ------------
// Pre-graduation there's no account yet, so this is really "abandon the
// current local-only tutorial character"; post-graduation an account is
// mandatory (js/gameplay/tutorial.js's graduate() gates on it), so this is
// a real logout. Either way it clears the local save and reloads, which
// lands back on the pre-boot chooser (js/net/boot-chooser.js) — "Start new
// adventure" or "Log in" — since that chooser shows precisely when no local
// save key is present.
// A REAL, named account — NOT the tutorial's silent guest. The guest exists so
// the isle's NPC engine works (serverapi.js), but to the player it's still "no
// account yet": the control reads "Exit tutorial", and exiting abandons it.
function accountLoggedIn() {
  return typeof Server !== "undefined" && Server.enabled() && Server.logged() &&
         !(Server.isGuest && Server.isGuest());
}
function renderAccountControl() {
  const btn = document.getElementById("help-account-btn");
  const hint = document.getElementById("help-account-hint");
  const loggedIn = accountLoggedIn();
  if (btn) btn.textContent = loggedIn ? "Log out" : "Exit tutorial";
  if (hint) hint.textContent = loggedIn
    ? "Your progress is safely stored in your account — log back in any time, on any device."
    : (typeof Server !== "undefined" && Server.enabled()
      ? "Finish the tutorial to create an account and keep your progress safe in the cloud."
      : "This copy saves only to this browser — no account system in this build.");
}
function initAccountUi() {
  const btn = document.getElementById("help-account-btn");
  if (!btn) return;
  btn.onclick = async () => {
    const loggedIn = accountLoggedIn();
    const warn = loggedIn
      ? "Log out? Your progress is safely stored in your account — log back in any time to continue."
      : "Exit the tutorial? This can't be undone: your progress only exists on this device and hasn't been saved to an account yet.";
    if (!confirm(warn)) return;
    if (loggedIn) await Server.logout(); // uploads one last save, then clears the session
    // A tutorial guest isn't a "real" logout, but exiting must still forget it
    // so the fresh start gets a clean, brand-new guest rather than resuming
    // this abandoned character's throwaway account.
    else if (typeof Server !== "undefined" && Server.isGuest && Server.isGuest() && Server.guestAbandon)
      Server.guestAbandon();
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    location.reload();
  };
  renderAccountControl();
  if (typeof Server !== "undefined") Server.onAuth(renderAccountControl);
}

function initSettingsUi() {
  initAccountUi();
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

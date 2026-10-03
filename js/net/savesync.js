// ===== Taiao — save vault sync =====
// Versioned cloud copies of the one-blob character save (storage.js
// buildSaveData). Uploads happen on login, every 5 minutes of play, when the
// tab hides, and as the last step of logout — never on a timer the player
// can feel. Restore pulls any vaulted version onto any device through the
// battle-tested importSaveFromText() path (validate → confirm → reload).
//
// Two ridealongs on every upload (see server/src/saves.js):
//   xp        — per-skill XP snapshot, ONLY when the player opted in
//               (taiao_xp_optin) — feeds the provisional leaderboards
//   summaries — queued §6.1-B action summaries (js/net/actionlog.js)
//
// DEV_MODE builds don't sync: the vault holds real progression only.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const OPTIN_KEY = "taiao_xp_optin";
  const INTERVAL_MS = 5 * 60 * 1000;
  const SLOT = "main";

  let lastUpload = 0;      // wall-clock of last success
  let lastError = null;
  let inflight = false;

  const xpOptedIn = () => { try { return localStorage.getItem(OPTIN_KEY) === "1"; } catch (e) { return false; } };
  const setXpOptIn = v => { try { v ? localStorage.setItem(OPTIN_KEY, "1") : localStorage.removeItem(OPTIN_KEY); } catch (e) {} };

  async function uploadNow(reason) {
    if (DEV || typeof Server === "undefined" || !Server.enabled() || !Server.logged()) return null;
    if (typeof gameReady === "undefined" || !gameReady || inflight) return null;
    inflight = true;
    const summaries = typeof ActionLog !== "undefined" ? ActionLog.take(20) : [];
    try {
      const body = { slot: SLOT, blob: JSON.stringify(buildSaveData()) };
      if (xpOptedIn()) body.xp = player.skills;
      if (summaries.length) body.summaries = summaries;
      const r = await Server.call("/api/save", {
        method: "PUT", body,
        keepalive: reason === "hide" || reason === "logout",
      });
      if (r.ok) {
        lastUpload = Date.now(); lastError = null;
        if (typeof ActionLog !== "undefined") ActionLog.persist();
        if (typeof AccountUI !== "undefined") AccountUI.refresh();
        return r;
      }
      throw new Error(r.error || "upload failed");
    } catch (e) {
      lastError = String(e.message || e);
      if (summaries.length && typeof ActionLog !== "undefined") ActionLog.putBack(summaries);
      return null;
    } finally { inflight = false; }
  }

  async function listVault() {
    const r = await Server.call("/api/save/list");
    return r.ok ? r.saves : [];
  }

  // Restore a vaulted save onto THIS browser. importSaveFromText handles
  // validation, the overwrite confirm (unless opts.skipConfirm), and the
  // reload. Returns true only once a save was actually written (the caller's
  // page is about to reload out from under it); false otherwise, so a caller
  // without a `log` UI yet (js/net/boot-chooser.js, pre-boot) can react.
  async function restore(version, opts) {
    const q = "/api/save/blob?slot=" + encodeURIComponent(SLOT) + (version ? "&version=" + version : "");
    const r = await Server.call(q, { raw: true });
    if (!r.ok) { if (typeof log === "function") log("Restore failed: " + (r.error || "no vaulted save."), "warn"); return false; }
    return !!importSaveFromText(r.text, opts);
  }

  // upload on login (first vault copy the moment an account exists)
  if (typeof Server !== "undefined") Server.onAuth(u => { if (u) setTimeout(() => uploadNow("login"), 2000); });
  setInterval(() => uploadNow("interval"), INTERVAL_MS);
  document.addEventListener("visibilitychange", () => { if (document.hidden) uploadNow("hide"); });

  window.SaveSync = {
    uploadNow, listVault, restore,
    xpOptedIn, setXpOptIn,
    status: () => ({ lastUpload, lastError, inflight }),
  };
})();

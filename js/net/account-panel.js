// ===== Our RPG — Account section, inside the Settings tab =====
// Formerly a dedicated sidebar tab (js/net/account-ui.js); folded into
// Settings (user req) since logging in/out and creating an account now each
// have exactly ONE place they can happen: the pre-boot chooser (first visit
// to /play, or after logging out — js/net/boot-chooser.js) creates/logs in,
// the post-graduation Bifrost crossing is the only account-creation moment
// (js/net/gate-ui.js, gameplay/tutorial.js's graduate()), and the universal
// exit/logout button lives in js/main/settings.js right above the block this
// file renders. So there is nothing left for THIS file to do but show the
// rich, already-logged-in content: the save vault, passkeys, workshop link
// code, leaderboard opt-in, and the world/digest/koha info blocks. Entirely
// absent (renders nothing) when logged out — there's no form here to fill in.
"use strict";

(function () {
  const panelEl = document.getElementById("help-account-rich");
  if (!panelEl || typeof Server === "undefined" || !Server.enabled()) {
    window.AccountUI = { refresh: () => {} };
    return;
  }

  const st = document.createElement("style");
  st.textContent = `
#help-account-rich { font-size: 12px; line-height: 1.5; }
#help-account-rich h3 { margin: 12px 0 4px; color: #ffe97a; font-size: 13px; letter-spacing: 1px; }
#help-account-rich button { background: #241c38; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; cursor: pointer; font-size: 12px; padding: 4px 10px; margin: 3px 4px 3px 0; }
#help-account-rich button:hover { background: #453a58; color: #fff; }
#help-account-rich .acc-err { color: #ff9d8f; margin: 6px 0; min-height: 1em; }
#help-account-rich .acc-ok { color: #8fd18f; }
#help-account-rich .acc-row { color: #d8d2e8; margin: 2px 0; }
#help-account-rich .acc-sub { color: #7d90a8; font-size: 11px; }
#help-account-rich label { display: flex; gap: 6px; align-items: flex-start; color: #d8d2e8; margin: 6px 0; cursor: pointer; }
#help-account-rich label input { width: auto; display: inline; margin: 2px 0 0; }
`;
  document.head.appendChild(st);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u)) ? String(u) : "";
  const when = ms => !ms ? "never" : new Date(ms).toLocaleString();
  let msg = "", msgOk = false;
  const say = (m, ok) => { msg = m || ""; msgOk = !!ok; render(); };

  function render() {
    // The tutorial's silent guest (serverapi.js) is logged in as far as the
    // server is concerned, but to the player it's "no account yet" — so show
    // nothing, exactly as when logged out. The real panel appears once they
    // claim a named account at graduation.
    const u = (Server.isGuest && Server.isGuest()) ? null : Server.user;
    panelEl.innerHTML = u ? loggedInHtml(u) : "";
    if (u) wire(u);
  }

  // A door to the Workshop, hidden entirely when this build carries no
  // TAIAO_WORKSHOP_URL (compile-time, tools/build.mjs).
  function workshopHtml(label) {
    if (typeof TAIAO_WORKSHOP_URL === "undefined" || !TAIAO_WORKSHOP_URL) return "";
    return `<button id="acc-workshop">${label}</button>`;
  }

  function loggedInHtml(u) {
    const s = typeof SaveSync !== "undefined" ? SaveSync.status() : {};
    const main = (u.saves || []).find(x => x.slot === "main");
    return `
<h3>Signed in — ${esc(u.username)}</h3>
<div class="acc-err${msgOk ? " acc-ok" : ""}">${esc(msg)}</div>
<h3>Save vault</h3>
<div class="acc-row">Latest cloud copy: <b>${main ? "v" + main.version : "none yet"}</b> <span class="acc-sub">(${when(main && main.created_at)})</span></div>
<div class="acc-row acc-sub">Uploads happen automatically every few minutes of play. Last from this device: ${when(s.lastUpload)}${s.lastError ? " — " + esc(s.lastError) : ""}</div>
<button id="acc-push">Save to vault now</button>
<button id="acc-restore" ${main ? "" : "disabled"}>Restore latest to this device…</button>
<h3>Passkeys</h3>
<div class="acc-sub">${(u.passkeys || []).length ? (u.passkeys || []).map(k => esc(k.label || "unnamed") + " (" + new Date(k.created_at).toLocaleDateString() + ")").join(" · ") : "None yet — a passkey signs you in with a touch, no password typed."}</div>
<button id="acc-pkadd">Add a passkey on this device</button>
<button id="acc-wscode" title="Sign in on the Our RPG Workshop site with this account">Workshop code</button>
${workshopHtml("Open Our RPG Workshop ↗")}
<h3>Leaderboards</h3>
<label><input type="checkbox" id="acc-xp" ${typeof SaveSync !== "undefined" && SaveSync.xpOptedIn() ? "checked" : ""}>
<span>Share my per-skill XP for the public (provisional) leaderboards and skill distributions. Gameplay is unchanged either way; untick any time.</span></label>
<h3>One world</h3>
<div class="acc-row acc-sub" id="acc-world">…</div>
<h3>This week in our world</h3>
<div class="acc-sub" id="acc-digest">…</div>
<h3>Standing</h3>
<div class="acc-sub" id="acc-ranks">…</div>
<h3>Koha</h3>
<div class="acc-sub" id="acc-koha">…</div>`;
  }

  function wire(u) {
    const $ = id => panelEl.querySelector("#" + id);
    const wsBtn = $("acc-workshop");
    if (wsBtn) wsBtn.onclick = () => window.open(TAIAO_WORKSHOP_URL, "_blank");
    $("acc-push").onclick = async () => {
      say("Uploading…", true);
      const r = typeof SaveSync !== "undefined" && await SaveSync.uploadNow("manual");
      if (r) { await Server.refreshMe(); say("Saved to the vault (v" + r.version + ").", true); }
      else say("Upload failed — it will retry automatically.", false);
    };
    $("acc-restore").onclick = () => { if (typeof SaveSync !== "undefined") SaveSync.restore(); };
    $("acc-pkadd").onclick = async () => {
      say("Follow your browser's passkey prompt…", true);
      const r = await Server.passkeyAdd((navigator.platform || "device").slice(0, 30));
      if (r.ok) { await Server.refreshMe(); say("Passkey added.", true); }
      else say(r.error || "Couldn't add a passkey.", false);
    };
    $("acc-wscode").onclick = async () => {
      say("Generating code…", true);
      const r = await Server.linkCode();
      if (r.ok) {
        const code = r.code.replace(/^(.{4})(.{4})$/, "$1-$2");
        say(`Code: ${code} — enter it in Our RPG Workshop → Settings within 10 minutes to sign in there as this account.`, true);
      } else say(r.error || "Couldn't generate a code.", false);
    };
    $("acc-xp").onchange = e => { if (typeof SaveSync !== "undefined") SaveSync.setXpOptIn(e.target.checked); };

    // Phase-2 shared-world status: region ledger + shop queue + seeds
    {
      const el = $("acc-world");
      if (el) {
        const rs = typeof RegionSync !== "undefined" ? RegionSync.status() : { enabled: false };
        const ss = typeof ShopSync !== "undefined" ? ShopSync.status() : { enabled: false };
        const sr = typeof SeedRoll !== "undefined" ? SeedRoll.status() : { enabled: false };
        el.textContent = !rs.enabled
          ? "Shared world is off in this build."
          : rs.live
            ? `Sharing the world: node harvests, picked decor and stoked fires sync with everyone` +
              ` (${rs.outbox} queued up, clock offset ${rs.offsetMs == null ? "measuring…" : Math.round(rs.offsetMs) + " ms"}).` +
              (ss.queued ? ` ${ss.queued} trade${ss.queued > 1 ? "s" : ""} waiting to reach the town ledger.` : "") +
              (sr.batch ? ` Lucky rolls come from server seed batch #${sr.batch}.` : "")
            : "Shared world resumes once you're back in Aotearoa proper (the isle is yours alone).";
      }
    }
    // Phase-2 §8 standings: percentile levels 17-32 where a skill's ladder
    // is live; provisional (hollow) until 1,000 players qualify.
    Server.call("/api/ranks/me").then(r => {
      const el = $("acc-ranks");
      if (!el) return;
      const entries = r.ok ? Object.entries(r.skills || {}) : [];
      if (!entries.length) {
        el.textContent = "No percentile standings yet — they begin once your validated XP passes a skill's level-16 floor. Levels 17-32 are standings held among all players, not thresholds.";
        return;
      }
      el.innerHTML = entries
        .sort((a, b) => b[1].level - a[1].level)
        .map(([skill, k]) => {
          const ring = k.active ? "●" : "○";
          const grace = k.graceUntil ? ` — holding above the band until ${new Date(k.graceUntil).toLocaleDateString()}` : "";
          return `<div class="acc-row">${ring} <b>${esc(skill)}</b> — level ${k.level}` +
            ` <span class="acc-sub">(top ${k.topPct < 1 ? k.topPct.toFixed(2) : Math.round(k.topPct)}%` +
            `${k.active ? "" : ", provisional: " + (k.qualifying || 0) + "/1000 qualifying"})${esc(grace)}</span></div>`;
        }).join("");
    });
    // The weekly Workshop digest, read into the game — the crew's changelog
    // where the players who caused it will actually see it. Quietly absent
    // when no digest has ever been built.
    Server.call("/api/workshop/digest/latest").then(r => {
      const el = $("acc-digest");
      if (!el) return;
      const d = r.ok && r.digest;
      if (!d || !d.markdown) { el.textContent = "A quiet week so far — the Workshop digest lands here when there's news."; return; }
      const bullets = String(d.markdown).split("\n").filter(l => /^\s*[-*] /.test(l)).slice(0, 5)
        .map(l => l.replace(/^\s*[-*] /, "").replace(/[*_`#]/g, ""));
      el.innerHTML = (bullets.length ? bullets : [String(d.markdown).split("\n").find(l => l.trim()) || ""])
        .map(b => `<div class="acc-row">· ${esc(b)}</div>`).join("") +
        (safeUrl(d.posted_url) ? `<div class="acc-row"><a href="${esc(safeUrl(d.posted_url))}" target="_blank" rel="noopener">the whole week ↗</a></div>` : "");
    });
    // live transparency line (audit §9: the real number, publicly)
    Server.call("/api/koha/transparency").then(r => {
      const el = $("acc-koha");
      if (!el) return;
      const koha = `Koha is welcome and never expected — <a href="https://our-rpg.com/koha" target="_blank" rel="noopener">our-rpg.com/koha</a>; docs/koha.md has the whole honest story.`;
      if (r.ok && r.current) {
        el.innerHTML = esc(`Running the world cost $${(r.current.usd_cents / 100).toFixed(2)} in ${r.current.month}` +
          (r.players30d ? `, across ${r.players30d} players this month` : "") + ". ") + koha;
      } else el.innerHTML = koha;
    });
  }

  Server.onAuth(() => { msg = ""; render(); });
  render();

  window.AccountUI = { refresh: render };
})();

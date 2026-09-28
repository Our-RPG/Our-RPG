// ===== Our RPG — Account tab (optional accounts, without a shadow of pressure) =====
// A sidebar tab in the cheats.js mould: grabs #panel-account, fills it, wires
// itself. Hidden entirely unless this build carries a SERVER_URL. The copy
// leads with what the vision demands: the account is OPTIONAL, email is
// OPTIONAL, and logged out the game is exactly the offline game it always was.
"use strict";

(function () {
  const tab = document.getElementById("accounttab");
  const panelEl = document.getElementById("panel-account");
  if (!tab || !panelEl || typeof Server === "undefined" || !Server.enabled()) {
    window.AccountUI = { refresh: () => {} };
    return;
  }
  tab.style.display = "";

  const st = document.createElement("style");
  st.textContent = `
#panel-account { padding: 10px 12px; font-size: 12px; line-height: 1.5; overflow-y: auto; }
#panel-account h3 { margin: 12px 0 4px; color: #ffe97a; font-size: 13px; letter-spacing: 1px; }
#panel-account .acc-hint { color: #a99cc4; font-size: 11px; margin: 4px 0 8px; }
#panel-account input { display: block; width: 92%; margin: 4px 0; background: #171226; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; padding: 4px 8px; font-size: 12px; }
#panel-account button { background: #241c38; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; cursor: pointer; font-size: 12px; padding: 4px 10px; margin: 3px 4px 3px 0; }
#panel-account button:hover { background: #453a58; color: #fff; }
#panel-account button.acc-primary { border-color: #6a5a2a; color: #ffd75e; }
#panel-account .acc-err { color: #ff9d8f; margin: 6px 0; min-height: 1em; }
#panel-account .acc-ok { color: #8fd18f; }
#panel-account .acc-row { color: #d8d2e8; margin: 2px 0; }
#panel-account .acc-sub { color: #7d90a8; font-size: 11px; }
#panel-account label { display: flex; gap: 6px; align-items: flex-start; color: #d8d2e8; margin: 6px 0; cursor: pointer; }
#panel-account label input { width: auto; display: inline; margin: 2px 0 0; }
`;
  document.head.appendChild(st);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const when = ms => !ms ? "never" : new Date(ms).toLocaleString();
  let msg = "", msgOk = false;
  const say = (m, ok) => { msg = m || ""; msgOk = !!ok; render(); };

  function render() {
    const u = Server.user;
    panelEl.innerHTML = u ? loggedInHtml(u) : loggedOutHtml();
    wire(u);
  }

  function loggedOutHtml() {
    return `
<h3>Account (optional)</h3>
<div class="acc-hint">The game never needs an account — everything works and saves on this device, logged out, forever. An account adds: your save kept in a <b>cloud vault</b> (browser storage dies with browsers), your workshop votes <b>counted with everyone else's</b>, and opt-in leaderboards. No email required.</div>
<input id="acc-user" placeholder="username" maxlength="20" autocomplete="username">
<input id="acc-pass" type="password" placeholder="password (8+ characters)" autocomplete="current-password">
<input id="acc-email" placeholder="email — optional, only for account recovery" autocomplete="email">
<div id="acc-ts"></div>
<div class="acc-err${msgOk ? " acc-ok" : ""}">${esc(msg)}</div>
<button id="acc-login" class="acc-primary">Log in</button>
<button id="acc-register">Create account</button>
<button id="acc-pklogin" title="Sign in with a passkey saved on this device">Passkey</button>
${workshopHtml("Our RPG Workshop ↗ — the room this game is built in; same account as the game.")}`;
  }

  // A door to the Workshop, hidden entirely when this build carries no
  // TAIAO_WORKSHOP_URL (compile-time, tools/build.mjs). Wired once in wire()
  // below regardless of which copy variant rendered it.
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
<div class="acc-sub" id="acc-koha">…</div>
<h3></h3>
<button id="acc-logout">Log out</button>`;
  }

  function wire(u) {
    const $ = id => panelEl.querySelector("#" + id);
    const wsBtn = $("acc-workshop");
    if (wsBtn) wsBtn.onclick = () => window.open(TAIAO_WORKSHOP_URL, "_blank");
    if (!u) {
      const go = async fn => {
        const name = $("acc-user").value.trim(), pass = $("acc-pass").value;
        say("Working…", true);
        const r = await fn(name, pass);
        say(r.ok ? "" : r.error || "Something went wrong.", false);
      };
      $("acc-login").onclick = () => go((n, p) => Server.login(n, p, $("acc-ts")));
      $("acc-register").onclick = () => go((n, p) => Server.register(n, p, $("acc-email").value.trim(), $("acc-ts")));
      $("acc-pass").onkeydown = e => { if (e.key === "Enter") $("acc-login").click(); };
      $("acc-pklogin").onclick = async () => {
        say("Waiting for your passkey…", true);
        const r = await Server.passkeyLogin($("acc-user").value.trim() || undefined);
        say(r.ok ? "" : r.error || "Passkey sign-in failed.", false);
      };
      return;
    }
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
    $("acc-logout").onclick = async () => { say("Logging out…", true); await Server.logout(); say("", false); };

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
        (d.posted_url ? `<div class="acc-row"><a href="${esc(d.posted_url)}" target="_blank" rel="noopener">the whole week ↗</a></div>` : "");
    });
    // live transparency line (audit §9: the real number, publicly)
    Server.call("/api/koha/transparency").then(r => {
      const el = $("acc-koha");
      if (!el) return;
      const kofi = `Koha is welcome and never expected — <a href="https://ko-fi.com/taiao" target="_blank" rel="noopener">ko-fi.com/taiao</a>; docs/koha.md has the whole honest story.`;
      if (r.ok && r.current) {
        el.innerHTML = esc(`Running the world cost $${(r.current.usd_cents / 100).toFixed(2)} in ${r.current.month}` +
          (r.players30d ? `, across ${r.players30d} players this month` : "") + ". ") + kofi;
      } else el.innerHTML = kofi;
    });
  }

  Server.onAuth(() => { msg = ""; render(); });
  render();

  window.AccountUI = { refresh: render };
})();

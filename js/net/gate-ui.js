// ===== Our RPG — the two hard gates that make the world multiplayer-only =====
// The rest of the net layer treats an account as optional. Post-tutorial, it
// isn't: the endless world is a shared, live place, so you cross into it with a
// name and you stay in it connected.
//
//   AccountGate.require(onDone) — a blocking "create your account" modal the
//     tutorial's Bifrost crossing waits on (js/gameplay/tutorial.js). onDone
//     fires only once there's a logged-in session.
//   AccountGate.veil(kind)      — the reconnect curtain main.js raises whenever
//     a graduated player is logged out ("login") or dropped ("reconnect").
//
// Both are NO-OPS in offline/dev builds (no SERVER_URL): require() runs onDone
// immediately and the curtain never shows, so local play is exactly as it was.
"use strict";

(function () {
  const enabled = () => typeof Server !== "undefined" && Server.enabled();

  if (!enabled()) {
    // offline / dev build: the world is yours alone — never gate anything.
    window.AccountGate = { require: onDone => { if (onDone) onDone(); },
      veil: () => {}, open: () => false };
    return;
  }

  const css = document.createElement("style");
  css.textContent = `
#gate-veil { position:fixed; inset:0; z-index:9000; display:none;
  background:radial-gradient(circle at 50% 40%, rgba(20,16,34,0.86), rgba(6,5,12,0.97));
  backdrop-filter:blur(3px); color:#e8e2f4;
  font:14px OpenDyslexic, Verdana, sans-serif; align-items:center; justify-content:center; }
#gate-veil.on { display:flex; }
#gate-card { width:min(420px,90vw); background:#150f26; border:1px solid #3a3050;
  border-radius:12px; padding:22px 22px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.5); }
#gate-card h2 { margin:0 0 6px; color:#ffe97a; font-size:19px; letter-spacing:0.5px; }
#gate-card .gate-sub { color:#a99cc4; font-size:12.5px; line-height:1.5; margin:0 0 14px; }
#gate-card input { display:block; width:100%; box-sizing:border-box; margin:6px 0;
  background:#0f0b1c; border:1px solid #3a3050; color:#e8e2f4; border-radius:6px;
  padding:8px 10px; font:inherit; }
#gate-card .gate-btns { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
#gate-card button { flex:1 1 auto; background:#241c38; border:1px solid #3a3050;
  color:#e8e2f4; border-radius:6px; cursor:pointer; font:inherit; padding:8px 12px; }
#gate-card button:hover { background:#453a58; color:#fff; }
#gate-card button.gate-primary { border-color:#6a5a2a; color:#ffd75e; background:#2a2130; }
#gate-card .gate-msg { color:#ff9d8f; margin:10px 0 0; min-height:1.1em; font-size:12.5px; }
#gate-card .gate-msg.ok { color:#8fd18f; }
#gate-card .gate-spin { margin:8px auto 2px; width:34px; height:34px; border-radius:50%;
  border:3px solid #3a3050; border-top-color:#ffd75e; animation:gate-spin 0.9s linear infinite; }
@keyframes gate-spin { to { transform:rotate(360deg); } }
#gate-card .gate-rc { text-align:center; }`;
  document.head.appendChild(css);

  const veilEl = document.createElement("div");
  veilEl.id = "gate-veil";
  veilEl.innerHTML = `<div id="gate-card"></div>`;
  document.body.appendChild(veilEl);
  const card = veilEl.querySelector("#gate-card");

  let mode = null;            // null | "account" | "reconnect"
  let pendingDone = null;     // fired once a session exists (account mode)
  let msg = "", msgOk = false, busy = false;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = (m, ok) => { msg = m || ""; msgOk = !!ok; render(); };

  function accountHtml() {
    return `
<h2>Create your name in the world</h2>
<p class="gate-sub">Beyond this crossing, the world is shared and alive — other players, real-time. You enter it with an account so your progress is safe in the cloud and others can find you. No email needed.</p>
<input id="gate-user" placeholder="username (3–20: letters, digits, _ or -)" maxlength="20" autocomplete="username">
<input id="gate-pass" type="password" placeholder="password (8+ characters)" autocomplete="new-password">
<input id="gate-pass2" type="password" placeholder="repeat password" autocomplete="new-password">
<input id="gate-email" placeholder="email — optional, only for account recovery" autocomplete="email">
<div id="gate-ts"></div>
<div class="gate-btns">
  <button id="gate-create" class="gate-primary">Create account &amp; cross</button>
  <button id="gate-login">I already have one</button>
  <button id="gate-pk" title="Sign in with a passkey on this device">Passkey</button>
</div>
<div class="gate-msg${msgOk ? " ok" : ""}">${esc(msg)}</div>`;
  }

  function reconnectHtml() {
    return `<div class="gate-rc">
<h2>Reconnecting to the world…</h2>
<div class="gate-spin"></div>
<p class="gate-sub">The endless world is a live, shared place — play resumes the moment you're back on the wire. Nothing is lost.</p>
<div class="gate-msg${msgOk ? " ok" : ""}">${esc(msg)}</div></div>`;
  }

  function render() {
    if (!mode) { veilEl.classList.remove("on"); card.innerHTML = ""; return; }
    veilEl.classList.add("on");
    card.innerHTML = mode === "reconnect" ? reconnectHtml() : accountHtml();
    if (mode === "account") wireAccount();
  }

  function done() {
    const fn = pendingDone; pendingDone = null;
    mode = null; render();
    if (fn) { try { fn(); } catch (e) {} }
  }

  function wireAccount() {
    const $ = id => card.querySelector("#" + id);
    const run = async fn => {
      if (busy) return;
      busy = true; say("Working…", true);
      const name = $("gate-user").value.trim(), pass = $("gate-pass").value;
      const r = await fn(name, pass);
      busy = false;
      if (r && r.ok) { say("", true); done(); }
      else say((r && r.error) || "Something went wrong — try again.", false);
    };
    $("gate-create").onclick = () => {
      if ($("gate-pass").value !== $("gate-pass2").value) { say("Passwords don't match.", false); return; }
      run((n, p) => Server.register(n, p, $("gate-email").value.trim(), $("gate-ts")));
    };
    $("gate-login").onclick = () => run((n, p) => Server.login(n, p, $("gate-ts")));
    $("gate-pass").onkeydown = e => { if (e.key === "Enter") $("gate-create").click(); };
    $("gate-pass2").onkeydown = e => { if (e.key === "Enter") $("gate-create").click(); };
    // typing it twice only catches a typo if neither copy can be a paste of the other
    $("gate-pass2").addEventListener("paste", e => e.preventDefault());
    $("gate-pass2").addEventListener("drop", e => e.preventDefault());
    $("gate-pk").onclick = async () => {
      if (busy) return;
      busy = true; say("Waiting for your passkey…", true);
      const r = await Server.passkeyLogin($("gate-user").value.trim() || undefined);
      busy = false;
      if (r && r.ok) { say("", true); done(); }
      else say((r && r.error) || "Passkey sign-in failed.", false);
    };
  }

  // A REAL account, not the tutorial's throwaway guest — graduation is exactly
  // where the guest is left behind for a named account.
  const realAccount = () => Server.logged() && !(Server.isGuest && Server.isGuest());

  // If a REAL session appears by any route (passkey, a resumed token, another
  // tab), an open account gate resolves itself. The guest login that lit the
  // tutorial fires onAuth too, so it must NOT count here.
  Server.onAuth(() => { if (realAccount() && mode === "account") done(); });

  window.AccountGate = {
    // Block until there's a real-account session, then run onDone. Already on
    // one → immediate. Idempotent: calling again while open just keeps waiting.
    require(onDone) {
      if (realAccount()) { if (onDone) onDone(); return; }
      pendingDone = onDone || pendingDone;
      if (mode !== "account") { mode = "account"; msg = ""; render(); }
    },
    // main.js curtain. kind: "reconnect" (logged in, dropped) | "login"
    // (logged out — reuse the account modal) | null (clear).
    veil(kind) {
      if (kind === "login") { this.require(() => {}); return; }
      if (kind === "reconnect") {
        if (mode === "account") return;   // an open account modal takes priority
        if (mode !== "reconnect") { mode = "reconnect"; msg = ""; render(); }
        return;
      }
      // clear — but never yank away an account modal that's still waiting
      if (mode === "reconnect") { mode = null; render(); }
    },
    open: () => !!mode,
  };
})();

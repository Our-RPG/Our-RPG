// ===== Our RPG — the pre-boot landing chooser =====
// User req: the ONLY place to log in is the very first visit to /play, or
// right after logging out (js/main/settings.js's Exit tutorial/Log out
// button clears the local save and reloads — which lands right back here,
// since this chooser shows precisely when no local save key is present).
// Account CREATION only ever happens post-graduation (js/net/gate-ui.js,
// gameplay/tutorial.js's graduate()) — this screen offers login only, never
// registration, so there is no second door into "create an account."
//
// BootChooser.run() is awaited at the very top of main.js's init(), before
// loadGame() ever runs. No-op (resolves immediately) in offline/dev builds
// (no SERVER_URL) — those have no account system, so a fresh browser always
// just starts the tutorial, exactly as it always has.
"use strict";

(function () {
  function run() {
    if (typeof Server === "undefined" || !Server.enabled()) return Promise.resolve();

    return new Promise(resolve => {
      const css = document.createElement("style");
      css.textContent = `
#boot-choose { position:fixed; inset:0; z-index:10000; display:flex;
  background:radial-gradient(circle at 50% 40%, rgba(20,16,34,0.96), rgba(6,5,12,0.99));
  color:#e8e2f4; font:14px OpenDyslexic, Verdana, sans-serif; align-items:center; justify-content:center; }
#boot-choose .bc-card { width:min(420px,90vw); background:#150f26; border:1px solid #3a3050;
  border-radius:12px; padding:26px 22px 20px; box-shadow:0 12px 40px rgba(0,0,0,0.5); text-align:center; }
#boot-choose h1 { margin:0 0 4px; color:#ffd75e; font-size:24px; letter-spacing:0.5px; }
#boot-choose .bc-sub { color:#a99cc4; font-size:12.5px; line-height:1.5; margin:0 0 20px; }
#boot-choose input { display:block; width:100%; box-sizing:border-box; margin:6px 0; text-align:left;
  background:#0f0b1c; border:1px solid #3a3050; color:#e8e2f4; border-radius:6px;
  padding:8px 10px; font:inherit; }
#boot-choose .bc-btns { display:flex; flex-direction:column; gap:10px; margin-top:4px; }
#boot-choose button { background:#241c38; border:1px solid #3a3050;
  color:#e8e2f4; border-radius:6px; cursor:pointer; font:inherit; padding:12px 14px; }
#boot-choose button:hover { background:#453a58; color:#fff; }
#boot-choose button.bc-primary { border-color:#6a5a2a; color:#ffd75e; background:#2a2130; }
#boot-choose button.bc-link { background:none; border:none; color:#a99cc4; padding:4px; font-size:12px; }
#boot-choose button.bc-link:hover { color:#fff; }
#boot-choose .bc-msg { color:#ff9d8f; margin:10px 0 0; min-height:1.1em; font-size:12.5px; }
#boot-choose .bc-msg.ok { color:#8fd18f; }`;
      document.head.appendChild(css);

      const veil = document.createElement("div");
      veil.id = "boot-choose";
      veil.innerHTML = `<div class="bc-card"></div>`;
      document.body.appendChild(veil);
      const card = veil.querySelector(".bc-card");
      veil.addEventListener("mousedown", e => e.stopPropagation());
      veil.addEventListener("click", e => e.stopPropagation());

      const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      let msg = "", msgOk = false, busy = false;
      const say = (m, ok) => { msg = m || ""; msgOk = !!ok; renderLogin(); };

      function finish() {
        document.head.removeChild(css);
        document.body.removeChild(veil);
        resolve();
      }

      function renderChoice() {
        card.innerHTML = `
<h1>Our RPG</h1>
<p class="bc-sub">An endless world, built by the people who play it.</p>
<div class="bc-btns">
  <button id="bc-new" class="bc-primary">Start new adventure</button>
  <button id="bc-login">Log in</button>
</div>`;
        card.querySelector("#bc-new").onclick = finish;
        card.querySelector("#bc-login").onclick = renderLogin;
      }

      function renderLogin() {
        card.innerHTML = `
<h1>Log in</h1>
<p class="bc-sub">Pick up where you left off — your account's cloud save comes down to this device.</p>
<input id="bc-user" placeholder="username" maxlength="20" autocomplete="username">
<input id="bc-pass" type="password" placeholder="password" autocomplete="current-password">
<div id="bc-ts"></div>
<div class="bc-btns">
  <button id="bc-dologin" class="bc-primary">Log in</button>
  <button id="bc-pk" title="Sign in with a passkey on this device">Sign in with a passkey</button>
  <button id="bc-back" class="bc-link">← back</button>
</div>
<div class="bc-msg${msgOk ? " ok" : ""}">${esc(msg)}</div>`;
        const $ = id => card.querySelector("#" + id);
        $("bc-back").onclick = () => { msg = ""; renderChoice(); };
        const afterLogin = async r => {
          if (!r || !r.ok) { say((r && r.error) || "Something went wrong — try again.", false); return; }
          say("Bringing your save down…", true);
          const got = typeof SaveSync !== "undefined" && await SaveSync.restore(null, { skipConfirm: true });
          // a reload already happened inside restore() on success — if we're
          // still here, there was no vaulted save to pull (a brand-new
          // account with nothing saved yet — shouldn't normally happen, since
          // an account is only ever created post-graduation with a save
          // already in hand, but don't strand the player on a dead screen).
          if (!got) { say("Logged in, but no saved character was found for this account.", false); finish(); }
        };
        // Read the fields BEFORE say() — it calls renderLogin(), which rebuilds
        // the card and blanks the inputs; reading after it logged in with an
        // empty username/password. (same class of bug as gate-ui, fixed 2026-10-03)
        $("bc-dologin").onclick = async () => {
          if (busy) return;
          const user = $("bc-user").value.trim(), pass = $("bc-pass").value, ts = $("bc-ts");
          busy = true; say("Working…", true);
          const r = await Server.login(user, pass, ts);
          busy = false; await afterLogin(r);
        };
        $("bc-pass").onkeydown = e => { if (e.key === "Enter") $("bc-dologin").click(); };
        $("bc-pk").onclick = async () => {
          if (busy) return;
          const user = $("bc-user").value.trim() || undefined;
          busy = true; say("Waiting for your passkey…", true);
          const r = await Server.passkeyLogin(user);
          busy = false; await afterLogin(r);
        };
      }

      renderChoice();
    });
  }

  window.BootChooser = { run };
})();

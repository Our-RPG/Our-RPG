// ===== Taiao — server API core (Phase 1: the tiny server that counts) =====
// The one place the client talks HTTP. SERVER_URL is injected by
// tools/build.mjs (empty = no server: every call here no-ops and the game is
// exactly the offline build it always was). Auth is a Bearer token in
// localStorage; the session survives reloads and the account is entirely
// optional — logged out, nothing on this file's path ever runs.
//
// Exposes window.Server:
//   enabled() logged() user  — state
//   call(path, opts)         — authed fetch returning parsed JSON ({error} on failure)
//   register/login/logout    — password auth (+ Turnstile when built with a sitekey)
//   guestLogin               — silent throwaway account (the tutorial NPC engine)
//   passkeyAdd/passkeyLogin  — optional WebAuthn
//   linkCode                 — one-time code so the Workshop site can sign in
//   onAuth(fn)               — login/logout listeners (savesync/worksync/UI hook in)
"use strict";

(function () {
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  const TOKEN_KEY = "taiao_session_v1";

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY) || null; } catch (e) {}
  let user = null;              // {username, saves, passkeys, ...} from /api/me
  const authListeners = [];
  function fireAuth() { for (const fn of authListeners) { try { fn(user); } catch (e) {} } }

  function setToken(t) {
    token = t;
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // Every response is JSON; network/parse failures come back as {error} so
  // callers never need try/catch. A 401 drops the session (expired/revoked).
  async function call(path, opts = {}) {
    if (!URL_) return { error: "Server disabled in this build." };
    try {
      const res = await fetch(URL_ + path, {
        method: opts.method || (opts.body ? "POST" : "GET"),
        headers: {
          ...(opts.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        keepalive: !!opts.keepalive,
      });
      if (opts.raw) return res.ok ? { ok: true, text: await res.text(), res } : await res.json();
      const data = await res.json();
      if (res.status === 401 && token && !path.startsWith("/api/login")) {
        setToken(null); user = null; fireAuth();
      }
      return data;
    } catch (e) {
      return { error: "Couldn't reach the server — you're offline or it's down. Nothing is lost; everything still saves locally." };
    }
  }

  // ---------- Turnstile (bot check) ----------
  // Loaded on demand, only when this build carries a sitekey. The invisible
  // widget renders into a container the account panel provides.
  let tsReady = null;
  function loadTurnstile() {
    if (tsReady) return tsReady;
    tsReady = new Promise(resolve => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return tsReady;
  }
  async function turnstileToken(container) {
    const KEY = typeof TURNSTILE_SITEKEY !== "undefined" ? TURNSTILE_SITEKEY : "";
    if (!KEY) return null;
    if (!await loadTurnstile() || typeof turnstile === "undefined") return null;
    return new Promise(resolve => {
      container.innerHTML = "";
      const done = t => { setTimeout(() => { try { turnstile.remove(id); } catch (e) {} container.innerHTML = ""; }, 500); resolve(t); };
      const id = turnstile.render(container, {
        sitekey: KEY, size: "flexible",
        callback: done, "error-callback": () => done(null),
      });
    });
  }

  // ---------- password auth ----------
  async function register(username, password, email, tsContainer) {
    const ts = tsContainer ? await turnstileToken(tsContainer) : null;
    const r = await call("/api/register", { body: { username, password, email: email || null, turnstile: ts } });
    if (r.ok) { setToken(r.token); await refreshMe(); }
    return r;
  }
  async function login(username, password, tsContainer) {
    const ts = tsContainer ? await turnstileToken(tsContainer) : null;
    const r = await call("/api/login", { body: { username, password, turnstile: ts } });
    if (r.ok) { setToken(r.token); await refreshMe(); }
    return r;
  }
  async function logout() {
    if (typeof SaveSync !== "undefined") await SaveSync.uploadNow("logout"); // last vault push
    await call("/api/logout", { method: "POST", body: {} });
    setToken(null); user = null; fireAuth();
  }
  async function refreshMe() {
    if (!token) { user = null; fireAuth(); return null; }
    const r = await call("/api/me");
    user = r.ok ? r : null;
    fireAuth();
    return user;
  }

  // ---------- passkeys (WebAuthn) ----------
  const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  const bufToB64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function passkeyAdd(label) {
    if (!navigator.credentials) return { error: "This browser has no passkey support." };
    const o = await call("/api/passkey/register/options", { method: "POST", body: {} });
    if (!o.ok) return o;
    const pk = o.publicKey;
    pk.challenge = b64uToBuf(pk.challenge);
    pk.user.id = b64uToBuf(pk.user.id);
    let cred;
    try { cred = await navigator.credentials.create({ publicKey: pk }); }
    catch (e) { return { error: "Passkey creation was cancelled." }; }
    return call("/api/passkey/register", { body: {
      id: cred.id, label: label || "",
      response: {
        clientDataJSON: bufToB64u(cred.response.clientDataJSON),
        attestationObject: bufToB64u(cred.response.attestationObject),
      },
    } });
  }

  async function passkeyLogin(username) {
    if (!navigator.credentials) return { error: "This browser has no passkey support." };
    const o = await call("/api/passkey/login/options", { body: { username: username || undefined } });
    if (!o.ok) return o;
    const pk = o.publicKey;
    pk.challenge = b64uToBuf(pk.challenge);
    if (pk.allowCredentials) pk.allowCredentials = pk.allowCredentials.map(c => ({ ...c, id: b64uToBuf(c.id) }));
    let cred;
    try { cred = await navigator.credentials.get({ publicKey: pk }); }
    catch (e) { return { error: "Passkey sign-in was cancelled." }; }
    const r = await call("/api/passkey/login", { body: {
      id: cred.id,
      response: {
        clientDataJSON: bufToB64u(cred.response.clientDataJSON),
        authenticatorData: bufToB64u(cred.response.authenticatorData),
        signature: bufToB64u(cred.response.signature),
      },
    } });
    if (r.ok) { setToken(r.token); await refreshMe(); }
    return r;
  }

  // ---------- Workshop sign-in code ----------
  // Mints a one-time code (Account panel button) that the Workshop site — a
  // different origin, so this device's localStorage token can't cross over —
  // redeems for a real session there. See server/src/link.js.
  const linkCode = () => call("/api/link/code", { method: "POST", body: {} });

  // ---------- silent guest session (the tutorial's NPC engine) ----------
  // The NPC dialogue engine, the status pill and the "/" chat bar all require a
  // logged-in session (npcEngineAvailable() → Server.logged()), but the
  // tutorial happens BEFORE the player is ever asked to make an account (that's
  // the post-graduation Bifrost gate). So a fresh keeper silently gets a
  // throwaway "guest_…" account: a real row server-side, but random-named and
  // never surfaced. Its credentials are kept locally so the SAME device resumes
  // the same guest across reloads instead of piling up new ones; at graduation
  // the player creates their real, named account and the save re-uploads to it
  // (gate-ui.js / tutorial.js), leaving the guest behind. No turnstile widget
  // exists this early, so register() sends none — fine while the server's
  // Turnstile is fail-open (no secret configured).
  const GUEST_KEY = "taiao_guest_v1";
  const loadGuest = () => { try { return JSON.parse(localStorage.getItem(GUEST_KEY)); } catch (e) { return null; } };
  const saveGuest = g => { try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch (e) {} };
  // URL-safe token of n chars from [A-Za-z0-9] — satisfies USERNAME_RE and
  // makes a strong random password. Falls back to Math.random only if the
  // crypto API is somehow absent (ancient browser); never throws.
  function randToken(n) {
    const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    try {
      const buf = new Uint8Array(n);
      crypto.getRandomValues(buf);
      for (let i = 0; i < n; i++) s += al[buf[i] % al.length];
    } catch (e) {
      for (let i = 0; i < n; i++) s += al[(Math.random() * al.length) | 0];
    }
    return s;
  }
  // The current session is a guest iff the signed-in username is the throwaway
  // one we stashed. Stateless (survives reloads, and a later real login on the
  // same device reads as NOT a guest since the names differ) — so the rest of
  // the app can treat a guest as "no real account yet": the Settings control
  // stays "Exit tutorial", and graduation still demands a real, named account.
  function isGuest() {
    const g = loadGuest();
    return !!(user && g && g.u && user.username &&
              String(user.username).toLowerCase() === String(g.u).toLowerCase());
  }
  // Abandon the guest entirely (Settings' "Exit tutorial"): forget its
  // credentials and drop the session so the next boot starts a brand-new one.
  // The orphaned server row simply lapses; nothing here needs the network.
  function guestAbandon() {
    try { localStorage.removeItem(GUEST_KEY); } catch (e) {}
    setToken(null); user = null; fireAuth();
  }
  let guestInFlight = null;
  function guestLogin() {
    if (!URL_) return Promise.resolve({ error: "Server disabled in this build." });
    if (user) return Promise.resolve({ ok: true });            // already signed in
    if (guestInFlight) return guestInFlight;                    // one at a time
    guestInFlight = (async () => {
      // 1) an existing session token (a resumed guest) just needs /api/me
      if (token) { const me = await refreshMe(); if (me) return { ok: true }; }
      // 2) stored guest credentials from a previous visit — log back in
      const g = loadGuest();
      if (g && g.u && g.p) {
        const r = await login(g.u, g.p);
        if (r && r.ok) return r;                                // (stale → fall through)
      }
      // 3) make a brand-new throwaway account ("guest_" + 10 = 16 chars ≤ 20).
      // Store the credentials BEFORE registering: register() fires onAuth the
      // moment the session lands, and isGuest() must already read true then
      // (else the Settings control and account panel would flash as a real
      // account). Clear them again only if the registration itself fails.
      const u = "guest_" + randToken(10), p = randToken(24);
      saveGuest({ u, p });
      const r = await register(u, p, null);
      if (!(r && r.ok)) { try { localStorage.removeItem(GUEST_KEY); } catch (e) {} }
      return r;
    })().finally(() => { guestInFlight = null; });
    return guestInFlight;
  }

  // Resume a stored session shortly after boot (off the critical path).
  if (URL_ && token) setTimeout(refreshMe, 4000);

  window.Server = {
    enabled: () => !!URL_,
    logged: () => !!user,
    get user() { return user; },
    call, register, login, logout, refreshMe, guestLogin, isGuest, guestAbandon,
    passkeyAdd, passkeyLogin, linkCode,
    onAuth: fn => authListeners.push(fn),
  };
})();

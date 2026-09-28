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

  // Resume a stored session shortly after boot (off the critical path).
  if (URL_ && token) setTimeout(refreshMe, 4000);

  window.Server = {
    enabled: () => !!URL_,
    logged: () => !!user,
    get user() { return user; },
    call, register, login, logout, refreshMe,
    passkeyAdd, passkeyLogin, linkCode,
    onAuth: fn => authListeners.push(fn),
  };
})();

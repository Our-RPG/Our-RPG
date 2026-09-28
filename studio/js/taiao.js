// ===== Our RPG Workshop — game account + community workshop =====
// The costume gallery is the game's existing "ballot box" (server/src/
// workshop.js) reached from here: players sign in with the SAME Taiao account
// they use in game, submit a costume as a workshop *proposal* (art + author,
// licensed CC BY-SA 4.0), and *vote* for the costume they want in game. The
// server already tallies votes and orders proposals by their maker — so the
// highest-voted costume surfaces with the maker's username credited, exactly
// as the request asks. Nothing here auto-applies: a curator still reads every
// accepted proposal (GOVERNANCE.md).
//
// Reused endpoints (server/src/index.js):
//   POST /api/register /login /logout   GET /api/me
//   POST /api/workshop/proposal         GET /api/workshop/proposals?subject=
//   GET  /api/workshop/proposal?id=     POST /api/workshop/votes
//   GET  /api/workshop/tally?subject=
"use strict";

const Taiao = (function () {
  const TOKEN_LS = "taiao_session_v1";     // same key the game uses
  const URL_LS = "taiao_server_url_v1";    // overridable server origin
  const SITEKEY_LS = "taiao_turnstile_sitekey_v1";

  let serverUrl = "";
  try { serverUrl = localStorage.getItem(URL_LS) || CFG.TAIAO_SERVER_DEFAULT; } catch (_) { serverUrl = CFG.TAIAO_SERVER_DEFAULT; }
  let token = null;
  try { token = localStorage.getItem(TOKEN_LS) || null; } catch (_) {}
  let user = null;
  const listeners = [];

  const setServerUrl = u => { serverUrl = (u || "").replace(/\/+$/, ""); try { localStorage.setItem(URL_LS, serverUrl); } catch (_) {} };
  const getServerUrl = () => serverUrl;
  const onAuth = fn => { listeners.push(fn); return fn; };
  const fire = () => listeners.forEach(fn => { try { fn(user); } catch (_) {} });
  function setToken(t) { token = t; try { t ? localStorage.setItem(TOKEN_LS, t) : localStorage.removeItem(TOKEN_LS); } catch (_) {} }

  async function call(path, opts = {}) {
    if (!serverUrl) return { error: "No game server configured." };
    try {
      const res = await fetch(serverUrl + path, {
        method: opts.method || (opts.body ? "POST" : "GET"),
        headers: {
          ...(opts.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      let data;
      try { data = await res.json(); } catch (_) { data = { error: "Bad server response." }; }
      if (res.status === 401 && token && !path.startsWith("/api/login")) { setToken(null); user = null; fire(); }
      return data;
    } catch (e) {
      return { error: "Couldn't reach the server. Your work is safe locally." };
    }
  }

  // ---- optional Turnstile (only if a sitekey is configured & the prod
  // worker enforces it). Mirrors js/net/serverapi.js. ----
  let tsReady = null;
  const sitekey = () => { try { return localStorage.getItem(SITEKEY_LS) || ""; } catch (_) { return ""; } };
  const setSitekey = k => { try { k ? localStorage.setItem(SITEKEY_LS, k) : localStorage.removeItem(SITEKEY_LS); } catch (_) {} };
  function loadTurnstile() {
    if (tsReady) return tsReady;
    tsReady = new Promise(resolve => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.onload = () => resolve(true); s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return tsReady;
  }
  async function turnstileToken(container) {
    const KEY = sitekey();
    if (!KEY || !container) return null;
    if (!await loadTurnstile() || typeof turnstile === "undefined") return null;
    return new Promise(resolve => {
      container.innerHTML = "";
      const done = t => { setTimeout(() => { try { turnstile.remove(id); } catch (_) {} container.innerHTML = ""; }, 500); resolve(t); };
      const id = turnstile.render(container, { sitekey: KEY, size: "flexible", callback: done, "error-callback": () => done(null) });
    });
  }

  // ---- auth ----
  async function refreshMe() {
    if (!token) { user = null; fire(); return null; }
    const r = await call("/api/me");
    user = r && r.ok ? r : null;
    fire();
    return user;
  }
  async function register(username, password, email, tsContainer) {
    const ts = await turnstileToken(tsContainer);
    const r = await call("/api/register", { body: { username, password, email: email || null, turnstile: ts } });
    if (r.ok) { setToken(r.token); await refreshMe(); }
    return r;
  }
  async function login(username, password, tsContainer) {
    const ts = await turnstileToken(tsContainer);
    const r = await call("/api/login", { body: { username, password, turnstile: ts } });
    if (r.ok) { setToken(r.token); await refreshMe(); }
    return r;
  }
  async function logout() { await call("/api/logout", { method: "POST", body: {} }); setToken(null); user = null; fire(); }

  // ---- passkeys (WebAuthn) — mirrors js/net/serverapi.js so a passkey
  // registered from the Workshop's own origin (see server/src/passkeys.js
  // rpIdFor) can sign a player in here directly. ----
  const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  const bufToB64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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

  // ---- Workshop sign-in code ----
  // Itch runs the game on its own origin, so this browser's localStorage
  // token never sees it — a player mints a one-time code in the game's
  // Account panel (Workshop code) and pastes it here instead. See
  // server/src/link.js.
  async function redeemLinkCode(code) {
    const r = await call("/api/link/redeem", { body: { code } });
    if (r.ok) { setToken(r.token); await refreshMe(); }
    return r;
  }

  const logged = () => !!user;
  const username = () => user && user.username || "";

  // ---- workshop: generations & costumes as proposals, votes elect winners --
  // One subject groups everything shared for a single game character or
  // object: whole-character generations AND alternative costumes alike. Keying
  // by kind lets the communal feed tell characters from objects.
  const subjectFor = (kind, folder) => "gen:" + (kind || "character") + ":" + folder;
  const parseSubject = s => { const m = /^gen:([^:]+):(.+)$/.exec(s || ""); return m ? { kind: m[1], folder: m[2] } : { kind: "character", folder: (s || "").replace(/^[^:]*:/, "") }; };

  // Submit a proposal (a generation, a costume, or pure data). bundle carries
  // the art + design; the server stamps the author. `source` is the provenance
  // the moderation gate keys off: "pixellab" (generated art, auto-published
  // for voting), "data" (no uploaded binary — quests, recipes, rules, values;
  // also auto-published), or "upload" (human-uploaded art, held for curator
  // review). Anything unrecognised is treated as an upload.
  //
  // `provenance` (optional 6th arg): the maker's own-work/AI-disclosure answer
  // ("own" | "ai" | "pixellab") — folded into the bundle here so every path
  // (costumes, icons, sounds, …) gains it uniformly instead of each call site
  // stamping it by hand. PixelLab-sourced proposals get it automatically even
  // when the caller doesn't pass one; an explicit `provenance` always wins.
  async function submitProposal(kind, folder, title, bundle, source, provenance) {
    if (!logged()) return { error: "Sign in to share to the community." };
    const prov = provenance || (source === "pixellab" ? "pixellab" : null);
    if (prov && bundle && typeof bundle === "object") bundle.provenance = prov;
    return call("/api/workshop/proposal", { body: {
      subject: subjectFor(kind, folder),
      kind: "sprites",
      title,
      licence: "CC-BY-SA-4.0",
      source: ["pixellab", "data"].includes(source) ? source : "upload",
      payload: bundle,
    } });
  }
  const submitCostume = (kind, folder, name, bundle, source, provenance) => submitProposal(kind, folder, name, bundle, source, provenance);

  // Public: everything shared for one character/object, ordered by votes,
  // each with { id, title, username, endorsements, ... }.
  async function listCostumes(kind, folder) {
    const r = await call("/api/workshop/proposals?subject=" + encodeURIComponent(subjectFor(kind, folder)));
    return r && r.ok ? r.proposals : [];
  }

  // Public: the whole communal feed — up to 100 most-endorsed proposals across
  // everyone and everything. Each row carries its subject, so the app can group
  // by character/object and split characters from objects.
  async function listCommunity() {
    const r = await call("/api/workshop/proposals?_=" + Date.now());
    const props = r && r.ok ? r.proposals : [];
    return props.map(p => ({ ...p, _subj: parseSubject(p.subject) }));
  }

  // Raw feed access for the Home/Profile pages: returns the server response
  // verbatim ({ok, proposals} or {error}) so callers can tell a server outage
  // from an empty feed. status: "open" (default) or "accepted" (the adopted-
  // changes changelog). Rows gain _subj like listCommunity's.
  async function listProposalsRaw(status) {
    const qs = (status ? "status=" + encodeURIComponent(status) + "&" : "") + "_=" + Date.now();
    const r = await call("/api/workshop/proposals?" + qs);
    if (r && r.ok && Array.isArray(r.proposals))
      r.proposals = r.proposals.map(p => ({ ...p, _subj: parseSubject(p.subject) }));
    return r;
  }
  // Raw "my proposals": {ok, proposals} or {error} — unlike listMine, an
  // outage is distinguishable from "you haven't proposed anything yet".
  async function listMineRaw() {
    if (!logged()) return { error: "Sign in first." };
    return call("/api/workshop/mine");
  }
  // Full payload (the art) for one proposal. Cached — community grids ask for
  // the same proposals repeatedly as tiles scroll in and out of view.
  const _propCache = new Map();
  async function getCostume(id) {
    id = Number(id);
    if (_propCache.has(id)) return _propCache.get(id);
    const r = await call("/api/workshop/proposal?id=" + id);
    const p = r && r.ok ? r.proposal : null;
    if (p) _propCache.set(id, p);
    return p;
  }

  // The primary vote: endorse a costume you want in the game. The server
  // ranks proposals by endorsement count and returns each maker's username, so
  // the most-endorsed costume surfaces first, credited to its author. One
  // endorsement per user per proposal (idempotent server-side). Requires login.
  async function endorseCostume(id) {
    if (!logged()) return { error: "Sign in to vote." };
    return call("/api/workshop/endorse", { body: { id: Number(id) } });
  }
  // Flag a costume as inappropriate (community moderation).
  async function flagCostume(id) {
    if (!logged()) return { error: "Sign in to flag." };
    return call("/api/workshop/flag", { body: { id: Number(id) } });
  }

  // ---- "my proposals" + curator moderation ---------------------------------
  const curator = () => !!(user && user.curator);

  // Everything the signed-in user has ever proposed, across all statuses
  // (pending / open / accepted / declined) — for the "my changes" preview,
  // the settings export, and their own submission list. Requires login.
  async function listMine() {
    if (!logged()) return [];
    const r = await call("/api/workshop/mine");
    return r && r.ok ? r.proposals : [];
  }

  // Curator-only: the moderation queue (uploads awaiting review + community-
  // flagged items) and the verdict on one item.
  async function pendingQueue() {
    if (!curator()) return { error: "Curators only." };
    const r = await call("/api/workshop/pending");
    return r && r.ok ? r.queue : (r || []);
  }
  async function review(id, decision) {
    if (!curator()) return { error: "Curators only." };
    return call("/api/workshop/review", { body: { id: Number(id), decision } });
  }

  // ---- categorical votes (player/NPC, stat direction, …) --------------------
  // These use the exclusive per-field ballot (workshop_votes): one choice per
  // (subject, field), switchable, cleared by re-picking. The server keeps no
  // per-user record in the public tally, so we remember our own picks locally
  // to highlight them — same approach the game's worksync uses.
  const MYVOTES_LS = "studio_myvotes_v1";
  let myVotes; try { myVotes = JSON.parse(localStorage.getItem(MYVOTES_LS) || "{}"); } catch (_) { myVotes = {}; }
  const persistVotes = () => { try { localStorage.setItem(MYVOTES_LS, JSON.stringify(myVotes)); } catch (_) {} };
  const voteKey = (kind, folder, field) => subjectFor(kind, folder) + "|" + field;
  const myVote = (kind, folder, field) => myVotes[voteKey(kind, folder, field)] || null;
  async function castVote(kind, folder, field, choice) {
    if (!logged()) return { error: "Sign in to vote." };
    const key = voteKey(kind, folder, field);
    const next = myVotes[key] === choice ? null : choice;    // re-pick to clear
    const r = await voteCostume(kind, folder, field, next);
    if (r && r.error) return r;
    if (next == null) delete myVotes[key]; else myVotes[key] = next;
    persistVotes();
    return { ok: true, choice: next };
  }

  // (Optional, kept for completeness.) Exclusive per-slot ballot, switchable.
  // clicking the same choice again clears it (choice:null). field is the slot
  // being filled (e.g. "state:new_outfit" or "item:torso"); choice is
  // "prop:<id>". Tally then names the winner, and its proposal names the maker.
  async function voteCostume(kind, folder, field, choice) {
    if (!logged()) return { error: "Sign in to vote." };
    return call("/api/workshop/votes", { body: { votes: [{ subject: subjectFor(kind, folder), field, choice }] } });
  }
  // Public tally for a subject: { field: { choice: count } }.
  async function tally(kind, folder) {
    const r = await call("/api/workshop/tally?subject=" + encodeURIComponent(subjectFor(kind, folder)) + "&_=" + Date.now());
    return r && r.ok ? r.fields : {};
  }

  // Resume a stored session a beat after boot.
  if (token) setTimeout(refreshMe, 300);

  return {
    call,
    getServerUrl, setServerUrl, sitekey, setSitekey,
    onAuth, refreshMe, register, login, logout, logged, username,
    passkeyLogin, redeemLinkCode,
    get user() { return user; },
    subjectFor, parseSubject, submitProposal, submitCostume,
    listCostumes, listCommunity, listProposalsRaw, listMineRaw, getCostume,
    endorseCostume, flagCostume, voteCostume, tally,
    castVote, myVote,
    curator, listMine, pendingQueue, review,
  };
})();

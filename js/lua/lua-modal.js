// ===== Taiao Lua — dialogue/choice bar + cutscene UI =====
// The picker docks exactly where js/net/live-ui.js's #livechat bar sits
// (bottom-left, below #log) — borderless numbered text lines styled like the
// log's own .msg lines, never a boxed popup. This is the ONE picker every
// scripted NPC conversation uses (tutors, traders, bankers, the Weaver,
// quest-givers) so there's never two differently-styled dialogue surfaces
// competing for the same corner of the screen. Speech itself (chatnpc/say/
// dialog's body) goes through npcSay — the overhead bubble + #log, same as
// any other NPC line; this module only renders the reply OPTIONS.
// Also carries the cutscene primitives (fade, caption, camera zoom). Loaded
// first: it creates window.__LUA and exposes __LUA.dlgbar / __LUA.cutscene
// for the host bridge.
//
// choose() resolves with a 1-BASED option index (Lua convention). Escape
// picks the LAST option (conventionally the decline) so a script can never
// soft-lock waiting for input; Enter/Space picks the first.
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});

  let el = null;
  function ensureDom() {
    if (el) return el;
    el = document.createElement("div");
    el.id = "luadlg";
    // matches js/net/live-ui.js's #livechat dock exactly — same corner of the
    // screen as the game's own chat bar, never a full-screen catcher
    el.style.cssText = "display:none;position:fixed;left:10px;bottom:8px;width:72%;max-width:860px;" +
      "z-index:45;flex-direction:column;gap:2px;font:12px OpenDyslexic, Verdana, sans-serif;";
    document.body.appendChild(el);
    el.addEventListener("mousedown", e => e.stopPropagation());
    el.addEventListener("click", e => e.stopPropagation());
    return el;
  }

  let liveKey = null;   // the currently-attached keydown listener, if any
  function teardown() {
    if (liveKey) { document.removeEventListener("keydown", liveKey, true); liveKey = null; }
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
  }

  function choose(labels) {
    teardown(); // a stray earlier picker (soft-locked script, hot reload) never stacks
    return new Promise(resolve => {
      const bar = ensureDom();
      if (!labels.length) { resolve(1); return; }
      const done = idx => { teardown(); resolve(idx); };
      bar.innerHTML = "";
      labels.forEach((label, i) => {
        const btn = document.createElement("button");
        btn.textContent = `${i + 1}. ${label}`;
        // matches css/style.css's #log .msg (borderless, left-aligned, the same
        // dark 4-direction text-shadow outline so it reads over any terrain)
        btn.style.cssText = "display:block;width:100%;text-align:left;background:none;border:none;" +
          "padding:1px 0;cursor:pointer;font:inherit;color:#a8ffc9;" +
          "text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 3px #000;";
        btn.onmouseenter = () => (btn.style.color = "#ffe9a8");
        btn.onmouseleave = () => (btn.style.color = "#a8ffc9");
        btn.onclick = e => { e.stopPropagation(); done(i + 1); };
        bar.appendChild(btn);
      });
      bar.style.display = "flex";
      liveKey = e => {
        // never steal keystrokes while the player is typing (chat bar, notes)
        const ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
        if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(labels.length); return; }
        if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); done(1); return; }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= labels.length) { e.stopPropagation(); e.preventDefault(); done(n); }
      };
      document.addEventListener("keydown", liveKey, true);
    });
  }

  L.dlgbar = { choose, isOpen: () => !!liveKey };

  // ---- cutscene primitives -------------------------------------------------
  // Each returns a Promise; wasmoon yields the running Lua coroutine until it
  // resolves. The main loop's `cine` gate (Lua.cutsceneActive()) freezes the
  // player/quest sims meanwhile — the world & renderer keep ticking.
  L.cutscene = {
    // dir 1 = fade to black, dir 0 = fade back in (and remove the veil).
    fade(dir, sec) {
      return new Promise(res => {
        sec = Math.max(0.01, sec || 0.6);
        let ov = document.getElementById("luafade");
        if (!ov) {
          ov = document.createElement("div");
          ov.id = "luafade";
          Object.assign(ov.style, { position: "fixed", inset: "0", zIndex: "8000", background: "#000", opacity: "0", pointerEvents: "none" });
          document.body.appendChild(ov);
        }
        const from = dir ? 0 : 1, to = dir ? 1 : 0;
        ov.style.transition = `opacity ${sec}s linear`;
        ov.style.opacity = String(from);
        requestAnimationFrame(() => { ov.style.opacity = String(to); });
        setTimeout(() => { if (!dir) ov.remove(); res(); }, sec * 1000 + 40);
      });
    },
    text(t, sec) {
      return new Promise(res => {
        sec = Math.max(0.1, sec || 3);
        const cap = document.createElement("div");
        Object.assign(cap.style, {
          position: "fixed", left: "0", right: "0", bottom: "12vh", zIndex: "8100", textAlign: "center",
          pointerEvents: "none", color: "#fff", padding: "0 8vw", opacity: "0", transition: "opacity 0.4s",
          font: "20px OpenDyslexic, Verdana, sans-serif", textShadow: "0 2px 8px #000",
        });
        cap.textContent = t;
        document.body.appendChild(cap);
        requestAnimationFrame(() => (cap.style.opacity = "1"));
        setTimeout(() => { cap.style.opacity = "0"; setTimeout(() => cap.remove(), 400); res(); }, sec * 1000);
      });
    },
    camZoom(z, sec) {
      return new Promise(res => {
        if (typeof camZoom === "undefined") { setTimeout(res, (sec || 1) * 1000); return; }
        const from = camZoom, to = Math.max(0.35, Math.min(3, z));
        const dur = Math.max(50, (sec || 1) * 1000), t0 = performance.now();
        (function step(t) {
          const k = Math.min(1, (t - t0) / dur);
          camZoom = from + (to - from) * k;
          if (k < 1) requestAnimationFrame(step); else res();
        })(t0);
      });
    },
  };
})();

// ===== Taiao Lua — dialogue/choice modal + cutscene UI =====
// The picker is a docked panel at BOTTOM-CENTRE (quest-dialogue convention,
// user req 2026-10-03) — a real choice panel, not a corner text dock, and no
// longer a screen-dimming centered card. This is the ONE picker every
// scripted NPC conversation uses (tutors, traders, bankers, the Weaver,
// quest-givers) so there's never two differently-styled dialogue surfaces
// competing for the player's attention.
// Speech itself (chatnpc/say/dialog's body) goes through npcSay — the
// overhead bubble + #log, same as any other NPC line; this module only
// renders the reply OPTIONS. It stays HIDDEN until it's actually the
// player's turn — i.e. until the speaking NPC's own overhead bubble
// (npc._say.until) has finished playing out — so the picker never competes
// on-screen with the line it's replying to (user req 2026-10-03).
// Also carries the cutscene primitives (fade, caption, camera zoom). Loaded
// first: it creates window.__LUA and exposes __LUA.dlgbar / __LUA.cutscene
// for the host bridge.
//
// choose() resolves with a 1-BASED option index (Lua convention). Escape
// picks the LAST option (conventionally the decline) so a script can never
// soft-lock waiting for input; Enter/Space picks the first. Whichever way an
// option is picked, the player "says" it out loud (an overhead bubble + #log
// line, same mechanism as NPC speech) and the picker disappears immediately.
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});

  let backdrop = null, box = null;
  function ensureDom() {
    if (backdrop) return box;
    backdrop = document.createElement("div");
    backdrop.id = "luadlg";
    // full-screen so it still catches clicks/keys while a choice is pending
    // (same modal-input-blocking as before), but no dark dimming fill —
    // the docked box itself, bottom-centred, carries all the visual weight
    backdrop.style.cssText = "display:none;position:fixed;inset:0;z-index:4500;" +
      "align-items:flex-end;justify-content:center;padding-bottom:7vh;background:transparent;";
    box = document.createElement("div");
    box.id = "luadlg-box";
    box.style.cssText = "width:min(560px,92vw);max-height:46vh;overflow:auto;" +
      "background:#161a26;border:1px solid #3a4a6a;border-radius:10px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.6);padding:14px 16px;display:flex;" +
      "flex-direction:column;gap:5px;font:14px OpenDyslexic, Verdana, sans-serif;";
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    backdrop.addEventListener("mousedown", e => e.stopPropagation());
    backdrop.addEventListener("click", e => e.stopPropagation());
    return box;
  }

  let liveKey = null;      // the currently-attached keydown listener, if any
  let pendingReveal = null; // setTimeout handle while waiting out the NPC's bubble
  function teardown() {
    if (pendingReveal) { clearTimeout(pendingReveal); pendingReveal = null; }
    if (liveKey) { document.removeEventListener("keydown", liveKey, true); liveKey = null; }
    if (backdrop) { backdrop.style.display = "none"; box.innerHTML = ""; }
  }

  // npc = whoever's bubble the player is replying to (resolved by the host
  // bridge from the script's bound context) — the picker waits for that
  // bubble to finish before it ever becomes visible.
  function choose(labels, npc) {
    teardown(); // a stray earlier picker (soft-locked script, hot reload) never stacks
    return new Promise(resolve => {
      const panel = ensureDom();
      if (!labels.length) { resolve(1); return; }
      const done = idx => {
        const label = labels[idx - 1];
        teardown();
        // "say" the chosen reply out loud — same bubble + #log mechanism an
        // NPC's own line uses — then the picker is already gone (teardown above)
        if (label) {
          if (typeof playerSay === "function") playerSay(label);
          if (typeof log === "function") log(`You: "${label}"`, "sys");
        }
        resolve(idx);
      };
      panel.innerHTML = "";
      labels.forEach((label, i) => {
        const btn = document.createElement("button");
        btn.textContent = `${i + 1}. ${label}`;
        btn.style.cssText = "display:block;width:100%;text-align:left;background:#1f2636;" +
          "border:1px solid #30405c;border-radius:6px;padding:8px 10px;cursor:pointer;" +
          "font:inherit;color:#dfe6f2;transition:background .1s,border-color .1s;";
        btn.onmouseenter = () => { btn.style.background = "#283248"; btn.style.borderColor = "#5a8ad8"; };
        btn.onmouseleave = () => { btn.style.background = "#1f2636"; btn.style.borderColor = "#30405c"; };
        btn.onclick = e => { e.stopPropagation(); done(i + 1); };
        panel.appendChild(btn);
      });
      const reveal = () => {
        backdrop.style.display = "flex";
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
      };
      // Wait out the NPC's bubble so the picker doesn't talk over it — but
      // CAP it: a long intro line's bubble can run 10-15s, and making the
      // player stare at the options-less screen that whole time reads as a
      // hang. 5s is enough to start reading; the bubble keeps playing above
      // the picker after it appears (user req 2026-10-03).
      const MAX_REVEAL_WAIT = 5000;
      let waitMs = (npc && npc._say && npc._say.until > performance.now()) ? (npc._say.until - performance.now()) : 0;
      if (waitMs > MAX_REVEAL_WAIT) waitMs = MAX_REVEAL_WAIT;
      if (waitMs > 0) pendingReveal = setTimeout(() => { pendingReveal = null; reveal(); }, waitMs);
      else reveal();
    });
  }

  L.dlgbar = { choose, isOpen: () => !!liveKey || !!pendingReveal };

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

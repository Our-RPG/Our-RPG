// ===== Taiao Lua — dialogue/choice modal + cutscene UI =====
// The choice/dialog overlay (ported from QuestScript's showModal) and the
// cutscene primitives (fade, caption, camera zoom). Loaded first: it creates
// window.__LUA and exposes __LUA.modal / __LUA.cutscene for the host bridge.
//
// choose()/dialog() resolve with a 1-BASED option index (Lua convention). Esc /
// clicking away picks the LAST option (conventionally the decline), so a script
// can never soft-lock waiting for input.
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});

  function showModal(opts) {
    const options = opts.options || [];
    return new Promise(resolve => {
      if (!options.length) { resolve(1); return; }
      const done = idx => { cleanup(); resolve(idx); };
      const overlay = document.createElement("div");
      overlay.id = "luachoice";
      Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "9000", display: "flex",
        alignItems: opts.title || opts.body ? "center" : "flex-end", justifyContent: "center",
        background: "rgba(0,0,0,0.3)", pointerEvents: "auto",
      });
      const panel = document.createElement("div");
      Object.assign(panel.style, {
        margin: opts.title || opts.body ? "0" : "0 0 14vh", minWidth: "280px", maxWidth: "min(540px,92vw)",
        display: "flex", flexDirection: "column", gap: "8px", padding: "18px 20px",
        background: "rgba(20,24,32,0.96)", border: "1px solid rgba(90,120,180,0.5)",
        borderRadius: "12px", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        font: "16px OpenDyslexic, Verdana, sans-serif", color: "#dfe6f2", lineHeight: "1.5",
      });
      if (opts.title) {
        const h = document.createElement("div");
        Object.assign(h.style, { color: "#ffd75e", fontWeight: "bold", fontSize: "17px", marginBottom: "4px" });
        h.textContent = opts.title;
        panel.appendChild(h);
      }
      if (opts.body) for (const para of String(opts.body).split("\n")) {
        if (!para.trim()) continue;
        const d = document.createElement("div");
        Object.assign(d.style, { margin: "5px 0", color: "#c7d2e8" });
        d.textContent = para;
        panel.appendChild(d);
      }
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" });
      options.forEach((label, idx) => {
        const b = document.createElement("button");
        b.textContent = `${idx + 1}. ${label}`;
        Object.assign(b.style, {
          textAlign: "left", padding: "10px 14px", cursor: "pointer",
          background: "rgba(255,255,255,0.06)", color: "#fff",
          border: "1px solid rgba(255,255,255,0.18)", borderRadius: "8px", font: "inherit",
        });
        b.onmouseenter = () => (b.style.background = "rgba(127,208,255,0.22)");
        b.onmouseleave = () => (b.style.background = "rgba(255,255,255,0.06)");
        b.onclick = e => { e.stopPropagation(); done(idx + 1); };
        row.appendChild(b);
      });
      panel.appendChild(row);
      overlay.appendChild(panel);
      overlay.onclick = () => done(options.length);
      const onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); done(options.length); return; }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= options.length) { e.preventDefault(); done(n); }
      };
      function cleanup() { document.removeEventListener("keydown", onKey, true); overlay.remove(); }
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(overlay);
    });
  }

  L.modal = {
    choose: labels => showModal({ options: labels }),
    dialog: (title, body, labels) => showModal({ title, body, options: labels }),
  };

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

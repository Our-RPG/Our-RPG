// ===== Our RPG — NPC dialogue engine status pill =====
// Top-right indicator, between the multiplayer "Online" pill (social-ui.js,
// top:8px) and the townfolk/location pill (gameplay/townfolk-ui.js, bumped
// to top:72px to make room): a red/green dot for whether the NPC dialogue
// engine (closed-source service behind server/src/npc.js) is actually
// reachable right now, as opposed to NPCs falling back to canned dialogue.
// Shown only when dialogue could actually use the engine — same gate
// npcEngineAvailable() uses (gameplay/npc-engine-client.js): server enabled,
// logged in. Inert (never injected) in offline/dev builds with no SERVER_URL.
"use strict";

(function () {
  if (typeof Server === "undefined" || !Server.enabled()) return;

  const css = document.createElement("style");
  css.textContent = `
#npcengine-top { position:fixed; top:40px; right:340px; z-index:50; display:none;
  align-items:center; gap:6px; background:rgba(20,26,34,0.92); color:#cfe4ff;
  border:1px solid #3a4a5a; border-radius:8px; padding:5px 11px; cursor:default;
  font:12px OpenDyslexic, Verdana, sans-serif; }
#npcengine-top.on { display:inline-flex; }
#npcengine-top .ne-dot { width:8px; height:8px; border-radius:50%; background:#d85858;
  box-shadow:0 0 6px #d85858; }
#npcengine-top.up .ne-dot { background:#58c98a; box-shadow:0 0 6px #58c98a; }`;
  document.head.appendChild(css);

  const topBtn = document.createElement("div");
  topBtn.id = "npcengine-top";
  topBtn.innerHTML = `<span class="ne-dot"></span><span>NPC engine</span>`;
  document.body.appendChild(topBtn);

  const available = () => typeof npcEngineAvailable === "function" && npcEngineAvailable();

  let polling = false;
  async function poll() {
    if (!available()) { topBtn.classList.remove("on", "up"); return; }
    topBtn.classList.add("on");
    if (polling) return;
    polling = true;
    try {
      const r = await Server.call("/api/npc/status");
      const up = !!(r && r.ok);
      topBtn.classList.toggle("up", up);
      topBtn.title = up
        ? "NPC engine connected — dialogue is AI-driven."
        : "NPC engine unreachable — NPCs are using canned dialogue for now.";
    } finally { polling = false; }
  }

  poll();
  setInterval(poll, 20000);
  if (Server.onAuth) Server.onAuth(poll);
})();

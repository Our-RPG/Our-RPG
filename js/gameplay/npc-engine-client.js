// ===== NPC dialogue engine client (thin glue) =====
// The engine itself is a closed-source server-side service (two-hop embedding
// retrieval; proxied by the Worker at /api/npc/chat — see server/src/npc.js).
// This file only: builds the structured context, calls the API, and falls
// back cleanly. With the flag off — or logged out, offline, or the server
// unconfigured — NPCs speak from the canned bank exactly as before.
//
// Loads BEFORE npc-chat.js (bundle.list); uses its top-level functions
// (npcRoleKey, NPC_ROLE_INFO, npcRetrieveReply) at call time only.
"use strict";

const NPC_ENGINE_ENABLED = true;   // soft: Worker answers {off:true} until NPC_ENGINE_URL is set

const NPC_ENGINE = {
  MEET_KEY: "taiao_npc_meet_v1",
  MOODS: ["busy", "calm", "cheerful", "concerned", "curious", "irritated",
          "pleased", "tired"],
  meetDebounce: new Map(),          // cid -> last bump ms
};

function npcEngineAvailable() {
  return NPC_ENGINE_ENABLED && typeof Server !== "undefined" &&
         Server.enabled() && Server.logged();
}

function npcEngineMeet(cid) {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(NPC_ENGINE.MEET_KEY)) || {}; }
  catch (e) {}
  const last = NPC_ENGINE.meetDebounce.get(cid) || 0;
  if (Date.now() - last > 60000) {
    NPC_ENGINE.meetDebounce.set(cid, Date.now());
    m[cid] = Math.min((m[cid] || 0) + 1, 999);
    try {
      const keys = Object.keys(m);
      if (keys.length > 400) delete m[keys[0]];   // bound the ledger
      localStorage.setItem(NPC_ENGINE.MEET_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  return m[cid] || 1;
}

function npcEngineRel(meetings) {
  return meetings <= 1 ? "unfamiliar" : meetings <= 3 ? "neutral"
       : meetings <= 7 ? "friendly" : meetings <= 15 ? "trusted" : "close";
}

function npcEngineMood(cid) {
  // deterministic per NPC per in-game-ish hour: stable within a chat,
  // drifts over a session
  const bucket = Math.floor(Date.now() / 3600000);
  let h = 0;
  const s = cid + ":" + bucket;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return NPC_ENGINE.MOODS[h % NPC_ENGINE.MOODS.length];
}

function npcEngineScrub(reply) {
  // unfilled game-state slots must never reach a bubble
  return reply
    .replace(/\{price\}\s*gold/gi, "a fair price")
    .replace(/\{item\}/gi, "that")
    .replace(/\{(price|player|name)\}/gi, "")
    .replace(/\s{2,}/g, " ").trim();
}

// Contract matches npcRetrieveReply: resolves reply string or null, never
// rejects — npc-chat.js's existing .then/.catch fallback machinery applies.
function npcEngineReply(npc, text) {
  const cid = npcCid(npc);
  const role = npcRoleKey(npc);
  const info = (typeof NPC_ROLE_INFO !== "undefined" && NPC_ROLE_INFO[role]) || null;
  const meetings = npcEngineMeet(cid);
  return Server.call("/api/npc/chat", { body: {
    text: text || null,
    npc: {
      name: npc.name || "villager",
      role,
      persona: info ? info[3] : "plain",
      mood: npcEngineMood(cid),
    },
    scene: { place: info ? info[1] : "-" },
    player: { meetings, rel: npcEngineRel(meetings) },
  } }).then(d => (d && typeof d.reply === "string" && d.reply)
                   ? npcEngineScrub(d.reply) : null)
     .catch(() => null);
}

// Unified dispatch used by npc-chat.js: engine when available, else the
// in-browser retrieval path (itself parked -> its callers fall back to canned).
function npcAnyReply(npc, text) {
  if (npcEngineAvailable()) return npcEngineReply(npc, text);
  return npcRetrieveReply(npc, text);
}

// ===== Taiao Workshop — Anthropic API client (BYO key) =====
// The one place the app talks to Claude. The user's own Anthropic API key is
// theirs and theirs alone: it is kept only in this browser (localStorage),
// sent ONLY to api.anthropic.com over TLS with an x-api-key header, and never
// to the Taiao server or anywhere else. A light obfuscation-at-rest keeps
// casual shoulder-surfers and other scripts on the page from reading it
// verbatim; it is NOT encryption — treat the key like a password on a shared
// machine. Usage is billed to the player's own Anthropic account.
//
// Powers the Ideas tab's design copilot (js/pages/ideas.js), which grounds its
// replies in the codebase digest built by studio/tools/gen_context.mjs.
"use strict";

const LLM = (function () {
  const KEY_LS = "taiao_llm_key_v1";
  const MODEL_LS = "taiao_llm_model_v1";

  // --- key at rest: XOR against a fixed pad + base64. Obfuscation, not crypto.
  const PAD = "taiao-llm-copilot-⚙";
  function scramble(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ PAD.charCodeAt(i % PAD.length));
    return btoa(unescape(encodeURIComponent(out)));
  }
  function unscramble(enc) {
    try {
      const s = decodeURIComponent(escape(atob(enc)));
      let out = "";
      for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ PAD.charCodeAt(i % PAD.length));
      return out;
    } catch (_) { return ""; }
  }

  let key = "";
  try { const v = localStorage.getItem(KEY_LS); if (v) key = unscramble(v); } catch (_) {}

  function setKey(k) {
    key = (k || "").trim();
    try { key ? localStorage.setItem(KEY_LS, scramble(key)) : localStorage.removeItem(KEY_LS); } catch (_) {}
  }
  const hasKey = () => !!key;
  const maskedKey = () => key ? key.slice(0, 4) + "…" + key.slice(-4) : "";

  // ---- model choice ----
  const MODELS = [
    ["claude-opus-4-8", "Claude Opus 4.8 — best (recommended)"],
    ["claude-sonnet-5", "Claude Sonnet 5 — fast + capable"],
    ["claude-haiku-4-5", "Claude Haiku 4.5 — cheapest"],
  ];
  const DEFAULT_MODEL = "claude-opus-4-8";
  function getModel() {
    try { return localStorage.getItem(MODEL_LS) || DEFAULT_MODEL; } catch (_) { return DEFAULT_MODEL; }
  }
  function setModel(m) {
    try { m ? localStorage.setItem(MODEL_LS, m) : localStorage.removeItem(MODEL_LS); } catch (_) {}
  }

  // ---- chat: a single non-streaming Messages call ----
  // messages: [{role: "user"|"assistant", content: "…"}]. system is an
  // optional string (omitted from the body entirely when falsy — Claude
  // treats an empty system as different from no system param at all).
  async function chat(messages, system, opts) {
    if (!key) throw new Error("Add your Anthropic API key in Settings first.");
    const body = {
      model: getModel(),
      max_tokens: (opts && opts.maxTokens) || 4096,
      messages,
    };
    if (system) body.system = system;
    // No temperature/top_p/top_k or `thinking` config: current Claude models
    // reject sampling params on this endpoint, and an omitted `thinking` is
    // the correct default here (this is a plain chat call, not agentic).
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("Couldn't reach Anthropic — check your connection.");
    }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = data && data.error && data.error.message;
      if (res.status === 401) throw new Error("Anthropic rejected the API key (401) — re-check it in Settings.");
      if (res.status === 429) throw new Error("Rate limited — give it a moment.");
      if (res.status === 529 || res.status >= 500) throw new Error("Anthropic is overloaded — try again shortly.");
      throw new Error("Anthropic error " + res.status + (msg ? ": " + msg : ""));
    }
    if (data.stop_reason === "refusal") throw new Error("The model declined that request.");
    return {
      text: (data.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
      usage: data.usage,
      model: data.model,
      stop: data.stop_reason,
    };
  }

  return { setKey, hasKey, maskedKey, getModel, setModel, MODELS, chat };
})();

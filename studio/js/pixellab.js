// ===== Our RPG Workshop — PixelLab.ai API client =====
// The one place the app talks to PixelLab. The user's API token is theirs and
// theirs alone: it is kept only in this browser (localStorage), sent ONLY to
// api.pixellab.ai over TLS with an Authorization: Bearer header, and never to
// the Taiao server or anywhere else. A light obfuscation-at-rest keeps casual
// shoulder-surfers and other scripts on the page from reading it verbatim; it
// is NOT encryption — treat the key like a password on a shared machine.
//
// PixelLab has open CORS, so these calls go straight from the page. Endpoints
// & fields verified against https://api.pixellab.ai/v2/openapi.json.
"use strict";

const PixelLab = (function () {
  const KEY_LS = "pixellab_key_v1";

  // --- key at rest: XOR against a fixed pad + base64. Obfuscation, not crypto.
  const PAD = "taiao-pixellab-studio-⚙";
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

  let token = "";
  try { const v = localStorage.getItem(KEY_LS); if (v) token = unscramble(v); } catch (_) {}

  function setKey(k) {
    token = (k || "").trim();
    try { token ? localStorage.setItem(KEY_LS, scramble(token)) : localStorage.removeItem(KEY_LS); } catch (_) {}
  }
  const hasKey = () => !!token;
  const maskedKey = () => token ? token.slice(0, 4) + "…" + token.slice(-4) : "";

  async function call(base, path, body, method) {
    if (!token) throw new Error("Add your PixelLab API key in Settings first.");
    let res;
    try {
      res = await fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: { "authorization": "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error("Couldn't reach PixelLab — check your connection.");
    }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = data && (data.detail || data.message || data.error);
      if (res.status === 401) throw new Error("PixelLab rejected the API key (401). Re-check it in Settings.");
      if (res.status === 402) throw new Error("Out of PixelLab credits (402). Top up at pixellab.ai/account.");
      if (res.status === 429) throw new Error("PixelLab is busy with your other jobs (429). Try again in a moment.");
      throw new Error("PixelLab error " + res.status + (msg ? ": " + (typeof msg === "string" ? msg : JSON.stringify(msg)) : ""));
    }
    return data;
  }
  const v2 = (path, body, method) => call(CFG.PIXELLAB_V2, path, body, method);
  const v1 = (path, body, method) => call(CFG.PIXELLAB_V1, path, body, method);

  // ---- account ----
  async function balance() { return v2("/balance"); }

  // ---- single sprite (synchronous, full control) ----
  // Mirrors the create-character / create-object web pages' one-image flow:
  // outline + shading + detail + view + direction. Returns a data URL.
  async function generateImage(opts) {
    const body = {
      description: opts.description,
      image_size: { width: opts.size || 64, height: opts.size || 64 },
      outline: opts.outline || "single color black outline",
      shading: opts.shading || "basic shading",
      detail: opts.detail || "medium detail",
      view: opts.view || "low top-down",
      no_background: opts.no_background !== false,
    };
    if (opts.direction) body.direction = opts.direction;
    if (opts.negative) body.negative_description = opts.negative;
    if (opts.seed != null && opts.seed !== "") body.seed = Number(opts.seed);
    const r = await v1("/generate-image-pixflux", body);
    // pixflux returns { image: {type,base64,format} }
    return b64ToDataUrl(r.image || r);
  }

  // ---- async jobs: characters, objects, rotations ----
  async function pollJob(jobId, onTick) {
    const started = Date.now();
    while (Date.now() - started < CFG.POLL_TIMEOUT_MS) {
      await sleep(CFG.POLL_MS);
      const j = await v2("/background-jobs/" + jobId);
      if (onTick) onTick(j);
      if (j.status === "completed") return j;
      if (j.status === "failed") throw new Error("PixelLab job failed: " + (j.error || (j.last_response && j.last_response.detail) || "unknown"));
    }
    throw new Error("PixelLab job timed out. It may still finish — check pixellab.ai.");
  }

  async function pollCharacter(characterId, onTick) {
    const started = Date.now();
    while (Date.now() - started < CFG.POLL_TIMEOUT_MS) {
      await sleep(CFG.POLL_MS);
      const c = await v2("/characters/" + characterId);
      if (onTick) onTick(c);
      if (c.status === "completed" || c.rotation_urls) return c;
      if (c.status === "failed") throw new Error("Character generation failed on PixelLab.");
    }
    throw new Error("Character generation timed out. Check pixellab.ai.");
  }

  // Create a full 8-direction character. Returns { dirs: {dir: dataUrl}, characterId }.
  async function createCharacter(opts, onTick) {
    const body = {
      description: opts.description,
      view: opts.view || "low top-down",
      template_id: opts.template || "mannequin",
      image_size: { width: opts.size || 64, height: opts.size || 64 },
      no_background: true,
    };
    if (opts.outline) body.outline = opts.outline;
    if (opts.detail) body.detail = opts.detail;
    if (opts.reference) body.reference_image = opts.reference;   // Base64Image
    if (opts.seed != null && opts.seed !== "") body.seed = Number(opts.seed);
    if (opts.name) body.name = opts.name;
    const start = await v2("/create-character-v3", body);
    const cid = start.character_id || start.id;
    if (onTick) onTick({ status: "processing" });
    const done = await pollCharacter(cid, onTick);
    return { characterId: cid, dirs: await rotationsToDataUrls(done.rotation_urls) };
  }

  // Create an 8-direction object/item. Returns { dirs, objectId }.
  async function createObject8(opts, onTick) {
    const body = {
      description: opts.description,
      size: opts.size || 64,
      view: opts.view || "low top-down",
      no_background: opts.no_background !== false,   // transparent by default (needed for wardrobe part layers)
    };
    if (opts.reference) body.reference_image = opts.reference;
    if (opts.seed != null && opts.seed !== "") body.seed = Number(opts.seed);
    const start = await v2("/create-8-direction-object", body);
    const jobId = start.background_job_id || start.job_id;
    const oid = start.object_id || start.id;
    let done;
    if (jobId) { const j = await pollJob(jobId, onTick); done = j.last_response || j; }
    else done = start;
    const rots = done.rotation_urls || (done.object && done.object.rotation_urls);
    return { objectId: oid, dirs: await rotationsToDataUrls(rots) };
  }

  // Single-direction object (icon / top-down item). Returns a data URL.
  async function createObject1(opts) {
    const body = {
      description: opts.description,
      size: opts.size || 64,
      view: opts.view || "top-down",
      no_background: opts.no_background !== false,   // transparent by default
    };
    if (opts.seed != null && opts.seed !== "") body.seed = Number(opts.seed);
    const r = await v2("/create-1-direction-object", body);
    if (r.image) return b64ToDataUrl(r.image);
    if (r.image_url) return await urlToDataUrl(r.image_url);
    // async variant
    const jobId = r.background_job_id || r.job_id;
    if (jobId) {
      const j = await pollJob(jobId);
      const rr = j.last_response || j;
      if (rr.image) return b64ToDataUrl(rr.image);
      if (rr.image_url) return await urlToDataUrl(rr.image_url);
    }
    throw new Error("PixelLab returned no image for the object.");
  }

  // Rotate one frame into all 8 directions. firstFrame is a Base64Image.
  async function rotate8(firstFrame, description, onTick) {
    const body = { first_frame: firstFrame, no_background: true };
    if (description) body.description = description;
    const start = await v2("/generate-8-rotations-v3", body);
    const jobId = start.background_job_id || start.job_id;
    let done;
    if (jobId) { const j = await pollJob(jobId, onTick); done = j.last_response || j; }
    else done = start;
    const rots = done.rotation_urls || done.rotations || done.images;
    return await rotationsToDataUrls(rots);
  }

  // Animate a first frame with a text action. Returns [dataUrl] frames.
  async function animate(firstFrame, action, frameCount, onTick) {
    const body = {
      first_frame: firstFrame, action,
      frame_count: Math.max(4, Math.min(16, (frameCount || 8) & ~1)),
      no_background: true,
    };
    const start = await v2("/animate-with-text-v3", body);
    const jobId = start.background_job_id || start.job_id;
    let done;
    if (jobId) { const j = await pollJob(jobId, onTick); done = j.last_response || j; }
    else done = start;
    const frames = done.frames || done.images || [];
    return frames.map(f => (f && f.base64) ? b64ToDataUrl(f) : (typeof f === "string" ? f : b64ToDataUrl(f)));
  }

  // rotation_urls can be a {dir:url} map OR already-inlined base64 images.
  async function rotationsToDataUrls(rots) {
    const out = {};
    if (!rots) return out;
    for (const dir of DIRS8) {
      const v = rots[dir];
      if (!v) continue;
      if (typeof v === "string") out[dir] = v.startsWith("data:") ? v : await urlToDataUrl(v);
      else if (v.base64) out[dir] = b64ToDataUrl(v);
      else if (v.url) out[dir] = await urlToDataUrl(v.url);
    }
    return out;
  }

  return {
    setKey, hasKey, maskedKey, balance,
    generateImage, createCharacter, createObject8, createObject1,
    rotate8, animate,
  };
})();

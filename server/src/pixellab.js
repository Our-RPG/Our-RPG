/* pixellab.js (server) — the SERVER-side PixelLab client (Phase 8).
 * Mirrors studio/js/pixellab.js, but runs on the worker with the player's
 * stored key so generation finishes independent of any browser. Two phases:
 *   • create(...)  — kick off a generation; returns { ref, refKind, done? }.
 *       refKind: 'character' → poll GET /v2/characters/{ref}
 *                'job'       → poll GET /v2/background-jobs/{ref}
 *                'inline'    → already finished (done = { dirs } | { image })
 *   • poll(...)    — check a started ref; returns { status, result? }.
 * Art comes back as { dir: url } maps which we inline to data URLs (fetchToDataUrl)
 * so the whole set travels in one JSON payload, exactly like the client did. */

const V2 = "https://api.pixellab.ai/v2";
const V1 = "https://api.pixellab.ai/v1";
const DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];

async function call(key, base, path, body, method) {
  const res = await fetch(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { authorization: "Bearer " + key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = data && (data.detail || data.message || data.error);
    const text = typeof msg === "string" ? msg : (msg ? JSON.stringify(msg) : "");
    const e = new Error("PixelLab " + res.status + (text ? ": " + text : ""));
    e.status = res.status;
    throw e;
  }
  return data;
}

const b64ToDataUrl = img => img && img.base64 ? `data:image/${img.format || "png"};base64,${img.base64}` : "";

async function fetchToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("art fetch failed " + res.status);
  const mime = res.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}

// rotation_urls: { dir: url | {url} | {base64} } → { dir: dataUrl }
async function rotationsToDataUrls(rots) {
  const out = {};
  if (!rots) return out;
  for (const dir of DIRS8) {
    const v = rots[dir];
    if (!v) continue;
    if (typeof v === "string") out[dir] = v.startsWith("data:") ? v : await fetchToDataUrl(v);
    else if (v.base64) out[dir] = b64ToDataUrl(v);
    else if (v.url) out[dir] = await fetchToDataUrl(v.url);
  }
  return out;
}

/* Start a generation. `job` carries the recipe fields (prompt, kind, view, size,
 * seed, bodyType, template, reference, negative). */
export async function create(key, job) {
  const kind = job.pixellab_kind;
  const desc = job.prompt;
  const view = job.view || "high top-down";
  const size = Number(job.size) || (kind === "object1" ? 32 : kind === "image" ? 64 : 128);
  const seed = job.seed != null && job.seed !== "" ? Number(job.seed) : undefined;
  const reference = job.reference || undefined;   // { type:'base64', base64, format }

  if (kind === "character") {
    const body = { description: desc, view, template_id: job.template || "mannequin", image_size: { width: size, height: size }, no_background: true };
    if (reference) body.reference_image = reference;
    if (seed != null) body.seed = seed;
    const r = await call(key, V2, "/create-character-v3", body);
    return { ref: String(r.character_id || r.id), refKind: "character" };
  }
  if (kind === "object8") {
    const body = { description: desc, size, view, no_background: true };
    if (reference) body.reference_image = reference;
    if (seed != null) body.seed = seed;
    const r = await call(key, V2, "/create-8-direction-object", body);
    const jobId = r.background_job_id || r.job_id;
    if (jobId) return { ref: String(jobId), refKind: "job" };
    const rots = r.rotation_urls || (r.object && r.object.rotation_urls);
    return { refKind: "inline", done: { dirs: await rotationsToDataUrls(rots) } };
  }
  if (kind === "object1") {
    const body = { description: desc, size, view, no_background: true };
    if (seed != null) body.seed = seed;
    const r = await call(key, V2, "/create-1-direction-object", body);
    if (r.image) return { refKind: "inline", done: { image: b64ToDataUrl(r.image) } };
    if (r.image_url) return { refKind: "inline", done: { image: await fetchToDataUrl(r.image_url) } };
    const jobId = r.background_job_id || r.job_id;
    if (jobId) return { ref: String(jobId), refKind: "job" };
    throw new Error("PixelLab returned no image for the object.");
  }
  // image (pixflux, v1) — synchronous single image
  const body = {
    description: desc, image_size: { width: size, height: size },
    outline: "single color black outline", shading: "basic shading", detail: "medium detail",
    view, no_background: true,
  };
  if (reference) body.init_image = reference;
  if (job.negative) body.negative_description = job.negative;
  if (seed != null) body.seed = seed;
  const r = await call(key, V1, "/generate-image-pixflux", body);
  return { refKind: "inline", done: { image: b64ToDataUrl(r.image || r) } };
}

/* Poll a started ref. Returns { status: 'generating'|'completed'|'failed',
 * result?, error? }. */
export async function poll(key, refKind, ref) {
  if (refKind === "character") {
    const c = await call(key, V2, "/characters/" + ref);
    if (c.status === "failed") return { status: "failed", error: "Character generation failed on PixelLab." };
    const rots = c.rotation_urls || (c.character && c.character.rotation_urls);
    if (c.status === "completed" || rots) return { status: "completed", result: { dirs: await rotationsToDataUrls(rots) } };
    return { status: "generating" };
  }
  // background job (object8 / object1-async)
  const j = await call(key, V2, "/background-jobs/" + ref);
  if (j.status === "failed") return { status: "failed", error: (j.error || (j.last_response && j.last_response.detail) || "PixelLab job failed") };
  if (j.status !== "completed") return { status: "generating" };
  const done = j.last_response || j;
  const rots = done.rotation_urls || (done.object && done.object.rotation_urls);
  if (rots) return { status: "completed", result: { dirs: await rotationsToDataUrls(rots) } };
  if (done.image) return { status: "completed", result: { image: b64ToDataUrl(done.image) } };
  if (done.image_url) return { status: "completed", result: { image: await fetchToDataUrl(done.image_url) } };
  return { status: "completed", result: { dirs: {} } };
}

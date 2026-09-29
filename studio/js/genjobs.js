// ===== Our RPG Workshop — tracked PixelLab generation jobs =====
// A shared layer used by every "generate a sprite" dialogue (the Sprites hub's
// unified generator, a state/costume generator on a sprite's own page, and the
// item-icon generator). Two things it adds on top of a bare PixelLab call:
//
//  1. A suggested prompt (+ id/name) from the offline PromptBank
//     (js/prompt-bank.js — a hand-written bank, no network call, no API key),
//     so a blank page isn't the starting point — "suggest" and "another
//     suggestion" both just call GenJobs.suggest() again for a fresh pick.
//  2. A durable job record on the Taiao server (server/src/gen.js) — start
//     before the PixelLab call, progress once the async job/character id is
//     known, complete/fail at the end. The PixelLab call itself still runs
//     client-side with the player's own key (unchanged); the server never
//     talks to PixelLab. This means a "generating…" card survives a hard
//     refresh: on the next load this module resumes polling PixelLab
//     directly using the saved id (character/object8 jobs only — the two
//     single-image kinds are synchronous PixelLab calls with no id to resume,
//     so an interrupted one is simply reported back as failed).
//
// Every caller mounts a small card row via GenJobs.mountBoard(container, opts)
// — "up top" on whichever page is relevant — showing each of the player's
// jobs as generating / completed (Upload to game · Regenerate · Delete) /
// failed (Regenerate · Delete).
"use strict";

const GenJobs = (function () {
  // jobs actively driven by THIS tab (being polled/started right now) — used
  // to dedupe against resumePending() also picking the same row up.
  const inFlight = new Set();
  const resuming = new Set();
  const resultCache = new Map();     // job id → result payload, once fetched
  const refCache = new Map();        // job id → PixelLab Base64Image reference, if the caller used one
  const boards = new Set();          // mounted board refresh() callbacks
  const notifyBoards = () => boards.forEach(fn => { try { fn(); } catch (_) {} });

  // ---------------------------------------------------------------- suggest
  // kind: "character" | "monster:humanoid" | "monster:quadruped" | "object" |
  // "item" | "state". ctx: { baseName?, taken?: Set }. Returns { prompt, id }
  // — for kind "state", id is a short state/costume name, not a sprite id.
  // Thin wrapper over PromptBank (js/prompt-bank.js) — a static, offline
  // prompt/id bank, no network call and no API key required.
  function suggest(kind, ctx) { return PromptBank.suggest(kind, ctx); }

  // ------------------------------------------------------------- execution
  // jobMeta: { spriteType, spriteId, label, subject?, prompt, bodyType?, seed?, pixellabKind }
  // pixellabFn: async (onRef) => ({ dirs } | { image }) — the actual PixelLab
  // call(s); must call onRef(refId) as soon as a resumable id is known
  // (character/object8 kinds only — see pixellab.js's opts.onRef).
  async function execute(jobMeta, pixellabFn) {
    const startRes = await Taiao.genStart(jobMeta);
    if (!startRes || !startRes.ok) throw new Error((startRes && startRes.error) || "Couldn't start the generation.");
    const jobId = startRes.id;
    inFlight.add(jobId); notifyBoards();
    try {
      const result = await pixellabFn(ref => { Taiao.genProgress(jobId, ref); });
      await Taiao.genComplete(jobId, result);
      resultCache.set(jobId, result);
      return jobId;
    } catch (e) {
      await Taiao.genFail(jobId, e && e.message || String(e));
      throw e;
    } finally {
      inFlight.delete(jobId); notifyBoards();
    }
  }

  // Record the PixelLab reference image (if any) a job was generated from —
  // openCreateStateDialog calls this right after starting a job, so a later
  // "Regenerate" from the board reruns it with the same style reference
  // instead of silently dropping it.
  function setReference(jobId, reference) { if (jobId && reference) refCache.set(jobId, reference); }

  // The generic PixelLab call for a job row's own (kind, prompt, reference) —
  // used by the default regenerate.
  function defaultPixellabFn(row) {
    const desc = row.prompt, reference = refCache.get(row.id);
    return async onRef => {
      if (row.pixellab_kind === "character") { const r = await PixelLab.createCharacter({ description: desc, view: "high top-down", size: 128, template: "mannequin", reference, onRef }); return { dirs: r.dirs }; }
      if (row.pixellab_kind === "object8") { const r = await PixelLab.createObject8({ description: desc, view: "high top-down", size: 128, reference, onRef }); return { dirs: r.dirs }; }
      if (row.pixellab_kind === "object1") { const src = await PixelLab.createObject1({ description: desc, view: "high top-down", size: 32 }); return { image: src }; }
      const src = await PixelLab.generateImage({ description: desc, view: "high top-down", size: 64, reference }); return { image: src };
    };
  }
  function jobMetaFromRow(row) {
    return { spriteType: row.sprite_type, spriteId: row.sprite_id, label: row.label, subject: row.subject || undefined, prompt: row.prompt, bodyType: row.body_type || undefined, seed: row.seed || undefined, pixellabKind: row.pixellab_kind };
  }
  async function defaultRegenerate(row) {
    const reference = refCache.get(row.id);
    const newId = await execute(jobMetaFromRow(row), defaultPixellabFn(row));
    if (reference) refCache.set(newId, reference);
    return newId;
  }

  // Generic "Upload to game" for a completed job — shared by every board
  // unless a caller passes its own opts.onUpload. Three shapes:
  //  • item icon (sprite_type "ui") → straight to a "taiao-costume/1" icon
  //    proposal, exactly like the item page's own generate-and-publish flow.
  //  • a brand-new sprite (no subject) → a local draft + the same
  //    publishProject() the Sprites hub's editor uses.
  //  • a new state/costume on an EXISTING sprite (subject set) → pushed onto
  //    that sprite's draft and shared exactly like the editor's shareCostume().
  // publishProject/shareCostume are globals defined in pages/editor.js —
  // resolved at call time, long after every page script has loaded.
  async function uploadToGame(job) {
    if (!job.result) { toast("No result to upload yet.", "warn"); return; }
    if (!Taiao.logged()) { toast("Sign in (Settings) to upload to the community.", "warn"); return; }
    if (job.sprite_type === "ui") {
      const { folder: id } = Taiao.parseSubject(job.subject || ("gen:ui:" + job.sprite_id));
      const itemName = job.label;
      const dataUrl = job.result.image || (job.result.dirs && job.result.dirs.south) || "";
      const bundle = {
        schema: "taiao-costume/1", object: { type: "ui", key: id, name: itemName }, field: "icon",
        costume: { state: "icon", slot: "", item: "", note: "", dirs: { south: dataUrl } },
        exportedAt: new Date().toISOString(),
      };
      toast("Publishing…");
      const r = await Taiao.submitProposal("ui", id, itemName + " — icon", bundle, "pixellab", "pixellab");
      if (r && r.ok) {
        toast(r.status === "accepted" ? "⚡ Straight into the game — this filled a gap!" : "Shared! The community can vote on it now.", "ok", 6000);
        await Taiao.genDelete(job.id);
      } else toast((r && r.error) || "Couldn't publish.", "err", 6000);
      return;
    }
    if (!job.subject) {
      const p = Store.newProject(job.sprite_type, job.sprite_id);
      p.prompt = job.prompt; p.spriteId = job.sprite_id; p.folder = job.sprite_id;
      p.gen = { view: "high top-down", size: (job.pixellab_kind === "object1" || job.pixellab_kind === "image") ? 32 : 128 };
      if (job.body_type) p.bodyType = job.body_type;
      p.base = job.result.dirs ? job.result.dirs : { image: job.result.image };
      p.provenance = "pixellab";
      await Store.save(p);
      await Taiao.genDelete(job.id);
      await publishProject(p);
      return;
    }
    const { kind: type, folder } = Taiao.parseSubject(job.subject);
    const drafts = await Store.all(type);
    let p = drafts.find(x => x.folder === folder);
    if (!p) {
      const prov = (typeof Providers !== "undefined") && Providers.get(type);
      const entry = prov && prov.entry && prov.entry(folder);
      p = Store.newProject(type, (entry && entry.name) || folder); p.folder = folder;
    }
    const st = { id: rid(), name: job.label, dirs: job.result.dirs || { south: job.result.image }, note: "generated with PixelLab" };
    (p.states || (p.states = [])).push(st);
    await Store.save(p);
    await Taiao.genDelete(job.id);
    await shareCostume(p, st);
  }

  // --------------------------------------------------------------- resume
  // A "generating" row this tab isn't already driving: if it's a resumable
  // kind with a saved ref, pick the poll back up; otherwise leave it for the
  // server's own staleness timeout (gen.js `mine`) to eventually fail.
  async function resumeOne(row) {
    if (row.status !== "generating" || inFlight.has(row.id) || resuming.has(row.id)) return;
    if (!row.pixellab_ref || (row.pixellab_kind !== "character" && row.pixellab_kind !== "object8")) return;
    if (!PixelLab.hasKey()) return;   // this browser can't resume without the key
    resuming.add(row.id);
    try {
      const r = row.pixellab_kind === "character"
        ? await PixelLab.resumeCharacter(row.pixellab_ref)
        : await PixelLab.resumeObject8(row.pixellab_ref);
      const result = { dirs: r.dirs };
      await Taiao.genComplete(row.id, result);
      resultCache.set(row.id, result);
    } catch (e) {
      await Taiao.genFail(row.id, e && e.message || String(e));
    } finally {
      resuming.delete(row.id); notifyBoards();
    }
  }
  function resumePending(rows) { rows.forEach(resumeOne); }

  // ----------------------------------------------------------------- board
  const TYPE_ICON = { character: "🧑", monster: "👹", object: "📦", ui: "🏷" };
  async function resultFor(job) {
    if (resultCache.has(job.id)) return resultCache.get(job.id);
    const full = await Taiao.genJob(job.id);
    const result = (full && full.result) || null;
    if (result) resultCache.set(job.id, result);
    return result;
  }
  function thumbSrc(result) {
    if (!result) return "";
    if (result.image) return result.image;
    if (result.dirs) return result.dirs.south || Object.values(result.dirs)[0] || "";
    return "";
  }
  function elapsed(job) {
    const s = Math.max(0, Math.round((Date.now() - job.created_at) / 1000));
    return s < 60 ? s + "s" : Math.round(s / 60) + "m";
  }

  async function renderBoard(container, jobs, opts) {
    clear(container);
    if (!jobs.length) return;
    const row = el("div.genjob-row");
    for (const job of jobs) {
      const card = el("div.genjob-card");
      const head = el("div.genjob-head", null, [
        el("span", { text: TYPE_ICON[job.sprite_type] || "✨" }),
        el("strong", { text: job.label, style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }),
      ]);
      card.appendChild(head);
      if (job.status === "generating") {
        card.appendChild(el("div.center-col", { style: "padding:.5rem 0" }, [
          el("div.spinner"),
          el("small", { text: "Generating… " + elapsed(job) }),
        ]));
        card.appendChild(el("p.tagline", { style: "font-size:.7rem;max-height:2.6em;overflow:hidden", text: job.prompt }));
        card.appendChild(el("div.btn-row", null, [
          el("button.btn.ghost.sm", { text: "Delete", onclick: () => del(job) }),
        ]));
      } else if (job.status === "completed") {
        const cv = el("canvas.spr", { width: 96, height: 96, style: "width:96px;height:96px" });
        const result = await resultFor(job);
        const src = thumbSrc(result);
        if (src) drawSprite(cv, src, 96);
        card.appendChild(el("div.center-col", { style: "padding:.3rem 0" }, [cv]));
        card.appendChild(el("p.tagline", { style: "font-size:.7rem;max-height:2.6em;overflow:hidden", text: job.prompt }));
        card.appendChild(el("div.btn-row", { style: "flex-wrap:wrap" }, [
          el("button.btn.sm.primary", { text: "⬆ Upload to game", onclick: () => upload(job, result) }),
          el("button.btn.sm.ghost", { text: "🔁 Regenerate", onclick: () => regen(job) }),
          el("button.btn.sm.ghost", { text: "🗑", title: "Delete", onclick: () => del(job) }),
        ]));
      } else if (job.status === "failed") {
        card.appendChild(el("p.tagline", { style: "color:#e06a6a", text: "😕 " + (job.error || "Generation failed.") }));
        card.appendChild(el("div.btn-row", null, [
          el("button.btn.sm.ghost", { text: "🔁 Regenerate", onclick: () => regen(job) }),
          el("button.btn.sm.ghost", { text: "🗑", title: "Delete", onclick: () => del(job) }),
        ]));
      }
      row.appendChild(card);
    }
    container.appendChild(row);

    async function del(job) { await Taiao.genDelete(job.id); resultCache.delete(job.id); refreshNow(); }
    async function upload(job, result) {
      try { await (opts.onUpload ? opts.onUpload({ ...job, result }) : uploadToGame({ ...job, result })); refreshNow(); }
      catch (e) { toast(e.message || String(e), "err", 6000); }
    }
    async function regen(job) {
      try { await (opts.onRegenerate ? opts.onRegenerate(job) : defaultRegenerate(job)); refreshNow(); }
      catch (e) { toast(e.message || String(e), "err", 6000); refreshNow(); }
    }
    function refreshNow() { const fn = container._genRefresh; if (fn) fn(); }
  }

  // container: an element to render the board into. opts: { subject?,
  // onUpload?(job), onRegenerate?(job) }. Returns a refresh() you can call
  // right after starting a job for an immediate update (polling also covers
  // it within a few seconds either way).
  function mountBoard(container, opts) {
    opts = opts || {};
    let timer = null;
    async function refresh() {
      if (!document.body.contains(container)) { if (timer) clearInterval(timer); boards.delete(refresh); return; }
      if (!Taiao.logged()) { clear(container); return; }
      let jobs = [];
      try { jobs = await Taiao.genMine(); } catch (_) {}
      if (opts.subject) jobs = jobs.filter(j => j.subject === opts.subject);
      resumePending(jobs.filter(j => j.status === "generating"));
      await renderBoard(container, jobs, opts);
      const anyGenerating = jobs.some(j => j.status === "generating");
      if (anyGenerating && !timer) timer = setInterval(refresh, 4000);
      if (!anyGenerating && timer) { clearInterval(timer); timer = null; }
    }
    container._genRefresh = refresh;
    boards.add(refresh);
    refresh();
    return refresh;
  }

  return { suggest, execute, mountBoard, resumePending, uploadToGame, setReference };
})();

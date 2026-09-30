// ===== Our RPG Workshop — tiny DOM + helper kit =====
// No framework: the app is a handful of classic scripts sharing one global
// scope, exactly like the game it serves. This file is the toolbox everyone
// else leans on.
"use strict";

// el("div.card#id", {attr}, [children|string]) — terse element builder.
function el(spec, attrs, kids) {
  const m = /^([a-z0-9]+)?(#[\w-]+)?((?:\.[\w-]+)*)$/i.exec(spec) || [];
  const tag = m[1] || "div";
  const node = document.createElement(tag);
  if (m[2]) node.id = m[2].slice(1);
  if (m[3]) node.className = m[3].slice(1).split(".").join(" ");
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className += (node.className ? " " : "") + v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k in node && k !== "list") { try { node[k] = v; } catch (_) { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  // In-app links are real <a href> — resolve any "#/…" target to its real page
  // URL (via Nav, defined in page-shell) and strip default link decoration so
  // navigation is plain anchors, not javascript handlers.
  if (node.tagName === "A") {
    const h = node.getAttribute("href");
    if (h && h.slice(0, 2) === "#/" && typeof Nav !== "undefined") node.setAttribute("href", Nav.url(h));
    if (node.getAttribute("href")) {
      if (!node.style.textDecoration) node.style.textDecoration = "none";
      if (!node.style.color && !node.className) node.style.color = "inherit";
    }
  }
  for (const c of [].concat(kids == null ? [] : kids)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

const qs = (sel, root) => (root || document).querySelector(sel);
const qsa = (sel, root) => [...(root || document).querySelectorAll(sel)];
const clear = node => { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };

// Non-blocking toast. type: "" | "ok" | "warn" | "err".
function toast(msg, type, ms) {
  let host = qs("#toasts");
  if (!host) { host = el("div#toasts"); document.body.appendChild(host); }
  const t = el("div.toast" + (type ? "." + type : ""), { text: msg });
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms || 3600);
}

// A toast that stays put with a spinner until the caller settles it — for a
// long op (e.g. a PixelLab generation) that shouldn't be a fire-and-forget
// message. Returns a handle: update(text) to change the label, then done(text)
// / fail(text) to swap the spinner for a final state that auto-dismisses, or
// close() to just dismiss. Idempotent once settled.
function toastLoading(msg) {
  let host = qs("#toasts");
  if (!host) { host = el("div#toasts"); document.body.appendChild(host); }
  const spin = el("span.toast-spinner");
  const label = el("span", { text: msg });
  const t = el("div.toast.loading", null, [spin, label]);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  let settled = false;
  const dismiss = () => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); };
  function settle(cls, text, ms) {
    if (settled) return;
    settled = true;
    spin.remove();
    t.className = "toast" + (cls ? " " + cls : "") + " show";
    if (text != null) label.textContent = text;
    setTimeout(dismiss, ms || 3600);
  }
  return {
    update: text => { if (!settled) label.textContent = text; },
    done: (text, ms) => settle("ok", text, ms),
    fail: (text, ms) => settle("err", text, ms || 7000),
    close: () => { if (!settled) { settled = true; dismiss(); } },
  };
}

// Base64Image (PixelLab's {type,base64,format}) → data URL, and back.
const b64ToDataUrl = img => img && img.base64 ? `data:image/${img.format || "png"};base64,${img.base64}` : "";
function dataUrlToB64(dataUrl) {
  const i = (dataUrl || "").indexOf(",");
  return i < 0 ? "" : dataUrl.slice(i + 1);
}
// Read a File/Blob into a PixelLab Base64Image object.
function fileToB64Image(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ type: "base64", base64: dataUrlToB64(r.result), format: (file.type.split("/")[1] || "png") });
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}
// Fetch a hosted PixelLab rotation URL and inline it as a data URL so the
// whole costume travels in one JSON payload (the workshop stores data URLs).
async function urlToDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("image fetch failed"));
    r.readAsDataURL(blob);
  });
}

// Draw a data-URL sprite into a canvas at a crisp, nearest-neighbour scale.
function drawSprite(canvas, src, size) {
  const px = size || canvas.width || 64;
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, px, px);
    ctx.imageSmoothingEnabled = false;
    // contain, preserving aspect
    const s = Math.min(px / img.width, px / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
  };
  img.src = src;
  return canvas;
}

// Lazily fill a thumb host with a shared proposal's south sprite once it
// scrolls into view — keeps communal grids of many generations light.
let _lazyObs = null;
const _lazyJobs = new WeakMap();
function lazyThumb(host, proposalId) {
  if (!("IntersectionObserver" in window)) { _lazyRun(host, proposalId); return; }
  if (!_lazyObs) _lazyObs = new IntersectionObserver(ents => {
    for (const e of ents) if (e.isIntersecting) { _lazyObs.unobserve(e.target); const job = _lazyJobs.get(e.target); if (job) _lazyRun(e.target, job); }
  }, { rootMargin: "200px" });
  _lazyJobs.set(host, proposalId);
  _lazyObs.observe(host);
}
async function _lazyRun(host, proposalId) {
  try {
    const p = await Taiao.getCostume(proposalId);
    const dirs = p && p.payload && p.payload.costume && p.payload.costume.dirs;
    const src = dirs && (dirs.south || dirs.image);
    if (src) { clear(host); const cv = el("canvas", { width: 128, height: 128 }); host.appendChild(cv); drawSprite(cv, src, 128); }
    else host.textContent = "👕";
  } catch (_) { host.textContent = "…"; }
}

const slug = s => String(s || "").trim().toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "untitled";
const escapeHtml = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtWhen = ms => { const d = new Date(ms); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A local id for library rows (never a security token — browser only).
function rid() {
  return "x" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

// The AI-disclosure question — shown once, right before an upload-sourced
// submission leaves the browser (see taiao.js submitProposal's `provenance`
// arg). `kind` is the short noun for the body copy ("art", "sound", …).
// Resolves "own" | "ai" (the maker's answer) or null (Cancel — abort the submit).
function askProvenance(kind) {
  return new Promise(resolve => {
    const done = v => { bg.remove(); resolve(v); };
    const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) done(null); } });
    const m = el("div.modal", { style: "width:min(480px,94vw)" });
    m.appendChild(el("span.x", { text: "×", onclick: () => done(null) }));
    m.appendChild(el("h2", { text: "One honest question" }));
    m.appendChild(el("p.tagline", { html:
      "Whose work is this?<br><br>" +
      "<b>My own</b> — I made this " + escapeHtml(kind || "work") + " myself.<br>" +
      "<b>AI-made</b> — I generated it and I'm saying so.<br><br>" +
      "Either answer is welcome here — hand-made and AI-made work both ship. The only thing that doesn't is " +
      "AI work passed off as hand-made: that gets removed when found, and repeat offenders lose the bench. " +
      "We ask because credit in Our RPG means something." }));
    m.appendChild(el("div.btn-row", { style: "margin-top:.8rem;justify-content:flex-end" }, [
      el("button.btn.ghost.sm", { text: "Cancel", onclick: () => done(null) }),
      el("button.btn.sm", { text: "AI-made — disclosed", onclick: () => done("ai") }),
      el("button.btn.primary.sm", { text: "My own work", onclick: () => done("own") }),
    ]));
    bg.appendChild(m); document.body.appendChild(bg);
  });
}

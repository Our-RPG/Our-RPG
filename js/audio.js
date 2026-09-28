// ===== Taiao — sound effects =====
// All sounds are CC0 (public domain): Kenney.nl audio packs (RPG Audio,
// Impact Sounds, Interface Sounds, Digital Audio, Music Jingles) plus two
// OpenGameArt CC0 packs (water splash/slime by rubberduck, eating crunches
// by tito). See assets/sfx/CREDITS.txt.
//
// Uses HTMLAudioElement pools rather than WebAudio: the game is played from
// file:// where fetch()ing local files is CORS-blocked, but <audio> playback
// is not. Each named sound has several variant files (name0.ogg..nameN.ogg)
// and each play picks a random variant with a little playbackRate jitter so
// repeated actions (footsteps, mining) don't machine-gun the same sample.
"use strict";

// Community overlay: js/main/proposal-overlay.js writes event-id -> src
// (dataURL or CDN URL) here for adopted community sounds. Mirrors
// ICON_OVERRIDE's role in main/assets.js — checked first in play(), and
// unlike SOUNDS it's fine for an id to have no built-in entry: community
// sounds may target event ids that currently have NO sound at all.
const SFX_OVERRIDE = {};

const SFX = (() => {
  const BASE = "assets/sfx/";
  // name -> variant count; a count of 0 means a single un-numbered file
  const SOUNDS = {
    step_grass: 5, step_stone: 5, step_snow: 5, step_sand: 5, step_wood: 5,
    wade: 3, splash_big: 0,
    swing: 2, hit: 3, hurt: 2, kill: 2,
    bow: 2, arrowhit: 2, arrowmiss: 2,
    spellword: 3, spellcast: 3, die: 0,
    chop: 3, mine: 4, fish: 3, forage: 3,
    coins: 2, pickup: 2, equip: 3, eat: 3, drink: 2,
    dooropen: 2, doorclose: 2, gate: 2, latch: 0, climb: 2,
    book: 3, click: 3, error: 2, craft: 2, anvil: 2,
    levelup: 2, quest: 0, portal: 2, attune: 0,
  };
  // Two master sliders (help panel): GAME sounds (every SFX here) and NATURE
  // sounds (birdsong.js + ambience.js read natureVol). Stored 0..1; migrates
  // the old 4-step "emberfallSfxVol" the first time (that key isn't renamed —
  // it's already a spent, read-only legacy fallback); its index mapped to the
  // old step volumes below).
  const LEGACY_STEPS = [1, 0.55, 0.28, 0];
  function loadVol(key, def, legacy) {
    let v = NaN;
    try { v = parseFloat(localStorage.getItem(key)); } catch (e) {}
    if (v >= 0 && v <= 1) return v;
    if (legacy) {
      // an emberfallSfxVol on disk means a pre-rename save whose chosen
      // step should carry over; absent that, fresh installs take `def`
      let old = null;
      try { old = localStorage.getItem("emberfallSfxVol"); } catch (e) {}
      if (old != null) {
        const i = parseInt(old, 10);
        return LEGACY_STEPS[(i >= 0 && i < 4) ? i : 1];
      }
    }
    return def;
  }
  let gameVol = loadVol("taiaoGameVol", 0.25, true);   // quiet by default (user req 2026-09-16)
  let natureVol = loadVol("taiaoNatureVol", 1.0, true); // the birds carry the game — full send
  let musicVol = loadVol("taiaoMusicVol", 0); // music.js reads this; DEFAULT OFF — no legacy key applies

  const pools = {};   // file -> [HTMLAudioElement] (reused when not playing)
  const lastAt = {};  // name -> last play time (throttle rapid repeats)

  function grab(file) {
    const pool = pools[file] || (pools[file] = []);
    for (const a of pool) if (a.paused || a.ended) return a;
    if (pool.length >= 4) return null; // cap: never stack 5 copies of one file
    const a = new Audio(BASE + file);
    a.preservesPitch = false;
    if ("mozPreservesPitch" in a) a.mozPreservesPitch = false;
    pool.push(a);
    return a;
  }

  // Same shape as grab(), but pooled per override name+src rather than per
  // built-in filename — SFX_OVERRIDE holds a dataURL/CDN URL, not a BASE-
  // relative variant file.
  const ovPools = {};
  function grabOverride(name, src) {
    const pool = ovPools[name] || (ovPools[name] = []);
    for (const a of pool) if ((a.paused || a.ended) && a.dataset.src === src) return a;
    if (pool.length >= 4) return null;
    const a = new Audio(src);
    a.dataset.src = src;
    a.preservesPitch = false;
    if ("mozPreservesPitch" in a) a.mozPreservesPitch = false;
    pool.push(a);
    return a;
  }

  function play(name, vol = 1, rate = 1) {
    const master = gameVol;
    if (master <= 0) return;
    const t = Date.now();
    // Community override: a player's own or an adopted community proposal can
    // target ANY event id, even ones with no built-in SOUNDS entry — checked
    // before the SOUNDS lookup so it isn't gated on one existing.
    const ov = SFX_OVERRIDE[name];
    if (ov) {
      if (t - (lastAt[name] || 0) < 70) return;
      lastAt[name] = t;
      const a = grabOverride(name, ov);
      if (!a) return;
      a.volume = Math.pow(Math.min(1, vol * master), 1.25);
      a.playbackRate = rate * (0.92 + Math.random() * 0.16);
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }
    const n = SOUNDS[name];
    if (n === undefined) return;
    if (t - (lastAt[name] || 0) < 70) return; // same-frame bursts play once
    lastAt[name] = t;
    const file = name + (n ? Math.floor(Math.random() * n) : "") + ".ogg";
    const a = grab(file);
    if (!a) return;
    // softened: a >1 power curve eases the mid-level clanks and clicks down
    // while full-scale sounds stay put — the whole game sits back in the mix
    a.volume = Math.pow(Math.min(1, vol * master), 1.25);
    a.playbackRate = rate * (0.92 + Math.random() * 0.16);
    a.currentTime = 0;
    // rejected before the first user gesture (autoplay policy) — just stay quiet
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  // footstep flavoured by what's underfoot: water -> wade (quiet slosh while
  // sailing), else by biome id (data.js B) — snow/ice, bare rock, sand/desert,
  // everything else grass. Wood floors aren't cheaply detectable, so interiors
  // fall back to the biome sound.
  const SNOWY = new Set([8, 9, 33]), STONY = new Set([7, 15, 16, 17, 22, 25]),
        SANDY = new Set([2, 6, 23, 27]);
  function step(x, y, water, sailing) {
    if (water) { play("wade", sailing ? 0.16 : 0.4); return; }
    const b = world.biomeAt(x, y);
    const name = SNOWY.has(b) ? "step_snow" : STONY.has(b) ? "step_stone"
               : SANDY.has(b) ? "step_sand" : "step_grass";
    play(name, 0.35);
  }

  // per-strike gathering sound keyed on the node's skill
  function gather(skill) {
    if (/mining$|^Mining$/.test(skill)) play("mine", 0.6);
    else if (skill === "Woodcutting") play("chop", 0.6);
    else if (skill === "Fishing") play("fish", 0.5);
    else play("forage", 0.5);
  }

  // craft completion, flavoured for the metal trades (anvil clank)
  function craft(skill) {
    if (/smithing|Smelting|Alloys|Toolmaking/i.test(skill)) play("anvil", 0.45);
    else play("craft", 0.35);
  }

  // ---------- nature bus (WebAudio) ----------
  // The nature layer (birdsong.js, ambience.js) routes its <audio> elements
  // through a shared WebAudio graph for a soft, layered, 3-D mix: per-voice
  // stereo PAN (where the bird is relative to the camera), a distance
  // LOW-PASS (far birds sound duller, like real air), and a gentle glue
  // compressor on the bus so overlapping voices settle into one ambience
  // instead of stacking up. Safe to use since the game went HTTP-only
  // (WebAudio can't tap file:// media). If anything here fails, callers fall
  // back to plain element volume.
  let _actx = null, _natureBus = null;
  function natureCtx() {
    if (_actx) return _actx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _actx = new AC();
      const comp = _actx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 3;
      comp.attack.value = 0.01; comp.release.value = 0.4;
      comp.connect(_actx.destination);
      _natureBus = comp;
    } catch (e) { _actx = null; }
    return _actx;
  }
  const _chains = new Map(); // element -> {ctx, pan, lp, gain}
  function natureChain(el) {
    const ctx = natureCtx();
    if (!ctx) return null;
    let ch = _chains.get(el);
    if (ch) return ch;
    try {
      const src = ctx.createMediaElementSource(el);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 16000; lp.Q.value = 0.4;
      const gain = ctx.createGain(); gain.gain.value = 0;
      let head = src;
      if (pan) { head.connect(pan); head = pan; }
      head.connect(lp); lp.connect(gain); gain.connect(_natureBus);
      el.volume = 1; // levels live in the gain node from here on
      ch = { ctx, pan, lp, gain };
      _chains.set(el, ch);
    } catch (e) { return null; }
    return ch;
  }
  // click-free control: pan/filter/level all glide over ~80 ms
  function natureSet(ch, level, panv, lpHz) {
    const t = ch.ctx.currentTime;
    ch.gain.gain.setTargetAtTime(Math.max(0, level), t, 0.08);
    if (ch.pan != null && panv != null) ch.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, panv)), t, 0.12);
    if (lpHz != null) ch.lp.frequency.setTargetAtTime(Math.max(200, lpHz), t, 0.12);
  }
  function natureResume() {
    if (_actx && _actx.state === "suspended") _actx.resume().catch(() => {});
  }

  // ---------- UI clicks + volume sliders ----------
  function bindVol(id, key, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(Math.round(get() * 100));
    el.addEventListener("input", () => {
      const v = Math.min(1, Math.max(0, el.value / 100));
      set(v);
      try { localStorage.setItem(key, String(v)); } catch (e) {}
    });
  }
  function initUi() {
    // the browser keeps AudioContexts suspended until a user gesture — wake
    // the nature bus on the first click/keypress so the ambience fades in
    document.addEventListener("click", natureResume, true);
    document.addEventListener("keydown", natureResume, true);
    // soft tick on any UI button; page-flip for the journal/bestiary tomes
    document.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("button");
      if (!btn) return;
      if (btn.id === "questbtn" || btn.id === "bestiarybtn") play("book", 0.6);
      else play("click", 0.35);
    });
    bindVol("gamevol", "taiaoGameVol", () => gameVol, v => { gameVol = v; });
    bindVol("naturevol", "taiaoNatureVol", () => natureVol, v => { natureVol = v; });
    bindVol("musicvol", "taiaoMusicVol", () => musicVol, v => { musicVol = v; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initUi);
  else initUi();

  return { play, step, gather, craft,
    natureChain, natureSet,
    gameVol: () => gameVol, natureVol: () => natureVol, musicVol: () => musicVol };
})();

// terse global helpers, matching the codebase's bare-function call style
function sfx(name, vol, rate) { SFX.play(name, vol, rate); }
function sfxNatureVol() { return SFX.natureVol(); } // birdsong.js / ambience.js master
function sfxStep(x, y, water, sailing) { SFX.step(x, y, water, sailing); }
function sfxGather(skill) { SFX.gather(skill); }
function sfxCraft(skill) { SFX.craft(skill); }

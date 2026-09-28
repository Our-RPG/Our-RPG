// ===== Taiao — music: generative exploration layer + cinematic themes =====
// The exploration layer is not a recording: it is synthesized live from the
// world's real state, the same signals the weather and daylight systems run
// on. Latitude sets the register (polar = low and dark, equatorial = higher
// and warmer), daylight picks the mode and brightness, cloud cover dims the
// filter, the geostrophic wind breathes through it, and storms pull the
// harmony sour. A slow pad chord turns over every ~25s with occasional high
// "sparkle" bells in clear daylight — always quiet, always under the world's
// own sounds. Cinematic themes (the Bifrost crossing) are recorded tracks in
// assets/music/ (credits in assets/music/CREDITS.txt), played through the
// same "Music" volume slider (audio.js taiaoMusicVol).
"use strict";

const MUSIC = (() => {
  const BASE = "assets/music/";
  let ctx = null, master = null, filt = null, lfo = null, lfoGain = null;
  let voices = [];          // current pad chord's note gains (released on change)
  let nextChordAt = 0, nextLogicAt = 0, bellAt = 0;
  let level = 0;            // eased master level (pre music-volume)
  let theme = null, themeFade = null; // cinematic <audio> + its fade timer

  const mvol = () => (typeof SFX !== "undefined" && SFX.musicVol) ? SFX.musicVol() : 0.55;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  function boot() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    // one soft low-pass shapes the whole layer; daylight opens it, night and
    // cloud close it down to a distant glow
    filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 900; filt.Q.value = 0.4;
    filt.connect(master); master.connect(ctx.destination);
    // the wind breathes through the filter: a very slow LFO whose depth
    // follows the real wind speed at the player
    lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
    // same suspended-until-gesture dance as the nature bus
    const wake = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    document.addEventListener("click", wake, true);
    document.addEventListener("keydown", wake, true);
    return true;
  }

  // mode palettes as semitone degrees — bright day, night, and storm-soured
  const DEG_DAY = [0, 2, 4, 7, 9, 11, 14, 16];
  const DEG_NIGHT = [0, 3, 5, 7, 10, 12, 15, 17];
  const DEG_STORM = [0, 2, 3, 7, 8, 12, 14, 15];

  function worldState() {
    const w = typeof weatherNow === "function" ? weatherNow() : null;
    const day = typeof daylightNow === "function" ? daylightNow() : 1;
    const lat = (world && world.latitudeAt) ? world.latitudeAt(player.x, player.y) : 0.5;
    const kn = w ? ((typeof windKn === "function") ? windKn(w.wind) : Math.hypot(w.wind.x, w.wind.y) * 10) : 7;
    return { day, lat, cloud: w ? w.cloud : 0.3, storm: w ? w.storm : 0,
             precip: w ? w.precip : 0, wind: Math.min(1, kn / 26) };
  }

  function padNote(midi, gain, t) {
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(gain, t, 3.2);         // ~10s swell in
    // two barely-detuned sines beat gently against each other — the whole
    // "instrument"; anything richer fights the birdsong
    for (const det of [0, 3.5]) {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.value = hz(midi); o.detune.value = det;
      o.connect(g); o.start(t);
      g._oscs = (g._oscs || []).concat(o);
    }
    g.connect(filt);
    return g;
  }

  function newChord(s) {
    const t = ctx.currentTime;
    for (const v of voices) {                     // old chord dissolves under the new
      v.gain.setTargetAtTime(0, t, 3.5);
      for (const o of v._oscs) o.stop(t + 16);
    }
    voices = [];
    // register: equator sits a fourth above the pole; night settles lower
    const root = 45 - Math.round(s.lat * 5) - (s.day < 0.35 ? 2 : 0);
    const degs = s.storm > 0.45 ? DEG_STORM : (s.day > 0.5 ? DEG_DAY : DEG_NIGHT);
    // low root drone + three upper tones picked from the palette
    const picks = [root];
    const pool = degs.slice(1);
    for (let i = 0; i < 3; i++)
      picks.push(root + 12 + pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    for (let i = 0; i < picks.length; i++)
      voices.push(padNote(picks[i], i === 0 ? 0.09 : 0.055, t));
    nextChordAt = now + (18000 + Math.random() * 14000);
  }

  function bell(s) {
    // a single high harmonic, rung softly and left to die — clear-sky daylight
    const t = ctx.currentTime;
    const degs = s.day > 0.5 ? DEG_DAY : DEG_NIGHT;
    const midi = 45 - Math.round(s.lat * 5) + 36 + degs[Math.floor(Math.random() * 5)];
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.028 + 0.03 * s.day, t + 0.06);
    g.gain.setTargetAtTime(0, t + 0.08, 1.8);
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz(midi);
    o.connect(g); g.connect(filt); o.start(t); o.stop(t + 9);
  }

  function tick() {
    // the generative layer is retired — birdsong is the ambience now
    return;
    if (typeof player === "undefined" || !player || typeof gameReady === "undefined" || !gameReady) return;
    if (now < nextLogicAt) return;
    nextLogicAt = now + 1000;
    const mv = mvol();
    if (!ctx && (mv <= 0 || !boot())) return;     // slider at zero: never even build the graph
    const s = worldState();
    // target loudness: a quiet bed, dimmer at night, muffled indoors,
    // silent under a cinematic theme or the Bifrost crossing
    let tgt = 0.20 * (0.7 + 0.3 * s.day);
    if (world && world.insideBuilding && world.insideBuilding(player.x, player.y)) tgt *= 0.5;
    if (theme || (typeof Bifrost !== "undefined" && Bifrost.active && Bifrost.active())) tgt = 0;
    level += (Math.min(1, tgt * mv) - level) * 0.12;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(level, t, 0.6);
    // brightness: daylight opens the filter, cloud pulls it back down
    filt.frequency.setTargetAtTime(450 + 2000 * s.day * (1 - 0.55 * s.cloud), t, 2.5);
    lfoGain.gain.setTargetAtTime(60 + 700 * s.wind, t, 2.5);
    if (level > 0.004) {
      if (now >= nextChordAt) newChord(s);
      // sparkle bells favour clear daylight and shy away from rain
      if (now >= bellAt && Math.random() < 0.06 * (0.2 + s.day) * (1 - s.cloud) * (1 - s.precip)) {
        bell(s); bellAt = now + 6000;
      }
    }
  }

  // ---------- cinematic themes (recorded tracks) ----------
  function cinematic(name) {
    // no-op — the user wants no music anywhere, including the Bifrost theme
    return;
    stopCinematic(0.2);
    theme = new Audio(BASE + name + ".ogg");
    theme.volume = 0;
    const p = theme.play(); if (p && p.catch) p.catch(() => {});
    const el = theme, t0 = performance.now();
    themeFade = setInterval(() => {               // ~1.6s fade-in to the music slider's level
      const f = Math.min(1, (performance.now() - t0) / 1600);
      el.volume = Math.min(1, 0.9 * f * mvol());
      if (f >= 1) { clearInterval(themeFade); themeFade = null; }
    }, 60);
  }
  function stopCinematic(fadeS) {
    if (!theme) return;
    const el = theme; theme = null;
    if (themeFade) { clearInterval(themeFade); themeFade = null; }
    const v0 = el.volume, t0 = performance.now(), ms = Math.max(60, (fadeS || 1) * 1000);
    const iv = setInterval(() => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      el.volume = v0 * (1 - f);
      if (f >= 1) { clearInterval(iv); el.pause(); el.removeAttribute("src"); }
    }, 60);
  }

  return { tick, cinematic, stopCinematic };
})();

function musicTick() { MUSIC.tick(); }

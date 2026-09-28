// ===== Taiao Workshop — atmosphere =====
// The little bits of life that make the atelier feel like the game's world
// leaking into the page: the night-sky canvas behind the Home hero (stars +
// aurora ribbons, the same sky the game hangs over the ngahere), staggered
// scroll reveals, count-up census numbers, and a frieze of the game's real
// sprites standing along the hero's horizon. Everything here is decoration:
// every function no-ops safely if its ingredients are missing, and all motion
// respects prefers-reduced-motion (a single static frame instead).
"use strict";

const FX = (function () {
  const reduced = () => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; }
  };

  // ---- the night sky: stars + slow aurora ribbons on a hero canvas --------
  // Draws in device pixels, sized to the canvas's CSS box. Animated at a lazy
  // ~30fps cap; with reduced motion it renders one frame and stops.
  function sky(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, stars = [], raf = 0, last = 0;

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      // a seeded-ish field: more, fainter stars near the top
      stars = [];
      const n = Math.round((W * H) / 5200);
      for (let i = 0; i < n; i++) {
        const y = Math.pow(Math.random(), 1.6) * H;
        stars.push({ x: Math.random() * W, y, r: Math.random() < .12 ? 1.6 : Math.random() < .5 ? 1 : .6, p: Math.random() * Math.PI * 2, s: .4 + Math.random() * .9 });
      }
    }

    // one aurora ribbon: a soft ridge of light drawn as stacked translucent arcs
    function ribbon(t, base, amp, hue, alpha, drift) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const steps = 26;
      for (let i = 0; i < steps; i++) {
        const k = i / steps;
        ctx.beginPath();
        for (let x = -40; x <= W + 40; x += Math.max(18, W / 60)) {
          const y = base * H
            + Math.sin(x / (W * .21) + t * drift + k * 1.9) * amp * H
            + Math.sin(x / (W * .073) - t * drift * 1.7) * amp * .35 * H
            - k * H * .16;
          if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "hsla(" + (hue + k * 46) + ",72%,62%," + (alpha * (1 - k) * (1 - k)) + ")";
        ctx.lineWidth = Math.max(1.5, H * .012);
        ctx.stroke();
      }
      ctx.restore();
    }

    function frame(t) {
      ctx.clearRect(0, 0, W, H);
      // stars twinkle very gently
      ctx.fillStyle = "#eae4d2";
      for (const s of stars) {
        ctx.globalAlpha = .25 + .55 * Math.abs(Math.sin(s.p + t * s.s));
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      // two ribbons: spring-green low, teal→violet higher and fainter
      ribbon(t, .34, .05, 150, .05, .12);
      ribbon(t, .22, .04, 172, .035, .09);
      // ground glow at the horizon line
      const g = ctx.createLinearGradient(0, H * .8, 0, H);
      g.addColorStop(0, "rgba(86,227,159,0)");
      g.addColorStop(1, "rgba(86,227,159,.05)");
      ctx.fillStyle = g;
      ctx.fillRect(0, H * .8, W, H * .2);
    }

    function loop(ms) {
      if (ms - last >= 33) { last = ms; frame(ms / 1000); }
      raf = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", () => { resize(); frame(0); });
    if (reduced()) { frame(1.4); return; }
    raf = requestAnimationFrame(loop);
    // don't burn frames in background tabs
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(loop);
    });
  }

  // ---- staggered scroll reveal for .fxr blocks ----------------------------
  function reveal(root) {
    const els = (root || document).querySelectorAll(".fxr");
    if (!els.length) return;
    if (reduced() || typeof IntersectionObserver === "undefined") {
      els.forEach(e => e.classList.add("in"));
      return;
    }
    let stagger = 0;
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        io.unobserve(el);
        setTimeout(() => el.classList.add("in"), (stagger++ % 4) * 70);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    els.forEach(e => io.observe(e));
  }

  // ---- count-up census numbers --------------------------------------------
  function count(el, target, suffix) {
    const n = Number(target) || 0;
    if (reduced() || n < 8) { el.textContent = String(n) + (suffix || ""); return; }
    const t0 = performance.now(), dur = 900;
    (function tick(t) {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(n * (1 - Math.pow(1 - k, 3)))) + (suffix || "");
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  // ---- the frieze: real game sprites standing on the hero's horizon -------
  // Uses the studio's own SprRender/Roster (already loaded on every page) to
  // draw a handful of the game's actual monsters/characters. Silent no-op if
  // the atlases aren't wired in (a detached deploy without game data).
  const FRIEZE_KEYS = ["kea", "wolf", "slime", "kereru", "troll", "boar", "pixie", "stag", "kaka", "bandit"];
  function frieze(host, px) {
    if (!host || typeof SprRender === "undefined" || typeof MONSTERS === "undefined") return;
    const size = px || 48;
    let drawn = 0;
    for (const k of FRIEZE_KEYS) {
      if (drawn >= 8) break;
      const def = MONSTERS[k];
      if (!def || !def.spr) continue;
      const cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      cv.title = def.name || k;
      try { SprRender.drawKeys(cv, Array.isArray(def.spr) ? def.spr : [def.spr], size); } catch (_) { continue; }
      cv.style.animation = reduced() ? "" : "friezebob " + (2.6 + (drawn % 3) * .5) + "s ease-in-out " + (drawn * .21) + "s infinite";
      host.appendChild(cv);
      drawn++;
    }
    if (drawn && !document.getElementById("friezebob-kf")) {
      const st = document.createElement("style");
      st.id = "friezebob-kf";
      st.textContent = "@keyframes friezebob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }";
      document.head.appendChild(st);
    }
  }

  return { sky, reveal, count, frieze, reduced };
})();

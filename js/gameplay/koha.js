// ===== Our RPG — the keepers' letter (koha, without a shadow of pressure) =====
// Audit §9, implemented to the letter of its absolute rules:
//   · Triggers on ATTENTIVE hours (Play Pulse's AFK-weighted totalSec), not
//     wall clock: first mention at 10 attentive hours, repeats every 40.
//   · Never in the first session, never mid-action, never modal — a quiet
//     toast that a letter has arrived; reading it is the player's choice.
//   · Diegetic: a bird brings a letter from Tūhura's keepers when you next
//     open a bank (or, failing that, at the next long quiet moment).
//   · The letter shows the REAL monthly cost from the transparency endpoint,
//     says koha is welcome and never expected, and offers a prominent
//     "please never mention this again" that is honoured forever.
// Requires a server build (SERVER_URL): without live numbers and a way to
// give there is nothing honest to say, so the letter simply never exists.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const ENABLED = !DEV && typeof SERVER_URL !== "undefined" && !!SERVER_URL;
  if (!ENABLED) { window.Koha = { status: () => "disabled" }; return; }

  const LS_KEY = "taiao_koha_v1";
  const FIRST_H = 10, EVERY_H = 40;
  const QUIET_FALLBACK_MS = 30 * 60 * 1000;  // eligible this long -> quiet-moment delivery
  const QUIET_IDLE_S = 10;                   // seconds with no action = a quiet moment

  let K;
  try { K = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { K = null; }
  if (!K) K = { nextAtH: FIRST_H, never: false, shown: 0 };
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(K)); } catch (e) {} };

  const attentiveHours = () => {
    try { return Pulse._store().totalSec / 3600; } catch (e) { return 0; }
  };
  const pastFirstSession = () => { try { return Pulse._store().sessions >= 2; } catch (e) { return false; } };

  let eligibleSince = 0;   // wall-clock when the threshold was crossed
  let quietS = 0;
  let delivered = false;   // toast shown this eligibility (awaiting read/dismiss)

  function eligible() {
    return !K.never && !delivered && pastFirstSession() && attentiveHours() >= K.nextAtH;
  }

  // Bank moment: chain-wrap openBank the same way pulse.js does.
  if (typeof openBank === "function") {
    const orig = openBank;
    openBank = function (node) {
      const r = orig(node);
      try { if (eligible()) deliver("by bird, to the bank's counter"); } catch (e) {}
      return r;
    };
  }

  setInterval(() => {
    try {
      if (typeof gameReady === "undefined" || !gameReady || document.hidden) return;
      if (!eligible()) { eligibleSince = 0; return; }
      if (!eligibleSince) eligibleSince = Date.now();
      // fallback: a long-eligible player who never banks gets it at a quiet moment
      if (Date.now() - eligibleSince < QUIET_FALLBACK_MS) return;
      quietS = (typeof player !== "undefined" && !player.act && !player.dying) ? quietS + 1 : 0;
      if (quietS >= QUIET_IDLE_S) deliver("by bird, while things were quiet");
    } catch (e) {}
  }, 1000);

  // ---------- delivery: a quiet toast, then the letter on request ----------
  function deliver(how) {
    delivered = true;
    quietS = 0;
    if (typeof log === "function") log(`A pīwakawaka alights nearby with a letter for you (${how}).`, "sys");
    toast();
  }

  let toastEl = null;
  function toast() {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "koha-toast";
      toastEl.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:7999;max-width:300px;" +
        "background:#161a26;border:1px solid #3a4a6a;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.5);" +
        "padding:10px 14px;color:#dfe6f2;font-size:13px;line-height:1.45;";
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = `<div style="color:#ffd75e;font-weight:bold;">A letter from the keepers</div>
<div style="margin:4px 0 8px;color:#b8c4dd;">A small bird has brought you a folded note. It can wait as long as you like.</div>
<button id="koha-read" style="background:#241c38;border:1px solid #6a5a2a;color:#ffd75e;border-radius:4px;cursor:pointer;padding:3px 10px;font-size:12px;">Read it</button>
<button id="koha-later" style="background:none;border:1px solid #3a3050;color:#8fa3c8;border-radius:4px;cursor:pointer;padding:3px 10px;font-size:12px;margin-left:6px;">Later</button>`;
    toastEl.style.display = "block";
    toastEl.querySelector("#koha-read").onclick = () => { toastEl.style.display = "none"; openLetter(); };
    toastEl.querySelector("#koha-later").onclick = () => {
      toastEl.style.display = "none";
      // "later" = don't reschedule far out; re-offer after another attentive hour
      delivered = false; K.nextAtH = attentiveHours() + 1; persist();
    };
  }

  let letterEl = null;
  async function openLetter() {
    if (!letterEl) {
      letterEl = document.createElement("div");
      letterEl.id = "koha-letter";
      letterEl.style.cssText = "position:absolute;inset:0;z-index:64;background:rgba(16,12,22,0.94);display:flex;align-items:center;justify-content:center;";
      (document.getElementById("gamecol") || document.body).appendChild(letterEl);
    }
    letterEl.style.display = "flex";
    letterEl.innerHTML = `<div style="max-width:480px;background:#1d1729;border:1px solid #6a5a2a;border-radius:10px;padding:22px 26px;color:#d8d2e8;font-size:13px;line-height:1.6;box-shadow:0 12px 40px rgba(0,0,0,.6);" id="koha-paper">…</div>`;
    const hrs = Math.floor(attentiveHours());
    let costLine = "Running the world costs a few dollars a month — the exact number lives on the transparency page.";
    try {
      const r = await Server.call("/api/koha/transparency");
      if (r.ok && r.current)
        costLine = `Running the world — the vault, the tallies, the lists — cost <b>$${(r.current.usd_cents / 100).toFixed(2)}</b> in ${r.current.month}` +
          (r.players30d > 1 ? `, shared across ${r.players30d} players` : "") + `. That's the whole bill; the numbers are public.`;
    } catch (e) {}
    // Ground the ask in something already true on this player's screen: the
    // newest community-adopted work, by name. Strictly honest — whatever made
    // the art, the wires that deliver it to every player are what koha funds.
    try {
      const l = typeof ProposalOverlay !== "undefined" && ProposalOverlay.latest && ProposalOverlay.latest();
      if (l) {
        const who = l.username ? "@" + l.username : "one of us";
        const what = l.title || String(l.subject || "").split(":").pop().replace(/_/g, " ");
        costLine += ` The wires that carried ${who}'s “${what}” into everyone's world are the same ones koha keeps lit.`;
      }
    } catch (e) {}
    letterEl.querySelector("#koha-paper").innerHTML = `
<div style="color:#ffe97a;font-weight:bold;letter-spacing:1px;margin-bottom:8px;">From the keepers of Tūhura Isle</div>
<p>You've walked this world for ${hrs} attentive hours now. Thank you — a world is only real while someone is in it.</p>
<p>${costLine}</p>
<p>If you ever feel like leaving a koha, it is welcome and never expected — <a href="https://ko-fi.com/taiao" target="_blank" rel="noopener" style="color:#ffd75e;">ko-fi.com/taiao</a> is the road. Nothing in Our RPG is metered, gated, or worse without it; the licence makes that a structural promise, not a polite one. <span style="color:#7d90a8;">(docs/koha.md in the repository tells the whole honest story of what it funds — and what it never will.)</span></p>
<p style="color:#7d90a8;">This letter returns, at most, every forty attentive hours. Or never again, if you prefer — we will honour that without another word.</p>
<div style="margin-top:14px;">
<button id="koha-close" style="background:#241c38;border:1px solid #3a3050;color:#d8d2e8;border-radius:4px;cursor:pointer;padding:4px 12px;font-size:12px;">Fold it away</button>
<button id="koha-never" style="background:none;border:1px solid #3a3050;color:#8fa3c8;border-radius:4px;cursor:pointer;padding:4px 12px;font-size:12px;margin-left:8px;">Please never mention this again</button>
</div>`;
    const done = () => { letterEl.style.display = "none"; };
    letterEl.querySelector("#koha-close").onclick = () => {
      K.shown++; K.nextAtH = attentiveHours() + EVERY_H; delivered = false; persist(); done();
    };
    letterEl.querySelector("#koha-never").onclick = () => {
      K.never = true; persist(); done();
      if (typeof log === "function") log("The keepers will never mention it again. Kia ora.", "sys");
    };
  }

  window.Koha = {
    status: () => ({ attentiveH: attentiveHours(), nextAtH: K.nextAtH, never: K.never, shown: K.shown }),
    _open: openLetter,   // console/dev hook for copy review
  };
})();

// ===== Our RPG Workshop — Statistics =====
// Public aggregate analytics (server/src/analytics.js): the tutorial funnel —
// where players reach, stall and quit on Tūhura Isle — plus mean/stddev stage
// times and what players actually do per stage, and the Play Pulse read on which
// activities the crew loves vs. bounces off. Raw per-player data is private
// (ADMIN_TOKEN only) and never served here; this page shows only anonymous
// aggregates. See js/gameplay/tut-analytics.js (capture) + pulse.js.
"use strict";

// keeper-stage ids (server returns the id + idx) → friendly labels.
const STAGE_LABEL = {
  guide: "Guide (Kwame)", bush: "Bushman", swim: "Swimming", fish: "Fishing",
  smith: "Smith (Menkaure)", war: "Warrior", wood: "Woodcraft", bank: "Banker (Torvak)",
  farm: "Farmhand (Kenji)", cook: "Cook (Aldric)", candle: "Candlemaker", lore: "Lore",
  sky: "Skywatcher", ferry: "Navigator (Sigrid)",
};
const stageLabel = (s, idx) => STAGE_LABEL[s] || (s ? s[0].toUpperCase() + s.slice(1) : "Stage " + idx);

function fmtMs(ms) {
  ms = Math.max(0, Math.round(ms || 0));
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + "m " + r + "s" : m + "m";
}
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

// a horizontal bar: label · bar(width%) · value
function barRow(label, frac, valueText, colour) {
  const w = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
  return el("div", { style: "display:grid;grid-template-columns:150px 1fr auto;gap:.6rem;align-items:center;margin:.22rem 0" }, [
    el("div", { style: "font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: label, text: label }),
    el("div", { style: "background:var(--bg-2,#1c1f2c);border-radius:4px;height:14px;overflow:hidden" }, [
      el("div", { style: "height:100%;width:" + w + "%;background:" + (colour || "var(--accent,#56e39f)") + ";border-radius:4px" }),
    ]),
    el("div", { style: "font-size:.74rem;color:var(--ink-dim);font-variant-numeric:tabular-nums;white-space:nowrap", text: valueText }),
  ]);
}

function pageStats(root) {
  clear(root);
  const page = el("div.page");
  page.appendChild(el("h2", { text: "Statistics" }));
  page.appendChild(el("p.tagline", { html:
    "Anonymous, aggregate analytics across everyone who plays. The <b>tutorial funnel</b> shows where new players reach, " +
    "stall and leave on Tūhura Isle; the <b>Play Pulse</b> reads which activities the crew loves or bounces off. " +
    "Individual players are never identified here." }));

  const tutHost = el("div"); page.appendChild(tutHost);
  const pulseHost = el("div"); page.appendChild(pulseHost);
  root.appendChild(page);

  tutHost.appendChild(el("p.tagline", { text: "Loading tutorial funnel…" }));
  (async () => {
    let d = null; try { d = await Taiao.tutorialStats(); } catch (_) {}
    clear(tutHost);
    if (!d) { tutHost.appendChild(el("div.empty", { text: "Couldn't load tutorial statistics — try again in a moment." })); return; }
    renderTutorial(tutHost, d);
  })();

  pulseHost.appendChild(el("p.tagline", { text: "Loading Play Pulse…" }));
  (async () => {
    let d = null; try { d = await Taiao.pulseStats(); } catch (_) {}
    clear(pulseHost);
    if (!d) { pulseHost.appendChild(el("div.empty", { text: "Couldn't load Play Pulse statistics." })); return; }
    renderPulse(pulseHost, d);
  })();
}

function statTile(label, value, sub) {
  return el("div", { style: "flex:1;min-width:130px;background:var(--bg-2,#1c1f2c);border:1px solid var(--line,#2a2d3d);border-radius:8px;padding:.6rem .7rem" }, [
    el("div", { style: "font-size:1.35rem;font-weight:700;color:var(--accent,#56e39f)", text: value }),
    el("div", { style: "font-size:.72rem;color:var(--ink-dim);margin-top:.15rem", text: label }),
    sub ? el("div", { style: "font-size:.66rem;color:var(--ink-dim);opacity:.8", text: sub }) : null,
  ]);
}

function renderTutorial(host, d) {
  const ov = d.overall || {}, stages = d.stages || [];
  if (!ov.sessions) {
    host.appendChild(el("div.card", null, [el("p.tagline", { text: "No tutorial sessions recorded yet. Once players run the Tūhura Isle tutorial, the funnel and stage timings appear here." })]));
    return;
  }

  // overall tiles
  const ovCard = el("div.card");
  ovCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Tutorial — overview ", el("span.hint", { text: ov.sessions + " sessions" })])]));
  ovCard.appendChild(el("div", { style: "display:flex;gap:.6rem;flex-wrap:wrap" }, [
    statTile("Sessions", String(ov.sessions)),
    statTile("Graduated", Math.round(ov.gradRate * 100) + "%", ov.graduated + " reached the Bifrost"),
    statTile("Median stages reached", String(ov.meanStagesReached), "of " + (stages.length || 15)),
    statTile("Mean time in tutorial", fmtMs(ov.meanMs), "± " + fmtMs(ov.stddevMs)),
    statTile("Active / idle", fmtMs(ov.meanActiveMs) + " / " + fmtMs(ov.meanIdleMs), "mean per session"),
    statTile("Mean deaths", String(ov.meanDeaths)),
  ]));
  host.appendChild(ovCard);

  // funnel — reached vs completed per stage (drop-off = quit points)
  const base = stages.length ? Math.max(...stages.map(s => s.reached)) : 1;
  const fCard = el("div.card");
  fCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Funnel ", el("span.hint", { text: "how many players reach and complete each stage" })])]));
  let prevReached = base;
  for (const s of stages) {
    const dropPct = prevReached ? Math.round(((prevReached - s.reached) / prevReached) * 100) : 0;
    const drop = dropPct >= 20 && prevReached > s.reached;
    fCard.appendChild(barRow(
      (s.idx + 1) + ". " + stageLabel(s.stage, s.idx),
      s.reached / base,
      s.reached + " reached · " + s.completed + " done" + (drop ? "  ▼" + dropPct + "%" : ""),
      drop ? "#e0a94a" : "var(--accent,#56e39f)"));
    prevReached = s.reached;
  }
  fCard.appendChild(el("p.hint", { style: "margin-top:.5rem;font-size:.7rem", text: "▼ marks a ≥20% drop from the previous stage — a likely confusion or quit point." }));
  host.appendChild(fCard);

  // per-stage time (bottlenecks) with stddev + idle share
  const maxMs = stages.length ? Math.max(1, ...stages.map(s => s.meanMs)) : 1;
  const tCard = el("div.card");
  tCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Time per stage ", el("span.hint", { text: "mean ± std-dev; longest = bottleneck" })])]));
  for (const s of stages) {
    const idleShare = s.meanMs ? pct(s.meanIdleMs, s.meanMs) : 0;
    tCard.appendChild(barRow(
      (s.idx + 1) + ". " + stageLabel(s.stage, s.idx),
      s.meanMs / maxMs,
      fmtMs(s.meanMs) + " ±" + fmtMs(s.stddevMs) + (idleShare >= 25 ? "  · " + idleShare + "% idle" : ""),
      idleShare >= 40 ? "#8f7ef0" : "var(--accent2,#3ec6c0)"));
  }
  host.appendChild(tCard);

  // what players do per stage
  const aCard = el("div.card");
  aCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Activity per stage ", el("span.hint", { text: "mean actions while on each stage" })])]));
  const th = "border-bottom:1px solid var(--line,#333);padding:.35rem .5rem;text-align:left;font-size:.68rem;color:var(--ink-dim);white-space:nowrap";
  const td = "border-bottom:1px solid var(--line,#222);padding:.35rem .5rem;font-size:.76rem;font-variant-numeric:tabular-nums";
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["Stage", "Gathers", "Crafts", "Kills", "Deaths", "Talks", "Walk (tiles)", "Idle"].map(h => el("th", { style: th, text: h }))));
  for (const s of stages) {
    table.appendChild(el("tr", null, [
      el("td", { style: td, text: (s.idx + 1) + ". " + stageLabel(s.stage, s.idx) }),
      el("td", { style: td, text: String(s.meanGather) }),
      el("td", { style: td, text: String(s.meanCraft) }),
      el("td", { style: td, text: String(s.meanKills) }),
      el("td", { style: td, text: String(s.meanDeaths) }),
      el("td", { style: td, text: String(s.meanTalks) }),
      el("td", { style: td, text: String(s.meanWalkTiles) }),
      el("td", { style: td, text: fmtMs(s.meanIdleMs) }),
    ]));
  }
  aCard.appendChild(el("div", { style: "overflow-x:auto" }, [table]));
  host.appendChild(aCard);
}

function renderPulse(host, d) {
  const acts = d.activities || [];
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Play Pulse ", el("span.hint", { text: (d.devices || 0) + " players reporting — what the crew loves vs. bounces off" })])]));
  if (!acts.length) { card.appendChild(el("p.tagline", { text: "No Play Pulse data yet." })); host.appendChild(card); return; }
  const maxN = Math.max(1, ...acts.map(a => a.n));
  for (const a of acts.slice(0, 20)) {
    const net = (a.liked - a.disliked);
    const colour = net > 0 ? "var(--accent,#56e39f)" : net < 0 ? "#e06a6a" : "var(--ink-dim)";
    const verdict = a.liked > a.disliked ? (a.liked >= a.n * 0.6 ? "loved" : "liked") : (a.disliked > a.liked ? "bounced" : "mixed");
    card.appendChild(barRow(
      a.label || a.key,
      a.n / maxN,
      a.liked + "👍 / " + a.disliked + "👎 · " + verdict + " (" + a.n + ")",
      colour));
  }
  host.appendChild(card);
}

// ===== Taiao — ancient portal network =====
// Portal POIs (the purple rings on the world map) stamp a real portal node
// (world/chunks.js). Stepping up to one ATTUNES it (persisted in the save);
// using an attuned portal opens a destination list of every other attuned
// portal and teleports the player there. Unattuned portals must be found on
// foot first — the network only ever grows as you explore.
"use strict";

// Callers (2):
//  gameplay/portals.js  gameplay/input.js (hoverLabel)
function portalKey(n) { return n.x + "," + n.y; }
function portalAttuned(n) { return !!(player.portals && player.portals[portalKey(n)]); }

// The portal's name from the features POI data (pure math — the same name
// the world map label shows), e.g. "Weolcanmund Portal".
function portalName(n) {
  let best = null, bd = Infinity;
  for (const p of world.poisNearForMap(n.x / 2 - 6, n.y / 2 - 6, n.x / 2 + 6, n.y / 2 + 6, 2)) {
    if (p.type !== "portal") continue;
    const d = Math.hypot(p.x * 2 - n.x, p.y * 2 - n.y);
    if (d < bd) { bd = d; best = p; }
  }
  return (best && best.name) || "Ancient portal";
}

// Callers (1):
//  gameplay/pathing.js (executeGoal)
function usePortal(n) {
  player.portals = player.portals || {};
  const key = portalKey(n);
  if (!player.portals[key]) {
    player.portals[key] = portalName(n);
    const count = Object.keys(player.portals).length;
    log(`The ${player.portals[key]} hums to life — attuned (${count} portal${count === 1 ? "" : "s"} known).`, "gold");
    sfx("attune", 0.6);
    saveGame();
  }
  openPortalChooser(n);
}

// The veil is not free — and it is PICKY: travel demands runes of a tier
// worthy of the distance. A short hop takes any rune; a cross-continent
// jump only accepts the expensive end of the ladder (endgame Runecrafting
// or rare drops), so far travel stays genuinely costly. Among qualifying
// runes the cheapest tiers are drunk first, from the inventory before the
// pouch (a mage's loadout is the last thing eaten).
//
// Distance and tier are log-linked (same curve shape as content.js's
// tierVal value curve), anchored on the guaranteed-minimum 200-tile portal
// spacing (tier 9 "Drain") up through a 100,000-tile world-spanning jump
// (tier 32 "Eternity"): ~1,000 tiles wants tier 15+, ~10,000 tiles wants
// tier 23+. minTier is the 0-based RUNES index, i.e. (tier number − 1).
function portalRuneCost(d) {
  const t = 8 + 23 * Math.log(Math.max(d, 200) / 200) / Math.log(500);
  return {
    minTier: Math.max(8, Math.min(31, Math.round(t))),
    n: Math.min(5, Math.max(1, Math.ceil(d / 200))),    // 1..5 of them
  };
}
function runeStacks(minTier = 0) {
  const out = [];
  player.inv.forEach((s, i) => {
    const rw = s && runeWord(s.id);
    if (rw && rw.tier >= minTier) out.push({ inv: i, id: s.id, qty: s.qty, tier: rw.tier, pouch: 0 });
  });
  for (const sl of RUNE_SLOTS) {
    const s = player.equip[sl];
    const rw = s && runeWord(s.id);
    if (rw && rw.tier >= minTier) out.push({ slot: sl, id: s.id, qty: s.qty, tier: rw.tier, pouch: 1 });
  }
  return out.sort((a, b) => a.pouch - b.pouch || a.tier - b.tier);
}
function runeCount(minTier = 0) { return runeStacks(minTier).reduce((t, s) => t + s.qty, 0); }
function payRunes(n, minTier = 0) {
  if (runeCount(minTier) < n) return false;
  for (const s of runeStacks(minTier)) {
    if (n <= 0) break;
    const take = Math.min(s.qty, n);
    n -= take;
    if (s.inv !== undefined) {
      player.inv[s.inv].qty -= take;
      if (player.inv[s.inv].qty <= 0) player.inv[s.inv] = null;
    } else {
      player.equip[s.slot].qty -= take;
      if (player.equip[s.slot].qty <= 0) player.equip[s.slot] = null;
    }
  }
  uiDirty = true;
  return true;
}

function openPortalChooser(n) {
  const key = portalKey(n);
  const body = document.getElementById("skillguide-body");
  document.getElementById("skillguide-title").textContent = player.portals[key] || "Ancient portal";
  body.innerHTML = "";
  const intro = document.createElement("div");
  intro.className = "sgintro";
  const others = Object.entries(player.portals)
    .filter(([k]) => k !== key)
    .map(([k, name]) => {
      const [px2, py2] = k.split(",").map(Number);
      return { x: px2, y: py2, name, d: Math.round(Math.hypot(px2 - player.x, py2 - player.y)) };
    })
    .sort((a, b) => a.d - b.d);
  if (!others.length) {
    intro.textContent = "The stone ring thrums softly beneath your hand. Attune more portals across the world, then return to travel between them.";
    body.appendChild(intro);
  } else {
    intro.textContent = "Step through the shimmering veil — the further the jump, the higher the tier of rune the veil demands.";
    body.appendChild(intro);
    for (const o of others) {
      const { n: cost, minTier } = portalRuneCost(o.d);
      const afford = runeCount(minTier) >= cost;
      const tierName = minTier > 0 ? `${RUNES[minTier].name}-tier or better rune` : "rune";
      const btn = document.createElement("button");
      btn.textContent = `${o.name} — ${o.d} tiles · ${cost} ${tierName}${cost === 1 ? "" : "s"}`;
      btn.style.cssText = "display:block;width:100%;margin:5px 0;padding:8px 10px;text-align:left;" +
        `background:#2a2340;color:${afford ? "#d0a0e8" : "#6a5a80"};border:1px solid ${afford ? "#9040c0" : "#503868"};` +
        "border-radius:4px;cursor:pointer;font:inherit;";
      btn.onmouseenter = () => { btn.style.background = "#3a2f58"; };
      btn.onmouseleave = () => { btn.style.background = "#2a2340"; };
      btn.onclick = () => {
        if (!payRunes(cost, minTier)) {
          log(`The veil demands ${cost} ${tierName}${cost === 1 ? "" : "s"} — you carry ${runeCount(minTier)}.`, "warn");
          return;
        }
        log(`The veil drinks ${cost} ${tierName}${cost === 1 ? "" : "s"}.`, "sys");
        closeSkillGuide();
        portalTravel(o.x, o.y);
      };
      body.appendChild(btn);
    }
  }
  document.getElementById("skillguide").classList.add("open");
}

function portalTravel(px2, py2) {
  // Tūhura Isle gates & seal (gameplay/tutorial.js) — the veil refuses to
  // open past a latched gate or onto the mist-taken isle
  if (typeof Tutorial !== "undefined" && Tutorial.barred(px2, py2)) {
    log("The veil shudders and goes dark — that destination is closed to you.", "warn");
    return;
  }
  world.getChunk(Math.floor(px2 / world.CHUNK), Math.floor(py2 / world.CHUNK));
  // arrive on the first open tile ringing the destination portal stone
  let tx = px2, ty = py2 + 1;
  outer: for (let r = 1; r <= 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const ax = px2 + dx, ay = py2 + dy;
        if (!world.isBlocked(ax, ay) && !world.isWater(ax, ay)) { tx = ax; ty = ay; break outer; }
      }
  cancelAction();
  player.x = tx; player.y = ty;
  player.px = PX(tx); player.py = PX(ty);
  player.moving = null; player.path = []; player.forced = null;
  player.level = 0; player.deck = undefined; player.sailing = null;
  log("You step through the shimmering veil...", "gold");
  sfx("portal", 0.7);
  saveGame();
}

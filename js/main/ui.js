// ===== Taiao — panels, inventory UI, shops, banks, crafting, and dialog =====
"use strict";

// ---------- UI ----------
// Callers (4):
//  main/ui.js:1,7,14,233
const panels = ["inv", "equip", "skills", "goals", "account", "help", "cheats"];
// Callers (11):
//  main/ui.js:11,12,15,139,189,259,264,277,282,297,303
function showPanel(name) {
  for (const p of panels)
    document.getElementById("panel-" + p).classList.toggle("active", p === name);
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  uiDirty = true; // panels render lazily — fill the newly shown one
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => showPanel(t.dataset.tab));
document.querySelectorAll(".closebtn").forEach(b => b.onclick = () => showPanel("inv"));
// Callers (2):
//  gameplay/input.js:102 gameplay/pathing.js:50
function closeModals() {
  closeTrade();
}

// ---------- centred trade window (shops + banks) ----------
// tradeCtx pins the window to the shopkeeper / bank chest it was opened at;
// tickTrade() (called every frame from main.js) closes it automatically once
// the player walks out of reach.
let tradeCtx = null; // { mode: "shop" | "bank", x, y }
function openTrade(mode, title, x, y) {
  document.getElementById("trade-title").textContent = title;
  for (const m of ["shop", "bank", "craft"])
    document.getElementById("trade-" + m).style.display = mode === m ? "" : "none";
  const t = document.getElementById("trade");
  t.classList.toggle("bankmode", mode === "bank");
  t.classList.add("open");
  tradeCtx = { mode, x, y };
  uiDirty = true; // inventory clicks change meaning while the bank/shop is open
}
function closeTrade() {
  if (!tradeCtx) return;
  document.getElementById("trade").classList.remove("open");
  tradeCtx = null;
  if (typeof activeMarket !== "undefined") activeMarket = null;
  hideCtx();
  uiDirty = true; // restore normal inventory click behaviour
}
document.getElementById("tradeclose").onclick = closeTrade;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && tradeCtx) { e.stopPropagation(); closeTrade(); }
}, true);
// Callers (1): main.js frame loop
function tickTrade() {
  if (!tradeCtx) return;
  if (Math.max(Math.abs(player.x - tradeCtx.x), Math.abs(player.y - tradeCtx.y)) > 3)
    closeTrade();
}

// right-click amount menu for a trade slot: <verb> 5 / 10 / 50 / X… / max
function amountMenu(e, verb, maxLabel, fn) {
  e.preventDefault();
  e.stopPropagation();
  const items = [5, 10, 50].map(n => ({ label: `${verb} ${n}`, fn: () => fn(n) }));
  items.push({ label: `${verb} X…`, fn: () => {
    const v = parseInt(prompt(`${verb} how many?`), 10);
    if (v > 0) fn(v);
  } });
  items.push({ label: `${verb} ${maxLabel}`, fn: () => fn(Infinity) });
  showCtx(items, e.clientX, e.clientY);
}

// Callers (5):
//  main/ui.js:54,147,171,197,218
function slotEl(iconKey, qty, title) {
  const d = document.createElement("div");
  d.className = "slot";
  if (iconKey) {
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 32;
    cv.getContext("2d").drawImage(icon(iconKey), 0, 0);
    d.appendChild(cv);
  }
  if (qty !== undefined && qty !== 1) {
    const q = document.createElement("span");
    q.className = "qty";
    q.textContent = qty >= 100000 ? Math.floor(qty / 1000) + "k" : qty;
    d.appendChild(q);
  }
  if (title) d.title = title;
  return d;
}

// Callers (1):
//  gameplay/world.js:642
function renderUI() {
  document.getElementById("hpbar").style.width = (100 * player.hp / maxHp()) + "%";
  const wellFed = player.wellFedUntil && now < player.wellFedUntil;
  const candleLit = player.candleLitUntil && now < player.candleLitUntil;
  const hpt = document.getElementById("hptext");
  hpt.textContent = `${player.hp} / ${maxHp()}` + (wellFed ? "  🍖" : "") + (candleLit ? " 🕯" : "");
  hpt.title = [wellFed ? "Well fed — you recover HP faster." : "", candleLit ? "Carrying a lit candle — it lights your way at night." : ""].filter(Boolean).join(" ");
  document.getElementById("cmblevel").textContent = `Combat level: ${combatLevel()}`;
  if (typeof renderStink === "function") renderStink();
  // lazy panels: only rebuild what is actually on screen — renderSkills alone
  // rebuilds ~64 rows and used to run on every uiDirty tick (HP regen!),
  // which was the "banking is laggy" culprit
  const active = panels.find(p => document.getElementById("panel-" + p).classList.contains("active"));
  if (active === "inv" || active === "equip") renderInv();
  if (active === "skills") renderSkills();
  if (active === "goals") renderGoals();
  if (tradeCtx && tradeCtx.mode === "shop") renderShop();
  if (tradeCtx && tradeCtx.mode === "bank") renderBank();
}

// Examine an inventory stack: base flavour + produced quality + maker history.
// Finished goods recite their whole production chain; commodities show a batch
// summary. (Provenance/quality live on the stack via the production engine.)
function examineItem(s) {
  const def = ITEMS[s.id];
  log(EXAMINE[s.id] || def.name, "sys");
  if (typeof ProposalOverlay !== "undefined") {
    const u = ProposalOverlay.credit("item:" + s.id);
    if (u) log("Made by @" + u + " — Our RPG Workshop.", "sys");
    else if (ProposalOverlay.isGapItem(s.id))
      log("This icon is a placeholder — the Workshop is looking for its artist.", "sys");
  }
  if (s.q != null && typeof qualityLabel === "function")
    log(`Quality: ${qualityLabel(s.q)} (${s.q}/100).`, "sys");
  if (s.prov == null || typeof provRegistry === "undefined") return;
  const ev = provRegistry[s.prov];
  if (!ev) return;
  if (def.stack) {
    const verb = (typeof RECIPE_VERB !== "undefined" && RECIPE_VERB[ev.skill]) || "Made";
    log(`Batch ${ev.id}: ${verb} by ${ev.producer} · avg quality ${ev.quality}.`, "gold");
  } else if (typeof provenanceStory === "function") {
    for (const line of provenanceStory(s.prov))
      log(`${"   ".repeat(line.depth)}${line.text}.`, "gold");
  }
}

// Callers (1):
//  main/ui.js:41
// drag-and-drop reordering of the inventory grid. Filled slots are draggable;
// every slot accepts a drop, swapping the two inventory positions (dropping onto
// an empty slot just moves the item there). Source index rides in dataTransfer
// so it survives even if the grid re-renders mid-drag; invDragFrom is a fallback.
let invDragFrom = null;
function wireInvDrag(d, i, filled) {
  d.dataset.slot = i;
  if (filled) {
    d.draggable = true;
    d.addEventListener("dragstart", e => {
      invDragFrom = i;
      if (e.dataTransfer) { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; }
      d.classList.add("dragging");
    });
    d.addEventListener("dragend", () => { d.classList.remove("dragging"); invDragFrom = null; });
  }
  d.addEventListener("dragover", e => {
    if (invDragFrom == null) return;            // not an inventory drag
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    d.classList.add("dragover");
  });
  d.addEventListener("dragleave", () => d.classList.remove("dragover"));
  d.addEventListener("drop", e => {
    e.preventDefault();
    d.classList.remove("dragover");
    let from = invDragFrom;
    const dt = e.dataTransfer && e.dataTransfer.getData("text/plain");
    if (dt != null && dt !== "") { const n = parseInt(dt, 10); if (!isNaN(n)) from = n; }
    const to = i;
    if (from == null || from === to || from < 0 || from >= player.inv.length) return;
    const tmp = player.inv[to];
    player.inv[to] = player.inv[from];
    player.inv[from] = tmp;
    invDragFrom = null;
    uiDirty = true;
  });
}

function renderInv() {
  const grid = document.getElementById("invgrid");
  grid.innerHTML = "";
  player.inv.forEach((s, i) => {
    // a stale item id (e.g. left over from a save made before an id scheme
    // changed) must never throw here — that would abort renderInv() and skip
    // every render call after it (renderSkills, etc.) for the whole frame
    const def = s && ITEMS[s.id];
    const bankOpen = tradeCtx && tradeCtx.mode === "bank";
    const reqNote = def && def.wieldReq ? ` (Melee ${def.wieldReq})`
      : def && def.wearReq ? ` (Defence ${def.wearReq})`
      : def && def.rangeReq ? ` (Archery ${def.rangeReq})`
      : def && def.magicReq ? ` (Magic ${def.magicReq})` : "";
    const d = def ? slotEl(def.icon, s.qty, bankOpen ? `Deposit ${def.name}` : def.name + reqNote) : slotEl(null);
    if (s && def) {
      d.onclick = e => {
        // while the bank window is open, the inventory IS the deposit grid
        if (tradeCtx && tradeCtx.mode === "bank") { depositToBank(i, e.altKey ? s.qty : e.shiftKey ? 5 : 1); return; }
        // Lua-scripted item behaviour (js/lua on_item) takes precedence over the
        // built-in flag handlers when a handler is registered for this item.
        if (typeof Lua !== "undefined" && Lua.ready && Lua.hasItem(s.id)) { Lua.runItem(s.id); return; }
        if (def.heals || def.potion) eatItem(i);
        else if (def.equip) equipItem(i);
        else if (def.log && typeof placeLogs === "function") placeLogs(i);
        else if (def.place) placeItem(i); // furniture/vessels set down in the world
        else if (def.soap && typeof washWithSoap === "function") washWithSoap(i); // wash off stink
        else if (def.readable && typeof readBook === "function") readBook(i);     // study a book for xp
        else if (def.reveal && typeof useReveal === "function") useReveal(i);     // map/atlas/spyglass
        else if (def.light && typeof lightCandle === "function") lightCandle(i);  // strike a candle alight
        else examineItem(s);
      };
      d.oncontextmenu = e => {
        e.preventDefault();
        const items = [];
        if (tradeCtx && tradeCtx.mode === "bank") {
          for (const n of [5, 10, 50]) items.push({ label: `Deposit ${n}`, fn: () => depositToBank(i, n) });
          items.push({ label: "Deposit X…", fn: () => {
            const v = parseInt(prompt("Deposit how many?"), 10);
            if (v > 0) depositToBank(i, v);
          } });
          items.push({ label: "Deposit all", fn: () => depositToBank(i, s.qty) });
        }
        if (typeof Lua !== "undefined" && Lua.ready && Lua.hasItem(s.id)) items.push({ label: `Use ${def.name}`, fn: () => Lua.runItem(s.id) });
        if (def.potion) items.push({ label: `Drink ${def.name}`, fn: () => eatItem(i) });
        else if (def.heals) items.push({ label: `Eat ${def.name}`, fn: () => eatItem(i) });
        if (def.equip) items.push({ label: `Equip ${def.name}`, fn: () => equipItem(i) });
        if (def.place) items.push({ label: def.ride ? `Launch ${def.name}` : `Place ${def.name}`, fn: () => placeItem(i) });
        if (def.log && typeof placeLogs === "function") items.push({ label: "Lay a fire", fn: () => placeLogs(i) });
        if (def.soap && typeof washWithSoap === "function") items.push({ label: `Wash with ${def.name}`, fn: () => washWithSoap(i) });
        if (def.readable && typeof readBook === "function") items.push({ label: `Read ${def.name}`, fn: () => readBook(i) });
        if (def.reveal && typeof useReveal === "function") items.push({ label: `Consult ${def.name}`, fn: () => useReveal(i) });
        if (def.light && typeof lightCandle === "function") items.push({ label: `Light ${def.name}`, fn: () => lightCandle(i) });
        items.push({ label: `Examine ${def.name}`, fn: () => examineItem(s) });
        // object workshop (gameplay/objedit.js): vote on the item's icon,
        // equip slots, edibility, stacking… — same panel as world objects
        if (typeof ObjEdit !== "undefined")
          items.push({ label: `Edit ${def.name}`, fn: () => ObjEdit.open({ type: "item", key: s.id, name: def.name }) });
        items.push({ label: `Drop ${def.name}`, fn: () => {
          dropOnGround(s.id, s.qty, player.x, player.y, player.level | 0);
          player.inv[i] = null;
          uiDirty = true;
        }});
        showCtx(items, e.clientX, e.clientY);
      };
    } else if (s && !def) {
      // unknown item occupying a slot — drop it silently rather than soft-lock the slot
      player.inv[i] = null;
    }
    wireInvDrag(d, i, !!(s && def));
    grid.appendChild(d);
  });
  // --- equipment: a dynamic grid (inventory-style, same-size slots) showing
  // only what's worn, in the order it was equipped. There are no fixed
  // per-item slots — the panel grows with the number of equipped items. Which
  // items displace which (things sharing body space) is resolved at equip time
  // in gameplay/items.js; here we just list what ended up worn.
  const eg = document.getElementById("equipgrid");
  if (!eg) return;
  eg.innerHTML = "";
  player.equipOrder = player.equipOrder || [];
  // one visible cell per equipped item, keyed by its primary anatomical slot
  // (a multi-slot item is stored across several slots but shown once)
  const inst = {};
  for (const sl of EQUIP_SLOTS) {
    const val = player.equip[sl];
    if (!val) continue;
    const stack = QUIVER_SLOTS.has(sl);
    const eid = stack ? val.id : val;
    const edef = eid && ITEMS[eid];
    if (!edef) { player.equip[sl] = null; continue; }                       // stale ref
    if (!stack && Array.isArray(edef.equip) && edef.equip[0] !== sl) continue; // secondary slot
    inst[sl] = { def: edef, qty: stack ? val.qty : undefined, stack };
  }
  // display order = equip order, then any leftovers in slot order; reconcile
  // the stored order down to the live set so it never grows unbounded
  const ordered = [], seen = new Set();
  for (const k of player.equipOrder) if (inst[k] && !seen.has(k)) { ordered.push(k); seen.add(k); }
  for (const k of EQUIP_SLOTS) if (inst[k] && !seen.has(k)) { ordered.push(k); seen.add(k); }
  player.equipOrder = ordered;
  for (const k of ordered) {
    const it = inst[k];
    const title = it.stack ? `${it.def.name} x${it.qty} (click to unload)`
                           : `${it.def.name} (click to unequip)`;
    const cell = slotEl(it.def.icon, it.stack ? it.qty : undefined, title);
    cell.onclick = () => unequip(k);
    eg.appendChild(cell);
  }
  if (!ordered.length) {
    const hint = document.createElement("div");
    hint.className = "equip-empty";
    hint.textContent = "Nothing equipped. Click gear in your pack to wear it.";
    eg.appendChild(hint);
  }
}
// "back_of_head" -> "Back Of Head", "rune3" -> "Rune slot 3" — the empty-slot
// tooltip fallback (renderInv() would otherwise blank the HTML's initial
// title on the very first render, since it unconditionally overwrites it).
// Callers (1):
//  main/ui.js:200
function slotLabel(slot) {
  const m = slot.match(/^rune(\d)$/);
  if (m) return "Rune slot " + m[1];
  // "pauldron1" -> "Pauldron 1" (a trailing digit needs its own space before
  // title-casing, unlike the snake_case slots which already have one)
  return slot.replace(/_/g, " ").replace(/(\d+)$/, " $1").replace(/\b\w/g, c => c.toUpperCase());
}
// combat style is derived from what's in the main hand (combat.js
// combatStyle()) — there is no style selector any more

// Callers (1):
//  main/ui.js:42
// which categories the player has collapsed (session-only)
const collapsedCats = new Set();
// four even bands across the 1-32 level range, from newest to most mastered
function lvlTierClass(lvl) {
  return lvl <= 8 ? "lvl-t1" : lvl <= 16 ? "lvl-t2" : lvl <= 24 ? "lvl-t3" : "lvl-t4";
}
function skillRowHtml(s) {
  const lvl = skillLvl(s);
  const xp = player.skills[s];
  const cur = XP_TABLE[lvl], next = lvl >= MAX_LEVEL ? cur : XP_TABLE[lvl + 1];
  const frac = lvl >= MAX_LEVEL ? 1 : (xp - cur) / (next - cur);
  const b = player.buffs[s];
  const buffed = b && now < b.until;
  const row = document.createElement("div");
  row.className = "skillrow";
  row.title = DEV_MODE ? "Cheat mode — every skill at max level, no xp"
    : `${Math.floor(xp)} xp — ${lvl >= MAX_LEVEL ? "max" : Math.ceil(next - xp) + " xp to level " + (lvl + 1)}`;
  row.innerHTML = `<div class="skillname"><b>${s}</b><span class="skv"><button class="skillinfo" data-skill="${s}" title="Progression guide">?</button><span class="${buffed ? "buffed" : lvlTierClass(lvl)}">${buffed ? eff(s) : lvl}</span></span></div><div class="xbar"><div style="width:${Math.floor(frac * 100)}%"></div></div>`;
  return row;
}
// Skills grouped into collapsible categories. The UI is fully dynamic in the
// number of skills — professions can be added to SKILLS/SKILL_CATEGORY freely.
function renderSkills() {
  const p = document.getElementById("panel-skills");
  p.innerHTML = "";
  const catOf = s => (typeof SKILL_CATEGORY !== "undefined" && SKILL_CATEGORY[s]) || "Other";
  const order = (typeof SKILL_CATEGORY_ORDER !== "undefined" ? SKILL_CATEGORY_ORDER : []).slice();
  const byCat = {};
  // Tūhura Isle (gameplay/tutorial.js): during the tutorial only the skills
  // the keepers have introduced are listed; graduation reveals everything
  let hiddenN = 0;
  for (const s of SKILLS) {
    if (typeof Tutorial !== "undefined" && !Tutorial.skillVisible(s)) { hiddenN++; continue; }
    (byCat[catOf(s)] || (byCat[catOf(s)] = [])).push(s);
  }
  for (const c in byCat) if (!order.includes(c)) order.push(c);
  let total = 0;
  for (const cat of order) {
    const sks = byCat[cat];
    if (!sks) continue;
    const collapsed = collapsedCats.has(cat);
    const header = document.createElement("div");
    header.className = "skillcat";
    header.innerHTML = `<span class="skillcat-arrow">${collapsed ? "▸" : "▾"}</span>${cat}<span class="skillcat-n">(${sks.length})</span>`;
    header.onclick = () => { collapsed ? collapsedCats.delete(cat) : collapsedCats.add(cat); renderSkills(); };
    p.appendChild(header);
    const grid = document.createElement("div");
    grid.className = "skillgrid";
    if (collapsed) grid.style.display = "none";
    for (const s of sks) { total += skillLvl(s); grid.appendChild(skillRowHtml(s)); }
    p.appendChild(grid);
  }
  p.querySelectorAll(".skillinfo").forEach(b => b.onclick = e => { e.stopPropagation(); openSkillGuide(b.dataset.skill); });
  if (hiddenN) {
    const h = document.createElement("div");
    h.className = "sgintro";
    h.style.cssText = "padding:8px 10px;color:#5a6a8a;font-size:12px;";
    h.textContent = `✧ ${hiddenN} more skill${hiddenN > 1 ? "s" : ""} sleep${hiddenN > 1 ? "" : "s"} in you — the keepers of Tūhura will awaken some, and the rest open with the wide world.`;
    p.appendChild(h);
  }
  const t = document.createElement("div");
  t.className = "total";
  const rj = typeof readyJobCount === "function" ? readyJobCount() : 0;
  t.textContent = `Combat level: ${combatLevel()} — Total level: ${total}` + (rj ? `  ·  ${rj} job${rj > 1 ? "s" : ""} ready` : "");
  p.appendChild(t);
}

// The Tūhura Isle tutorial's CURRENT-stage goals, mirrored from the on-screen
// journey bar (gameplay/tutorial.js refreshBar) into a sidebar tab so the player
// can review "what now?" with the bar out of view. Same itemised rows, same
// tick/strike/count pills. Graduates (and veterans who skipped the isle) see a
// short "no goals" note. Rebuilt lazily each uiDirty tick like the other panels.
function renderGoals() {
  const p = document.getElementById("panel-goals");
  const gs = (typeof Tutorial !== "undefined" && Tutorial.goalState) ? Tutorial.goalState() : null;
  if (!gs) { p.innerHTML = `<div class="sgintro" style="padding:12px 4px;color:#5a6a8a;font-size:13px">No active goals.</div>`; return; }
  const bar =
    `<div style="font-weight:bold;color:#8fa3c8;margin-bottom:4px">Tūhura Isle — the journey · ${gs.doneN}/${gs.total}</div>` +
    `<div style="height:6px;background:#232a3d;border-radius:3px;overflow:hidden">` +
    `<div style="height:100%;width:${gs.pct}%;background:linear-gradient(90deg,#7fe3c7,#ffd75e)"></div></div>`;
  // one pill per requirement — tick medallion, label (struck through when done),
  // a right-hand count badge for multi-step counters, and a teal progress wash
  const row = (on, label, num, need) => {
    const pc = on ? 100 : Math.round(((num || 0) / (need || 1)) * 100);
    const fill = on ? "rgba(111,174,138,.16)"
      : `linear-gradient(90deg,rgba(127,227,199,.13) ${pc}%,rgba(20,26,40,.55) ${pc}%)`;
    const tick = on
      ? `<span style="flex:none;width:16px;height:16px;border-radius:50%;background:#6fae8a;color:#0e121c;font-size:11px;line-height:16px;text-align:center;font-weight:bold">✓</span>`
      : `<span style="flex:none;width:16px;height:16px;border-radius:50%;border:1px solid #4a5670;box-sizing:border-box"></span>`;
    const count = need > 1
      ? `<span style="flex:none;margin-left:8px;font-size:11px;color:${on ? "#6fae8a" : "#8fa3c8"};background:rgba(35,42,61,.8);border-radius:8px;padding:1px 7px">${on ? need : num}/${need}</span>`
      : "";
    const text = on
      ? `<span style="position:relative;display:inline-block;opacity:.75">${label}` +
        `<span style="position:absolute;left:0;right:0;top:calc(50% - .5px);height:1px;background:currentColor"></span></span>`
      : label;
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:5px;padding:6px 9px;border:1px solid ${on ? "#3d5a4a" : "#2c374f"};border-radius:8px;background:${fill}">` +
      `${tick}<span style="flex:1;text-align:left;color:${on ? "#9ecfb2" : "#cdd7ea"};font-size:13px">${text}</span>${count}</div>`;
  };
  if (gs.graduated || !gs.cur) {
    // post-Bifrost: the authored "First days in Newhaven" arc (goals-arc.js)
    // takes over the tab; the bare "no goals" note survives only for the
    // (pre-arc) case where the arc module has nothing for this save
    const as = (typeof GoalsArc !== "undefined" && GoalsArc.state) ? GoalsArc.state() : null;
    if (as) {
      const head =
        `<div style="font-weight:bold;color:#8fa3c8;margin-top:14px;margin-bottom:4px">${as.title} · ${as.doneN}/${as.total}</div>` +
        `<div style="height:6px;background:#232a3d;border-radius:3px;overflow:hidden">` +
        `<div style="height:100%;width:${Math.round(100 * as.doneN / as.total)}%;background:linear-gradient(90deg,#7fe3c7,#ffd75e)"></div></div>`;
      const arcRows = as.rows.map(r => row(r.on, r.label, r.num, r.need)).join("");
      const now = as.cur
        ? `<div style="color:#7fe3c7;margin-top:10px;font-size:13px;font-weight:bold">Now: ${as.cur.label}</div>`
        : `<div style="color:#9ecfb2;margin-top:10px;font-size:13px">${as.doneLine || "✦ Newhaven is home. The wide world is yours to explore."}</div>`;
      const hint = as.cur && as.cur.hint
        ? `<div style="color:#8f96ad;margin-top:8px;font-size:12px;font-style:italic;line-height:1.45">${as.cur.hint}</div>`
        : "";
      p.innerHTML = bar + head + now + `<div>${arcRows}</div>` + hint;
      return;
    }
    p.innerHTML = bar +
      `<div class="sgintro" style="padding:16px 4px 4px;color:#9ecfb2;font-size:13px">` +
      `✦ No tutorial goals remain — the wide world is yours to explore.</div>`;
    return;
  }
  const rows = gs.cur.rows.map(r => row(r.on, r.label, r.num, r.need)).join("");
  p.innerHTML = bar +
    `<div style="color:#7fe3c7;margin-top:12px;font-size:13px;font-weight:bold">Now: ${gs.cur.full}</div>` +
    `<div>${rows}</div>`;
}

// ---------- per-skill progression guide ----------
const SKILL_INTRO = {
  Melee: "Melee accuracy. Fight monsters with a melee weapon in your main hand — tougher foes give more XP. Each Melee level also unlocks a higher tier of melee weapon to wield.",
  Strength: "Melee power. Fight monsters with a melee weapon (or your fists) to raise max hit and Strength XP.",
  Defence: "Melee defence. Take hits while fighting to gain Defence XP. Each Defence level also unlocks a higher tier of armour and shields to wear.",
  Archery: "Ranged combat. Wield a bow with arrows in your quiver and shoot monsters from a distance — each shot leads a moving target, and your Archery level sets how reliably you predict its path. Damage falls off near a bow's maximum reach, and an offhand dagger covers you up close. Each Archery level also unlocks a higher tier of bow to wield.",
  Magic: "Weave spells with a wand or staff — spells are SENTENCES. Every rune is a word: a substance (Fire burns, Frost chills, Bone brittles, Storm arcs…), a verb (Strike hits, Bind roots, Drain heals you, Burst spreads, Law forbids retaliation, Shadow routs…) or a modifier (Twin, Wrath, Time…). Each cast draws the next rune from your pouch in slot order; a wand speaks 2-word sentences, a staff 3. Your pouch loadout is your spellbook — a sentence with no verb collapses into a weak raw surge.",
  Health: "Your hit points. Trains passively whenever you deal or take damage in combat — no direct training needed.",
  Mining: "Swing a pickaxe at ore rocks. Mine the highest-tier rock you can for the best XP; ore respawns after a short delay.",
  Smelting: "Smelt ores into bars at a furnace. Each metal tier needs the matching Smelting level.",
  Weaponsmithing: "Hammer bars into weapons — swords, daggers, spears, maces, the exotic curved blades and arrowheads — at an anvil. Each tier follows your metal bars.",
  Armoursmithing: "Hammer bars into armour, shields and heavy iron fittings at an anvil. Each tier follows your metal bars.",
  Woodcutting: "Chop trees with an axe. Higher-tier trees (and the many native species) give more Woodcutting XP.",
  Firemaking: "Light logs on the ground to make a campfire. Burn the highest-tier logs you have for the most XP.",
  Carpentry: "Build furniture, tools and boats at a carpentry workbench.",
  Fletching: "Craft arrows and bows at a workbench. Arrow tiers follow your metal bars.",
  Fishing: "Each fish needs the right tool (net, rod, big net, harpoon or lobster cage) and is found at a matching spot: shallow <b>Fishing spots</b> (Lv 1+), <b>Deep fishing spots</b> (Lv 11+) and <b>Abyssal fishing spots</b> (Lv 25+). Bring the tool for what you want to catch — the general store sells them.",
  Cooking: "Cook raw fish and meat on a campfire or furnace. Higher levels burn food less often.",
  Farming: "Plant seeds in farm plots and return later to harvest. Higher-tier crops need more Farming.",
  Foraging: "Gather berries, mushrooms and herbs from bushes and patches out in the wild.",
  Potionmaking: "Brew potions from herbs and vials at a cauldron. Each herb tier unlocks a stronger potion — heals, combat and skill boosts, up to fantasy elixirs.",
  Alchemy: "Transmute items into coins and materials at an alchemy table.",
  Runecrafting: "Craft runes from rune essence at a runestone altar.",
  Crafting: "Craft leather armour and other goods at a workbench.",
  Tanning: "Tan raw hides into leather at a tanning rack.",
  Textiles: "Weave cloth and textiles from fibre at a loom.",
  Milling: "Mill grain into flour at a millstone.",
  Jewelry: "Craft rings and amulets from gold bars and gems at a furnace.",
  Agility: "Cross agility obstacles found in the wild — stepping stones, mossy crossings, rock scrambles and cliff ledges over rivers and ravines. Harder crossings need a higher Agility level, give more XP, and risk a slip (a stumble that stuns you and costs a little health). Training Agility also makes you nimbler on your feet — you move a touch faster and slip less often the higher your level.",
  Sailing: "Build boats with Carpentry, then sail open water. Better boats need a higher Sailing level and earn XP as you travel.",
};

// Build a data-driven list of {lvl,label,xp} training milestones for a skill,
// sourced from the same recipe / node / crop / monster tables the game runs on.
function guideTiers(skill) {
  // the inventory-icon key for an item id (guarded — missing ids → no icon)
  const iconFor = id => (id && ITEMS[id] && ITEMS[id].icon) || null;
  const fromRecipes = () => {
    const o = [];
    for (const cat in RECIPES) for (const r of RECIPES[cat]) if (r.skill === skill) {
      const oid = (r.outputs && r.outputs[0] && r.outputs[0].id) || r.out;
      o.push({ lvl: r.req, label: r.name, xp: r.xp, icon: iconFor(oid) });
    }
    return o;
  };
  // legacy base-tree nodes (data.js) superseded by content.js's treeT0 "Tree" /
  // treeT4 "Pine" — never placed in the world, so keep their dead duplicates
  // (incl. the stray "Pine tree") out of the progression guide.
  const GUIDE_HIDE_NODES = new Set(["tree", "tree_or", "tree_ap", "pine"]);
  const fromNodes = () => {
    const o = [];
    for (const k in NODE_TYPES) { if (GUIDE_HIDE_NODES.has(k)) continue; const nt = NODE_TYPES[k]; if (nt.skill === skill) o.push({ lvl: nt.req, label: nt.name, xp: nt.xp, icon: iconFor(nt.item) }); }
    return o;
  };
  switch (skill) {
    case "Woodcutting": case "Mining": case "Ore-mining": case "Gem-mining": case "Stone-mining": return fromNodes();
    case "Fishing":
      if (typeof FISH !== "undefined")
        return FISH.map(f => ({ lvl: f.req, label: `${f.name} — ${f.toolName}, ${f.spotName}`, xp: f.xp, icon: iconFor(f.raw) }))
          .sort((a, b) => a.lvl - b.lvl);
      return fromNodes();
    case "Foraging": {
      const o = fromNodes();
      if (typeof FORAGE !== "undefined") for (const f of FORAGE) o.push({ lvl: f.req, label: "Forage " + f.name.toLowerCase(), xp: f.xp, icon: iconFor(f.id) });
      return o;
    }
    case "Farming": {
      // one Farming skill; crops grouped by category (c.cat) in the label
      const o = [];
      for (const k in CROPS) { const c = CROPS[k]; o.push({ lvl: c.req, label: "Grow " + c.name + (c.cat ? " (" + c.cat + ")" : ""), xp: c.xp, icon: iconFor(c.item) }); }
      return o;
    }
    case "Weaponsmithing": case "Armoursmithing":
      // each forge trade lists its own catalogue (weapons+arrowheads, or
      // armour+shields+fittings); tiered tools have their own Toolmaking guide.
      return fromRecipes();
    case "Smelting": case "Cooking": case "Fletching": case "Potionmaking":
    case "Runecrafting": case "Textiles": case "Tanning": case "Carpentry": case "Crafting":
    case "Jewelry": case "Milling": return fromRecipes();
    case "Firemaking": {
      const o = [], seen = new Set();
      for (const id in ITEMS) {
        const it = ITEMS[id];
        if (!it.log || seen.has(it.logTier)) continue;
        seen.add(it.logTier);
        const tier = it.logTier || 0;
        const lvl = tier + 1;
        o.push({ lvl, label: "Burn " + it.name.toLowerCase(), xp: Math.round(30 * (1 + tier * 0.55)), icon: it.icon });
      }
      return o;
    }
    case "Melee": {
      // the weapon tiers each level unlocks (wieldReq)
      // one row per weapon — every wieldable weapon, its own line + icon
      const o = [];
      for (const id in ITEMS) {
        const d = ITEMS[id];
        if (!d.wieldReq || d.equip !== "weapon") continue;
        o.push({ lvl: d.wieldReq, label: `Wield ${d.name}`, xp: 0, icon: d.icon });
      }
      return o;
    }
    case "Defence": {
      // one row per armour piece — every wearable item, its own line + icon
      const o = [];
      for (const id in ITEMS) {
        const d = ITEMS[id];
        if (!d.wearReq) continue;
        o.push({ lvl: d.wearReq, label: `Wear ${d.name}`, xp: 0, icon: d.icon });
      }
      return o;
    }
    case "Strength": {
      // base max hit rises one point every 4 levels (melee formula)
      const o = [{ lvl: 1, label: "Base max hit 2 (plus weapon power)", xp: 0 }];
      for (let l = 4; l <= MAX_LEVEL; l += 4)
        o.push({ lvl: l, label: `Base max hit reaches ${2 + Math.floor(l / 4)} (plus weapon power)`, xp: 0 });
      return o;
    }
    case "Health": {
      const o = [{ lvl: 1, label: "Max HP 10 — trains passively from combat", xp: 0 }];
      for (let l = 4; l <= MAX_LEVEL; l += 4)
        o.push({ lvl: l, label: `Max HP reaches ${10 + 3 * (l - 1)}`, xp: 0 });
      return o;
    }
    case "Archery": {
      // the bow tiers each level unlocks (rangeReq)
      const o = [];
      const byReq = new Map(), reqIcon = new Map();
      for (const id in ITEMS) {
        const d = ITEMS[id];
        if (!d.rangeReq) continue;
        if (!byReq.has(d.rangeReq)) byReq.set(d.rangeReq, []);
        byReq.get(d.rangeReq).push(d.name);
        if (!reqIcon.has(d.rangeReq)) reqIcon.set(d.rangeReq, d.icon);
      }
      for (const [req, names] of byReq) {
        names.sort();
        o.push({ lvl: req, label: `Wield: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`, xp: 0, icon: reqIcon.get(req) });
      }
      return o;
    }
    case "Magic": {
      const o = [
        { lvl: 1, label: "The Weave: spells are sentences — each cast draws the next rune (word) from your pouch; at your weapon's capacity the sentence casts", xp: 0 },
        { lvl: 1, label: "Substances mark the target (Fire burns, Water/Frost chill, Stone staggers, Veil blinds, Bone brittles, Light exposes, Blood feeds you, Storm arcs, Spirit pierces)", xp: 0 },
        { lvl: 2, label: "Verbs deliver (Strike hits, Bind roots, Rend sunders, Drain heals you, Burst spreads, Echo re-strikes, Chaos gambles, Law pacifies, Shadow routs, Death executes, Ward shields, Void banishes)", xp: 0 },
        { lvl: 13, label: "Modifiers warp the cast: Twin doubles, Soul lingers, War hastens, Time recurs, Astral cannot miss, Wrath empowers — Genesis/Eternity become whatever the weave lacks", xp: 0 },
        { lvl: 8, label: "Secret techniques: certain word pairs transcend their parts entirely — mages whisper of Petrify, Vanish, Rift Hurl, Sanctum, Stasis… experiment", xp: 0 },
      ];
      for (const id of ["wand", "staff", "pine_wand", "pine_staff"]) {
        const d = ITEMS[id];
        if (d) o.push({ lvl: d.magicReq, label: `Wield the ${d.name.toLowerCase()} (${d.weave}-word sentences, range ${d.range})`, xp: 0, icon: d.icon });
      }
      for (let l = 4; l <= MAX_LEVEL; l += 4)
        o.push({ lvl: l, label: `Spell damage bonus +${Math.floor(l / 4)}`, xp: 0 });
      return o;
    }
    case "Sailing": { const o = []; const ids = (typeof BOAT_ORDER !== "undefined") ? BOAT_ORDER : ["canoe", "sailboat", "ship"]; for (const id of ids) if (ITEMS[id]) o.push({ lvl: ITEMS[id].sailReq, label: "Sail a " + ITEMS[id].name.toLowerCase(), xp: 2 + ITEMS[id].boat * 2, icon: ITEMS[id].icon }); return o; }
    case "Agility": return (typeof OBSTACLE_ORDER !== "undefined" ? OBSTACLE_ORDER : []).map(k => { const ot = OBSTACLE_TYPES[k]; return { lvl: ot.req, label: "Cross " + ot.name.toLowerCase() + (ot.fail ? " (slip risk)" : ""), xp: ot.xp }; });
    case "Alchemy": return [
      { lvl: 1, label: "Transmute any item into coins at an alchemy table", xp: 0 },
      { lvl: 16, label: "Improved yield — ~58% of the item's value", xp: 0 },
      { lvl: 32, label: "Master yield — ~66% of the item's value", xp: 0 },
    ];
    // any other production profession is driven entirely by its recipe data
    default: return fromRecipes();
  }
}

// sort by level, drop duplicate methods, guarantee at least one row per
// distinct level, then evenly sample any remaining budget from the rest
function trimTiers(list, max = MAX_LEVEL + 8) {
  list = list.filter(t => t.lvl != null).sort((a, b) => a.lvl - b.lvl || String(a.label).localeCompare(String(b.label)));
  const seen = new Set();
  list = list.filter(t => (seen.has(t.label) ? false : (seen.add(t.label), true)));
  if (list.length <= max) return list;
  const byLevel = new Map();
  for (const t of list) if (!byLevel.has(t.lvl)) byLevel.set(t.lvl, t);
  const required = [...byLevel.values()];
  if (required.length >= max) return required.slice(0, max);
  const rest = list.filter(t => byLevel.get(t.lvl) !== t);
  const budget = max - required.length, step = rest.length / budget;
  const pickedIdx = new Set();
  for (let i = 0; i < budget; i++) pickedIdx.add(Math.min(rest.length - 1, Math.floor(i * step)));
  const out = required.concat([...pickedIdx].map(i => rest[i]));
  return out.sort((a, b) => a.lvl - b.lvl || String(a.label).localeCompare(String(b.label)));
}

// recipe-driven guides list EVERY recipe (the body scrolls); only the
// combat / node / monster guides still get sampled down to a digest — a
// smith wants the complete catalogue, not 40 rows picked from 350
function skillHasRecipes(skill) {
  for (const cat in RECIPES) for (const r of RECIPES[cat]) if (r.skill === skill) return true;
  return false;
}

function openSkillGuide(skill) {
  const body = document.getElementById("skillguide-body");
  document.getElementById("skillguide-title").textContent = skill + " — progression guide";
  const cur = skillLvl(skill);
  const intro = SKILL_INTRO[skill] || (typeof PROD_SKILL_INTRO !== "undefined" && PROD_SKILL_INTRO[skill]) || "";
  let html = intro ? `<div class="sgintro">${intro}</div>` : "";
  // Gathering guides list EVERY node species (the body scrolls) instead of a
  // per-level digest — otherwise the 67 Woodcutting trees collapse to ~one per
  // level and most species (kauri, kahikatea, …) vanish from the progression.
  const fullList = skillHasRecipes(skill)
    || ["Melee", "Defence", "Archery"].includes(skill)
    || (typeof SKILL_CATEGORY !== "undefined" && SKILL_CATEGORY[skill] === "Gathering");
  const tiers = trimTiers(guideTiers(skill), fullList ? Infinity : undefined);
  // the tier table is built with real DOM below (icons are canvases); leave a
  // placeholder in the HTML so it lands in the right spot between intro & mastery
  if (tiers.length) html += `<div id="sg-tierswrap"></div>`;
  // recipe-family mastery — repeated practice within a niche (see production.js)
  const mast = player.mastery && player.mastery[skill];
  if (mast && Object.keys(mast).length && typeof masteryLevel === "function") {
    const fams = Object.keys(mast).sort((a, b) => masteryLevel(skill, b) - masteryLevel(skill, a));
    html += `<div class="sgmastery"><div class="sgintro">Mastery — repeated practice within a family raises quality, and two makers of the same level can specialise differently:</div>`;
    for (const f of fams) html += `<div class="mrow"><span>${f.replace(/_/g, " ")}</span><b>${masteryLevel(skill, f)}</b></div>`;
    html += `</div>`;
  }
  html += `<div class="sgintro" style="margin-top:12px">You are currently level ${cur}${cur >= MAX_LEVEL ? " (max)" : ""}. Greyed rows are already unlocked.</div>`;
  body.innerHTML = html;
  // fill the placeholder with the tier table (icon column = a 24px canvas per row)
  const wrap = document.getElementById("sg-tierswrap");
  if (wrap && tiers.length) {
    const table = document.createElement("table");
    table.innerHTML = `<thead><tr><th class="sgicon"></th><th>Lvl</th><th>What to do</th><th>XP</th></tr></thead>`;
    const tb = document.createElement("tbody");
    for (const t of tiers) {
      const tr = document.createElement("tr");
      if (cur >= t.lvl) tr.style.opacity = ".55";
      const tdIcon = document.createElement("td");
      tdIcon.className = "sgicon";
      if (t.icon && typeof SPR !== "undefined" && SPR[t.icon]) {
        const cv = document.createElement("canvas");
        cv.width = 24; cv.height = 24;
        try { cv.getContext("2d").drawImage(icon(t.icon), 0, 0, 24, 24); } catch (e) { /* missing sheet */ }
        tdIcon.appendChild(cv);
      }
      tr.appendChild(tdIcon);
      const tdLvl = document.createElement("td"); tdLvl.className = "sglvl"; tdLvl.textContent = t.lvl; tr.appendChild(tdLvl);
      const tdWhat = document.createElement("td"); tdWhat.textContent = t.label; tr.appendChild(tdWhat);
      const tdXp = document.createElement("td"); tdXp.className = "sgxp"; tdXp.textContent = t.xp ? Math.round(t.xp) + " xp" : ""; tr.appendChild(tdXp);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    wrap.replaceWith(table);
  }
  document.getElementById("skillguide").classList.add("open");
}
function closeSkillGuide() { document.getElementById("skillguide").classList.remove("open"); }
document.getElementById("sgclose").onclick = closeSkillGuide;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("skillguide").classList.contains("open")) { e.stopPropagation(); closeSkillGuide(); }
}, true);

// shop
// Callers (1):
//  gameplay/pathing.js:70
function talkTo(npc) {
  // Lua role scripts (js/lua) for the bespoke NPCs intercept BEFORE the built-in
  // JS handlers when one is registered (else fall through, incl. during boot).
  if (typeof Lua !== "undefined" && Lua.ready) {
    if (npc.tutor && Lua.hasRole("tutor", npc)) { Lua.runRole("tutor", npc); return; }
    if (npc.wizard && Lua.hasRole("wizard", npc)) { Lua.runRole("wizard", npc); return; }
    if (npc.dreamNpc && Lua.hasRole("dream", npc)) { Lua.runRole("dream", npc); return; }
  }
  // Tūhura Isle tutors open their tutorial dialogue (gameplay/tutorial.js)
  if (npc.tutor && typeof Tutorial !== "undefined" && Tutorial.talk(npc)) return;
  // the Weaver: chant-magic lessons + the veil-ride to his tower (gameplay/wizard.js)
  if (npc.wizard && typeof Wizard !== "undefined") { Wizard.talk(npc); return; }
  // the Heart of the Dream's villagers (gameplay/dream.js): the Matron speaks
  // for herself; the Pedlar returns false and falls through to their shop
  if (npc.dreamNpc && typeof Dream !== "undefined" && Dream.talk(npc)) return;
  // Newhaven's Registrar: the wide-world way back into the character/appearance
  // chooser (the C key and sidebar button no longer open it at will)
  if (npc.charselect && typeof CharSelect !== "undefined") {
    npc._say = { text: npc.line || "...", until: performance.now() + 4000 };
    CharSelect.open();
    return;
  }
  // Lua role scripts (js/lua) own the whole interaction for traders/bankers when
  // registered — they handle the stink/night-closed gates and opening the
  // shop/vault themselves (scripts/systems/{trader,banker}.lua). If no such
  // script is registered, we fall through to the built-in JS below.
  if (typeof Lua !== "undefined" && Lua.ready) {
    if (npc.trader && Lua.hasRole("trader", npc)) { Lua.runRole("trader", npc); return; }
    if (npc.banker && Lua.hasRole("banker", npc)) { Lua.runRole("banker", npc); return; }
  }
  // shopkeepers: no trading once the shop is shut for the night — except the
  // few who never sleep (npc.alwaysOpen: the Dream's Pedlar keeps no hours)
  if (npc.trader && !npc.alwaysOpen && typeof shopClosed === "function" && shopClosed(npc)) {
    log(`${npc.name}'s shop is closed for the night. Come back in the morning.`, "warn");
    return;
  }
  // everyone else: don't wake a sleeping villager
  if (!npc.trader && typeof npcAsleep === "function" && npcAsleep(npc)) {
    log(`${npc.name} is fast asleep.`, "sys");
    return;
  }
  // Lua: an NPC with an on_npc handler (js/lua) owns the whole conversation —
  // runs its scripted dialogue/quest logic and takes precedence over the
  // quest-giver and canned-dialogue fallbacks below.
  if (typeof Lua !== "undefined" && Lua.ready && Lua.hasNpc(npc)) { Lua.runNpc(npc); return; }
  // mix NPCs speak overhead (a bubble the renderer draws above their head).
  // No explicit .line (most ambient villagers) falls to their role's canned
  // dialogue bank (npc-starter-roles.js) instead of a mute "...".
  if (npc.mix) npc._say = { text: npc.line || npcTalkLine(npc), until: performance.now() + 4000 };
  // main-branch bankers: open an account, or serve an existing one (ui.js)
  if (npc.banker) { bankerTalk(npc); return; }
  if (npc.trader) {
    // too rank? the shopkeeper bars the door (gameplay/stink.js)
    if (typeof stinkBlocksShops === "function" && stinkBlocksShops()) {
      log(`${npc.name} recoils and bars the door: "Faugh — you stink! Go wash before you set foot in my shop."`, "warn");
      return;
    }
    if (typeof openMarket === "function") openMarket(npc);
    else { log(`${npc.name}: "Welcome! Buy tools, sell me your goods."`, "sys"); openShop(npc); }
  } else if (npc._questGiver && typeof Quests !== "undefined") {
    Quests.talkGiver(npc);                 // offer / advance / reward a quest
  } else if (typeof Quests !== "undefined" && Quests.onTalk(npc)) {
    // this NPC was a quest "contact" — the talk-step was just completed
  } else if (typeof npcFocusChat === "function" && npcFocusChat(npc)) {
    // AI dialogue is live (Nets bridge) — clicking a townsperson opens the chat
    // bar so you can speak to them (and anyone else in earshot).
  } else {
    log(`${npc.name}: "${npc.line || npcTalkLine(npc)}"`, "sys");
  }
}
// An ambient villager's canned line: their own .line if set, else a fresh
// pick from their role's dialogue bank (varies across repeat clicks — see
// npcStarterReply's per-NPC anti-repeat tracking). Falls back to "..." only
// if the starter bank itself isn't loaded (shouldn't happen; core file).
function npcTalkLine(npc) {
  return (typeof npcStarterReply === "function") ? npcStarterReply(npc, null) : "...";
}
// Buy up to n of an item at a fixed price, logging what actually happened.
// Returns how many were bought. Shared by the legacy shop and the market.
function tradeBuy(id, price, n) {
  const def = ITEMS[id];
  let bought = 0;
  for (let k = 0; k < n && k < 10000; k++) {
    if (countItem("coins") < price) { if (!bought) log("You don't have enough coins.", "warn"); break; }
    if (invFull(id)) { if (!bought) log("Your inventory is full.", "warn"); break; }
    removeItem("coins", price);
    addItem(id, 1);
    bought++;
  }
  if (bought) { sfx("coins", 0.7); log(`You buy ${bought > 1 ? bought + " × " : ""}${def.name} for ${price * bought} coins.`); }
  return bought;
}
// Callers (1):
//  main/ui.js:133
function openShop(npc) {
  openTrade("shop", "Trading Post", npc ? npc.x : player.x, npc ? npc.y : player.y);
  renderShop();
}
// Callers (4):
//  main/ui.js:43,140,161,181
function renderShop() {
  // town markets (with demand pricing + contracts) supersede the legacy shop
  if (typeof activeMarket !== "undefined" && activeMarket && typeof renderMarket === "function") return renderMarket();
  const grid = document.getElementById("shopgrid");
  grid.innerHTML = "";
  for (const id of SHOP_STOCK) {
    const def = ITEMS[id];
    const d = slotEl(def.icon, undefined, `${def.name} — ${def.value} coins`);
    const pr = document.createElement("span");
    pr.className = "price";
    pr.textContent = def.value;
    d.appendChild(pr);
    d.onclick = e => { tradeBuy(id, def.value, e.shiftKey ? 5 : 1); renderShop(); };
    d.oncontextmenu = e => amountMenu(e, "Buy", "max", n => { tradeBuy(id, def.value, n); renderShop(); });
    grid.appendChild(d);
  }
  // (the sell grid — filtered to what the shop buys — is rendered by
  // renderMarket in market.js; the legacy no-market path has no sell grid)
}

// bank
// The vault grid only rebuilds when the bank actually changes (bankRev):
// renderUI runs on every uiDirty (HP regen ticks, XP drops, …) and a full
// rebuild of hundreds of slot canvases each time made banking visibly laggy.
let bankRev = 0, bankShownRev = -1;
// vault filtering: a category dropdown + live search. Categories OVERLAP on
// purpose — an iron ore is Ores, Metalwork and Gathered raws all at once — so
// bankCatsFor(id) returns the SET of every category an item belongs to and the
// dropdown tests membership. Option labels carry a live count of matching
// vault stacks. The controls are static DOM (never rebuilt), so the search box
// keeps focus while the grid re-renders.
const bankFilter = { cat: "all", q: "" };
// resource-type id sets, built once from the same tables the game runs on
let _bankSets = null;
function bankSets() {
  if (!_bankSets) {
    const s = { seeds: new Set(), ores: new Set(), bars: new Set(), crops: new Set(), fish: new Set() };
    for (const k in CROPS) {
      if (CROPS[k].seed) s.seeds.add(CROPS[k].seed);
      if (CROPS[k].item) s.crops.add(CROPS[k].item);
    }
    if (typeof METALS !== "undefined")
      for (const m of METALS) { if (m.ore) s.ores.add(m.ore); if (m.bar) s.bars.add(m.bar); }
    if (typeof FISH !== "undefined")
      for (const f of FISH) { if (f.raw) s.fish.add(f.raw); if (f.cooked) s.fish.add(f.cooked); }
    _bankSets = s;
  }
  return _bankSets;
}
// LEGACY single-category classifier — still the contract market.js buyers use
// (mine towns buy bankCat(id)==="ores", farm towns "seeds"); the bank window
// itself now filters on the overlapping bankCatsFor sets below.
function bankCat(id) {
  const d = ITEMS[id];
  if (!d) return "other";
  const S = bankSets();
  if (S.seeds.has(id) || /_seeds$/.test(id)) return "seeds";
  if (S.ores.has(id) || /_ore$/.test(id) || id === "rune_essence" || id === "gem") return "ores";
  if (S.bars.has(id) || /_bar$|^bar_\d+$/.test(id)) return "bars";
  if (d.log) return "logs";
  if (/^herb/.test(id)) return "herbs";
  if (d.equip || d.tool || d.arrowPower || d.boat) return "gear";
  if (d.heals || d.potion || /^raw_/.test(id)) return "food";
  const tag = typeof itemTag === "function" ? itemTag(id) : "misc";
  if (tag === "food" || tag === "drink") return "food";
  if (tag === "textile" || tag === "leather") return "cloth";
  if (tag === "wood") return "timber";
  return "other";
}
// ---- overlapping bank categories (the dropdown) ----
// Each entry is [key, label, test(def, id, sets, marketTag)]. An item lands in
// EVERY category whose test passes — broad umbrellas (All gear, Gathered raws)
// deliberately overlap the narrow ones (Shields, Ores). "other" has no test:
// it catches items that matched nothing at all.
const BANK_JEWELRY_SLOTS = ["neck", "ring", "bracelet", "anklet"];
// wearable body armour / clothing: any equip that isn't a weapon, shield,
// rune, ammo or jewelry slot (multi-slot armour pieces carry an equip ARRAY)
function bankWearable(d) {
  if (!d.equip) return false;
  if (Array.isArray(d.equip)) return true;
  return !["weapon", "shield", "rune", "quiver"].includes(d.equip) && !BANK_JEWELRY_SLOTS.includes(d.equip);
}
const BANK_CAT_GROUPS = [
  ["Gear & Combat", [
    ["gear", "All gear", d => !!(d.equip || d.tool || d.arrowPower || d.boat)],
    ["weapons", "Weapons", d => d.equip === "weapon"],
    ["ammo", "Ammunition", d => !!d.arrowPower || d.equip === "quiver"],
    ["wear", "Armour & clothing", d => bankWearable(d)],
    ["metalarm", "Metal armour", (d, id, S, tag) => bankWearable(d) && tag === "metal"],
    ["leatherarm", "Leather armour", (d, id, S, tag) => bankWearable(d) && tag === "leather"],
    ["clothing", "Cloth garments", (d, id, S, tag) => bankWearable(d) && tag === "textile"],
    // the "shield" equip tag is the whole offhand slot — bucklers, but also
    // offhand candles/daggers — so the label says what the filter really is
    ["shields", "Shields & offhand", d => d.equip === "shield"],
    ["jewellery", "Jewellery", d => BANK_JEWELRY_SLOTS.includes(d.equip)],
    ["tools", "Tools", d => !!d.tool],
    ["boats", "Boats & vessels", d => !!d.boat],
    ["runes", "Runes & essence", (d, id) => d.equip === "rune" || /_rune$/.test(id) || id === "rune_essence"],
  ]],
  ["Raw materials", [
    ["ores", "Ores", (d, id, S) => S.ores.has(id) || /_ore$/.test(id) || id === "rune_essence"],
    ["bars", "Metal bars", (d, id, S) => S.bars.has(id) || /_bar$|^bar_\d+$/.test(id)],
    ["gems", "Gems", (d, id) => id === "gem" || /^gem_\d+$/.test(id)],
    ["stone", "Stone & earth", (d, id, S, tag) => tag === "stone" || /stone|marble|limestone|clay|flint|chalk|slate/.test(id)],
    ["logs", "Logs", d => !!d.log],
    ["timber", "Timber & planks", (d, id) => /plank|board|beam|stave|timber/.test(id)],
    ["fuel", "Fuel & charcoal", (d, id, S, tag) => tag === "fuel" || /charcoal|coal|peat/.test(id)],
    ["hides", "Hides & pelts", (d, id) => /hide|pelt|fleece|rawhide/.test(id)],
    ["fibres", "Fibres & yarn", (d, id) => /cotton|flax|wool|yarn|thread|fleece|sinew/.test(id)],
    ["reagents", "Monster reagents", (d, id) => typeof REAGENT_IDS !== "undefined" && REAGENT_IDS.has(id)],
    ["raw", "Gathered raws", (d, id, S, tag) => tag === "raw"],
  ]],
  ["Food & Farming", [
    ["food", "Food", (d, id, S, tag) => !!d.heals || tag === "food"],
    ["rawfood", "Raw ingredients", (d, id) => /^raw_/.test(id)],
    ["fish", "Fish", (d, id, S) => S.fish.has(id)],
    ["meat", "Meat", (d, id) => /(^|_)meat|steak|sausage|bacon/.test(id)],
    ["dairy", "Dairy & cheese", (d, id) => /milk|cheese|butter|cream|curd/.test(id)],
    ["baked", "Bread & baked", (d, id) => /bread|cake|pie(_|$)|bun|pastry|dough/.test(id)],
    ["drink", "Drink", (d, id, S, tag) => tag === "drink"],
    ["seeds", "Seeds", (d, id, S) => S.seeds.has(id) || /_seeds$/.test(id)],
    ["crops", "Crops & produce", (d, id, S) => S.crops.has(id)],
    ["herbs", "Herbs", (d, id) => /^herb/.test(id)],
    ["potions", "Potions", (d, id, S, tag) => !!d.potion || tag === "potion"],
  ]],
  ["Craft & Trade goods", [
    ["textiles", "Textiles", (d, id, S, tag) => tag === "textile"],
    ["leathergoods", "Leather goods", (d, id, S, tag) => tag === "leather"],
    ["woodwork", "Woodwork", (d, id, S, tag) => tag === "wood"],
    ["metalwork", "Metalwork", (d, id, S, tag) => tag === "metal"],
    ["pottery", "Pottery", (d, id, S, tag) => tag === "pottery"],
    ["glass", "Glass", (d, id, S, tag) => tag === "glass"],
    ["luxury", "Luxury & fine goods", (d, id, S, tag) => tag === "luxury"],
    ["cordage", "Rope & cordage", (d, id, S, tag) => tag === "cordage" || /rope|twine|cord/.test(id)],
    ["arcane", "Arcane & runecraft", (d, id, S, tag) => tag === "arcane"],
    ["shipgoods", "Ship & sail goods", (d, id, S, tag) => tag === "ship" || !!d.boat],
    ["craftgoods", "Crafted sundries", (d, id, S, tag) => tag === "craft"],
  ]],
  ["Household & Misc", [
    ["furniture", "Furniture & placeables", d => !!d.place],
    ["lights", "Candles & light", (d, id) => /candle|lantern|lamp|torch|taper/.test(id)],
    ["keys", "Keys & locks", (d, id) => /(^|_)key(_|$)|_lock$/.test(id)],
    ["valuables", "Valuables (150+ coins)", d => (d.value || 0) >= 150],
    ["other", "Everything else", null],
  ]],
];
// the set of every category an item belongs to (cached — items never re-class)
const _bankCatCache = new Map();
function bankCatsFor(id) {
  let set = _bankCatCache.get(id);
  if (set) return set;
  set = new Set();
  const d = ITEMS[id];
  if (d) {
    const S = bankSets();
    const tag = typeof itemTag === "function" ? itemTag(id) : "misc";
    for (const [, list] of BANK_CAT_GROUPS)
      for (const [key, , test] of list)
        if (test && test(d, id, S, tag)) set.add(key);
  }
  if (!set.size) set.add("other");
  _bankCatCache.set(id, set);
  return set;
}
// live per-category counts in the dropdown labels: "Ores (12)" = 12 distinct
// vault stacks match. Recomputed on every grid rebuild (cheap: one cached
// set-lookup per stack).
function updateBankCatCounts() {
  const sel = document.getElementById("bankcatsel");
  if (!sel) return;
  const counts = { all: player.bank.length };
  for (const s of player.bank)
    for (const c of bankCatsFor(s.id)) counts[c] = (counts[c] || 0) + 1;
  for (const o of sel.options)
    o.textContent = `${o.dataset.label} (${counts[o.value] || 0})`;
}
{
  const cats = document.getElementById("bankcats");
  const sel = document.createElement("select");
  sel.id = "bankcatsel";
  sel.title = "Filter the vault by category (categories overlap)";
  const addOpt = (parent, key, label) => {
    const o = document.createElement("option");
    o.value = key;
    o.dataset.label = label;
    o.textContent = label;
    parent.appendChild(o);
  };
  addOpt(sel, "all", "All items");
  for (const [glabel, list] of BANK_CAT_GROUPS) {
    const og = document.createElement("optgroup");
    og.label = glabel;
    for (const [key, label] of list) addOpt(og, key, label);
    sel.appendChild(og);
  }
  sel.onchange = () => {
    bankFilter.cat = sel.value;
    bankShownRev = -1;
    renderBank();
  };
  cats.appendChild(sel);
  document.getElementById("banksearch").oninput = e => {
    bankFilter.q = e.target.value.trim().toLowerCase();
    bankShownRev = -1;
    renderBank();
  };
  // Deposit all = the whole inventory; almost all = everything below the top
  // two rows (slots 0-11 at 6 columns), where players keep tools and food
  document.getElementById("depositallbtn").onclick = () => depositRange(0);
  document.getElementById("depositmostbtn").onclick = () => depositRange(12);
  // native scroll only inside the trade window — never the camera zoom
  document.getElementById("trade-body").addEventListener("wheel", e => e.stopPropagation(), { passive: true });
}
// deposit every stack from inventory slot `startSlot` onward
function depositRange(startSlot) {
  let stacks = 0;
  for (let i = startSlot; i < player.inv.length; i++) {
    const s = player.inv[i];
    if (!s) continue;
    const b = player.bank.find(b2 => b2.id === s.id);
    if (b) b.qty += s.qty;
    else player.bank.push({ id: s.id, qty: s.qty });
    player.inv[i] = null;
    stacks++;
  }
  if (stacks) {
    log(`You deposit ${stacks} stack${stacks === 1 ? "" : "s"}.`);
    bankRev++;
    uiDirty = true;
    renderBank();
  }
}
// ---- bank networks ----
// Settlements linked by the road web share ONE vault; a landmass roads can't
// reach (an island, a walled-off basin) keeps its own separate vault. Every
// chest resolves to the network of the ground it stands on (world.bankNetId),
// so a chest anywhere on the mainland opens the same "main" vault, while a
// chest on an isolated isle opens that isle's — items banked there can only
// be withdrawn there.
function bankNetFor(x, y) {
  if (typeof world !== "undefined" && world) {
    if (world.bankNetAt) return world.bankNetAt(x, y);   // road-web network (nearest settlement)
    if (world.bankNetId) return world.bankNetId(x, y);   // pre-roadnet fallback
  }
  return "main";
}
// { title, branch, members } for a settled network, null for hermit vaults
function bankInfoFor(net) {
  return (typeof world !== "undefined" && world && world.bankNetInfo) ? world.bankNetInfo(net) : null;
}
// the vault ARRAY for a network id — player.banks holds one per network;
// player.bank stays an alias of the active one so all the deposit/withdraw
// code (and the save) keeps working on a plain array.
function bankArrFor(net) {
  if (!player.banks) player.banks = { main: player.bank || [] };
  if (!player.banks[net]) player.banks[net] = [];
  return player.banks[net];
}
// the name shown at the top of the bank window: settled networks are titled
// by bankNetInfo ("Bank of Newhaven", "Bank of Braadford and Hildford");
// unsettled hermit vaults keep a deterministic name hashed from the id
function bankNetName(net) {
  const info = bankInfoFor(net);
  if (info) return info.title;
  if (net === "main") return "The Commons Bank";
  let h = 0;
  for (let i = 0; i < net.length; i++) h = (h * 131 + net.charCodeAt(i)) >>> 0;
  const A = ["Gull", "Drift", "Mist", "Storm", "Pearl", "Kelp", "Wreck", "Tide", "Fog", "Salt", "Reef", "Gale"];
  const B = ["rock", "haven", "watch", "hold", "moor", "strand", "cove", "reach", "point", "rest", "shoal", "sound"];
  return "Vault of " + A[h % A.length] + B[(h >>> 4) % B.length];
}
// ---- bank accounts ---------------------------------------------------------
// A network with a main branch only serves ACCOUNT HOLDERS: its chests stay
// shut until you've signed the ledger with a banker at the main branch.
// Hermit networks (no city, nobody to keep a ledger) open freely, as before.
function hasBankAccount(net) {
  if (DEV_MODE) return true; // cheat mode: every ledger already holds your name
  return !!(player.bankAccounts && player.bankAccounts[net]);
}
// The bank's guaranteed kit: an account is NEVER without these — withdraw the
// last one and the bank restocks it on the spot. Fire, light, wood, ore and a
// wash: enough to work your way out of a sticky wilderness situation (stuck
// out at nightfall, too stinky for the city gates…) from any wayside chest.
const BANK_PERMANENTS = [["flint", 1], ["candle", 1], ["axe_iron", 1], ["pickaxe_iron", 1], ["lye_soap", 1]];
// signup incentives, deterministic per bank: Newhaven runs the flagship
// new-adventurer package; regional city banks hash their own coin bonus and
// gifts; tiny village co-op banks make a modest but heartfelt offer
function bankPerksFor(net) {
  if (net === "main") return { coins: 1000, gifts: [["dagger_iron", 1], ["shortbow", 1], ["arrow_iron", 500]] };
  let h = 0;
  for (let i = 0; i < net.length; i++) h = (h * 131 + net.charCodeAt(i)) >>> 0;
  const pool = [["dagger_iron", 1], ["shortbow", 1], ["arrow_iron", 300], ["spear_iron", 1], ["mace_iron", 1], ["shortsword_iron", 1]];
  const info = bankInfoFor(net);
  if (info && !info.branch) {
    const gifts = [pool[(h >>> 5) % pool.length]];
    if ((h >>> 3) % 2) gifts.push(pool[((h >>> 5) + 2) % pool.length]);
    return { coins: 250 + (h % 5) * 50, gifts };
  }
  const gifts = [];
  const n = 2 + (h >>> 3) % 2;
  for (let i = 0; i < n; i++) gifts.push(pool[((h >>> 5) + i * 2) % pool.length]);
  return { coins: 400 + (h % 7) * 100, gifts };
}
// top the guaranteed kit back up; true if anything was restocked
function ensureBankPermanents(net) {
  if (!hasBankAccount(net) || !bankInfoFor(net)) return false;
  const arr = bankArrFor(net);
  let changed = false;
  for (const [id, q] of BANK_PERMANENTS) {
    if (!ITEMS[id]) continue;
    const s = arr.find(b => b.id === id);
    if (!s) { arr.push({ id, qty: q }); changed = true; }
    else if (s.qty < q) { s.qty = q; changed = true; }
  }
  if (changed) bankRev++;
  return changed;
}
// cheat mode: every vault permanently stocks 1000 of every item in the game —
// same standing-promise mechanic as BANK_PERMANENTS, so a stack drawn below
// 1000 is topped straight back up (deposits can push it above; never trimmed)
const CHEAT_STOCK_QTY = 1000;
function ensureCheatStock(net) {
  if (!DEV_MODE) return false;
  const arr = bankArrFor(net);
  const byId = new Map(arr.map(s => [s.id, s]));
  let changed = false;
  for (const id in ITEMS) {
    const s = byId.get(id);
    if (!s) { arr.push({ id, qty: CHEAT_STOCK_QTY }); changed = true; }
    else if (s.qty < CHEAT_STOCK_QTY) { s.qty = CHEAT_STOCK_QTY; changed = true; }
  }
  if (changed) bankRev++;
  return changed;
}
// "(214 tiles north-west)" pointer for the ledger-refusal message
function bankCompassHint(tx, ty) {
  const dx = tx - player.x, dy = ty - player.y;
  const d = Math.round(Math.hypot(dx, dy));
  if (d < 40) return ""; // it's right here in town
  const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7;
  return ` (${d} tiles ${dirs[a]})`;
}
// Callers (1):
//  skills/crafting.js:5
function openBank(node) {
  const bx = node ? node.x : player.x, by = node ? node.y : player.y;
  const net = bankNetFor(bx, by);
  const info = bankInfoFor(net);
  if (info && !hasBankAccount(net)) {
    let where;
    if (info.branch) {
      where = `with a banker at the main branch in ${info.branch.name}${bankCompassHint(info.branch.x, info.branch.y)}`;
    } else {
      // a tiny village co-op: any member village's bank clerk signs you up
      const names = info.members.map(m => m.name);
      const list = names.length === 1 ? names[0]
        : names.length === 2 ? names[0] + " or " + names[1]
        : names.slice(0, -1).join(", ") + ", or " + names[names.length - 1];
      let nm = info.members[0], nd = Infinity;
      for (const m of info.members) {
        const d = (m.x - player.x) * (m.x - player.x) + (m.y - player.y) * (m.y - player.y);
        if (d < nd) { nd = d; nm = m; }
      }
      where = `with the bank clerk in ${list}${bankCompassHint(nm.x, nm.y)}`;
    }
    log(`The chest is sealed by the ${info.title} — and its ledger holds no account in your name. Open one ${where}.`, "warn");
    return;
  }
  if (player.bankNet !== net) bankRev++;        // different vault: force a rebuild
  player.bankNet = net;
  player.bank = bankArrFor(net);
  ensureBankPermanents(net);                    // the guaranteed kit is always in place
  ensureCheatStock(net);                        // cheat mode: 1000 of everything
  openTrade("bank", bankNetName(net), bx, by);
  bankFilter.q = "";
  document.getElementById("banksearch").value = "";
  bankShownRev = -1;
  renderBank();
}
// signing the ledger: the account opens, the bonus + gifts land in the vault
function openBankAccountFor(net, npc) {
  player.bankAccounts = player.bankAccounts || {};
  player.bankAccounts[net] = 1;
  const arr = bankArrFor(net), perks = bankPerksFor(net);
  const add = (id, q) => {
    const b = arr.find(x => x.id === id);
    if (b) b.qty += q; else arr.push({ id, qty: q });
  };
  add("coins", perks.coins);
  for (const [id, q] of perks.gifts) if (ITEMS[id]) add(id, q);
  ensureBankPermanents(net);
  bankRev++;
  uiDirty = true;
  sfx("coins", 0.8);
  log(`${npc ? npc.name + " stamps the ledger — w" : "W"}elcome to the ${bankNetName(net)}! ` +
    `${perks.coins} coins and the bank's welcome gifts are waiting in your new vault.`, "gold");
}
// the banker's counter pitch (main-branch signup dialog)
let bankSignupEl = null;
function openBankSignup(npc, net) {
  const perks = bankPerksFor(net), bname = bankNetName(net);
  const nameOf = id => (ITEMS[id] && ITEMS[id].name) || id;
  const giftList = perks.gifts.map(([id, q]) => q > 1 ? `${q} × ${nameOf(id)}` : nameOf(id)).join(", ");
  const permList = BANK_PERMANENTS.map(([id]) => nameOf(id)).join(", ");
  if (!bankSignupEl) {
    bankSignupEl = document.createElement("div");
    bankSignupEl.id = "banksignup";
    document.body.appendChild(bankSignupEl);
  }
  bankSignupEl.innerHTML =
    `<div class="bswin"><div class="bshead"></div><div class="bsbody"></div>` +
    `<div class="bsbtns"><button class="bsyes">Open an account</button><button class="bsno">Not today</button></div></div>`;
  const sInfo = bankInfoFor(net);
  bankSignupEl.querySelector(".bshead").textContent =
    bname + (sInfo && sInfo.branch ? " — Main Branch" : " — Village Counter");
  bankSignupEl.querySelector(".bsbody").innerHTML =
    `<p>${npc.name} slides a ledger across the counter:</p>` +
    `<p>“Open an account today and the ${bname} deposits a welcome of <b>${perks.coins} coins</b> ` +
    `with <b>${giftList}</b> straight into your vault.”</p>` +
    `<p>“And our standing promise: your account is never without <b>${permList}</b> — ` +
    `withdraw the last one at any of our chests, wherever you are, and the bank replaces it.”</p>`;
  const close = () => { bankSignupEl.style.display = "none"; };
  bankSignupEl.style.display = "flex";
  bankSignupEl.onclick = e => { if (e.target === bankSignupEl) close(); };
  bankSignupEl.querySelector(".bsno").onclick = close;
  bankSignupEl.querySelector(".bsyes").onclick = () => {
    close();
    openBankAccountFor(net, npc);
    openBank(npc); // straight to the fresh vault so the welcome gift is visible
  };
}
// talking to a main-branch banker: signup pitch, or straight to your vault
function bankerTalk(npc) {
  const net = bankNetFor(npc.x, npc.y);
  if (hasBankAccount(net)) {
    log(`${npc.name}: "Good day! Your ${bankNetName(net)} account stands ready."`, "sys");
    openBank(npc);
  } else {
    openBankSignup(npc, net);
  }
}
// Deposit up to n from inventory slot i into the vault. Used by the normal
// inventory panel while the bank window is open (there is no separate
// deposit grid any more).
function depositToBank(i, n) {
  const s = player.inv[i];
  if (!s) return;
  n = Math.min(n, s.qty);
  if (n <= 0) return;
  const b = player.bank.find(b2 => b2.id === s.id);
  if (b) b.qty += n;
  else player.bank.push({ id: s.id, qty: n });
  s.qty -= n;
  if (s.qty <= 0) player.inv[i] = null;
  bankRev++;
  if (typeof Tutorial !== "undefined" && Tutorial.onBank) Tutorial.onBank(); // isle stage task
  uiDirty = true;
}
// Callers (4):
//  main/ui.js:44,190,208,227
// per-item slot element cache: the icon canvas is drawn ONCE per item id and
// reused across every rebuild — with a big vault, recreating hundreds of
// canvases per deposit/withdraw was most of the remaining bank lag
const bankSlotCache = new Map(); // id -> { el, qtyEl, lastQty }
function bankSlotFor(s) {
  const def = ITEMS[s.id];
  let c = bankSlotCache.get(s.id);
  if (!c) {
    const el = document.createElement("div");
    el.className = "slot";
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 32;
    cv.getContext("2d").drawImage(icon(def.icon), 0, 0);
    el.appendChild(cv);
    const q = document.createElement("span");
    q.className = "qty";
    el.appendChild(q);
    el.title = def.name;
    c = { el, qtyEl: q, lastQty: -1 };
    bankSlotCache.set(s.id, c);
  }
  if (c.lastQty !== s.qty) {
    c.qtyEl.textContent = s.qty === 1 ? "" : s.qty >= 100000 ? Math.floor(s.qty / 1000) + "k" : s.qty;
    c.lastQty = s.qty;
  }
  return c.el;
}
function renderBank() {
  if (bankShownRev === bankRev) return;
  bankShownRev = bankRev;
  const grid = document.getElementById("bankgrid");
  updateBankCatCounts();
  // show the biggest stacks first, not insertion order; apply the category
  // dropdown (set membership — categories overlap) and search box
  const sortedBank = player.bank.slice().sort((a, b) => b.qty - a.qty)
    .filter(s => (bankFilter.cat === "all" || bankCatsFor(s.id).has(bankFilter.cat)) &&
      (!bankFilter.q || (ITEMS[s.id] && ITEMS[s.id].name.toLowerCase().includes(bankFilter.q))));
  const frag = document.createDocumentFragment();
  sortedBank.forEach(s => {
    const d = bankSlotFor(s);
    const withdraw = n => {
      n = Math.min(n, s.qty);
      let moved = 0;
      for (let k = 0; k < n; k++) {
        if (!addItem(s.id, 1)) break;
        moved++;
      }
      if (!moved) { log("Your inventory is full.", "warn"); return; }
      s.qty -= moved;
      if (s.qty <= 0) player.bank.splice(player.bank.indexOf(s), 1);
      // the bank's guaranteed kit: withdrawing the last one restocks it, so
      // an account is never without its flint/candle/axe/pick/soap
      if (s.qty <= 0 && ensureBankPermanents(player.bankNet))
        log(`The ${bankNetName(player.bankNet)} restocks your ${(ITEMS[s.id] ? ITEMS[s.id].name : s.id).toLowerCase()} — account holders are never without one.`, "sys");
      ensureCheatStock(player.bankNet); // cheat mode: the 1000-of-everything shelf refills itself
      if (typeof Tele !== "undefined") Tele.ev("bank", "wd", s.id, moved);
      bankRev++;
      uiDirty = true;
      renderBank();
    };
    d.onclick = e => withdraw(e.altKey ? s.qty : e.shiftKey ? 5 : 1);
    d.oncontextmenu = e => amountMenu(e, "Withdraw", "all", withdraw);
    frag.appendChild(d);
  });
  if (!sortedBank.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = player.bank.length ? "Nothing in the vault matches." : "Your bank is empty.";
    frag.appendChild(p);
  }
  grid.replaceChildren(frag);
}

// craft / plant / alchemy windows (share the #trade modal's craft section)
// Callers (3):
//  main/ui.js:258,276,296
function craftRow(iconKey, title, sub, locked, onclick) {
  const d = document.createElement("div");
  d.className = "recipe" + (locked ? " locked" : "");
  const cv = document.createElement("canvas");
  cv.width = 32; cv.height = 32;
  cv.getContext("2d").drawImage(icon(iconKey), 0, 0);
  d.appendChild(cv);
  const info = document.createElement("div");
  info.className = "rinfo";
  info.innerHTML = `<div class="rname">${title}</div><div class="rreq">${sub}</div>`;
  d.appendChild(info);
  d.onclick = onclick;
  return d;
}

// "make ALL" amount for a recipe: run an active recipe until materials run
// out, or queue the biggest affordable passive batch. (The old 1/5/10/max
// batch bar is gone — stations use the BANK's click grammar now, user req
// 2026-09-16: click makes 1, Shift+click 5, Option/Alt+click all, and
// right-click opens the amount menu.)
function craftMax(recipe) {
  let m = Infinity;
  for (const [id, q] of Object.entries(recipe.in)) m = Math.min(m, Math.floor(countItem(id) / q));
  return recipe.passive ? Math.max(1, m === Infinity ? 1 : m) : Infinity;
}
function primaryOut(r) { return (r.outputs && r.outputs[0] && r.outputs[0].id) || r.out; }

// Callers (1):
//  skills/crafting.js:9
function openCraft(node, recipes) {
  openTrade("craft", node.dyn ? "Campfire" : STATIONS[node.type].name,
    node.x != null ? node.x : player.x, node.y != null ? node.y : player.y);
  const list = document.getElementById("craftlist");
  list.innerHTML = "";
  // the bank's click grammar, spelled out once at the top of the panel
  const hint = document.createElement("div");
  hint.className = "rreq";
  hint.style.cssText = "padding:4px 6px;opacity:.8;";
  hint.textContent = "Click: make 1 · ⇧ click: 5 · ⌥ click: all · right-click: more";
  list.appendChild(hint);
  // ---- output box: passive jobs at this station. Finished goods sit here
  // (like a little bank slot on the station) until the player collects them;
  // unfinished ones show a countdown.
  const pending = (player.jobs || []).filter(j => node.type == null || j.station == null || j.station === node.type);
  const ready = pending.filter(j => Date.now() >= j.doneAt);
  if (pending.length) {
    const box = document.createElement("div");
    box.className = "outputbox";
    const hdr = document.createElement("div");
    hdr.className = "contracthdr";
    hdr.textContent = "Station output:";
    box.appendChild(hdr);
    const row = document.createElement("div");
    row.className = "outputrow";
    for (const j of pending) {
      const r = typeof jobRecipe === "function" ? jobRecipe(j) : null;
      const outId = r ? primaryOut(r) : null;
      const done = Date.now() >= j.doneAt;
      const left = Math.max(0, Math.ceil((j.doneAt - Date.now()) / 1000));
      const d = slotEl(outId && ITEMS[outId] ? ITEMS[outId].icon : null, j.qty,
        (r ? r.name : "Job") + (done ? " — ready!" : ` — ${left}s left`));
      if (done) {
        d.classList.add("ready");
        d.onclick = () => { collectReadyJobs(node.type); openCraft(node, recipes); };
      } else {
        d.classList.add("cooking");
        const t = document.createElement("span");
        t.className = "cooktime";
        const queued = j.startedAt > Date.now();
        t.textContent = queued ? "queued" : left + "s";
        d.appendChild(t);
        // loading bar (user req): the batch's progress through its own run —
        // 0% while it still waits its turn in the station's serial queue.
        // The once-a-second countdown re-render below keeps it moving.
        const barBg = document.createElement("div");
        barBg.style.cssText = "position:absolute;left:2px;right:2px;bottom:2px;height:4px;background:rgba(8,12,18,.8);border-radius:2px";
        const fill = document.createElement("div");
        const frac = queued ? 0 : Math.max(0, Math.min(1, (Date.now() - j.startedAt) / Math.max(1, j.doneAt - j.startedAt)));
        fill.style.cssText = `height:100%;width:${Math.round(frac * 100)}%;background:#ffd75e;border-radius:2px`;
        barBg.appendChild(fill);
        d.style.position = "relative";
        d.appendChild(barBg);
      }
      row.appendChild(d);
    }
    box.appendChild(row);
    if (ready.length) {
      const btn = document.createElement("button");
      btn.className = "collectbtn";
      btn.textContent = `Collect finished goods (${ready.reduce((n, j) => n + j.qty, 0)})`;
      btn.onclick = () => { collectReadyJobs(node.type); openCraft(node, recipes); };
      box.appendChild(btn);
    }
    list.appendChild(box);
    // live countdowns: refresh once a second while jobs are still cooking
    if (pending.some(j => Date.now() < j.doneAt)) {
      clearTimeout(openCraft._tick);
      openCraft._tick = setTimeout(() => {
        if (tradeCtx && tradeCtx.mode === "craft") openCraft(node, recipes);
      }, 1000);
    }
  }
  // ---- pilot-fire panel: heat stations show their current heat and a Stoke
  // button. Firemaking-fuelled trades can't run until the fire is hot enough.
  const heatStation = typeof isHeatSkill === "function" && recipes.some(r => isHeatSkill(r.skill));
  let curHeat = 0;
  if (heatStation) {
    curHeat = stationHeatNow(node);
    const left = stationBurnLeft(node);
    const box = document.createElement("div");
    box.className = "heatbox";
    // conserve premium fuel: default stoke burns the cheapest log hot enough for
    // what you can craft here; right-click forces the hottest fuel (charcoal).
    const bi = bestLogIndex(stationTargetHeat(node));
    const hi = bestLogIndex(Infinity);
    const lit = curHeat > 0;
    const info = document.createElement("div");
    info.className = "heatinfo";
    info.innerHTML = `<span class="heatflame">${lit ? "🔥" : "🪵"}</span> Fire heat: <b>${curHeat}°</b>`
      + `<span class="heatmax"> / ${HEAT_MAX}°</span>` + (lit ? ` · ${left}s left` : " · cold");
    box.appendChild(info);
    const btn = document.createElement("button");
    btn.className = "stokebtn";
    if (bi >= 0) {
      const logName = ITEMS[player.inv[bi].id].name;
      btn.textContent = `🔥 Stoke fire (burn 1 ${logName})`;
      btn.title = hi >= 0 && hi !== bi
        ? `Right-click to stoke with your hottest fuel (${ITEMS[player.inv[hi].id].name}) instead`
        : "Burns the cheapest fuel hot enough for what you can craft here";
      btn.onclick = () => { stokeFire(node, bi); openCraft(node, recipes); };
      btn.oncontextmenu = e => { e.preventDefault(); stokeFire(node, hi); openCraft(node, recipes); };
    } else {
      btn.textContent = "🔥 Stoke fire — no logs in your pack";
      btn.disabled = true;
    }
    box.appendChild(btn);
    list.appendChild(box);
    // live-decay the readout while the panel is open
    clearTimeout(openCraft._heatTick);
    openCraft._heatTick = setTimeout(() => {
      if (tradeCtx && tradeCtx.mode === "craft") openCraft(node, recipes);
    }, 1000);
  }
  // Only show recipes the player's skill level actually allows — locked
  // higher-tier recipes stay hidden until the level is reached.
  const unlocked = recipes.filter(r => skillLvl(r.skill) >= r.req);
  for (const r of unlocked) {
    const outId = primaryOut(r);
    const haveMats = Object.entries(r.in).every(([id, q]) => countItem(id) >= q);
    const need = heatStation && isHeatSkill(r.skill) ? reqHeat(r) : 0;
    const hotEnough = need <= curHeat;
    const dur = r.passive ? (r.time || r.tick || 0) : 0;
    const fireLasts = !need || !r.passive || stationBurnLeft(node) * 1000 >= dur;
    const have = haveMats && hotEnough && fireLasts;
    const needs = Object.entries(r.in).map(([id, q]) => `${q} ${ITEMS[id].name}`).join(", ");
    const bys = (r.byproducts || []).map(b => ITEMS[b.id] && ITEMS[b.id].name).filter(Boolean);
    let sub = `${r.skill} ${r.req} — needs ${needs}`;
    if (need) sub += ` · 🔥 ${need}°${hotEnough ? "" : " (too cold)"}`;
    if (bys.length) sub += ` · yields ${bys.join(", ")}`;
    if (r.passive) sub += ` · passive ~${Math.ceil((r.time || r.tick || 0) / 1000)}s${need && !fireLasts ? " (fire too brief)" : ""}`;
    // bank-style amounts (user req 2026-09-16): click = 1, Shift+click = 5,
    // Option/Alt+click = all, right-click = the amount menu (5/10/50/X…/all)
    const doCraft = n => {
      if (!haveMats) { log("You don't have the materials.", "warn"); return; }
      if (!hotEnough) { log(`The fire isn't hot enough (${curHeat}° / ${need}°). Stoke it with logs.`, "warn"); return; }
      if (!fireLasts) { log(`The fire won't last the ~${Math.ceil(dur / 1000)}s firing. Stoke it with charcoal — it burns far longer.`, "warn"); return; }
      let amt = n === Infinity ? craftMax(r) : n;
      if (r.passive) amt = Math.max(1, Math.min(amt, craftMax(r))); // a passive job queues only what the mats afford
      closeTrade(); beginCraft(r, node, amt);
    };
    const row = craftRow(ITEMS[outId].icon, r.name, sub, !have,
      e => doCraft(e && e.altKey ? Infinity : e && e.shiftKey ? 5 : 1));
    row.oncontextmenu = e => amountMenu(e, "Make", "all", doCraft);
    list.appendChild(row);
  }
}

// Callers (1):
//  skills/farming.js:5
function openPlantPanel(node) {
  openTrade("craft", node.skill ? node.skill + " field" : "Farm plot", node.x, node.y);
  const list = document.getElementById("craftlist");
  list.innerHTML = "";
  // A field grows one CATEGORY of crop (its soil type, node.skill) — only show
  // that category. Otherwise (legacy plots) show any crop you have seeds for or
  // have unlocked. All crops train the single Farming skill now.
  const need = (typeof CROP_SEED_COST !== "undefined") ? CROP_SEED_COST : 5;
  const kinds = Object.keys(CROPS).filter(k => {
    const c = CROPS[k];
    if (node.skill && c.cat && c.cat !== node.skill) return false;
    return countItem(c.seed) > 0 || skillLvl(c.skill || "Farming") >= c.req;
  }).sort((a, b) => (CROPS[a].cat || "").localeCompare(CROPS[b].cat || "") || CROPS[a].req - CROPS[b].req);
  for (const kind of kinds) {
    const crop = CROPS[kind], sk = crop.skill || "Farming";
    const ok = skillLvl(sk) >= crop.req;
    const have = countItem(crop.seed) >= need;
    const sub = `Farming ${crop.req} — needs ${need} ${ITEMS[crop.seed].name} (have ${countItem(crop.seed)})`;
    list.appendChild(craftRow(ITEMS[crop.item].icon, `Plant ${crop.name}`, sub, !(ok && have), () => {
      if (ok && have) { closeTrade(); plantCrop(node, kind); }
      else if (!ok) log(`You need ${sk} level ${crop.req} for that.`, "warn");
      else log("You don't have the seeds.", "warn");
    }));
  }
  if (!kinds.length) list.innerHTML = "<p class='hint'>You have no seeds. Buy some from a trader, then plant here.</p>";
}

// Callers (1):
//  skills/crafting.js:7
function openAlchemy(node) {
  openTrade("craft", "Alchemy table", node.x, node.y);
  const list = document.getElementById("craftlist");
  list.innerHTML = "";
  const rate = Math.min(0.8, 0.5 + eff("Alchemy") * 0.005);
  const seen = new Set();
  for (const s of player.inv) {
    if (!s || s.id === "coins" || seen.has(s.id)) continue;
    seen.add(s.id);
    const def = ITEMS[s.id];
    const gold = Math.max(1, Math.floor(def.value * rate));
    list.appendChild(craftRow(def.icon, `Transmute ${def.name}`, `${gold} coins each (${Math.round(rate * 100)}% value)`, false, () => {
      closeTrade();
      player.act = { kind: "alch", itemId: s.id, node, nextAt: now + 600 };
      log("You focus on the transmutation...");
    }));
  }
  if (!seen.size) list.innerHTML = "<p class='hint'>Nothing to transmute. Bring items!</p>";
}

// ===== Our RPG Workshop — the ubiquitous vote symbol =====
// One reusable ballot control used anywhere in the studio. Call
// VoteWidget.symbol(opts) to get a small clickable "🗳" glyph; clicking it opens
// a popover with the right input for the field — a number box, a free-text box,
// or an item-id dropdown — plus the current live tally (click a tallied choice
// to vote it). Votes ride the game's existing workshop ballot via js/taiao.js
// (Taiao.castVote / myVote), so every vote is one choice per (subject, field),
// switchable, exactly like the rest of the app.
//
// opts = {
//   kind, folder, field,        // → subject gen:<kind>:<folder>, votable field
//   type: "number"|"string"|"item"|"select",
//   label,                      // human label shown in the popover header
//   current, currentLabel,      // the game's present value (shown as a hint / prefill)
//   choices,                    // for type:"select" — [value | {value,label}]
//   tallies | getTallies(),     // { field: {choice: count} } (object or getter)
//   refetch,                    // async () => refresh tallies after a vote
//   placeholder, min, max,
// }
"use strict";

const VOTE_GLYPH = "🗳";

const VoteWidget = (function () {
  let pop = null;

  function close() {
    if (!pop) return;
    document.removeEventListener("mousedown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    pop.remove(); pop = null;
  }
  function onDoc(e) { if (pop && !pop.contains(e.target) && e.target !== pop._anchor) close(); }
  function onKey(e) { if (e.key === "Escape") close(); }

  // shared datalist of every item id (for type:"item")
  function itemDatalist() {
    let dl = document.getElementById("vote-item-ids");
    if (dl) return "vote-item-ids";
    dl = el("datalist", { id: "vote-item-ids" });
    try { if (typeof ITEMS !== "undefined") Object.keys(ITEMS).forEach(id => dl.appendChild(el("option", { value: id, label: (ITEMS[id] && ITEMS[id].name) || id }))); } catch (_) {}
    document.body.appendChild(dl);
    return "vote-item-ids";
  }

  const tallyOf = opts => (opts.getTallies ? opts.getTallies() : (opts.tallies || {}))[opts.field] || {};
  const labelFor = (opts, k) => (opts.type === "item" && typeof ITEMS !== "undefined" && ITEMS[k] && ITEMS[k].name) || k;

  function symbol(opts) {
    return el("button.vote-sym", {
      type: "button", title: "Vote on " + (opts.label || "this value"), text: VOTE_GLYPH,
      onclick: e => { e.preventDefault(); e.stopPropagation(); toggle(e.currentTarget, opts); },
    });
  }

  function toggle(anchor, opts) {
    const was = pop && pop._anchor === anchor;
    close();
    if (was) return;
    open(anchor, opts);
  }

  function open(anchor, opts) {
    pop = build(opts);
    pop._anchor = anchor;
    document.body.appendChild(pop);
    place(pop, anchor);
    setTimeout(() => {
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", close);
      const f = pop.querySelector("input,select"); if (f) f.focus();
    }, 0);
  }

  // Always centre the dialog in the viewport (fixed), regardless of where the
  // glyph was clicked or how far the page is scrolled. Tall dialogs scroll
  // inside themselves rather than running off-screen.
  function place(el_) {
    el_.style.position = "fixed";
    el_.style.top = "50%";
    el_.style.left = "50%";
    el_.style.transform = "translate(-50%, -50%)";
    el_.style.maxHeight = "80vh";
    el_.style.overflowY = "auto";
    el_.style.zIndex = "1000";
  }

  function build(opts) {
    const box = el("div.vote-pop");
    box.appendChild(el("div.vote-pop-h", { text: "Vote — " + (opts.label || "value") }));
    if (opts.currentLabel != null || opts.current != null)
      box.appendChild(el("div.vote-pop-cur.mono", { text: "current: " + (opts.currentLabel != null ? opts.currentLabel : opts.current) }));
    if (opts.note) box.appendChild(el("div.vote-pop-note.mono", { text: opts.note }));

    let getVal = null, input;
    if (typeof opts.render === "function") {
      // escape hatch: a compound control (e.g. the action-menu gate builder)
      // renders its own inputs and calls api.submit(value) itself.
      opts.render(box, { submit, close });
    } else if (opts.type === "select") {
      input = el("select.vote-input");
      (opts.choices || []).forEach(c => { const v = typeof c === "object" ? c.value : c, l = typeof c === "object" ? c.label : c; input.appendChild(el("option", { value: String(v), text: String(l) })); });
      if (opts.current != null) input.value = String(opts.current);
      getVal = () => input.value;
      box.appendChild(input);
      if (opts.custom) {   // …or type a value not in the list
        const ci = el("input.vote-input", { placeholder: opts.customPlaceholder || "or type a custom value…", style: "margin-top:.35rem" });
        ci.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(getVal()); } });
        box.appendChild(ci);
        getVal = () => ci.value.trim() || input.value;
      }
    } else if (opts.type === "item") {
      input = el("input.vote-input", { placeholder: opts.placeholder || "type or pick an item…", autocomplete: "off" });
      input.setAttribute("list", itemDatalist());
      if (opts.current) input.value = String(opts.current);
      getVal = () => input.value.trim();
      box.appendChild(input);
    } else if (opts.type === "number") {
      input = el("input.vote-input", { type: "number", placeholder: opts.placeholder || "number" });
      if (opts.min != null) input.min = opts.min; if (opts.max != null) input.max = opts.max;
      if (opts.current != null && opts.current !== "") input.value = String(opts.current);
      getVal = () => input.value.trim();
      box.appendChild(input);
    } else {
      input = el("input.vote-input", { placeholder: opts.placeholder || "value…" });
      if (opts.current != null) input.value = String(opts.current);
      getVal = () => input.value.trim();
      box.appendChild(input);
    }
    if (input && opts.type !== "select") input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(getVal()); } });
    else if (input && opts.type === "select" && !opts.custom) input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(getVal()); } });

    const tallyHost = el("div.vote-pop-tally");
    box.appendChild(tallyHost);
    if (!opts.hideTally) renderTally();
    function renderTally() {
      clear(tallyHost);
      const t = tallyOf(opts), keys = Object.keys(t).sort((a, b) => t[b] - t[a]).slice(0, 8);
      if (!keys.length) { tallyHost.appendChild(el("small.tagline", { text: "No votes yet — be the first." })); return; }
      const mine = Taiao.myVote(opts.kind, opts.folder, opts.field);
      keys.forEach(k => tallyHost.appendChild(el("span.chip.sm" + (mine === k ? ".on" : ""), {
        html: escapeHtml(String(labelFor(opts, k))) + " <b>" + t[k] + "</b>", onclick: () => submit(k),
      })));
    }

    box.appendChild(el("div.btn-row", { style: "margin-top:.5rem" }, [
      getVal ? el("button.btn.sm.primary", { text: "Vote", onclick: () => submit(getVal()) }) : null,
      el("button.btn.sm.ghost", { text: "Cancel", onclick: close }),
    ].filter(Boolean)));

    async function submit(val) {
      val = String(val == null ? "" : val).trim();
      if (!val) { toast("Enter a value first.", "warn"); return; }
      if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); close(); App.go("#/settings"); return; }
      const r = await Taiao.castVote(opts.kind, opts.folder, opts.field, val.slice(0, 60));
      if (r && r.error) { toast(r.error, "err"); return; }
      toast("Vote recorded.", "ok");
      if (opts.refetch) { try { await opts.refetch(); } catch (_) {} }
      close();
    }
    return box;
  }

  // Inline keep/remove-style vote buttons — the convention for MAIN-PAGE TABLE
  // rows (the 🗳 symbol popover is used on individual/detail pages instead).
  // Renders one <button> per choice, highlighting the viewer's current pick and
  // showing each choice's live tally; clicking casts (and re-picking clears) the
  // vote through the same Taiao ballot as the symbol popover.
  //   opts = { kind, folder, field, choices?, label, tallies|getTallies(), refetch, register? }
  // choices default to [["keep","Keep"],["remove","Remove"]]; each may be a
  // [value,label] pair, a {value,label} object, or a bare string.
  function buttons(opts) {
    const choices = (opts.choices || [["keep", "Keep"], ["remove", "Remove"]]).map(c =>
      Array.isArray(c) ? { value: c[0], label: c[1] } : (typeof c === "object" ? c : { value: c, label: c }));
    const wrap = el("span", { style: "display:inline-flex;gap:.3rem;flex-wrap:wrap" });
    function render() {
      clear(wrap);
      const mine = (typeof Taiao !== "undefined" && Taiao.myVote) ? Taiao.myVote(opts.kind, opts.folder, opts.field) : null;
      const t = tallyOf(opts);
      choices.forEach(c => {
        const n = t[c.value] || 0;
        wrap.appendChild(el("button.btn.sm" + (mine === c.value ? ".primary" : ".ghost"), {
          type: "button",
          title: "Vote “" + c.label + "”" + (opts.label ? " — " + opts.label : ""),
          html: escapeHtml(String(c.label)) + (n ? " <b>" + n + "</b>" : ""),
          onclick: async () => {
            if (typeof Taiao === "undefined" || !Taiao.logged || !Taiao.logged()) { toast("Sign in to vote.", "warn"); if (typeof App !== "undefined") App.go("#/settings"); return; }
            const r = await Taiao.castVote(opts.kind, opts.folder, opts.field, c.value);
            if (r && r.error) { toast(r.error, "err"); return; }
            toast("Vote recorded.", "ok");
            if (opts.refetch) { try { await opts.refetch(); } catch (_) {} }
            render();
          },
        }));
      });
    }
    render();
    wrap._render = render;
    if (typeof opts.register === "function") opts.register(render);   // re-render after async tally load
    return wrap;
  }

  return { symbol, buttons, close, VOTE_GLYPH };
})();

// ===== Taiao Workshop — the ubiquitous table filter/sort control =====
// One reusable helper that turns any plain <table> into a sortable, filterable
// one. Call TableFilter.enhance(tableEl) after you've built a table and it will,
// per column, decide what kind of data the column holds and wire the right
// control:
//   • string column   → click the header to sort A→Z / Z→A, plus a text box
//                        under it that keeps only rows whose cell contains the
//                        typed substring (case-insensitive).
//   • category column  → (few distinct values) a dropdown that keeps only rows
//                        with the chosen value; header still sorts alphabetically.
//   • number column    → click the header to sort low→high / high→low, plus a
//                        box that keeps only rows matching a numeric query:
//                        "5" (equals), ">3", "<=10", "2-8" (range), or several
//                        comma-separated clauses OR'd together ("1, 5, >20").
//
// It operates purely on the rendered DOM, so it works on every table in the
// studio regardless of which page built it — the catalog tables, the per-shire
// zone tables (whose expandable detail rows stay glued to their parent row when
// sorted), the triggers table, and so on. Enhancing is idempotent: a table that
// already carries a controls row is left alone. Like VoteWidget, never hand-roll
// a sort/filter — route the table through here.
"use strict";

const TableFilter = (function () {
  // Pull the first number out of a cell ("×1.20", "12 tiles", "lvl 7" → 1.2/12/7).
  const NUM_RE = /-?\d[\d,]*\.?\d*/;
  const numOf = txt => {
    const m = NUM_RE.exec(txt || "");
    return m ? parseFloat(m[0].replace(/,/g, "")) : null;
  };
  // A coordinate / zone cell: two integers as "(42, 17)" or a bare "0,0" / "0, 0".
  // Returns [x, y] or null. A bare, space-less pair whose second group is exactly
  // three digits is treated as a thousands-separated number (e.g. "12,345"), NOT
  // a coordinate — so a large-count column doesn't masquerade as coordinates.
  const COORD_PAREN_RE = /^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;
  const COORD_BARE_RE = /^(-?\d+),(\s*)(-?\d+)$/;
  const coordOf = txt => {
    txt = (txt || "").trim();
    let m = COORD_PAREN_RE.exec(txt);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    m = COORD_BARE_RE.exec(txt);
    if (m && !(m[2] === "" && /^\d{3}$/.test(m[3]))) return [parseInt(m[1], 10), parseInt(m[3], 10)];
    return null;
  };
  const textOf = td => (td ? td.textContent : "").replace(/\s+/g, " ").trim();
  const BLANK = new Set(["", "—", "-", "–", "n/a", "none"]);

  // Build a predicate from a numeric filter query. Empty query → null (no filter).
  function numPredicate(q) {
    const clauses = String(q).split(",").map(s => s.trim()).filter(Boolean);
    if (!clauses.length) return null;
    const tests = clauses.map(c => {
      let m;
      if ((m = /^(>=|<=|>|<|=)?\s*(-?\d[\d.]*)$/.exec(c))) {
        const n = parseFloat(m[2]), op = m[1] || "=";
        return v => op === ">" ? v > n : op === "<" ? v < n : op === ">=" ? v >= n
          : op === "<=" ? v <= n : Math.abs(v - n) < 1e-9;
      }
      if ((m = /^(-?\d[\d.]*)\s*(?:-|–|to|\.\.)\s*(-?\d[\d.]*)$/.exec(c))) {
        const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
        return v => v >= Math.min(lo, hi) && v <= Math.max(lo, hi);
      }
      return null;   // unparseable clause → ignored
    }).filter(Boolean);
    if (!tests.length) return null;
    return v => v != null && tests.some(t => t(v));   // clauses are OR'd
  }

  // Group body rows into {primary, details[]} so a row's expandable detail row(s)
  // (fewer cells / a colSpan cell — e.g. the zone tables) travel with it on sort.
  function groupRows(bodyRows, colCount) {
    const groups = [];
    for (const tr of bodyRows) {
      const cells = tr.children.length;
      const isDetail = groups.length && (cells < colCount ||
        [...tr.children].some(c => (c.colSpan || 1) > 1));
      if (isDetail) groups[groups.length - 1].details.push(tr);
      else groups.push({ primary: tr, details: [] });
    }
    return groups;
  }

  function enhance(table, opts) {
    opts = opts || {};
    if (!table || table.__tfDone) return table;

    // 1. locate the header row (last row of <thead>, else the first all-<th> row).
    let headRow = null;
    const thead = table.querySelector("thead");
    if (thead) headRow = [...thead.querySelectorAll("tr")].pop();
    if (!headRow) headRow = [...table.querySelectorAll("tr")]
      .find(tr => tr.children.length && [...tr.children].every(c => c.tagName === "TH"));
    if (!headRow) return table;
    const ths = [...headRow.children];
    const colCount = ths.length;
    if (colCount < 2) return table;   // nothing worth sorting

    // 2. gather body rows (every <tr> that isn't in the head), keep their order.
    const headIds = new Set([headRow, ...(thead ? [...thead.querySelectorAll("tr")] : [])]);
    const bodyRows = [...table.querySelectorAll("tr")].filter(tr => !headIds.has(tr));
    if (!bodyRows.length) return table;
    const rowParent = bodyRows[0].parentNode;
    // only safe to reorder when every body row shares one parent (they do in both
    // the header-first catalog tables and the thead/tbody zone tables).
    const oneParent = bodyRows.every(tr => tr.parentNode === rowParent);
    const groups = groupRows(bodyRows, colCount);
    if (groups.length < (opts.minRows || 4)) return table;   // too few rows to bother
    const original = groups.slice();
    table.__tfDone = true;

    // 3. classify each column from a sample of its primary-row cells.
    const cols = ths.map((th, i) => {
      const skip = th.hasAttribute("data-tf-skip") || !textOf(th);
      // data-tf-nofilter: keep the column sortable but give it no filter input
      const nofilter = th.hasAttribute("data-tf-nofilter");
      // data-tf-text: force a plain text filter (skip number/coord/category autodetection)
      const forceText = th.hasAttribute("data-tf-text");
      const vals = groups.map(g => textOf(g.primary.children[i])).filter(v => !BLANK.has(v.toLowerCase()));
      let kind = "string";
      if (!skip && !forceText && vals.length) {
        const coords = vals.filter(v => coordOf(v));
        const nums = vals.filter(v => numOf(v) != null);
        const distinct = new Set(vals);
        if (coords.length >= vals.length * 0.7) kind = "coord";   // "(x, y)" / zone → X & Y boxes
        else if (nums.length >= vals.length * 0.7) kind = "number";
        else if (distinct.size <= 12 && distinct.size <= vals.length * 0.7)
          kind = "category";   // few, repeating values → dropdown
      }
      return { i, th, kind, skip, nofilter, distinct: [...new Set(vals)].sort((a, b) => a.localeCompare(b)) };
    });

    // shared render state
    let sortCol = -1, sortDir = 0;               // dir: 1 asc, -1 desc
    const filters = cols.map(() => null);        // per-column predicate on cell text

    // paging: only reveal the first `limit` matching rows; a footer button loads
    // the next PAGE. Filtering/sorting apply to the whole set; the cap is on how
    // many of the matching rows are shown at once.
    const PAGE = opts.pageSize || 1000;
    let limit = PAGE;
    const paged = groups.length > PAGE;
    let footerRow = null, moreBtn = null;
    if (paged) {
      moreBtn = el("button.btn.sm.ghost", { type: "button" });
      moreBtn.addEventListener("click", () => { limit += PAGE; apply(); });
      footerRow = el("tr.tf-more", null, [el("td", { colSpan: colCount, style: "padding:.7rem;text-align:center;border-top:1px solid var(--line-2,#3c424f);background:var(--bg-1,#15171d)" }, [moreBtn])]);
      rowParent.appendChild(footerRow);
    }

    // sorted order of ALL groups (used by apply); identity when no sort is active.
    function sortedBase() {
      if (!(oneParent && sortCol >= 0 && sortDir)) return original;
      const c = cols[sortCol], key = g => textOf(g.primary.children[sortCol]);
      return original.slice().sort((a, b) => {
        if (c.kind === "number") {
          const av = numOf(key(a)), bv = numOf(key(b));
          if (av == null && bv == null) return 0;
          if (av == null) return 1;              // blanks always sink
          if (bv == null) return -1;
          return (av - bv) * sortDir;
        }
        if (c.kind === "coord") {                // sort by x, then y
          const av = coordOf(key(a)), bv = coordOf(key(b));
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return ((av[0] - bv[0]) || (av[1] - bv[1])) * sortDir;
        }
        return key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: "base" }) * sortDir;
      });
    }

    function apply() {
      const base = sortedBase();
      // matching rows, in display order; only the first `limit` of them are shown.
      const matched = base.filter(g => filters.every((pred, i) => !pred || pred(textOf(g.primary.children[i]))));
      const visible = new Set(matched.slice(0, limit));
      for (const g of groups) {
        const show = visible.has(g);
        g.primary.style.display = show ? "" : "none";
        if (!show) for (const d of g.details) d.style.display = "none";   // never reveal, only hide
      }
      // reorder groups (details glued behind their primary), footer last.
      if (oneParent) {
        for (const g of base) { rowParent.appendChild(g.primary); for (const d of g.details) rowParent.appendChild(d); }
        if (footerRow) rowParent.appendChild(footerRow);
      }
      if (footerRow) {
        const remaining = matched.length - Math.min(limit, matched.length);
        footerRow.style.display = remaining > 0 ? "" : "none";
        if (remaining > 0) moreBtn.textContent = "Load next " + Math.min(PAGE, remaining) + "  (" + remaining + " more below)";
      }
      updateCarets();
    }
    // a filter change resets to the first page; sorting / load-more keep the page.
    function refilter() { limit = PAGE; apply(); }

    // 4. header click → cycle sort none → asc → desc → none.
    const carets = [];
    cols.forEach(c => {
      const caret = el("span", { style: "margin-left:.35rem;opacity:.5;font-size:.85em" });
      carets.push(caret);
      if (c.skip) return;
      c.th.style.cursor = "pointer";
      c.th.style.userSelect = "none";
      c.th.title = "Click to sort";
      c.th.appendChild(caret);
      c.th.addEventListener("click", () => {
        if (sortCol !== c.i) { sortCol = c.i; sortDir = 1; }
        else if (sortDir === 1) sortDir = -1;
        else { sortDir = 0; sortCol = -1; }
        apply();
      });
    });
    function updateCarets() {
      carets.forEach((el, i) => {
        el.textContent = (sortCol === i && sortDir) ? (sortDir === 1 ? "▲" : "▼") : "↕";
        el.style.opacity = (sortCol === i && sortDir) ? ".95" : ".4";
      });
    }

    // 5. the controls row: one filter widget per column, sitting under the header.
    const ctrlRow = el("tr.tf-controls");
    const cellStyle = "padding:.25rem .45rem .4rem;border-bottom:1px solid var(--line,#2a2f3a);background:var(--bg-1,#15171d)";
    const inputStyle = "width:100%;box-sizing:border-box;font-size:.72rem;padding:.2rem .35rem;background:var(--bg-2,#1c1f27);color:var(--ink,#e9ecf1);border:1px solid var(--line-2,#3c424f);border-radius:5px";
    cols.forEach(c => {
      const cell = el("th", { style: cellStyle });
      if (c.nofilter) { ctrlRow.appendChild(cell); return; }   // sortable, but no filter input
      if (!c.skip && c.kind === "category") {
        const sel = el("select", { style: inputStyle + ";cursor:pointer" });
        sel.appendChild(el("option", { value: "", text: "All" }));
        c.distinct.forEach(v => sel.appendChild(el("option", { value: v, text: v })));
        sel.onchange = () => { filters[c.i] = sel.value ? (t => t === sel.value) : null; refilter(); };
        cell.appendChild(sel);
      } else if (!c.skip && c.kind === "number") {
        const inp = el("input", { style: inputStyle, placeholder: "e.g. >5, 1-9", title: "number: 5, >3, <=10, 2-8, or 1,5,>20" });
        wire(inp, () => {
          const p = numPredicate(inp.value);
          filters[c.i] = p ? (t => { const n = numOf(t); return n != null && p(n); }) : null;
          refilter();
        });
        cell.appendChild(inp);
      } else if (!c.skip && c.kind === "coord") {
        // two numeric boxes — X and Y — each accepting the same syntax as a
        // number column ("5", ">3", "2-8", …). A row passes when both match.
        const half = inputStyle.replace("width:100%", "width:50%");
        const xin = el("input", { style: half, placeholder: "x", title: "x coord: 5, >3, <=10, 2-8" });
        const yin = el("input", { style: half, placeholder: "y", title: "y coord: 5, >3, <=10, 2-8" });
        const update = () => {
          const xp = numPredicate(xin.value), yp = numPredicate(yin.value);
          filters[c.i] = (xp || yp) ? (t => {
            const co = coordOf(t);
            return !!co && (!xp || xp(co[0])) && (!yp || yp(co[1]));
          }) : null;
          refilter();
        };
        wire(xin, update); wire(yin, update);
        cell.appendChild(el("div", { style: "display:flex;gap:.25rem" }, [xin, yin]));
      } else if (!c.skip) {
        const inp = el("input", { style: inputStyle, placeholder: "filter…" });
        wire(inp, () => {
          const q = inp.value.trim().toLowerCase();
          filters[c.i] = q ? (t => t.toLowerCase().includes(q)) : null;
          refilter();
        });
        cell.appendChild(inp);
      }
      ctrlRow.appendChild(cell);
    });
    // place the controls row right after the header, in the header's own parent.
    headRow.parentNode.insertBefore(ctrlRow, headRow.nextSibling);

    updateCarets();
    if (paged) apply();   // enforce the initial 1000-row cap
    return table;
  }

  // debounce a text input so filtering doesn't thrash on every keystroke.
  function wire(inp, fn) {
    let t = null;
    inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(fn, 130); });
  }

  // Enhance every not-yet-enhanced <table> under a root (convenience for pages
  // that build several tables at once).
  function auto(root) {
    [...(root || document).querySelectorAll("table")].forEach(t => { try { enhance(t); } catch (_) {} });
  }

  return { enhance, auto };
})();

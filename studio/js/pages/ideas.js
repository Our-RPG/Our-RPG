// ===== Our RPG Workshop — Ideas =====
// A pillar for MECHANIC/SYSTEM proposals, distinct from the art/data pipelines
// the rest of the studio serves: a player pitches a rough idea, optionally
// develops it with an AI copilot — their OWN Anthropic API key (js/llm.js),
// used straight from the browser, grounded in the game's real file map
// (studio/js/context-pack.js, built by tools/gen_context.mjs) — and the
// finished design doc lands as a normal "taiao-mechanic/1" workshop proposal
// on the existing "data" lane (auto-open for voting; server/src/workshop.js
// needs no changes). The copilot is entirely optional: a player can write the
// whole spec by hand and skip it.
"use strict";

const IDEAS_SYSTEM_PROMPT =
  "You are a game-design collaborator for Our RPG (formerly Taiao), an open-source cozy multiplayer browser " +
  "RPG. A player will pitch a rough mechanic idea. First reply with at most 3 short " +
  "clarifying questions. After they answer, produce a design doc in EXACTLY this markdown " +
  "skeleton: # <mechanic name> / ## Summary / ## Player experience / ## Systems touched " +
  "(name the real files and systems from the codebase map) / ## Data & content changes / " +
  "## UI changes / ## Risks & open questions / ## Implementation sketch (numbered steps). " +
  "Stay grounded in what the codebase map shows actually exists; where it is silent, say " +
  "'needs verification' instead of inventing. Favour data-driven designs (items, recipes, " +
  "quests, skills) over engine rewrites. Be concrete and concise.";

function pageIdeas(root) {
  clear(root);
  const page = el("div.page");
  const composerHost = el("div");
  const boardHost = el("div");

  let composerOpen = false;
  const closeComposer = () => { composerOpen = false; clear(composerHost); refreshBoard(); };
  page.appendChild(ideasHeroCard(() => {
    composerOpen = !composerOpen;
    clear(composerHost);
    if (composerOpen) composerHost.appendChild(ideasComposerCard(closeComposer));
  }));
  page.appendChild(composerHost);
  page.appendChild(boardHost);
  root.appendChild(page);

  function refreshBoard() { renderIdeaBoard(boardHost); }
  refreshBoard();
}

function ideasHeroCard(onNewIdea) {
  const c = el("div.card");
  c.appendChild(el("h2", { text: "Ideas" }));
  c.appendChild(el("p.tagline", { text:
    "Propose new mechanics and systems for Our RPG. Sketch the itch, develop it into a real design doc — with an AI " +
    "copilot grounded in the game's actual codebase if you link a key in Settings — and put it to the community. " +
    "Adopted ideas become the roadmap." }));
  c.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [
    el("button.btn.primary", { text: "💡 New idea", onclick: onNewIdea }),
  ]));
  return c;
}

// ---------------- composer: pitch → (optional AI copilot) → spec → submit ----------------

function ideasComposerCard(onDone) {
  const c = el("div.card");
  c.appendChild(el("h3", { text: "New idea" }));

  const titleIn = el("input", { placeholder: "Idea title, e.g. Seasonal bird migration routes" });
  const problemIn = el("textarea", { placeholder: "What's missing or unfun today?" });
  const sketchIn = el("textarea", { placeholder: "Your rough idea — as rough as you like." });
  c.appendChild(el("label.field", null, [el("span", { text: "Title" }), titleIn]));
  c.appendChild(el("label.field", null, [el("span", { text: "The itch — what's missing or unfun today?" }), problemIn]));
  c.appendChild(el("label.field", null, [el("span", { text: "Rough idea" }), sketchIn]));

  const specIn = el("textarea", { placeholder: "The design doc — write it by hand, or develop it with the AI copilot below.", style: "min-height:10rem" });
  let usedModel = null;   // the Anthropic model actually used, if the copilot ran

  // ---- AI copilot ----
  const aiCard = el("div", { style: "margin-top:.8rem;padding-top:.8rem;border-top:1px solid var(--line-2)" });
  c.appendChild(aiCard);
  renderCopilot(aiCard);
  function renderCopilot(host) {
    clear(host);
    host.appendChild(el("h3", { style: "font-size:.9rem", text: "AI copilot" }));
    if (!LLM.hasKey()) {
      host.appendChild(el("div.banner.info", null, [
        "Link an Anthropic API key in ",
        el("a", { text: "Settings", href: "#/settings" }),
        " and the copilot will develop this into a grounded design doc using the game's real code map.",
      ]));
      return;
    }
    const messages = [];   // {role, content} — the running conversation sent to LLM.chat every turn
    const usage = { input: 0, output: 0 };

    const startBtn = el("button.btn.primary", { text: "🤝 Develop with AI" });
    host.appendChild(el("div.btn-row", { style: "align-items:center" }, [
      el("span.badge", { text: LLM.getModel() }), startBtn,
    ]));

    const log = el("div", { style: "margin-top:.6rem;display:flex;flex-direction:column;gap:.5rem" });
    const replyRow = el("div.row", { style: "display:none;margin-top:.5rem" });
    const replyIn = el("textarea", { placeholder: "Reply to the copilot…", style: "min-height:3rem" });
    const sendBtn = el("button.btn", { text: "Send" });
    replyRow.appendChild(replyIn); replyRow.appendChild(el("div", { style: "flex:0 0 auto" }, [sendBtn]));
    const useSpecRow = el("div.btn-row", { style: "margin-top:.5rem;display:none" });
    const useSpecBtn = el("button.btn.gold.sm", { text: "📋 Use this spec" });
    useSpecRow.appendChild(useSpecBtn);
    const tokensLine = el("small.tagline", { style: "display:block;margin-top:.4rem" });
    host.appendChild(log); host.appendChild(replyRow); host.appendChild(useSpecRow); host.appendChild(tokensLine);

    // Chat bubbles: escaped text only (textContent via el's `text`), never
    // innerHTML — a proposal/assistant reply is untrusted text either way.
    function addBubble(role, text) {
      log.appendChild(el("div", {
        style: "white-space:pre-wrap;padding:.55rem .7rem;border-radius:8px;font-size:.88rem;" +
          (role === "assistant" ? "background:var(--bg-2)" : ""),
        text,
      }));
    }
    function latestAssistantSummary() {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== "assistant") continue;
        return messages[i].content.indexOf("## Summary") >= 0 ? messages[i].content : null;
      }
      return null;
    }
    function setBusy(b) { startBtn.disabled = b; sendBtn.disabled = b; replyIn.disabled = b; }

    async function send(userText) {
      messages.push({ role: "user", content: userText });
      addBubble("user", userText);
      const thinking = el("div", { style: "opacity:.6;font-style:italic;font-size:.88rem", text: "Thinking…" });
      log.appendChild(thinking);
      setBusy(true);
      const system = IDEAS_SYSTEM_PROMPT + (typeof CODEBASE_CONTEXT !== "undefined" ? "\n\n" + CODEBASE_CONTEXT : "");
      try {
        const r = await LLM.chat(messages, system);
        thinking.remove();
        messages.push({ role: "assistant", content: r.text });
        addBubble("assistant", r.text);
        usedModel = r.model || LLM.getModel();
        if (r.usage) {
          usage.input += r.usage.input_tokens || 0;
          usage.output += r.usage.output_tokens || 0;
          tokensLine.textContent = usage.input + " in / " + usage.output + " out tokens";
        }
        useSpecRow.style.display = latestAssistantSummary() ? "flex" : "none";
        replyRow.style.display = "flex";
      } catch (e) {
        thinking.remove();
        toast(e.message, "err", 6000);
      } finally {
        setBusy(false);
      }
    }

    startBtn.addEventListener("click", () => {
      const title = titleIn.value.trim(), problem = problemIn.value.trim(), sketch = sketchIn.value.trim();
      if (!title && !problem && !sketch) { toast("Describe your idea first.", "warn"); return; }
      startBtn.style.display = "none";
      send("Title: " + title + "\nThe itch: " + problem + "\nRough idea: " + sketch);
    });
    sendBtn.addEventListener("click", () => {
      const v = replyIn.value.trim(); if (!v) return;
      replyIn.value = "";
      send(v);
    });
    useSpecBtn.addEventListener("click", () => {
      const summary = latestAssistantSummary();
      if (!summary) return;
      specIn.value = summary;
      toast("Copied into the Design spec below — edit as you like.", "ok");
    });
  }

  c.appendChild(el("label.field", { style: "margin-top:.7rem" }, [el("span", { text: "Design spec" }), specIn]));

  const status = el("div.tagline", { style: "min-height:1.2em" });
  const submitBtn = el("button.btn.primary", { text: "💡 Share with the community", onclick: async () => {
    if (typeof Taiao === "undefined" || !Taiao.logged()) { toast("Sign in to share to the community.", "warn"); App.go("#/settings"); return; }
    const title = titleIn.value.trim();
    if (!title) { toast("Give your idea a title.", "warn"); return; }
    const mechanic = {
      title, problem: problemIn.value.trim(), sketch: sketchIn.value.trim(),
      spec: specIn.value.trim(), model: usedModel,
    };
    submitBtn.disabled = true; status.textContent = "Submitting…";
    try {
      const r = await Taiao.submitProposal("mechanic", slug(title), title, { schema: "taiao-mechanic/1", mechanic }, "data");
      if (r && r.error) { status.textContent = ""; toast(r.error, "err"); submitBtn.disabled = false; return; }
      status.textContent = "";
      toast(r.status === "pending" ? "Submitted — awaiting review." : "💡 In the ring — the community can now vote on it.", "ok", 5000);
      onDone && onDone();
    } catch (e) {
      status.textContent = "";
      toast((e && e.message) || "Submit failed.", "err", 6000);
      submitBtn.disabled = false;
    }
  } });
  c.appendChild(status);
  c.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [submitBtn]));
  return c;
}

// ---------------- the idea board ----------------

const IDEA_STATUS_LABEL = { open: "🗳 open", accepted: "✓ adopted" };

async function renderIdeaBoard(host) {
  clear(host);
  const card = el("div.card");
  card.appendChild(el("h3", { text: "Idea board" }));
  const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
  card.appendChild(body);
  host.appendChild(card);

  const [openR, acceptedR] = await Promise.all([Taiao.listProposalsRaw(), Taiao.listProposalsRaw("accepted")]);
  clear(body);
  const bad = r => !r || r.error || !Array.isArray(r.proposals);
  if (bad(openR) || bad(acceptedR)) {
    body.appendChild(el("div.banner.warn", { text: "Couldn't reach the server — the idea board will be back." }));
    return;
  }
  const mechanics = openR.proposals.filter(p => p._subj.kind === "mechanic")
    .concat(acceptedR.proposals.filter(p => p._subj.kind === "mechanic"));
  if (!mechanics.length) { body.appendChild(el("p.tagline", { text: "No ideas yet — bring the first one." })); return; }

  const table = el("table.tf", null, [el("thead", null, [el("tr", null, [
    el("th", { text: "Idea" }), el("th", { text: "Proposed by" }), el("th", { text: "Votes" }), el("th", { text: "Status" }),
  ])])]);
  const tb = el("tbody");
  mechanics.forEach(p => {
    tb.appendChild(el("tr", { style: "cursor:pointer", onclick: () => openIdeaDetail(p, () => renderIdeaBoard(host)) }, [
      el("td", { text: p.title || "(untitled)" }),
      el("td", null, [el("span.tagline", { text: "@" + (p.username || "someone") })]),
      el("td", { text: String(p.endorsements || 0) }),
      el("td", { text: IDEA_STATUS_LABEL[p.status] || p.status }),
    ]));
  });
  table.appendChild(tb);
  body.appendChild(table);
}

// ---------------- idea detail modal (modelled on detail.js's openCostume) ----------------

async function openIdeaDetail(row, refresh) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal");
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: row.title || "(untitled)" }));
  m.appendChild(el("p.credit", null, [
    "Proposed by ", el("span.u", { text: "@" + (row.username || "someone") }),
    " · ", el("span.badge", { text: IDEA_STATUS_LABEL[row.status] || row.status }),
    row.licence ? " · " + row.licence : "",
  ]));
  const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
  m.appendChild(body);
  const endorse = el("button.btn.gold", { text: "▲ Endorse", onclick: async () => {
    if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); return; }
    const r = await Taiao.endorseCostume(row.id);
    if (r.ok) { toast("Vote counted!", "ok"); bg.remove(); refresh(); } else toast(r.error || "Couldn't vote.", "err");
  } });
  const flag = el("button.btn.ghost.sm", { text: "⚑ Flag", onclick: async () => {
    if (!Taiao.logged()) { toast("Sign in to flag.", "warn"); return; }
    const r = await Taiao.flagCostume(row.id);
    toast(r.ok ? "Flagged for review." : (r.error || "Couldn't flag."), r.ok ? "ok" : "err");
  } });
  const close = el("button.btn.ghost", { text: "Close", onclick: () => bg.remove() });
  m.appendChild(el("div.btn-row", { style: "margin-top:.8rem" }, [endorse, flag, close]));
  bg.appendChild(m); document.body.appendChild(bg);

  const full = await Taiao.getCostume(row.id);
  const mech = (full && full.payload && full.payload.mechanic) || {};
  clear(body);

  // Every field below is untrusted player text: rendered ONLY via el()'s
  // `text` (textContent) inside a pre-wrap block — never innerHTML/{html:}.
  const section = (label, text) => {
    if (!text) return;
    body.appendChild(el("h3", { style: "font-size:.85rem;margin:.7rem 0 .2rem", text: label }));
    body.appendChild(el("pre", { style: "white-space:pre-wrap;font-family:inherit;font-size:.86rem;background:var(--bg-2);padding:.6rem .7rem;border-radius:8px;margin:0", text }));
  };
  if (!full) {
    body.appendChild(el("div.banner.warn", { text: "Couldn't load this idea's detail." }));
  } else {
    section("The itch", mech.problem);
    section("Rough idea", mech.sketch);
    section("Design spec", mech.spec);
    if (mech.model) body.appendChild(el("p.tagline", { style: "margin-top:.5rem", text: "Developed with the AI copilot (" + mech.model + ")." }));
  }
}

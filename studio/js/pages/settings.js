// ===== Our RPG Workshop — Settings page =====
// Three keys/accounts meet here and never mix: the PixelLab API key (local-
// only, for generating art), the Anthropic API key (local-only, for the Ideas
// tab's design copilot), and the game account (for community voting). Plus
// the server origin and an optional Turnstile sitekey for self-hosters.
"use strict";

function pageSettings(root) {
  clear(root);
  const page = el("div.page");

  // ---- PixelLab key ----
  const keyCard = el("div.card");
  keyCard.appendChild(el("h3", null, ["PixelLab API key ", el("span.hint", { text: "generates the art" })]));
  keyCard.appendChild(el("p.tagline", { html:
    'Get a key at <a href="https://pixellab.ai/account" target="_blank" rel="noopener">pixellab.ai/account</a>. ' +
    'It is stored <b>only in this browser</b> and sent <b>only to api.pixellab.ai</b> — never to the game server. ' +
    'On a shared computer, clear it when you\'re done.' }));

  const status = el("div.banner");
  const refreshStatus = () => {
    status.className = "banner " + (PixelLab.hasKey() ? "info" : "warn");
    status.textContent = PixelLab.hasKey() ? "Key saved (" + PixelLab.maskedKey() + "). Ready to generate." : "No key yet — add one to start generating sprites.";
  };
  refreshStatus();
  keyCard.appendChild(status);

  const keyInput = el("input", { type: "password", placeholder: "pk_… paste your PixelLab key", autocomplete: "off", spellcheck: false });
  const showBtn = el("button.btn.sm.ghost", { text: "Show", onclick: () => { keyInput.type = keyInput.type === "password" ? "text" : "password"; showBtn.textContent = keyInput.type === "password" ? "Show" : "Hide"; } });
  keyCard.appendChild(el("div.row", null, [keyInput, el("div", { style: "flex:0 0 auto" }, [showBtn])]));

  const saveKey = el("button.btn.primary", { text: "Save key", onclick: async () => {
    const v = keyInput.value.trim();
    if (!v) { toast("Paste a key first.", "warn"); return; }
    PixelLab.setKey(v); keyInput.value = ""; refreshStatus();
    toast("Checking key with PixelLab…");
    try { const b = await PixelLab.balance(); toast("Key works. " + describeBalance(b), "ok", 5000); }
    catch (e) { toast(e.message, "err", 5000); }
    App.refreshChips();
  } });
  const testKey = el("button.btn", { text: "Test / balance", onclick: async () => {
    if (!PixelLab.hasKey()) { toast("Add a key first.", "warn"); return; }
    try { const b = await PixelLab.balance(); toast(describeBalance(b), "ok", 5000); } catch (e) { toast(e.message, "err", 5000); }
  } });
  const clearKey = el("button.btn.danger", { text: "Forget key", onclick: () => { PixelLab.setKey(""); refreshStatus(); App.refreshChips(); toast("Key removed from this browser.", "ok"); } });
  keyCard.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [saveKey, testKey, clearKey]));

  // ---- AI copilot key (Anthropic, BYO) ----
  const llmCard = el("div.card");
  llmCard.appendChild(el("h3", null, ["AI copilot key ", el("span.hint", { text: "develops Ideas into design docs" })]));
  llmCard.appendChild(el("p.tagline", { text:
    "Powers the Ideas tab's design copilot. Your Anthropic API key is stored only in this browser and sent only to " +
    "api.anthropic.com — never to the game server. Get one at console.anthropic.com. Usage is billed to YOUR " +
    "Anthropic account." }));

  const llmStatus = el("div.banner");
  const refreshLlmStatus = () => {
    llmStatus.className = "banner " + (LLM.hasKey() ? "info" : "warn");
    llmStatus.textContent = LLM.hasKey() ? "Key saved (" + LLM.maskedKey() + "). Ready to develop ideas." : "No key yet — link one to unlock the AI copilot.";
  };
  refreshLlmStatus();
  llmCard.appendChild(llmStatus);

  const llmKeyInput = el("input", { type: "password", placeholder: "sk-ant-… paste your Anthropic key", autocomplete: "off", spellcheck: false });
  const llmShowBtn = el("button.btn.sm.ghost", { text: "Show", onclick: () => { llmKeyInput.type = llmKeyInput.type === "password" ? "text" : "password"; llmShowBtn.textContent = llmKeyInput.type === "password" ? "Show" : "Hide"; } });
  llmCard.appendChild(el("div.row", null, [llmKeyInput, el("div", { style: "flex:0 0 auto" }, [llmShowBtn])]));

  const llmModelSel = el("select");
  LLM.MODELS.forEach(([v, label]) => llmModelSel.appendChild(el("option", { value: v, text: label })));
  llmModelSel.value = LLM.getModel();
  llmModelSel.addEventListener("change", () => { LLM.setModel(llmModelSel.value); toast("Copilot model set.", "ok"); });
  llmCard.appendChild(el("label.field", { style: "margin-top:.5rem" }, [el("span", { text: "Copilot model" }), llmModelSel]));

  const saveLlmKey = el("button.btn.primary", { text: "Save key", onclick: () => {
    const v = llmKeyInput.value.trim();
    if (!v) { toast("Paste a key first.", "warn"); return; }
    LLM.setKey(v); llmKeyInput.value = ""; refreshLlmStatus();
    toast("Key saved. Try “Test key” to confirm it works.", "ok");
  } });
  const testLlmKey = el("button.btn", { text: "Test key", onclick: async () => {
    if (!LLM.hasKey()) { toast("Add a key first.", "warn"); return; }
    try {
      const r = await LLM.chat([{ role: "user", content: "Reply with the single word: ok" }], undefined, { maxTokens: 8 });
      toast("Key works (" + r.model + ").", "ok", 5000);
    } catch (e) { toast(e.message, "err", 6000); }
  } });
  const clearLlmKey = el("button.btn.danger", { text: "Forget key", onclick: () => { LLM.setKey(""); refreshLlmStatus(); toast("Key removed from this browser.", "ok"); } });
  llmCard.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [saveLlmKey, testLlmKey, clearLlmKey]));

  // ---- game account ----
  const acctCard = el("div.card");
  acctCard.appendChild(el("h3", null, ["Game account ", el("span.hint", { text: "for community voting & credit" })]));
  const acctBody = el("div");
  acctCard.appendChild(acctBody);
  renderAccount(acctBody);
  Taiao.onAuth(() => renderAccount(acctBody));

  // ---- server / advanced ----
  const advCard = el("div.card");
  advCard.appendChild(el("h3", null, ["Advanced ", el("span.hint", { text: "self-hosting" })]));
  const srv = el("input", { type: "text", value: Taiao.getServerUrl(), placeholder: CFG.TAIAO_SERVER_DEFAULT });
  const site = el("input", { type: "text", value: Taiao.sitekey(), placeholder: "Turnstile sitekey (optional)" });
  advCard.appendChild(el("label.field", null, [el("span", { text: "Game server origin" }), srv]));
  advCard.appendChild(el("label.field", null, [el("span", { text: "Turnstile sitekey — only if your worker enforces it" }), site]));
  advCard.appendChild(el("button.btn", { text: "Save server settings", onclick: () => {
    Taiao.setServerUrl(srv.value.trim() || CFG.TAIAO_SERVER_DEFAULT);
    Taiao.setSitekey(site.value.trim());
    toast("Server settings saved.", "ok"); Taiao.refreshMe();
  } }));
  advCard.appendChild(el("p.tagline", { style: "margin-top:.7rem", html:
    'The server must allow this page\'s origin (its <span class="mono">ALLOWED_ORIGINS</span>). In dev, serve the studio on ' +
    '<span class="mono">http://localhost:8899</span>, which the shipped worker already permits.' }));

  page.appendChild(el("div.split", null, [
    el("div", null, [keyCard, llmCard, advCard]),
    el("div", null, [acctCard, aboutCard()]),
  ]));

  root.appendChild(page);
}

function describeBalance(b) {
  if (!b) return "Balance unavailable.";
  const c = b.credits || {};
  if (c.usd != null) return "Balance: $" + Number(c.usd).toFixed(2) + " in credits.";
  const sub = b.subscription || {};
  if (sub.generations != null) return "Plan: " + (sub.plan || "subscription") + " — " + sub.generations + " generations left.";
  return "Key valid.";
}

function aboutCard() {
  const c = el("div.card");
  c.appendChild(el("h3", { text: "How the studio fits the game" }));
  c.appendChild(el("p.tagline", { html:
    "Generate characters and items with PixelLab, give them names, bios, spawn rules and triggers, and design " +
    "alternative <b>costumes / states</b>. Share a costume to the workshop and the community votes; the winning " +
    "costume is credited to its maker and handed to a curator to bring into the game — the same ballot-box the " +
    "game itself uses (GOVERNANCE.md)." }));
  c.appendChild(el("p.tagline", { html: "Finished art drops into <span class='mono'>" + escapeHtml(GAME_ART_PATH) + "</span>." }));
  return c;
}

// Shared account widget (used on Settings and gated pages).
function renderAccount(host) {
  clear(host);
  if (Taiao.logged()) {
    const u = Taiao.user;
    host.appendChild(el("p", null, ["Signed in as ", el("b.u", { text: u.username, style: "color:var(--gold)" }), "."]));
    if (Taiao.curator()) host.appendChild(el("p", null, [el("span.pill.on", { text: "curator" })]));
    host.appendChild(el("button.btn", { text: "Sign out", onclick: async () => { await Taiao.logout(); toast("Signed out.", "ok"); } }));
    host.appendChild(el("p.tagline", { style: "margin-top:.6rem" }, ["Your proposals, impact and local preview have moved to your ", el("a", { text: "profile →", href: "#/profile" }), "."]));
    return;
  }
  const uName = el("input", { placeholder: "username", autocomplete: "username" });
  const uPass = el("input", { type: "password", placeholder: "password", autocomplete: "current-password" });
  const uEmail = el("input", { placeholder: "email (optional, recovery only)", autocomplete: "email" });
  const tsBox = el("div", { style: "margin:.3rem 0" });
  host.appendChild(el("label.field", null, [el("span", { text: "Username" }), uName]));
  host.appendChild(el("label.field", null, [el("span", { text: "Password" }), uPass]));
  const emailField = el("label.field", { style: "display:none" }, [el("span", { text: "Email" }), uEmail]);
  host.appendChild(emailField);
  host.appendChild(tsBox);
  const doLogin = el("button.btn.primary", { text: "Sign in", onclick: async () => {
    if (!uName.value || !uPass.value) { toast("Enter your username and password.", "warn"); return; }
    doLogin.disabled = true;
    const r = await Taiao.login(uName.value.trim(), uPass.value, tsBox);
    doLogin.disabled = false;
    if (r.ok) toast("Kia ora, " + Taiao.username() + "!", "ok"); else toast(r.error || "Sign-in failed.", "err", 5000);
  } });
  const doReg = el("button.btn.ghost", { text: "Create account", onclick: async () => {
    if (emailField.style.display === "none") { emailField.style.display = "block"; toast("Pick a username & password, then Create account again.", ""); return; }
    if (!uName.value || !uPass.value) { toast("Enter a username and password.", "warn"); return; }
    doReg.disabled = true;
    const r = await Taiao.register(uName.value.trim(), uPass.value, uEmail.value.trim(), tsBox);
    doReg.disabled = false;
    if (r.ok) toast("Account created — welcome, " + Taiao.username() + "!", "ok"); else toast(r.error || "Couldn't create account.", "err", 5000);
  } });
  const doPasskey = el("button.btn.ghost", { text: "🔑 Passkey", onclick: async () => {
    doPasskey.disabled = true;
    const r = await Taiao.passkeyLogin(uName.value.trim() || undefined);
    doPasskey.disabled = false;
    // On success Taiao fires onAuth, which re-renders this card signed-in —
    // nothing else to do here. A failure just needs the toast.
    if (!r.ok) toast(r.error || "Passkey sign-in failed.", "err", 5000);
  } });
  host.appendChild(el("div.btn-row", null, [doLogin, doReg, doPasskey]));
  host.appendChild(el("p.tagline", { style: "margin-top:.5rem", html: "It's the same account as the game — sign in with what you already use, or make one here." }));

  // Itch runs the game on a different origin, so this browser can't see a
  // session started there — a one-time code (minted in-game, Account →
  // Workshop code) bridges the two. See server/src/link.js.
  const codeInput = el("input", { placeholder: "code from the game (Account → Workshop code)", autocomplete: "off" });
  const doRedeem = el("button.btn", { text: "Sign in with code", onclick: async () => {
    const code = codeInput.value.trim();
    if (!code) { toast("Paste the code from the game's Account panel first.", "warn"); return; }
    doRedeem.disabled = true;
    const r = await Taiao.redeemLinkCode(code);
    doRedeem.disabled = false;
    if (r.ok) toast("Linked — welcome, @" + Taiao.username() + "!", "ok");
    else toast(r.error || "Couldn't redeem that code.", "err", 5000);
  } });
  host.appendChild(el("label.field", { style: "margin-top:.6rem" }, [el("span", { text: "Or sign in with a game code" }), codeInput]));
  host.appendChild(el("div.btn-row", null, [doRedeem]));
  host.appendChild(el("p.tagline", { html: "Playing on itch? Generate a code in the game's Account panel — no password needed here." }));
}

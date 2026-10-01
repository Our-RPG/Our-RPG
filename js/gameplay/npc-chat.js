// ===== Taiao — NPC dialogue (AI brain + ML retrieval, both parked; canned bank live) =====
// Two richer dialogue modes live in this file behind feature flags (AI_NPC_ENABLED,
// NPC_RETRIEVAL_ENABLED, both false below) — when either is on, NPCs answer a typed
// chat bar in their own voice via an ephemeral LLM instance or semantic-search bank.
// With both parked, NPCs speak entirely from the hand-authored canned bank in
// npc-starter-roles.js via talkTo() (ui.js) — click an NPC, get a real line.
"use strict";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  AI NPC DIALOGUE — PARKED (2026-09-07, on user request)                  ║
// ║  Flip AI_NPC_ENABLED to true AND start the brain to re-enable:           ║
// ║      python3 tools/npc_brain/npc_brain.py                                ║
// ║  Everything else (models, per-NPC memories, KV snapshots) is intact in   ║
// ║  tools/npc_brain/. Full context: tools/NPC_AI_README.md and the          ║
// ║  "ai-npc-dialogue" auto-memory. While false, NPCs use their canned       ║
// ║  npc.line via talkTo() — the original programmed conversation.           ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const AI_NPC_ENABLED = false;

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ML RETRIEVAL DIALOGUE — PARKED (2026-09-23, on user request)            ║
// ║  Flip NPC_RETRIEVAL_ENABLED back to true to re-enable it. The MiniLM     ║
// ║  bank/runtime (js/gameplay/npc-retrieval.js, assets/npc_dialogue/,       ║
// ║  libs/npcml/) is untouched and still gitignored — see the                ║
// ║  "npc-retrieval-dialogue" auto-memory. While false, NPCs speak entirely  ║
// ║  from the hand-authored canned bank: NPC_STARTER_ROLES (general flavor,  ║
// ║  15 lines/role) + NPC_ROLE_TOPICS (trade/gossip/lore/complaint/advice/   ║
// ║  smalltalk/seasonal, 8 lines/role/topic) in npc-starter-roles.js, for    ║
// ║  all 40 dialogue roles. talkTo() (ui.js) draws from this bank via        ║
// ║  npcStarterReply() whenever an NPC has no explicit .line of its own.     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const NPC_RETRIEVAL_ENABLED = false;

const NPC_CHAT = {
  url: "http://127.0.0.1:8788",
  earshot: 6,          // Chebyshev tiles
  scanMs: 650,         // how often to re-scan who's in earshot
  online: true,        // flipped off (briefly) when the bridge can't be reached
  offlineUntil: 0,
  _lastScan: 0,
  active: new Map(),   // cid -> npc   (currently in earshot)
  greetedAt: new Map(),// cid -> ts    (debounce re-greeting on brief exits)
  pending: new Set(),  // cids with an in-flight request (avoid overlap per NPC)
};

// A stable conversation id for an NPC: name + spawn/home tile (survives wander).
function npcCid(npc) {
  if (npc._cid) return npc._cid;
  const hx = npc._home ? npc._home[0] : npc.x, hy = npc._home ? npc._home[1] : npc.y;
  return (npc._cid = `${npc.name}@${Math.round(hx)},${Math.round(hy)}`);
}

// ── STATE-conditioned persona (matches the fine-tune dataset schema) ──────────
// tools/npc_training/emberfall_npc_dialogue_3000.jsonl trains the model on prompts
// of the exact shape "You are X, a Taiao <role>. Voice=…; traits=…. … STATE:
// location=…; time=…; weather=…; mood=…; relationship=…; quest=…; player_skill=…;
// shop_open=…; stock=…; known_fact=…." — so we build the same prompt from live game
// state. (Bigger untrained models read it fine too.)
// role -> [skill, location, voice, traits, stock]
const NPC_ROLE_INFO = {
  fisher:     ["Fishing", "harbour", "weathered", "patient, plain-spoken", "hooks, line, bait, smoked eel"],
  farmer:     ["Farming", "lower fields", "rough", "hardy, blunt", "seed, onions, beans, oats"],
  miller:     ["Milling", "mill", "steady", "precise, tired", "wheat flour, barley meal, oat flour, bran"],
  baker:      ["Baking", "bakehouse", "warm", "cheerful, floury", "bread, oatcakes, meat pies, berry tarts"],
  cook:       ["Cooking", "inn kitchen", "boisterous", "busy, generous", "stew, roast meat, fish pie, whitebait fritters"],
  brewer:     ["Brewing", "brew shed", "mellow", "easygoing, proud", "small ale, cider, malt, yeast"],
  beekeeper:  ["Beekeeping", "orchard hives", "soft", "calm, careful", "honey, beeswax, candles, propolis"],
  herbalist:  ["Foraging", "herb garden", "quiet", "knowing, wry", "dried herbs, roots, flowers, salves"],
  apothecary: ["Potionmaking", "apothecary", "precise", "clinical, dry", "empty vials, tonics, salves, dried ingredients"],
  woodcutter: ["Woodcutting", "forest edge", "gruff", "strong, direct", "logs, kindling, handles, split timber"],
  carpenter:  ["Carpentry", "work yard", "craftsmanlike", "measured, exact", "planks, pegs, tool handles, simple furniture"],
  fletcher:   ["Fletching", "fletcher's bench", "focused", "steady, terse", "arrows, shafts, bowstrings, feathers"],
  miner:      ["Ore-mining", "mine mouth", "rough", "tough, grim", "iron ore, copper, coal, a lump of tin"],
  blacksmith: ["Weaponsmithing", "the forge", "gruff", "solid, proud", "nails, hinges, axe heads, blades"],
  armourer:   ["Armoursmithing", "armoury", "stern", "exacting, blunt", "helms, mail rings, buckles, plate"],
  mason:      ["Stone-mining", "stoneyard", "solid", "slow, deliberate", "cut stone, slate, lime, gravel"],
  potter:     ["Pottery", "kiln", "calm", "patient, tidy", "pots, jugs, bowls, crocks"],
  tanner:     ["Tanning", "tanning racks", "salt-dry", "blunt, brisk", "leather, hide, straps, pouches"],
  weaver:     ["Weaving", "loom-house", "rhythmic", "focused, wry", "wool, cloth, thread, a warm cloak"],
  dyer:       ["Dyeing", "dye yard", "colourful", "lively, stained", "dyed wool, woad, madder, fixed cloth"],
  tailor:     ["Tailoring", "tailor's shop", "refined", "neat, particular", "tunics, cloaks, caps, mended garments"],
  jeweller:   ["Jewelry", "jeweller's bench", "elegant", "delicate, sharp-eyed", "rings, amulets, cut gems, gold wire"],
  hunter:     ["Hunting", "the lodge", "low", "watchful, spare", "furs, venison, snares, a bundle of arrows"],
  forager:    ["Foraging", "forest edge", "wandering", "curious, gentle", "berries, mushrooms, nuts, wild herbs"],
  sailor:     ["Sailing", "the docks", "salt-dry", "hearty, rough", "rope, salt, canvas, a sea-charm"],
  ferryman:   ["Sailing", "the ferry landing", "slow", "laconic, dry", "a crossing, a pole, a bailing pail"],
  merchant:   ["Trading", "the market stall", "smooth", "shrewd, chatty", "tools, cloth, spices, trinkets"],
  innkeeper:  ["Cooking", "the tavern", "welcoming", "jovial, quick", "a mug of ale, a hot meal, a bed for the night"],
  guard:      ["Melee", "the gate", "strict", "watchful, curt", "none listed"],
  healer:     ["Potionmaking", "the sickhouse", "gentle", "kind, tired", "bandages, tonics, poultices, clean water"],
  dockworker: ["Sailing", "the docks", "rough-friendly", "burly, blunt", "crates, rope, a hand with your load"],
  stablehand: ["Husbandry", "the stables", "soft-spoken", "quiet, steady", "feed, tack, a stall for the night"],
  shepherd:   ["Husbandry", "the pasture", "mellow", "calm, weather-worn", "wool, mutton, cheese, a fleece"],
  orchardist: ["Farming", "the orchard", "warm", "patient, sunny", "apples, pears, cider, dried fruit"],
  boatbuilder:["Shipwrighting", "the boatyard", "craftsmanlike", "careful, proud", "planks, pitch, oars, a small skiff"],
  cartwright: ["Carpentry", "the cart shed", "mechanical", "practical, terse", "wheels, axles, cart parts, grease"],
  scribe:     ["Bookbinding", "the scriptorium", "academic", "precise, formal", "ink, parchment, quills, a copied page"],
  storyteller:["Storytelling", "the tavern", "lyrical", "colourful, warm", "a tale, a song, a rumour or two"],
  elder:      ["Lore", "the meeting hall", "reflective", "dignified, slow", "none listed"],
  mapmaker:   ["Cartography", "the map room", "measured", "meticulous, calm", "maps, charts, a compass, ink"],
};
const NPC_ROLE_KEYS = Object.keys(NPC_ROLE_INFO);
// keyword (in the NPC's title / shopType) -> dataset role
const NPC_ROLE_MATCH = [
  [/fish/, "fisher"], [/farm|plough|field/, "farmer"], [/mill/, "miller"], [/bak|bread/, "baker"],
  [/cook|kitchen/, "cook"], [/brew|ale/, "brewer"], [/bee|honey|apiar/, "beekeeper"],
  [/herb|botan/, "herbalist"], [/apothec|potion|alchem/, "apothecary"], [/wood.?cut|lumber/, "woodcutter"],
  [/carpent|joiner/, "carpenter"], [/fletch|bow|arrow/, "fletcher"], [/\bminer?\b|\bore\b|mining/, "miner"],
  [/smith|forge|black/, "blacksmith"], [/armou?r/, "armourer"], [/mason|stone/, "mason"],
  [/pot(ter|tery)|kiln/, "potter"], [/tan(ner)?|hide|leather/, "tanner"], [/weav|loom/, "weaver"],
  [/dye/, "dyer"], [/tailor|garment|cloth/, "tailor"], [/jewel|goldsmith|gem/, "jeweller"],
  [/hunt/, "hunter"], [/forag|gather/, "forager"], [/sailor|mariner|seaman/, "sailor"],
  [/ferry/, "ferryman"], [/merch|trad|shop|store|stall|general/, "merchant"], [/inn|tavern|host/, "innkeeper"],
  [/guard|watch|soldier|sentr/, "guard"], [/heal|nurse|medic/, "healer"], [/dock|stevedore|porter/, "dockworker"],
  [/stable|groom|ostler/, "stablehand"], [/shep|flock/, "shepherd"], [/orchard/, "orchardist"],
  [/boat.?build|shipwright/, "boatbuilder"], [/cart|wheel/, "cartwright"], [/scrib|clerk|copyist/, "scribe"],
  [/story|bard|tale/, "storyteller"], [/elder|chief|headman|mayor/, "elder"], [/map|cartograph|survey/, "mapmaker"],
];
const NPC_MOODS = ["busy", "calm", "tired", "curious", "concerned", "pleased", "cheerful", "irritated"];
const NPC_WEATHERS = ["clear", "windy", "cold", "warm", "misty", "light rain", "steady rain", "storm threatening"];

// ── per-NPC unique personality (hash-picked, stable for that NPC forever) ────
const NPC_TEMPERAMENTS = ["sunny and talkative", "dour and blunt", "sly and teasing", "anxious and fussy",
  "boisterous and loud", "gentle and patient", "prickly but fair", "dreamy and distracted",
  "stubborn and proud", "warm and motherly", "dry and sarcastic", "shy and soft-spoken"];
const NPC_ATTITUDES = ["you like adventurers and their stories", "you distrust strangers until they prove themselves",
  "you envy those who get to travel", "you pity anyone fool enough to take to the roads",
  "you size everyone up for coin", "you fuss over every traveller who passes",
  "you find outsiders quietly amusing", "you couldn't care less who comes or goes"];
const NPC_QUIRKS = ["you often mention the weather before anything else", "you end many sentences with 'so it goes'",
  "you speak of your work as if it were a living thing", "you are superstitious about crows and omens",
  "you haggle out of habit, even when nothing is for sale", "you pepper your talk with sea-sayings",
  "you compare most things to food", "you call everyone 'cousin'", "you speak in short, clipped sentences",
  "you love gossip and lower your voice to share it", "you grumble fondly about your aching back",
  "you quote your old master's sayings", "you hum or whistle between thoughts",
  "you brag a little more than you should", "you give unasked-for advice", "you count things aloud without noticing"];
const NPC_HOOKS = ["You dream of one day seeing the far side of the isle.",
  "You are saving coin for a better roof before winter.", "You still grieve a brother lost to the sea.",
  "You are quietly proud of a child learning your trade.", "You keep a lucky charm from your grandmother.",
  "You nurse an old rivalry with a neighbour.", "You secretly dislike the taste of fish.",
  "You once saw strange lights over the ridge and never forgot it.", "Your knees ache before every storm.",
  "You mean to enter the village fair this year.", "You owe the innkeeper a favour you'd rather forget.",
  "You believe your own cooking beats the tavern's."];

// ── starter dialogue bank (tracked in git; zero ML/network dependencies) ──
// The full semantic-retrieval bank (tools/npc_dialogue/) is ~70MB of
// Llama-distilled lines, and its runtime (the MiniLM model + ONNX/wasm
// engine under assets/models/ and libs/npcml/, ~83MB) is ALSO gitignored —
// see .gitignore. A fresh `git clone` therefore boots with NPCR.state stuck
// at "failed" forever. Before this bank existed, an NPC in that state only
// ever repeated its single fixed npc.line, and Tutorial.onChatReply() only
// fired from a genuine retrieval reply — so Ravenna's "say something & hear
// her answer" goal could never complete and the Sky Knoll gate (pod 11)
// softlocked every clone. These lines are original, hand-written (not
// distilled from any teacher model — CC BY-SA like the rest of the repo's
// authored text) and stand in whenever the big bank isn't ready; npcBroadcast
// now counts ANY line actually said as "heard", so chat always progresses.
const NPC_STARTER_BUCKETS = [
  { re: /\b(who|what)('?s| is| are).{0,15}\byou\b|your name|about yourself/i, lines: [
    "Kia ora — just a local, minding my own patch of this isle.",
    "Ah, you want my life story? Not much to tell: work, weather, and a warm fire at night.",
    "Me? Same as everyone here — getting by, one day at a time.",
  ] },
  { re: /\bweather|rain|storm|wind|cold|warm|sun(ny)?\b/i, lines: [
    "Fine day for it, wouldn't you say — can't complain about the sky today.",
    "There's weather coming, I can feel it in my knees before I see a cloud.",
    "Some days the wind off the water cuts right through you. Not today, though.",
  ] },
  { re: /\bquest|help|lost|where|direction|advice|way to\b/i, lines: [
    "Follow the path and keep your eyes open — most of this isle explains itself.",
    "Can't say I know everything, but ask around and someone will point you right.",
    "Best advice I can give: talk to folk, try things, and don't be afraid to get it wrong.",
  ] },
  { re: /\bthank/i, lines: [
    "No trouble at all — glad to help where I can.",
    "Ah, think nothing of it, e hoa.",
  ] },
  { re: /\bbye|farewell|see you|later|going now\b/i, lines: [
    "Safe travels, then — mind the path.",
    "Off you go — come by again sometime.",
  ] },
];
const NPC_STARTER_GENERIC = [
  "Kia ora! Good to see a friendly face about.",
  "Busy day, busy day — but there's always time for a chat.",
  "You look like you've been getting into all sorts out there.",
  "This isle's full of little surprises, if you know where to look.",
  "Not much news to share today — quiet's a fine thing, now and then.",
  "Mind how you go — the world's bigger and stranger than it looks from here.",
  "Every day's a little different out here, even when it looks the same.",
  "Well now, what brings you round this way?",
];
// role-aware topic buckets: matched AFTER the fixed-intent NPC_STARTER_BUCKETS
// above, against NPC_ROLE_TOPICS[role][key] (js/gameplay/npc-starter-roles.js).
// A role missing a topic (or the table itself being absent) just falls through
// to the general pool below — nothing throws on a bank-less/partial build.
const NPC_TOPIC_BUCKETS = [
  { key: "trade", re: /\b(sell|buy|trade|stock|wares|goods|shop|price|cost|coin)\b/i },
  { key: "gossip", re: /\bgossip|\bnews\b|rumou?r|word around|anything new|heard\b.*\b(about|any)/i },
  { key: "lore", re: /\bhistory|\blegend|\btale\b|old days|founded|how (long|old) (is|has)|origin/i },
  { key: "complaint", re: /\bcomplain|\btrouble\b|problem|annoy|frustrat|hard day|rough day|difficult/i },
  { key: "advice", re: /\badvice|suggest|recommend|should i\b|what would you|\btip\b/i },
  { key: "smalltalk", re: /how are you|how's it going|how goes it|how have you been|how.{0,4}you doing/i },
  { key: "seasonal", re: /\bseason\b|festival|holiday|harvest|celebrat/i },
];

// pick a line from the bucket matching `text` (falling back to the generic
// pool), skipping ones this NPC has already said recently
function npcStarterReply(npc, text) {
  // specific intents (name/weather/thanks/…) win; then role-aware topics
  // (trade/gossip/lore/…); otherwise the NPC's full ROLE pool — flavour lines
  // plus every topic pool merged (npc-starter-roles.js) — speaks ahead of the
  // shared generic lines, so a bank-less build still has a smith who talks
  // like a smith and, over repeated clicks, cycles through a real range of
  // trade/gossip/lore/grumbles/advice instead of 5 lines on a loop.
  const roleKey = npcRoleKey(npc);
  const roleTopics = (typeof NPC_ROLE_TOPICS !== "undefined") ? NPC_ROLE_TOPICS[roleKey] : null;
  let pool = NPC_STARTER_GENERIC;
  if (typeof NPC_STARTER_ROLES !== "undefined") {
    const rl = NPC_STARTER_ROLES[roleKey];
    if (rl && rl.length) {
      pool = rl.slice();
      if (roleTopics) for (const k in roleTopics) pool.push(...roleTopics[k]);
      pool = pool.concat(NPC_STARTER_GENERIC);
    }
  }
  if (text) {
    let matched = null;
    for (const b of NPC_STARTER_BUCKETS) if (b.re.test(text)) { matched = b.lines; break; }
    if (!matched) for (const tb of NPC_TOPIC_BUCKETS) {
      if (tb.re.test(text) && roleTopics && roleTopics[tb.key] && roleTopics[tb.key].length) {
        matched = roleTopics[tb.key]; break;
      }
    }
    if (matched) pool = matched;
  }
  const cid = npcCid(npc);
  if (!NPC_CHAT.starterUsed) NPC_CHAT.starterUsed = new Map();
  let seen = NPC_CHAT.starterUsed.get(cid);
  if (!seen) NPC_CHAT.starterUsed.set(cid, seen = new Set());
  let avail = pool.filter(l => !seen.has(l));
  if (!avail.length) { seen.clear(); avail = pool; }
  const line = avail[(Math.random() * avail.length) | 0];
  seen.add(line);
  return line;
}

function npcFlair(cid) {
  const h = _npcHash(cid);
  return {
    temperament: NPC_TEMPERAMENTS[_npcHash(cid + ":t") % NPC_TEMPERAMENTS.length],
    attitude: NPC_ATTITUDES[_npcHash(cid + ":a") % NPC_ATTITUDES.length],
    quirk: NPC_QUIRKS[_npcHash(cid + ":q") % NPC_QUIRKS.length],
    hook: NPC_HOOKS[h % NPC_HOOKS.length],
  };
}

function _npcHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// building job/station -> dialogue role: an NPC's claimed trade must match the
// stations and decor of the building they actually dwell in.
const BJOB_ROLE = {
  anvil: "blacksmith", furnace: "blacksmith", altar: "elder", alchtable: "apothecary",
  workbench: "carpenter", campfire: "cook", cauldron: "apothecary",
  loom: "weaver", tanrack: "tanner", mill: "miller", fletchers_bench: "fletcher",
  sawmill: "woodcutter", seasoning_yard: "carpenter", malthouse: "brewer", brewery: "brewer",
  cooperage: "carpenter", bakehouse: "baker", spinning_wheel: "weaver", dyeworks: "dyer",
  fulling_mill: "weaver", tailors_bench: "tailor", creamery: "farmer", ropewalk: "sailor",
  sail_loft: "sailor", shipyard: "boatbuilder", charcoal_clamp: "woodcutter",
  lime_kiln: "mason", masons_yard: "mason", pottery_kiln: "potter", glass_furnace: "potter",
  assay_furnace: "jeweller", drawbench: "jeweller", jewelers_bench: "jeweller",
  leather_bench: "tanner", cobblers_bench: "tanner", saddlers_bench: "tanner",
  toolsmith: "blacksmith", locksmith_bench: "blacksmith", paper_mill: "scribe",
  bindery: "scribe", chandlery: "beekeeper", soap_works: "herbalist",
  trader: "merchant", bank: "merchant",
};
// shop type (chunk shopkeepers) -> dialogue role
const SHOPTYPE_ROLE = {
  general: "merchant", woodcutter: "woodcutter", mining: "miner", fishmonger: "fisher",
  armoury: "armourer", weaponsmith: "blacksmith", seedsman: "farmer", herbalist: "herbalist",
  jeweller: "jeweller", clothier: "tailor", provisioner: "merchant", timberwright: "carpenter",
  runeseller: "elder", // keeper of the city's Runestone altar — reuses the existing role bank
};

function npcRoleKey(npc) {
  // 1) the building they dwell in is the truth: its stations ARE their trade
  if (npc._bjob && BJOB_ROLE[npc._bjob]) return BJOB_ROLE[npc._bjob];
  if (npc.shopType && SHOPTYPE_ROLE[npc.shopType]) return SHOPTYPE_ROLE[npc.shopType];
  // 2) title keywords (quest-givers, ambient NPCs with no building)
  const t = ((npc.mixTitle || "") + " " + (npc.shopType || "")).toLowerCase();
  for (const [re, role] of NPC_ROLE_MATCH) if (re.test(t)) return role;
  if (npc.trader) return "merchant";
  return NPC_ROLE_KEYS[_npcHash(npc.name || "x") % NPC_ROLE_KEYS.length]; // stable fallback
}

function npcTimeOfDay() {
  const p = (typeof dayPhase === "function") ? dayPhase() : 0.5; // 0=midnight, .5=noon
  if (p < 0.10) return "evening";
  if (p < 0.27) return "dawn";
  if (p < 0.42) return "morning";
  if (p < 0.58) return "midday";
  if (p < 0.73) return "afternoon";
  if (p < 0.85) return "dusk";
  return "evening";
}

function npcPlayerSkillBand() {
  const lvl = (typeof combatLevel === "function") ? combatLevel() : ((typeof player !== "undefined" && player.level) || 1);
  return lvl < 5 ? "novice" : lvl < 12 ? "beginner" : lvl < 25 ? "competent" : lvl < 45 ? "skilled" : "expert";
}
// ── live player signals NPCs react to (must match the dataset's STATE vocab) ──
function npcPlayerStink() {
  const t = (typeof stinkTotal === "function") ? stinkTotal() : 0;   // thresholds from stink.js
  return t >= 1800 ? "reeking" : t >= 650 ? "rank" : t >= 100 ? "whiffy" : "fresh";
}
function npcPlayerHealth() {
  const hp = (typeof player !== "undefined") ? player.hp : 10;
  const mx = (typeof maxHp === "function") ? maxHp() : 10;
  const r = mx > 0 ? hp / mx : 1;
  return r > 0.85 ? "hale" : r > 0.55 ? "hurt" : r > 0.30 ? "wounded" : r > 0.10 ? "bloodied" : "near death";
}
function npcPlayerCombat() {
  const c = (typeof combatLevel === "function") ? combatLevel() : 3;   // ~2..33
  return c >= 28 ? "legendary" : c >= 21 ? "renowned" : c >= 14 ? "veteran" : c >= 7 ? "seasoned" : "green";
}
function npcPlayerArmed() {
  const eq = (typeof player !== "undefined" && player.equip) || {};
  if (!eq.weapon) return "unarmed";
  let n = 0;                                    // count worn gear (string slots), skip weapon/quiver stacks
  for (const k in eq) { if (k === "weapon") continue; if (typeof eq[k] === "string" && eq[k]) n++; }
  return n >= 3 ? "armed and armoured" : "armed";
}

// Build the v4 persona: personality-first villager, job as background, slim
// SCENE block. MUST stay in sync with tools/npc_training/gen_npc_data_v2.persona
// (the fine-tune is trained on this exact shape). NPCs respond to the player's
// WORDS — no player-state telemetry in the prompt.
function npcPersona(npc) {
  const roleKey = npcRoleKey(npc);
  const [skill, loc, voice, traits, stock] = NPC_ROLE_INFO[roleKey];
  const cid = npcCid(npc);
  const h = _npcHash(cid);
  const time = npcTimeOfDay();
  const dayNo = Math.floor((typeof now !== "undefined" ? now : Date.now()) /
    (typeof DAY_MS !== "undefined" ? DAY_MS : 600000));
  const weather = NPC_WEATHERS[_npcHash(dayNo + ":" + Math.round((npc._home ? npc._home[0] : npc.x) / 40)) % NPC_WEATHERS.length];
  const mood = NPC_MOODS[h % NPC_MOODS.length];
  const rel = NPC_CHAT.greetedAt.has(cid) ? "neutral" : "unfamiliar";
  const stockS = (stock !== "none listed" && time !== "evening") ? stock : "nothing right now";
  const f = npcFlair(cid);
  return `You are ${npc.name}, a villager of Taiao — ${f.temperament}; ${f.attitude}; `
    + `your voice is ${voice}. Quirk: ${f.quirk}. ${f.hook} You earn your keep as a ${roleKey}, but the `
    + `trade is just work — you are a whole person first, and your moods, opinions, memories and gossip `
    + `matter more to you than shop talk. You are flesh and blood and have lived your whole life on `
    + `Taiao; you know nothing of any world, land, device or word beyond it, and strange notions `
    + `simply puzzle you. "Kia ora" is the greeting of Taiao folk — when someone comes near, YOU `
    + `speak first: open with a warm Kia ora and a remark or question of your own, as the one starting `
    + `the conversation, never as if answering a greeting. Speak in-world in 1-3 short sentences like `
    + `natural talk: react to what was `
    + `just said, keep your opinions consistent, and now and then ask a short question back. Stay in `
    + `character always; never speak like an assistant; never invent prices or quests. `
    + `SCENE: location=${loc}; time=${time}; weather=${weather}; your mood=${mood}; `
    + `toward this traveller you feel ${rel}; your stock if asked: ${stockS}.`;
}

// Show text as an overhead bubble above an NPC (reuses the render3d _say system).
function npcSay(npc, text) {
  if (!text) return;
  const ms = Math.min(9000, 2500 + text.length * 45);
  npc._say = { text, until: performance.now() + ms };
  if (typeof log === "function") log(`${npc.name}: "${text}"`, "sys");   // mirror to the chat log
}

function npcChatOffline() {
  return !NPC_CHAT.online && now < NPC_CHAT.offlineUntil;
}
function npcChatGoOffline() {
  NPC_CHAT.online = false;
  NPC_CHAT.offlineUntil = now + 15000; // retry the bridge in 15s
}

async function npcFetch(path, body) {
  if (!AI_NPC_ENABLED) throw new Error("AI NPC dialogue is parked");
  const res = await fetch(NPC_CHAT.url + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("bridge " + res.status);
  NPC_CHAT.online = true;
  return res.json();
}

// Enumerate NPCs in earshot right now (near the player, on loaded chunks).
function npcsInEarshot(radius) {
  const out = [];
  if (typeof world === "undefined" || !world.npcs) return out;
  const R = radius || NPC_CHAT.earshot;
  // a wall blocks voices: you only hear an NPC if you're both outside, or both
  // inside the SAME building (insideBuilding returns that building's record, or
  // null outdoors — so identity-equality captures both cases).
  const pBld = world.insideBuilding ? world.insideBuilding(player.x, player.y) : null;
  for (const npc of world.npcs) {
    if (!npc || !npc.name) continue;
    if (typeof npcAsleep === "function" && npcAsleep(npc)) continue;  // asleep in bed: no greeting/answering
    if (Math.max(Math.abs(npc.x - player.x), Math.abs(npc.y - player.y)) > R) continue;
    const nBld = world.insideBuilding ? world.insideBuilding(npc.x, npc.y) : null;
    if (pBld !== nBld) continue;   // one indoors & one outdoors, or in different buildings
    out.push(npc);
  }
  return out;
}

// Re-check whether the bridge is up (recovers from "offline" without a reload).
function npcHealthProbe() {
  if (!AI_NPC_ENABLED) return;   // parked — no bridge probing
  if (typeof fetch !== "function") return;
  NPC_CHAT._lastProbe = performance.now();
  fetch(NPC_CHAT.url + "/health").then(r => {
    if (r.ok && !NPC_CHAT.online && typeof log === "function")
      log("AI NPC chat connected — townsfolk will talk now.", "sys");
    NPC_CHAT.online = r.ok || NPC_CHAT.online;
  }).catch(() => {});
}

// Per-frame (throttled): track NPCs entering/leaving earshot (chat-bar state,
// talksFirst greetings), reap the instances of those who left.
function npcChatTick() {
  if (!AI_NPC_ENABLED && !NPC_RETRIEVAL_ENABLED && !NPC_ENGINE_ENABLED) return;   // fully canned
  if (performance.now() - NPC_CHAT._lastScan < NPC_CHAT.scanMs) return;
  NPC_CHAT._lastScan = performance.now();

  // while offline, keep checking for the bridge every ~4s so starting it later
  // "just works" without reloading the page
  if (AI_NPC_ENABLED && !NPC_CHAT.online && performance.now() - (NPC_CHAT._lastProbe || 0) > 4000)
    npcHealthProbe();

  const near = npcsInEarshot();
  const nearCids = new Set();
  if (!AI_NPC_ENABLED && near.length) npcRetrievalWarm();   // lazy model/bank load
  if (!NPC_CHAT.enteredAt) NPC_CHAT.enteredAt = new Map();
  for (const npc of near) {
    const cid = npcCid(npc);
    nearCids.add(cid);
    if (!NPC_CHAT.active.has(cid)) {
      NPC_CHAT.active.set(cid, npc);
      NPC_CHAT.enteredAt.set(cid, now);   // start the linger clock — no greeting yet
    } else {
      NPC_CHAT.active.set(cid, npc); // refresh the (wandering) npc reference
      // Unprompted greetings are OPT-IN: NPCs speak only when spoken to
      // (clicked, or addressed via the chat bar) unless explicitly flagged
      // npc.talksFirst — the hook for characters scripted to open the
      // conversation themselves. For those, the old etiquette still applies:
      // only after the player has LINGERED in earshot (~2.5s, passers-by are
      // left in peace), and never while the player is mid-sentence.
      if (npc.talksFirst) {
        const since = NPC_CHAT.enteredAt.get(cid) || now;
        if (now - since >= 2500 && !(typeof playerIsTyping === "function" && playerIsTyping()))
          npcGreet(npc, cid);   // npcGreet self-debounces (90s)
      }
    }
  }
  // approach pre-warming: NPCs just OUTSIDE earshot get their persona+history
  // prefilled on the brain (KV snapshot saved) before the player reaches them,
  // so the greeting and first reply land near-instantly.
  if (AI_NPC_ENABLED && !npcChatOffline()) {
    if (!NPC_CHAT.prewarmedAt) NPC_CHAT.prewarmedAt = new Map();
    for (const npc of npcsInEarshot(NPC_CHAT.earshot + 3)) {
      const cid = npcCid(npc);
      if (NPC_CHAT.active.has(cid)) continue;              // already talking
      const last = NPC_CHAT.prewarmedAt.get(cid) || 0;
      if (now - last < 120000) continue;                    // re-warm at most every 2 min
      NPC_CHAT.prewarmedAt.set(cid, now);
      npcFetch("/npc/prewarm", { id: cid, persona: npcPersona(npc) }).catch(() => {});
    }
  }

  // anyone who walked out of earshot: reap their ephemeral instance
  for (const [cid] of NPC_CHAT.active) {
    if (!nearCids.has(cid)) {
      NPC_CHAT.active.delete(cid);
      NPC_CHAT.enteredAt.delete(cid);   // reset the linger clock
      if (AI_NPC_ENABLED && !npcChatOffline()) npcFetch("/npc/leave", { id: cid }).catch(() => {});
    }
  }
  updateChatBar(near.length);
}

// NPC opens the conversation when you wander up (once per ~90s per NPC).
// Stream a reply into the NPC's speech bubble word-by-word (SSE from the brain).
// Falls back to the plain JSON round-trip if streaming isn't available.
async function npcAskStream(npc, path, payload) {
  const res = await fetch(NPC_CHAT.url + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error("stream unavailable");
  NPC_CHAT.online = true;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", finalReply = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!line.startsWith("data: ")) continue;
      let d; try { d = JSON.parse(line.slice(6)); } catch (e) { continue; }
      if (d.partial != null) {
        // live-growing bubble; keep it alive while tokens arrive
        npc._say = { text: d.partial, until: performance.now() + 6000 };
      } else if (d.done) {
        finalReply = d.reply;
      } else if (d.error) {
        throw new Error(d.error);
      }
    }
  }
  if (finalReply != null) npcSay(npc, finalReply);   // final scrubbed text + proper duration
  return finalReply;
}

function npcGreet(npc, cid) {
  // scripted easter-egg NPCs (the Hermit, Kurt the Gravedigger — see
  // eggs.js npcReply) never touch the retrieval bank; same 90s debounce
  if (npc._egg && typeof Eggs !== "undefined" && Eggs.npcReply) {
    const lastE = NPC_CHAT.greetedAt.get(cid) || 0;
    if (now - lastE < 90000) return;
    NPC_CHAT.greetedAt.set(cid, now);
    npcrSayStreaming(npc, Eggs.npcReply(npc, null));
    return;
  }
  if (!AI_NPC_ENABLED) {
    // retrieval mode: greet from the bank ("Kia ora." opener context)
    const last0 = NPC_CHAT.greetedAt.get(cid) || 0;
    if (now - last0 < 90000) return;
    if (NPC_CHAT.pending.has(cid)) return;
    if (!npcEngineAvailable() && NPCR.state !== "ready") {
      // no engine session and no working local bank (fresh clone, offline,
      // load failed, …) — still greet from the starter pool rather than
      // staying silent forever
      npcRetrievalWarm();
      NPC_CHAT.greetedAt.set(cid, now);
      npcrSayStreaming(npc, npcStarterReply(npc, null));
      return;
    }
    NPC_CHAT.greetedAt.set(cid, now);
    NPC_CHAT.pending.add(cid);
    npcAnyReply(npc, null)
      .then(line => npcrSayStreaming(npc, line || npcStarterReply(npc, null)))
      .catch(() => npcrSayStreaming(npc, npcStarterReply(npc, null)))
      .finally(() => NPC_CHAT.pending.delete(cid));
    return;
  }
  if (npcChatOffline()) return;
  const last = NPC_CHAT.greetedAt.get(cid) || 0;
  if (now - last < 90000) return;
  if (NPC_CHAT.pending.has(cid)) return;
  NPC_CHAT.greetedAt.set(cid, now);
  NPC_CHAT.pending.add(cid);
  npcAskStream(npc, "/npc/hello", { id: cid, persona: npcPersona(npc) })
    .catch(() => npcFetch("/npc/hello", { id: cid, persona: npcPersona(npc) })
      .then(d => { if (d && d.reply) npcSay(npc, d.reply); })
      .catch(() => npcChatGoOffline()))
    .finally(() => NPC_CHAT.pending.delete(cid));
}

// Player speaks: every NPC in earshot answers in their own voice.
function npcBroadcast(text) {
  text = (text || "").trim();
  if (!text) return;
  const near = npcsInEarshot();
  if (!near.length) { log("There's no one nearby to hear you.", "warn"); return; }
  log(`You say: "${text}"`, "sys");
  if (!AI_NPC_ENABLED) {
    // retrieval mode: each NPC answers from the bank in their own voice,
    // staggered a touch so bubbles don't all pop at once.
    for (const npc of near) {
      const cid = npcCid(npc);
      NPC_CHAT.greetedAt.set(cid, now);   // conversing counts as greeted
      // scripted easter-egg NPCs answer from eggs.js in their own fixed voice
      if (npc._egg && typeof Eggs !== "undefined" && Eggs.npcReply) {
        const r = Eggs.npcReply(npc, text);
        if (r) { setTimeout(() => npcrSayStreaming(npc, r), 250 + Math.random() * 500); continue; }
      }
      if (NPC_CHAT.pending.has(cid)) continue;
      NPC_CHAT.pending.add(cid);
      const delay = 250 + Math.random() * 600;
      // Ravenna's stage counts any real heard answer (gameplay/tutorial.js) —
      // NOT just a successful retrieval hit, so a bank-less clone (or one
      // where the bridge/model failed to load) can still clear the Sky Knoll
      // gate via the tracked starter pool below instead of softlocking.
      const say = line => {
        npcrSayStreaming(npc, line);
        if (typeof Tutorial !== "undefined" && Tutorial.onChatReply) Tutorial.onChatReply(npc, line);
      };
      npcAnyReply(npc, text)
        .then(line => new Promise(res => setTimeout(() => res(line), delay)))
        .then(line => say(line || npcStarterReply(npc, text)))
        .catch(() => say(npcStarterReply(npc, text)))
        .finally(() => NPC_CHAT.pending.delete(cid));
    }
    return;
  }
  if (npcChatOffline()) { // graceful fallback: canned lines
    for (const npc of near) npcSay(npc, (npc.line || "...").replace(/^"|"$/g, ""));
    return;
  }
  for (const npc of near) {
    const cid = npcCid(npc);
    NPC_CHAT.greetedAt.set(cid, now);   // conversing counts as greeted — no hello afterwards
    if (NPC_CHAT.pending.has(cid)) continue;
    NPC_CHAT.pending.add(cid);
    npcAskStream(npc, "/npc/say", { id: cid, persona: npcPersona(npc), message: text })
      .catch(() => npcFetch("/npc/say", { id: cid, persona: npcPersona(npc), message: text })
        .then(d => { if (d && d.reply) npcSay(npc, d.reply); })
        .catch(() => { npcChatGoOffline(); npcSay(npc, (npc.line || "...").replace(/^"|"$/g, "")); }))
      .finally(() => NPC_CHAT.pending.delete(cid));
  }
}

// Show text in the bubble above the PLAYER's head (drawn in render3d).
function playerSay(text, ms) {
  if (typeof player === "undefined") return;
  player._say = { text, until: performance.now() + (ms || Math.min(9000, 2500 + text.length * 45)) };
}

function _playerSend() {
  const v = _chatInput.value.trim();
  _chatInput.value = "";
  _chatInput.blur();
  if (!v) { if (player._say) player._say = null; return; }
  playerSay(v);                      // the spoken line lingers over the player
  npcBroadcast(v);
}

// True while the player is mid-sentence in the chat bar.
function playerIsTyping() {
  return _chatInput && document.activeElement === _chatInput && _chatInput.value.trim().length > 0;
}

// Stream the player's words-so-far to the nearest NPCs (prefix prefill on the
// brain). CURRENTLY UNCALLED: the chat bar allows editing now, which breaks
// the always-a-prefix guarantee this relied on — if the brain is ever
// re-enabled, either restore no-backspace or accept full reprocess on edits.
function npcListenTick(v) {
  if (!AI_NPC_ENABLED) return;   // brain-only: retrieval needs no prefill
  if (!v || npcChatOffline()) return;
  if (!NPC_CHAT._listen) NPC_CHAT._listen = { sent: "", at: 0, pending: new Set() };
  const L = NPC_CHAT._listen;
  const t = performance.now();
  if (v.length - L.sent.length < 8 && t - L.at < 900) return;   // throttle
  if (!v.startsWith(L.sent)) L.sent = "";
  L.sent = v; L.at = t;
  for (const npc of npcsInEarshot().slice(0, 2)) {              // at most 2 listeners
    const cid = npcCid(npc);
    if (L.pending.has(cid)) continue;
    L.pending.add(cid);
    npcFetch("/npc/listen", { id: cid, persona: npcPersona(npc), partial: v })
      .catch(() => {}).finally(() => L.pending.delete(cid));
  }
}

// ---------- chat bar UI ----------
let _chatBar, _chatInput;
function buildChatBar() {
  if (_chatBar) return;
  const style = document.createElement("style");
  style.textContent = `
    #npcchat { position:absolute; left:50%; bottom:14px; transform:translateX(-50%);
      display:none; z-index:40; width:min(440px,70%); }
    #npcchat.show { display:block; }
    #npcchat input { width:100%; box-sizing:border-box; padding:8px 12px; border-radius:16px;
      border:1px solid #4a5a72; background:rgba(18,22,30,0.88); color:#e8eefc;
      font:14px OpenDyslexic,Verdana; outline:none; }
    #npcchat input::placeholder { color:#8ea0bd; }
    #npcchat input:focus { border-color:#7fb0ff; box-shadow:0 0 0 2px rgba(127,176,255,0.25); }`;
  document.head.appendChild(style);
  _chatBar = document.createElement("div");
  _chatBar.id = "npcchat";
  _chatInput = document.createElement("input");
  _chatInput.type = "text";
  _chatInput.maxLength = 200;
  _chatInput.autocomplete = "off";
  _chatInput.placeholder = "Say something… (Enter)";
  _chatBar.appendChild(_chatInput);
  (document.getElementById("gamecol") || document.body).appendChild(_chatBar);

  // a normal chat box: edit freely (backspace and all); nothing is spoken —
  // no player bubble, no NPC hearing — until Enter commits the line. (The old
  // no-backspace + live-mirror behaviour served the AI brain's hear-as-you-type
  // prefix prefill; retrieval consumes nothing until send.)
  _chatInput.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") {
      _playerSend();
    } else if (e.key === "Escape") {
      _chatInput.blur();
    }
  });
  // Enter (when not already typing) focuses the bar if anyone is in earshot.
  window.addEventListener("keydown", e => {
    const ae = document.activeElement;
    if (e.key === "Enter" && _chatBar.classList.contains("show") &&
        !(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA"))) {
      e.preventDefault(); _chatInput.focus();
    }
  });
}
function updateChatBar(nNear) {
  if (!_chatBar) buildChatBar();
  _chatBar.classList.toggle("show", nNear > 0);
  if (nNear === 0 && document.activeElement === _chatInput) _chatInput.blur();
}

// Called from talkTo() when you click an NPC. If AI dialogue is live, open and
// focus the chat bar (greeting them if they haven't spoken yet) and return true
// so the caller skips the canned one-liner. Returns false when the bridge is
// offline, letting the game fall back to npc.line.
function npcFocusChat(npc) {
  if (!AI_NPC_ENABLED) {
    if (!NPC_RETRIEVAL_ENABLED) return false;   // fully canned
    npcRetrievalWarm();
    buildChatBar();
    const cid = npcCid(npc);
    if (!NPC_CHAT.active.has(cid)) { NPC_CHAT.active.set(cid, npc); npcGreet(npc, cid); }
    _chatBar.classList.add("show");
    _chatInput.focus();
    return true;
  }
  if (!NPC_CHAT.online || npcChatOffline()) {
    // one-time nudge so a missing bridge isn't a silent mystery
    if (!NPC_CHAT._warnedOffline && typeof log === "function") {
      NPC_CHAT._warnedOffline = true;
      log("(AI NPC chat is offline — start tools/npc_bridge.py to talk to them.)", "warn");
    }
    return false;
  }
  buildChatBar();
  const cid = npcCid(npc);
  if (!NPC_CHAT.active.has(cid)) { NPC_CHAT.active.set(cid, npc); npcGreet(npc, cid); }
  _chatBar.classList.add("show");
  _chatInput.focus();
  return true;
}

// probe the bridge once at startup so we start in the right online/offline state
(function () {
  if (!AI_NPC_ENABLED) { NPC_CHAT.online = false; return; }
  if (typeof fetch !== "function") return;
  fetch(NPC_CHAT.url + "/health").then(r => { NPC_CHAT.online = r.ok; })
    .catch(() => { NPC_CHAT.online = false; NPC_CHAT.offlineUntil = 0; });
})();

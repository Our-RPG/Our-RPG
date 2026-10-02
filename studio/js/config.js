// ===== Our RPG Workshop — configuration & shared vocabulary =====
// A standalone companion app to the Taiao game: generate and customise the
// game's sprites through the PixelLab.ai API, propose player-made costumes,
// and let the community vote on which ones make it into the game.
//
// Nothing here is secret. The PixelLab API key lives only in the browser
// (see js/pixellab.js); the Taiao account session reuses the game's server.
"use strict";

const CFG = {
  // PixelLab.ai — https://api.pixellab.ai/v2/docs . CORS is open, so the
  // browser calls it directly with the user's Bearer token.
  PIXELLAB_V2: "https://api.pixellab.ai/v2",
  PIXELLAB_V1: "https://api.pixellab.ai/v1",

  // The Taiao Phase-1 worker (accounts + workshop votes). our-rpg.com routes
  // /api/* to the worker, so the deployed Workshop (our-rpg.com/workshop)
  // calls it same-origin — no CORS. Overridable in Settings so a self-hoster
  // can point at their own deployment. Must be an origin the worker's
  // ALLOWED_ORIGINS lets in (localhost:8899 in dev).
  TAIAO_SERVER_DEFAULT: "https://our-rpg.com",

  // Poll cadence for PixelLab's async jobs (characters / objects / rotations).
  POLL_MS: 2500,
  POLL_TIMEOUT_MS: 6 * 60 * 1000,
};

// The game renders characters in 8 compass directions (js/sprites/
// characters-data.js: CHAR_DIRS). PixelLab uses the same eight, so a
// generated set drops straight into the game's rotation folders.
const DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];
const DIR_SHORT = { south: "S", "south-east": "SE", east: "E", "north-east": "NE", north: "N", "north-west": "NW", west: "W", "south-west": "SW" };

// PixelLab enums (verified against the live OpenAPI spec). These populate the
// generator controls so the UI mirrors pixellab.ai/create-character &
// /create-object.
const PL = {
  views: ["low top-down", "high top-down", "side"],
  objectViews: ["top-down", "sidescroller"],
  outlines: ["single color black outline", "single color outline", "selective outline", "lineless"],
  shadings: ["flat shading", "basic shading", "medium shading", "detailed shading", "highly detailed shading"],
  details: ["low detail", "medium detail", "highly detailed"],
  sizes: [16, 24, 32, 48, 64, 96, 128],
  // create-character body templates (skeleton fit).
  templates: ["mannequin", "chibi", "muscular", "slim", "child"],
};

// The costume/state vocabulary the game already ships (js/sprites/
// outfit-manifest.js OUTFIT_STATES). Offered as suggestions when a player
// names a new variant state so proposals cluster onto the same slots.
const COMMON_STATES = [
  "Idle", "armed", "new_hairstyle", "new_outfit", "smallclothes",
  "holding_weapon", "female_variant", "no_weapon",
];

// Equip slots a costume can be associated with (item worn / equipped). A
// costume can depict the character wearing a specific item; several costumes
// depicting the SAME item become alternative depictions the community votes on.
const EQUIP_SLOTS = ["head", "torso", "legs", "feet", "hands", "back/cloak", "mainhand", "offhand", "full outfit"];

// Where the game keeps its rotation art, shown as guidance when a player
// downloads a finished set for a pull request.
const GAME_ART_PATH = "assets/families_source/<folder>/<state>/rotations/<dir>.png";

// The areas a code submission (studio/js/pages/code.js) may target. MUST mirror
// server/src/submissions.js AREAS exactly (value = the server's area id). The
// NPC engine, admin controls, and koha are deliberately absent — those aren't
// open for community code submissions, and the server refuses them too.
const CODE_AREAS = [
  { id: "game",        label: "Game client / gameplay",      hint: "js/, dist/bundle.js — the browser RPG itself" },
  { id: "worldgen",    label: "Worldgen & world content",    hint: "js/world/, skills, items, biomes, quests" },
  { id: "workshop",    label: "Workshop site",               hint: "studio/ — this companion site" },
  { id: "server",      label: "Server / backend",            hint: "server/ — the Cloudflare Worker (excl. NPC/admin/koha)" },
  { id: "accounts",    label: "Accounts & auth",             hint: "login, passkeys, sessions, linking" },
  { id: "multiplayer", label: "Multiplayer / networking",    hint: "live presence, hub, zones, sync" },
  { id: "tools",       label: "Build & tooling",             hint: "tools/, studio/tools/, scripts" },
  { id: "docs",        label: "Docs & other",                hint: "README, docs/, governance" },
  { id: "other",       label: "Something else",              hint: "anything else in scope" },
];

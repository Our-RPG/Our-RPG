// ===== Taiao Workshop — real in-game trigger vocabularies =====
// Dropdown options for the trigger categories a character/monster/object can
// declare, drawn from the game's own data where it exists: sound-effect ids
// come straight from the SFX manifest; movement/behaviour verbs and lifecycle
// events are the ones the game's AI, husbandry and combat systems actually use;
// state-change options fold in the real outfit states. All guarded — missing
// data just yields the curated fallback.
"use strict";

const GameTriggers = (function () {
  const uniq = a => [...new Set(a.filter(Boolean))].sort();

  // Real sound-effect ids: strip the variant number + extension off each clip
  // in assets/sfx (e.g. "step_grass0.ogg" → "step_grass"). Matches audio.js SOUNDS.
  function sounds() {
    if (typeof SOUND_MANIFEST === "undefined" || !SOUND_MANIFEST.sfx) return FALLBACK_SFX;
    const s = uniq(SOUND_MANIFEST.sfx.map(f => f.replace(/\.[^.]+$/, "").replace(/\d+$/, "")));
    return s.length ? s : FALLBACK_SFX;
  }
  const FALLBACK_SFX = ["swing", "hit", "hurt", "kill", "die", "bow", "chop", "mine", "fish", "forage", "coins", "pickup", "equip", "eat", "drink", "craft", "levelup", "step_grass"];

  // Animation / action events — the game's action verbs (several double as SFX).
  const ANIMATIONS = ["idle", "walk", "run", "attack", "swing", "shoot", "cast", "hit", "hurt", "block", "die", "gather", "mine", "chop", "fish", "forage", "eat", "drink", "craft", "pickup", "equip", "sleep", "wave", "cheer", "talk"];

  // Movement / behaviour states used by pulse.js, quests.js, render3d.js and
  // the traversal code (idle/wander/patrol/hunt/flee/sleep + water & climbing).
  const MOVEMENTS = ["idle", "walk", "run", "wander", "patrol", "hunt", "chase", "flee", "sleep", "swim", "wade", "sail", "climb", "fly", "fall", "sink"];

  // Real gameplay state conditions the game's AI / world actually tracks — NOT
  // sprite outfit variants. These are the only state conditions that can fire a
  // trigger.
  const STATE_CONDITIONS = ["in_combat", "out_of_combat", "low_health", "alerted", "fleeing", "tamed", "day", "night", "dawn", "dusk", "raining", "snowing", "in_water", "on_road", "indoors", "aggro"];

  // Gameplay state conditions + the game's real outfit states — used by the
  // outfit/state-change matrix, NOT by the trigger "when" dropdown.
  function states() {
    let outfits = [];
    if (typeof OUTFIT_STATES !== "undefined") for (const f in OUTFIT_STATES) outfits.push(...OUTFIT_STATES[f]);
    outfits = outfits.filter(s => !["new_hairstyle", "new_outfit", "smallclothes"].includes(s) && !/^armorless/.test(s));
    return uniq(STATE_CONDITIONS.concat(outfits));
  }

  // Spawn / despawn / respawn + interaction lifecycle events.
  const LIFECYCLE = ["on_spawn", "on_despawn", "on_death", "on_respawn", "on_aggro", "on_flee", "on_tamed", "on_butcher", "on_pickup", "on_place", "on_examine", "on_interact", "on_depleted", "on_night", "on_day"];

  // Default animation columns for the state×animation matrix, per asset type.
  const ANIM_COLUMNS = {
    character: ["idle", "walk", "run", "attack", "swing", "shoot", "cast", "block", "hurt", "die"],
    monster: ["idle", "walk", "attack", "special", "hurt", "die"],
    object: ["idle", "open", "close", "use", "break"],
  };

  // Conditions that can FIRE a trigger (the "when"): lifecycle events + real
  // gameplay state conditions + movement/behaviour states — no sprite outfit
  // variants (those are art states, not runtime triggers).
  function conditions() { return uniq(LIFECYCLE.concat(STATE_CONDITIONS).concat(MOVEMENTS)); }

  // Event TYPES a trigger can cause — the game's ACTUAL runtime effects (combat,
  // AI, husbandry, economy, interaction, lifecycle), NOT pixellab sprite/anim
  // swaps. Type-scoped so each asset only offers what it can really do. Events
  // with a natural target get a third "instance" dropdown (see eventInstances).
  const COMMON_EVENTS = ["play_sound", "give_item", "reward_xp", "reward_coins", "spawn", "despawn", "teleport"];
  const EVENTS_BY_TYPE = {
    monster:   ["aggro", "flee", "deal_damage", "apply_poison", "apply_stun", "heal", "drop_loot", "respawn"],
    object:    ["open", "close", "unlock", "deplete", "respawn", "give_item"],
    character: ["start_dialogue", "open_bank", "give_quest", "advance_quest", "follow", "heal"],
  };
  function events(type) { return uniq((EVENTS_BY_TYPE[type] || []).concat(COMMON_EVENTS)); }

  return {
    sounds,
    conditions,
    events,
    animColumns: type => (ANIM_COLUMNS[type] || ["idle", "walk", "attack"]).slice(),
    animations: () => ANIMATIONS.slice(),
    movements: () => MOVEMENTS.slice(),
    states,
    lifecycle: () => LIFECYCLE.slice(),
    // the five categories, in display order
    categories: () => [
      { key: "animation", title: "Animation triggers", opts: ANIMATIONS.slice(), cond: "when… e.g. on attack" },
      { key: "state", title: "State-change triggers", opts: states(), cond: "when… e.g. hp < 20%" },
      { key: "lifecycle", title: "Despawn / respawn triggers", opts: LIFECYCLE.slice(), cond: "condition… e.g. after 60s" },
      { key: "sound", title: "Sound-effect triggers", opts: sounds(), cond: "when… e.g. on step" },
      { key: "movement", title: "Movement triggers", opts: MOVEMENTS.slice(), cond: "when… e.g. sees player" },
    ],
  };
})();

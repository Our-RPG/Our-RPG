-- Te Kairaranga, the Weaver — Lua port of gameplay/wizard.js. A plaza NPC who
-- folds the player through the veil to their tower, gifts a wand + starter runes
-- (once), and teaches the chant-sentence grammar. towerPos() stays a JS service
-- (elevation math), exposed here as weaver_tower_x/y().
on_role("wizard", function()
  say("Kia ora.")
  sfx("book")

  -- At the plaza: pitch the lesson, and on acceptance fold through to the tower.
  if not at_tower() then
    local r
    if quest.weaver_taught == 0 then
      r = dialog("Te Kairaranga — the Weaver",
        "\"You hear it too, eh? Underneath the gulls and the hammering — the world hums. Wind, water, stone: one long song.\"\n\"What towners call magic is just joining in. You speak a sentence INTO the weave — each word a rune, burnt from your pouch as it leaves your lips.\"",
        "Teach me the weave", "Another time")
    else
      r = dialog("Te Kairaranga — the Weaver",
        "\"Sentence not landing? Substance then verb — 'air strike'. Runes pouched, wand in hand, Enter or V.\"\n\"Want the tower again? The veil remembers the way.\"",
        "To the tower", "Just passing")
    end
    if r ~= 1 then return end
    teleport(weaver_tower_x(), weaver_tower_y())
  end

  -- At the tower (arrived just now, or already here): gift once, then teach.
  if quest.weaver_gift == 0 then
    add_item("wand", 1)
    add_item("air_rune", 30)
    add_item("rune_1", 30)
    add_item("fire_rune", 12)
    quest.weaver_gift = 1
    mes("Gift received: Wand, 30x Air rune, 30x Strike rune, 12x Fire rune.")
  end

  local r
  if quest.weaver_taught == 0 then
    quest.weaver_taught = 1
    dialog("The tower between",
      "\"Welcome to my tower. Every wizard keeps one, and every wizard's knees despise the stairs — so we came the other way.\"\n\"A weave is a SUBSTANCE and a VERB, in order. 'Air strike.' 'Fire strike.' A wand holds two words; a staff, three.\"",
      "Continue")
    r = dialog("Your first sentence",
      "\"Take this wand, and runes enough to be dangerous — mostly to yourself. Pouch each rune stack, wield the wand, then press Enter to type your sentence — or V to speak it.\"\n\"Find something that deserves an 'air strike' and give it one.\"",
      "Send me home", "I'll look around first")
  else
    r = dialog("The Weaver, at the tower",
      "\"Substance, then verb: 'air strike', 'fire strike'. Pouch the runes, wield the wand, Enter to type or V to speak.\"\n\"The deeper runes — modifiers, wildcards — you'll meet as your Runecrafting grows.\"",
      "Send me home", "Thanks")
  end
  if r == 1 then teleport(spawn_x(), spawn_y()) end
end)

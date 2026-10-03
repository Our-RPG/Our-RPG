-- Runa, the Loremaster — runecrafting, the portal, and the quest journal.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "What do I do with them?",
    a = function() chatnpc("My altar stands beside the portal. Work all ten into AIR RUNES — the lightest, kindest shaping there is — and feel the craft settle into your hands. As your Runecrafting deepens, each raw stone yields more. And keep Miles's rushlight EQUIPPED in your off-hand — night won't fall proper till it's burning at your side and the altar's done.") end },
  { q = "Why air runes, though?",
    a = "Look at that stone ring on the crown: an ANCIENT PORTAL, one of a network scattered across the endless world. Step up and it ATTUNES to you. Attune every portal you find and you can leap between them — FOR A PRICE IN RUNES. The further the jump, the finer the rune the veil demands; your ten air runes are short-hop fare. This one the mist reclaims when you sail, but out there every portal you wake is yours for good." },
  { q = "Anything else I should know out there?",
    a = function() chatnpc("Folk marked with a ✦ have WORK for you — letters to carry, roads to clear, sealed rooms to open. Finish one and they trust you with something bigger. Press J for your journal, M for the world map, which zooms from your street to the whole world. And right-click a city fountain to set your RESPAWN there, so death returns you somewhere friendly. The harbour waits below — " .. tut_name("ferry") .. " will open the way.") end },
  { q = "Open the quest journal (J)",
    a = function() tut_open_questlog() end },
}

on_npc("tut_lore", function()
  if tut_seen("lore") then
    if not tut_task_done("lore") then
      chatnpc("Not yet — " .. tut_task_label("lore") .. ".")
    else
      chatnpc("Altar worked, rushlight burning — the harbour's below when you're ready.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("Take these — TEN raw STATE RUNES, humming with unshaped intent. Raw, they're just cold stones; shaped at a RUNESTONE ALTAR they become true runes. That's my craft: RUNECRAFTING.")
  add_item("state_rune", 10)
  mes("Gift received: 10x State rune.")
  sfx("coins")
  topic_menu(TOPICS, "Thank you — I'm set.")
  tut_complete("lore")
end)

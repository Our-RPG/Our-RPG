-- Amenhotep, the Fisher — braced-current fishing + the whitebait run.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "How do I fish a current?",
    a = "First lesson before any net touches water: wade in and BRACE — hold SHIFT with your feet dug against the current. Feel it stop pulling? That's the stance you fish from; let go and the river tears you off the spot." },
  { q = "Does it matter where I fish?",
    a = "Every fishing spot in the world holds ONE kind of fish — shallow shore, deep sea and fresh water each carry their own, and rarer waters mean rarer fish. Hoki and snapper offshore, tuna — that's our eel — and kōura in the fresh, whitebait right here at the mouth." },
  { q = "How many do I need?",
    a = "Net FIVE, braced the whole while — you'll want every one, for the fritters ahead ask for all five. Raw kai does you no good; cooked, it heals you, and the finest dishes grant buffs — faster gathering, harder hitting, tougher skin." },
  { q = "Fritters?",
    a = function()
      chatnpc("Here's a secret worth the whole isle: HOLD ONTO your raw whitebait.")
      chatnpc("Up the path " .. tut_name("farm") .. " keeps the fowl for eggs, and " .. tut_name("cook") .. " will show you how to bind whitebait and egg into golden WHITEBAIT FRITTERS — best kai on Tūhura.")
    end },
  { q = "Where to after I've netted five?",
    a = function() chatnpc("CROSS THE BRIDGE over the river and carry on to " .. tut_name("smith") .. "'s forge through the next gate.") end },
}

on_npc("tut_fish", function()
  if tut_seen("fish") then
    if not tut_task_done("fish") then
      chatnpc("Not yet — " .. tut_task_label("fish") .. ".")
    else
      chatnpc("Netting's done — the bridge is yours to cross.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("Kia ora — and what an entrance, riding the gate down like a whitebait yourself!")
  chatnpc("See where my stream meets the sea? That's a RIVERMOUTH, and every spring the whitebait — īnanga — run up it in silver clouds. Take my scoop-net and my old rod; the net's the tool for whitebait.")
  topic_menu(TOPICS, "Thank you — I'll get netting.")
  add_item("small_net", 1)
  add_item("fishing_rod", 1)
  mes("Gift received: Small net, Fishing rod.")
  sfx("coins")
  tut_complete("fish")
end)

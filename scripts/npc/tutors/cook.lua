-- Aldric, the Cook — whitebait fritters, cottage cheese, and flatbread.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "Where do I start?",
    a = "The FRITTERS first: bind raw whitebait with an egg at my cookfire and fry it — cook FIVE golden whitebait fritters." },
  { q = "And the cheese?",
    a = "You'll need MILK. Take your empty PAILS to my COWS and milk them — a little Husbandry does it; tend the vale's flocks if yours isn't there yet. Curdle the milk at my creamery into curds, then press ONE COTTAGE CHEESE." },
  { q = "Is there bread too?",
    a = function() chatnpc("That flour you milled bakes into FLATBREAD at my bakehouse — bake FIVE. Five fritters, a cottage cheese, five flatbread, and " .. tut_name("war") .. " waits at the pit past the gate. Go well fed!") end },
}

on_npc("tut_cook", function()
  if tut_seen("cook") then
    if not tut_task_done("cook") then
      chatnpc("Not yet — " .. tut_task_label("cook") .. ".")
    else
      chatnpc("Well fed and ready — the pit's just past the gate.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("Welcome to my kitchen! Cooking heals you, and the finest dishes grant buffs. Three trades here: Cooking, Baking and Cheesemaking. My fires are yours to light — you've carried flint since " .. tut_name("smith") .. "'s forge, so strike your blade and stoke with logs, same as he taught.")
  topic_menu(TOPICS, "Smells good already — thanks.")
  tut_complete("cook")
end)

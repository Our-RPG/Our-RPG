-- Nala, the Soapmaker — charcoal/lye/tallow soap, and washing off the stink.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "Does it matter if I'm rank?",
    a = "Let it climb too high out in the world and shopkeepers bar their doors until you wash! And no bars handed out here — you'll MAKE your soap from what you carry." },
  { q = "How do I make soap?",
    a = "Char some of your LOGS at my clamp — a slow fire turns wood to charcoal and WOOD ASH. Leach the ash into LYE at the soap works, then boil the lye with the TALLOW you rendered off the warden's beasts. That's a bar of soap. Two crafts in it: Charcoaling for the ash, Soapmaking for the lye and the bar." },
  { q = "Then how do I actually wash?",
    a = function() chatnpc("Wade into my spring pool behind me — waist deep, safe — and SCRUB with your soap until every trace of stink is gone. Different soaps target different reeks; fancier bars scrub harder. Clean at last? Then climb on — " .. tut_name("sky") .. " keeps the knoll just past the gate.") end },
}

on_npc("tut_soap", function()
  if tut_seen("soap") then
    if not tut_task_done("soap") then
      chatnpc("Not yet — " .. tut_task_label("soap") .. ".")
    else
      chatnpc("Clean as a whistle — on you go.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("Look at the state of you — fish guts, forge smoke, monster ichor, honest sweat. Your stink metre climbs as you work and fight, and after that pit you're RIPE.")
  topic_menu(TOPICS, "I'll get scrubbing.")
  tut_complete("soap")
end)

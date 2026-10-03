-- Kwame, the Guide — Tūhura Isle's first keeper. Chooses the player's body
-- (CharSelect) and points them down the path. See scripts/npc/tutors/README
-- for the shared tut_* bridge (js/lua/lua-host.js) every tutor script uses:
-- the island geography, goal counters and gate logic all stay in JS
-- (gameplay/tutorial.js) — this file only owns the CONVERSATION.
local function finishGuide()
  add_item("coins", 25)
  mes("Gift received: 25 coins.")
  sfx("coins")
  tut_complete("guide")
  tut_open_charselect()
end

on_npc("tut_guide", function()
  -- re-visited while still a spark of light: a short nudge, not the whole
  -- intro again (the C key is disabled — the Guide is the only chooser)
  if tut_seen("guide") and not tut_has_body() then
    chatnpc("You're still a spark of unformed light, e hoa — the path east won't open until you've taken a body.")
    choice("How do I choose one?")
    chatnpc("Choose one now and become someone. You can always come back to me and pick a different form later.")
    choice("Choose my character")
    tut_open_charselect()
    return
  end
  if tut_seen("guide") then
    chatnpc("Off you go, e hoa — the path east is yours.")
    return
  end
  chatnpc("Haere mai, traveller — welcome to Tūhura Isle, the Isle of Discovery. Everyone arrives the same way: washed up on the sand with empty hands.")
  choice("What am I, exactly?")
  chatnpc("Look at yourself, e hoa — still a spark of unformed light. Before anything else you must take a BODY. Dozens of folk to choose from, each with their own build, pace and wardrobe.")
  local r = choice("Let me choose a body now", "First — how do I get around?")
  if r == 1 then finishGuide(); return end
  chatnpc("Click the ground to walk; click a tree, rock, fire or person to use it. RIGHT-click anything for more choices, and press ENTER near anyone to talk in your own words — we truly answer.")
  choice("And where am I headed?")
  chatnpc("Follow the dirt path east. " .. tut_name("bush") .. " the Bushman is expecting you, and every keeper after equips you for their lesson — tool by tool — until you walk off my isle fully kitted. The ? tab holds a full guide; the Goals tab tracks your journey.")
  choice("I'm ready — let me choose a body")
  finishGuide()
end)

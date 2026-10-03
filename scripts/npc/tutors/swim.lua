-- Vrixa, the Swim-Master — the islet errand: snorkel out, lift the sea
-- chest's pearl, swim it home. The return leg completes by PROXIMITY (tick()
-- in gameplay/tutorial.js checks distance to Vrixa, not a hand-off click) —
-- so a player back from the motu with the pearl still in their pack needs
-- telling that outright, or it reads as her not noticing they're done.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "What's the task, exactly?",
    a = "Out past the lagoon, south-east, a lone MOTU rides the swell, and on its sand sits an old sea chest with a PEARL in it. Fetch it and swim it home — that's the whole task, and the whole trick. The crossing is measured against YOUR body, e hoa: exactly one breath too wide. Strike out with bare lungs and the deep takes you a few strokes short of the sand." },
  { q = "So how do I make it?",
    a = "EQUIP THE SNORKEL — it halves the thirst of your lungs, and the crossing becomes yours with air to spare. Rest on the motu, then swim the pearl back and put it in MY hand. And don't dream of paddling it — the chop over the drowned shelf would swamp any hull. This one is swum, out and back." },
  { q = "What about the open sea?",
    a = "The open sea past the fences is no road. The fence lines run off the beaches into the surf, and beyond them the water only gets DEEPER, with nowhere to land. Don't go hunting a way round a gate by sea; there isn't one worth your life. The path is the only way on." },
  { q = "You mentioned rivers carry you?",
    a = "You've felt it already — that ride down through the gate. Wade a river unbraced and the current bears you downstream; BRACE with SHIFT and your line is your own. Storms swell a river into flood — deeper, colder, far stronger. The corridor above the river gate even climbs to the SOURCE, marked on your map, if you want the full run." },
  { q = "And a raft, for later?",
    a = function()
      add_item("log_raft", 1)
      mes("Gift received: Log raft.")
      chatnpc("Stand at the water's edge, place it, and paddle — anywhere but my motu channel! Shipwrights build proper hulls up to great sailing ships; bigger hulls draw more water.")
      chatnpc("Where roads meet water the world builds stone bridges, and over shallow seas whole causeways on piles — you'll sail under some, and tall hulls must duck the low ones.")
    end },
}

on_npc("tut_swim", function()
  if tut_seen("swim") then
    if tut_task_done("swim") then
      chatnpc("Pearl safe home — the lagoon's done with you. Head on.")
    elseif has_item("pearl") then
      chatnpc("You're back, and the pearl's in your hand! Swim right up close to me on the lagoon shore — no need to hand it over, I'll feel the moment you're near, and the gate opens.")
    else
      chatnpc("Not yet, e hoa — " .. tut_task_label("swim") .. ".")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("You can wade and swim — but watch the depth. Once the waterline passes your nose your AIR drains; run out and you'll black out and wash ashore, lighter in the pockets. My lagoon here shelves off fast into deep blue.")
  add_item("snorkel", 1)
  mes("Gift received: Snorkel.")
  sfx("coins")
  chatnpc("This snorkel I'm giving you buys you nearly double the distance — glassblowers make them. Now for MY lesson.")
  topic_menu(TOPICS, "The pearl's waiting — I'm off.")
  tut_complete("swim")
end)

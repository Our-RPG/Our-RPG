-- Pallo, the Bushman — teaches gathering + the Option-click felling queue.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "What else can I gather?",
    a = "Berry bushes, herb patches, wildflowers, even boulders — nearly everything growing or lying about can be gathered, and it all grows back in time. Over thirty-five skills in this world, and every one starts just like this: click, gather, learn." },
  { q = "Are all trees the same?",
    a = "Out in the wide world the forests fill with kauri, rimu, kahikatea, tōtara — real giants. Higher-tier trees want a higher Woodcutting level and a better axe, but their timber is worth it. Listen in the deep bush and you'll meet tūī, kererū, kea, even kiwi scratching about at night." },
  { q = "So what's my lesson?",
    a = "The woodsman's real trick: PLANNING the day's felling. Hold OPTION and CLICK a tree and the job joins your QUEUE — a white ring marks each tree waiting its turn, and your hands move to the next the moment a stump settles." },
  { q = "How many should I queue?",
    a = "QUEUE FIVE FELLING JOBS, and FELL FIVE TREES — that's my lesson, both halves. It works for nearly everything: harvest rows, ore terraces, pickups. Queue the work, then let yourself get on with it." },
  { q = "Does a better axe help?",
    a = "A better axe fells faster — true everywhere: good field tools speed your gathering, fine workshop tools raise the quality of what you craft. And KEEP those logs; you'll saw, fletch and carpenter with them up the path." },
  { q = "How do I reach the next keeper?",
    a = function()
      chatnpc("Here's the fun of it — there's NO dry road to the cove. Follow my path to where the stream slips through the chamber wall, wade in, and let the current CARRY you.")
      chatnpc("The RIVER GATE swings open the moment your fifth tree falls, and the water itself sets you on " .. tut_name("fish") .. "'s bank. Hold SHIFT any time you'd rather stand than drift.")
    end },
}

on_npc("tut_bush", function()
  if tut_seen("bush") then
    if not tut_task_done("bush") then
      chatnpc("Not yet, e hoa — " .. tut_task_label("bush") .. ".")
    else
      chatnpc("Off to the river gate with you — it's open.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  -- the axe is handed over the instant the lesson opens, not after every page
  add_item("axe_iron", 1)
  mes("Gift received: Iron axe.")
  sfx("coins")
  chatnpc("Kia ora! Take my spare iron axe — it's yours. See all these young trees? With an axe in your pack, click one and you'll fell it for logs.")
  topic_menu(TOPICS, "Off I go, then.")
  tut_complete("bush")
end)

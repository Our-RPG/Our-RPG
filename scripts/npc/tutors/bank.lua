-- Torvak, the Banker — the vault, bank networks, and the carpenter's pails.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "Is it the same on the mainland?",
    a = "Grander: every road-connected settlement shares one network. Stash your ore in one town, withdraw it in the next — the Bank of Newhaven's web spans nearly the whole known world." },
  { q = "How do I join a network?",
    a = function()
      chatnpc("Big city networks want a signature at their main branch — a grand three-storey hall with a row of tellers. Village co-ops will sign you at the counter.")
      add_item("coins", 100)
      mes("Gift received: 100 coins.")
      chatnpc("Here — a hundred coins of seed money. Put something in the vault before you walk on, just to feel it.")
    end },
  { q = "What's my lesson here?",
    a = "See my CARPENTER'S BENCH? The camps ahead run on MILK, and milk needs pails. Fell a tree here, saw your logs into PLANKS at the bench, and MAKE NINE EMPTY PAILS." },
  { q = "Nine's a lot to carry.",
    a = function() chatnpc("That's the lesson, e hoa — stash the spares in the vault. It carries what your pack can't, and they'll be waiting at any bank you find. " .. tut_name("farm") .. "'s fields are through the gate.") end },
}

on_npc("tut_bank", function()
  if tut_seen("bank") then
    if not tut_task_done("bank") then
      chatnpc("Not yet — " .. tut_task_label("bank") .. ".")
    else
      chatnpc("Pails stowed — the farm gate's open for you.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("That chest by my tent is a BANK. Anything you store is safe forever — death can't touch it. Out here on a lonely isle the vault is free and private.")
  topic_menu(TOPICS, "Good to know — thank you.")
  tut_complete("bank")
end)

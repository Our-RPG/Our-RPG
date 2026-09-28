-- Dockmaster Pell (Newhaven harbour side) — the Harbour Ledger arc (start +
-- finale), and he accepts Cook Bess's pie delivery.
on_npc("nh_dockmaster", function()
  -- Cook's delivery (Meals on Legs): take the pie off the player's hands.
  if quest.ck_pie == 1 then
    if has_item("hot_pie") then
      del_item("hot_pie", 1)
      chatnpc("A hot pie? From Bess? ...I don't deserve that woman. Tell her thank you — and that I ate it, all of it.")
      return
    end
  end

  -- Harbour Ledger, stage 1: fetch the master tally from Archivist Wren.
  if quest.hl == 0 then
    chatnpc("Cargo won't tally. Either I've forgotten how to count, or someone's skimming my harbour. Fetch the master copy from Archivist Wren — she keeps the true numbers.")
    if choice("I'll get the ledger.", "Not my business.") == 1 then
      quest.hl = 1
      mes("Harbour Ledger (1/4): see Archivist Wren, north of the plaza.")
    else
      chatnpc("Suit yourself. But smuggling is everyone's business, eventually.")
    end
    return
  end
  if quest.hl == 1 then
    chatnpc("Wren keeps the archive, north side of the plaza. She'll have the sealed tally.")
    return
  end

  -- stage 3: player brought the sealed tally back — read it, set the hunt
  if quest.hl == 2 then
    if has_item("sealed_tally") then
      del_item("sealed_tally", 1)
      quest.hl = 3
      quest.hl_bandit_base = kills("bandit")
      chatnpc("Let's see, by the tides... there. The missing crates went east — the road bandits are fencing my cargo. Break four of them and search what they've stashed for proof.")
      mes("Harbour Ledger (3/4): break the road bandits (0/4).")
    else
      chatnpc("Bring me Wren's sealed tally and we'll know who's lying to me.")
    end
    return
  end
  if quest.hl == 3 then
    if kills("bandit") - quest.hl_bandit_base >= 4 then
      quest.hl = 4
      chatnpc("Four down, and the fence's name in your hand. Now the hard part: the smuggler is one of my own dockhands. Do we hand him to the Watch — or keep it quiet for a share?")
    else
      chatnpc("Four of the road bandits. That's the proof I need.")
    end
    return
  end

  -- stage 4: the finale choice
  if quest.hl == 4 then
    if choice("Hand him to the Watch.", "Keep it quiet — take the cut.") == 1 then
      quest.hl = 5
      add_item("coins", 500)
      give_xp("Melee", 200)
      quest_point(2)
      chatnpc("The honest road. The Watch has him, the harbour's clean, and Newhaven won't forget who set it right.")
      mes("Harbour Ledger complete — justice served.")
    else
      quest.hl = 6
      add_item("coins", 800)
      chatnpc("...quietly, then. Here's your share. We never spoke — and Newhaven never knew.")
      mes("Harbour Ledger complete — hushed up.")
    end
    return
  end

  chatnpc("The harbour runs smooth these days. Mostly. Fair winds to you.")
end)

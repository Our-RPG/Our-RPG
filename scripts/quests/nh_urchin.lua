-- Sparrow the Urchin (Newhaven plaza) — a retrieve quest and a moral choice.
on_npc("nh_urchin", function()
  -- Quest 1: The Urchin's Locket (retrieve from the world).
  if quest.ur_locket == 0 then
    chatnpc("I lost my ma's locket — dropped it behind the big stone planter over on the harbour side. Fetch it back? I'll make it worth your while.")
    if choice("I'll find it.", "Sorry, no.") == 1 then
      quest.ur_locket = 1
      mes("Quest started: The Urchin's Locket — search the planter near the docks.")
    else
      chatnpc("...fine. Everyone's too busy for a street rat.")
    end
    return
  end
  if quest.ur_locket == 1 then
    if has_item("locket") then
      del_item("locket", 1)
      quest.ur_locket = 2
      add_item("coins", 150)
      give_xp("Foraging", 90)
      quest_point(1)
      chatnpc("You found it! ...Thank you. Truly. Here — it's not much, but it's honestly yours.")
      mes("Quest complete: The Urchin's Locket.")
    else
      chatnpc("Behind the stone planter on the harbour side, I swear it. Big square one.")
    end
    return
  end

  -- Quest 2: Finders Keepers (a choice).
  if quest.ur_purse == 0 then
    chatnpc("Here's a game. I found a fat purse a merchant dropped. Help me decide — hand it back like an honest soul, or split it and say nothing?")
    if choice("Hand it back. It's the honest thing.", "Split it — finders keepers.") == 1 then
      quest.ur_purse = 2
      add_item("coins", 120)
      give_xp("Foraging", 80)
      quest_point(1)
      chatnpc("...yeah. Yeah, alright. The Watch gave a finder's reward — half's yours, the honest half.")
      mes("Quest complete: Finders Keepers (returned).")
    else
      quest.ur_purse = 3
      add_item("coins", 300)
      chatnpc("Ha — knew I liked you. Don't go spending it where the Watch can see.")
      mes("Quest complete: Finders Keepers (kept).")
    end
    return
  end

  chatnpc("Keep your ears open round the plaza. I hear things — might have work again soon.")
end)

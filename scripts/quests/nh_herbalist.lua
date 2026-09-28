-- Herbalist Maeve (Newhaven plaza) — two gathers from the meadow and hedgerows.
-- Gather progress is checked at turn-in against the pack (count_item), then consumed.
on_npc("nh_herbalist", function()
  -- Quest 1: Simples for the Sick.
  if quest.hb_herb == 0 then
    chatnpc("Fever's going round the lower ward. I need eight sprigs of herb from the meadow — will you gather them?")
    if choice("I'll fetch them.", "No time.") == 1 then
      quest.hb_herb = 1
      mes("Quest started: Simples for the Sick — bring 8 herb.")
    else
      chatnpc("Don't dawdle. Fever waits for no one.")
    end
    return
  end
  if quest.hb_herb == 1 then
    if count_item("herb") >= 8 then
      del_item("herb", 8)
      quest.hb_herb = 2
      add_item("coins", 200)
      add_item("potion_health", 2)
      give_xp("Foraging", 220)
      quest_point(1)
      chatnpc("Bless you — that's the ward mended. Here, two draughts for your own trouble.")
      mes("Quest complete: Simples for the Sick.")
    else
      chatnpc("Eight sprigs of herb, mind. The meadow's thick with it if you look low.")
    end
    return
  end

  -- Quest 2: A Sweeter Remedy (needs berries).
  if quest.hb_berry == 0 then
    chatnpc("The children won't take bitter physic. Bring me twelve berries and I'll sugar it.")
    if choice("Berries it is.", "Another day.") == 1 then
      quest.hb_berry = 1
      mes("Quest started: A Sweeter Remedy — bring 12 berries.")
    else
      chatnpc("The hedgerows are heavy with them just now.")
    end
    return
  end
  if quest.hb_berry == 1 then
    if count_item("berries") >= 12 then
      del_item("berries", 12)
      quest.hb_berry = 2
      add_item("coins", 180)
      give_xp("Foraging", 160)
      quest_point(1)
      chatnpc("There — they'll swallow it smiling now. My thanks.")
      mes("Quest complete: A Sweeter Remedy.")
    else
      chatnpc("Twelve berries. Sweet ones, from the hedgerows past the gate.")
    end
    return
  end

  chatnpc("The stores are stocked, thanks to you. Come back if you find anything unusual growing.")
end)

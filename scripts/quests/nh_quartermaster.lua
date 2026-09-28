-- Quartermaster Yorick (Newhaven plaza) — two hunts that keep the wilds honest.
-- Hunt progress uses the bestiary tally: snapshot kills() at start, check the
-- delta at turn-in.
on_npc("nh_quartermaster", function()
  -- Quest 1: Cull the Goblins.
  if quest.qm_goblin == 0 then
    chatnpc("Goblins are massing past the north fields. Thin them out — five should teach the rest some manners.")
    if choice("I'll cull them.", "Not just now.") == 1 then
      quest.qm_goblin_base = kills("goblin")
      quest.qm_goblin = 1
      mes("Quest started: Cull the Goblins (0/5).")
    else
      chatnpc("The fields will still be there when you change your mind.")
    end
    return
  end
  if quest.qm_goblin == 1 then
    if kills("goblin") - quest.qm_goblin_base >= 5 then
      quest.qm_goblin = 2
      add_item("coins", 300)
      give_xp("Melee", 250)
      quest_point(1)
      chatnpc("Five fewer to worry about — Newhaven owes you. Take these coins, with thanks.")
      mes("Quest complete: Cull the Goblins.")
    else
      chatnpc("Still green hides out past the fields. Five goblins — keep at it.")
    end
    return
  end

  -- Quest 2: Boar Trouble (unlocks after the goblins).
  if quest.qm_boar == 0 then
    chatnpc("Now the boar are trampling the farm rows. Put down three of the tuskers, would you?")
    if choice("Consider it done.", "Later.") == 1 then
      quest.qm_boar_base = kills("boar")
      quest.qm_boar = 1
      mes("Quest started: Boar Trouble (0/3).")
    else
      chatnpc("Mind the rows aren't bare by the time you get to it.")
    end
    return
  end
  if quest.qm_boar == 1 then
    if kills("boar") - quest.qm_boar_base >= 3 then
      quest.qm_boar = 2
      add_item("coins", 250)
      give_xp("Melee", 180)
      quest_point(1)
      chatnpc("Good hunting. The farmers will sleep easier tonight.")
      mes("Quest complete: Boar Trouble.")
    else
      chatnpc("Three boar. The rows won't mend themselves.")
    end
    return
  end

  chatnpc("Nothing new just now. Keep the wilds honest, and the walls will hold.")
end)

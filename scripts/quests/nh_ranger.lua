-- Ranger Ash (Newhaven plaza) — the road out of town, and a lost cache.
on_npc("nh_ranger", function()
  -- Quest 1: Clear the Road (hunt bandits).
  if quest.rg_bandit == 0 then
    chatnpc("Bandits are working the east road out of Newhaven. Put down four and the rest will think twice about robbing travellers.")
    if choice("I'll clear the road.", "Not today.") == 1 then
      quest.rg_bandit_base = kills("bandit")
      quest.rg_bandit = 1
      mes("Quest started: Clear the Road (0/4 bandits).")
    else
      chatnpc("Travellers keep vanishing on that road. Don't wait too long.")
    end
    return
  end
  if quest.rg_bandit == 1 then
    if kills("bandit") - quest.rg_bandit_base >= 4 then
      quest.rg_bandit = 2
      add_item("coins", 400)
      give_xp("Melee", 300)
      quest_point(1)
      chatnpc("The road's quiet again. That was dangerous work — and good work.")
      mes("Quest complete: Clear the Road.")
    else
      chatnpc("Four bandits. They camp where the road bends east, past the last farm.")
    end
    return
  end

  -- Quest 2: The Ranger's Cache (retrieve from the world).
  if quest.rg_cache == 0 then
    chatnpc("I stashed a strongbox before the bandits jumped me — tucked in the old cold brazier by the west wall. Bring it back and it's half yours.")
    if choice("I'll recover it.", "Later.") == 1 then
      quest.rg_cache = 1
      mes("Quest started: The Ranger's Cache — search the west-wall brazier.")
    else
      chatnpc("It won't stay hidden forever.")
    end
    return
  end
  if quest.rg_cache == 1 then
    if has_item("road_cache") then
      del_item("road_cache", 1)
      quest.rg_cache = 2
      add_item("coins", 220)
      add_item("iron_bar", 2)
      quest_point(1)
      chatnpc("My thanks — and the bars are yours, I've no forge to use them.")
      mes("Quest complete: The Ranger's Cache.")
    else
      chatnpc("The strongbox is in the cold brazier by the west wall. Can't miss it.")
    end
    return
  end

  chatnpc("Roads are as safe as they get, for now. Watch yourself past the walls.")
end)

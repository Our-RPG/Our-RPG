-- Cook Bess (Newhaven plaza) — a gather and a delivery (to Dockmaster Pell).
on_npc("nh_cook", function()
  -- Quest 1: Daily Bread (gather wheat).
  if quest.ck_wheat == 0 then
    chatnpc("The bakehouse is out of flour and I'm clean out of wheat. Bring me ten sheaves from the farm rings round the walls?")
    if choice("I'll gather it.", "No time.") == 1 then
      quest.ck_wheat = 1
      mes("Quest started: Daily Bread — bring 10 wheat.")
    else
      chatnpc("A city marches on its stomach, remember.")
    end
    return
  end
  if quest.ck_wheat == 1 then
    if count_item("wheat") >= 10 then
      del_item("wheat", 10)
      quest.ck_wheat = 2
      add_item("coins", 180)
      add_item("cooked_meat", 3)
      give_xp("Cooking", 140)
      quest_point(1)
      chatnpc("Bless you — fresh loaves by morning. Here, a hot meal to see you off.")
      mes("Quest complete: Daily Bread.")
    else
      chatnpc("Ten sheaves of wheat, from the farm rings round the walls.")
    end
    return
  end

  -- Quest 2: Meals on Legs (deliver a pie to Dockmaster Pell).
  if quest.ck_pie == 0 then
    chatnpc("Do me a kindness — run this hot pie down to Dockmaster Pell before it goes cold. The man forgets to eat.")
    add_item("hot_pie", 1)
    quest.ck_pie = 1
    mes("Quest started: Meals on Legs — take the hot pie to Dockmaster Pell.")
    return
  end
  if quest.ck_pie == 1 then
    if has_item("hot_pie") then
      chatnpc("You've still got the pie! Pell's down by the harbour — off you go before it's stone cold.")
    else
      quest.ck_pie = 2
      add_item("coins", 90)
      give_xp("Cooking", 60)
      quest_point(1)
      chatnpc("He got it, then? Good soul. Here's for the wear on your boots.")
      mes("Quest complete: Meals on Legs.")
    end
    return
  end

  chatnpc("Kitchen's warm and the stores are full. Come back hungry.")
end)

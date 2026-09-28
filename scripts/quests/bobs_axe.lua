-- Bob's Lost Axe — starter fetch quest. Talk to Bob to begin, find the rusty axe
-- in the world (on_loc "rusty_axe"), then return for the reward. Quest-var key
-- "bobs_axe_quest" is preserved from the old QuestScript port so mid-quest saves
-- keep their stage.
on_npc("bob", function()
  if quest.bobs_axe_quest == 0 then
    chatnpc("Ugh, I've lost my axe somewhere out there. Could you find it for me?")
    if choice("Yes, I'll help.", "No thanks.") == 1 then
      quest.bobs_axe_quest = 1
      mes("Quest stage: Bob's Lost Axe started.")
    else
      chatnpc("Oh well, let me know if you change your mind.")
    end
  end
  if quest.bobs_axe_quest == 1 then
    if has_item("rusty_axe") then
      del_item("rusty_axe", 1)
      add_item("coins", 500)
      quest.bobs_axe_quest = 2
      chatnpc("My axe! Thank you so much — here's 500 coins for your trouble.")
      quest_point(1)
    else
      chatnpc("Still haven't found it, eh? It's probably near the old stump.")
    end
  end
end)

on_loc("rusty_axe", function()
  if quest.bobs_axe_quest == 1 then
    add_item("rusty_axe", 1)
    loc_del("none")   -- gone for good
    mes("You pick up the rusty axe.")
  else
    mes("Nothing interesting happens.")
  end
end)

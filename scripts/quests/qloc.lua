-- World objects for the Newhaven retrieve quests (world/quest-anchors.js paints
-- these at fixed plaza tiles; on_loc fires on click). Each only yields its prize
-- while the matching quest stage is active — otherwise it's just scenery.

-- The urchin's locket, behind the harbour-side planter.
on_loc("qloc_locket", function()
  if quest.ur_locket == 1 then
    add_item("locket", 1)
    loc_del("none")
    mes("You prise a tarnished locket from behind the planter.")
  else
    mes("A city planter. Nothing hidden here — for now.")
  end
end)

-- The ranger's strongbox, stashed in the cold west-wall brazier.
on_loc("qloc_cache", function()
  if quest.rg_cache == 1 then
    add_item("road_cache", 1)
    loc_del("none")
    mes("You lever open the ranger's cache and lift out the strongbox.")
  else
    mes("A cold brazier. Nothing to take.")
  end
end)

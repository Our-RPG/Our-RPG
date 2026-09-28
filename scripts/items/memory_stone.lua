-- ITEM BEHAVIOUR pillar → triggers the CUTSCENE pillar. Using the memory stone
-- (on_item) plays the "dawn_vision" cutscene as its own dispatch, which engages
-- the main-loop cine gate (player + quest sims freeze while it runs).
on_item("memory_stone", function()
  play_cutscene("dawn_vision")
end)

-- Default townsfolk routine — the Lua replacement for the old JS wander/bedtime
-- AI *and* the lamplighter dispatch (render3d assignLampTasks). Applied to every
-- ambient mix NPC with no more-specific routine. The engine re-runs this body
-- continuously, so it reads as "what a villager is doing now".
routine("villager", function()
  if lamp_mode() ~= "" then
    -- dusk/dawn in a settlement: help set out (or gather in) the candle stands.
    -- Each pass claims the nearest spot still needing work, walks there and
    -- sets/collects the stand; when none are left, just mill about.
    if claim_lamp_spot() then
      walk_to(lamp_spot_x(), lamp_spot_y())
      light_lamp()
    else
      wander(home_radius())
    end
  elseif is_bedtime() then
    go_to_bed()        -- walk home and onto the bed (or the home post)
    sleep_until(6)     -- stay until 6am (npcAsleep is derived: bedtime + on bed)
    climb_to(0)        -- if the bed was upstairs, come back down at dawn
  else
    wander(home_radius())   -- stroll within the leash, or just stand a while
  end
end)

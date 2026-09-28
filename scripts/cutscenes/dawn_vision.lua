-- CUTSCENE pillar. A short authored sequence: fade to black, timed captions, a
-- camera push and pull, then fade back in. Sequenced by a Lua coroutine — each
-- primitive returns a Promise the runtime yields on. While it runs, the main
-- loop's cine gate (Lua.cutsceneActive()) freezes the player and quest sims; the
-- world and renderer keep ticking underneath.
cutscene("dawn_vision", function()
  fade_out(0.8)
  scene_text("The stone warms in your palm...", 2.4)
  cam_zoom(0.55, 1.4)
  scene_text("For a heartbeat you stand on a shore you have never seen — and always known.", 3.4)
  cam_zoom(1.0, 1.2)
  fade_in(0.9)
  mes("The vision fades. You pocket the memory stone.")
end)

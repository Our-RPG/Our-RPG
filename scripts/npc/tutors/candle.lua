-- Miles, the Candlemaker — tallow + flax into a dipped rushlight.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "What do I need to make one?",
    a = "No gift — you've already gathered the makings. Remember the flax you reaped in the vale, and the tallow off the warden's beasts? Those become a candle. We start with the humblest light there is: the RUSHLIGHT. No wick to spin — just tallow, dipped at my chandlery until it holds a flame. DIP ONE and the gate opens." },
  { q = "How do I use it?",
    a = function() chatnpc("Carry it lit in your off-hand — click it in your pack — and its glow walks with you; you'll want that tonight. When your Candlemaking grows, come back for wicks and tapers, scented and cathedral candles beyond. " .. tut_name("lore") .. " waits at the portal crown.") end },
}

on_npc("tut_candle", function()
  if tut_seen("candle") then
    if not tut_task_done("candle") then
      chatnpc("Not yet — " .. tut_task_label("candle") .. ".")
    else
      chatnpc("Lit and carried — the portal crown's just ahead.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("Evening's coming on — feel how the isle dims? Out in the world, night is DARK, and a carried light is worth more than gold in a dungeon or on a midnight road. That's my craft: Candlemaking.")
  topic_menu(TOPICS, "I'll dip one now.")
  tut_complete("candle")
end)

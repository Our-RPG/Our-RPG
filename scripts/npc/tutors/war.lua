-- Yuki, the Warden — melee/archery basics, reagent gathering, the koreke.
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "How does fighting work?",
    a = "Two ways. MELEE is sword and shield up close; ARCHERY looses real arrows that arc through the air — you can kite, but you need line of sight. There are stranger arts out in the wide world — woven magic, spoken spells — but those are lessons for beyond the mist, not for my pit." },
  { q = "What do you want me to prove?",
    a = "Slay THREE SLIMES, and gather ONE TALLOW and THREE HIDE from the pit's beasts, THREE ACTION RUNES off the slimes, and THREE STATE RUNES — mine the essence rocks for those. Monsters drop coins and rare REAGENTS that gate whole crafting skills; hunters feed the whole economy." },
  { q = "What about that bird?",
    a = "The KOREKE — the little quail about the pit? Startle one and it takes to the air, and a bird on the wing is beyond any blade; this is what your bow is for. Nock an arrow, lead the flight, and bring ONE down. That's archery. Run dry and I'll come running with more — don't fret the count." },
  { q = "Open the bestiary (B)",
    a = function() tut_open_bestiary() end },
  { q = "Where to when the pit's done?",
    a = function() chatnpc("Slimes slain, reagents gathered, a koreke down — then wash up with " .. tut_name("soap") .. " at the springs past the gate. You've earned a scrub.") end },
}

on_npc("tut_war", function()
  if tut_seen("war") then
    if not tut_task_done("war") then
      chatnpc("Not yet — " .. tut_task_label("war") .. ".")
    else
      chatnpc("The pit's cleared — go get that stink washed off.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("Draw that iron shortsword you forged — and take these two health draughts. The SLIMES in the pit are yours: click one and go.")
  add_item("potion_health", 2)
  mes("Gift received: 2x Health potion.")
  sfx("coins")
  topic_menu(TOPICS, "Time to fight.")
  tut_complete("war")
end)

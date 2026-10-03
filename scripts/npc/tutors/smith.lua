-- Menkaure, the Smith — ore ledger, furnace heat, and the forge-your-own kit.
-- The xp is his DEMONSTRATION (he works a load in front of you) — numbers are
-- load-bearing, see the terrace-ledger comment in gameplay/tutorial.js's
-- TUT_CONTENT (derives the whole smelt plan from Smelting 550 / Ore-mining 400).
-- TOPIC MENU (user req 2026-10-03): see js/lua/prelude.lua's topic_menu().
local TOPICS = {
  { q = "What ore have I got to work?",
    a = "My terrace is a MEASURED LEDGER — the only ore on this whole isle: FIVE copper rocks at seven ore each, TWO pale tin rocks at two each, ONE dark iron rock at six. Copper first — your arms harden on it. Tin yields at Ore-mining TWO, iron at THREE, and the copper carries you there." },
  { q = "And the smelting plan?",
    a = "My furnace smelts in LOADS OF SIX. FOUR firings of COPPER — twenty-four bars — then ONE firing of BRONZE, which drinks four copper and two tin. That lands your Smelting at THREE: enough for ONE firing of IRON, six bars, plenty for the kit. I've left SPARE STONE, so a stray firing strands no one." },
  { q = "Is there a harder way?",
    a = "A MASTER runs the whole ledger in SIX firings flat, nothing wasted. Do that and I'll pay you a mastersmith's koha of 150 coins. But first — a cold furnace smelts nothing. Every fire on this isle burns REAL fuel." },
  { q = "How do I light it?",
    a = function()
      chatnpc("Take my working KNIFE and this piece of FLINT — keep both in your pack. Stand at the furnace, STRIKE a spark, then STOKE the fire with logs.")
      add_item("knife", 1)
      add_item("flint", 1)
      mes("Gift received: Knife, Flint.")
      chatnpc("Lighting my furnace is the first mark of your lesson, and every stoke feeds your FIREMAKING — even a fizzled spark is practice. The flint never wears out.")
    end },
  { q = "Will plain logs smelt everything?",
    a = "Plain logs burn hot enough for copper and bronze — but IRON wants a fiercer fire. Fell a MĀNUKA once your Woodcutting reaches 3, stoke with its logs, and keep striking until your Firemaking can hold that heat." },
  { q = "What am I forging?",
    a = "No hand-outs at the anvil — you earn your gear. Forge all FOUR: an IRON SHORTSWORD and thirty IRON ARROWHEADS — two anvil batches, Weaponsmithing — plus a BRONZE CHAINBODY and a BRONZE TARGE, Armoursmithing. The forge gate opens when the furnace has ROARED and all four are MADE." },
  { q = "Why does all this matter?",
    a = "This is the whole economy in miniature: miner feeds smelter, smelter feeds smith, smith arms the fighter, whose drops feed thirty-five other trades. THIRTY-TWO tiers of metal out there, humble copper to Eternium. Master a craft and your quality climbs above other makers' — your goods even carry your name." },
  { q = "Where next, once I'm kitted?",
    a = function() chatnpc("To the terrace, the furnace, the anvil. Forge your four and wear them, then on to " .. tut_name("swim") .. " at the lagoon.") end },
}

on_npc("tut_smith", function()
  if tut_seen("smith") then
    if not tut_task_done("smith") then
      chatnpc("Not yet — " .. tut_task_label("smith") .. ".")
    else
      chatnpc("Kitted and forged — on to the lagoon with you.")
    end
    topic_menu(TOPICS, "Thanks — I'm off")
    return
  end
  chatnpc("This pickaxe is yours — and the first lesson's free: watch my hands. One load drawn, raked and fired true. That's the knack, and I've just put it in your arms — take the experience; the rest you earn stroke by stroke.")
  add_item("pickaxe_iron", 1)
  give_xp("Smelting", 550)
  give_xp("Ore-mining", 400)
  mes("Gift received: Iron pickaxe, 550 Smelting xp, 400 Ore-mining xp.")
  sfx("coins")
  topic_menu(TOPICS, "I'll get to work.")
  tut_complete("smith")
end)

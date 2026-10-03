-- Torra, the Carpenter — shafts, iron arrows, and the shortbow.
on_npc("tut_wood", function()
  if tut_seen("wood") then
    if not tut_task_done("wood") then
      chatnpc("Not yet — " .. tut_task_label("wood") .. ".")
    else
      chatnpc("Bow strung, quiver full — the kitchen's just ahead.")
    end
    return
  end
  chatnpc("Kia ora — both of you, if Kenji taught you right! First things first: stand your two selves SIDE BY SIDE and press X to MERGE back into one. Divided hands are grand for waiting on crops; fletching three hundred arrows wants your whole strength in one pair of arms.")
  choice("One of me again. What's here?")
  chatnpc("The woodcrafting camp — everything begins with LOGS, the ones you felled in the bush. At the sawmill you SAW logs into boards; at my bench you shape them further. Three skills live here: Sawing, Fletching and Carpentry. No gifts from me — you make your own kit from wood you cut.")
  choice("Walk me through the ladder.")
  chatnpc("FIRST: cut THREE HUNDRED ARROW SHAFTS at my bench — twenty logs, fifteen shafts a cut. By the last bundle your Fletching reaches LEVEL TWO, exactly what iron arrows demand. SECOND: bind THIRTY IRON ARROWS — two batches, each fifteen shafts, five of the vale's feathers and fifteen of " .. tut_name("smith") .. "'s iron heads. Your feathers and heads are the exact budget: nothing wasted.")
  choice("And the bow?")
  chatnpc("THIRD: carve a SHORTBOW from a couple of logs. That bow and those arrows are how you'll bring down the warden's koreke later, so make them well. Those pails you sawed back at " .. tut_name("bank") .. "'s camp will earn their keep soon — " .. tut_name("cook") .. " keeps cows, cows mean milk, milk means cheese. On you go!")
  choice("To the bench, then.")
  tut_complete("wood")
end)

-- Archivist Wren (Newhaven plaza, north) — the middle of the Harbour Ledger arc,
-- plus a standalone gather. She keeps the zone's names and numbers.
on_npc("nh_archivist", function()
  -- Harbour Ledger, stage 2: hand over the sealed tally.
  if quest.hl == 1 then
    chatnpc("Pell sent you? The harbour tally — sealed and true. Take it to him, and tell him the archive's numbers do not lie.")
    add_item("sealed_tally", 1)
    quest.hl = 2
    mes("Harbour Ledger (2/4): return the sealed tally to Dockmaster Pell.")
    return
  end
  if quest.hl == 2 then
    chatnpc("Back to Pell with that seal, if you please. I've copying to do.")
    return
  end

  -- Standalone: Room to Read (gather logs).
  if quest.ar_shelf == 0 then
    chatnpc("The archive grows and my shelves do not. Bring me fifteen logs and I'll set the joiner to building more.")
    if choice("I'll bring the wood.", "Some other time.") == 1 then
      quest.ar_shelf = 1
      mes("Quest started: Room to Read — bring 15 logs.")
    else
      chatnpc("Knowledge needs somewhere to sit, you know.")
    end
    return
  end
  if quest.ar_shelf == 1 then
    if count_item("logs") >= 15 then
      del_item("logs", 15)
      quest.ar_shelf = 2
      add_item("coins", 220)
      give_xp("Woodcutting", 200)
      quest_point(1)
      chatnpc("Splendid — a whole new bay of shelves. Here, for the sweat of it.")
      mes("Quest complete: Room to Read.")
    else
      chatnpc("Fifteen logs. The joiner is waiting, and so am I.")
    end
    return
  end

  chatnpc("Every name in the zone, written and safe. Come browse when you've learned to read.")
end)

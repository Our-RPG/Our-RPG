-- EVENT TRIGGER pillar (on_kill). Fires from killMonster() every time the player
-- fells a goblin. At five total goblin kills the grateful farmers pay a one-time
-- bounty — and hand over two odd trinkets that showcase the item / encounter /
-- cutscene hooks (a bone whistle and a memory stone). player.kills is bumped
-- BEFORE this fires, so kills("goblin") already counts the current kill.
on_kill("goblin", function()
  local n = kills("goblin")
  if n == 1 then
    mes("A goblin falls. Word travels: the north fields breathe a little easier.")
  end
  if n >= 5 and quest.goblin_bounty == 0 then
    quest.goblin_bounty = 1
    add_item("coins", 120)
    add_item("spirit_whistle", 1)
    add_item("memory_stone", 1)
    mes("Goblin bounty! Grateful farmers reward you: 120 coins, a bone whistle, and a smooth grey stone.")
  end
end)

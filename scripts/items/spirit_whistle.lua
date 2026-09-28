-- ITEM BEHAVIOUR + SCRIPTED ENCOUNTER pillars. Using the bone whistle (on_item)
-- calls up a goblin to test your mettle, a couple of tiles from where you stand.
-- spawn_monster() drops a live combatant into the world monster list.
on_item("spirit_whistle", function()
  mes("You blow the bone whistle. A shrill note rolls across the ground...")
  sfx("book")
  if spawn_monster("goblin", player_x() + 2, player_y()) then
    mes("A goblin answers the call!")
  else
    mes("...nothing answers. (No goblin could be summoned here.)")
  end
end)

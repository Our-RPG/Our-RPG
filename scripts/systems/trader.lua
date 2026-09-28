-- Trader interaction policy — runs when the player talks to any shopkeeper.
-- Owns the two gates that used to be hard-wired in talkTo(): the stink lock and
-- the night-closed check. If neither bars the way, open the shop.
on_role("trader", function()
  if stink_blocks_shops() then
    chatnpc("Faugh — you reek! Go wash before you set foot in my shop.")
    return
  end
  if shop_closed() then
    chatnpc("We're closed for the night. Come back in the morning.")
    return
  end
  open_shop()
end)

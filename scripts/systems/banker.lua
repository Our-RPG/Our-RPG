-- Banker interaction — runs when the player talks to any banker. If they already
-- hold an account on this bank network, open the vault; otherwise pitch a signup.
on_role("banker", function()
  if has_account() then
    open_bank()
  else
    chatnpc("Care to open an account with us? It comes with a welcome gift.")
    if choice("Open an account", "Not now") == 1 then
      bank_open_account()
      open_bank()
    else
      chatnpc("Very well — the offer stands whenever you're ready.")
    end
  end
end)

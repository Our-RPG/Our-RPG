-- Sigrid, the Navigator — three phases, picked fresh each visit (not a
-- quest.* stage): an EARLY host chat if the journey isn't done yet, an
-- INVITE to sleep once it is (one night at her spare room before the
-- crossing), and the real send-off the morning after. tut_journey_done()/
-- tut_slept() mirror gameplay/tutorial.js's frontier()/t.sleptAtSigrids —
-- she never gets a village bed of her own, so unlike every other tutor this
-- one is never "seen once and done"; it's state-driven every single talk.
on_npc("tut_ferry", function()
  -- phase 1: reached ahead of the journey's end (one open village shore
  -- makes the Harbour a one-minute stroll from the Landing on day one) —
  -- she hosts, and offers to skip the rest of the journey outright
  if not tut_journey_done() then
    chatnpc("Haere mai to the village, traveller! This shore is where the keepers lay their heads when the day's teaching is done — walk among the tents; you're welcome here any hour.")
    choice("How do I get to Newhaven?")
    chatnpc("No boat leaves Tūhura — I sing you there. My wayfinding song lifts you over the roof of the sky once every keeper on the path has sent you on, their lessons, tools and gifts yours along the way. But if you'd rather not wait, say the word and I'll sing you up right now: you'll land with empty hands, nothing learned, and no going back to finish what you skipped.")
    local r = choice("Skip ahead — sing me up now", "I'll earn it properly")
    if r == 1 then tut_graduate() end
    return
  end
  -- phase 2: journey done, night falling, hasn't slept yet — invite to her
  -- spare room (tut_sigrid_bed marks her "met" itself and starts the walk)
  if not tut_slept() then
    chatnpc("I'm " .. tut_name("ferry") .. ". I have sailed every sea you can dream of, and here's a navigator's secret: no hull sails OUT of Tūhura. For that there's my wayfinding song — a pillar of light to lift you over the roof of the sky and set you down in Newhaven, the great city at the centre of everything.")
    choice("What becomes of the isle?")
    chatnpc("Tūhura exists between the tides. The moment you rise, the mist takes it back — no chart, ship or portal will ever find it again. So take your time, and take every gift.")
    choice("I think I'm ready.")
    chatnpc("Not tonight, e hoa — a tired body has no business singing itself across the sky. I keep a spare room off my own; sleep there, and we'll talk come morning, clear-headed and ready for the crossing. Go on — I'll walk you down myself.")
    choice("Follow Sigrid to her spare room")
    tut_sigrid_bed()
    return
  end
  -- phase 3: morning after — the real send-off
  chatnpc("Slept well? Good — a clear head for a strange road. You'll climb until the isle is a coin on the sea, fall between worlds the whole night through, and drop out of a MORNING sky over Newhaven — the grand bank, the markets, the quest-givers and the thousand roads all waking beneath you.")
  choice("Then I'm ready. Sing it.")
  chatnpc("Stand ready, and I'll sing the light down.")
  local r = choice("Sing the song — send me up!", "I'll explore a little longer")
  tut_complete("ferry")
  if r == 1 then tut_graduate() end
end)

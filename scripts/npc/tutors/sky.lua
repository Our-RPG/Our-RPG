-- Ravenna, the Skywatcher — the semantic chat showcase, day/night, weather.
on_npc("tut_sky", function()
  if tut_seen("sky") then
    if not tut_task_done("sky") then
      chatnpc("Not yet — " .. tut_task_label("sky") .. ".")
    else
      chatnpc("You've heard me speak true — the hollow's just past my knoll.")
    end
    return
  end
  chatnpc("Before the sky, a wonder closer to hand. Everyone you've met on this isle — everyone in this whole world — can be SPOKEN WITH. Not clicked. Spoken with. Press ENTER, say anything in your own words, and we answer.")
  choice("What should I ask you?")
  chatnpc("Ask me what I love about my knoll. Ask about the rain that soaked you at the bank camp, or what I make of the Warden's slimes, or whether the stars go out. And understand what you hear: no script, no wheel of stock phrases, and no dream-machine inventing words nobody meant. Every answer is a thing a real soul once truly said, found because it fits YOUR words. Say something to me — and hear for yourself.")
  choice("Tell me about this sky, then.")
  add_item("coins", 30)
  mes("Gift received: 30 coins.")
  sfx("coins")
  chatnpc("Look up! Out in the wide world, day and night roll on REAL time — and the world's so wide it has TIMEZONES: every 256 tiles east is an hour ahead. Newhaven's clocks already read three hours ahead of ours.")
  choice("Does the whole world share one day?")
  chatnpc("This isle sits at an even 50% latitude — half day, half night. Sail far enough north or south and latitude changes the days themselves: polar summers where the sun never sets, winters where it barely rises. Here on Tūhura the sky turns as YOU learn — each keeper finished rolls the day forward. Stay the course and you'll earn the stars.")
  choice("What about the weather?")
  chatnpc("Weather fronts drift across the world like the real thing — watch the pressure fall before a storm on a barometer. Rain swells the rivers into flood; in the cold lands, snow settles white on every roof, then melts away. The wide chart is kept in Newhaven: press M once you've crossed for day/night bands and a synoptic chart. Until then, read the sky itself — it never lies for long. " .. tut_name("candle") .. " keeps the hollow just past my knoll.")
  choice("I'll go and really talk to you now.")
  tut_complete("sky")
end)

-- Kenji, the Farmhand — crops, milling, husbandry, and the split-selves lesson.
on_npc("tut_farm", function()
  if tut_seen("farm") then
    if not tut_task_done("farm") then
      chatnpc("Not yet — " .. tut_task_label("farm") .. ".")
    else
      chatnpc("A full harvest, both selves at work — well done. On to the benches.")
    end
    return
  end
  chatnpc("Welcome to the heart of the isle! My farm behind the fence has FIVE ROWS, five plots each — one row per crop: wheat, potatoes, apples, sageleaves, flax, all ripe and waiting. Take this hoe and TEN SEEDS of each, and step through the gate.")
  add_item("hoe", 1)
  add_item("seed_wheat", 10)
  add_item("seed_potato", 10)
  add_item("seed_apple", 10)
  add_item("seed_sageleaf", 10)
  add_item("seed_flax", 10)
  mes("Gift received: Hoe, 10x Wheat seed, 10x Potato seed, 10x Apple seed, 10x Sageleaf seed, 10x Flax seed.")
  sfx("coins")
  choice("What do you need picked?")
  chatnpc("Bring in TWENTY of each crop — a good picking of every row. And learn the marvel: crops grow in REAL time. REPLANT a row after you clear it — sowing takes five seeds, and most harvested crops drop one back — and it ripens again in minutes, whether you watch or wander.")
  choice("Is there more than crops here?")
  chatnpc("Grain becomes food at the MILLSTONE — mill TEN wheat into flour, bran and all, for baking up the path. Keep your flax too; it spins into linen for candle wicks. And livestock roam the pasture: TEND them for wool, milk, feathers and eggs.")
  choice("What should I tend?")
  chatnpc("Tend my QUAIL and hens for TEN eggs — save some for the fritters! — and TEN FEATHERS, the exact fletching budget for " .. tut_name("wood") .. "'s thirty arrows, so every feather counts. Watch for GIANT animals: one in six is born big and gives double. And that grey mountain in the pasture is a KURANUI, the biggest bird that ever walked — she minds her own business; you mind yours around her feet.")
  choice("This'll take a while to grow out.")
  chatnpc("Here's the vale's deepest secret, and my favourite: while the rows regrow, DON'T stand waiting. Press X and SPLIT into TWO SELVES — each with hands, a pack, a will. Leave one to reap, replant and mill, and walk the other wherever it's needed. Tab hops between them; your strength divides apart and flows back whole when you rejoin. Keep BOTH busy — that's my mark.")
  choice("Where would I send the other self?")
  chatnpc("My gift for the road: the little gate NE through my east arch is MY SHORTCUT, a straight lane from the bank chamber into " .. tut_name("wood") .. "'s camp. It unbars when my stage is done. Send your free self to wait there; when the last crop falls, both roads open — one self through the crown's south gate, one through the shortcut — and you meet at Torra's benches.")
  choice("Remind me of the whole list?")
  chatnpc("Twenty of each crop, ten flour milled, ten eggs and ten feathers, and both selves at work. Keep those pails handy — " .. tut_name("cook") .. " up the path keeps COWS, and once your Husbandry reaches THREE they'll fill every pail you carry. At dusk in a real town you'll see lamplighters set glowing candle-stands, gathered again by dawn. This world lives its own life.")
  choice("Two of me — let's get to it.")
  tut_complete("farm")
end)

# What koha funds

*Koha (Māori): a gift, given without obligation, that carries its own
mana — freely given, and freely able to be declined.*

Our RPG began with no server, no accounts, and no telemetry — and the game
still works exactly that way, offline, forever: the license guarantees it
keeps working regardless of who's paying for what (see
[Licensing](../README.md#licensing)). Nothing about the game is metered,
gated, or worse without support.

There is now one small piece of infrastructure: an optional server
(`server/`, GPL like everything else) that keeps cloud copies of saves,
counts the community's workshop votes, and publishes leaderboard
distributions. It costs on the order of **$5–30 a month**, and that number
is public — the server itself reports its real monthly cost and player
count at `/api/koha/transparency`, and the in-game keepers' letter quotes
it live. Anyone can also self-host it, which is the strongest form of the
"can never be taken from you" promise.

## What koha would actually go toward

- **The server bill.** The vault, the tallies, the lists — a few dollars a
  month, shown to the cent on the transparency endpoint. As the community
  grows, cost-per-player falls; the numbers tell that story themselves.
- **Cultural consultation.** Our RPG's identity draws on te ao Māori; doing
  that right at community scale means paying practitioners for guidance,
  review, and partnership — the most important koha line there is.
- **Generation credits.** New creatures, items and biome art are generated
  with [PixelLab](https://www.pixellab.ai), which is a metered API — every
  new sprite sheet this project ships costs real, small amounts of money.
- **Commissioned music**, when that path is chosen.
- **Time.** Writing, world-gen tuning, and reviewing the community's
  workshop proposals (see [GOVERNANCE.md](../GOVERNANCE.md)) are unpaid
  hours today. Support doesn't buy a different outcome, just more of it.

## What it would never go toward

- No paywalls, loot boxes, supporter cosmetics, or anything that changes
  what a non-paying player gets. The GPL-3.0/CC BY-SA license makes this a
  structural guarantee, not a promise: anyone could fork the project the
  moment that stopped being true, and keep every asset in it.
- No advertising, and no telemetry beyond what a player explicitly opts
  into (leaderboard XP sharing is opt-in, per player, reversible).
- No list of donors' names. If gratitude is shown at all, one community
  book records helpers of every kind — artists, coders, testers,
  moderators, donors — indistinguishably. The game remembers helpers, not
  payers.

## How the game mentions it

Once, after ten attentive hours of play, and then at most every forty: a
letter from the isle's keepers, by bird, never modal and never mid-action.
It quotes the live cost figure, says plainly that koha is welcome and never
expected, and offers a **"please never mention this again"** that is
honoured forever. That behaviour is code you can read
(`js/gameplay/koha.js`), not policy you have to trust.

## Is there a way to give right now?

Yes: **[ko-fi.com/taiao](https://ko-fi.com/taiao)**. It's a one-off or
recurring gift, not a purchase — nothing on it is exchanged for anything in
the game, which stays free either way. It's also linked from the README and
from `.github/FUNDING.yml`, so it shows up as a "Sponsor" button on the
GitHub repo too.

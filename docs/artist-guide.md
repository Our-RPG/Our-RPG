# Artist walkthrough: the object workshop

You don't need to touch a line of code to put art or ideas into Our RPG. This
walks through the whole loop, start to finish, for someone who's never
opened a repository before.

## 1. Find something to re-imagine

Almost every creature, item, building, tree and door in the game is
editable. Walk up to it in-game and right-click; you'll see **"Examine x"**
and, below it, **"Edit x"**. Click **Edit**.

That opens the **object workshop** — a panel showing every sprite the object
currently uses (all eight walking directions, for anything that walks), plus
whatever alternative art other players have already proposed and voted on.

## 2. Look at what's already there

Each object breaks its art into **variants** — a monster might have a
standard walk cycle, a "tended"/"spent" pose if it's a husbandry animal, and
a baby form. Each variant is its own little gallery of cards: the current
in-game art first, then any proposed sets, each with a vote button.

If you just think an existing proposal is right, vote for it — that's a
complete, valid contribution on its own. No art required.

## 3. Propose your own art

Every variant has an upload option. You can supply:

- **eight separate image files**, one per compass direction (south,
  south-east, east, north-east, north, north-west, west, south-west), or
- **one horizontal strip** of eight frames in that same order.

Match the object's existing frame size where you can — the panel shows it.
Sprites are pixel art rendered at a fixed on-screen size, so painterly
brushwork or heavy anti-aliasing tends to blur; flat colour with clean
1px-scale outlines reads best. If you want a starting point for style or
palette, the prompt files this project's own generated art was built from
are in `docs/*-sprite-prompt*.txt` and `docs/*-prompts.txt` — they're a
decent brief even if you're painting by hand instead of generating.

Below the art, most objects also have **votable properties** — a monster's
drop table (quantities and drop chances per item), a node's yield and
respawn time, a door's lock schedule, generation rules (which biomes it
spawns in, how rare it is, day/night or weather gating). Every poll has a
"suggest your own" option if none of the listed choices are right.

Everything you do here — uploads, votes, suggestions — saves to your
browser's local storage immediately. Nothing leaves your machine yet, and
none of it changes what you or anyone else sees in the actual game world
until a maintainer folds it in by hand.

## 4. Export your proposal

Happy with your changes to a particular object? Click **"Export my
proposal"** at the top of the panel. It downloads one file,
`our-rpg-proposal-<type>-<key>.json`, holding everything you did for that
object: your votes, your suggested properties, and your uploaded art
(embedded as image data, so the file is self-contained).

Export is per-object — if you've reworked three different creatures, export
each one separately and submit them as separate issues, so they can be
reviewed and merged independently.

## 5. Submit it

Open a new issue against the repo using the **Workshop proposal** template
and attach the exported file (see [CONTRIBUTING.md](../CONTRIBUTING.md) for
the exact steps and a fallback if your attachment gets rejected). Tell the
reviewer, in a sentence or two, what you were going for — the file has the
specifics, your note has the intent.

## 6. What happens next

A maintainer or curator looks at your proposal alongside whatever votes and
other proposals already exist for that object, and decides by hand whether
and how to fold it into the shipped game — there's no automatic "most votes
wins" pipeline yet (see [GOVERNANCE.md](../GOVERNANCE.md)). If your work
ships, it can carry your name in-game — say so in your issue, and how you'd
like it credited.

That's the whole loop: right-click, edit, export, open an issue. Everything
in between is yours to spend as much or as little time on as you like.

# Governance

Our RPG is, today, a single-maintainer project — decisions about what ships
are made by [@dataversion5372](https://github.com/dataversion5372), who
started it and keeps the lights on. This document says how that works now,
and how it's meant to change.

## Why this is written down at all

The [license](README.md#licensing) already guarantees the thing that matters
most: no one, including the maintainer, can ever close this project or take
it from the people who play and build it. If stewardship ever goes wrong —
the maintainer disappears, goes rogue, or just stops caring — anyone can
fork the repo and every asset in it, and carry on under the same terms. This
document is about the day-to-day of *this* fork, not that guarantee; the
guarantee stands regardless of anything below.

## How decisions get made today

- **Code and docs**: pull requests are reviewed and merged by the
  maintainer. There's no formal RFC process for a project this size — open
  an issue first for anything large or contentious, so the discussion
  happens before the work does.
- **In-game art and design**: proposals come in through the
  [object workshop](docs/artist-guide.md) as exported `.json` bundles,
  submitted as issues (see [CONTRIBUTING.md](CONTRIBUTING.md)). The
  maintainer reviews each one by hand against the votes already recorded for
  that object and decides whether, and how, to fold it into the shipped
  game. There is currently no automatic "most votes wins" pipeline — a
  human reads every proposal before anything ships, on the theory that a
  1-vote proposal that's simply *right* shouldn't lose to a 10-vote proposal
  that isn't.
- **Disputes**: if a proposal or PR is contested, the maintainer makes the
  call and says why in the issue thread. Reasoning is public; the code that
  results from it is public and forkable regardless.

## Becoming a curator

As proposals accumulate, reviewing all of them alone won't scale, and the
plan is to hand curation of specific areas — a creature family, a craft, a
biome — to people who've shown good judgement in that area's issues and
proposals over time. There's no formal application process yet; if you've
been submitting or reviewing proposals in a particular corner of the game
and want to take on more of it, say so in an issue.

## Changing this document

This file can change as the project and its contributor base grow — expect
it to, if a curator structure actually forms. Changes go through a normal
pull request, same as anything else, so the history of how governance
evolved stays in the repo alongside everything it governs.

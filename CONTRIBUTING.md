# Contributing to Our RPG

Our RPG is built to be forked, extended and argued with — that's what the
license is for (see [Licensing](README.md#licensing)). There are two roads
in: **code and docs**, and **in-game art and design**, via the object
workshop. Both end up as ordinary GitHub issues or pull requests.

## Code and docs

- Fork, branch, and open a pull request against `main`.
- The code layer is plain classic scripts, concatenated by
  `tools/bundle.list` — see [Building & hacking](README.md#building--hacking)
  in the README. Run `node tools/build.mjs` before you open a PR; it
  regenerates `dist/bundle.js`, which is checked in and must stay in sync
  with the source.
- A headless verification recipe lives in `.claude/skills/verify/` if you
  want to smoke-test a change without a browser session.
- Keep the game's own voice: comments explain *why*, not *what* — the code
  should read as plainly as the identifiers allow.
- By submitting code you agree it's licensed GPL-3.0-or-later, same as the
  rest of the codebase; original art or writing is CC BY-SA 4.0. Don't submit
  anything you don't hold the rights to relicense that way.

## In-game art and design — the workshop pipeline

Right-click almost anything in the world and choose **"Edit …"** to open the
**object workshop**: vote on how a creature, item or building should look or
behave, propose changes to its drop table, generation rules, or upload your
own sprite set. Everything you do there is saved locally first — it never
touches the shipped game by itself.

**Worn looks are a community project.** The game once auto-warped a single
generic armour decal onto every body — it looked bad and is parked. Instead,
the Edit panel for your character (and for any equippable item) now carries a
**"Worn look"** section per equipped piece: upload an 8-direction sprite set
of a character actually *wearing* the helm/chest/garment/weapon (name the
character in the label — worn art is per-body), and vote on the looks you
like. The parked auto-warp is shown alongside as the look to beat. Winning
sets get packed into real per-character outfit states, piece by piece, as
proposals come in.

When you have something you're happy with, click **"Export my proposal"**
in the workshop panel's header. That bundles your votes, suggestions and any
uploaded art for *that object* into a single `our-rpg-proposal-<type>-<key>.json`
file — nothing is sent anywhere; it's a local download, the same as a save
file.

To submit it:

1. Open a new issue using the **[Workshop proposal](../../issues/new?template=workshop_proposal.md)**
   template.
2. Attach the exported `.json` file. If your browser or GitHub won't let you
   attach it directly, paste its contents into a fenced code block instead
   (or rename it to `.txt` and attach that).
3. Say what you're proposing and why in a sentence or two — the file carries
   the specifics, the issue carries the pitch.

A maintainer or curator reviews it against the votes already on that object
and folds it into the shipped game by hand — sprite work, drop tables and
generation rules aren't yet auto-applied from the workshop, so a human reads
every proposal before anything ships. If you build something and it goes in,
it can carry your name in-game, the same way a crafted barrel carries its
cooper's — say so in the issue if you'd like that credit and how you'd like
it written.

If you'd rather talk something through first, or aren't sure whether an idea
fits, open a [Discussion](../../discussions) — that's the project's one
community channel, linked from the in-game **?** panel too.

See also the [artist walkthrough](docs/artist-guide.md) for a longer,
picture-by-picture version of the workshop flow, and
[GOVERNANCE.md](GOVERNANCE.md) for how proposals get reviewed and who does
the reviewing.

## Code of Conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Short version:
be someone people want to build a world with.

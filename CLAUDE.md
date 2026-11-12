# Funded: standing instructions for Claude

Read this at the start of every session. The full design spec is `docs/HANDOFF.md`, and it is the source of truth for game decisions.

## Owner's instructions

- **Merging:** open PRs and **squash-merge them yourself** (or auto-merge) when the work is done and checks pass. No need to ask first.
- **Ask when unsure.** If a design or product decision isn't settled in `docs/HANDOFF.md` or here, ask the owner rather than guessing. Pick obvious defaults yourself and mention them.
- **Assets:** only these sources may be used:
  - **Blender**: the hosted project linked in `docs/HANDOFF.md` §11, or new Blender work.
  - **ElevenLabs** for sound and voice. **Always quote the cost and get approval before generating.**
  - **CC0** assets.
  - **CC BY** assets, **with attribution** added to `CREDITS.md` (title, author, source URL, licence).
  - Nothing else: no unlicensed or "free for personal use" assets.
- The owner works mostly **from a phone** through the GitHub web UI. Keep files simple and easy to edit there, and keep tuning numbers in `js/config.js` and screen positions in the CSS variables at the top of `css/style.css`.

## Locked technical rules (from the handoff)

- Plain HTML, CSS and vanilla JS ES modules. **No build step, no framework, no npm.**
- Portrait 9:16 frame sized with `dvh`, type in `cqw`, and everything positioned by **percentage** (final renders will replace the blockouts).
- Keep game logic (`js/engine.js`, `js/rules.js`) pure and separate from rendering. Tests: `node --test tests/*.test.js`.
- **Colour:** keep clay `#D97757` off the monitors. On the monitors use only green `#2FBF71`, red `#E5484D`, ivory and lilac `#B48CE8` (amber only on the rule meters). Never rely on colour alone: every P&L carries a sign and a ▲/▼ arrow.
- Deploys via GitHub Pages from `main` root to `funded.longlight.games` (`CNAME`).
- Each build stage must be playable on its own (see `docs/HANDOFF.md` §8).

## Progress

- Stages 1–2 done (PR #1), plus the in-memory five-day eval.
- Next: **stage 3**, saving run state to localStorage, including mid-day resume.
- Update this section when a stage lands.

## Verifying changes

Serve with `python3 -m http.server`, open `/?speed=10`, and check with Playwright at a 380×760 phone viewport and at a desktop size before merging.

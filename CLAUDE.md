# Funded: standing instructions for Claude

Read this at the start of every session. The full design spec is `docs/HANDOFF.md`, and it is the source of truth for game decisions.

## Owner's instructions

- **Merging:** open PRs and **squash-merge them yourself** (or auto-merge) when the work is done and checks pass. No need to ask first.
- **Ask when unsure.** If a design or product decision isn't settled in `docs/HANDOFF.md` or here, ask the owner rather than guessing. Pick obvious defaults yourself and mention them.
- **Assets:** only these sources may be used:
  - **Blender, run locally and headless** in the session container (install it if missing: Blender 4.2 LTS from download.blender.org, Cycles on the CPU). Scenes are Python build scripts in `art/`, and renders are pulled from there.
  - **ElevenLabs**, mostly for audio. **Always quote the cost and get approval before generating.**
  - **CC0** assets.
  - **CC BY** assets, **with attribution** added to `CREDITS.md` (title, author, source URL, licence).
  - **No Higgsfield**, of any kind. Nothing else either: no unlicensed or "free for personal use" assets.
- **Helpers:** up to **2** helper agents at a time, each either Opus 5.5 at medium effort or Sonnet 5.5 at high effort, at Claude's discretion.
- The owner works mostly **from a phone** through the GitHub web UI. Keep files simple and easy to edit there, and keep tuning numbers in `js/config.js` and screen positions in the CSS variables at the top of `css/style.css`.

## Art

- `assets/desk.png` and `assets/wide.png` started as Blender blockouts. The scene is being rebuilt as a local, reproducible script, `art/build_scene.py`. See `art/README.md`.
- Keep the camera and screen contract fixed so the percentage-based overlays line up: 9:16 renders, `CAM_main` 35mm at (0, −1.02, 1.17) looking +Y, `CAM_wide` 30mm at (0, −2.85, 1.70) with rotation (1.466, 0, −0.025), and screens of 0.54×0.32 m centred at (0, 0.18, 1.36) and (0, 0.18, 0.98).
- Measured screen rectangles (% of frame, left/right/top/bottom): CAM_main top 11/89/21.6/47.6, bottom 11/89/52.4/78.4. CAM_wide top 33.0/59.4/46.2/54.9, bottom 33.2/59.3/56.4/65.0. Intro zoom: scale 3, origin 44.3% 58.4%.
- Outstanding art: listed in `docs/HANDOFF.md` §11 (ignore its Higgsfield link).

## Locked technical rules (from the handoff)

- Plain HTML, CSS and vanilla JS ES modules. **No build step, no framework, no npm.**
- Portrait 9:16 frame sized with `dvh`, type in `cqw`, and everything positioned by **percentage** (final renders will replace the blockouts).
- Keep game logic (`js/engine.js`, `js/rules.js`) pure and separate from rendering. Tests: `node --test tests/*.test.js`.
- **Colour:** keep clay `#D97757` off the monitors. On the monitors use only green `#2FBF71`, red `#E5484D`, ivory and lilac `#B48CE8` (amber only on the rule meters). Never rely on colour alone: every P&L carries a sign and a ▲/▼ arrow.
- Deploys via GitHub Pages from `main` root to `funded.longlight.games` (`CNAME`).
- Each build stage must be playable on its own (see `docs/HANDOFF.md` §8).

## Progress

- Stages 1–2 done (PR #1), plus the five-day eval.
- Stage 3 done: run state saves to localStorage (`js/save.js`), and a mid-day reload resumes paused at the same moment. A firing clears the save.
- Stage 4 done: Reputation (`js/meta.js`, 10 per day survived + 1 per $50 of the best green day + 50 for a pass), a perk shop with the handoff's four perks (Thick Skin 60, Newswire 80, Level 2 120, Mulligan 150, all one-time buys applied from the next eval), and the guided training day (`js/tutorial.js`), which runs first and can be replayed from the title.
- Next: **stage 5**, the futures tier. Its arcade design is still open (handoff §12), so ask the owner first.
- Update this section when a stage lands.

## Verifying changes

Serve with `python3 -m http.server`, open `/?speed=10`, and check with Playwright at a 380×760 phone viewport and at a desktop size before merging.

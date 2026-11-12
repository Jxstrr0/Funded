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

- `assets/desk.jpg` and `assets/wide.jpg` are rendered from `art/build_scene.py` (local headless Blender, fully procedural, about 22 minutes for both at 192 samples). Renders go to `art/out/` (git-ignored); convert to JPG with `ffmpeg -i art/out/desk.png -q:v 3 assets/desk.jpg`. See `art/README.md`.
- Keep the camera and screen contract fixed so the percentage-based overlays line up: 9:16 renders, `CAM_main` 35mm at (0, −1.02, 1.17) looking +Y, `CAM_wide` 30mm at (0, −2.85, 1.70) with rotation (1.466, 0, −0.025), and screens of 0.54×0.32 m centred at (0, 0.18, 1.36) and (0, 0.18, 0.98).
- Measured screen rectangles (% of frame, left/right/top/bottom): CAM_main top 11/89/21.6/47.6, bottom 11/89/52.4/78.4. CAM_wide top 33.0/59.4/46.2/54.9, bottom 33.2/59.3/56.4/65.0. Intro zoom: scale 3, origin 44.3% 58.4%.
- Time-of-day desks: `--tod am|pm` renders `desk-am.jpg` / `desk-pm.jpg` and the same for `-tier2` and `-tier3` (cool morning, warm late afternoon; lights, sky, glass and city only). `mid` keeps the plain names; tier3 `mid` is now daytime and its `pm` is the old dusk. Not for `fired`. See `art/README.md`.
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
- Stage 5 done: the futures tier (`TIER2` in `js/config.js`). The owner approved the design: a $50k account, one fictional contract (`MRX`, 0.25 ticks at $12.50, so $50 a point), whole contracts with sizes 1 / 2 / MAX (6), and rules scaled from Tier 1 (+$3,000 target, −$1,500 daily, $3,000 trailing, floor locks at $50k). At MAX the daily limit goes in about a 0.5% move (Tier 1: about 0.9%). A career climbs the ladder: passing Tier 1 promotes you straight into a Tier 2 eval (saved, with perks carried and a fresh Mulligan), and a firing at any tier sends the next career back to Tier 1.
- Audio done (part of stage 7): ElevenLabs sound effects, ambience and menu music in `assets/audio/` (`js/audio.js`, volumes in `AUDIO` in config). About 1,400 of the approved 6,000 credits were spent.
- Stage 6 done: the options tier (`TIER3` in `js/config.js`, pricing in `js/options.js`). The owner approved the design: $100k account (+$6,000 target, −$3,000 daily, $6,000 trailing). One stock a day and one strike, at the money at the open, expiring at 16:00. CALL / PUT / CLOSE buttons, one side at a time, whole contracts sized as 25% / 50% / MAX of a $2,000 premium budget (cap 40). Premiums are Black-Scholes, so they decay through the day. Every day has one earnings release: IV climbs toward it (1.9x to 2.6x the day's base), then is crushed to 0.7x. Earnings moves are 2–3.5% of the price, other news 0.8–1.8%. Passing Tier 2 promotes to Tier 3.
- Stage 7 done (polish): `js/fx.js` adds card transitions, stamp headlines, fill tints, floating realized P&L, a counting balance, monitor flashes (bell, fired, pass), a red edge pulse when a rule meter passes 80%, a target-meter pop, and haptics, all toned down for reduced motion. The desk changes with the career: `backdrop` in each tier (`desk.jpg` back row, `desk-tier2.jpg` mid-floor, `desk-tier3.jpg` window seat) and `STUDIO.firedBackdrop` (`desk-fired.jpg`, the cardboard box), rendered with `art/build_scene.py --variant`. The title links to the hub at `STUDIO.hubUrl` (assumed https://longlight.games). The link from the hub to the game must be added in the hub's own repo, which this session can't reach.
- Roguelike layer done (owner approved): **edges** (`EDGES` in config, `js/edges.js`): after every day survived and on each promotion you pick 1 of 3 seeded random cards, kept for the career and lost when fired (Rewind, Hot Hand, Stop Discipline, Tape Reader, Risk Desk Friend, Short Week, Coffee, Whisper, Rainmaker, Theta Shield on options only; Rewind, Whisper and Tape Reader are rare). **Mandates** (`MANDATES`): optional handicaps chosen before each career once a run has been finished (No Flatten +20%, Tight Leash +30%, Blind News +25%, Max Only +15% Rep, bonuses add; Rainmaker multiplies). Four new shop perks: Pre-market 70, Reroll 90, Analyst 100 (4 choices), Head Start 140. Rewind beats Mulligan when both are available.
- Balance pass (owner asked): `node tools/balance.mjs` has a bot play thousands of evals per edge and mandate. It found Tape Reader far too strong (pass rate 8% to 57%), Hot Hand a trap (a bigger MAX against the same limit got players fired more), and Max Only free Rep for MAX players. Now: Tape Reader is rare with a 1.5 s lead, Hot Hand grows sizes and the loss limit 20% after a green day, Short Week cuts the target 12%, Max Only pays +15%. Note: a careful bot (50% size, with a stop) almost never reaches the target in 5 days; the base game favours MAX play.
- Time of day: each tier desk has `-am` and `-pm` renders (`--tod` in `art/build_scene.py`). The morning layer fades out by about noon and the golden closing light fades in toward the bell (`TIME_OF_DAY` in config, `setTimeOfDay` in `js/fx.js`). Tier 3's plain desk is now daytime; its old dusk look is `desk-tier3-pm.jpg`.
- Next: nothing scheduled. Open items: Daily Challenge (handoff §12) and the outstanding art list in handoff §11.
- Update this section when a stage lands.

## Security and privacy (studio baseline)

- **Name:** use the name Kelbo only. Never his real name, initials or email, anywhere in the repo: files, commit messages, PR text.
- **Commits:** author them as `Jxstrr0 <322161611+Jxstrr0@users.noreply.github.com>` or `Claude <noreply@anthropic.com>`, never a personal email address.
- **No secrets.** The repo is public: no keys, tokens or passwords in any file or commit.
- **Storage:** localStorage keys start `funded.` (`funded.run.v1`, `funded.meta.v1`, `funded.audio.v1`), every access in try/catch. Never `localStorage.clear()`, and never touch another game's keys.
- **Content-Security-Policy:** `index.html` has a CSP meta tag that lets the page load only its own files. If the game ever needs something from another address, add that address to the tag in the same PR, or the browser will block it. No outside scripts, fonts or CDNs: Space Grotesk is self-hosted in `assets/fonts/` (SIL OFL 1.1, copied from the studio site with the owner's OK).
- **Page text:** `innerHTML` only ever gets the game's own strings and numbers. Anything a player could type or paste (a future save code, a name) goes in with `textContent` or through `esc()` in `js/ui.js`.
- The studio's security cycle (the `longlight-security-cycle` skill in `Jxstrr0/longlight-assets`) scans this repo with the others.

## Verifying changes

Serve with `python3 -m http.server`, open `/?speed=10`, and check with Playwright at a 380×760 phone viewport and at a desktop size before merging.

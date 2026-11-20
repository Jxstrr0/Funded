# Funded: standing instructions for Claude

Read this at the start of every session. The full design spec is `docs/HANDOFF.md`, and it is the source of truth for game decisions.

## Owner's instructions

- **Merging:** open PRs and **squash-merge them yourself** (or auto-merge) when the work is done and checks pass. No need to ask first.
- **Never push straight to `main`.** Work on a branch; `main` only changes by merging a pull request on GitHub after `node --test tests/*.test.js` passes. Never delete or skip a test to get to green.
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
- Pass desks (`--funded`), rain days (`--weather rain`), the intro move (`--dolly` → `assets/intro.mp4`, 2.5 s, end frames match `wide.jpg` and `desk.jpg`), edge props and card art (`art/build_props.py`) and the desk mouse (`build_props.py --mouse`) are all documented in `art/README.md`. The tier1 room opens onto the city (`--old-room` brings back the closed back row).
- Outstanding art: none (`docs/HANDOFF.md` §11).

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
- Stage 6 done: the options tier (`TIER3` in `js/config.js`, pricing in `js/options.js`). The owner approved the design: $100k account (+$5,000 target since 0.9.0.4, was +$6,000; −$3,000 daily, $6,000 trailing). One stock a day and one strike, at the money at the open, expiring at 16:00. CALL / PUT / CLOSE buttons, one side at a time, whole contracts sized as 25% / 50% / MAX of a $2,000 premium budget (cap 40). Premiums are Black-Scholes, so they decay through the day. Every day has one earnings release: IV climbs toward it (1.9x to 2.6x the day's base), then is crushed to 0.7x. Earnings moves are 2–3.5% of the price, other news 0.8–1.8%. Passing Tier 2 promotes to Tier 3.
- Stage 7 done (polish): `js/fx.js` adds card transitions, stamp headlines, fill tints, floating realized P&L, a counting balance, monitor flashes (bell, fired, pass), a red edge pulse when a rule meter passes 80%, a target-meter pop, and haptics, all toned down for reduced motion. The desk changes with the career: `backdrop` in each tier (`desk.jpg` back row, `desk-tier2.jpg` mid-floor, `desk-tier3.jpg` window seat) and `STUDIO.firedBackdrop` (`desk-fired.jpg`, the cardboard box), rendered with `art/build_scene.py --variant`. The title links to the hub at `STUDIO.hubUrl` (https://longlight.games). The hub links back: Funded has a card on its Games page and its own page, `game-funded.html` (Kelbo.Website #303, 2026-11-12).
- Roguelike layer done (owner approved): **edges** (`EDGES` in config, `js/edges.js`): after every day survived and on each promotion you pick 1 of 3 seeded random cards, kept for the career and lost when fired (Rewind, Hot Hand, Stop Discipline, Tape Reader, Risk Desk Friend, Short Week, Coffee, Whisper, Rainmaker, Theta Shield on options only; Rewind, Whisper and Tape Reader are rare). **Mandates** (`MANDATES`): optional handicaps chosen before each career once a run has been finished (No Flatten +20%, Tight Leash +30%, Blind News +25%, Max Only +15% Rep, bonuses add; Rainmaker multiplies). Four new shop perks: Pre-market 70, Reroll 90, Analyst 100 (4 choices), Head Start 140. Rewind beats Mulligan when both are available.
- Balance pass (owner asked): `node tools/balance.mjs` has a bot play thousands of evals per edge and mandate. It found Tape Reader far too strong (pass rate 8% to 57%), Hot Hand a trap (a bigger MAX against the same limit got players fired more), and Max Only free Rep for MAX players. Now: Tape Reader is rare with a 1 s lead, Hot Hand grows sizes and the loss limit 20% after a green day, Short Week cuts the target 12%, Max Only pays +15%.
- Time of day: each tier desk has `-am` and `-pm` renders (`--tod` in `art/build_scene.py`). The morning layer fades out by about noon and the golden closing light fades in toward the bell (`TIME_OF_DAY` in config, `setTimeOfDay` in `js/fx.js`). Tier 3's plain desk is now daytime; its old dusk look is `desk-tier3-pm.jpg`.
- Card sounds: deal, pick, rare shimmer, reroll shuffle, mandate stamp and shop purchase (ElevenLabs, about 207 credits of a 1,000 cap the owner approved for this).
- Careful-play check: `node tools/levers.mjs` tries one tuning change at a time (target, news count, follow-through, jump size, eval days) for a careful and an aggressive bot. Shared bot code is in `tools/sim.mjs`.
- Stronger news (owner chose it so careful play is viable): `ENGINE.news` now gives 2–4 headlines a day (was 1–3) with a longer follow-through (0.6–1.2 of the jump, was 0.35–0.9). Bot pass rates, careful / aggressive: Tier 1 33% / 50% (was 7% / 35%), Tier 2 19% / 24% (was 6% / 22%). A tier can override these with its own `news` (Tier 3 keeps 1–3 headlines; since 0.9.0.4 it has the longer follow-through). Tape Reader's lead dropped to 1 s because more headlines made it too strong.
- Art pass (owner chose concepts A–F):
  - **Edge props:** each edge card's prop appears on the desk while the career holds it (`EDGE_PROPS` in config, `setDeskProps` in `js/fx.js`), and each card has rendered art (`assets/cards/`).
  - **Pass desk:** passing an eval shows the FUNDED desk (`desk[-tierN]-funded.jpg`).
  - **Rain days:** about 1 day in 5 (`WEATHER.rainChance`, seeded per day) uses the tier's `rainBackdrop`, with rain audio (`AUDIO.rain`, ElevenLabs) and moving streaks over the window glass (`WEATHER.streaks`, `--rain-strength` and `--rain-fall` in the CSS). The streaks are off under reduced motion.
  - **Intro:** the rendered intro move plays on start (tap skips; the CSS zoom is the fallback and runs under reduced motion).
  - **City:** the Tier 1 room now opens onto the city.
  - **Clicker** (`js/clicker.js`, `CLICKER` in config): on touch, a pointer glides to the button you tap and clicks it. On every input the desk mouse slides a little the same way. It is a plate and mouse crop (`assets/mouse/`) and is hidden on the funded, fired and rain desks.
  - This pass spent about 413 ElevenLabs credits.
- Polish pass (0.9.0.2, owner asked): favicon, home-screen icons and web manifest (`manifest.webmanifest`), link-preview tags with `assets/og.jpg` (all made by `node tools/icons.mjs` from the wordmark and `wide.jpg`). Keyboard: browser shortcuts (Ctrl/Cmd/Alt) never trade, keys are ignored behind a card, the pause button and cover work with Enter/Space, and any key skips the intro. Screen readers: cards are a modal dialog with the monitors `inert` behind them, and `ui.announce()` reads fills, realized P&L, news, the bell and the 80% rule warning. P&L pops stack instead of overlapping, chart labels give way to the last-price tag and news markers, and rain days now have the moving desk mouse (`-rain` layers).
- Offline, stats and load pass (0.9.0.3, owner asked):
  - **Offline play:** `sw.js` (registered as `sw.js?v=<VERSION>`, so each release installs fresh and clears the old cache). Code comes from the network first, falling back to the saved copy after 4 s. Art, sound and fonts come from the saved copy first. `CORE` in `sw.js` is saved at install: everything a Tier 1 career needs. A career reaching Tier 2 or 3 asks it to save that tier's desks (`warmTier` in `js/main.js`). `tests/sw.test.js` checks the `CORE` list. When you add a file the game needs at Tier 1, add it to `CORE` too.
  - **Career stats:** a card off the title (`meta.stats`, pure functions in `js/meta.js`) with these stats:
    - careers
    - passes per tier
    - fired and not funded
    - highest tier reached
    - days traded and the share that were green
    - best day
    - longest career (days across promotions)
    - favourite edge
    - Rep earned

    Counting starts at 0.9.0.3, and older saves are marked partial.
  - **First load:**
    - `modulepreload` for every script.
    - The title waits only for `wide.jpg`. The desk, the intro clip and the service worker load after it.
    - Audio loads in this order: effects, then menu music, then the day loops.
    - On a throttled 1.6 Mbps phone connection, time to the title went from 4.0 s to 2.5 s.
  - **Tier 3 bot:** `tools/sim.mjs` and `tools/balance.mjs` now cover options (`node tools/balance.mjs [N] [tiers]`). Measured pass rates, careful / aggressive:
    - Tier 3: 2.6% / 25.6%, against Tier 2 at 19% / 24%.
    - Almost no one is fired; the misses are the +$6,000 target.
    - Theta Shield measures as a net negative.
    - No tuning has changed yet; the owner decides.
- Tier 3 tuning (0.9.0.4, owner chose):
  - Options days get the longer news follow-through (0.6–1.2 of the jump, still 1–3 headlines).
  - The target drops to +$5,000.
  - Theta Shield now prices options 15% cheaper: lower implied volatility (`ivScale` 0.85), the same price to buy and to sell, so nothing can be farmed.
  - Risk is unchanged ($2,000 premium budget, −$3,000 daily).
  - Bot pass rates, careful / aggressive: Tier 3 17.5% / 50.8% (was 2.6% / 25.6%). Theta Shield is worth +3 / +8 points (was −5 to −6).
  - `ENGINE.version` went to 3, so a day saved mid-session (any tier) restarts from its open.
- Visit counts: a cookieless Cloudflare Web Analytics beacon at the end of `index.html` (owner's request, 2026-11-12), with Funded's own Web Analytics site in Cloudflare (`funded.longlight.games`, since 2026-11-18: the token first used, the zone-wide site's, was refused for this address, so no visits were counted before then).
- Save safety (security test, 2026-11-20): `loadRun` passes every save through `tidySave` (`js/save.js`), and `loadMeta` does the same for the career record. Edges, mandates and perks the game doesn't have are dropped, and a day in progress whose clock the game couldn't have saved restarts from its open. A hand-broken save could freeze the game before. A new list of ids in a save needs a line there. Tests: `tests/save.test.js`.
- Version: `VERSION` in `js/config.js` (four numbers, Major.Minor.Patch.Build, now 0.10.0.1), shown small on the title screen. Bump it in any PR that changes what players see. When it changes on `main`, `.github/workflows/publish-release.yml` publishes a GitHub Release titled from the PR, which longlight.games reads for the version and "what's new" line.
- Update pass (0.10.0.0, owner chose all of it):
  - **Daily Challenge** (`js/daily.js`, `DAILY` in config): one seeded day for everyone, numbered from 2026-11-16. The tier rotates by date (Tier 1, 2, 3), with 2 fixed edges (`DAILY_SKIP_EDGES` and cursed edges are left out) and a par. The first try is scored (Rep, streak, share text with ▲/▼ squares via the share sheet or clipboard); replays are practice. It saves apart from the career in `funded.daily.v1`.
  - **Funded phase** (`FUNDED`, `fundedRules`/`startFunded` in `js/rules.js`): passing Tier 3 gives a funded $100k options account with no target. Every 5 days, 80% of the week's profit is paid out as Rep and the account resets; a red week carries over. It runs until you're fired.
  - **Day types** (`DAY_TYPES`, `dayTypeFor` in `js/engine.js`): about 1 day in 4 is a Gap open, Fed day (one 14:00 headline), Trend day (fewer headlines, steady drift) or Trading halt (15 minutes frozen, then a reopening jump, both within the shock cap). Shown on the day-open card. `ENGINE.version` is 4.
  - **End-of-day review:** every result card has "Review the day": the chart marks each fill and labels each closed trade's P&L.
  - **Achievements** (`ACHIEVEMENTS`, 11) on the stats card; some unlock new edges for the draft.
  - **New edges:** Insurance (refunds 25% of a red day; unlocked by 5 Dailies), Bell Clerk (closes your position at the bell; unlocked by passing Tier 2), Iron Stomach (drawdown ×1.25), Bigger Book (+2 contracts, futures), Deep Pockets (premium budget ×1.25, options), and the cursed Leverage Loan (sizes ×1.4, daily limit ×0.85; unlocked by getting funded). Each has a desk prop and card art.
  - **Balance:** Tier 3 MAX now carries real risk (premium budget $3,500, target +$7,500); Tier 2 daily limit $1,800.
  - **Guides:** "Guides" on the title replays training and explains futures, options and day types with worked examples; Tier 2 and Tier 3 show their guide on the first visit.
- Daily date guard (0.10.0.1, studio stress test, 2026-11-20): with the phone's date before Daily #1 the title offered "Daily Challenge #-20772". `dailyOpen` (`js/daily.js`) now says whether a date has a Daily; before the first one the title button reads "check your date" and opens a card that says so. Found with the date set wrong on a local copy; two tabs, tiny screens and random taps found nothing else here.
- Next: no open items in handoff §12; ask the owner.
- Update this section when a stage lands.

## Security and privacy (studio baseline)

- **Name:** use the name Kelbo only. Never his real name, initials or email, anywhere in the repo: files, commit messages, PR text.
- **Commits:** author them as `Jxstrr0 <322161611+Jxstrr0@users.noreply.github.com>` or `Claude <noreply@anthropic.com>`, never a personal email address.
- **No secrets.** The repo is public: no keys, tokens or passwords in any file or commit.
- **Storage:** localStorage keys start `funded.` (`funded.run.v1`, `funded.meta.v1`, `funded.audio.v1`, `funded.daily.v1`), every access in try/catch. Never `localStorage.clear()`, and never touch another game's keys.
- **Content-Security-Policy:** `index.html` has a CSP meta tag that lets the page load only its own files. If the game ever needs something from another address, add that address to the tag in the same PR, or the browser will block it. The one outside script is Cloudflare's cookieless visit counter (`static.cloudflareinsights.com` in `script-src`, `cloudflareinsights.com` in `connect-src`; owner's request, 2026-11-12). No other outside scripts, fonts or CDNs: Space Grotesk is self-hosted in `assets/fonts/` (SIL OFL 1.1, copied from the studio site with the owner's OK).
- **Page text:** `innerHTML` only ever gets the game's own strings and numbers. Anything a player could type or paste (a future save code, a name) goes in with `textContent` or through `esc()` in `js/ui.js`.
- The studio's security cycle (the `longlight-security-cycle` skill in `Jxstrr0/longlight-assets`) scans this repo with the others.

## Verifying changes

Serve with `python3 -m http.server`, open `/?speed=10`, and check with Playwright at a 380×760 phone viewport and at a desktop size before merging.

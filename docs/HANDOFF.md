# Funded: Code Session Handoff

A roguelike prop-firm trading game for the browser. You start with a funded eval account, trade a fast simulated market, and pass the firm's rules to climb a career ladder. Break a rule and you're fired, keeping only the permanent perks you've unlocked.

Studio: Longlight Interactive. Owner GitHub: `Jxstrr0`. The owner works mostly from a phone, so keep the project simple to edit through the GitHub web UI.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Title | **Funded** |
| Repo | `funded` (own repo, GitHub Pages) |
| Address | `funded.longlight.games` |
| Platform | **Portrait phone first.** Desktop shows the same portrait frame centred, letterboxed. |
| Feel | **Arcade-fast and punchy.** Readable, slightly exaggerated, no slippage or commissions. |
| Rule harshness | **Tough but fair** |
| Trading day | **3 minutes real time** = one market session |
| Candles | **5-minute candles**, 78 per day, on a fixed full-session axis |
| Eval length | **5 trading days**, ending early once the target and minimum days are met |
| Sizing | Sizes are a **share of buying power**, which is **3.33x** the day's starting balance |
| News | Upcoming news is **marked on the clock**, and shock size is **capped** against the daily loss limit |
| Controls | Chart **and** buy/sell controls live **on the in-game monitors** |
| Onboarding | **A short guided first day** |
| Stack | Plain HTML, CSS, vanilla JS (ES modules). **No build step, no framework, no npm.** |
| Saving | `localStorage` (works normally on GitHub Pages) |
| Art | Pre-rendered Blender backdrops with the game UI drawn over the monitor screens |

---

## 2. Brand

- Font: **Space Grotesk** (Google Fonts), with a system sans-serif fallback.
- Palette:
  - clay `#D97757`
  - purple `#7B3FC4`
  - slate (near-black) `#141413`
  - ivory `#FAF9F5`
  - lilac `#B48CE8`
- Dark surfaces: background `#141413`, surface `#1C1B19`, card `#1F1E1B`, light clay text `#E8967A`, focus/links lilac `#B48CE8`.
- In-game trading colours are separate from brand: up/green `#2FBF71`, down/red `#E5484D`.

### Colour rules

- **Keep clay off the monitors.** It sits too close to sell red on a small screen. Use clay for the brand accent on menus, summaries, and the fired and pass screens.
- On the monitors use only green, red, neutral ivory text, and lilac for focus and the selected size.
- **Never rely on colour alone.** Every P&L and price change carries a `+` or `−` sign and a ▲ or ▼ arrow. Each rule meter shows a number as well as its colour.

---

## 3. Core loop (one trading day)

1. The day opens. A 3-minute timer represents 9:30 to 16:00 (390 market minutes). The day is 78 five-minute candles, each lasting about 2.3 real seconds.
2. Price ticks on a live candlestick chart. The player buys, sells, or flattens.
3. News arrives at moments marked on the clock in advance, and moves the price.
4. **At the closing bell, any open position is a rule break: fired.** Show a visible countdown in the last 20 seconds (pulse the clock, warning tone).
5. End-of-day summary: P&L, rule meters, days remaining.

### Firm rules for Tier 1 (defaults, keep them in one config object for tuning)

| Rule | Default |
|---|---|
| Starting balance | $25,000 |
| Profit target to pass | +$1,500 (6%) |
| Daily loss limit | −$750 (3%) from the day's starting balance, counting open P&L |
| Trailing max drawdown | $1,500 below the highest end-of-day balance, checked live (see below) |
| Minimum trading days | 3 (can't pass before day 3, and a day counts only if at least one trade was made) |
| Eval length | Up to 5 days (see "Passing" below) |
| Flat at the bell | Mandatory |

Breaking any rule ends the run immediately with a "You're fired" screen naming the rule.

### Trailing drawdown

- The floor is the highest end-of-day balance minus $1,500. It starts at $23,500.
- It is **checked live against equity** (balance plus open P&L), on every tick. Equity touching the floor is a rule break.
- The floor only moves at the end of a day, and only upward.
- **The floor locks at the starting balance.** Once it reaches $25,000 it stops rising.

### Passing

- The pass check runs **at the end of each day**, after the bell.
- The eval **ends early with a pass** as soon as the end-of-day balance is at or above the target and at least 3 trading days have counted.
- If the target is reached before day 3, the player must keep it (and keep trading at least once a day) until day 3 closes.
- Pass = target reached by the end of day 5 with no rule broken.

### Orders (arcade)

- Market orders only in Tier 1. Fill at the current tick price, no slippage, no commission.
- **Buying power = 3.33x the day's starting balance** ($83,250 on day 1 of Tier 1). Keep the multiplier in the config.
- Size buttons: **25% / 50% / Max** of buying power, converted to whole shares at the current price (round down).
- The net position can never exceed buying power. A press that would go over fills only up to the cap.
- Buttons: **BUY**, **SELL** (short allowed), **FLATTEN**. Selling more than the long position reverses to short, and the same in the other direction.
- Show one net position (long or short, size, average price, open P&L).
- For tuning: at Max size, the daily loss limit is hit by an adverse move of about 0.9%.

### Pausing

- The game **auto-pauses when the tab is hidden** (`visibilitychange`), so a phone lock or app switch never causes a firing.
- While paused, the chart is covered by a "Paused" panel so the pause can't be used to study the market. Resume with a tap.
- Drive the market clock from accumulated elapsed time (`performance.now()` deltas while running), not from counting timer callbacks.

---

## 4. Price engine

Write a deterministic, seeded engine so a Daily Challenge (same market for everyone) can come later.

- RNG: a small seeded PRNG such as mulberry32. The seed comes from the run and day.
- **Output is a tick path, and candles are derived from it.** Use 24 ticks per five-minute candle: 1,872 ticks per day, about one every 96ms. The "current price" for fills, P&L, and rule checks is always the latest tick.
- The whole day's path is generated up front from the seed, so a day can be resumed or replayed exactly.
- Base model: random walk on log price, with per-tick volatility.
- **Regimes** switch with Markov transitions: `trend-up`, `trend-down`, `chop`, `volatile`. Each sets drift and volatility.
- **Intraday volatility curve**: higher at the open and the close, quieter midday (U-shape).
- **News shocks**: 1 to 3 per day at seeded times. Each has a headline (e.g. "CEO resigns unexpectedly", "Beats earnings, raises guidance"), a direction, a size, and a short follow-through drift.
  - The **times** are known from the start of the day and shown as markers on the chart's time axis. The headline and direction stay hidden until the shock lands.
  - The **instant jump is capped** so a Max position loses no more than a set share of the daily loss limit. Default 60% (`shockCapShareOfDailyLimit: 0.6`), in the config for tuning. Follow-through drift comes on top, which leaves time to react.
- Fictional tickers only (e.g. `VLTR`, `NOVA`, `KLDR`). One ticker per day in Tier 1, starting price $20 to $200. Sizing is a share of buying power, so the price level doesn't change the risk.
- Keep the engine pure (inputs in, ticks and candles out) in its own module so it's testable.

---

## 5. Screen layout and backdrop

### Assets

The owner will add these renders (they exist from the art session) to `assets/`:

- `assets/desk.png`: gameplay view, 720×1280 portrait, two stacked landscape monitors with blank screens.
- `assets/wide.png`: intro wide shot from behind the chair, 720×1280.

They are blockout previews. Final, sharper renders will replace them later at the same framing, so **position everything by percentage, never by pixel.**

### Frame

- A container locked to **9:16**, scaled to fit the viewport (`contain`), centred, with letterbox bars in slate `#141413`.
- Size it with **`dvh`**, not `vh`, so mobile browser bars don't crop it: `width: min(100vw, calc(100dvh * 9 / 16)); aspect-ratio: 9 / 16;`
- Make the frame a CSS container (`container-type: inline-size`) and **size all type in `cqw`**, so text scales with the frame like everything else.
- `desk.png` fills the container.
- Two absolutely positioned screen layers sit exactly over the rendered monitors.
- Keep the screen rectangles as CSS custom properties in one place, so a re-measure is a one-line edit.

### Screen rectangles (percent of the 9:16 frame)

| Screen | left | right | top | bottom |
|---|---|---|---|---|
| Top monitor | 11% | 89% | 21.6% | 47.6% |
| Bottom monitor | 11% | 89% | 52.4% | 78.4% |

These were checked against the `desk.png` blockout and match.

Each screen is about 16:9.5 in shape. **On a 380px-wide phone each screen is only about 296×176px**, so every element has to earn its space. Give the screen layers a dark background (`#0A1424`), a faint scanline or glow, and slightly rounded inner corners so they read as glowing displays.

### What goes on each screen

**Top monitor (market):**
- One header line: ticker symbol, last price, change, market clock, and the **day counter** ("Day 2 of 5").
- Candlestick chart (canvas), auto-scaling on price, with the average-price line when in a position.
  - **Fixed full-session time axis** with 78 candle slots, so the chart fills left to right and doubles as a clock.
  - News markers sit on the time axis at their scheduled times.
  - Scale the canvas by `devicePixelRatio` so candles stay sharp.
- The bell countdown in the last 20 seconds.
- News headline banner that flashes when news hits.

**Bottom monitor (desk), top to bottom:**
1. Account line: balance and day P&L.
2. Three rule meters as **slim bars side by side**: daily loss used, drawdown used, progress to target. Colour shifts from green through amber to red, each with a number.
3. Position line: side, size, average price, and **open P&L** (folded in here, not shown separately).
4. Size selector as one segmented control: 25% / 50% / Max.
5. Large **BUY**, **SELL**, **FLATTEN** buttons along the bottom edge, at least 44px tall on a phone.

Rough height budget at 176px: account 20, meters 22, position 20, size selector 34, buttons 52, gaps 28.

### Touch

- **Fill on `pointerdown`**, not `click`, so orders feel instant.
- The BUY, SELL, and FLATTEN **hit areas extend invisibly below the monitor bezel**, down to about 83% of the frame height, so thumbs have a bigger target than the drawn button.
- Set `touch-action: manipulation` and `user-select: none` on the frame to stop double-tap zoom and text selection.

Text must stay readable on a ~380px-wide phone. Use small but bold type and avoid dense tables.

### Intro

On run start: show `wide.png`, zoom toward the monitors (CSS transform scale, about 1.2s), and crossfade into `desk.png` with the UI fading in. A rendered video clip may replace this later.

- The monitors are **not centred** in the wide shot, so the zoom origin is not the middle of the frame.
- Estimated from the blockout PNGs: **scale about 3x, `transform-origin` about 44% 58%.** Treat these as starting values and re-measure by projecting the screen objects into `CAM_wide` (see section 11).
- At 3x the wide shot goes soft, so **start the crossfade about halfway through the zoom**.
- Preload both images before the intro starts.

---

## 6. Guided first day

The first run ever is a scripted, easier tutorial day:

1. Highlight the chart: "This is your ticker."
2. Highlight the BUY button, then wait for the player to buy.
3. Point at open P&L and the rule meters.
4. Prompt a FLATTEN.
5. Point at the news marker on the clock, then trigger the scripted news shock and show how it moves price.
6. Final 20 seconds: "Be flat by the bell or you're fired."

The tutorial day uses a fixed seed and a gentle trend. A completion flag saves to localStorage, with a "Replay tutorial" option in settings.

---

## 7. Career ladder and meta (later stages, design notes)

- Tier 1: $25k stock eval (stage 1–4).
- Tier 2: $50k futures. Leverage, tick values, faster blowups.
- Tier 3: $100k options. Theta decay, IV crush on earnings days.
- **Reputation** is earned every run, even failed ones (e.g. based on days survived and best P&L).
- Permanent perks bought with Reputation. Examples so far:
  - Thick Skin: +10% daily loss buffer
  - Level 2: see the order book
  - Newswire: headlines arrive 5 seconds early (the headline and direction, since the time is already marked)
  - Mulligan: survive one rule break per eval
- Desk progression in art: back-row desk (Tier 1), mid-floor with more monitors (Tier 2), window seat (Tier 3), cardboard box when fired.

---

## 8. Build stages

Each stage must be playable on its own. **Start with stage 1.**

1. **One playable day.** Frame + backdrop + overlay, tick-path price engine, 5-minute candle chart, sizing by buying power, BUY/SELL/FLATTEN, P&L, 3-minute clock, news markers, auto-pause, flat-at-bell check, end-of-day summary.
   - Accepted when: a full day runs on a phone in portrait, trades fill and P&L updates correctly, locking the phone mid-day pauses instead of firing, and holding at the bell triggers the fired screen.
2. **Rules engine and fired screen.** All Tier 1 rules from the config, live meters, fired screen naming the broken rule.
3. **Five-day eval and basic save.** Day-to-day carryover, minimum trading days, early pass, pass screen. **Run state saves to localStorage**, including the day in progress, so a reload or an evicted tab resumes where it left off.
4. **Reputation, perks, guided first day.** Meta currency, perk shop, saving the meta progress, tutorial.
5. **Futures tier.**
6. **Options tier.**
7. **Polish.** Sound, screen shake and juice, transitions, link from the Longlight hub.

### Mid-day reload

A seeded day replays identically, so a refresh must not hand the player a second look at the same market.

- Save the day in progress: seed, elapsed session time, balance, position, and the day's trades.
- On reload, **resume the same day at the same moment**, paused, with the chart covered until the player taps to continue.

---

## 9. Suggested structure

```
funded/
  index.html
  CNAME                 # contains: funded.longlight.games
  css/style.css
  js/main.js            # boot, intro, game state machine
  js/engine.js          # seeded price engine (pure)
  js/rules.js           # firm rules + checks (pure)
  js/chart.js           # canvas candlesticks
  js/ui.js              # screen overlays, buttons, meters
  js/tutorial.js
  js/config.js          # tier settings, rule numbers, sizes
  js/save.js            # localStorage wrapper
  assets/desk.png
  assets/wide.png
```

Keep game logic (engine, rules) separate from rendering so the numbers can be tuned and tested without the UI.

---

## 10. Deployment

- GitHub Pages from the `main` branch root.
- Add a `CNAME` file containing `funded.longlight.games`.
- DNS at the domain registrar: a CNAME record from `funded` to `jxstrr0.github.io`.
- Enable "Enforce HTTPS" in the Pages settings once DNS resolves.

---

## 11. Art pipeline reference

- The 3D scene lives in a hosted Blender project (Higgsfield 3D Jutsu): `https://higgsfield.ai/3d-jutsu/1a631ee2-e3c7-4b27-b9a7-ba50cac3c109`
- Cameras: `CAM_main` (gameplay view) and `CAM_wide` (intro), both 720×1280 portrait, lined up on the same axis for the zoom.
- Screen objects: `HERO_screen_top` and `HERO_screen_bottom`. The overlay rectangles in section 5 come from projecting these into `CAM_main`. If the camera moves, re-measure.
- **For the intro zoom, also project the screen objects into `CAM_wide`.** The scale and `transform-origin` in section 5 are estimates from the blockout PNGs and should be replaced with the projected values.
- Outstanding art work (not for the code session): city contrast and haze through the glass, lit windows, wide-shot framing, monitor-arm stub, background screen content, time-of-day lighting variants, final high-resolution renders, intro video.

---

## 12. Still open (decide when the stage arrives)

- Full perk list and Reputation costs.
- How futures and options play in an arcade style (stages 5–6).
- Sound design.
- Fired and promoted screen designs.
- Daily Challenge.

---

## 13. Revision notes

Changes from the first handoff:

- Bottom monitor slimmed down; day counter moved to the top monitor; button hit areas extended below the bezel.
- 5-minute candles on a fixed full-session axis, replacing one-minute candles.
- Engine outputs a tick path, with candles derived from it.
- Auto-pause when the tab is hidden; clock driven by elapsed time.
- Sizes are 25% / 50% / Max of buying power at 3.33x, replacing fixed share sizes.
- News times marked on the clock; shock jump capped against the daily loss limit.
- Trailing drawdown checked live on equity, locking at the starting balance.
- Eval ends early once the target and 3 trading days are met.
- Mid-day reload resumes the day in progress.
- Basic save moved from stage 4 to stage 3.
- Intro zoom origin and scale re-estimated; crossfade starts halfway.
- Frame sized with `dvh`, type in `cqw`, fills on `pointerdown`.
- Clay kept off the monitors; signs and arrows on all P&L.

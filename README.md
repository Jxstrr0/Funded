# Funded

A roguelike prop-firm trading game for the browser, by Longlight Interactive.
You get a funded eval account, trade a fast simulated market, and pass the firm's rules.
Break a rule and you're fired.

Play: https://funded.longlight.games (GitHub Pages, `main` branch root)

## Status

- **Stage 1: one playable day.** Done.
- **Stage 2: rules engine and fired screen.** Done.
- **Five-day eval** plays day to day in memory, with minimum days, early pass, and pass screen.
- **Stage 3: saving.** Done. Reload resumes the day in progress, paused.
- **Stage 4: Reputation, perks, guided first day.** Done.
- **Stage 5: futures tier.** Done. Pass Tier 1 to move up to the $50k futures desk.
- **Sound:** ElevenLabs effects, ambience and menu music. Toggle on the title screen or with M.

## Tuning

Every number lives in `js/config.js`:

- `TIER1`: balance, target, daily loss limit, drawdown, min days, buying-power multiplier, size buttons.
- `SESSION`: day length (180 s), candles, ticks per candle, bell warning.
- `PERKS`, `REPUTATION`, `TUTORIAL`: perk costs and effects, Rep formula, the scripted training day.
- `ENGINE`: volatility, trend drift, regimes, intraday U-curve, news count, jump cap (`shockCapShareOfDailyLimit`).

Screen positions are CSS variables at the top of `css/style.css` (`--top-*`, `--bot-*`, the intro zoom values).
They are percentages of the 9:16 frame, so sharper renders at the same framing need no change.

## Testing aids

- Add `?speed=10` to the URL to run the market clock 10x faster (up to 60x).
- Desktop keys: **B** buy, **S** sell, **F** flatten, **1–3** size, **P** or **Space** pause.
- Logic tests (no install needed, Node 22+): `node --test tests/*.test.js`

## Files

```
index.html        page and monitor markup
css/style.css     frame, screen rectangles, cards
js/config.js      all tuning numbers
js/engine.js      seeded price engine (pure)
js/rules.js       firm rules and account maths (pure)
js/chart.js       canvas candlesticks
js/ui.js          monitor overlays, meters, cards
js/audio.js       sound: ElevenLabs files in assets/audio/, synth fallback
js/save.js        localStorage save and resume
js/meta.js        Reputation, perk shop, tutorial flag
js/tutorial.js    guided training day
js/main.js        boot, intro, game loop and state machine
assets/           desk.png (gameplay), wide.png (intro)
tests/            node:test suites for engine and rules
```

No build step, no framework, no npm.

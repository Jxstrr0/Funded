// All tuning numbers live here. Edit and reload; nothing else needs to change.

// Firm rules for Tier 1 ($25k stock eval).
export const TIER1 = {
  name: 'Tier 1 · $25k Stock Eval',
  startBalance: 25000,
  profitTarget: 1500,          // +6%: end-of-day balance must reach start + this
  dailyLossLimit: 750,         // 3% of the day's starting balance, open P&L counts
  trailingDrawdown: 1500,      // floor = highest end-of-day balance - this
  floorLocksAt: 25000,         // floor stops rising once it reaches this
  minTradingDays: 3,           // days with at least one trade
  evalDays: 5,
  buyingPowerMultiplier: 3.33, // buying power = this x the day's starting balance
  sizes: [
    { label: '25%', share: 0.25 },
    { label: '50%', share: 0.5 },
    { label: 'MAX', share: 1 },
  ],
  defaultSizeIndex: 0,
};

// One trading day.
export const SESSION = {
  realSeconds: 180,       // 3 minutes real time
  marketOpenMinute: 570,  // 9:30
  marketMinutes: 390,     // 9:30 to 16:00
  candleMinutes: 5,
  candles: 78,
  ticksPerCandle: 24,     // 1,872 ticks per day, ~96ms each
  bellWarningSeconds: 20, // countdown before the closing bell
  maxFrameMs: 250,        // clamp for a single frame delta (stalls never skip time)
};

// Price engine.
export const ENGINE = {
  priceMin: 20,
  priceMax: 200,
  dailyVol: 0.017,           // typical one-day log-return std at base volatility
  trendMovePerCandle: 0.0006, // drift in trend regimes, per 5-minute candle
  regimeStay: 0.86,          // chance a regime holds for another candle
  regimes: {
    'trend-up':   { drift: 1,  vol: 0.95, weight: 1 },
    'trend-down': { drift: -1, vol: 0.95, weight: 1 },
    chop:         { drift: 0,  vol: 0.6,  weight: 1.3 },
    volatile:     { drift: 0,  vol: 1.7,  weight: 0.6 },
  },
  uCurveMid: 0.7,            // volatility multiplier at midday
  uCurveEdge: 1.6,           // volatility multiplier at open and close
  news: {
    min: 1,
    max: 3,
    firstCandle: 6,          // earliest slot (10:00)
    lastCandle: 68,          // latest slot (15:10)
    minGapCandles: 9,
    shockCapShareOfDailyLimit: 0.6, // a Max position loses at most this share of the daily limit on the jump
    jumpMinShareOfCap: 0.55,
    followCandlesMin: 2,
    followCandlesMax: 4,
    followMinShareOfJump: 0.35,
    followMaxShareOfJump: 0.9,
    volBoost: 1.8,           // volatility right after the shock, decaying
  },
};

export const TICKERS = ['VLTR', 'NOVA', 'KLDR', 'BRKN', 'QZEN', 'HALO', 'PYRX', 'MOTH', 'ORBT', 'LUMA', 'SKRP', 'ZEPH'];

export const HEADLINES = {
  up: [
    'Beats earnings, raises guidance',
    'Lands surprise government contract',
    'Activist investor takes 9% stake',
    'FDA fast-tracks lead product',
    'Analyst upgrade: "Strong buy"',
    'Announces $2B share buyback',
    'Takeover rumours swirl',
  ],
  down: [
    'CEO resigns unexpectedly',
    'Misses revenue, cuts outlook',
    'Regulator opens investigation',
    'Major customer walks away',
    'Short seller publishes report',
    'Product recall announced',
    'CFO sells large stake',
  ],
};

// Permanent perks, bought with Reputation. Each is a one-time buy and applies from the next eval.
export const PERKS = [
  { id: 'thickSkin', name: 'Thick Skin', cost: 60, desc: '+10% daily loss buffer.', lossBuffer: 0.10 },
  { id: 'newswire', name: 'Newswire', cost: 80, desc: 'Headlines arrive 5 seconds early.', leadSeconds: 5 },
  { id: 'level2', name: 'Level 2', cost: 120, desc: 'See the order book: bid and ask pressure.' },
  { id: 'mulligan', name: 'Mulligan', cost: 150, desc: 'Survive one rule break per eval. You are flattened and the desk locks for the day.', uses: 1, floorRoom: 750 },
];

// Reputation is earned every run, even failed ones.
export const REPUTATION = {
  perDaySurvived: 10,  // days fully closed without being fired
  bestDayDollarsPerRep: 50, // 1 Rep per $50 of the best green day
  passBonus: 50,
};

// Guided first day: fixed seed, gentle trend, one scripted news shock.
export const TUTORIAL = {
  seed: 20261112,
  script: {
    ticker: 'NOVA',
    open: 48.2,
    regime: 'trend-up',
    volScale: 0.55,
    news: [{ candle: 30, dir: 1, headline: 'Beats earnings, raises guidance', jumpShare: 0.9 }],
  },
  startCandle: 6,          // chart is pre-filled to 10:00 when the lesson starts
};

// Audio. Volumes are 0..1. Files live in assets/audio/ (generated with ElevenLabs).
// If a file fails to load, the built-in synth version plays instead.
export const AUDIO = {
  master: 0.9,
  sfx: 0.8,
  ambience: 0.35,   // trading-floor murmur during a live day
  music: 0.45,      // menu music on the title and between days
  fadeSeconds: 0.8,
  files: {
    buy: 'buy.mp3', sell: 'sell.mp3', flat: 'flatten.mp3', denied: 'denied.mp3',
    news: 'news.mp3', tick: 'tick.mp3', bell: 'bell.mp3', fired: 'fired.mp3',
    pass: 'pass.mp3', mulligan: 'mulligan.mp3', rep: 'rep.mp3',
    ambience: 'ambience.mp3', music: 'music.mp3',
  },
  // Per-sound trim, applied on top of the sfx volume.
  gain: { buy: 0.7, sell: 0.7, flat: 0.8, denied: 0.6, news: 0.8, tick: 0.5, bell: 0.9, fired: 0.9, pass: 0.9, mulligan: 0.8, rep: 0.8 },
};

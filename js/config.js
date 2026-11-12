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

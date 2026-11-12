// All tuning numbers live here. Edit and reload; nothing else needs to change.

// Firm rules for Tier 1 ($25k stock eval).
export const TIER1 = {
  id: 'tier1',
  name: 'Tier 1 · $25k Stock Eval',
  short: '$25k stocks',
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
  next: 'tier2',               // passing this eval promotes you to this tier
  backdrop: 'assets/desk.jpg', // the desk: back row
};

// Firm rules for Tier 2 ($50k futures eval). Same shape as Tier 1, scaled to
// $50k. One fictional contract with a fixed dollar value per tick, traded in
// whole contracts. More leverage than Tier 1: at MAX size the daily loss
// limit goes in about a 0.5% move (Tier 1: about 0.9%).
export const TIER2 = {
  id: 'tier2',
  name: 'Tier 2 · $50k Futures Eval',
  short: '$50k futures',
  startBalance: 50000,
  profitTarget: 3000,
  dailyLossLimit: 1500,
  trailingDrawdown: 3000,
  floorLocksAt: 50000,
  minTradingDays: 3,
  evalDays: 5,
  contract: {
    symbol: 'MRX',             // fictional "Meridian Index" future
    tickSize: 0.25,            // smallest price step
    tickValue: 12.5,           // $ per tick per contract
    pointValue: 50,            // $ per 1.00 move per contract (tickValue / tickSize)
    priceMin: 900,
    priceMax: 1300,
    volScale: 0.85,            // index futures move a bit less than single stocks
  },
  maxContracts: 6,             // net position cap, long or short
  sizes: [
    { label: '1', contracts: 1 },
    { label: '2', contracts: 2 },
    { label: 'MAX', share: 1 },
  ],
  defaultSizeIndex: 0,
  next: 'tier3',
  backdrop: 'assets/desk-tier2.jpg', // mid-floor, more monitors
};

// Firm rules for Tier 3 ($100k options eval). One stock a day and one strike,
// at the money at the open, expiring at the 16:00 bell. You buy calls (up) or
// puts (down) in whole contracts, one side at a time. Premium drains through
// the day (time decay), is pumped before the day's earnings release and
// collapses right after it (volatility crush).
export const TIER3 = {
  id: 'tier3',
  name: 'Tier 3 · $100k Options Eval',
  short: '$100k options',
  startBalance: 100000,
  profitTarget: 6000,
  dailyLossLimit: 3000,
  trailingDrawdown: 6000,
  floorLocksAt: 100000,
  minTradingDays: 3,
  evalDays: 5,
  option: {
    multiplier: 100,           // shares per contract: $ per 1.00 of premium
    strikeStep: 1,             // strike = the open, rounded to this
    premiumBudget: 2000,       // most premium one position may cost (MAX size)
    ivMin: 0.35,               // the day's base implied volatility (annual), seeded in this range
    ivMax: 0.5,
    ivEarningsPump: 2.6,       // IV multiplier just before the earnings release
    ivPumpAtOpen: 1.9,         // ...and at the open (it climbs toward the release)
    ivCrush: 0.7,              // IV multiplier after the release
    minMinutesLeft: 0.5,       // time floor for pricing, so the last tick isn't a cliff
  },
  maxContracts: 40,            // net position cap
  priceMin: 40,
  priceMax: 160,
  // News jumps as a share of the price (options cap your loss at the premium paid,
  // so these aren't tied to the daily limit like the other tiers). Tuned so a blind
  // guess before earnings loses a little on average once the IV pump is paid for.
  shocks: { earnings: [0.02, 0.035], other: [0.008, 0.018] },
  sizes: [
    { label: '25%', share: 0.25 },
    { label: '50%', share: 0.5 },
    { label: 'MAX', share: 1 },
  ],
  defaultSizeIndex: 0,
  next: null,                  // top of the ladder
  backdrop: 'assets/desk-tier3.jpg', // the window seat
};

export const TIERS = { tier1: TIER1, tier2: TIER2, tier3: TIER3 };

// Studio links and shared art.
export const STUDIO = {
  hubUrl: 'https://longlight.games', // "More games" link on the title screen
  hubLabel: 'More games at longlight.games',
  firedBackdrop: 'assets/desk-fired.jpg', // the cardboard box
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

// Earnings headlines (Tier 3: one earnings release a day).
export const EARNINGS_HEADLINES = {
  up: ['Earnings: crushes estimates', 'Earnings: record quarter, guides higher', 'Earnings: margins blow past forecasts'],
  down: ['Earnings: big miss, guidance cut', 'Earnings: revenue falls short', 'Earnings: warns on next quarter'],
};

// Permanent perks, bought with Reputation. Each is a one-time buy and applies from the next eval.
export const PERKS = [
  { id: 'thickSkin', name: 'Thick Skin', cost: 60, desc: '+10% daily loss buffer.', lossBuffer: 0.10 },
  { id: 'newswire', name: 'Newswire', cost: 80, desc: 'Headlines arrive 5 seconds early.', leadSeconds: 5 },
  { id: 'level2', name: 'Level 2', cost: 120, desc: 'See the order book: bid and ask pressure.' },
  { id: 'mulligan', name: 'Mulligan', cost: 150, desc: 'Survive one rule break per eval. You are flattened and the desk locks for the day.', uses: 1, floorRoomDailyLimits: 1 },
  { id: 'premarket', name: 'Pre-market', cost: 70, desc: "The day-open card shows the morning's trend: up, down, choppy or wild." },
  { id: 'reroll', name: 'Reroll', cost: 90, desc: 'Reroll the edge choices once after each day.', rerolls: 1 },
  { id: 'analyst', name: 'Analyst', cost: 100, desc: 'Choose from 4 edges instead of 3.', extraChoices: 1 },
  { id: 'headStart', name: 'Head Start', cost: 140, desc: 'Every career starts with one random edge.' },
];

// Edges: after each day you survive, pick 1 of 3 random cards. An edge lasts
// for the rest of the career (promotions keep it) and is gone when you're
// fired. weight: how often it is offered (rare = 1). tiers: offered only there.
export const EDGE_CHOICES = 3;
export const EDGES = [
  { id: 'rewind', name: 'Rewind', weight: 1, desc: 'Once per career, a rule break rewinds the tape 10 seconds and pauses instead.', seconds: 10, uses: 1 },
  { id: 'hotHand', name: 'Hot Hand', weight: 3, desc: 'After a green day, MAX size is 25% bigger the next day.', sizeBoost: 0.25 },
  { id: 'stopDiscipline', name: 'Stop Discipline', weight: 3, desc: "Auto-flatten when a position's open loss reaches 60% of the daily limit.", atShareOfLimit: 0.6 },
  { id: 'tapeReader', name: 'Tape Reader', weight: 3, desc: 'News markers show ▲ or ▼ 3 seconds before the headline hits.', leadSeconds: 3 },
  { id: 'riskFriend', name: 'Risk Desk Friend', weight: 3, desc: 'Daily loss limit +10% for the rest of the career.', lossBuffer: 0.10 },
  { id: 'shortWeek', name: 'Short Week', weight: 2, desc: 'Profit target -8%.', targetCut: 0.08 },
  { id: 'coffee', name: 'Coffee', weight: 3, desc: 'The clock runs 15% slower.', slowdown: 0.15 },
  { id: 'whisper', name: 'Whisper', weight: 1, desc: "The day-open card tells you which way the day's first headline goes." },
  { id: 'rainmaker', name: 'Rainmaker', weight: 2, desc: 'Rep earned this career x1.25.', repBonus: 0.25 },
  { id: 'thetaShield', name: 'Theta Shield', weight: 2, tiers: ['tier3'], desc: 'Premium decays at half speed until noon, then catches up by the close.', untilMinute: 720, rate: 0.5 },
];

// Mandates: optional handicaps chosen before a career, for more Rep.
// repBonus values add up: two mandates worth +20% and +30% pay x1.5.
export const MANDATES = [
  { id: 'noFlatten', name: 'No Flatten', repBonus: 0.20, desc: 'No FLATTEN button. Options: CLOSE only works in the last 20 seconds.' },
  { id: 'tightLeash', name: 'Tight Leash', repBonus: 0.30, desc: 'Daily loss limit -25%.', lossCut: 0.25 },
  { id: 'blindNews', name: 'Blind News', repBonus: 0.25, desc: 'News times are hidden: no markers on the chart, no times at the open.' },
  { id: 'maxOnly', name: 'Max Only', repBonus: 0.40, desc: 'Every order is MAX size.' },
];

// How the morning reads on the day-open card (Pre-market perk).
export const REGIME_TEXT = { 'trend-up': 'Trending up ▲', 'trend-down': 'Trending down ▼', chop: 'Choppy, no trend', volatile: 'Wild swings' };

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
  dayMusic: 0.3,    // quieter loop under the ambience during a live day
  fadeSeconds: 0.8,
  files: {
    buy: 'buy.mp3', sell: 'sell.mp3', flat: 'flatten.mp3', denied: 'denied.mp3',
    news: 'news.mp3', tick: 'tick.mp3', bell: 'bell.mp3', fired: 'fired.mp3',
    pass: 'pass.mp3', mulligan: 'mulligan.mp3', rep: 'rep.mp3',
    ambience: 'ambience.mp3', music: 'music.mp3', dayMusic: 'day-music.mp3',
  },
  // Per-sound trim, applied on top of the sfx volume.
  gain: { buy: 0.7, sell: 0.7, flat: 0.8, denied: 0.6, news: 0.8, tick: 0.5, bell: 0.9, fired: 0.9, pass: 0.9, mulligan: 0.8, rep: 0.8 },
};

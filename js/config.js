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
  rainBackdrop: 'assets/desk-rain.jpg',     // rain days (WEATHER)
  fundedBackdrop: 'assets/desk-funded.jpg', // shown when this eval is passed
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
  dailyLossLimit: 1800,        // was 1,500; raised in 0.10 so the middle rung isn't the hardest
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
  rainBackdrop: 'assets/desk-tier2-rain.jpg',     // rain days (WEATHER)
  fundedBackdrop: 'assets/desk-tier2-funded.jpg', // shown when this eval is passed
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
  profitTarget: 7500,          // 6,000, then 5,000 (0.9.0.4), now 7,500 with the bigger premium budget (0.10)
  dailyLossLimit: 3000,
  trailingDrawdown: 6000,
  floorLocksAt: 100000,
  minTradingDays: 3,
  evalDays: 5,
  option: {
    multiplier: 100,           // shares per contract: $ per 1.00 of premium
    strikeStep: 1,             // strike = the open, rounded to this
    premiumBudget: 3500,       // most premium one position may cost (MAX size); above the daily limit, so MAX can get you fired (was 2,000)
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
  // Options keep 1–3 headlines a day, with the longer follow-through of ENGINE.news (was 0.35–0.9).
  news: { min: 1, max: 3, minGapCandles: 9, followMinShareOfJump: 0.6, followMaxShareOfJump: 1.2 },
  sizes: [
    { label: '25%', share: 0.25 },
    { label: '50%', share: 0.5 },
    { label: 'MAX', share: 1 },
  ],
  defaultSizeIndex: 0,
  next: null,                  // top of the ladder
  backdrop: 'assets/desk-tier3.jpg', // the window seat
  rainBackdrop: 'assets/desk-tier3-rain.jpg',     // rain days (WEATHER)
  fundedBackdrop: 'assets/desk-tier3-funded.jpg', // shown when this eval is passed
};

export const TIERS = { tier1: TIER1, tier2: TIER2, tier3: TIER3 };

// The game's version, four numbers: Major.Minor.Patch.Build (the same scheme as
// every Longlight game). Bump it in the PR that ships a change players see.
// It shows small on the title screen, and when it changes on main,
// .github/workflows/publish-release.yml publishes a GitHub Release, which is
// where longlight.games reads this game's version and "what's new" line.
export const VERSION = '0.10.0.1';

// Studio links and shared art.
export const STUDIO = {
  hubUrl: 'https://longlight.games', // "More games" link on the title screen
  hubLabel: 'More games at longlight.games',
  firedBackdrop: 'assets/desk-fired.jpg', // the cardboard box
  // Rendered camera move from the wide shot onto the desk (art/build_scene.py --dolly).
  // If it can't play (or reduced motion is on), the CSS zoom in css/style.css is used.
  introVideo: 'assets/intro.mp4',
};

// Weather: some days are seeded grey and rainy (the tier's rainBackdrop, and no
// morning/evening light). It doesn't change the trading.
export const WEATHER = {
  rainChance: 0.2, // share of trading days that are rain days
  // Moving rain streaks drawn over the window glass on rain days, as % of the
  // frame (left, top, width, height), matched to each tier's rain render. A
  // tier with no entry (tier2: no window in view) gets none. Strength and
  // speed are CSS variables at the top of css/style.css.
  streaks: {
    tier1: [ // the skyline either side of the top monitor
      { l: 0, t: 33, w: 10.2, h: 11 },
      { l: 89.8, t: 33, w: 10.2, h: 11 },
    ],
    tier3: [ // the glass wall: above the monitors, and above and below the wing monitors
      { l: 0, t: 0, w: 100, h: 20.6 },
      { l: 0, t: 20.6, w: 10.2, h: 15.6 },
      { l: 89.8, t: 20.6, w: 10.2, h: 15.6 },
      { l: 0, t: 64.8, w: 10.2, h: 14.2 },
      { l: 89.8, t: 64.8, w: 10.2, h: 14.2 },
    ],
  },
};

// The trader's hands (js/clicker.js): on touch screens a pointer glides to
// whatever you tap on the monitors and clicks it, and the mouse on the desk
// moves with it. Cosmetic only; orders fill on the tap.
export const CLICKER = {
  on: true,
  glideMs: 160,   // pointer travel time for a medium move (longer moves take a bit more)
  idleMs: 2500,   // the pointer fades out after this long without a tap
  pointerRest: { x: 78, y: 70 }, // where the pointer starts, % of the frame
  screens: { l: 12, r: 88, t: 22.5, b: 77.5 }, // the pointer stays on the glass
  mouseTravel: { x: 0.02, y: 0.015 }, // desk mouse move per unit of pointer move
  mouse: {
    dir: 'assets/mouse',
    // Crop of CAM_main around the desk mouse, % of 1080x1920 (left, top, width,
    // height), from art/build_props.py --mouse. It runs past the frame's edge
    // so the mouse can slide in. A tier left out keeps the mouse baked in.
    layout: {
      tier1: { l: 86.2, t: 86.72, w: 28.61, h: 17.55 },
      tier2: { l: 86.2, t: 86.72, w: 28.61, h: 17.55 },
      tier3: { l: 86.2, t: 86.72, w: 28.61, h: 17.55 },
    },
  },
};

// Edges on the desk: each edge the career holds puts its prop on the desk
// (images in assets/props/<tier>/<edge id>.webp, card art in assets/cards/).
// Positions are percent of the 9:16 frame: left, top, width, height, measured
// by art/build_props.py. Listed back to front: later ones draw on top.
export const EDGE_PROPS = {
  dir: 'assets/props',
  cards: 'assets/cards',
  layout: {
    tier1: {
      stopDiscipline: { l: 23.52, t: 78.91, w: 10.93, h: 5.73 },
      shortWeek: { l: 39.26, t: 78.28, w: 18.7, h: 7.4 },
      rewind: { l: 55.28, t: 78.28, w: 23.43, h: 6.88 },
      coffee: { l: 0.0, t: 76.82, w: 18.43, h: 16.67 },
      thetaShield: { l: 85.37, t: 77.66, w: 14.63, h: 15.05 },
      tapeReader: { l: 14.63, t: 85.05, w: 19.35, h: 6.25 },
      riskFriend: { l: 34.91, t: 85.83, w: 20.83, h: 5.94 },
      whisper: { l: 51.76, t: 85.62, w: 17.96, h: 6.04 },
      rainmaker: { l: 73.15, t: 84.32, w: 15.83, h: 6.3 },
      insurance: { l: 24.07, t: 86.15, w: 13.24, h: 1.82 },
      bellClerk: { l: 33.43, t: 82.97, w: 8.33, h: 2.24 },
      ironStomach: { l: 66.76, t: 86.2, w: 8.89, h: 3.65 },
      biggerBook: { l: 71.76, t: 79.38, w: 17.78, h: 5.05 },
      deepPockets: { l: 78.43, t: 96.51, w: 19.63, h: 2.5 },
      leverageLoan: { l: 14.91, t: 83.33, w: 10.93, h: 1.67 },
      hotHand: { l: 77.41, t: 90.73, w: 16.2, h: 5.42 },
    },
    tier2: {
      stopDiscipline: { l: 24.07, t: 78.91, w: 9.63, h: 5.73 },
      shortWeek: { l: 39.26, t: 78.33, w: 18.7, h: 7.34 },
      rewind: { l: 55.37, t: 78.28, w: 23.33, h: 7.03 },
      coffee: { l: 0.0, t: 75.78, w: 18.43, h: 18.02 },
      thetaShield: { l: 85.37, t: 77.66, w: 14.63, h: 14.27 },
      tapeReader: { l: 13.98, t: 85.05, w: 20.09, h: 6.2 },
      riskFriend: { l: 35.65, t: 85.83, w: 19.26, h: 5.26 },
      whisper: { l: 51.2, t: 85.62, w: 18.8, h: 6.04 },
      rainmaker: { l: 72.31, t: 84.32, w: 16.94, h: 6.2 },
      insurance: { l: 24.07, t: 86.15, w: 13.24, h: 1.82 },
      bellClerk: { l: 33.52, t: 82.97, w: 8.15, h: 2.29 },
      ironStomach: { l: 66.48, t: 86.2, w: 9.17, h: 3.65 },
      biggerBook: { l: 71.57, t: 79.38, w: 17.87, h: 5.47 },
      deepPockets: { l: 77.31, t: 95.57, w: 20.37, h: 3.44 },
      leverageLoan: { l: 14.72, t: 83.33, w: 11.02, h: 1.67 },
      hotHand: { l: 77.41, t: 90.73, w: 16.57, h: 5.31 },
    },
    tier3: {
      stopDiscipline: { l: 24.17, t: 78.85, w: 9.54, h: 5.89 },
      shortWeek: { l: 39.26, t: 78.28, w: 18.7, h: 7.66 },
      rewind: { l: 56.3, t: 78.28, w: 22.41, h: 7.81 },
      coffee: { l: 0.0, t: 76.82, w: 18.43, h: 17.45 },
      thetaShield: { l: 85.37, t: 77.66, w: 14.63, h: 15.16 },
      tapeReader: { l: 14.17, t: 84.95, w: 20.19, h: 6.35 },
      riskFriend: { l: 32.69, t: 84.9, w: 22.13, h: 6.25 },
      whisper: { l: 51.2, t: 85.36, w: 18.15, h: 6.3 },
      rainmaker: { l: 72.59, t: 84.32, w: 17.41, h: 8.18 },
      insurance: { l: 23.98, t: 85.31, w: 13.33, h: 2.66 },
      bellClerk: { l: 33.06, t: 82.92, w: 8.8, h: 2.92 },
      ironStomach: { l: 66.3, t: 85.94, w: 10.19, h: 4.79 },
      biggerBook: { l: 72.22, t: 79.38, w: 17.87, h: 5.83 },
      deepPockets: { l: 78.43, t: 96.51, w: 19.54, h: 3.49 },
      leverageLoan: { l: 14.91, t: 83.33, w: 10.74, h: 1.98 },
      hotHand: { l: 77.5, t: 90.73, w: 16.11, h: 5.83 },
    },
  },
};

// Time of day: each desk backdrop (say desk.jpg) can have a morning version
// (desk-am.jpg) and a closing-bell version (desk-pm.jpg). Through the day the
// morning layer fades out, then the late-afternoon one fades in. Shares of the
// day: 0 = 9:30 open, 1 = 16:00 bell. A missing file just shows the plain desk.
export const TIME_OF_DAY = {
  amFadeEnd: 0.4,    // morning light gone by about 12:05
  pmFadeStart: 0.5,  // golden light starts at 12:45...
  pmPeak: 1,         // ...and is this strong at the bell (0..1)
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
  saveEveryMs: 2000,      // mid-day autosave interval (fills, pause and leaving the page save at once)
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
  // Bump when day generation changes: a saved day in progress from an older version restarts
  // from its open (the same seed would now give a different tape).
  version: 4,
  news: {
    min: 2,                  // headlines a day (was 1–3; raised so careful play can reach the target)
    max: 4,
    firstCandle: 6,          // earliest slot (10:00)
    lastCandle: 68,          // latest slot (15:10)
    minGapCandles: 8,
    shockCapShareOfDailyLimit: 0.6, // a Max position loses at most this share of the daily limit on the jump
    jumpMinShareOfCap: 0.55,
    followCandlesMin: 2,
    followCandlesMax: 4,
    followMinShareOfJump: 0.6,  // the drift after a headline, as a share of the jump (was 0.35–0.9)
    followMaxShareOfJump: 1.2,
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
  { id: 'hotHand', name: 'Hot Hand', weight: 3, desc: 'After a green day, the next day your sizes and your daily loss limit are both 20% bigger.', sizeBoost: 0.20, lossBoost: 0.20 },
  { id: 'stopDiscipline', name: 'Stop Discipline', weight: 3, desc: "Auto-flatten when a position's open loss reaches 60% of the daily limit.", atShareOfLimit: 0.6 },
  { id: 'tapeReader', name: 'Tape Reader', weight: 1, desc: 'News markers show ▲ or ▼ 1 second before the headline hits.', leadSeconds: 1.0 },
  { id: 'riskFriend', name: 'Risk Desk Friend', weight: 3, desc: 'Daily loss limit +10% for the rest of the career.', lossBuffer: 0.10 },
  { id: 'shortWeek', name: 'Short Week', weight: 2, desc: 'Profit target -12%.', targetCut: 0.12 },
  { id: 'coffee', name: 'Coffee', weight: 3, desc: 'The clock runs 15% slower.', slowdown: 0.15 },
  { id: 'whisper', name: 'Whisper', weight: 1, desc: "The day-open card tells you which way the day's first headline goes." },
  { id: 'rainmaker', name: 'Rainmaker', weight: 2, desc: 'Rep earned this career x1.25.', repBonus: 0.25 },
  { id: 'thetaShield', name: 'Theta Shield', weight: 2, tiers: ['tier3'], desc: 'Options are priced 15% cheaper (lower implied volatility).', ivScale: 0.85 },
  // Added in 0.10. `unlock` names the achievement (ACHIEVEMENTS) that puts an edge in the draw.
  { id: 'insurance', name: 'Insurance', weight: 2, unlock: 'dailyFive', desc: "After a red day, the firm refunds 25% of the day's loss at the close.", refund: 0.25 },
  { id: 'bellClerk', name: 'Bell Clerk', weight: 1, unlock: 'tier2Pass', desc: 'At the bell, an open position is closed for you instead of getting you fired.' },
  { id: 'ironStomach', name: 'Iron Stomach', weight: 3, desc: 'Trailing drawdown 25% deeper.', drawdownBoost: 0.25 },
  { id: 'biggerBook', name: 'Bigger Book', weight: 2, tiers: ['tier2'], desc: 'Futures: max position +2 contracts.', extraContracts: 2 },
  { id: 'deepPockets', name: 'Deep Pockets', weight: 2, tiers: ['tier3'], desc: 'Options: premium budget +25%.', budgetBoost: 0.25 },
  { id: 'leverageLoan', name: 'Leverage Loan', weight: 2, cursed: true, unlock: 'funded', desc: 'Cursed. Every size is 40% bigger, but your daily loss limit is 15% smaller.', sizeBoost: 0.4, lossCut: 0.15 },
];
// Edges left out of the Daily Challenge draw (they do nothing in a single day).
export const DAILY_SKIP_EDGES = ['rainmaker', 'shortWeek', 'hotHand', 'ironStomach'];

// Mandates: optional handicaps chosen before a career, for more Rep.
// repBonus values add up: two mandates worth +20% and +30% pay x1.5.
export const MANDATES = [
  { id: 'noFlatten', name: 'No Flatten', repBonus: 0.20, desc: 'No FLATTEN button. Options: CLOSE only works in the last 20 seconds.' },
  { id: 'tightLeash', name: 'Tight Leash', repBonus: 0.30, desc: 'Daily loss limit -25%.', lossCut: 0.25 },
  { id: 'blindNews', name: 'Blind News', repBonus: 0.25, desc: 'News times are hidden: no markers on the chart, no times at the open.' },
  { id: 'maxOnly', name: 'Max Only', repBonus: 0.15, desc: 'Every order is MAX size.' },
];

// Day types (0.10): about 1 day in 4 is a special day, seeded like the weather
// and named on the day-open card. Same career and day, same type. The tutorial
// never gets one.
export const DAY_TYPES = {
  chance: 0.25,
  types: {
    // The stock gapped overnight. The first hour runs hard, usually with the gap.
    gap: { weight: 1, name: 'Gap open', gapPct: [0.015, 0.04], followChance: 0.6, candles: 12, drift: 2.5, vol: 1.3 },
    // Quiet until one huge release at 14:00 (options: the earnings release).
    fed: { weight: 1, name: 'Fed day', candle: 54, quietVol: 0.7, jumpShareOfCap: 1, followCandles: [5, 8], follow: [0.9, 1.4], optionsJump: [0.03, 0.045] },
    // One direction all day; the news is smaller.
    trend: { weight: 1, name: 'Trend day', drift: 2, newsScale: 0.6, news: { min: 1, max: 2 } },
    // One headline halts trading for 3 candles (15 minutes). It reopens with a
    // second jump; the two together stay inside the usual shock cap.
    halt: { weight: 1, name: 'Trading halt', candles: 3, firstShare: 0.55, reopenShare: [0.3, 0.45], reopenWithChance: 0.65, lastCandle: 60 },
  },
};

export const FED_HEADLINES = {
  up: ['Fed: surprise rate cut', 'Fed signals cuts ahead', 'Fed: "inflation is beaten"'],
  down: ['Fed: surprise rate hike', 'Fed signals more hikes', 'Fed: "higher for longer"'],
};
export const HALT_HEADLINES = { up: 'Trading resumes: buyers waiting', down: 'Trading resumes: sellers waiting' };

// Daily Challenge (0.10): everyone with the same date plays the same seeded
// day. The tier rotates by date, with fixed edges. The first try is scored;
// replays are practice.
export const DAILY = {
  epoch: '2026-11-16',           // Daily #1
  tiers: ['tier1', 'tier2', 'tier3'], // rotation, by challenge number
  edges: 2,                      // fixed edges, seeded from the date
  parShare: 1 / 3,               // par for the day: this share of the tier's eval target (the TGT meter)
  rep: { played: 15, perDollars: 50 }, // Rep for the scored try: flat, plus 1 per $ of green P&L
  url: 'funded.longlight.games',
  keep: 120,                     // scored days kept in the save
};

// Funded phase (0.10): passing Tier 3 keeps the career going on the $100k
// options account with no target. Every 5 days the week's profit is split and
// paid out (Rep, banked straight away), and the account resets.
export const FUNDED = {
  weekDays: 5,
  split: 0.8,                    // your share of a green week
  bonusAt: 5000,                 // a week this green pays...
  bonusSplit: 0.9,               // ...this share instead (the TGT meter tracks it)
  repPerDollars: 100,            // 1 Rep per $ paid out
};

// Achievements (0.10). `unlocks` names an edge (EDGES `unlock`) that joins the draw.
export const ACHIEVEMENTS = [
  { id: 'firstPass', name: 'Funded', desc: 'Pass Tier 1.' },
  { id: 'tier2Pass', name: 'Contract Player', desc: 'Pass Tier 2.', unlocks: 'bellClerk' },
  { id: 'funded', name: 'Window Seat', desc: 'Pass Tier 3 and go funded.', unlocks: 'leverageLoan' },
  { id: 'firstPayout', name: 'Payday', desc: 'Take a payout.' },
  { id: 'bigPayout', name: 'Six Figures', desc: 'Get $100,000 paid out in one career.' },
  { id: 'dailyFive', name: 'Regular', desc: 'Play 5 Daily Challenges.', unlocks: 'insurance' },
  { id: 'dailyStreak', name: 'Habit', desc: 'Play the Daily Challenge 7 days in a row.' },
  { id: 'flawless', name: 'Flawless', desc: 'Pass an eval with every day green.' },
  { id: 'fedDay', name: 'Fed Whisperer', desc: 'Close a Fed day green.' },
  { id: 'haltDay', name: 'Circuit Breaker', desc: 'Close a trading-halt day green.' },
  { id: 'mandated', name: 'Masochist', desc: 'Pass an eval with 3 or more mandates.' },
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
  rain: 0.4,        // rain on the windows on rainy days (WEATHER)
  fadeSeconds: 0.8,
  files: {
    buy: 'buy.mp3', sell: 'sell.mp3', flat: 'flatten.mp3', denied: 'denied.mp3',
    news: 'news.mp3', tick: 'tick.mp3', bell: 'bell.mp3', fired: 'fired.mp3',
    pass: 'pass.mp3', mulligan: 'mulligan.mp3', rep: 'rep.mp3',
    deal: 'deal.mp3', pick: 'pick.mp3', rare: 'rare.mp3', reroll: 'reroll.mp3',
    stamp: 'stamp.mp3', purchase: 'purchase.mp3',
    ambience: 'ambience.mp3', music: 'music.mp3', dayMusic: 'day-music.mp3', rain: 'rain.mp3',
  },
  // Per-sound trim, applied on top of the sfx volume.
  gain: { buy: 0.7, sell: 0.7, flat: 0.8, denied: 0.6, news: 0.8, tick: 0.5, bell: 0.9, fired: 0.9, pass: 0.9, mulligan: 0.8, rep: 0.8,
    deal: 0.8, pick: 0.8, rare: 0.7, reroll: 0.7, stamp: 0.8, purchase: 0.8 },
};

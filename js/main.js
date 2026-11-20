// Boot, intro, and the game state machine.
import { TIER1, TIER2, TIER3, TIERS, SESSION, PERKS, TUTORIAL, STUDIO, VERSION, EDGES, MANDATES, REGIME_TEXT, ENGINE, WEATHER, EDGE_PROPS, CLICKER, REPUTATION, DAY_TYPES, DAILY, FUNDED, ACHIEVEMENTS } from './config.js';
import * as fx from './fx.js';
import { generateDay, candlesUpTo, hashSeed, bookAt, haltAt } from './engine.js';
import { newRun, newDay, applyFill, orderDelta, optionOrder, snapshot, closeDay, RULE_TEXT, effectiveRules, applyMulligan, openPnl, fundedRules, startFunded } from './rules.js';
import { edgeById, mandateById, careerOf, openDraft, draftOffer, rerollDraft, rerollsAllowed, takeEdge, headStart, repMultiplier, unlockedOf } from './edges.js';
import { quoteAt, bs } from './options.js';
import { loadMeta, saveMeta, reputationFor, buyPerk, canBuy, recordDay, recordEdge, recordEval, recordCareer, favouriteEdge, recordPayout, recordDaily, achievementsFor, grantAchievements } from './meta.js';
import { dateKey, challengeFor, dailyOpen, streak, dailyRep, trimPlayed, shareText } from './daily.js';
import { createTutorial } from './tutorial.js';
import { Chart } from './chart.js';
import * as ui from './ui.js';
import { unlockAudio, sfx, setScene, setRain, audioMode, cycleAudioMode } from './audio.js';
import { loadRun, saveRun, clearRun, DAILY_KEY } from './save.js';
import { initClicker, setDeskMouse } from './clicker.js';

let RULES = TIER1; // tier rules with the run's perks applied
const N_TICKS = SESSION.candles * SESSION.ticksPerCandle;
const DAY_MS = SESSION.realSeconds * 1000;
const TICK_MS = DAY_MS / N_TICKS;
// Testing aid: ?speed=10 runs the clock 10x faster.
const SPEED = Math.max(1, Math.min(60, Number(new URLSearchParams(location.search).get('speed')) || 1));

const S = {
  phase: 'boot',      // boot | title | intro | dayopen | running | paused | over
  run: null,
  day: null,          // account state for the day (rules.newDay)
  market: null,       // generated day (engine.generateDay)
  elapsed: 0,         // ms of session time run so far
  prevNow: null,
  sizeIndex: RULES.defaultSizeIndex,
  revealed: new Set(),
  lastWarnSec: null,
  dirty: true,
  tutorial: null,     // tutorial controller while the guided day runs
  hold: false,        // tutorial: clock frozen
  allow: null,        // tutorial: allowed actions, null = all
  wired: new Set(),   // Newswire: headlines already announced early
  tgtMet: false,      // target meter already full (for the one-time pop)
  tape: [],           // Rewind edge: recent day snapshots [{elapsed, day, revealed}]
  hinted: 0,          // Tape Reader: news markers already showing their direction
  warned: false,      // screen readers were told a rule meter passed 80%
  halted: false,      // trading halted right now (halt days)
  review: false,      // end-of-day review: the chart labels each trade's P&L
};

let meta = loadMeta();
const has = (perk) => !S.tutorial && S.run?.perks?.includes(perk);
const hasEdge = (id) => !S.tutorial && !!S.run?.edges?.includes(id);

let chart;
const tierOf = (run) => TIERS[run?.tier] || TIER1;

/** Switch the active tier's rules (with the run's perks) and its size buttons. */
function useRules(rules) {
  RULES = rules;
  ui.setSizes(RULES.sizes, RULES.option ? 'premium budget' : 'buying power');
  ui.setActionLabels(RULES.option ? ['CALL', 'PUT', 'CLOSE'] : ['BUY', 'SELL', RULES.noFlatten ? 'NO FLAT' : 'FLATTEN']);
  S.sizeIndex = Math.min(S.sizeIndex, RULES.sizes.length - 1);
  if (!RULES.option) ui.renderOptions(null);
  showDesk();
}

/** A seeded share of days are grey and rainy (WEATHER). Same career + day, same weather. */
const rainDay = (run) => !!run && !S.tutorial && !!tierOf(run).rainBackdrop && run.day >= 1
  && hashSeed(run.seed, run.day, 'weather') / 4294967296 < WEATHER.rainChance;

/** The desk for today (rain or shine), with the career's edge props on it. */
function showDesk() {
  const rain = rainDay(S.run) && RULES.rainBackdrop;
  fx.setBackdrop(rain || RULES.backdrop, { tod: !rain, rain: rain ? S.run.tier || 'tier1' : null });
  setRain(!!rain);
  syncProps(!!rain);
}

function syncProps(rain = rainDay(S.run) && !!RULES.rainBackdrop) {
  fx.setDeskProps(S.run && !S.tutorial ? S.run.tier || 'tier1' : null, S.run && !S.tutorial ? S.run.edges || [] : []);
  setDeskMouse(S.run && !S.tutorial ? S.run.tier || 'tier1' : 'tier1', rain);
}

/** The run's base rules: its tier, or the tier as a funded account or a Daily Challenge. */
function baseRules(run) {
  const t = tierOf(run);
  if (run.funded) return fundedRules(t);
  if (run.daily) return { ...t, profitTarget: run.daily.par, evalDays: 1, name: `Daily #${run.daily.n} · ${t.short}`, next: null };
  return t;
}

/** Today's rules for the run: tier + perks + the career's edges and mandates. */
function applyRunRules() {
  useRules(effectiveRules(S.run.perks || [], baseRules(S.run), careerOf(S.run)));
  warmTier(tierOf(S.run));
}

/** The save slot for the run: a Daily Challenge saves apart from the career. */
const saveKey = (run = S.run) => (run?.daily ? DAILY_KEY : undefined);

// Offline play: once a career reaches a tier, ask sw.js to save that tier's
// desks (plain, morning, evening, rain, pass), desk mouse and edge props.
const warmed = new Set();
function warmTier(t) {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw || !t || warmed.has(t.id)) return;
  warmed.add(t.id);
  const urls = [t.backdrop, t.rainBackdrop, t.fundedBackdrop].filter(Boolean);
  if (t.backdrop) urls.push(t.backdrop.replace(/\.jpg$/, '-am.jpg'), t.backdrop.replace(/\.jpg$/, '-pm.jpg'));
  if (CLICKER.mouse.layout[t.id]) {
    for (const part of ['mouse', 'plate']) for (const v of ['', '-am', '-pm', '-rain']) urls.push(`${CLICKER.mouse.dir}/${t.id}-${part}${v}.webp`);
  }
  for (const id of Object.keys(EDGE_PROPS.layout[t.id] || {})) urls.push(`${EDGE_PROPS.dir}/${t.id}/${id}.webp`);
  try { sw.postMessage({ warm: urls }); } catch { /* offline saving is a bonus */ }
}

// ---------- helpers ----------

const price = () => S.market.ticks[Math.max(0, S.day.tick)];
const minuteNow = () => SESSION.marketOpenMinute + (S.elapsed / DAY_MS) * SESSION.marketMinutes;
const dayLabel = () => (S.tutorial ? 'Training'
  : S.run.daily ? `Daily #${S.run.daily.n}`
    : S.run.funded ? `Wk ${S.run.funded.week} · Day ${S.run.history.length + 1}`
      : `Day ${S.run.day} of ${RULES.evalDays}`);
const allowed = (kind) => !S.allow || S.allow.includes(kind);
const newsTime = (n) => ui.clockText(SESSION.marketOpenMinute + n.candle * SESSION.candleMinutes);
const scheduled = () => S.market.news.filter((n) => !n.reopen); // a halt's reopening isn't on the schedule
const newsTimes = () => scheduled().map((n) => newsTime(n) + (n.earnings ? ' (earnings)' : n.fed ? ' (Fed)' : '')).join(' · ');
const clockScale = () => RULES.clockScale || 1; // Coffee edge: the session runs slower
const bellLeft = () => Math.ceil((DAY_MS - S.elapsed) * clockScale() / 1000); // the bell countdown, in seconds
/** Tape Reader: a news marker shows its direction this close to the headline. */
const tapeLead = () => (hasEdge('tapeReader') ? edgeById('tapeReader').leadSeconds * 1000 / clockScale() : 0);
const hintedCount = () => S.market.news.filter((n) => n.tick * TICK_MS - S.elapsed <= tapeLead()).length;

// Options tier: premiums at a tick, and the price a position is marked at
// (the underlying, or the held side's premium).
const quotesAt = (i) => quoteAt(S.market, Math.max(0, i), RULES);
const premiumOf = (right, q) => (right === 'C' ? q.call : q.put);
const markAt = (i) => (RULES.option ? (S.day.right ? premiumOf(S.day.right, quotesAt(i)) : 0) : S.market.ticks[Math.max(0, i)]);
const mark = () => markAt(S.day.tick);

function render() {
  fx.setTimeOfDay(S.elapsed / DAY_MS);
  const last = price();
  ui.renderMarket({ ticker: S.market.ticker, last, open: S.market.open, minute: minuteNow(), dayLabel: dayLabel() });
  ui.renderL2(has('level2') && S.day.tick >= 0 ? bookAt(S.market, S.day.tick) : null);
  const m = mark();
  const snap = snapshot(S.run, S.day, m, RULES);
  ui.renderDesk(snap, S.day, S.sizeIndex, m);
  const hot = S.phase === 'running' && !S.tutorial && Math.max(snap.lossUsed, snap.ddUsed) >= 0.8;
  fx.danger(hot);
  if (hot && !S.warned) ui.announce(`Warning: ${snap.lossUsed >= snap.ddUsed ? 'daily loss limit' : 'drawdown'} ${Math.round(Math.max(snap.lossUsed, snap.ddUsed) * 100)}% used`, true);
  if (S.phase === 'running') S.warned = hot || (S.warned && Math.max(snap.lossUsed, snap.ddUsed) >= 0.75); // slack, so hovering at 80% warns once
  if (snap.targetProgress >= 1 && !S.tgtMet && S.phase === 'running' && !S.tutorial) { fx.targetHit(); sfx.rep(); }
  S.tgtMet = snap.targetProgress >= 1 || (S.tgtMet && snap.targetProgress >= 0.95); // slack, so hovering at 100% pops once
  if (RULES.option) {
    const q = quotesAt(S.day.tick);
    const earn = S.market.news.find((n) => n.earnings);
    const done = earn && S.revealed.has(earn.tick);
    ui.renderOptions({ strike: S.market.strike, call: q.call, put: q.put, iv: q.iv, earnings: earn ? (done ? 'IV CRUSHED' : RULES.blindNews ? 'EARNINGS TODAY' : `EARNINGS ${newsTime(earn)}`) : '' });
  }
  chart.draw({
    candles: S.day.tick >= 0 ? candlesUpTo(S.market, S.day.tick) : [],
    last,
    avg: RULES.option ? S.market.strike : S.day.qty ? S.day.avg : null,
    avgLabel: RULES.option ? `STRIKE ${S.market.strike}` : undefined,
    qty: S.day.qty,
    news: S.market.news.map((n) => {
      const hinted = n.tick * TICK_MS - S.elapsed <= tapeLead();
      const revealed = S.revealed.has(n.tick) || hinted;
      const unannounced = n.reopen && S.day.tick < n.haltFrom; // a halt's reopening shows once the halt starts
      return { candle: n.candle, dir: n.dir, revealed, hidden: (RULES.blindNews && !revealed) || unannounced };
    }),
    fills: (S.day.fills || []).map((f) => ({ candle: Math.floor(f.tick / SESSION.ticksPerCandle), price: f.price, dir: f.dir, pnl: f.pnl })),
    halts: (S.market.halts || []).filter((h) => S.day.tick >= h.from).map((h) => ({ from: Math.ceil(h.from / SESSION.ticksPerCandle), to: Math.ceil(h.to / SESSION.ticksPerCandle) })),
    review: S.review,
  });
  S.dirty = false;
  return snap;
}

// ---------- saving ----------

// Saves the run, plus the day in progress while trading, so a reload resumes
// the same day at the same moment (paused, chart covered).
let lastSave = 0;
function persist(force = false) {
  if (!S.run || S.tutorial) return;
  const now = performance.now();
  if (!force && now - lastSave < SESSION.saveEveryMs) return;
  lastSave = now;
  const inDay = S.phase === 'running' || S.phase === 'paused';
  saveRun(S.run, inDay ? { day: S.day, elapsed: S.elapsed, revealed: [...S.revealed], mv: ENGINE.version } : null, S.sizeIndex, saveKey());
}

function resumeSaved(data) {
  S.run = { edges: [], mandates: [], rewinds: 0, draft: null, ...data.run }; // saves from before edges existed
  applyRunRules();
  S.sizeIndex = Math.min(data.sizeIndex ?? RULES.defaultSizeIndex, RULES.sizes.length - 1);
  // A day saved under older market rules would resume on a different tape: restart it from the open.
  if (!data.live || data.live.mv !== ENGINE.version) { afterDraft(openDay); return; }
  S.day = data.live.day;
  S.market = generateDay({ seed: hashSeed(S.run.seed, S.run.day), dayStartBalance: S.day.startBalance, rules: RULES });
  S.elapsed = data.live.elapsed;
  S.revealed = new Set(data.live.revealed);
  S.wired = new Set(data.live.revealed);
  S.tape = [];
  recordTape(); // so a breach on the first tick after the reload can still Rewind
  S.lastWarnSec = null;
  S.halted = !!haltAt(S.market, S.day.tick);
  ui.hideCard();
  ui.hideNews();
  ui.setBell(null);
  S.phase = 'paused';
  ui.setPaused(true);
  ui.setTradingEnabled(false);
  setScene('quiet');
  render();
}

// ---------- orders ----------

function trade(side) {
  if (S.phase !== 'running' || !allowed(side > 0 ? 'buy' : 'sell')) return;
  if (S.day.locked) { sfx.denied(); ui.flashDenied('DESK LOCKED'); return; }
  if (S.halted) { sfx.denied(); ui.flashDenied('HALTED'); return; }
  if (RULES.option) return tradeOption(side > 0 ? 'C' : 'P');
  const p = price();
  const delta = orderDelta(S.day, side, RULES.sizes[S.sizeIndex], p);
  if (delta === 0) { sfx.denied(); ui.flashDenied('MAX SIZE'); setTimeout(() => (S.dirty = true), 950); return; }
  fill(delta, p, side);
  side > 0 ? sfx.buy() : sfx.sell();
  S.tutorial?.onTrade(side > 0 ? 'buy' : 'sell');
}

/** Options: CALL or PUT buys contracts of that side. One side at a time. */
function tradeOption(right) {
  const denied = (text) => { sfx.denied(); ui.flashDenied(text); setTimeout(() => (S.dirty = true), 950); };
  if (S.day.qty && S.day.right !== right) return denied(`CLOSE ${S.day.right === 'C' ? 'CALLS' : 'PUTS'} FIRST`);
  const prem = premiumOf(right, quotesAt(S.day.tick));
  const n = optionOrder(S.day, RULES.sizes[S.sizeIndex], prem, RULES);
  if (n === 0) return denied('MAX SIZE');
  S.day.right = right;
  fill(n, prem, right === 'C' ? 1 : -1);
  right === 'C' ? sfx.buy() : sfx.sell();
}

function flatten() {
  if (S.phase !== 'running' || S.day.qty === 0 || !allowed('flat')) return;
  if (S.halted) { sfx.denied(); ui.flashDenied('HALTED'); setTimeout(() => (S.dirty = true), 950); return; }
  if (RULES.noFlatten && !(RULES.option && bellLeft() <= SESSION.bellWarningSeconds)) {
    sfx.denied();
    ui.flashDenied(RULES.option ? 'CLOSE IN THE LAST 20s' : 'NO FLATTEN · MANDATE');
    setTimeout(() => (S.dirty = true), 950);
    return;
  }
  fill(-S.day.qty, mark(), 0);
  sfx.flat();
  S.tutorial?.onTrade('flat');
}

function fill(delta, p, dir = 0) {
  const r = applyFill(S.day.qty, S.day.avg, delta, p, S.day.mult ?? 1);
  fx.fillFlash(dir);
  if (Math.abs(r.qty) < Math.abs(S.day.qty) || Math.sign(r.qty) !== Math.sign(S.day.qty)) fx.pnlPop(r.realized);
  // Kept for the chart markers and the end-of-day review (and the Daily share squares).
  const closed = Math.abs(r.qty) < Math.abs(S.day.qty) || Math.sign(r.qty) !== Math.sign(S.day.qty);
  (S.day.fills ||= []).push({ tick: Math.max(0, S.day.tick), price: price(), dir, pnl: closed ? r.realized : 0 });
  S.day.qty = r.qty;
  S.day.avg = r.avg;
  S.day.realized += r.realized;
  if (r.qty === 0) S.day.right = null;
  S.day.trades += 1;
  S.dirty = true;
  persist(true);
  ui.announce(fillWords(r.realized));
}

/** The fill as words for screen readers: the new position, and any realized P&L. */
function fillWords(realized) {
  const d = S.day;
  const pnl = Math.round(realized) ? ` Realized ${ui.signed(realized).text.replace('▲', 'up').replace('▼', 'down')}.` : '';
  if (!d.qty) return `Flat.${pnl}`;
  if (d.right) return `${d.qty} ${d.right === 'C' ? 'call' : 'put'}${d.qty > 1 ? 's' : ''} at ${d.avg.toFixed(2)}.${pnl}`;
  const n = Math.abs(d.qty).toLocaleString('en-US');
  return `${d.qty > 0 ? 'Long' : 'Short'} ${n} ${RULES.contract ? 'contracts' : 'shares'} at ${d.avg.toFixed(2)}.${pnl}`;
}

// ---------- the loop ----------

function processTick(i) {
  S.day.tick = i;
  const ev = S.market.news.find((n) => n.tick === i);
  if (ev && !S.revealed.has(i)) {
    S.revealed.add(i);
    ui.showNews(ev);
    ui.shake();
    sfx.news();
    fx.buzz(25);
    S.tutorial?.onNews();
  }
  const h = S.market.halts?.length ? haltAt(S.market, i) : null;
  if (!!h !== S.halted) setHalted(h);
  if (S.tutorial || S.day.locked) return true; // no firing in training or on a locked desk
  if (hasEdge('stopDiscipline') && !S.halted && S.day.qty && openPnl(S.day, markAt(i)) <= -edgeById('stopDiscipline').atShareOfLimit * RULES.dailyLossLimit) {
    fill(-S.day.qty, markAt(i), 0);
    sfx.flat();
    ui.showNotice('STOP DISCIPLINE · position flattened');
  }
  const snap = snapshot(S.run, S.day, markAt(i), RULES);
  if (snap.breach) return breach(snap.breach) === 'mulligan';
  return true;
}

/** A halt starts (h) or ends (null): the order buttons go dead while it lasts. */
function setHalted(h) {
  S.halted = !!h;
  if (S.phase === 'running') ui.setTradingEnabled(!S.halted && !S.day.locked);
  if (h) {
    ui.showNotice(`TRADING HALTED · reopens ${ui.clockText(SESSION.marketOpenMinute + Math.ceil(h.to / SESSION.ticksPerCandle) * SESSION.candleMinutes)}`);
    fx.buzz([20, 30, 20]);
  }
  S.dirty = true;
}

/**
 * A rule broke. Rewind (an edge) winds the tape back and pauses; Mulligan
 * forgives it once per eval; otherwise you're fired. Returns what happened:
 * 'rewind' | 'mulligan' | 'fired'.
 */
function breach(rule) {
  if (S.run.rewinds > 0 && S.tape.length) { rewind(rule); return 'rewind'; }
  if (S.run.mulligans > 0) { useMulligan(rule); return 'mulligan'; }
  fire(rule);
  return 'fired';
}

/** Rewind edge: restore the day as it was a few seconds ago, paused. */
function rewind(rule) {
  const back = edgeById('rewind').seconds * 1000 / clockScale();
  const at = S.elapsed - back;
  const snap = [...S.tape].reverse().find((t) => t.elapsed <= at) || S.tape[0];
  S.day = structuredClone(snap.day);
  S.elapsed = snap.elapsed;
  S.revealed = new Set(snap.revealed);
  S.wired = new Set(snap.revealed);
  S.halted = !!haltAt(S.market, S.day.tick);
  S.tape = S.tape.filter((t) => t.elapsed <= snap.elapsed);
  S.run = { ...S.run, rewinds: S.run.rewinds - 1 };
  S.lastWarnSec = null;
  S.phase = 'paused';
  ui.hideNews();
  ui.setBell(null);
  ui.setPaused(true, { title: 'Rewind', sub: `${RULE_TEXT[rule].name}. The tape went back ${Math.round(back * clockScale() / 1000)}s. Tap to resume and fix it.` });
  ui.setTradingEnabled(false);
  fx.danger(false);
  fx.screenFlash('bell');
  fx.buzz([30, 40, 30]);
  sfx.mulligan();
  setScene('quiet');
  render();
  ui.showNotice(`REWIND USED · ${RULE_TEXT[rule].name}`);
  persist(true);
}

/** Keep a snapshot of the day every half second of session time, for Rewind. */
function recordTape() {
  if (!S.run.rewinds || S.tutorial) return;
  const lastT = S.tape[S.tape.length - 1];
  if (lastT && S.elapsed - lastT.elapsed < 500) return;
  S.tape.push({ elapsed: S.elapsed, day: structuredClone(S.day), revealed: [...S.revealed] });
  const keep = (edgeById('rewind').seconds + 5) * 1000;
  while (S.tape.length && S.tape[0].elapsed < S.elapsed - keep) S.tape.shift();
}

function useMulligan(rule) {
  if (S.day.qty) {
    const r = applyFill(S.day.qty, S.day.avg, -S.day.qty, mark(), S.day.mult ?? 1);
    S.day.qty = r.qty; S.day.avg = r.avg; S.day.realized += r.realized; S.day.right = null;
  }
  S.run = applyMulligan(S.run, S.day.startBalance + S.day.realized, RULES);
  S.day.locked = true;
  ui.setTradingEnabled(false);
  ui.shake();
  fx.screenFlash('bell');
  fx.buzz([30, 40, 30]);
  sfx.mulligan();
  ui.showNotice(`MULLIGAN USED · ${RULE_TEXT[rule].name}. Desk locked for today.`);
  S.dirty = true;
  persist(true);
}

// Tutorial: jump the session clock forward, processing ticks without rules.
function seekTo(ms) {
  S.elapsed = Math.max(S.elapsed, Math.min(DAY_MS - 1, ms));
  const target = Math.min(N_TICKS - 1, Math.floor(S.elapsed / TICK_MS));
  for (let i = S.day.tick + 1; i <= target; i++) processTick(i);
  S.dirty = true;
  render();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (S.phase !== 'running' || S.hold) { S.prevNow = null; return; }
  if (S.prevNow == null) S.prevNow = now;
  const dt = (Math.min(now - S.prevNow, SESSION.maxFrameMs) * SPEED) / clockScale();
  S.prevNow = now;
  S.elapsed = Math.min(DAY_MS, S.elapsed + dt);
  fx.setTimeOfDay(S.elapsed / DAY_MS);

  const target = Math.min(N_TICKS - 1, Math.floor(S.elapsed / TICK_MS));
  for (let i = S.day.tick + 1; i <= target; i++) {
    if (!processTick(i)) return;
    S.dirty = true;
  }
  recordTape();
  if (tapeLead()) { // Tape Reader markers appear between ticks: redraw when one does
    const hinted = hintedCount();
    if (hinted !== S.hinted) { S.hinted = hinted; S.dirty = true; }
  }

  // Newswire: headline and direction a few seconds early.
  if (has('newswire')) {
    const lead = PERKS.find((p) => p.id === 'newswire').leadSeconds * 1000;
    for (const ev of S.market.news) {
      const until = ev.tick * TICK_MS - S.elapsed;
      if (until > 0 && until <= lead && !S.wired.has(ev.tick)) {
        S.wired.add(ev.tick);
        ui.showNews(ev, { early: Math.ceil(until / 1000) });
        sfx.news();
      }
    }
  }

  // Bell countdown.
  const left = bellLeft();
  if (left <= SESSION.bellWarningSeconds && left > 0) {
    ui.setBell(left, S.day.qty !== 0, RULES.option ? 'CLOSE' : RULES.noFlatten ? 'CLOSE OUT' : 'FLATTEN');
    if (left !== S.lastWarnSec) { S.lastWarnSec = left; sfx.warn(S.day.qty !== 0); }
  }

  if (S.dirty) { render(); persist(); }
  else ui.renderMarket({ ticker: S.market.ticker, last: price(), open: S.market.open, minute: minuteNow(), dayLabel: dayLabel() });

  if (S.elapsed >= DAY_MS) closingBell();
}

// ---------- pause ----------

function pause() {
  if (S.phase !== 'running') return;
  S.phase = 'paused';
  ui.setPaused(true);
  ui.setTradingEnabled(false);
  fx.danger(false);
  setScene('quiet');
  persist(true);
}

function resume() {
  if (S.phase !== 'paused') return;
  unlockAudio();
  S.phase = 'running';
  S.prevNow = null;
  ui.setPaused(false);
  ui.setTradingEnabled(!S.day.locked && !S.halted);
  setScene('day');
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);

// ---------- flow ----------

/**
 * Start an eval. A new career starts at Tier 1 with the perks owned now and
 * the mandates chosen for it (Head Start adds a random edge).
 */
function startRun(tierId = 'tier1', perks = meta.owned, mandates = []) {
  clearRun();
  endTutorial();
  S.run = headStart({ ...newRun(TIERS[tierId], undefined, perks, { mandates }), unlocked: unlockedOf(meta) });
  applyRunRules();
  S.sizeIndex = RULES.defaultSizeIndex;
  openDay();
}

/** New career from a menu: first choose mandates (once the player has finished a run). */
function newCareer() {
  if (meta.runs < 1) return intro(() => startRun());
  mandateCard(new Set(meta.mandates || []));
}

function mandateCard(picked) {
  const bonus = [...picked].reduce((s, id) => s + mandateById(id).repBonus, 0);
  const list = MANDATES.map((m) => {
    const on = picked.has(m.id);
    return `<div class="perk edge"><h3>${ui.esc(m.name)} <span class="rep">+${Math.round(m.repBonus * 100)}% Rep</span></h3><p>${ui.esc(m.desc)}</p>
      <button class="buy toggle${on ? ' on' : ''}" aria-pressed="${on}" data-action="m_${m.id}">${on ? 'On' : 'Off'}</button></div>`;
  }).join('');
  const actions = {
    go: () => {
      meta = { ...meta, mandates: [...picked] };
      saveMeta(meta);
      intro(() => startRun('tier1', meta.owned, [...picked]));
    },
    back: title,
  };
  for (const m of MANDATES) {
    actions['m_' + m.id] = () => {
      const next = new Set(picked);
      next.has(m.id) ? next.delete(m.id) : next.add(m.id);
      sfx.stamp(next.has(m.id));
      mandateCard(next);
    };
  }
  ui.showCard(`
    <div class="eyebrow">New career · mandates</div>
    <h2>Rep <span class="rep">x${(1 + bonus).toFixed(2)}</span></h2>
    <p style="font-size:3.2cqw">Optional handicaps for the whole career. Each one adds Rep, win or lose.</p>
    ${list}
    <button class="cta" data-action="go" style="margin-top:4cqw">Start eval</button>
    <button class="cta ghost small" data-action="back">Back</button>
  `, actions);
}

// ---------- edges ----------

/** Show the pending edge pick, if any, then carry on with `next`. */
function afterDraft(next, { rerolled = false } = {}) {
  const offer = draftOffer(S.run);
  if (!S.run.draft || !offer.length) {
    if (S.run.draft) { S.run = { ...S.run, draft: null }; persist(true); }
    return next();
  }
  rerolled ? sfx.reroll() : sfx.deal();
  if (offer.some((id) => edgeById(id).weight <= 1)) setTimeout(sfx.rare, 380);
  const left = rerollsAllowed(S.run.perks) - S.run.draft.rerolls;
  const cards = offer.map((id) => {
    const e = edgeById(id);
    return `<div class="perk edge${e.weight <= 1 ? ' rare' : ''}"><img class="edge-art" src="${EDGE_PROPS.cards}/${id}.webp" alt=""><h3>${ui.esc(e.name)}${e.weight <= 1 ? ' <span class="tag">RARE</span>' : ''}${e.cursed ? ' <span class="tag cursed">CURSED</span>' : ''}</h3><p>${ui.esc(e.desc)}</p>
      <button class="buy" data-action="e_${id}">Take</button></div>`;
  }).join('');
  const actions = {
    reroll: () => { S.run = rerollDraft(S.run); persist(true); afterDraft(next, { rerolled: true }); },
  };
  for (const id of offer) {
    actions['e_' + id] = () => {
      S.run = takeEdge(S.run, id);
      bumpStats((st) => recordEdge(st, id));
      persist(true);
      sfx.pick();
      syncProps();
      next();
    };
  }
  const held = S.run.edges.map((id) => edgeById(id).name).join(', ');
  ui.showCard(`
    <div class="eyebrow">Pick an edge</div>
    <h2>Pick one for the career</h2>
    <p style="font-size:3.2cqw">Edges stack and last until you're fired. Promotions keep them.</p>
    ${cards}
    ${left > 0 ? `<button class="cta ghost small" data-action="reroll" style="margin-top:3cqw">Reroll (${left} left)</button>` : ''}
    ${held ? `<div class="fine">Held: ${ui.esc(held)}</div>` : ''}
  `, actions);
}

function careerRows() {
  const r = S.run;
  const out = [];
  if (r.edges.length) out.push(['Edges', r.edges.map((id) => edgeById(id).name).join(', ') + (r.edges.includes('rewind') ? ` (${r.rewinds} rewind left)` : '')]);
  if (r.mandates.length) out.push(['Mandates', r.mandates.map((id) => mandateById(id).name).join(', ')]);
  return out;
}

/** Day-open lines from perks and edges: the morning's trend, the first headline. */
function insightRows() {
  const out = [];
  if (RULES.hot) out.push(['Hot Hand', 'Sizes and loss limit +20% today', 'up']);
  if (has('premarket')) out.push(['Pre-market', REGIME_TEXT[S.market.regimes[0]] || '']);
  if (hasEdge('whisper') && S.market.news.length) {
    const n = S.market.news[0];
    out.push(['Whisper', `${RULES.blindNews ? 'First headline' : newsTime(n)}: ${n.dir > 0 ? '▲ good news' : '▼ bad news'}`, n.dir > 0 ? 'up' : 'down']);
  }
  return out;
}

function openDay() {
  applyRunRules();
  S.day = newDay(S.run, RULES);
  S.market = generateDay({ seed: hashSeed(S.run.seed, S.run.day), dayStartBalance: S.day.startBalance, rules: RULES });
  S.day.type = S.market.type || null;
  S.elapsed = 0;
  S.revealed = new Set();
  S.wired = new Set();
  S.tape = [];
  S.lastWarnSec = null;
  S.halted = false;
  S.review = false;
  S.tgtMet = true; // no pop for a target already met before the open
  S.phase = 'dayopen';
  setScene('menu');
  ui.hideNews();
  ui.setBell(null);
  ui.setPaused(false);
  ui.setTradingEnabled(false);
  render();
  persist(true);

  const r = S.run;
  const eyebrow = r.daily
    ? `Daily #${r.daily.n} · ${tierOf(r).short}${r.daily.practice ? ' · Practice' : ''}`
    : r.funded
      ? `Funded · Week ${r.funded.week} · Day ${r.history.length + 1} of ${FUNDED.weekDays}`
      : `${RULES.name.split(' · ')[0]} · Day ${r.day} of ${RULES.evalDays}`;
  const goal = r.daily
    ? [['Par', `+${ui.money(r.daily.par)}`]]
    : r.funded
      ? [['Payout', `${Math.round(FUNDED.split * 100)}% of a green week (${Math.round(FUNDED.bonusSplit * 100)}% from ${ui.money(RULES.startBalance + FUNDED.bonusAt)})`], ['Paid out so far', ui.money(r.funded.paid)]]
      : [['Target balance', ui.money(RULES.startBalance + RULES.profitTarget)], ['Trading days counted', `${r.daysCounted} of ${RULES.minTradingDays}`]];
  const first = r.day === 1 && !r.daily;
  const show = () => ui.showCard(`
    <div class="eyebrow">${ui.esc(eyebrow)}${rainDay(r) ? ' · Rain' : ''}</div>
    <h2>${ui.esc(S.market.ticker)} <span style="font-weight:500;color:rgba(250,249,245,.6)">opens $${S.market.open.toFixed(2)}</span></h2>
    ${dayTypeLine()}
    ${RULES.blindNews ? `<p>News times hidden (Blind News). ${scheduled().length} headline${scheduled().length > 1 ? 's' : ''} today.</p>` : `<p>News at <b>${newsTimes()}</b>. Marked on the clock.</p>`}
    ${RULES.option && first ? `<p>Options: tap <b>CALL</b> if you think it rises, <b>PUT</b> if it falls. You can only lose what you paid. Premium melts as the day runs, gets pumped before earnings, and is crushed the moment they land.</p>` : ''}
    ${RULES.contract && first ? `<p>Futures: you trade whole <b>contracts</b>. Every ${RULES.contract.tickSize.toFixed(2)} tick is <b>$${RULES.contract.tickValue.toFixed(2)}</b> a contract. Max is ${RULES.maxContracts}, and it moves fast.</p>` : ''}
    ${ui.rows([
      ['Balance', ui.money(r.balance)],
      ...(RULES.contract
        ? [['Contract', `${RULES.contract.symbol} · $${RULES.contract.pointValue} a point`], ['Max position', `${RULES.maxContracts} contracts`]]
        : RULES.option
          ? [['Strike', `${S.market.strike} calls & puts, expire 16:00`], ['Premium budget', `${ui.money(RULES.option.premiumBudget)} a position`]]
          : [[`Buying power (${RULES.buyingPowerMultiplier}x)`, ui.money(S.day.buyingPower)]]),
      ['Daily loss limit', ui.money(-RULES.dailyLossLimit)],
      ['Drawdown floor', ui.money(r.floor)],
      ...goal,
      ...(r.perks.length ? [['Perks', r.perks.map((id) => PERKS.find((p) => p.id === id).name).join(', ') + (r.perks.includes('mulligan') ? ` (${r.mulligans} mulligan left)` : '')]] : []),
      ...careerRows(),
      ...insightRows(),
    ])}
    <button class="cta" data-action="go">Open the market</button>
    <div class="fine">${RULES.bellClerk ? 'Bell Clerk closes anything still open at 16:00.' : `${RULES.option ? 'Close every contract' : 'Be flat'} by the 16:00 bell or you're fired.`}</div>
  `, { go: beginDay });
  // First time at a new desk: explain it before the day opens.
  const guide = { tier2: 'futures', tier3: 'options' }[r.tier];
  if (guide && !meta.seen?.[guide]) {
    meta = { ...meta, seen: { ...(meta.seen || {}), [guide]: dateKey() } };
    saveMeta(meta);
    return guideCard(guide, show);
  }
  show();
}

/** The day type, if today has one: a line for the day-open card. */
function dayTypeLine() {
  const t = S.market.type;
  if (!t || !DAY_TYPES.types[t]) return '';
  const T = DAY_TYPES.types[t];
  const name = t === 'fed' && RULES.option ? 'Earnings day' : T.name;
  const text = {
    gap: () => `${S.market.gap > 0 ? '▲ Up' : '▼ Down'} ${Math.abs(S.market.gap * 100).toFixed(1)}% overnight. The first hour runs hard.`,
    fed: () => `Quiet until ${RULES.blindNews ? 'one big release' : `the ${RULES.option ? 'earnings release' : 'Fed'} at ${ui.clockText(SESSION.marketOpenMinute + T.candle * SESSION.candleMinutes)}`}. One big move.`,
    trend: () => 'One direction all day. The news is smaller.',
    halt: () => `One headline halts trading for ${T.candles * SESSION.candleMinutes} minutes. No orders while it lasts, and it reopens with a second jump.`,
  }[t]();
  return `<p class="daytype"><b>${ui.esc(name)}.</b> ${ui.esc(text)}</p>`;
}

function beginDay() {
  unlockAudio();
  ui.hideCard();
  S.day.tick = -1;
  processTick(0);
  S.phase = 'running';
  S.prevNow = null;
  ui.setTradingEnabled(true);
  setScene('day');
  S.tgtMet = snapshot(S.run, S.day, mark(), RULES).targetProgress >= 1;
  render();
  persist(true);
}

function closingBell() {
  S.phase = 'over';
  ui.setBell(null);
  ui.setTradingEnabled(false);
  sfx.bell();
  fx.screenFlash('bell');
  fx.danger(false);
  setScene('menu');
  if (S.tutorial) return finishTutorial(S.day.qty !== 0);
  if (S.day.qty !== 0 && RULES.bellClerk) { // Bell Clerk: closed for you at the last price
    fill(-S.day.qty, mark(), 0);
    sfx.flat();
    ui.showNotice('BELL CLERK · position closed at the bell');
  }
  if (S.day.qty !== 0 && breach('flatAtBell') !== 'mulligan') return;

  S.day.type = S.market.type || null;
  const { run, outcome, result, week } = closeDay(S.run, S.day, RULES);
  const earned = earn({ kind: 'day', type: result.type, pnl: result.pnl });
  if (S.run.daily) { clearRun(DAILY_KEY); return dailyOver({ pnl: result.pnl }, earned); }
  bumpStats((st) => recordDay(st, S.run.tier, result.pnl));
  const prevFloor = S.run.floor;
  const goOn = outcome === 'next' || outcome === 'payout';
  S.run = goOn ? openDraft(run) : run;
  if (goOn) persist(true);
  else clearRun();
  if (outcome === 'payout') return payout(week, result, earned);
  if (outcome === 'pass') return passed(earned);
  if (outcome === 'failTarget' || outcome === 'failMinDays') return evalOver(outcome === 'failTarget' ? 'target' : 'minDays', earned);

  const pnl = ui.signed(result.pnl);
  const f = run.funded;
  const toTarget = RULES.startBalance + RULES.profitTarget - run.balance;
  const week5 = f ? FUNDED.weekDays - run.history.length : 0;
  resultCard(`
    <div class="eyebrow">${f ? `Funded · Week ${f.week} · Day ${run.history.length}` : `Day ${result.day}`} closed</div>
    <h2 class="stamp ${pnl.cls}">${pnl.text}</h2>
    ${f ? `<p>${week5} day${week5 === 1 ? '' : 's'} to the payout.</p>` : `<p>${result.counted ? 'Day counted toward your minimum.' : 'No trades today, so this day did not count.'}</p>`}
    ${ui.rows([
      ...(result.refund ? [['Insurance refund', `+${ui.money(result.refund)}`, 'up']] : []),
      ['Balance', ui.money(run.balance)],
      ...(f
        ? [['Week so far', ui.signed(run.balance - RULES.startBalance).text, ui.signed(run.balance - RULES.startBalance).cls]]
        : [['Trading days counted', `${run.daysCounted} of ${RULES.minTradingDays}`],
          [toTarget > 0 ? 'Still to target' : 'Target', toTarget > 0 ? ui.money(toTarget) : 'Reached, hold it', toTarget > 0 ? '' : 'up']]),
      ['Drawdown floor', run.floor !== prevFloor ? `${ui.money(prevFloor)} → ${ui.money(run.floor)}` : ui.money(run.floor)],
      ...(f ? [] : [['Days left', String(RULES.evalDays - result.day)]]),
      ...achRows(earned),
    ])}
    <button class="cta" data-action="next">${draftOffer(S.run).length ? 'Pick an edge' : 'Next day'}</button>
    ${REVIEW}
  `, { next: () => afterDraft(openDay) });
}

// ---------- end-of-day review ----------

const REVIEW = '<button class="cta ghost small" data-action="review">Review the day</button>';

/** A results card with a "Review the day" button that comes back to it. */
function resultCard(html, actions, opts) {
  const show = () => ui.showCard(html, { ...actions, review: () => reviewDay(show) }, opts);
  show();
}

/** Hide the card and show the day's chart with every trade and its P&L marked. */
function reviewDay(back) {
  S.review = true;
  ui.hideCard();
  render();
  ui.showReview(() => { S.review = false; render(); back(); });
}

function fire(rule) {
  S.phase = 'over';
  clearRun(saveKey());
  ui.setBell(null);
  ui.setTradingEnabled(false);
  ui.shake();
  fx.screenFlash('fired');
  fx.buzz([60, 40, 140]);
  sfx.fired();
  setScene('menu');
  render();
  fx.danger(false);
  fx.setBackdrop(STUDIO.firedBackdrop, { tod: false, props: false }); // the edges go in the box
  const t = RULE_TEXT[rule];
  const snap = snapshot(S.run, S.day, mark(), RULES);
  if (S.run.daily) return dailyOver({ pnl: snap.equity - S.day.startBalance, fired: true, rule });
  const rep = award('fired');
  const f = S.run.funded;
  resultCard(`
    <div class="eyebrow">${f ? `Funded · Week ${f.week}` : `Day ${S.run.day}`} · ${ui.clockText(minuteNow())}</div>
    <h1 class="fired stamp">You're fired.</h1>
    <div class="rule-name">${ui.esc(t.name)}</div>
    <p>${ui.esc(t.detail(RULES))}</p>
    ${careerNote()}
    ${ui.rows([
      ['Equity at the time', ui.money(snap.equity)],
      ['Day P&L', ui.signed(snap.dayPnl).text, ui.signed(snap.dayPnl).cls],
      ...(f
        ? [['Paid out this career', ui.money(f.paid), f.paid ? 'up' : ''], ['Weeks closed', String(f.weeks.length)]]
        : [['Days survived', String(S.run.day - 1)]]),
      ...repRows(rep),
    ])}
    <button class="cta" data-action="again">New eval</button>
    <button class="cta ghost" data-action="shop">Perk shop</button>
    ${REVIEW}
  `, { again: newCareer, shop: () => shop(newCareer) });
}

function evalOver(rule, earned = []) {
  sfx.fired();
  const t = RULE_TEXT[rule];
  const rep = award('notFunded');
  resultCard(`
    <div class="eyebrow">Eval over</div>
    <h1 class="fired stamp">Not funded.</h1>
    <div class="rule-name">${ui.esc(t.name)}</div>
    <p>${ui.esc(t.detail(RULES))}</p>
    ${careerNote()}
    ${ui.rows([
      ['Final balance', ui.money(S.run.balance)],
      ['Total P&L', ui.signed(S.run.balance - RULES.startBalance).text, ui.signed(S.run.balance - RULES.startBalance).cls],
      ['Trading days counted', `${S.run.daysCounted} of ${RULES.minTradingDays}`],
      ...repRows(rep),
      ...achRows(earned),
    ])}
    <button class="cta" data-action="again">New eval</button>
    <button class="cta ghost" data-action="shop">Perk shop</button>
    ${REVIEW}
  `, { again: newCareer, shop: () => shop(newCareer) });
}

function careerNote() {
  return S.run.tier !== 'tier1' ? '<p style="font-size:3.2cqw">Your next career starts back at Tier 1. Rep and perks stay; edges are lost.</p>' : '';
}

function passed(earnedDay = []) {
  sfx.pass();
  fx.screenFlash('pass');
  fx.buzz([20, 30, 20, 30, 60]);
  const r = S.run;
  const rep = award('pass');
  const earned = [...earnedDay, ...earn({ kind: 'pass', tier: r.tier, history: r.history, mandates: r.mandates })];
  if (RULES.fundedBackdrop) fx.setBackdrop(RULES.fundedBackdrop, { tod: false, props: false });
  if (RULES.next) return promoted(r, rep, earned);
  goFunded(r, rep, earned);
}

/** Passed the top tier: the career goes on as a funded account with weekly payouts. */
function goFunded(r, rep, earned) {
  const t = tierOf(r);
  const from = RULES;
  S.run = openDraft({ ...startFunded(r, t), unlocked: unlockedOf(meta), careerDays: (r.careerDays || 0) + r.history.length });
  persist(true);
  resultCard(`
    <div class="eyebrow">Eval passed · funded</div>
    <h1 class="stamp">Funded<span class="dot">.</span></h1>
    <p>You passed ${ui.esc(from.name)} in ${r.history.length} days. The firm hands you a live ${ui.money(t.startBalance)} account. You've earned the window seat.</p>
    <p style="font-size:3.2cqw">No target now. Every ${FUNDED.weekDays} days you keep ${Math.round(FUNDED.split * 100)}% of the week's profit (${Math.round(FUNDED.bonusSplit * 100)}% on a week of +${ui.money(FUNDED.bonusAt)} or more) and the account resets. Same rules: break one and you're out. Total paid out is your score.</p>
    ${ui.rows([
      ['Final balance', ui.money(r.balance)],
      ['Total P&L', ui.signed(r.balance - from.startBalance).text, 'up'],
      ...repRows(rep),
      ...achRows(earned),
    ])}
    <button class="cta" data-action="go">Start week 1</button>
    ${REVIEW}
  `, { go: () => { applyRunRules(); S.sizeIndex = RULES.defaultSizeIndex; afterDraft(openDay); } });
}

/** A funded week closed: pay out (or not), bank the Rep, and carry on. */
function payout(week, result, earnedDay = []) {
  const r = S.run; // already the next week
  r.careerDays = (r.careerDays || 0) + week.days.length;
  const rep = Math.round((Math.floor(week.paid / FUNDED.repPerDollars) + REPUTATION.perDaySurvived * week.days.length) * repMultiplier(r));
  const stats = recordPayout(meta.stats, week.paid, r.funded.paid);
  meta = { ...meta, rep: meta.rep + rep, stats: { ...stats, repEarned: stats.repEarned + rep } };
  saveMeta(meta);
  const earned = [...earnedDay, ...earn({ kind: 'payout', paid: week.paid, careerPaid: r.funded.paid })];
  persist(true);
  if (week.paid) { sfx.pass(); fx.screenFlash('pass'); fx.buzz([20, 30, 60]); }
  if (rep > 0) setTimeout(sfx.rep, 1200);
  const day = ui.signed(result.pnl);
  const wk = ui.signed(week.profit);
  resultCard(`
    <div class="eyebrow">Funded · Week ${week.week} closed</div>
    <h2 class="stamp ${week.paid ? 'up' : 'down'}">${week.paid ? `Paid ${ui.money(week.paid)}` : 'No payout'}</h2>
    <p>${week.paid
    ? `You keep ${Math.round(week.split * 100)}% of the week's ${ui.money(week.profit)}. The account resets to ${ui.money(RULES.startBalance)}.`
    : 'A red week pays nothing, and the loss carries into next week.'}</p>
    ${ui.rows([
      ...(result.refund ? [['Insurance refund', `+${ui.money(result.refund)}`, 'up']] : []),
      ['Last day', day.text, day.cls],
      ['Week P&L', wk.text, wk.cls],
      ['Paid out this career', ui.money(r.funded.paid), r.funded.paid ? 'up' : ''],
      ['Reputation earned', `+${rep}`, 'up'],
      ['Reputation banked', String(meta.rep)],
      ...achRows(earned),
    ])}
    <button class="cta" data-action="next">${draftOffer(S.run).length ? 'Pick an edge' : `Start week ${r.funded.week}`}</button>
    ${REVIEW}
  `, { next: () => afterDraft(openDay) });
}

/** Passed a tier with another above it: the career moves up. Saved straight
 * away, so a reload continues at the new tier's first day. */
function promoted(r, rep, earned = []) {
  const next = TIERS[RULES.next];
  const perks = r.perks;
  const from = RULES;
  S.run = openDraft(newRun(next, undefined, perks, { edges: r.edges, mandates: r.mandates, rewinds: r.rewinds }));
  S.run.careerDays = (r.careerDays || 0) + r.history.length; // for the longest-career stat
  S.run.unlocked = unlockedOf(meta); // a pass can unlock new edges for the drafts up there
  persist(true);
  resultCard(`
    <div class="eyebrow">Eval passed · promoted</div>
    <h1 class="stamp">Funded<span class="dot">.</span></h1>
    <p>You passed ${ui.esc(from.name)} in ${r.history.length} days. The desk moves you up to <b>${ui.esc(next.name)}</b>.</p>
    ${ui.rows([
      ['Final balance', ui.money(r.balance)],
      ['Total P&L', ui.signed(r.balance - from.startBalance).text, 'up'],
      ['Next account', ui.money(next.startBalance)],
      ['Next target', `+${ui.money(next.profitTarget)}`],
      ...repRows(rep),
      ...achRows(earned),
    ])}
    <button class="cta" data-action="go">Start ${ui.esc(next.short)}</button>
    ${REVIEW}
    <div class="fine">Your edges come with you. Get fired up there and the next career starts at Tier 1.</div>
  `, { go: () => { applyRunRules(); S.sizeIndex = RULES.defaultSizeIndex; afterDraft(openDay); } });
}

// ---------- reputation and perks ----------

/** Bank Rep for a finished eval ('pass', 'fired' or 'notFunded') and count it in the stats. */
function award(outcome) {
  const passedEval = outcome === 'pass';
  const rep = reputationFor(S.run.history, passedEval, undefined, repMultiplier(S.run));
  // A funded account isn't an eval: its firing ends the career but isn't counted as a failed eval.
  let stats = S.run.funded ? { ...meta.stats, repEarned: meta.stats.repEarned + rep.total } : recordEval(meta.stats, S.run.tier, outcome, rep.total);
  // The career ends unless a pass carries it on (promoted, or funded at the top); its days run across both.
  if (!passedEval) stats = recordCareer(stats, (S.run.careerDays || 0) + S.run.history.length);
  meta = { ...meta, rep: meta.rep + rep.total, runs: meta.runs + 1, passes: meta.passes + (passedEval ? 1 : 0), stats };
  saveMeta(meta);
  if (rep.total > 0) setTimeout(sfx.rep, 1200);
  return rep;
}

/** Grant the achievements an event earns; returns their ids (for the card). */
function earn(ev) {
  const ids = achievementsFor(meta, ev);
  if (!ids.length) return [];
  meta = grantAchievements(meta, ids, dateKey());
  saveMeta(meta);
  setTimeout(sfx.rare, 900);
  return ids;
}

function achRows(ids = []) {
  return ids.map((id) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    const e = a.unlocks && edgeById(a.unlocks);
    return ['Achievement ★', `${a.name}${e ? ` · unlocks ${e.name}` : ''}`, 'up'];
  });
}

function bumpStats(fn) {
  meta = { ...meta, stats: fn(meta.stats) };
  saveMeta(meta);
}

function repRows(rep) {
  return [
    ...(rep.mult !== 1 ? [['Rep bonus', `x${rep.mult.toFixed(2)} (+${rep.parts.bonus})`, 'up']] : []),
    ['Reputation earned', `+${rep.total}`, 'up'],
    ['Reputation banked', String(meta.rep)],
  ];
}

function shop(back) {
  const list = PERKS.map((p) => {
    const owned = meta.owned.includes(p.id);
    const label = owned ? 'Owned' : `${p.cost} Rep`;
    return `<div class="perk"><h3>${ui.esc(p.name)}</h3><p>${ui.esc(p.desc)}</p>
      <button class="buy" data-action="buy_${p.id}" ${owned || !canBuy(meta, p.id) ? 'disabled' : ''}>${label}</button></div>`;
  }).join('');
  const actions = { back };
  for (const p of PERKS) actions['buy_' + p.id] = () => { meta = buyPerk(meta, p.id); saveMeta(meta); sfx.purchase(); shop(back); };
  ui.showCard(`
    <div class="eyebrow">Perk shop</div>
    <h2>You have <span class="rep">${meta.rep} Rep</span></h2>
    <p style="font-size:3.2cqw">Perks are permanent and apply from your next new eval. Earn Rep every run, even when you're fired. Edges are different: you pick those during a career.</p>
    ${list}
    <button class="cta" data-action="back" style="margin-top:4cqw">Done</button>
  `, actions);
}

// ---------- career stats ----------

function statsCard(back) {
  const st = meta.stats;
  const short = (id) => (TIERS[id] ? TIERS[id].short : '—');
  const fav = favouriteEdge(st);
  const best = st.bestDay && st.bestDay.pnl > 0 ? st.bestDay : null; // a green day, or none yet
  const evals = st.passed.tier1 + st.passed.tier2 + st.passed.tier3 + st.fired + st.notFunded;
  ui.showCard(`
    <div class="eyebrow">Career stats</div>
    <h2>${st.careers} career${st.careers === 1 ? '' : 's'}</h2>
    ${ui.rows([
      ['Evals played', String(evals)],
      [`Passed · ${short('tier1')}`, String(st.passed.tier1), st.passed.tier1 ? 'up' : ''],
      [`Passed · ${short('tier2')}`, String(st.passed.tier2), st.passed.tier2 ? 'up' : ''],
      [`Passed · ${short('tier3')}`, String(st.passed.tier3), st.passed.tier3 ? 'up' : ''],
      ['Fired', String(st.fired), st.fired ? 'down' : ''],
      ['Not funded (out of days)', String(st.notFunded)],
      ['Highest tier reached', short(st.topTier)],
      ['Days traded', st.days ? `${st.days} · ${Math.round(100 * st.greenDays / st.days)}% green` : '0'],
      ['Best day', best ? `${ui.signed(best.pnl).text} · ${short(best.tier)}` : '—', best ? 'up' : ''],
      ['Longest career', `${st.longestCareer} day${st.longestCareer === 1 ? '' : 's'}`],
      ['Favourite edge', fav && edgeById(fav.id) ? `${edgeById(fav.id).name} · ${fav.n}×` : '—'],
      ['Payouts', st.payouts ? `${st.payouts} · ${ui.money(st.paidTotal)}` : '0', st.payouts ? 'up' : ''],
      ['Best funded career', st.bestPaid ? ui.money(st.bestPaid) : '—', st.bestPaid ? 'up' : ''],
      ['Best Daily', st.bestDaily ? `${ui.signed(st.bestDaily.pnl).text} · #${st.bestDaily.n}` : '—', st.bestDaily ? ui.signed(st.bestDaily.pnl).cls : ''],
      ['Reputation earned', String(st.repEarned)],
    ])}
    ${st.partial ? '<div class="fine">Counted from v0.9.0.3. Earlier careers aren\'t in here.</div>' : ''}
    <button class="cta" data-action="ach" style="margin-top:4cqw">Achievements · ${Object.keys(meta.ach || {}).length} of ${ACHIEVEMENTS.length}</button>
    <button class="cta ghost" data-action="back">Done</button>
  `, { back, ach: () => achievementsCard(() => statsCard(back)) });
}

function achievementsCard(back) {
  const have = meta.ach || {};
  const list = ACHIEVEMENTS.map((a) => {
    const got = have[a.id];
    const e = a.unlocks && edgeById(a.unlocks);
    return `<div class="perk ach${got ? ' got' : ''}"><h3>${got ? '★ ' : '☆ '}${ui.esc(a.name)}${e ? ` <span class="tag">UNLOCKS ${ui.esc(e.name.toUpperCase())}</span>` : ''}</h3>
      <p>${ui.esc(a.desc)}${got ? ` Earned ${ui.esc(got)}.` : ''}</p></div>`;
  }).join('');
  ui.showCard(`
    <div class="eyebrow">Achievements</div>
    <h2>${Object.keys(have).length} of ${ACHIEVEMENTS.length}</h2>
    <p style="font-size:3.2cqw">Some unlock new edges, which then turn up in your drafts.</p>
    ${list}
    <button class="cta" data-action="back" style="margin-top:4cqw">Done</button>
  `, { back });
}


// ---------- Daily Challenge ----------

/** Today's challenge card: its tier and fixed edges, or the score if it's played. */
function dailyCard(ch, note = '') {
  const done = meta.daily?.[ch.key];
  const t = TIERS[ch.tier];
  const edges = ch.edges.map((id) => {
    const e = edgeById(id);
    return `<div class="perk edge"><img class="edge-art" src="${EDGE_PROPS.cards}/${id}.webp" alt=""><h3>${ui.esc(e.name)}</h3><p>${ui.esc(e.desc)}</p></div>`;
  }).join('');
  const sc = done && ui.signed(done.pnl);
  ui.showCard(`
    <div class="eyebrow">Daily Challenge #${ch.n}</div>
    <h2>${ui.esc(t.name)}</h2>
    <p>One day, the same market for everyone today. Par is <b>+${ui.money(ch.par)}</b>. The tier's rules stand: break one and you're out.${done ? '' : ' Your first try is scored. Replays are practice.'}</p>
    ${done ? ui.rows([
    ['Your score', done.fired ? `Fired · ${sc.text}` : sc.text, done.fired ? 'down' : sc.cls],
    ['Par', done.pnl >= done.par && !done.fired ? 'Made it ✓' : `+${ui.money(done.par)}`, done.pnl >= done.par && !done.fired ? 'up' : ''],
    ['Streak', `${streak(meta.daily, ch.key)} day${streak(meta.daily, ch.key) === 1 ? '' : 's'}`],
  ]) : ''}
    <div class="eyebrow" style="margin-top:3cqw">Today's edges</div>
    ${edges}
    ${done
    ? `<button class="cta" data-action="share">${note || 'Share your result'}</button>
    <button class="cta ghost" data-action="practice">Practice today's day</button>`
    : '<button class="cta" data-action="go">Start the challenge</button>'}
    <button class="cta ghost small" data-action="back">Back</button>
    <div class="fine">No perks or mandates. A new challenge every day at midnight.</div>
  `, {
    go: () => intro(() => startDaily(ch, false)),
    practice: () => intro(() => startDaily(ch, true)),
    share: () => shareDaily(ch.key, (msg) => dailyCard(ch, msg)),
    back: title,
  });
}

/** Shown instead of the Daily when the phone's date is before Daily #1. */
function dailyEarlyCard() {
  const first = new Date(`${DAILY.epoch}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  ui.showCard(`
    <div class="eyebrow">Daily Challenge</div>
    <h2>Check your phone's date</h2>
    <p>The first Daily Challenge was on ${ui.esc(first)}. This phone's date is earlier than that, so there is no Daily to play today.</p>
    <p>Set the date in your phone's settings, then come back.</p>
    <button class="cta" data-action="back">Back</button>
  `, { back: title }, { clear: true });
}

function startDaily(ch, practice) {
  clearRun(DAILY_KEY);
  endTutorial();
  const run = newRun(TIERS[ch.tier], ch.seed, [], { edges: ch.edges, rewinds: ch.edges.includes('rewind') ? edgeById('rewind').uses : 0 });
  S.run = { ...run, unlocked: null, daily: { key: ch.key, n: ch.n, par: ch.par, practice: !!practice } };
  applyRunRules();
  S.sizeIndex = RULES.defaultSizeIndex;
  openDay();
}

/** The Daily ended (bell or firing). A first try is scored; practice isn't. */
function dailyOver(o, earnedDay = []) {
  const r = S.run;
  const d = r.daily;
  const trades = (S.day.fills || []).filter((f) => Math.round(f.pnl)).map((f) => Math.sign(f.pnl));
  const rec = { n: d.n, tier: r.tier, pnl: Math.round(o.pnl), fired: !!o.fired, rule: o.fired ? RULE_TEXT[o.rule].name : '', par: d.par, trades };
  const scored = !d.practice && !meta.daily?.[d.key];
  let rep = 0;
  let earned = earnedDay;
  if (scored) {
    rep = dailyRep(rec.fired ? Math.min(0, rec.pnl) : rec.pnl);
    const daily = trimPlayed({ ...(meta.daily || {}), [d.key]: rec });
    const stats = recordDaily(meta.stats, rec);
    meta = { ...meta, daily, rep: meta.rep + rep, stats: { ...stats, repEarned: stats.repEarned + rep } };
    saveMeta(meta);
    earned = [...earned, ...earn({ kind: 'daily', played: Object.keys(daily).length, streak: streak(daily, d.key) })];
    if (rep > 0) setTimeout(sfx.rep, 1200);
  }
  if (!rec.fired) (rec.pnl >= rec.par ? sfx.pass : () => {})();
  const ch = challengeFor(d.key);
  const show = (note = '') => {
    const pnl = ui.signed(rec.pnl);
    ui.showCard(`
      <div class="eyebrow">Daily #${d.n} · ${ui.esc(tierOf(r).short)}${d.practice ? ' · Practice' : ''}</div>
      ${rec.fired ? `<h1 class="fired stamp">Fired.</h1><div class="rule-name">${ui.esc(rec.rule)}</div>` : `<h2 class="stamp ${pnl.cls}">${pnl.text}</h2>`}
      ${ui.rows([
      ...(rec.fired ? [['Day P&L', pnl.text, pnl.cls]] : []),
      ['Par', !rec.fired && rec.pnl >= rec.par ? `+${ui.money(rec.par)} ✓` : `+${ui.money(rec.par)}`, !rec.fired && rec.pnl >= rec.par ? 'up' : ''],
      ['Trades closed', rec.trades.length ? `${rec.trades.filter((x) => x > 0).length} ▲ · ${rec.trades.filter((x) => x < 0).length} ▼` : 'None'],
      ...(scored
        ? [['Streak', `${streak(meta.daily, d.key)} day${streak(meta.daily, d.key) === 1 ? '' : 's'}`], ['Reputation earned', `+${rep}`, 'up'], ['Reputation banked', String(meta.rep)]]
        : [['Scored', d.practice ? 'No, practice' : 'Already scored today']]),
      ...achRows(earned),
    ])}
      ${meta.daily?.[d.key] ? `<button class="cta" data-action="share">${note || (scored ? 'Share your result' : 'Share your scored try')}</button>` : ''}
      ${REVIEW}
      <button class="cta ghost" data-action="practice">Practice again</button>
      <button class="cta ghost small" data-action="back">Back to the title</button>
    `, {
      share: () => shareDaily(d.key, show),
      review: () => reviewDay(() => show(note)),
      practice: () => startDaily(ch, true),
      back: title,
    });
  };
  show();
}

/** Share a scored Daily: the share sheet where there is one, else the clipboard. */
async function shareDaily(key, done) {
  const rec = meta.daily?.[key];
  if (!rec) return done('Nothing to share yet');
  const text = shareText({ ...rec, streak: streak(meta.daily, key) });
  try {
    if (navigator.share) { await navigator.share({ text }); return done('Shared ✓'); }
  } catch (e) {
    if (e && e.name === 'AbortError') return done('');
  }
  try {
    await navigator.clipboard.writeText(text);
    done('Copied to clipboard ✓');
  } catch {
    done('Couldn\'t copy. Try again');
  }
}

// ---------- guides ----------

const TRADING_MINUTES_PER_YEAR = 252 * 390;

function guideHtml(kind) {
  if (kind === 'futures') {
    const t = TIER2;
    const c = t.contract;
    const mid = (c.priceMin + c.priceMax) / 2;
    const pts = t.dailyLossLimit / (c.pointValue * t.maxContracts);
    return `
      <div class="eyebrow">New desk · futures</div>
      <h2>${ui.esc(t.name)}</h2>
      <p>You trade whole <b>contracts</b> of ${ui.esc(c.symbol)}, a made-up index future priced near ${mid.toLocaleString('en-US')}.</p>
      ${ui.rows([
    ['Smallest move (a tick)', `${c.tickSize.toFixed(2)} = $${c.tickValue.toFixed(2)} a contract`],
    ['A 1-point move', `$${c.pointValue} a contract`],
    [`At MAX (${t.maxContracts} contracts)`, `$${(c.pointValue * t.maxContracts).toLocaleString('en-US')} a point`],
    ['Daily loss limit', ui.money(-t.dailyLossLimit)],
  ])}
      <p><b>Worked example.</b> At MAX, ${pts.toFixed(1)} points against you (about ${(100 * pts / mid).toFixed(1)}% of the price) uses the whole daily limit. At 1 contract it takes ${Math.round(t.dailyLossLimit / c.pointValue)} points.</p>
      <p style="font-size:3.2cqw">Target +${ui.money(t.profitTarget)}, trailing drawdown ${ui.money(t.trailingDrawdown)}, flat by the bell. Size down until you know how it moves.</p>`;
  }
  if (kind === 'options') {
    const t = TIER3;
    const o = t.option;
    const iv = (o.ivMin + o.ivMax) / 2;
    const yr = TRADING_MINUTES_PER_YEAR;
    const open = bs(100, 100, 390 / yr, iv * o.ivPumpAtOpen).call;
    const n = Math.max(1, Math.floor(o.premiumBudget / (open * o.multiplier)));
    const up = bs(102, 100, 195 / yr, iv * (o.ivPumpAtOpen + o.ivEarningsPump) / 2).call;
    const late = bs(100, 100, 30 / yr, iv * o.ivCrush).call;
    const pct = (v) => `${v >= open ? '▲ +' : '▼ −'}${Math.abs(Math.round((v / open - 1) * 100))}%`;
    return `
      <div class="eyebrow">New desk · options</div>
      <h2>${ui.esc(t.name)}</h2>
      <p>Tap <b>CALL</b> if you think the stock rises, <b>PUT</b> if it falls. A contract is ${o.multiplier} shares' worth of premium, and the most you can lose is what you paid.</p>
      ${ui.rows([
    ['$100 stock: a 100 call at the open', `$${open.toFixed(2)} · ${ui.money(open * o.multiplier)} a contract`],
    [`MAX (${ui.money(o.premiumBudget)} budget) buys`, `${n} contracts`],
    ['Stock +2% by noon', `about $${up.toFixed(2)} · ${pct(up)}`, 'up'],
    ['Stock flat at 15:30, after earnings', `about $${late.toFixed(2)} · ${pct(late)}`, 'down'],
  ])}
      <p><b>Why.</b> Premium melts as the day runs, is pumped up before the earnings release, and is crushed the moment it lands, even when you called the direction.</p>
      <p style="font-size:3.2cqw">Target +${ui.money(t.profitTarget)}, daily limit ${ui.money(-t.dailyLossLimit)}. At MAX, a wrong call can cost more than the daily limit.</p>`;
  }
  const T = DAY_TYPES.types;
  return `
    <div class="eyebrow">Guide · day types</div>
    <h2>Not every day is the same</h2>
    <p>About 1 day in ${Math.round(1 / DAY_TYPES.chance)} is one of these. The day-open card says which.</p>
    ${ui.rows([
    [T.gap.name, 'Gapped overnight; the first hour runs hard'],
    [T.fed.name, 'Quiet, then one huge release at 14:00 (options: earnings)'],
    [T.trend.name, 'One direction all day, smaller news'],
    [T.halt.name, `A headline freezes trading ${T.halt.candles * SESSION.candleMinutes} min, then a second jump`],
  ])}`;
}

/** A guide card (first time at a new desk, or replayed from the title). */
function guideCard(kind, next, label = 'Got it') {
  ui.showCard(`${guideHtml(kind)}<button class="cta" data-action="next" style="margin-top:3cqw">${ui.esc(label)}</button>`, { next });
}

function guidesCard(back) {
  ui.showCard(`
    <div class="eyebrow">Guides</div>
    <h2>How the desks work</h2>
    <button class="cta ghost" data-action="tut">Training day (Tier 1)</button>
    <button class="cta ghost" data-action="fut">Futures (Tier 2)</button>
    <button class="cta ghost" data-action="opt">Options (Tier 3)</button>
    <button class="cta ghost" data-action="days">Day types</button>
    <button class="cta small" data-action="back" style="margin-top:3cqw">Back</button>
  `, {
    tut: () => intro(startTutorial),
    fut: () => guideCard('futures', () => guidesCard(back), 'Back'),
    opt: () => guideCard('options', () => guidesCard(back), 'Back'),
    days: () => guideCard('days', () => guidesCard(back), 'Back'),
    back,
  });
}

// ---------- tutorial ----------

function startTutorial() {
  S.run = newRun(TIER1, TUTORIAL.seed, []);
  S.day = newDay(S.run, TIER1);
  S.market = generateDay({ seed: TUTORIAL.seed, script: TUTORIAL.script });
  S.elapsed = 0;
  S.revealed = new Set();
  S.wired = new Set();
  S.lastWarnSec = null;
  S.sizeIndex = 0;
  S.tutorial = createTutorial({
    hold: (h) => { S.hold = h; },
    allow: (list) => { S.allow = list; },
    seekCandle: (c) => seekTo(c * SESSION.ticksPerCandle * TICK_MS),
    seekBellWindow: () => seekTo(DAY_MS - SESSION.bellWarningSeconds * 1000 - 400),
    coach: (target, html, onNext) => ui.showCoach(target, html, onNext),
    hideCoach: () => ui.hideCoach(),
  });
  useRules(TIER1); // after S.run and S.tutorial, so the last career's props and rain don't carry over
  ui.hideCard();
  ui.hideNews();
  ui.setBell(null);
  ui.setPaused(false);
  S.day.tick = -1;
  processTick(0);
  S.phase = 'running';
  S.prevNow = null;
  ui.setTradingEnabled(true);
  setScene('day');
  render();
  S.tutorial.start();
}

function endTutorial() {
  S.tutorial?.stop();
  S.tutorial = null;
  S.hold = false;
  S.allow = null;
}

function finishTutorial(heldAtBell) {
  endTutorial();
  meta = { ...meta, tutorialDone: true };
  saveMeta(meta);
  const saved = loadRun(); // a replay with a career saved: go back to it, never wipe it
  ui.showCard(`
    <div class="eyebrow">Training done</div>
    <h2>${heldAtBell ? 'That would be a firing.' : 'Flat at the bell. Good.'}</h2>
    <p>${heldAtBell ? 'You held through the bell. In a real eval that ends your run on the spot.' : 'That\'s the job: trade the day, respect the rules, be flat by 16:00.'}</p>
    ${saved
    ? `<p>Your career is saved where you left it.</p>
    <button class="cta" data-action="back">Back to the title</button>`
    : `<p>Now the real thing: five days, +$1,500 target, no second chances.</p>
    <button class="cta" data-action="go">Start your eval</button>`}
  `, { go: () => startRun(), back: title });
}

// ---------- boot ----------

function loadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = img.onerror = () => (img.decode ? img.decode().catch(() => {}).then(res) : res());
    img.src = src;
  });
}

const AUDIO_LABEL = { all: 'Sound: music + effects', sfx: 'Sound: effects only', off: 'Sound: off' };

function title() {
  S.phase = 'title';
  setScene('menu');
  endTutorial();
  const saved = loadRun();
  const fresh = !meta.tutorialDone;
  const ch = challengeFor(dateKey());
  let dsaved = loadRun(DAILY_KEY);
  if (dsaved && dsaved.run?.daily?.key !== ch.key) { clearRun(DAILY_KEY); dsaved = null; } // yesterday's, unfinished
  const done = meta.daily?.[ch.key];
  // A date before Daily #1 means the phone's date is wrong: no Daily to offer.
  const early = !dailyOpen(ch.key);
  if (early && dsaved) { clearRun(DAILY_KEY); dsaved = null; }
  const dailyLabel = early ? 'Daily Challenge · check your date'
    : dsaved
    ? `Continue Daily #${ch.n}${dsaved.run.daily.practice ? ' · practice' : ''}`
    : done ? `Daily #${ch.n} · ${ui.signed(done.pnl).text} · share` : `Daily Challenge #${ch.n} · ${TIERS[ch.tier].short}`;
  const contLabel = saved && (saved.run.funded
    ? `Continue · Funded · Week ${saved.run.funded.week}`
    : `Continue · ${tierOf(saved.run).short} · Day ${saved.run.day}`);
  ui.showCard(`
    <div class="eyebrow">Longlight Interactive</div>
    <h1>Funded<span class="dot">.</span></h1>
    <p>The firm gives you $25,000 and five days. Make <b>+$1,500</b>.
      Lose <b>$750</b> in a day, touch the drawdown floor, or hold through the bell, and you're out.
      Pass to move up: $50k futures, then $100k options, then a funded account that pays out weekly.</p>
    <p style="font-size:3.2cqw">Size buys a share of your buying power. News times are marked on the clock.</p>
    ${saved ? `<button class="cta" data-action="cont">${ui.esc(contLabel)}</button>
    <button class="cta ghost" data-action="start">New eval</button>`
    : `<button class="cta" data-action="start">${fresh ? 'Start training day' : 'Start eval'}</button>`}
    ${fresh ? '' : `<button class="cta ghost" data-action="daily">${ui.esc(dailyLabel)}</button>
    <button class="cta ghost" data-action="shop">Perk shop · <span class="rep">${meta.rep} Rep</span></button>
    <div class="cta-row"><button class="cta ghost" data-action="stats">Career stats</button>
    <button class="cta ghost" data-action="guides">Guides</button></div>`}
    <button class="cta ghost small" data-action="audio">${AUDIO_LABEL[audioMode()]}</button>
    <div class="fine">Desktop: B buy · S sell · F flatten · 1–3 size · P pause · M sound</div>
    <a class="hub" href="${ui.esc(STUDIO.hubUrl)}">${ui.esc(STUDIO.hubLabel)}</a>
    <div class="ver">v${ui.esc(VERSION)}</div>
  `, {
    audio: () => { cycleAudioMode(); title(); },
    start: () => (fresh ? intro(startTutorial) : newCareer()),
    cont: () => intro(() => resumeSaved(saved)),
    daily: () => (early ? dailyEarlyCard() : dsaved ? intro(() => resumeSaved(dsaved)) : dailyCard(ch)),
    shop: () => shop(title),
    stats: () => statsCard(title),
    guides: () => guidesCard(title),
  }, { cls: 'title-card', clear: true });
}

// The rendered intro move (STUDIO.introVideo). Loaded at boot; if it isn't
// ready, fails, or the player asks for reduced motion, the CSS zoom runs instead.
let introReady = false;
function prepIntroVideo() {
  const v = document.getElementById('bgIntro');
  if (!STUDIO.introVideo || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  v.addEventListener('canplaythrough', () => { introReady = true; }, { once: true });
  v.addEventListener('error', () => { introReady = false; }, { once: true });
  v.src = STUDIO.introVideo;
}

function playIntroVideo(next) {
  const v = document.getElementById('bgIntro');
  const frame = document.getElementById('frame');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    frame.removeEventListener('pointerdown', finish);
    window.removeEventListener('keydown', finish);
    ui.setFrameMode('desk', 'ui');
    // Keep .vid a moment so the desk appears at once instead of with the CSS fade.
    setTimeout(() => frame.classList.remove('vid'), 200);
    v.pause();
    next();
  };
  const guard = setTimeout(finish, ((v.duration || 3) + 2) * 1000); // never hang on a stalled clip
  v.addEventListener('ended', finish, { once: true });
  frame.addEventListener('pointerdown', finish); // tap or any key skips
  window.addEventListener('keydown', finish);
  v.currentTime = 0;
  v.play().then(() => frame.classList.add('vid')).catch(() => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    frame.removeEventListener('pointerdown', finish);
    window.removeEventListener('keydown', finish);
    cssIntro(next);
  });
}

function intro(next) {
  unlockAudio();
  ui.hideCard();
  S.phase = 'intro';
  if (document.getElementById('frame').classList.contains('desk')) { next(); return; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (introReady && !reduce) { playIntroVideo(next); return; }
  cssIntro(next);
}

function cssIntro(next) {
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--intro-ms')) || 1200;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  ui.setFrameMode('intro');
  setTimeout(() => {
    ui.setFrameMode('desk', 'ui');
    next();
  }, reduce ? 50 : ms);
}

async function boot() {
  ui.initUI({
    onBuy: () => trade(1),
    onSell: () => trade(-1),
    onFlat: flatten,
    onSize: (i) => {
      if (i >= RULES.sizes.length) return; // Max Only leaves one size
      S.sizeIndex = i;
      if (S.run) S.dirty = true;
      if (S.phase !== 'running' && S.run && S.day) render();
    },
    onPause: pause,
    onResume: resume,
    onTogglePause: () => (S.phase === 'running' ? pause() : resume()),
    onAudio: () => { cycleAudioMode(); if (S.phase === 'title') title(); },
  });
  chart = new Chart(document.getElementById('chart'));
  initClicker();
  // Card art that fails to load is dropped, leaving the plain text card.
  document.getElementById('card').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  // Only the title's own backdrop holds up the title. The desk and the intro
  // clip load after it, so a slow phone connection gets to the menu sooner.
  await loadImage('assets/wide.jpg');
  const desk = document.getElementById('bgDesk');
  if (!desk.getAttribute('src')) desk.src = desk.dataset.src;
  requestAnimationFrame(frame);
  title();
  const later = () => { prepIntroVideo(); registerOffline(); };
  if (document.readyState === 'complete') setTimeout(later, 0);
  else window.addEventListener('load', later, { once: true });
}

// Offline play: sw.js keeps the game's files so the home-screen app opens
// with no signal. The version in its address makes each release install fresh.
function registerOffline() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(VERSION)}`).catch(() => { /* play on without it */ });
}

boot();

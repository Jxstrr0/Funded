// Boot, intro, and the game state machine.
import { TIER1, SESSION } from './config.js';
import { generateDay, candlesUpTo, hashSeed } from './engine.js';
import { newRun, newDay, applyFill, orderDelta, snapshot, closeDay, RULE_TEXT } from './rules.js';
import { Chart } from './chart.js';
import * as ui from './ui.js';
import { unlockAudio, sfx } from './audio.js';
import { loadRun, saveRun, clearRun } from './save.js';

const RULES = TIER1;
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
};

let chart;

// ---------- helpers ----------

const price = () => S.market.ticks[Math.max(0, S.day.tick)];
const minuteNow = () => SESSION.marketOpenMinute + (S.elapsed / DAY_MS) * SESSION.marketMinutes;
const newsTimes = () => S.market.news.map((n) => ui.clockText(SESSION.marketOpenMinute + n.candle * SESSION.candleMinutes)).join(' · ');

function render() {
  const last = price();
  ui.renderMarket({ ticker: S.market.ticker, last, open: S.market.open, minute: minuteNow(), day: S.run.day, evalDays: RULES.evalDays });
  const snap = snapshot(S.run, S.day, last, RULES);
  ui.renderDesk(snap, S.day, S.sizeIndex);
  chart.draw({
    candles: S.day.tick >= 0 ? candlesUpTo(S.market, S.day.tick) : [],
    last,
    avg: S.day.qty ? S.day.avg : null,
    qty: S.day.qty,
    news: S.market.news.map((n) => ({ candle: n.candle, dir: n.dir, revealed: S.revealed.has(n.tick) })),
  });
  S.dirty = false;
  return snap;
}

// ---------- saving ----------

// Saves the run, plus the day in progress while trading, so a reload resumes
// the same day at the same moment (paused, chart covered).
let lastSave = 0;
function persist(force = false) {
  if (!S.run) return;
  const now = performance.now();
  if (!force && now - lastSave < 250) return;
  lastSave = now;
  const inDay = S.phase === 'running' || S.phase === 'paused';
  saveRun(S.run, inDay ? { day: S.day, elapsed: S.elapsed, revealed: [...S.revealed] } : null, S.sizeIndex);
}

function resumeSaved(data) {
  S.run = data.run;
  S.sizeIndex = data.sizeIndex ?? RULES.defaultSizeIndex;
  if (!data.live) { openDay(); return; }
  S.day = data.live.day;
  S.market = generateDay({ seed: hashSeed(S.run.seed, S.run.day), dayStartBalance: S.day.startBalance, rules: RULES });
  S.elapsed = data.live.elapsed;
  S.revealed = new Set(data.live.revealed);
  S.lastWarnSec = null;
  ui.hideCard();
  ui.hideNews();
  ui.setBell(null);
  S.phase = 'paused';
  ui.setPaused(true);
  ui.setTradingEnabled(false);
  render();
}

// ---------- orders ----------

function trade(side) {
  if (S.phase !== 'running') return;
  const p = price();
  const delta = orderDelta(S.day, side, RULES.sizes[S.sizeIndex].share, p);
  if (delta === 0) { sfx.denied(); ui.flashDenied('MAX SIZE'); setTimeout(() => (S.dirty = true), 500); return; }
  fill(delta, p);
  side > 0 ? sfx.buy() : sfx.sell();
}

function flatten() {
  if (S.phase !== 'running' || S.day.qty === 0) return;
  fill(-S.day.qty, price());
  sfx.flat();
}

function fill(delta, p) {
  const r = applyFill(S.day.qty, S.day.avg, delta, p);
  S.day.qty = r.qty;
  S.day.avg = r.avg;
  S.day.realized += r.realized;
  S.day.trades += 1;
  S.dirty = true;
  persist(true);
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
  }
  const snap = snapshot(S.run, S.day, S.market.ticks[i], RULES);
  if (snap.breach) { fire(snap.breach); return false; }
  return true;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (S.phase !== 'running') { S.prevNow = null; return; }
  if (S.prevNow == null) S.prevNow = now;
  const dt = Math.min(now - S.prevNow, SESSION.maxFrameMs) * SPEED;
  S.prevNow = now;
  S.elapsed = Math.min(DAY_MS, S.elapsed + dt);

  const target = Math.min(N_TICKS - 1, Math.floor(S.elapsed / TICK_MS));
  for (let i = S.day.tick + 1; i <= target; i++) {
    if (!processTick(i)) return;
    S.dirty = true;
  }

  // Bell countdown.
  const left = Math.ceil((DAY_MS - S.elapsed) / 1000);
  if (left <= SESSION.bellWarningSeconds && left > 0) {
    ui.setBell(left, S.day.qty !== 0);
    if (left !== S.lastWarnSec) { S.lastWarnSec = left; sfx.warn(S.day.qty !== 0); }
  }

  if (S.dirty) { render(); persist(); }
  else ui.renderMarket({ ticker: S.market.ticker, last: price(), open: S.market.open, minute: minuteNow(), day: S.run.day, evalDays: RULES.evalDays });

  if (S.elapsed >= DAY_MS) closingBell();
}

// ---------- pause ----------

function pause() {
  if (S.phase !== 'running') return;
  S.phase = 'paused';
  ui.setPaused(true);
  ui.setTradingEnabled(false);
  persist(true);
}

function resume() {
  if (S.phase !== 'paused') return;
  unlockAudio();
  S.phase = 'running';
  S.prevNow = null;
  ui.setPaused(false);
  ui.setTradingEnabled(true);
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);

// ---------- flow ----------

function startRun() {
  clearRun();
  S.run = newRun(RULES);
  openDay();
}

function openDay() {
  S.day = newDay(S.run, RULES);
  S.market = generateDay({ seed: hashSeed(S.run.seed, S.run.day), dayStartBalance: S.day.startBalance, rules: RULES });
  S.elapsed = 0;
  S.revealed = new Set();
  S.lastWarnSec = null;
  S.phase = 'dayopen';
  ui.hideNews();
  ui.setBell(null);
  ui.setPaused(false);
  ui.setTradingEnabled(false);
  render();
  persist(true);

  const r = S.run;
  const counted = `${r.daysCounted} of ${RULES.minTradingDays}`;
  ui.showCard(`
    <div class="eyebrow">Day ${r.day} of ${RULES.evalDays}</div>
    <h2>${ui.esc(S.market.ticker)} <span style="font-weight:500;color:rgba(250,249,245,.6)">opens $${S.market.open.toFixed(2)}</span></h2>
    <p>News at <b>${newsTimes()}</b>. Marked on the clock.</p>
    ${ui.rows([
      ['Balance', ui.money(r.balance)],
      ['Buying power (3.33x)', ui.money(S.day.buyingPower)],
      ['Daily loss limit', ui.money(-RULES.dailyLossLimit)],
      ['Drawdown floor', ui.money(r.floor)],
      ['Target balance', ui.money(RULES.startBalance + RULES.profitTarget)],
      ['Trading days counted', counted],
    ])}
    <button class="cta" data-action="go">Open the market</button>
    <div class="fine">Be flat by the 16:00 bell or you're fired.</div>
  `, { go: beginDay });
}

function beginDay() {
  unlockAudio();
  ui.hideCard();
  S.day.tick = -1;
  processTick(0);
  S.phase = 'running';
  S.prevNow = null;
  ui.setTradingEnabled(true);
  render();
  persist(true);
}

function closingBell() {
  S.phase = 'over';
  ui.setBell(null);
  ui.setTradingEnabled(false);
  sfx.bell();
  if (S.day.qty !== 0) { fire('flatAtBell'); return; }

  const { run, outcome, result } = closeDay(S.run, S.day, RULES);
  const prevFloor = S.run.floor;
  S.run = run;
  if (outcome === 'next') persist(true);
  else clearRun();
  if (outcome === 'pass') return passed();
  if (outcome === 'failTarget' || outcome === 'failMinDays') return evalOver(outcome === 'failTarget' ? 'target' : 'minDays');

  const pnl = ui.signed(result.pnl);
  const toTarget = RULES.startBalance + RULES.profitTarget - run.balance;
  ui.showCard(`
    <div class="eyebrow">Day ${result.day} closed</div>
    <h2 class="${pnl.cls}">${pnl.text}</h2>
    <p>${result.counted ? 'Day counted toward your minimum.' : 'No trades today, so this day did not count.'}</p>
    ${ui.rows([
      ['Balance', ui.money(run.balance)],
      ['Trading days counted', `${run.daysCounted} of ${RULES.minTradingDays}`],
      [toTarget > 0 ? 'Still to target' : 'Target', toTarget > 0 ? ui.money(toTarget) : 'Reached, hold it', toTarget > 0 ? '' : 'up'],
      ['Drawdown floor', run.floor !== prevFloor ? `${ui.money(prevFloor)} → ${ui.money(run.floor)}` : ui.money(run.floor)],
      ['Days left', String(RULES.evalDays - result.day)],
    ])}
    <button class="cta" data-action="next">Next day</button>
  `, { next: openDay });
}

function fire(rule) {
  S.phase = 'over';
  clearRun();
  ui.setBell(null);
  ui.setTradingEnabled(false);
  ui.shake();
  sfx.fired();
  render();
  const t = RULE_TEXT[rule];
  const snap = snapshot(S.run, S.day, price(), RULES);
  ui.showCard(`
    <div class="eyebrow">Day ${S.run.day} · ${ui.clockText(minuteNow())}</div>
    <h1 class="fired">You're fired.</h1>
    <div class="rule-name">${ui.esc(t.name)}</div>
    <p>${ui.esc(t.detail(RULES))}</p>
    ${ui.rows([
      ['Equity at the time', ui.money(snap.equity)],
      ['Day P&L', ui.signed(snap.dayPnl).text, ui.signed(snap.dayPnl).cls],
      ['Days survived', String(S.run.day - 1)],
    ])}
    <button class="cta" data-action="again">New eval</button>
  `, { again: startRun });
}

function evalOver(rule) {
  sfx.fired();
  const t = RULE_TEXT[rule];
  ui.showCard(`
    <div class="eyebrow">Eval over</div>
    <h1 class="fired">Not funded.</h1>
    <div class="rule-name">${ui.esc(t.name)}</div>
    <p>${ui.esc(t.detail(RULES))}</p>
    ${ui.rows([
      ['Final balance', ui.money(S.run.balance)],
      ['Total P&L', ui.signed(S.run.balance - RULES.startBalance).text, ui.signed(S.run.balance - RULES.startBalance).cls],
      ['Trading days counted', `${S.run.daysCounted} of ${RULES.minTradingDays}`],
    ])}
    <button class="cta" data-action="again">New eval</button>
  `, { again: startRun });
}

function passed() {
  sfx.pass();
  const r = S.run;
  ui.showCard(`
    <div class="eyebrow">Eval passed</div>
    <h1>Funded<span class="dot">.</span></h1>
    <p>You passed ${ui.esc(RULES.name)} in ${r.history.length} days without breaking a rule.</p>
    ${ui.rows([
      ['Final balance', ui.money(r.balance)],
      ['Total P&L', ui.signed(r.balance - RULES.startBalance).text, 'up'],
      ['Trading days', String(r.daysCounted)],
    ])}
    <button class="cta" data-action="again">New eval</button>
    <div class="fine">The career ladder arrives in a later stage.</div>
  `, { again: startRun });
}

// ---------- boot ----------

function loadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = img.onerror = () => (img.decode ? img.decode().catch(() => {}).then(res) : res());
    img.src = src;
  });
}

function title() {
  S.phase = 'title';
  const saved = loadRun();
  ui.showCard(`
    <div class="eyebrow">Longlight Interactive</div>
    <h1>Funded<span class="dot">.</span></h1>
    <p>The firm gives you $25,000 and five days. Make <b>+$1,500</b>.
      Lose <b>$750</b> in a day, touch the drawdown floor, or hold through the bell, and you're out.</p>
    <p style="font-size:3.2cqw">Size buys a share of your buying power. News times are marked on the clock.</p>
    ${saved ? `<button class="cta" data-action="cont">Continue · Day ${saved.run.day} of ${RULES.evalDays}</button>
    <button class="cta ghost" data-action="start">New eval</button>`
    : '<button class="cta" data-action="start">Start eval</button>'}
    <div class="fine">Desktop: B buy · S sell · F flatten · 1–3 size · P pause</div>
  `, { start: () => intro(startRun), cont: () => intro(() => resumeSaved(saved)) }, { cls: 'title-card', clear: true });
}

function intro(next) {
  unlockAudio();
  ui.hideCard();
  S.phase = 'intro';
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
    onSize: (i) => { S.sizeIndex = i; if (S.run) S.dirty = true; if (S.phase !== 'running' && S.run) render(); },
    onPause: pause,
    onResume: resume,
    onTogglePause: () => (S.phase === 'running' ? pause() : resume()),
  });
  chart = new Chart(document.getElementById('chart'));
  await Promise.all([loadImage('assets/wide.png'), loadImage('assets/desk.png')]);
  requestAnimationFrame(frame);
  title();
}

boot();

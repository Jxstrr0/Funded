// Boot, intro, and the game state machine.
import { TIER1, TIERS, SESSION, PERKS, TUTORIAL } from './config.js';
import { generateDay, candlesUpTo, hashSeed, bookAt } from './engine.js';
import { newRun, newDay, applyFill, orderDelta, snapshot, closeDay, RULE_TEXT, effectiveRules, applyMulligan } from './rules.js';
import { loadMeta, saveMeta, reputationFor, buyPerk, canBuy } from './meta.js';
import { createTutorial } from './tutorial.js';
import { Chart } from './chart.js';
import * as ui from './ui.js';
import { unlockAudio, sfx, setScene, audioMode, cycleAudioMode } from './audio.js';
import { loadRun, saveRun, clearRun } from './save.js';

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
};

let meta = loadMeta();
const has = (perk) => !S.tutorial && S.run?.perks?.includes(perk);

let chart;
const tierOf = (run) => TIERS[run?.tier] || TIER1;

/** Switch the active tier's rules (with the run's perks) and its size buttons. */
function useRules(rules) {
  RULES = rules;
  ui.setSizes(RULES.sizes);
}

// ---------- helpers ----------

const price = () => S.market.ticks[Math.max(0, S.day.tick)];
const minuteNow = () => SESSION.marketOpenMinute + (S.elapsed / DAY_MS) * SESSION.marketMinutes;
const dayLabel = () => (S.tutorial ? 'Training' : `Day ${S.run.day} of ${RULES.evalDays}`);
const allowed = (kind) => !S.allow || S.allow.includes(kind);
const newsTimes = () => S.market.news.map((n) => ui.clockText(SESSION.marketOpenMinute + n.candle * SESSION.candleMinutes)).join(' · ');

function render() {
  const last = price();
  ui.renderMarket({ ticker: S.market.ticker, last, open: S.market.open, minute: minuteNow(), dayLabel: dayLabel() });
  ui.renderL2(has('level2') && S.day.tick >= 0 ? bookAt(S.market, S.day.tick) : null);
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
  if (!S.run || S.tutorial) return;
  const now = performance.now();
  if (!force && now - lastSave < 250) return;
  lastSave = now;
  const inDay = S.phase === 'running' || S.phase === 'paused';
  saveRun(S.run, inDay ? { day: S.day, elapsed: S.elapsed, revealed: [...S.revealed] } : null, S.sizeIndex);
}

function resumeSaved(data) {
  S.run = data.run;
  useRules(effectiveRules(S.run.perks || [], tierOf(S.run)));
  S.sizeIndex = Math.min(data.sizeIndex ?? RULES.defaultSizeIndex, RULES.sizes.length - 1);
  if (!data.live) { openDay(); return; }
  S.day = data.live.day;
  S.market = generateDay({ seed: hashSeed(S.run.seed, S.run.day), dayStartBalance: S.day.startBalance, rules: RULES });
  S.elapsed = data.live.elapsed;
  S.revealed = new Set(data.live.revealed);
  S.wired = new Set(data.live.revealed);
  S.lastWarnSec = null;
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
  const p = price();
  const delta = orderDelta(S.day, side, RULES.sizes[S.sizeIndex], p);
  if (delta === 0) { sfx.denied(); ui.flashDenied('MAX SIZE'); setTimeout(() => (S.dirty = true), 500); return; }
  fill(delta, p);
  side > 0 ? sfx.buy() : sfx.sell();
  S.tutorial?.onTrade(side > 0 ? 'buy' : 'sell');
}

function flatten() {
  if (S.phase !== 'running' || S.day.qty === 0 || !allowed('flat')) return;
  fill(-S.day.qty, price());
  sfx.flat();
  S.tutorial?.onTrade('flat');
}

function fill(delta, p) {
  const r = applyFill(S.day.qty, S.day.avg, delta, p, S.day.mult ?? 1);
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
    S.tutorial?.onNews();
  }
  if (S.tutorial || S.day.locked) return true; // no firing in training or on a locked desk
  const snap = snapshot(S.run, S.day, S.market.ticks[i], RULES);
  if (snap.breach) return breach(snap.breach);
  return true;
}

/** A rule broke. Mulligan forgives it once per eval; otherwise you're fired. Returns true if play continues. */
function breach(rule) {
  if (S.run.mulligans > 0) { useMulligan(rule); return true; }
  fire(rule);
  return false;
}

function useMulligan(rule) {
  if (S.day.qty) {
    const r = applyFill(S.day.qty, S.day.avg, -S.day.qty, price(), S.day.mult ?? 1);
    S.day.qty = r.qty; S.day.avg = r.avg; S.day.realized += r.realized;
  }
  S.run = applyMulligan(S.run, S.day.startBalance + S.day.realized, RULES);
  S.day.locked = true;
  ui.setTradingEnabled(false);
  ui.shake();
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
  const dt = Math.min(now - S.prevNow, SESSION.maxFrameMs) * SPEED;
  S.prevNow = now;
  S.elapsed = Math.min(DAY_MS, S.elapsed + dt);

  const target = Math.min(N_TICKS - 1, Math.floor(S.elapsed / TICK_MS));
  for (let i = S.day.tick + 1; i <= target; i++) {
    if (!processTick(i)) return;
    S.dirty = true;
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
  const left = Math.ceil((DAY_MS - S.elapsed) / 1000);
  if (left <= SESSION.bellWarningSeconds && left > 0) {
    ui.setBell(left, S.day.qty !== 0);
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
  setScene('quiet');
  persist(true);
}

function resume() {
  if (S.phase !== 'paused') return;
  unlockAudio();
  S.phase = 'running';
  S.prevNow = null;
  ui.setPaused(false);
  ui.setTradingEnabled(!S.day.locked);
  setScene('day');
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);

// ---------- flow ----------

/** Start an eval. A new career starts at Tier 1 with the perks owned now. */
function startRun(tierId = 'tier1', perks = meta.owned) {
  clearRun();
  endTutorial();
  useRules(effectiveRules(perks, TIERS[tierId]));
  S.run = newRun(RULES, undefined, perks);
  S.sizeIndex = RULES.defaultSizeIndex;
  openDay();
}

function openDay() {
  S.day = newDay(S.run, RULES);
  S.market = generateDay({ seed: hashSeed(S.run.seed, S.run.day), dayStartBalance: S.day.startBalance, rules: RULES });
  S.elapsed = 0;
  S.revealed = new Set();
  S.wired = new Set();
  S.lastWarnSec = null;
  S.phase = 'dayopen';
  setScene('menu');
  ui.hideNews();
  ui.setBell(null);
  ui.setPaused(false);
  ui.setTradingEnabled(false);
  render();
  persist(true);

  const r = S.run;
  const counted = `${r.daysCounted} of ${RULES.minTradingDays}`;
  ui.showCard(`
    <div class="eyebrow">${ui.esc(RULES.name.split(' · ')[0])} · Day ${r.day} of ${RULES.evalDays}</div>
    <h2>${ui.esc(S.market.ticker)} <span style="font-weight:500;color:rgba(250,249,245,.6)">opens $${S.market.open.toFixed(2)}</span></h2>
    <p>News at <b>${newsTimes()}</b>. Marked on the clock.</p>
    ${RULES.contract && r.day === 1 ? `<p>Futures: you trade whole <b>contracts</b>. Every ${RULES.contract.tickSize.toFixed(2)} tick is <b>$${RULES.contract.tickValue.toFixed(2)}</b> a contract. Max is ${RULES.maxContracts}, and it moves fast.</p>` : ''}
    ${ui.rows([
      ['Balance', ui.money(r.balance)],
      ...(RULES.contract
        ? [['Contract', `${RULES.contract.symbol} · $${RULES.contract.pointValue} a point`], ['Max position', `${RULES.maxContracts} contracts`]]
        : [[`Buying power (${RULES.buyingPowerMultiplier}x)`, ui.money(S.day.buyingPower)]]),
      ['Daily loss limit', ui.money(-RULES.dailyLossLimit)],
      ['Drawdown floor', ui.money(r.floor)],
      ['Target balance', ui.money(RULES.startBalance + RULES.profitTarget)],
      ['Trading days counted', counted],
      ...(r.perks.length ? [['Perks', r.perks.map((id) => PERKS.find((p) => p.id === id).name).join(', ') + (r.perks.includes('mulligan') ? ` (${r.mulligans} mulligan left)` : '')]] : []),
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
  setScene('day');
  render();
  persist(true);
}

function closingBell() {
  S.phase = 'over';
  ui.setBell(null);
  ui.setTradingEnabled(false);
  sfx.bell();
  setScene('menu');
  if (S.tutorial) return finishTutorial(S.day.qty !== 0);
  if (S.day.qty !== 0 && !breach('flatAtBell')) return;

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
  setScene('menu');
  render();
  const t = RULE_TEXT[rule];
  const snap = snapshot(S.run, S.day, price(), RULES);
  const rep = award(false);
  ui.showCard(`
    <div class="eyebrow">Day ${S.run.day} · ${ui.clockText(minuteNow())}</div>
    <h1 class="fired">You're fired.</h1>
    <div class="rule-name">${ui.esc(t.name)}</div>
    <p>${ui.esc(t.detail(RULES))}</p>
    ${careerNote()}
    ${ui.rows([
      ['Equity at the time', ui.money(snap.equity)],
      ['Day P&L', ui.signed(snap.dayPnl).text, ui.signed(snap.dayPnl).cls],
      ['Days survived', String(S.run.day - 1)],
      ...repRows(rep),
    ])}
    <button class="cta" data-action="again">New eval</button>
    <button class="cta ghost" data-action="shop">Perk shop</button>
  `, { again: () => startRun(), shop: () => shop(() => startRun()) });
}

function evalOver(rule) {
  sfx.fired();
  const t = RULE_TEXT[rule];
  const rep = award(false);
  ui.showCard(`
    <div class="eyebrow">Eval over</div>
    <h1 class="fired">Not funded.</h1>
    <div class="rule-name">${ui.esc(t.name)}</div>
    <p>${ui.esc(t.detail(RULES))}</p>
    ${careerNote()}
    ${ui.rows([
      ['Final balance', ui.money(S.run.balance)],
      ['Total P&L', ui.signed(S.run.balance - RULES.startBalance).text, ui.signed(S.run.balance - RULES.startBalance).cls],
      ['Trading days counted', `${S.run.daysCounted} of ${RULES.minTradingDays}`],
      ...repRows(rep),
    ])}
    <button class="cta" data-action="again">New eval</button>
    <button class="cta ghost" data-action="shop">Perk shop</button>
  `, { again: () => startRun(), shop: () => shop(() => startRun()) });
}

function careerNote() {
  return S.run.tier !== 'tier1' ? '<p style="font-size:3.2cqw">Your next career starts back at Tier 1. Rep and perks stay.</p>' : '';
}

function passed() {
  sfx.pass();
  const r = S.run;
  const rep = award(true);
  if (RULES.next) return promoted(r, rep);
  ui.showCard(`
    <div class="eyebrow">Eval passed</div>
    <h1>Funded<span class="dot">.</span></h1>
    <p>You passed ${ui.esc(RULES.name)} in ${r.history.length} days without breaking a rule.</p>
    ${ui.rows([
      ['Final balance', ui.money(r.balance)],
      ['Total P&L', ui.signed(r.balance - RULES.startBalance).text, 'up'],
      ['Trading days', String(r.daysCounted)],
      ...repRows(rep),
    ])}
    <button class="cta" data-action="again">New eval</button>
    <button class="cta ghost" data-action="shop">Perk shop</button>
    <div class="fine">Top of the ladder for now. The options desk opens in a later stage.</div>
  `, { again: () => startRun(), shop: () => shop(() => startRun()) });
}

/** Passed a tier with another above it: the career moves up. Saved straight
 * away, so a reload continues at the new tier's first day. */
function promoted(r, rep) {
  const next = TIERS[RULES.next];
  const perks = r.perks;
  const from = RULES;
  S.run = newRun(effectiveRules(perks, next), undefined, perks);
  persist(true);
  ui.showCard(`
    <div class="eyebrow">Eval passed · promoted</div>
    <h1>Funded<span class="dot">.</span></h1>
    <p>You passed ${ui.esc(from.name)} in ${r.history.length} days. The desk moves you up to <b>${ui.esc(next.name)}</b>.</p>
    ${ui.rows([
      ['Final balance', ui.money(r.balance)],
      ['Total P&L', ui.signed(r.balance - from.startBalance).text, 'up'],
      ['Next account', ui.money(next.startBalance)],
      ['Next target', `+${ui.money(next.profitTarget)}`],
      ...repRows(rep),
    ])}
    <button class="cta" data-action="go">Start ${ui.esc(next.short)}</button>
    <div class="fine">Get fired up there and the next career starts at Tier 1.</div>
  `, { go: () => { useRules(effectiveRules(perks, next)); S.sizeIndex = RULES.defaultSizeIndex; openDay(); } });
}

// ---------- reputation and perks ----------

function award(passedEval) {
  const rep = reputationFor(S.run.history, passedEval);
  meta = { ...meta, rep: meta.rep + rep.total, runs: meta.runs + 1, passes: meta.passes + (passedEval ? 1 : 0) };
  saveMeta(meta);
  if (rep.total > 0) setTimeout(sfx.rep, 1200);
  return rep;
}

function repRows(rep) {
  return [
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
  for (const p of PERKS) actions['buy_' + p.id] = () => { meta = buyPerk(meta, p.id); saveMeta(meta); sfx.pass(); shop(back); };
  ui.showCard(`
    <div class="eyebrow">Perk shop</div>
    <h2>You have <span class="rep">${meta.rep} Rep</span></h2>
    <p style="font-size:3.2cqw">Perks are permanent and apply from your next new eval. Earn Rep every run, even when you're fired.</p>
    ${list}
    <button class="cta" data-action="back" style="margin-top:4cqw">Done</button>
  `, actions);
}

// ---------- tutorial ----------

function startTutorial() {
  useRules(TIER1);
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
  ui.showCard(`
    <div class="eyebrow">Training done</div>
    <h2>${heldAtBell ? 'That would be a firing.' : 'Flat at the bell. Good.'}</h2>
    <p>${heldAtBell ? 'You held through the bell. In a real eval that ends your run on the spot.' : 'That\'s the job: trade the day, respect the rules, be flat by 16:00.'}</p>
    <p>Now the real thing: five days, +$1,500 target, no second chances.</p>
    <button class="cta" data-action="go">Start your eval</button>
  `, { go: () => startRun() });
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
  ui.showCard(`
    <div class="eyebrow">Longlight Interactive</div>
    <h1>Funded<span class="dot">.</span></h1>
    <p>The firm gives you $25,000 and five days. Make <b>+$1,500</b>.
      Lose <b>$750</b> in a day, touch the drawdown floor, or hold through the bell, and you're out.
      Pass, and you move up to the $50k futures desk.</p>
    <p style="font-size:3.2cqw">Size buys a share of your buying power. News times are marked on the clock.</p>
    ${saved ? `<button class="cta" data-action="cont">Continue · ${ui.esc(tierOf(saved.run).short)} · Day ${saved.run.day}</button>
    <button class="cta ghost" data-action="start">New eval</button>`
    : `<button class="cta" data-action="start">${fresh ? 'Start training day' : 'Start eval'}</button>`}
    ${fresh ? '' : `<button class="cta ghost" data-action="shop">Perk shop · <span class="rep">${meta.rep} Rep</span></button>
    <button class="cta ghost" data-action="tut">Replay tutorial</button>`}
    <button class="cta ghost small" data-action="audio">${AUDIO_LABEL[audioMode()]}</button>
    <div class="fine">Desktop: B buy · S sell · F flatten · 1–3 size · P pause · M sound</div>
  `, {
    audio: () => { cycleAudioMode(); title(); },
    start: () => intro(fresh ? startTutorial : () => startRun()),
    cont: () => intro(() => resumeSaved(saved)),
    shop: () => shop(title),
    tut: () => intro(startTutorial),
  }, { cls: 'title-card', clear: true });
}

function intro(next) {
  unlockAudio();
  ui.hideCard();
  S.phase = 'intro';
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--intro-ms')) || 1200;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.getElementById('frame').classList.contains('desk')) { next(); return; }
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
    onAudio: () => { cycleAudioMode(); if (S.phase === 'title') title(); },
  });
  chart = new Chart(document.getElementById('chart'));
  await Promise.all([loadImage('assets/wide.jpg'), loadImage('assets/desk.jpg')]);
  requestAnimationFrame(frame);
  title();
}

boot();

// DOM for the monitor overlays and full-frame cards. No game logic here.
import { TIER1, SESSION } from './config.js';

const $ = (id) => document.getElementById(id);
const MINUS = '−';

// ---------- formatting ----------

export function money(v, cents = false) {
  const a = Math.abs(v);
  const s = a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (v < 0 ? MINUS : '') + '$' + s;
}

/** Signed P&L with arrow: "▲ +$120" / "▼ −$45" / "$0". Never colour alone. */
export function signed(v, cents = false) {
  const r = cents ? Math.round(v * 100) / 100 : Math.round(v);
  if (r === 0) return { text: '$0', cls: '' };
  const a = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return r > 0 ? { text: `▲ +$${a}`, cls: 'up' } : { text: `▼ ${MINUS}$${a}`, cls: 'down' };
}

export function signedPct(v) {
  const r = Math.round(v * 10000) / 100;
  if (r === 0) return { text: '0.00%', cls: '' };
  return r > 0 ? { text: `▲ +${r.toFixed(2)}%`, cls: 'up' } : { text: `▼ ${MINUS}${Math.abs(r).toFixed(2)}%`, cls: 'down' };
}

export function clockText(minute) {
  const m = Math.min(Math.floor(minute), SESSION.marketOpenMinute + SESSION.marketMinutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- setup ----------

let el = {};

export function initUI(handlers) {
  el = {
    frame: $('frame'),
    screens: [$('screenTop'), $('screenBottom')],
    sym: $('sym'), px: $('px'), chg: $('chg'), clock: $('clock'), dayNum: $('dayNum'),
    pauseBtn: $('pauseBtn'), paused: $('paused'),
    news: $('newsBanner'), bell: $('bell'),
    bal: $('bal'), dayPnl: $('dayPnl'), pos: $('pos'),
    mLoss: $('mLoss'), mDd: $('mDd'), mTgt: $('mTgt'),
    sizes: $('sizes'),
    buy: $('buyBtn'), sell: $('sellBtn'), flat: $('flatBtn'),
    cardLayer: $('cardLayer'), card: $('card'),
  };

  // Size selector.
  TIER1.sizes.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.setAttribute('role', 'radio');
    b.dataset.i = i;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.onSize(i); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handlers.onSize(i); });
    el.sizes.appendChild(b);
  });

  // Orders fill on pointerdown. Keyboard still works via Enter/Space.
  const bind = (btn, fn) => {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      press(btn);
      fn();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(btn); fn(); }
    });
  };
  bind(el.buy, handlers.onBuy);
  bind(el.sell, handlers.onSell);
  bind(el.flat, handlers.onFlat);

  el.pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.onPause(); });
  el.paused.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.onResume(); });

  // Desktop keys: B / S / F, 1-3 for size, P or Space to pause.
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.closest('button')) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { press(el.buy); handlers.onBuy(); }
    else if (k === 's') { press(el.sell); handlers.onSell(); }
    else if (k === 'f') { press(el.flat); handlers.onFlat(); }
    else if (k >= '1' && k <= '3') handlers.onSize(Number(k) - 1);
    else if (k === 'p' || k === ' ') { e.preventDefault(); handlers.onTogglePause(); }
  });
}

function press(btn) {
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 90);
  navigator.vibrate?.(8);
}

// ---------- frame / intro ----------

export function setFrameMode(...classes) {
  el.frame.classList.add(...classes);
}

export function shake() {
  for (const s of el.screens) {
    s.classList.remove('shake');
    void s.offsetWidth;
    s.classList.add('shake');
  }
}

// ---------- top monitor ----------

export function renderMarket({ ticker, last, open, minute, day, evalDays }) {
  el.sym.textContent = ticker;
  el.px.textContent = last.toFixed(2);
  const c = signedPct(last / open - 1);
  el.chg.textContent = c.text;
  el.chg.className = 'chg ' + c.cls;
  el.clock.textContent = clockText(minute);
  el.dayNum.textContent = `Day ${day} of ${evalDays}`;
}

let newsTimer = 0;
export function showNews(ev) {
  el.news.hidden = false;
  el.news.className = 'news-banner ' + (ev.dir > 0 ? 'up' : 'down');
  el.news.textContent = `${ev.dir > 0 ? '▲' : '▼'} NEWS: ${ev.headline}`;
  // restart the flash animation
  el.news.style.animation = 'none'; void el.news.offsetWidth; el.news.style.animation = '';
  clearTimeout(newsTimer);
  newsTimer = setTimeout(() => { el.news.hidden = true; }, 5000);
}
export function hideNews() { clearTimeout(newsTimer); el.news.hidden = true; }

export function setBell(secondsLeft, holding) {
  if (secondsLeft == null) {
    el.bell.hidden = true;
    el.clock.classList.remove('pulse');
    return;
  }
  el.bell.hidden = false;
  el.bell.textContent = `BELL 0:${String(secondsLeft).padStart(2, '0')}${holding ? ' · FLATTEN' : ''}`;
  el.bell.className = 'bell' + (holding ? ' hot' : '');
  el.clock.classList.add('pulse');
}

export function setPaused(p) {
  el.paused.hidden = !p;
}

// ---------- bottom monitor ----------

function meter(node, used, kind) {
  const pct = Math.round(used * 100);
  node.querySelector('b').textContent = `${pct}%`;
  node.querySelector('i').style.width = `${Math.min(100, used * 100)}%`;
  if (kind === 'target') {
    node.classList.toggle('met', used >= 1);
  } else {
    node.classList.toggle('amber', used >= 0.5 && used < 0.8);
    node.classList.toggle('red', used >= 0.8);
  }
}

export function renderDesk(snap, day, sizeIndex) {
  el.bal.textContent = money(snap.balance);
  const dp = signed(snap.dayPnl);
  el.dayPnl.textContent = dp.text;
  el.dayPnl.className = dp.cls;

  meter(el.mLoss, snap.lossUsed, 'loss');
  meter(el.mDd, snap.ddUsed, 'dd');
  meter(el.mTgt, snap.targetProgress, 'target');

  if (day.qty === 0) {
    el.pos.innerHTML = `<span class="side muted">FLAT</span><span class="muted">no position</span>`;
  } else {
    const side = day.qty > 0 ? 'LONG' : 'SHORT';
    const o = signed(snap.open);
    el.pos.innerHTML =
      `<span class="side">${side} ${Math.abs(day.qty).toLocaleString('en-US')}</span>` +
      `<span class="muted">@ ${day.avg.toFixed(2)}</span>` +
      `<span class="${o.cls}">${o.text}</span>`;
  }

  [...el.sizes.children].forEach((b, i) => b.setAttribute('aria-checked', String(i === sizeIndex)));
}

export function setTradingEnabled(on) {
  for (const b of [el.buy, el.sell, el.flat]) b.disabled = !on;
}

export function flashDenied(text) {
  el.pos.innerHTML = `<span class="side">${esc(text)}</span>`;
}

// ---------- cards ----------

/**
 * Show a full-frame card. `actions` maps data-action names to callbacks.
 * Buttons inside the html use data-action="name".
 */
export function showCard(html, actions = {}, { cls = '', clear = false } = {}) {
  el.card.className = 'card ' + cls;
  el.card.innerHTML = html;
  el.cardLayer.classList.toggle('clear', clear);
  el.cardLayer.hidden = false;
  el.card.querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('click', () => actions[b.dataset.action]?.(), { once: true });
  });
  el.card.querySelector('[data-action]')?.focus({ preventScroll: true });
}

export function hideCard() {
  el.cardLayer.hidden = true;
  el.card.innerHTML = '';
}

export function rows(list) {
  return `<ul class="rules">${list.map(([k, v, cls = '']) => `<li><span>${esc(k)}</span><b class="${cls}">${esc(v)}</b></li>`).join('')}</ul>`;
}

export { esc };

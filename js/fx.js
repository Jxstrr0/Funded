// Juice: short visual and haptic feedback, and backdrop changes. DOM only,
// no game logic. Everything here is skipped or toned down for players who
// ask for reduced motion.
import { TIME_OF_DAY } from './config.js';

const $ = (id) => document.getElementById(id);
const MINUS = '−';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function restart(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth; // restart the CSS animation
  node.classList.add(cls);
}

export function buzz(pattern) {
  navigator.vibrate?.(pattern);
}

/** Brief tint on the position line after a fill: +1 buy/call, -1 sell/put, 0 flatten. */
export function fillFlash(dir) {
  const pos = $('pos');
  pos.classList.remove('fill-up', 'fill-down', 'fill-flat');
  restart(pos, dir > 0 ? 'fill-up' : dir < 0 ? 'fill-down' : 'fill-flat');
}

/** Realized P&L ("▲ +$240") floating up from the position line. Sign and arrow, never colour alone. */
export function pnlPop(value) {
  const r = Math.round(value);
  if (!r || reducedMotion()) return;
  const pos = $('pos');
  const n = document.createElement('div');
  n.className = 'pnl-pop ' + (r > 0 ? 'up' : 'down');
  const a = Math.abs(r).toLocaleString('en-US');
  n.textContent = r > 0 ? `▲ +$${a}` : `▼ ${MINUS}$${a}`;
  n.style.top = `${pos.offsetTop}px`;
  $('screenBottom').appendChild(n);
  setTimeout(() => n.remove(), 1300);
}

/** Flash both monitors: 'bell' (ivory), 'fired' (red) or 'pass' (green). */
export function screenFlash(kind) {
  for (const s of [$('screenTop'), $('screenBottom')]) {
    s.dataset.flash = kind;
    restart(s, 'flashing');
  }
}

/** Pulse the desk monitor's edge while a rule meter is in the red. */
export function danger(on) {
  $('screenBottom').classList.toggle('danger', !!on);
}

/** The target meter just filled. */
export function targetHit() {
  restart($('mTgt'), 'pop');
}

// ---------- backdrop ----------

let current = null;
let token = 0;

/**
 * Crossfade the gameplay backdrop (the desk changes as the career climbs,
 * and a cardboard box appears when you're fired). A missing file keeps the
 * current backdrop.
 */
export function setBackdrop(src, { tod = true } = {}) {
  const desk = $('bgDesk');
  current ??= desk.getAttribute('src');
  if (todFor === null) setTodBase(current);
  if (!src || src === current) return;
  const my = ++token;
  const img = new Image();
  img.onload = () => {
    if (my !== token) return;
    current = src;
    const alt = $('bgAlt');
    alt.src = src;
    alt.classList.add('show');
    setTodBase(null); // no morning/evening layers over the crossfade
    setTimeout(() => {
      if (my !== token) return;
      desk.src = src;
      setTodBase(tod ? src : null);
      alt.classList.remove('show');
    }, reducedMotion() ? 20 : 750);
  };
  img.src = src;
}

// ---------- time of day ----------

let todFor = null;
let todShare = 0;

/** Load the -am / -pm versions of a desk backdrop (null: none). */
function setTodBase(src) {
  todFor = src ?? '';
  for (const [id, t] of [['bgAm', 'am'], ['bgPm', 'pm']]) {
    const el = $(id);
    el.classList.remove('ok');
    el.onload = null;
    if (!src) { el.removeAttribute('src'); continue; }
    const want = src.replace(/\.jpg$/, `-${t}.jpg`);
    el.onload = () => { if (todFor === src) { el.classList.add('ok'); setTimeOfDay(todShare); } };
    el.onerror = () => el.classList.remove('ok');
    el.src = want;
  }
}

/** Light the desk for a moment of the day: 0 = the open, 1 = the bell. */
export function setTimeOfDay(share) {
  todShare = Math.max(0, Math.min(1, share));
  const t = TIME_OF_DAY;
  const am = Math.max(0, 1 - todShare / t.amFadeEnd);
  const pm = Math.max(0, (todShare - t.pmFadeStart) / (1 - t.pmFadeStart)) * t.pmPeak;
  $('bgAm').style.opacity = am.toFixed(3);
  $('bgPm').style.opacity = pm.toFixed(3);
}

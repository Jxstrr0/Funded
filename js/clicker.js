// The trader's hands: on a touch screen, a pointer glides across the monitors
// to whatever you tap and clicks it (a real mouse already has its own cursor),
// and the mouse on the desk moves along with it. Cosmetic only: every order is
// placed the moment you tap, before any of this plays.
import { CLICKER } from './config.js';
import { reducedMotion } from './fx.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const restart = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };

let frame, pointer, mouse;
let at = null;       // pointer position, % of the frame
let hideTimer = 0;
let clickTimer = 0;

export function initClicker() {
  frame = $('frame');
  pointer = $('pointer');
  mouse = $('deskMouse');
  frame.addEventListener('pointerdown', onDown, true);
}

function onDown(e) {
  if (!CLICKER.on) return;
  const btn = e.target.closest?.('button, [role=radio]');
  if (!btn || !btn.closest('.screen') || btn.disabled) return;
  const f = frame.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const s = CLICKER.screens;
  // aim a little right of and below the middle, kept on the glass (hit areas reach below the bezel)
  const x = clamp(((b.left + b.width * 0.55 - f.left) / f.width) * 100, s.l, s.r);
  const y = clamp(((b.top + b.height * 0.6 - f.top) / f.height) * 100, s.t, s.b);
  click(x, y, e.pointerType !== 'mouse');
}

/** Move to (x, y) in % of the frame and click there. */
function click(x, y, showPointer) {
  const calm = reducedMotion();
  const from = at ?? CLICKER.pointerRest;
  at = { x, y };
  const dist = Math.hypot(x - from.x, (y - from.y) * 16 / 9);
  const glide = calm ? 0 : Math.round(clamp(CLICKER.glideMs * Math.sqrt(dist / 40), 60, CLICKER.glideMs * 1.4));

  moveDeskMouse(x, y, glide);
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    if (!calm) {
      restart(pointer, 'click');
      restart(mouse, 'click');
    }
  }, glide);

  if (!showPointer) return;
  if (!pointer.classList.contains('show')) {
    // appear where it last was (or at rest), then glide
    pointer.style.transitionDuration = '0ms';
    place(pointer, from);
    void pointer.offsetWidth;
  }
  pointer.classList.add('show');
  pointer.style.transitionDuration = `${glide}ms`;
  place(pointer, at);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => pointer.classList.remove('show'), CLICKER.idleMs);
}

function place(node, p) {
  node.style.left = `${p.x}%`;
  node.style.top = `${p.y}%`;
}

/** The desk mouse slides a little as the pointer travels (CLICKER.mouseTravel). */
function moveDeskMouse(x, y, ms) {
  const r = CLICKER.pointerRest, k = CLICKER.mouseTravel;
  const dx = (x - r.x) * k.x;          // % of frame width
  const dy = (y - r.y) * k.y * 16 / 9; // % of frame height, as cqw
  mouse.style.setProperty('--glide', `${ms}ms`);
  mouse.style.setProperty('--mx', `${dx.toFixed(3)}cqw`);
  mouse.style.setProperty('--my', `${dy.toFixed(3)}cqw`);
}

/**
 * Put the desk mouse layers in for a tier (EDGE_PROPS-style crops from
 * art/build_props.py --mouse): a clean plate of the desk without the mouse and
 * the mouse itself on top, each with -am / -pm versions that follow the time
 * of day. Shown only once every file has loaded; until then the mouse baked
 * into the desk render stays put.
 */
export function setDeskMouse(tier) {
  const r = tier && CLICKER.mouse.layout[tier];
  const key = r ? tier : '';
  if (mouse.dataset.key === key) return;
  mouse.dataset.key = key;
  mouse.classList.remove('ok');
  mouse.replaceChildren();
  if (!r) return;
  const box = `left:${r.l}%;top:${r.t}%;width:${r.w}%;height:${r.h}%`;
  const hand = document.createElement('div');
  hand.className = 'hand';
  hand.style.cssText = box;
  let waiting = 0;
  const layer = (parent, name, tod, style) => {
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'm-layer';
    if (tod) img.dataset.tod = tod;
    if (style) img.style.cssText = style;
    waiting++;
    img.onload = () => { if (--waiting === 0 && mouse.dataset.key === key) mouse.classList.add('ok'); };
    img.onerror = () => { if (mouse.dataset.key === key) { mouse.replaceChildren(); mouse.dataset.key = ''; } };
    img.src = `${CLICKER.mouse.dir}/${tier}-${name}${tod ? '-' + tod : ''}.webp`;
    parent.appendChild(img);
  };
  for (const tod of [null, 'am', 'pm']) layer(mouse, 'plate', tod, box);
  for (const tod of [null, 'am', 'pm']) layer(hand, 'mouse', tod);
  mouse.appendChild(hand);
}

// Sound: ElevenLabs-generated files in assets/audio/, with a tiny WebAudio
// synth as fallback for any file that is missing or still loading.
// Three buses (sfx, ambience, music) feed a master gain.
import { AUDIO } from './config.js';

const PREFS_KEY = 'funded.audio.v1';
// 'all' = sfx + ambience + music, 'sfx' = sound effects only, 'off' = silent.
const MODES = ['all', 'sfx', 'off'];

let ctx = null;
let bus = null;
const buffers = {};
let loading = false;
let mode = readMode();
let scene = 'menu';           // 'menu' | 'day' | 'quiet'
let raining = false;          // rain on the windows during a rainy day
const loops = {};             // name -> { src, gain }

function readMode() {
  try { const m = localStorage.getItem(PREFS_KEY); return MODES.includes(m) ? m : 'all'; } catch { return 'all'; }
}

export function audioMode() { return mode; }

/** Cycle all -> sfx -> off. Returns the new mode. */
export function cycleAudioMode() {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  try { localStorage.setItem(PREFS_KEY, mode); } catch { /* ignore */ }
  applyLevels();
  return mode;
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const g = (v, to) => { const n = ctx.createGain(); n.gain.value = v; n.connect(to); return n; };
    const master = g(AUDIO.master, ctx.destination);
    bus = { master, sfx: g(AUDIO.sfx, master), ambience: g(0, master), music: g(0, master), dayMusic: g(0, master), rain: g(0, master) };
    applyLevels();
    load();
  }
  if (ctx.state !== 'running') ctx.resume().then(syncLoops, () => {});
  else syncLoops();
}

// The first tap anywhere unlocks audio, so title music can start.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlockAudio, { once: true, capture: true });

async function load() {
  if (loading) return;
  loading = true;
  await Promise.all(Object.entries(AUDIO.files).map(async ([name, file]) => {
    try {
      const res = await fetch(`assets/audio/${file}`);
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      buffers[name] = await new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad));
    } catch { /* keep the synth fallback */ }
  }));
  syncLoops();
}

function applyLevels() {
  if (!bus) return;
  const t = ctx.currentTime;
  bus.master.gain.setTargetAtTime(mode === 'off' ? 0 : AUDIO.master, t, 0.05);
  syncLoops();
}

// ---------- loops: ambience and day music during a live day, menu music elsewhere ----------

/** 'menu' (title, cards: menu music), 'day' (live session: ambience + day music), 'quiet' (paused: nothing). */
export function setScene(s) {
  scene = s;
  syncLoops();
}

/** Rain on the windows under the floor ambience (rainy days only). */
export function setRain(on) {
  raining = !!on;
  syncLoops();
}

function syncLoops() {
  if (!ctx || ctx.state !== 'running') return;
  const loopsOn = mode === 'all';
  fadeLoop('music', loopsOn && scene === 'menu' ? AUDIO.music : 0);
  fadeLoop('ambience', loopsOn && scene === 'day' ? AUDIO.ambience : 0);
  fadeLoop('dayMusic', loopsOn && scene === 'day' ? AUDIO.dayMusic : 0);
  fadeLoop('rain', loopsOn && scene === 'day' && raining ? AUDIO.rain : 0);
}

function fadeLoop(name, target) {
  const g = bus[name].gain;
  const t = ctx.currentTime;
  if (target > 0 && !loops[name] && buffers[name]) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.loop = true;
    src.connect(bus[name]);
    src.start();
    loops[name] = src;
  }
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(target, t + AUDIO.fadeSeconds);
  if (target === 0 && loops[name]) {
    const src = loops[name];
    delete loops[name];
    src.stop(t + AUDIO.fadeSeconds + 0.05);
  }
}

// ---------- one-shots ----------

function play(name, { gain = 1, rate = 1 } = {}) {
  const buf = buffers[name];
  if (!ctx || !buf || mode === 'off') return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = (AUDIO.gain[name] ?? 1) * gain;
  src.connect(g).connect(bus.sfx);
  src.start();
  return true;
}

function tone(freq, dur, { type = 'sine', gain = 0.08, at = 0, slide = 0 } = {}) {
  if (!ctx || mode === 'off') return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus.sfx);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Synth fallbacks, used when a file isn't available.
const synth = {
  buy: () => tone(880, 0.07, { type: 'triangle', slide: 1.3 }),
  sell: () => tone(660, 0.07, { type: 'triangle', slide: 0.75 }),
  flat: () => { tone(520, 0.05, { type: 'triangle' }); tone(780, 0.06, { type: 'triangle', at: 0.05 }); },
  denied: () => tone(160, 0.09, { type: 'square', gain: 0.04 }),
  news: () => { tone(1046, 0.12, { gain: 0.07 }); tone(1318, 0.18, { gain: 0.07, at: 0.1 }); },
  tick: (hot) => tone(hot ? 1200 : 900, 0.06, { type: 'square', gain: hot ? 0.06 : 0.025 }),
  bell: () => { tone(988, 0.9, { gain: 0.12 }); tone(1480, 0.7, { gain: 0.05, at: 0.02 }); },
  fired: () => { tone(220, 0.35, { type: 'sawtooth', gain: 0.08, slide: 0.5 }); tone(165, 0.5, { type: 'sawtooth', gain: 0.07, at: 0.25, slide: 0.5 }); },
  pass: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', gain: 0.08, at: i * 0.11 })),
  mulligan: () => tone(900, 0.4, { type: 'sawtooth', gain: 0.05, slide: 0.3 }),
  rep: () => [1318, 1568].forEach((f, i) => tone(f, 0.12, { type: 'triangle', gain: 0.06, at: i * 0.07 })),
  deal: () => [0, 0.12, 0.24].forEach((at) => tone(2400, 0.03, { type: 'square', gain: 0.02, at })),
  pick: () => { tone(300, 0.05, { type: 'square', gain: 0.04 }); tone(1046, 0.15, { gain: 0.06, at: 0.06 }); },
  rare: () => [1568, 2093, 2637].forEach((f, i) => tone(f, 0.2, { gain: 0.04, at: i * 0.08 })),
  reroll: () => [0, 0.05, 0.1, 0.15].forEach((at) => tone(2000, 0.025, { type: 'square', gain: 0.015, at })),
  stamp: () => tone(110, 0.12, { type: 'square', gain: 0.06, slide: 0.6 }),
  purchase: () => { tone(1318, 0.1, { type: 'triangle', gain: 0.06 }); tone(1975, 0.25, { type: 'triangle', gain: 0.06, at: 0.08 }); },
};

const fx = (name, opts) => (...args) => { if (!play(name, opts?.(...args))) synth[name](...args); };

export const sfx = {
  buy: fx('buy'),
  sell: fx('sell'),
  flat: fx('flat'),
  denied: fx('denied'),
  news: fx('news'),
  // Bell countdown tick: louder and higher while still holding a position.
  warn: fx('tick', (hot) => (hot ? { gain: 1.6, rate: 1.25 } : { gain: 0.8 })),
  bell: fx('bell'),
  fired: fx('fired'),
  pass: fx('pass'),
  mulligan: fx('mulligan'),
  rep: fx('rep'),
  // Edge draft, mandates and the shop.
  deal: fx('deal'),
  pick: fx('pick'),
  rare: fx('rare'),
  reroll: fx('reroll'),
  // Mandate switch: a full stamp when it goes on, a lighter, higher one when it goes off.
  stamp: fx('stamp', (on = true) => (on ? {} : { gain: 0.5, rate: 1.3 })),
  purchase: fx('purchase'),
};

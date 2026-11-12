// Tiny WebAudio synth for placeholder sounds. Stage 7 swaps in real sound design.
let ctx = null;
let muted = false;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) { muted = m; }

function tone(freq, dur, { type = 'sine', gain = 0.08, at = 0, slide = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  buy: () => tone(880, 0.07, { type: 'triangle', slide: 1.3 }),
  sell: () => tone(660, 0.07, { type: 'triangle', slide: 0.75 }),
  flat: () => { tone(520, 0.05, { type: 'triangle' }); tone(780, 0.06, { type: 'triangle', at: 0.05 }); },
  denied: () => tone(160, 0.09, { type: 'square', gain: 0.04 }),
  news: () => { tone(1046, 0.12, { gain: 0.07 }); tone(1318, 0.18, { gain: 0.07, at: 0.1 }); },
  warn: (hot) => tone(hot ? 1200 : 900, 0.06, { type: 'square', gain: hot ? 0.06 : 0.025 }),
  bell: () => { tone(988, 0.9, { gain: 0.12 }); tone(1480, 0.7, { gain: 0.05, at: 0.02 }); },
  fired: () => { tone(220, 0.35, { type: 'sawtooth', gain: 0.08, slide: 0.5 }); tone(165, 0.5, { type: 'sawtooth', gain: 0.07, at: 0.25, slide: 0.5 }); },
  pass: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', gain: 0.08, at: i * 0.11 })),
};

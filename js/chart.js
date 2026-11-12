// Canvas candlestick chart on a fixed full-session axis (78 slots).
import { SESSION } from './config.js';

const COL = {
  up: '#2FBF71',
  down: '#E5484D',
  ivory: '#FAF9F5',
  dim: 'rgba(250,249,245,0.45)',
  grid: 'rgba(250,249,245,0.07)',
  lilac: '#B48CE8',
  bg: '#0A1424',
};

export class Chart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.data = null;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.data) this.draw(this.data);
  }

  /**
   * @param {{candles: Array<{o,h,l,c}>, last: number, avg: number|null, qty: number,
   *          news: Array<{candle:number, revealed:boolean, dir:number}>, slot: number}} d
   */
  draw(d) {
    this.data = d;
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const fs = Math.max(8, Math.round(w * 0.03));
    const axisH = fs + 4;
    const labelW = fs * 3.6;
    const plotL = 1;
    const plotR = w - labelW;
    const plotT = 2;
    const plotB = h - axisH;
    const slots = SESSION.candles;
    const slotW = (plotR - plotL) / slots;

    // Price range from what's drawn, plus the avg line.
    let lo = Infinity, hi = -Infinity;
    for (const c of d.candles) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
    if (d.avg) { lo = Math.min(lo, d.avg); hi = Math.max(hi, d.avg); }
    if (!isFinite(lo)) { lo = d.last; hi = d.last; }
    const minSpan = d.last * 0.006;
    if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const y = (p) => plotB - ((p - lo) / (hi - lo)) * (plotB - plotT);

    ctx.font = `600 ${fs}px 'Space Grotesk', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    // Grid: 4 price levels.
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const p = lo + ((hi - lo) * (i + 0.5)) / 4;
      const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(plotL, yy); ctx.lineTo(plotR, yy); ctx.stroke();
      ctx.fillText(p.toFixed(2), plotR + 3, yy);
    }

    // Time axis: hour ticks, labelled.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let hr = 10; hr <= 16; hr++) {
      const slot = ((hr * 60 - SESSION.marketOpenMinute) / SESSION.candleMinutes);
      const xx = Math.round(plotL + slot * slotW) + 0.5;
      ctx.strokeStyle = COL.grid;
      ctx.beginPath(); ctx.moveTo(xx, plotT); ctx.lineTo(xx, plotB); ctx.stroke();
      ctx.fillStyle = COL.dim;
      ctx.fillText(String(hr > 12 ? hr - 12 : hr), Math.min(xx, plotR - fs / 2), plotB + 3);
    }

    // News markers on the time axis.
    for (const n of d.news) {
      const cx = plotL + (n.candle + 0.5) * slotW;
      const cy = plotB + 1 + fs * 0.45;
      const s = fs * 0.42;
      ctx.beginPath();
      if (!n.revealed) {
        ctx.fillStyle = COL.lilac;
        ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
      } else if (n.dir > 0) {
        ctx.fillStyle = COL.up;
        ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy + s * 0.8); ctx.lineTo(cx - s, cy + s * 0.8);
      } else {
        ctx.fillStyle = COL.down;
        ctx.moveTo(cx, cy + s); ctx.lineTo(cx + s, cy - s * 0.8); ctx.lineTo(cx - s, cy - s * 0.8);
      }
      ctx.closePath();
      ctx.fill();
      // faint guide up the chart for upcoming news
      if (!n.revealed) {
        ctx.strokeStyle = 'rgba(180,140,232,0.25)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, plotT); ctx.lineTo(Math.round(cx) + 0.5, plotB); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Candles.
    const bodyW = Math.max(1, slotW * 0.66);
    d.candles.forEach((c, i) => {
      const cx = plotL + (i + 0.5) * slotW;
      const up = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = up ? COL.up : COL.down;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, y(c.h));
      ctx.lineTo(Math.round(cx) + 0.5, y(c.l));
      ctx.stroke();
      const top = y(Math.max(c.o, c.c));
      const bh = Math.max(1, y(Math.min(c.o, c.c)) - top);
      ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    });

    // Average price line.
    if (d.avg) {
      const yy = Math.round(y(d.avg)) + 0.5;
      ctx.strokeStyle = COL.ivory;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(plotL, yy); ctx.lineTo(plotR, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = COL.ivory;
      ctx.fillText(d.qty > 0 ? 'AVG ▲ LONG' : 'AVG ▼ SHORT', plotL + 2, yy - 1);
    }

    // Last price tag.
    const ly = y(d.last);
    ctx.fillStyle = COL.ivory;
    ctx.fillRect(plotR + 1, ly - fs * 0.65, labelW - 1, fs * 1.3);
    ctx.fillStyle = COL.bg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.last.toFixed(2), plotR + 3, ly + 0.5);
    ctx.strokeStyle = 'rgba(250,249,245,0.35)';
    ctx.setLineDash([1, 3]);
    ctx.beginPath(); ctx.moveTo(plotL, Math.round(ly) + 0.5); ctx.lineTo(plotR, Math.round(ly) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
  }
}

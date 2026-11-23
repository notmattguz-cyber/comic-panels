// Speech balloons, thought clouds, shouts, captions and sound effects.
// A text item: { id, kind, x, y, w, h, r, text, size, caps, fill, tail:[x,y]|null, auto }
// x,y is the centre in page units; tail is the tip in page units (stays put when the balloon moves).
import { rot, sub } from './geom.js';

export const TEXT_KINDS = [['speech', 'Speech'], ['thought', 'Thought'], ['shout', 'Shout'], ['caption', 'Caption'], ['sfx', 'SFX']];
export const FONT_DIALOG = 'Chalkboard SE, Comic Sans MS, Comic Neue, Marker Felt, sans-serif';
export const FONT_SFX = 'Marker Felt, Impact, Arial Black, sans-serif';
export const SFX_COLORS = ['#ffd21f', '#ff4d3d', '#3fa9ff', '#7ddc3a', '#ffffff', '#111111'];
export const hasTail = (t) => t.kind === 'speech' || t.kind === 'thought' || t.kind === 'shout';

let mctx = null;
function measure() { return mctx || (mctx = document.createElement('canvas').getContext('2d')); }

export const fontOf = (t) => (t.kind === 'sfx'
  ? `900 ${t.size}px ${FONT_SFX}`
  : `${t.kind === 'shout' ? 700 : 400} ${t.size}px ${FONT_DIALOG}`);
export const displayText = (t) => (t.caps ? t.text.toUpperCase() : t.text);
export const lineHeight = (t) => t.size * (t.kind === 'sfx' ? 1.0 : 1.2);
export const strokeW = (t) => Math.max(1.5, t.size * 0.075);
const pad = (t) => t.size * 0.55;
const INNER = { speech: 0.72, thought: 0.66, shout: 0.6 };

function innerW(t) {
  if (t.kind === 'caption') return t.w - pad(t) * 2;
  if (t.kind === 'sfx') return Infinity;
  return t.w * INNER[t.kind];
}

function wrapAt(t, maxW) {
  const c = measure();
  c.font = fontOf(t);
  const lines = [];
  for (const para of displayText(t).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const tryL = line + ' ' + words[i];
      if (c.measureText(tryL).width <= maxW) line = tryL;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  }
  return lines;
}

export function layout(t) {
  const lines = wrapAt(t, innerW(t));
  const lh = lineHeight(t);
  const total = lines.length * lh;
  const first = -total / 2 + (lh - t.size) / 2 + t.size * 0.82;
  return { lines, lh, first, font: fontOf(t) };
}

// Size the balloon around its text.
export function autoSize(t) {
  const c = measure();
  c.font = fontOf(t);
  const lh = lineHeight(t);
  const txt = displayText(t) || ' ';
  const widths = txt.split('\n').map((l) => c.measureText(l).width);
  if (t.kind === 'sfx') {
    t.w = Math.max(...widths, t.size) + t.size * 0.5;
    t.h = widths.length * lh + t.size * 0.35;
    return;
  }
  const full = Math.max(...widths, t.size * 2);
  const iw = Math.min(full, Math.max(t.size * 5, Math.sqrt(full * lh * 2.6)));
  const lines = wrapAt(t, iw);
  const mw = Math.max(...lines.map((l) => c.measureText(l).width), t.size * 2) + 2;
  const ih = lines.length * lh;
  if (t.kind === 'caption') { t.w = mw + pad(t) * 2; t.h = ih + pad(t) * 2; }
  else if (t.kind === 'shout') { t.w = mw / INNER.shout + t.size; t.h = ih / 0.55 + t.size * 1.2; }
  else if (t.kind === 'thought') { t.w = mw / INNER.thought + t.size * 0.6; t.h = ih / 0.62 + t.size * 1.2; }
  else { t.w = mw / INNER.speech + t.size * 0.4; t.h = ih / 0.68 + t.size * 0.7; }
}

export function newText(kind, x, y, size) {
  const t = {
    kind, x, y, w: 0, h: 0, r: kind === 'sfx' ? -8 : 0,
    text: '', size: kind === 'sfx' ? size * 2.6 : size,
    caps: kind !== 'caption', auto: true,
    fill: kind === 'caption' ? '#fff6bf' : kind === 'sfx' ? SFX_COLORS[0] : '#ffffff',
    tail: null,
  };
  t.text = kind === 'sfx' ? 'BOOM!' : '';
  autoSize(t);
  if (t.w < size * 6 && kind !== 'sfx') { t.w = size * 6; t.h = size * 3.4; }
  if (hasTail(t)) t.tail = [x - t.w * 0.2, y + t.h * 0.95];
  return t;
}

export const localTail = (t) => (t.tail ? rot(sub(t.tail, [t.x, t.y]), -(t.r || 0)) : null);

const f = (v) => Math.round(v * 10) / 10;
const P = (p) => `${f(p[0])},${f(p[1])}`;
const ell = (rx, ry, a) => [rx * Math.cos(a), ry * Math.sin(a)];

function circle(cx, cy, r) {
  return `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`;
}

// Outline of the balloon (with its tail) in local, unrotated coordinates centred on 0,0.
export function shapePath(t) {
  const rx = t.w / 2, ry = t.h / 2;
  const tip = hasTail(t) ? localTail(t) : null;
  const inside = tip && (tip[0] / rx) ** 2 + (tip[1] / ry) ** 2 < 1.05;
  const useTip = tip && !inside ? tip : null;
  switch (t.kind) {
    case 'sfx': return '';
    case 'caption': return `M${f(-rx)},${f(-ry)}H${f(rx)}V${f(ry)}H${f(-rx)}Z`;
    case 'speech': {
      if (!useTip) return `M${f(-rx)},0A${f(rx)},${f(ry)} 0 1,1 ${f(rx)},0A${f(rx)},${f(ry)} 0 1,1 ${f(-rx)},0Z`;
      const a = Math.atan2(useTip[1] / ry, useTip[0] / rx);
      const da = Math.min(0.55, Math.max(0.16, (t.size * 1.3) / ((rx + ry) / 2)));
      const p1 = ell(rx, ry, a + da), p2 = ell(rx, ry, a - da);
      // Slight curve on the tail so it doesn't look like a wedge.
      const m = [(p2[0] + useTip[0]) / 2, (p2[1] + useTip[1]) / 2];
      const c = [m[0] + (p1[0] - p2[0]) * 0.18, m[1] + (p1[1] - p2[1]) * 0.18];
      return `M${P(p1)}A${f(rx)},${f(ry)} 0 1,1 ${P(p2)}Q${P(c)} ${P(useTip)}L${P(p1)}Z`;
    }
    case 'shout': {
      const n = Math.max(10, Math.min(22, Math.round((rx + ry) / (t.size * 0.8))));
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const jit = ((i * 37) % 7) / 40;
        const k = i % 2 === 0 ? 1.16 + jit : 0.86 - jit / 2;
        pts.push(ell(rx * k, ry * k, a));
      }
      if (useTip) {
        const ta = Math.atan2(useTip[1] / ry, useTip[0] / rx);
        let best = 0, bd = Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          const a = (i / pts.length) * Math.PI * 2;
          const d = Math.abs(Math.atan2(Math.sin(a - ta), Math.cos(a - ta)));
          if (d < bd) { bd = d; best = i; }
        }
        pts[best] = useTip;
      }
      return 'M' + pts.map(P).join('L') + 'Z';
    }
    case 'thought': {
      const n = Math.max(8, Math.min(18, Math.round((rx + ry) / (t.size * 0.85))));
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(ell(rx * 0.92, ry * 0.92, (i / n) * Math.PI * 2 + 0.2));
      let d = `M${P(pts[0])}`;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.62;
        d += `A${f(r)},${f(r)} 0 0,1 ${P(b)}`;
      }
      d += 'Z';
      if (useTip) {
        const a = Math.atan2(useTip[1] / ry, useTip[0] / rx);
        const e = ell(rx, ry, a);
        const sizes = [0.42, 0.3, 0.19];
        [0.3, 0.6, 0.9].forEach((k, i) => {
          const cx = e[0] + (useTip[0] - e[0]) * k, cy = e[1] + (useTip[1] - e[1]) * k;
          d += circle(cx, cy, t.size * sizes[i]);
        });
      }
      return d;
    }
  }
  return '';
}

export function hitText(t, p) {
  const l = rot(sub(p, [t.x, t.y]), -(t.r || 0));
  return Math.abs(l[0]) <= t.w / 2 && Math.abs(l[1]) <= t.h / 2;
}

// SVG markup for one item (already wrapped in its transform group by the caller).
export function textSVG(t) {
  const L = layout(t);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const family = t.kind === 'sfx' ? FONT_SFX : FONT_DIALOG;
  const weight = t.kind === 'sfx' ? 900 : t.kind === 'shout' ? 700 : 400;
  const tsp = L.lines.map((ln, i) => `<tspan x="0" y="${f(L.first + i * L.lh)}">${esc(ln) || ' '}</tspan>`).join('');
  if (t.kind === 'sfx') {
    return `<text text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${t.size}" fill="${t.fill}" stroke="#111" stroke-width="${f(t.size * 0.12)}" stroke-linejoin="round" paint-order="stroke">${tsp}</text>`;
  }
  return `<path d="${shapePath(t)}" fill="${t.fill}" stroke="#111" stroke-width="${f(strokeW(t))}" stroke-linejoin="round"/>`
    + `<text text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${t.size}" fill="#111">${tsp}</text>`;
}

export function drawText(ctx, t) {
  const L = layout(t);
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate((t.r || 0) * Math.PI / 180);
  if (t.kind !== 'sfx') {
    const path = new Path2D(shapePath(t));
    ctx.fillStyle = t.fill;
    ctx.fill(path);
    ctx.lineWidth = strokeW(t);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.stroke(path);
  }
  ctx.font = L.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  L.lines.forEach((ln, i) => {
    const y = L.first + i * L.lh;
    if (t.kind === 'sfx') {
      ctx.lineWidth = t.size * 0.12;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
      ctx.strokeText(ln, 0, y);
      ctx.fillStyle = t.fill;
    } else ctx.fillStyle = '#111';
    ctx.fillText(ln, 0, y);
  });
  ctx.restore();
}

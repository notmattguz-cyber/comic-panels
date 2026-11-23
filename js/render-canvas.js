// Draws a page onto a canvas: used for export, PDFs and home-screen thumbnails.
import { strokePath, linePath } from './stroke.js';
import { fxSource } from './fx.js';
import { drawText } from './bubbles.js';
import { panelPath } from './shapes.js';

export const MAX_PIXELS = 16000000; // iOS canvas limit is ~16.7M pixels

export function polyPath(pts) {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

function applyImg(ctx, im) {
  ctx.translate(im.x, im.y);
  ctx.rotate((im.r || 0) * Math.PI / 180);
  ctx.scale(im.s * (im.f || 1), im.s);
}

function drawImg(ctx, img, im) {
  ctx.save();
  applyImg(ctx, im);
  ctx.drawImage(img, -im.w / 2, -im.h / 2, im.w, im.h);
  ctx.restore();
}

// parts (optional): only draw some layers, for layered exports.
//   bg, fill, image, ink, border, popout, text, sketch, shape (solid panel shapes)
// x0/y0/w/h crop the page; sketchAlpha overrides the sketch opacity.
const ALL = ['bg', 'fill', 'image', 'ink', 'border', 'popout', 'text', 'sketch'];

export async function renderPage(page, { scale = 1, sketch = true, x0 = 0, y0 = 0, w = page.w, h = page.h, parts = null, sketchAlpha = null } = {}) {
  const on = new Set(parts || ALL);
  if (!sketch) on.delete('sketch');
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const base = (c) => c.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  base(ctx);
  if (on.has('bg')) {
    ctx.fillStyle = page.bg || '#fff';
    ctx.fillRect(x0, y0, w, h);
  }

  const needImgs = on.has('image') || on.has('popout');
  const imgs = await Promise.all(page.panels.map((p) => (needImgs && p.image ? fxSource(p.image.id, p.fx).catch(() => null) : null)));
  const ids = new Set(page.panels.map((p) => p.id));
  const ink = on.has('ink') ? (page.ink || []) : [];
  const fillLines = (c, list) => { for (const st of list) { c.fillStyle = st.color; c.fill(new Path2D(strokePath(st.pts, st.size))); } };

  page.panels.forEach((p, i) => {
    const path = new Path2D(panelPath(p, page.w));
    if (on.has('shape')) { ctx.fillStyle = '#d9d9d9'; ctx.fill(path); }
    if (on.has('fill')) { ctx.fillStyle = p.fill || '#fff'; ctx.fill(path); }
    const im = p.image, img = imgs[i];
    if (im && img && on.has('image')) {
      ctx.save();
      ctx.clip(path);
      drawImg(ctx, img, im);
      ctx.restore();
    }
    const mine = ink.filter((st) => st.panel === p.id);
    if (mine.length) { ctx.save(); ctx.clip(path); fillLines(ctx, mine); ctx.restore(); }
    const bw = p.border ?? page.border;
    if (bw > 0 && on.has('border')) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = page.borderColor || '#111';
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 20;
      ctx.stroke(path);
    }
    if (!on.has('popout')) return;
    if (im && img && p.popout === 'all') {
      drawImg(ctx, img, im);
    } else if (im && img && p.popout === 'mask' && p.mask && p.mask.length) {
      const oc = document.createElement('canvas');
      oc.width = W; oc.height = H;
      const o = oc.getContext('2d');
      base(o);
      o.save();
      applyImg(o, im);
      o.lineCap = 'round'; o.lineJoin = 'round'; o.strokeStyle = '#fff';
      for (const m of p.mask) {
        o.globalCompositeOperation = m.e ? 'destination-out' : 'source-over';
        o.lineWidth = m.size;
        o.stroke(new Path2D(linePath(m.pts)));
      }
      o.restore();
      o.globalCompositeOperation = 'source-in';
      drawImg(o, img, im);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(oc, 0, 0);
      ctx.restore();
      oc.width = 0;
    }
  });

  fillLines(ctx, ink.filter((st) => !st.panel || !ids.has(st.panel)));
  if (on.has('text')) for (const t of page.texts || []) drawText(ctx, t);

  if (on.has('sketch') && page.sketchVisible !== false && page.strokes.length) {
    const byId = new Map(page.panels.map((p) => [p.id, p]));
    const sc = document.createElement('canvas');
    sc.width = W; sc.height = H;
    const s = sc.getContext('2d');
    base(s);
    for (const st of page.strokes) {
      const host = st.panel ? byId.get(st.panel) : null;
      if (host && host.sketchHidden) continue;
      s.fillStyle = st.color;
      if (host) { s.save(); s.clip(new Path2D(panelPath(host, page.w))); }
      s.fill(new Path2D(strokePath(st.pts, st.size)));
      if (host) s.restore();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = sketchAlpha ?? page.sketchOpacity ?? 1;
    ctx.drawImage(sc, 0, 0);
    ctx.restore();
    sc.width = 0;
  }
  return cv;
}

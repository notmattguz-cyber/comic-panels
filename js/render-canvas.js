// Draws a page onto a canvas: used for export and home-screen thumbnails.
import { strokePath, linePath } from './stroke.js';
import { imageEl } from './images.js';

export const MAX_PIXELS = 16000000; // iOS canvas limit is ~16.7M pixels

function polyPath(pts) {
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

export async function renderPage(page, { scale = 1, sketch = true, y0 = 0, h = page.h } = {}) {
  const W = Math.max(1, Math.round(page.w * scale)), H = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const base = (c) => c.setTransform(scale, 0, 0, scale, 0, -y0 * scale);
  base(ctx);
  ctx.fillStyle = page.bg || '#fff';
  ctx.fillRect(0, y0, page.w, h);

  const imgs = await Promise.all(page.panels.map((p) => (p.image ? imageEl(p.image.id).catch(() => null) : null)));

  page.panels.forEach((p, i) => {
    const path = polyPath(p.pts);
    ctx.fillStyle = p.fill || '#fff';
    ctx.fill(path);
    const im = p.image, img = imgs[i];
    if (im && img) {
      ctx.save();
      ctx.clip(path);
      drawImg(ctx, img, im);
      ctx.restore();
    }
    const bw = p.border ?? page.border;
    if (bw > 0) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = page.borderColor || '#111';
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 20;
      ctx.stroke(path);
    }
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

  if (sketch && page.sketchVisible !== false && page.strokes.length) {
    const sc = document.createElement('canvas');
    sc.width = W; sc.height = H;
    const s = sc.getContext('2d');
    base(s);
    for (const st of page.strokes) {
      s.fillStyle = st.color;
      s.fill(new Path2D(strokePath(st.pts, st.size)));
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = page.sketchOpacity ?? 1;
    ctx.drawImage(sc, 0, 0);
    ctx.restore();
    sc.width = 0;
  }
  return cv;
}

// Per-panel image looks: brightness/contrast, grey, halftone screentone, ink.
// Results are cached as object URLs by (image, settings); only one is processed at a time and the
// newest request wins, so dragging a slider doesn't queue up dozens of jobs.
import { imageEl } from './images.js';

export const FX_MODES = [['none', 'Original'], ['gray', 'Grey'], ['tone', 'Halftone'], ['ink', 'Ink']];
export const fxOn = (fx) => !!fx && ((fx.mode && fx.mode !== 'none') || !!fx.b || !!fx.c);
export const fxKey = (id, fx) => `${id}|${fx.mode || 'none'}|${fx.b || 0}|${fx.c || 0}|${fx.k ?? 50}`;

const urls = new Map();     // key -> object URL
const order = [];           // LRU of keys
let busy = false;
let next = null;            // { id, fx, key, cb }
const MAX_CACHED = 16;

function remember(key, url) {
  urls.set(key, url);
  order.push(key);
  while (order.length > MAX_CACHED) {
    const old = order.shift();
    const u = urls.get(old);
    if (u) URL.revokeObjectURL(u);
    urls.delete(old);
  }
}

export function fxURL(id, fx, onReady) {
  const key = fxKey(id, fx);
  if (urls.has(key)) return urls.get(key);
  next = { id, fx: { ...fx }, key, cb: onReady };
  pump();
  return null;
}

async function pump() {
  if (busy || !next) return;
  const job = next;
  next = null;
  if (urls.has(job.key)) { job.cb && job.cb(); pump(); return; }
  busy = true;
  try {
    const cv = await build(job.id, job.fx);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    cv.width = 0;
    remember(job.key, URL.createObjectURL(blob));
    job.cb && job.cb();
  } catch (e) {
    console.warn('fx', e);
  }
  busy = false;
  pump();
}

// For export: a drawable source with the look applied.
export async function fxSource(id, fx) {
  if (!fxOn(fx)) return imageEl(id);
  const key = fxKey(id, fx);
  let url = urls.get(key);
  if (!url) {
    const cv = await build(id, fx);
    return cv;
  }
  const im = new Image();
  im.src = url;
  await im.decode();
  return im;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

async function build(id, fx) {
  const img = await imageEl(id);
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const b = (fx.b || 0) * 2.55;
  const c = (fx.c || 0) * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const mode = fx.mode || 'none';
  const grey = mode !== 'none';
  const lum = grey ? new Float32Array(w * h) : null;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let r = cf * (d[i] - 128) + 128 + b;
    let g = cf * (d[i + 1] - 128) + 128 + b;
    let bl = cf * (d[i + 2] - 128) + 128 + b;
    if (grey) {
      const L = clamp(0.299 * r + 0.587 * g + 0.114 * bl);
      lum[j] = L;
      r = g = bl = L;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
  if (mode === 'none' || mode === 'gray') {
    ctx.putImageData(data, 0, 0);
    return cv;
  }
  const k = (fx.k ?? 50) / 100;

  if (mode === 'ink') {
    // Edges (Sobel) become black lines, the darkest areas fill solid black, everything else white.
    const T = 30 + (1 - k) * 150;
    const dark = 25 + k * 75;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = y * w + x, i = j * 4;
        let v = 255;
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          const a = lum[j - w - 1], bb = lum[j - w], cc = lum[j - w + 1];
          const dd = lum[j - 1], ff = lum[j + 1];
          const gg = lum[j + w - 1], hh = lum[j + w], ii = lum[j + w + 1];
          const gx = -a - 2 * dd - gg + cc + 2 * ff + ii;
          const gy = -a - 2 * bb - cc + gg + 2 * hh + ii;
          if (Math.abs(gx) + Math.abs(gy) > T || lum[j] < dark) v = 0;
        }
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(data, 0, 0);
    return cv;
  }

  // Halftone: sample the grey image on a grid, draw a dot per cell sized by darkness (brick offset rows).
  ctx.putImageData(data, 0, 0);
  const cell = Math.max(3, Math.round(Math.max(w, h) / (30 + (1 - k) * 170)));
  const sw = Math.ceil(w / cell) + 1, sh = Math.ceil(h / cell) + 1;
  const sc = document.createElement('canvas');
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(cv, 0, 0, sw * cell, sh * cell, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d');
  o.fillStyle = '#fff';
  o.fillRect(0, 0, w, h);
  o.fillStyle = '#000';
  o.beginPath();
  for (let gy = 0; gy < sh; gy++) {
    const off = gy % 2 ? cell / 2 : 0;
    for (let gx = 0; gx < sw; gx++) {
      const cx = gx * cell + cell / 2 + off, cy = gy * cell + cell / 2;
      const sx = Math.min(sw - 1, Math.floor(cx / cell));
      const L = sd[(gy * sw + sx) * 4];
      const dark = 1 - L / 255;
      const r = cell * 0.72 * Math.sqrt(dark);
      if (r < 0.35) continue;
      o.moveTo(cx + r, cy);
      o.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }
  o.fill();
  // Keep the original transparency (cut-out PNGs).
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(img, 0, 0);
  cv.width = 0; sc.width = 0;
  return out;
}

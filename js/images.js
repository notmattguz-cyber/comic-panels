import * as db from './db.js';
import { uid } from './ui.js';

const urls = new Map();
const decoded = new Map();
const MAX_SIDE = 2800;

export const imageURL = (id) => urls.get(id) || '';

export async function ensureImages(ids) {
  for (const id of ids) {
    if (!id || urls.has(id)) continue;
    const rec = await db.getImage(id);
    if (rec) urls.set(id, URL.createObjectURL(new Blob([rec.buf], { type: rec.type })));
  }
}

export function imageEl(id) {
  if (!decoded.has(id)) {
    decoded.set(id, (async () => {
      await ensureImages([id]);
      const im = new Image();
      im.src = imageURL(id);
      await im.decode();
      return im;
    })());
  }
  return decoded.get(id);
}

// Store a picked photo: scaled down to a sane size, PNG kept as PNG so cut-out transparency survives.
export async function importImage(file) {
  const src = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = src;
    await im.decode();
    const w = im.naturalWidth, h = im.naturalHeight;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const alpha = /png|webp|gif/i.test(file.type);
    const type = alpha ? 'image/png' : 'image/jpeg';
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    if (!alpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); }
    ctx.drawImage(im, 0, 0, cw, ch);
    const blob = await new Promise((r) => cv.toBlob(r, type, 0.92));
    cv.width = 0;
    const buf = await blob.arrayBuffer();
    const id = uid('im');
    await db.putImage(id, { type, buf });
    urls.set(id, URL.createObjectURL(blob));
    return { id, w: cw, h: ch };
  } finally {
    URL.revokeObjectURL(src);
  }
}

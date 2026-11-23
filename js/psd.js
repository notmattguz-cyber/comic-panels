// A small layered Photoshop (PSD) writer: RGB, 8-bit, RLE (PackBits) channels.
// Procreate opens these with every layer kept, at the exact pixel size.
// layers: [{ name, canvas, opacity (0..1), hidden }] bottom first; composite: a canvas.

class Out {
  constructor() { this.parts = []; this.buf = new Uint8Array(1 << 16); this.n = 0; }
  room(k) {
    if (this.n + k <= this.buf.length) return;
    this.flush();
    if (k > this.buf.length) this.buf = new Uint8Array(k);
  }
  flush() { if (this.n) { this.parts.push(this.buf.slice(0, this.n)); this.n = 0; } }
  u8(v) { this.room(1); this.buf[this.n++] = v & 255; }
  u16(v) { this.room(2); this.buf[this.n++] = (v >> 8) & 255; this.buf[this.n++] = v & 255; }
  u32(v) { this.room(4); for (let s = 24; s >= 0; s -= 8) this.buf[this.n++] = (v >>> s) & 255; }
  str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  bytes(a) { this.flush(); this.parts.push(a); }
  blob() { this.flush(); return new Blob(this.parts, { type: 'image/vnd.adobe.photoshop' }); }
}

// PackBits one row of one channel.
function packRow(src, off, step, w, out) {
  let o = 0, i = 0;
  const at = (k) => src[off + k * step];
  while (i < w) {
    let run = 1;
    while (i + run < w && run < 128 && at(i + run) === at(i)) run++;
    if (run >= 2) { out[o++] = 257 - run; out[o++] = at(i); i += run; continue; }
    let lit = 1;
    while (i + lit < w && lit < 128 && !(i + lit + 1 < w && at(i + lit) === at(i + lit + 1))) lit++;
    out[o++] = lit - 1;
    for (let k = 0; k < lit; k++) out[o++] = at(i + k);
    i += lit;
  }
  return o;
}

// Encode the given channels (0..3 of RGBA) of a canvas: per channel { counts:Uint16Array, data:Uint8Array }.
function encode(canvas, chans) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const row = new Uint8Array(w * 2 + 4);
  return chans.map((c) => {
    const counts = new Uint16Array(h);
    const chunks = [];
    let total = 0;
    for (let y = 0; y < h; y++) {
      const n = packRow(px, (y * w) * 4 + c, 4, w, row);
      counts[y] = n;
      chunks.push(row.slice(0, n));
      total += n;
    }
    const data = new Uint8Array(total);
    let o = 0;
    for (const ch of chunks) { data.set(ch, o); o += ch.length; }
    return { counts, data };
  });
}

function pascal(name, pad) {
  const s = String(name).replace(/[^\x20-\x7e]/g, '').slice(0, 255);
  const total = Math.ceil((s.length + 1) / pad) * pad;
  return { s, fill: total - s.length - 1 };
}

export async function makePSD(layers, composite, { dpi = 300, onProgress } = {}) {
  const W = composite.width, H = composite.height;
  const o = new Out();
  // Header
  o.str('8BPS'); o.u16(1); for (let i = 0; i < 6; i++) o.u8(0);
  o.u16(3); o.u32(H); o.u32(W); o.u16(8); o.u16(3);
  // Colour mode data
  o.u32(0);
  // Image resources: resolution
  o.u32(28);
  o.str('8BIM'); o.u16(0x03ED); o.u16(0); o.u32(16);
  o.u32(dpi * 65536); o.u16(1); o.u16(1); o.u32(dpi * 65536); o.u16(1); o.u16(1);

  // Encode each layer (RGBA → channels -1 alpha, 0, 1, 2)
  const enc = [];
  for (let i = 0; i < layers.length; i++) {
    const [r, g, b, a] = encode(layers[i].canvas, [0, 1, 2, 3]);
    enc.push([a, r, g, b]);
    if (onProgress) onProgress((i + 1) / (layers.length + 1));
    await new Promise((res) => setTimeout(res, 0));
  }
  const chLen = (e) => 2 + e.counts.length * 2 + e.data.length;

  // Layer records
  const rec = new Out();
  rec.u16(layers.length);
  layers.forEach((L, i) => {
    rec.u32(0); rec.u32(0); rec.u32(H); rec.u32(W);
    rec.u16(4);
    [-1, 0, 1, 2].forEach((id, k) => { rec.u16(id & 0xffff); rec.u32(chLen(enc[i][k])); });
    rec.str('8BIMnorm');
    rec.u8(Math.round(255 * (L.opacity ?? 1)));
    rec.u8(0);
    rec.u8(L.hidden ? 2 : 0);
    rec.u8(0);
    const nm = pascal(L.name, 4);
    rec.u32(4 + 4 + 1 + nm.s.length + nm.fill);
    rec.u32(0); rec.u32(0);
    rec.u8(nm.s.length); rec.str(nm.s); for (let k = 0; k < nm.fill; k++) rec.u8(0);
  });
  const recBlob = rec.blob();
  let infoLen = recBlob.size;
  for (const e of enc) for (const c of e) infoLen += chLen(c);
  const pad = infoLen % 2;
  infoLen += pad;

  o.u32(4 + infoLen + 4);
  o.u32(infoLen);
  o.bytes(new Uint8Array(await recBlob.arrayBuffer()));
  for (const e of enc) for (const c of e) {
    o.u16(1);
    const cb = new Uint8Array(c.counts.length * 2);
    c.counts.forEach((v, k) => { cb[k * 2] = v >> 8; cb[k * 2 + 1] = v & 255; });
    o.bytes(cb);
    o.bytes(c.data);
  }
  if (pad) o.u8(0);
  o.u32(0); // global layer mask info

  // Merged image (RGB, RLE)
  const m = encode(composite, [0, 1, 2]);
  o.u16(1);
  for (const c of m) {
    const cb = new Uint8Array(c.counts.length * 2);
    c.counts.forEach((v, k) => { cb[k * 2] = v >> 8; cb[k * 2 + 1] = v & 255; });
    o.bytes(cb);
  }
  for (const c of m) o.bytes(c.data);
  if (onProgress) onProgress(1);
  return o.blob();
}

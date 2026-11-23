import { renderPage, MAX_PIXELS } from './render-canvas.js';
import { SCROLL_STEP } from './formats.js';
import { openSheet, toast } from './ui.js';
import { makePSD } from './psd.js';
import { panelPath } from './shapes.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export async function shareFiles(files, title) {
  if (navigator.canShare && navigator.share && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; console.warn('share failed, downloading instead', e); }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return true;
}

const toFile = (cv, mime, name) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(new File([b], name, { type: mime })) : rej(new Error('Could not encode the image'))), mime, 0.92));

async function makeFiles(page, o) {
  const mime = o.type === 'png' ? 'image/png' : 'image/jpeg';
  const ext = o.type === 'png' ? 'png' : 'jpg';
  const base = slug(page.name) || 'page';
  const files = [];
  let scale = o.scale, note = '';
  if (page.format === 'scroll' && o.slice) {
    const maxS = Math.sqrt(MAX_PIXELS / (page.w * SCROLL_STEP));
    if (scale > maxS) { scale = maxS; note = 'Size reduced to the device limit. '; }
    let n = 0;
    for (let y = 0; y < page.h; y += SCROLL_STEP) {
      const h = Math.min(SCROLL_STEP, page.h - y);
      const cv = await renderPage(page, { scale, sketch: o.sketch, y0: y, h });
      files.push(await toFile(cv, mime, `${base}-${String(++n).padStart(2, '0')}.${ext}`));
      cv.width = 0;
    }
    note += `${files.length} slices, ${Math.round(page.w * scale)} × ${Math.round(SCROLL_STEP * scale)} px each`;
  } else {
    const maxS = Math.sqrt(MAX_PIXELS / (page.w * page.h));
    if (scale > maxS) { scale = maxS; note = 'Size reduced to the device limit. '; }
    const cv = await renderPage(page, { scale, sketch: o.sketch });
    note += `${cv.width} × ${cv.height} px`;
    files.push(await toFile(cv, mime, `${base}.${ext}`));
    cv.width = 0;
  }
  return { files, note };
}

export function openExport(page, selId = null, kind = 'picture') {
  if (kind === 'procreate') return openProcreate(page, selId);
  const scroll = page.format === 'scroll';
  const o = { scale: 1, type: 'png', sketch: false, slice: scroll };
  const body = document.createElement('div');
  body.innerHTML = `
    ${kindSeg('picture')}
    <div class="exp-prev"><img id="expImg" alt="Preview"></div>
    <div class="form">
      <div class="row"><span>Size</span><div class="seg" data-k="scale"><button data-v="0.5">Half</button><button data-v="1">Full</button><button data-v="2">Double</button></div></div>
      <div class="row"><span>Format</span><div class="seg" data-k="type"><button data-v="png">PNG</button><button data-v="jpeg">JPEG</button></div></div>
      <label class="row check"><input type="checkbox" data-k="sketch"> Include sketch lines</label>
      ${scroll ? `<label class="row check"><input type="checkbox" data-k="slice" checked> Cut into ${SCROLL_STEP}-tall slices (for webtoon uploads)</label>` : ''}
    </div>
    <p class="note" id="expInfo"></p>
    <button class="btn primary wide" id="expGo" disabled>Share / Save to Photos</button>`;
  openSheet('Export', body);
  const img = body.querySelector('#expImg'), info = body.querySelector('#expInfo'), go = body.querySelector('#expGo');
  let files = [], token = 0, lastURL = null;
  const sync = () => body.querySelectorAll('.seg[data-k]:not([data-k=kind])').forEach((s) => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(o[s.dataset.k]) === b.dataset.v)));
  async function prepare() {
    const my = ++token;
    go.disabled = true;
    info.textContent = 'Rendering…';
    try {
      const out = await makeFiles(page, o);
      if (my !== token) return;
      files = out.files;
      if (lastURL) URL.revokeObjectURL(lastURL);
      lastURL = URL.createObjectURL(files[0]);
      img.src = lastURL;
      info.textContent = out.note + (files.length > 1 ? ' · preview shows the first' : '');
      go.disabled = false;
    } catch (e) {
      console.error(e);
      if (my === token) info.textContent = 'Export failed: ' + e.message;
    }
  }
  body.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const k = b.parentElement.dataset.k;
    if (k === 'kind') { token++; openExport(page, selId, b.dataset.v); return; }
    o[k] = k === 'scale' ? +b.dataset.v : b.dataset.v;
    sync(); prepare();
  });
  body.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k) { o[k] = e.target.checked; prepare(); }
  });
  go.addEventListener('click', () => shareFiles(files, page.name));
  sync(); prepare();
}

const kindSeg = (v) => `<div class="kind-row"><div class="seg" data-k="kind">
  <button data-v="picture" class="${v === 'picture' ? 'on' : ''}">Picture</button>
  <button data-v="procreate" class="${v === 'procreate' ? 'on' : ''}">Procreate</button></div></div>`;

// The area to export: the whole page, or one panel's bounding box.
function areaOf(page, panel) {
  if (!panel) return { x0: 0, y0: 0, w: page.w, h: page.h };
  const bw = (panel.border ?? page.border) || 0;
  // Measure the drawn outline (wavy and jagged edges reach past the corners).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', panelPath(panel, page.w));
  svg.append(path); document.body.append(svg);
  const bb = path.getBBox();
  svg.remove();
  const x0 = Math.max(0, Math.floor(bb.x - bw)), y0 = Math.max(0, Math.floor(bb.y - bw));
  const x1 = Math.min(page.w, Math.ceil(bb.x + bb.width + bw)), y1 = Math.min(page.h, Math.ceil(bb.y + bb.height + bw));
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

function procreateLayers(page, o) {
  const has = {
    img: page.panels.some((p) => p.image),
    ink: (page.ink || []).length > 0,
    text: (page.texts || []).length > 0,
    sketch: page.strokes.length > 0,
  };
  const L = [{ name: 'Paper', parts: ['bg', 'fill'] }];
  if (o.images && has.img) L.push({ name: 'Panel images', parts: ['image', 'popout'] });
  if (o.ink && has.ink) L.push({ name: 'Ink', parts: ['ink'] });
  L.push({ name: 'Panel borders', parts: ['border'] });
  if (o.text && has.text) L.push({ name: 'Balloons', parts: ['text'] });
  if (o.sketch && has.sketch) L.push({ name: 'Sketch', parts: ['sketch'], sketchAlpha: 1, opacity: page.sketchOpacity ?? 1 });
  L.push({ name: 'Panel shapes (for selecting)', parts: ['shape'], hidden: true });
  return { L, has };
}

function openProcreate(page, selId) {
  const panel = page.panels.find((p) => p.id === selId) || null;
  const o = { area: panel ? 'panel' : 'page', scale: 1, sketch: true, ink: true, text: true, images: false };
  const { has } = procreateLayers(page, o);
  const body = document.createElement('div');
  const chk = (k, label, show) => (show ? `<label class="row check"><input type="checkbox" data-k="${k}" ${o[k] ? 'checked' : ''}> ${label}</label>` : '');
  body.innerHTML = `
    ${kindSeg('procreate')}
    <div class="exp-prev"><img id="expImg" alt="Preview"></div>
    <div class="form">
      ${panel ? `<div class="row"><span>Area</span><div class="seg" data-k="area"><button data-v="page">Whole page</button><button data-v="panel">Selected panel</button></div></div>` : ''}
      <div class="row"><span>Size</span><div class="seg" data-k="scale"><button data-v="1">Full</button><button data-v="2">Double</button></div></div>
      ${chk('sketch', 'Sketch lines', has.sketch)}
      ${chk('ink', 'Ink lines', has.ink)}
      ${chk('text', 'Balloons and captions', has.text)}
      ${chk('images', 'Panel images', has.img)}
    </div>
    <p class="note" id="expInfo"></p>
    <button class="btn primary wide" id="expGo" disabled>Share to Procreate (layered PSD)</button>
    <button class="btn wide" id="expCopy" style="margin-top:8px">Copy borders + sketch to paste</button>
    <p class="note">In the share sheet choose Procreate, or Save to Files and use Import in Procreate. Each part comes in as its own layer at the exact size. The hidden Panel shapes layer is for selecting a panel.</p>`;
  openSheet('Export', body);
  const img = body.querySelector('#expImg'), info = body.querySelector('#expInfo'), go = body.querySelector('#expGo');
  let file = null, token = 0, lastURL = null;
  const area = () => areaOf(page, o.area === 'panel' ? panel : null);
  const fitScale = (a) => Math.min(o.scale, Math.sqrt(MAX_PIXELS / (a.w * a.h)));
  const sync = () => body.querySelectorAll('.seg[data-k]:not([data-k=kind])').forEach((s) => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(o[s.dataset.k]) === b.dataset.v)));

  async function prepare() {
    const my = ++token;
    go.disabled = true; file = null;
    info.textContent = 'Building layers…';
    try {
      const a = area(), scale = fitScale(a);
      const { L } = procreateLayers(page, o);
      const canvases = [];
      for (const l of L) {
        const cv = await renderPage(page, { scale, ...a, parts: l.parts, sketchAlpha: l.sketchAlpha });
        canvases.push({ name: l.name, canvas: cv, opacity: l.opacity, hidden: l.hidden });
        if (my !== token) return;
      }
      const shown = L.filter((l) => !l.hidden).flatMap((l) => l.parts);
      const comp = await renderPage(page, { scale, ...a, parts: shown });
      if (my !== token) return;
      if (lastURL) URL.revokeObjectURL(lastURL);
      lastURL = URL.createObjectURL(await new Promise((r) => comp.toBlob(r, 'image/jpeg', 0.8)));
      img.src = lastURL;
      const blob = await makePSD(canvases, comp, { onProgress: (f) => { if (my === token) info.textContent = `Writing PSD… ${Math.round(f * 100)}%`; } });
      canvases.forEach((c) => { c.canvas.width = 0; }); comp.width = 0;
      if (my !== token) return;
      const base = slug(page.name) || 'page';
      const suffix = o.area === 'panel' ? '-panel-' + (page.panels.indexOf(panel) + 1) : '';
      file = new File([blob], `${base}${suffix}.psd`, { type: 'image/vnd.adobe.photoshop' });
      const pw = Math.round(a.w * scale), ph = Math.round(a.h * scale);
      info.textContent = `${pw} × ${ph} px · ${L.length} layers · ${(blob.size / 1048576).toFixed(1)} MB` + (scale < o.scale ? ' · reduced to the device limit' : '');
      go.disabled = false;
    } catch (e) {
      console.error(e);
      if (my === token) info.textContent = 'Export failed: ' + e.message;
    }
  }

  body.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const k = b.parentElement.dataset.k;
    if (k === 'kind') { token++; openExport(page, selId, b.dataset.v); return; }
    o[k] = k === 'scale' ? +b.dataset.v : b.dataset.v;
    sync(); prepare();
  });
  body.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k) { o[k] = e.target.checked; prepare(); }
  });
  go.addEventListener('click', () => { if (file) shareFiles([file], page.name); });
  body.querySelector('#expCopy').addEventListener('click', async () => {
    const a = area(), scale = fitScale(a);
    const png = renderPage(page, { scale, ...a, parts: ['border', 'sketch'], sketchAlpha: 1 })
      .then((cv) => new Promise((r) => cv.toBlob(r, 'image/png')));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast(`Copied ${Math.round(a.w * scale)} × ${Math.round(a.h * scale)} px. Make a canvas that size in Procreate, then paste`);
    } catch (err) {
      console.warn(err);
      toast('This browser would not copy the picture. Use Share instead');
    }
  });
  sync(); prepare();
}

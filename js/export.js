import { renderPage, MAX_PIXELS } from './render-canvas.js';
import { SCROLL_STEP } from './formats.js';
import { openSheet } from './ui.js';

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

export function openExport(page) {
  const scroll = page.format === 'scroll';
  const o = { scale: 1, type: 'png', sketch: false, slice: scroll };
  const body = document.createElement('div');
  body.innerHTML = `
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
  const sync = () => body.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(o[s.dataset.k]) === b.dataset.v)));
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

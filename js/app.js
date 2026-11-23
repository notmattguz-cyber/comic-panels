import * as db from './db.js';
import { FORMATS, FORMAT_GROUPS, newPage, formatLabel } from './formats.js';
import { initEditor, openEditor } from './editor.js';
import { hydrateIcons, icon } from './icons.js';
import { initUI, openSheet, closeSheet, toast, esc, uid } from './ui.js';
import { shareFiles } from './export.js';

const $ = (s) => document.querySelector(s);

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}

async function refreshHome() {
  const pages = (await db.allPages()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const grid = $('#pageGrid');
  grid.innerHTML = pages.map((p) => `
    <div class="card" data-id="${p.id}">
      <div class="thumb">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<div class="blank"></div>'}</div>
      <div class="meta"><b>${esc(p.name)}</b><small>${esc(formatLabel(p))} · ${p.panels.length} panel${p.panels.length === 1 ? '' : 's'}</small></div>
      <button class="btn ghost more" data-more="${p.id}" title="More">${icon('more')}</button>
    </div>`).join('');
  $('#emptyHint').classList.toggle('hidden', pages.length > 0);
}

async function openPage(id) {
  const page = await db.getPage(id);
  if (!page) return;
  show('editor');
  await openEditor(page, async () => {
    show('home');
    await refreshHome();
  });
}

function shapeFor(key) {
  const f = FORMATS[key];
  const hMax = 110, wMax = 100;
  let h = hMax, w = h * f.w / f.h;
  if (w > wMax) { w = wMax; h = w * f.h / f.w; }
  if (key === 'scroll') { w = 34; h = 110; }
  return `<div class="shape" style="width:${w}px;height:${h}px"></div>`;
}

function openNewPage() {
  const html = FORMAT_GROUPS.map((g) => `<div class="group-title">${g.name}</div><div class="choices">${g.keys.map((k) => `
    <button class="choice" data-fmt="${k}">${shapeFor(k)}<b>${FORMATS[k].label}</b><small>${FORMATS[k].sub}</small></button>`).join('')}</div>`).join('');
  const body = openSheet('New page', html, { wide: true });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b) return;
    const count = (await db.allPages()).length;
    const page = newPage(b.dataset.fmt, `Page ${count + 1}`);
    await db.putPage(page);
    closeSheet();
    openPage(page.id);
  });
}

function openCardMenu(id) {
  const body = openSheet('Page', `<div class="menu-list">
    <button class="btn" data-m="open">${icon('edit')}Open</button>
    <button class="btn" data-m="rename">${icon('edit')}Rename</button>
    <button class="btn" data-m="dup">${icon('copy')}Duplicate</button>
    <button class="btn danger" data-m="del">${icon('trash')}Delete</button></div>`);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const page = await db.getPage(id);
    if (!page) return closeSheet();
    switch (b.dataset.m) {
      case 'open': closeSheet(); openPage(id); return;
      case 'rename': {
        const n = prompt('Page name', page.name);
        if (n && n.trim()) { page.name = n.trim(); page.updated = Date.now(); await db.putPage(page); }
        break;
      }
      case 'dup': {
        const c = JSON.parse(JSON.stringify(page));
        c.id = uid('pg'); c.name = page.name + ' copy'; c.created = c.updated = Date.now();
        await db.putPage(c);
        break;
      }
      case 'del':
        if (!confirm(`Delete “${page.name}”? This can't be undone.`)) return;
        await db.deletePage(id);
        await db.collectGarbage();
        break;
    }
    closeSheet();
    refreshHome();
  });
}

/* ---------- library: backup / restore ---------- */

function bufToB64(buf) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(new Blob([buf]));
  });
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

async function openLibrary() {
  let est = '';
  try {
    const e = await navigator.storage.estimate();
    est = `Using ${(e.usage / 1048576).toFixed(1)} MB on this device.`;
  } catch (_) { /* ignore */ }
  let persisted = false;
  try { persisted = await navigator.storage.persisted(); } catch (_) { /* ignore */ }
  const body = openSheet('Library', `<div class="menu-list">
      <button class="btn" id="bkMake">${icon('download')}Back up all pages</button>
      <button class="btn" id="bkRestore">${icon('upload')}Restore from a backup file</button>
    </div>
    <p class="note">${est} ${persisted ? 'Storage is marked as persistent.' : 'Add the app to your Home Screen so iPadOS keeps its storage.'}
    Pages live only on this device, so save a backup to Files now and then.</p>`);
  const mk = body.querySelector('#bkMake');
  let file = null;
  mk.addEventListener('click', async () => {
    if (file) { shareFiles([file], file.name); return; }
    mk.disabled = true;
    mk.lastChild.textContent = 'Preparing…';
    const pages = await db.allPages();
    const images = {};
    for (const k of await db.imageKeys()) {
      const rec = await db.getImage(k);
      images[k] = { type: rec.type, data: await bufToB64(rec.buf) };
    }
    const json = JSON.stringify({ app: 'comic-panels', version: 1, date: new Date().toISOString(), pages, images });
    const day = new Date().toISOString().slice(0, 10);
    file = new File([json], `comic-panels-backup-${day}.json`, { type: 'application/json' });
    mk.disabled = false;
    mk.lastChild.textContent = `Save backup (${(file.size / 1048576).toFixed(1)} MB)`;
  });
  body.querySelector('#bkRestore').addEventListener('click', () => {
    const input = $('#fileRestore');
    input.value = '';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'comic-panels' || !Array.isArray(data.pages)) throw new Error('That is not a Comic Panels backup');
        if (!confirm(`Restore ${data.pages.length} page(s)? Pages already here with the same id are replaced.`)) return;
        for (const [k, v] of Object.entries(data.images || {})) await db.putImage(k, { type: v.type, buf: b64ToBuf(v.data) });
        for (const p of data.pages) await db.putPage(p);
        toast(`Restored ${data.pages.length} page(s)`);
        closeSheet();
        refreshHome();
      } catch (e) {
        toast('Restore failed: ' + e.message, 4000);
      }
    };
    input.click();
  });
}

/* ---------- boot ---------- */

hydrateIcons();
initUI();
initEditor();

$('#btnNew').addEventListener('click', openNewPage);
$('#btnLibrary').addEventListener('click', openLibrary);
$('#pageGrid').addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { openCardMenu(more.dataset.more); return; }
  const card = e.target.closest('.card');
  if (card) openPage(card.dataset.id);
});

(async () => {
  try { await db.collectGarbage(); } catch (e) { console.warn(e); }
  await refreshHome();
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) { /* ignore */ }
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
}

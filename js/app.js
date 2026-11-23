import * as db from './db.js';
import { FORMATS, FORMAT_GROUPS, newPage, formatLabel } from './formats.js';
import { initEditor, openEditor } from './editor.js';
import { hydrateIcons, icon } from './icons.js';
import { initUI, openSheet, closeSheet, toast, esc, uid } from './ui.js';
import { shareFiles } from './export.js';
import { makePDF } from './pdf.js';

const $ = (s) => document.querySelector(s);
let currentBook = null;
let spreads = false;
try { spreads = localStorage.getItem('spreads') === '1'; } catch (_) { /* ignore */ }

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const thumbHTML = (p) => (p && p.thumb ? `<img src="${p.thumb}" alt="">` : '<div class="blank"></div>');

function pageCard(p, label) {
  return `<div class="card" data-page="${p.id}">
    <div class="thumb">${thumbHTML(p)}</div>
    <div class="meta"><b>${esc(label || p.name)}</b><small>${label ? esc(p.name) + ' · ' : ''}${esc(formatLabel(p))} · ${plural(p.panels.length, 'panel')}</small></div>
    <button class="btn ghost more" data-more="${p.id}" title="More">${icon('more')}</button>
  </div>`;
}

/* ================================================================ home */

async function refreshHome() {
  const [pages, books] = await Promise.all([db.allPages(), db.allBooks()]);
  const bookIds = new Set(books.map((b) => b.id));
  books.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const byBook = new Map();
  for (const p of pages) if (bookIds.has(p.bookId)) (byBook.get(p.bookId) || byBook.set(p.bookId, []).get(p.bookId)).push(p);
  for (const list of byBook.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  $('#bookGrid').innerHTML = books.map((b) => {
    const list = byBook.get(b.id) || [];
    return `<div class="card book-card" data-book="${b.id}">
      <div class="thumb"><div class="stack">${thumbHTML(list[0])}</div></div>
      <div class="meta"><b>${esc(b.name)}</b><small>Book · ${plural(list.length, 'page')}</small></div>
      <button class="btn ghost more" data-bmore="${b.id}" title="More">${icon('more')}</button>
    </div>`;
  }).join('');
  const loose = pages.filter((p) => !bookIds.has(p.bookId)).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  $('#pageGrid').innerHTML = loose.map((p) => pageCard(p)).join('');
  $('#booksSection').classList.toggle('hidden', !books.length);
  $('#pagesSection').classList.toggle('hidden', !loose.length);
  $('#emptyHint').classList.toggle('hidden', pages.length + books.length > 0);
}

async function goHome() {
  currentBook = null;
  show('home');
  await refreshHome();
}

/* ================================================================ book screen */

async function openBook(id) {
  currentBook = id;
  show('book');
  await renderBook();
}

async function renderBook() {
  const book = await db.getBook(currentBook);
  if (!book) return goHome();
  $('#bookName').textContent = book.name;
  $('#btnSpreads').classList.toggle('on', spreads);
  const pages = await db.bookPages(book.id);
  const grid = $('#bookPages');
  $('#bookEmpty').classList.toggle('hidden', pages.length > 0);
  grid.classList.toggle('spreads', spreads);
  if (!spreads) {
    grid.innerHTML = pages.map((p, i) => pageCard(p, `Page ${i + 1}`)).join('');
    return;
  }
  // Reading spreads: page 1 sits alone on the right, then 2-3, 4-5...
  const rows = [[null, pages[0]]];
  for (let i = 1; i < pages.length; i += 2) rows.push([pages[i], pages[i + 1] || null]);
  grid.innerHTML = pages.length ? rows.map(([l, r]) => {
    const half = (p, side) => (p
      ? `<div class="half ${side}" data-page="${p.id}">${thumbHTML(p)}<span>${pages.indexOf(p) + 1}</span></div>`
      : `<div class="half ${side} empty-half"></div>`);
    return `<div class="spread">${half(l, 'l')}${half(r, 'r')}</div>`;
  }).join('') : '';
}

async function addPageToBook(bookId, fmt) {
  const list = await db.bookPages(bookId);
  const page = newPage(fmt, `Page ${list.length + 1}`);
  page.bookId = bookId;
  page.order = list.length ? (list[list.length - 1].order ?? list.length - 1) + 1 : 0;
  await db.putPage(page);
  await touchBook(bookId);
  return page;
}

async function touchBook(id) {
  const b = await db.getBook(id);
  if (b) { b.updated = Date.now(); await db.putBook(b); }
}

async function movePage(id, dir) {
  const page = await db.getPage(id);
  const list = await db.bookPages(page.bookId);
  const i = list.findIndex((p) => p.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) if (list[k].order !== k) { list[k].order = k; await db.putPage(list[k]); }
}

function openBookPdf(bookId) {
  const body = openSheet('Export book as PDF', `<div class="form">
      <label class="row check"><input type="checkbox" id="pdfSketch"> Include sketch lines</label>
    </div>
    <p class="note" id="pdfInfo">One PDF page per comic page, in book order. Comic pages come out at print size (6.6 × 10.2 in).</p>
    <button class="btn primary wide" id="pdfGo">Make PDF</button>`);
  const go = body.querySelector('#pdfGo'), info = body.querySelector('#pdfInfo');
  let file = null;
  go.addEventListener('click', async () => {
    if (file) { shareFiles([file], file.name); return; }
    const book = await db.getBook(bookId);
    const pages = await db.bookPages(bookId);
    if (!pages.length) { info.textContent = 'This book has no pages yet.'; return; }
    go.disabled = true;
    try {
      const blob = await makePDF(pages, {
        sketch: body.querySelector('#pdfSketch').checked,
        onProgress: (i, n) => { info.textContent = i < n ? `Rendering page ${i + 1} of ${n}…` : 'Done.'; },
      });
      const name = (book.name.replace(/[^\w\- ]+/g, '').trim() || 'comic') + '.pdf';
      file = new File([blob], name, { type: 'application/pdf' });
      info.textContent = `${plural(pages.length, 'page')} · ${(file.size / 1048576).toFixed(1)} MB`;
      go.textContent = 'Share / Save PDF';
    } catch (e) {
      console.error(e);
      info.textContent = 'PDF failed: ' + e.message;
    }
    go.disabled = false;
  });
}

/* ================================================================ pages */

async function openPage(id) {
  const page = await db.getPage(id);
  if (!page) return;
  let nav = null;
  const bookId = page.bookId && (await db.getBook(page.bookId)) ? page.bookId : null;
  if (bookId) {
    const list = await db.bookPages(bookId);
    const i = list.findIndex((p) => p.id === id);
    nav = {
      hasPrev: i > 0, hasNext: i < list.length - 1,
      prev: () => openPage(list[i - 1].id),
      next: () => openPage(list[i + 1].id),
    };
  }
  show('editor');
  await openEditor(page, async () => {
    if (bookId) { await touchBook(bookId); openBook(bookId); } else goHome();
  }, nav);
}

function shapeFor(key) {
  const f = FORMATS[key];
  const hMax = 110, wMax = 100;
  let h = hMax, w = h * f.w / f.h;
  if (w > wMax) { w = wMax; h = w * f.h / f.w; }
  if (key === 'scroll') { w = 34; h = 110; }
  return `<div class="shape" style="width:${w}px;height:${h}px"></div>`;
}

function pickFormat(title, onPick) {
  const html = FORMAT_GROUPS.map((g) => `<div class="group-title">${g.name}</div><div class="choices">${g.keys.map((k) => `
    <button class="choice" data-fmt="${k}">${shapeFor(k)}<b>${FORMATS[k].label}</b><small>${FORMATS[k].sub}</small></button>`).join('')}</div>`).join('');
  const body = openSheet(title, html, { wide: true });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b || body.dataset.busy) return;
    body.dataset.busy = '1';
    onPick(b.dataset.fmt);
  });
}

function openNewPage() {
  pickFormat('New page', async (fmt) => {
    const count = (await db.allPages()).length;
    const page = newPage(fmt, `Page ${count + 1}`);
    await db.putPage(page);
    closeSheet();
    openPage(page.id);
  });
}

async function newBook() {
  const n = prompt('Name for the new book', 'My comic');
  if (n == null || !n.trim()) return;
  const now = Date.now();
  const book = { id: uid('bk'), name: n.trim(), created: now, updated: now };
  await db.putBook(book);
  openBook(book.id);
}

async function openPageMenu(id) {
  const page = await db.getPage(id);
  if (!page) return;
  const inBook = !!(page.bookId && (await db.getBook(page.bookId)));
  const body = openSheet(page.name, `<div class="menu-list">
    <button class="btn" data-m="open">${icon('edit')}Open</button>
    ${inBook ? `<button class="btn" data-m="earlier">${icon('left')}Move earlier</button><button class="btn" data-m="later">${icon('right')}Move later</button>` : ''}
    <button class="btn" data-m="rename">${icon('type')}Rename</button>
    <button class="btn" data-m="dup">${icon('copy')}Duplicate</button>
    <button class="btn" data-m="tobook">${icon('book')}${inBook ? 'Move to another book…' : 'Add to a book…'}</button>
    ${inBook ? `<button class="btn" data-m="unbook">${icon('popout')}Take out of the book</button>` : ''}
    <button class="btn danger" data-m="del">${icon('trash')}Delete</button></div>`);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    switch (b.dataset.m) {
      case 'open': closeSheet(); openPage(id); return;
      case 'earlier': await movePage(id, -1); break;
      case 'later': await movePage(id, 1); break;
      case 'rename': {
        const n = prompt('Page name', page.name);
        if (n && n.trim()) { page.name = n.trim(); page.updated = Date.now(); await db.putPage(page); }
        break;
      }
      case 'dup': {
        const c = JSON.parse(JSON.stringify(page));
        c.id = uid('pg'); c.name = page.name + ' copy'; c.created = c.updated = Date.now();
        if (inBook) c.order = (page.order ?? 0) + 0.5;
        await db.putPage(c);
        if (inBook) { await movePage(c.id, 0); }
        break;
      }
      case 'tobook': return chooseBook(page);
      case 'unbook': delete page.bookId; delete page.order; page.updated = Date.now(); await db.putPage(page); break;
      case 'del':
        if (!confirm(`Delete “${page.name}”? This can't be undone.`)) return;
        await db.deletePage(id);
        await db.collectGarbage();
        break;
    }
    closeSheet();
    refreshCurrent();
  });
}

async function chooseBook(page) {
  const books = (await db.allBooks()).filter((b) => b.id !== page.bookId);
  const body = openSheet('Add to book', `<div class="menu-list">
    ${books.map((b) => `<button class="btn" data-book="${b.id}">${icon('book')}${esc(b.name)}</button>`).join('')}
    <button class="btn" data-book="new">${icon('plus')}New book…</button></div>`);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-book]');
    if (!b) return;
    let id = b.dataset.book;
    if (id === 'new') {
      const n = prompt('Name for the new book', 'My comic');
      if (n == null || !n.trim()) return;
      const now = Date.now();
      id = uid('bk');
      await db.putBook({ id, name: n.trim(), created: now, updated: now });
    }
    const list = await db.bookPages(id);
    page.bookId = id;
    page.order = list.length ? (list[list.length - 1].order ?? 0) + 1 : 0;
    page.updated = Date.now();
    await db.putPage(page);
    await touchBook(id);
    closeSheet();
    toast('Added to the book');
    refreshCurrent();
  });
}

async function openBookMenu(id) {
  const book = await db.getBook(id);
  if (!book) return;
  const pages = await db.bookPages(id);
  const body = openSheet(book.name, `<div class="menu-list">
    <button class="btn" data-m="open">${icon('book')}Open</button>
    <button class="btn" data-m="rename">${icon('type')}Rename</button>
    <button class="btn" data-m="pdf">${icon('pdf')}Export as PDF</button>
    <button class="btn danger" data-m="delKeep">${icon('trash')}Delete book, keep its pages</button>
    <button class="btn danger" data-m="delAll">${icon('trash')}Delete book and its ${plural(pages.length, 'page')}</button></div>`);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    switch (b.dataset.m) {
      case 'open': closeSheet(); openBook(id); return;
      case 'pdf': openBookPdf(id); return;
      case 'rename': await renameBook(id); break;
      case 'delKeep':
        if (!confirm(`Delete the book “${book.name}”? Its pages stay in your library.`)) return;
        for (const p of pages) { delete p.bookId; delete p.order; await db.putPage(p); }
        await db.deleteBook(id);
        break;
      case 'delAll':
        if (!confirm(`Delete “${book.name}” and all ${plural(pages.length, 'page')} in it? This can't be undone.`)) return;
        for (const p of pages) await db.deletePage(p.id);
        await db.deleteBook(id);
        await db.collectGarbage();
        break;
    }
    closeSheet();
    refreshCurrent();
  });
}

async function renameBook(id) {
  const book = await db.getBook(id);
  const n = prompt('Book name', book.name);
  if (n && n.trim()) { book.name = n.trim(); book.updated = Date.now(); await db.putBook(book); }
}

function refreshCurrent() {
  if (currentBook && !$('#book').classList.contains('hidden')) renderBook();
  else refreshHome();
}

/* ================================================================ library: backup / restore */

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
      <button class="btn" id="bkMake">${icon('download')}<span>Back up everything</span></button>
      <button class="btn" id="bkRestore">${icon('upload')}<span>Restore from a backup file</span></button>
    </div>
    <p class="note">${est} ${persisted ? 'Storage is marked as persistent.' : 'Add the app to your Home Screen so iPadOS keeps its storage.'}
    Pages live only on this device, so save a backup to Files now and then.</p>`);
  const mk = body.querySelector('#bkMake');
  let file = null;
  mk.addEventListener('click', async () => {
    if (file) { shareFiles([file], file.name); return; }
    mk.disabled = true;
    mk.lastChild.textContent = 'Preparing…';
    const [pages, books] = await Promise.all([db.allPages(), db.allBooks()]);
    const images = {};
    for (const k of await db.imageKeys()) {
      const rec = await db.getImage(k);
      images[k] = { type: rec.type, data: await bufToB64(rec.buf) };
    }
    const json = JSON.stringify({ app: 'comic-panels', version: 2, date: new Date().toISOString(), books, pages, images });
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
        if (!confirm(`Restore ${plural(data.pages.length, 'page')}${data.books ? ' and ' + plural(data.books.length, 'book') : ''}? Ones already here with the same id are replaced.`)) return;
        for (const [k, v] of Object.entries(data.images || {})) await db.putImage(k, { type: v.type, buf: b64ToBuf(v.data) });
        for (const b of data.books || []) await db.putBook(b);
        for (const p of data.pages) await db.putPage(p);
        toast(`Restored ${plural(data.pages.length, 'page')}`);
        closeSheet();
        goHome();
      } catch (e) {
        toast('Restore failed: ' + e.message, 4000);
      }
    };
    input.click();
  });
}

/* ================================================================ boot */

hydrateIcons();
initUI();
initEditor();

$('#btnNew').addEventListener('click', openNewPage);
$('#btnNewBook').addEventListener('click', newBook);
$('#btnLibrary').addEventListener('click', openLibrary);
$('#homeScroll').addEventListener('click', (e) => {
  const bm = e.target.closest('[data-bmore]');
  if (bm) { openBookMenu(bm.dataset.bmore); return; }
  const more = e.target.closest('[data-more]');
  if (more) { openPageMenu(more.dataset.more); return; }
  const book = e.target.closest('[data-book]');
  if (book) { openBook(book.dataset.book); return; }
  const card = e.target.closest('[data-page]');
  if (card) openPage(card.dataset.page);
});

$('#btnBookBack').addEventListener('click', goHome);
$('#bookName').addEventListener('click', async () => { await renameBook(currentBook); renderBook(); });
$('#btnSpreads').addEventListener('click', () => {
  spreads = !spreads;
  try { localStorage.setItem('spreads', spreads ? '1' : '0'); } catch (_) { /* ignore */ }
  renderBook();
});
$('#btnBookPdf').addEventListener('click', () => openBookPdf(currentBook));
$('#btnBookNew').addEventListener('click', () => {
  const id = currentBook;
  pickFormat('New page in this book', async (fmt) => {
    const page = await addPageToBook(id, fmt);
    closeSheet();
    openPage(page.id);
  });
});
$('#bookPages').addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { openPageMenu(more.dataset.more); return; }
  const card = e.target.closest('[data-page]');
  if (card) openPage(card.dataset.page);
});

(async () => {
  try { await db.collectGarbage(); } catch (e) { console.warn(e); }
  await refreshHome();
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) { /* ignore */ }
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
}

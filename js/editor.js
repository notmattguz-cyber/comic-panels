import { sub, add, mul, len, dist, mid, rot, pointInPoly, distToSeg, bbox, splitPoly, segCrossesPoly } from './geom.js';
import { buildSnapLines, selfLines, snapPoint } from './snap.js';
import { strokePath, linePath } from './stroke.js';
import * as db from './db.js';
import { imageURL, ensureImages, importImage } from './images.js';
import { renderPage } from './render-canvas.js';
import { LAYOUTS, buildLayout } from './layouts.js';
import { SCROLL_STEP } from './formats.js';
import { FX_MODES, fxOn, fxURL } from './fx.js';
import { TEXT_KINDS, SFX_COLORS, hasTail, newText, autoSize, textSVG, hitText } from './bubbles.js';
import { PANEL_STYLES, panelPath } from './shapes.js';
import { defaultVPs, guideLines, snapDirs, bestDir, VP_COLORS } from './persp.js';
import { icon } from './icons.js';
import { openSheet, closeSheet, sheetOpen, toast, uid, esc } from './ui.js';
import { openExport } from './export.js';

const $ = (s) => document.querySelector(s);
const HANDLE_HIT = 26;   // screen px
const EDGE_HIT = 14;
const SNAP_PX = 14;
const TAP_SLOP = 7;
const MIN_PANEL = 24;
const SWATCHES = ['#2f6fd6', '#e0453a', '#3a3a3a', '#2e9e5b', '#f2a516'];
const FILLS = ['#ffffff', '#fff6bf', '#e3f0ff', '#ffe1e1', '#111111'];
const INKS = ['#111111', '#555555', '#9a9a9a', '#ffffff', '#b3261e'];
const LAYOUT_KEY = 'customLayouts';

export function customLayouts() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '[]'); } catch (_) { return []; }
}
export function setCustomLayouts(list) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(list)); } catch (_) { toast('Could not save layouts on this device'); }
}

const S = {
  page: null, thumb: null,
  view: { s: 1, tx: 0, ty: 0 },
  mode: 'panel', sel: null, tsel: null,
  sketchTool: 'pen', sketchColor: SWATCHES[0], sketchSize: 5, stickSketch: true,
  layer: 'sketch', inkColor: INKS[0], inkSize: 2.5,
  maskTool: 'paint', maskSize: 40,
  textKind: 'speech', look: false,
  snap: true, showGuides: true,
  undo: [], redo: [], before: null,
  pointers: new Map(), action: null, gesture: null,
  penSeen: false, space: false,
  live: null, guides: [], lastTap: null, cursor: null,
  rect: null, dirty: false, onExit: null, nav: null, sketchVer: 0,
};

let stage, defs, viewG, shadowR, pageR, clipR, guideR, panelsG, inkG, textsG, sketchG, perspG, liveG, ghostG, ghostImg, ghostClipPath, overlayG, ctxBar, hintEl;
const els = new Map();
const fxHref = new Map(); // panel id -> last ready look URL (shown while a newer one is processed)
let sketchKey = '', inkKey = '', perspKey = '', raf = 0, saveT = 0, thumbT = 0;
const layerKey = () => (S.layer === 'ink' ? 'ink' : 'strokes');
const allLines = (P) => P.strokes.concat(P.ink);

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function setA(e, attrs) { for (const k in attrs) e.setAttribute(k, attrs[k]); }
const unit = () => S.page.w / 1000;
const selPanel = () => (S.page ? S.page.panels.find((p) => p.id === S.sel) || null : null);
const selText = () => (S.page ? S.page.texts.find((t) => t.id === S.tsel) || null : null);
const ptsStr = (pts) => pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
const imgTransform = (im) => `translate(${im.x} ${im.y}) rotate(${im.r || 0}) scale(${im.s * (im.f || 1)} ${im.s})`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const strokeCache = new WeakMap();
function strokeD(st) {
  const c = strokeCache.get(st);
  const n = st.pts.length, a = st.pts[0];
  if (c && c.n === n && c.x === a[0] && c.y === a[1] && c.s === st.size) return c.d;
  const d = strokePath(st.pts, st.size);
  strokeCache.set(st, { n, x: a[0], y: a[1], s: st.size, d });
  return d;
}

/* ================================================================ setup */

export function initEditor() {
  stage = $('#stage'); defs = $('#defs'); viewG = $('#view');
  shadowR = $('#pageShadow'); pageR = $('#pageRect'); clipR = $('#pageClipRect'); guideR = $('#guideRect');
  panelsG = $('#panels'); inkG = $('#ink'); textsG = $('#texts'); sketchG = $('#sketch'); perspG = $('#persp'); liveG = $('#live');
  ghostG = $('#ghost'); ghostImg = $('#ghostImg'); ghostClipPath = $('#ghostClipPath');
  overlayG = $('#overlay'); ctxBar = $('#ctx'); hintEl = $('#hint');

  document.querySelectorAll('.rail .tool').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#btnHome').addEventListener('click', () => exitEditor());
  $('#btnPrevPage').addEventListener('click', () => goPage(-1));
  $('#btnNextPage').addEventListener('click', () => goPage(1));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnFit').addEventListener('click', fitView);
  $('#btnLayers').addEventListener('click', openLayers);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnExport').addEventListener('click', async () => { await flushSave(); openExport(S.page); });
  $('#pageName').addEventListener('click', renamePage);

  ctxBar.addEventListener('click', onCtxClick);
  ctxBar.addEventListener('input', (e) => { const n = e.target.dataset.rng; if (n) onRange(n, +e.target.value); });
  ctxBar.addEventListener('change', (e) => { if (e.target.dataset.rng) { commit(); if (/^tx/.test(e.target.dataset.rng)) updateCtx(); } });

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('pointerleave', () => { if (!S.action) { S.cursor = null; invalidate(); } });
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  // Stop iOS from turning long presses / double taps into selection or zoom.
  stage.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  stage.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => { if (e.key === ' ') S.space = false; });
  window.addEventListener('resize', () => { S.rect = null; invalidate(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.page) flushSave(); });
}

function normalize(p) {
  p.panels ||= []; p.strokes ||= []; p.texts ||= []; p.ink ||= [];
  p.margin ??= 0; p.gutter ??= 20; p.border ??= 4;
  p.borderColor ||= '#111111'; p.bg ||= '#ffffff';
  p.sketchOpacity ??= 0.85; p.sketchVisible ??= true;
  for (const pn of p.panels) {
    pn.popout ||= 'none'; pn.mask ||= []; pn.fill ||= '#ffffff';
    if (pn.border === undefined) pn.border = null;
    if (pn.image) pn.image.f ||= 1;
  }
  for (const t of p.texts) t.id ||= uid('t');
  return p;
}

// nav: { prev(), next() } when the page belongs to a book.
export async function openEditor(page, onExit, nav = null) {
  S.onExit = onExit;
  S.nav = nav;
  S.thumb = page.thumb || null;
  delete page.thumb;
  S.page = normalize(page);
  S.undo = []; S.redo = []; S.before = null; S.sel = null; S.tsel = null; S.look = false;
  if (S.mode === 'mask') S.mode = 'image';
  S.action = null; S.gesture = null; S.pointers.clear(); S.live = null; S.guides = []; S.dirty = false;
  for (const r of els.values()) { r.g.remove(); r.clip.remove(); r.mask.remove(); }
  els.clear(); fxHref.clear();
  sketchKey = ''; inkKey = ''; perspKey = '';
  await ensureImages(page.panels.map((p) => p.image && p.image.id).filter(Boolean));
  $('#pageName').textContent = page.name;
  $('#btnPrevPage').classList.toggle('hidden', !(nav && nav.hasPrev));
  $('#btnNextPage').classList.toggle('hidden', !(nav && nav.hasNext));
  updateCtx(); updateUndo();
  fitView();
  render();
}

async function exitEditor(then) {
  closeSheet();
  cancelAction();
  await flushSave(true);
  const page = S.page;
  S.page = null;
  if (then) then(page);
  else if (S.onExit) S.onExit(page);
}

function goPage(dir) {
  if (!S.nav) return;
  const fn = dir < 0 ? S.nav.prev : S.nav.next;
  if (fn) exitEditor(() => fn());
}

/* ================================================================ view */

function stageRect() { return S.rect || (S.rect = stage.getBoundingClientRect()); }

function fitView() {
  S.rect = null;
  const r = stageRect(), P = S.page, pad = 28;
  if (!r.width) return;
  let s = Math.min((r.width - pad * 2) / P.w, (r.height - pad * 2) / P.h);
  if (P.format === 'scroll') s = Math.min((r.width - pad * 2) / P.w, (r.height - pad * 2) / (P.w * 1.5));
  S.view.s = s;
  S.view.tx = (r.width - P.w * s) / 2;
  S.view.ty = P.format === 'scroll' ? pad : (r.height - P.h * s) / 2;
  invalidate();
}

function toPage(cx, cy) {
  const r = stageRect();
  return [(cx - r.left - S.view.tx) / S.view.s, (cy - r.top - S.view.ty) / S.view.s];
}

function zoomAt(cx, cy, k) {
  const r = stageRect();
  const sx = cx - r.left, sy = cy - r.top;
  const s = Math.min(8, Math.max(0.03, S.view.s * k));
  const px = (sx - S.view.tx) / S.view.s, py = (sy - S.view.ty) / S.view.s;
  S.view.s = s; S.view.tx = sx - px * s; S.view.ty = sy - py * s;
  invalidate();
}

function onWheel(e) {
  e.preventDefault();
  S.rect = null;
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else { S.view.tx -= e.deltaX; S.view.ty -= e.deltaY; invalidate(); }
}

/* ================================================================ history + saving */

function begin() { if (S.before == null) S.before = JSON.stringify(S.page); }

function commit() {
  if (S.before == null) return;
  const now = JSON.stringify(S.page);
  if (now !== S.before) {
    S.undo.push(S.before);
    if (S.undo.length > 80) S.undo.shift();
    S.redo = [];
    scheduleSave();
  }
  S.before = null;
  S.sketchVer++;
  updateUndo();
}

function restoreBefore() {
  if (S.before != null) { S.page = JSON.parse(S.before); S.before = null; S.sketchVer++; }
}

function undo() {
  cancelAction();
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.page));
  S.page = JSON.parse(S.undo.pop());
  afterHistory();
}

function redo() {
  cancelAction();
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.page));
  S.page = JSON.parse(S.redo.pop());
  afterHistory();
}

function afterHistory() {
  if (!selPanel()) S.sel = null;
  if (!selText()) S.tsel = null;
  if (S.mode === 'mask' && !(selPanel() && selPanel().image)) S.mode = 'panel';
  S.sketchVer++;
  $('#pageName').textContent = S.page.name;
  scheduleSave(); updateUndo(); updateCtx(); invalidate();
}

function updateUndo() {
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
}

function scheduleSave() {
  S.dirty = true;
  clearTimeout(saveT);
  saveT = setTimeout(save, 600);
  clearTimeout(thumbT);
  thumbT = setTimeout(async () => { await makeThumb(); save(); }, 2500);
}

async function save() {
  if (!S.page) return;
  try {
    await db.putPage({ ...S.page, thumb: S.thumb, updated: Date.now() });
  } catch (e) {
    console.error(e);
    toast('Saving failed: ' + e.message, 4000);
  }
}

async function makeThumb() {
  const P = S.page;
  if (!P) return;
  try {
    const cv = await renderPage(P, { scale: 260 / P.w, h: Math.min(P.h, P.w * 1.6) });
    S.thumb = cv.toDataURL('image/jpeg', 0.75);
    cv.width = 0;
  } catch (e) { console.warn('thumb', e); }
}

async function flushSave(withThumb = false) {
  if (!S.page) return;
  clearTimeout(saveT);
  if (withThumb && (S.dirty || !S.thumb)) { clearTimeout(thumbT); await makeThumb(); }
  await save();
  S.dirty = false;
}

/* ================================================================ rendering */

function invalidate() { if (!raf) raf = requestAnimationFrame(render); }

function render() {
  raf = 0;
  const P = S.page;
  if (!P) return;
  const { s, tx, ty } = S.view;
  viewG.setAttribute('transform', `translate(${tx} ${ty}) scale(${s})`);
  setA(shadowR, { x: 0, y: 5 / s, width: P.w, height: P.h });
  setA(pageR, { width: P.w, height: P.h, fill: P.bg });
  setA(clipR, { width: P.w, height: P.h });
  const m = P.margin;
  guideR.style.display = S.showGuides && m > 0 ? '' : 'none';
  setA(guideR, { x: m, y: m, width: Math.max(0, P.w - 2 * m), height: Math.max(0, P.h - 2 * m), 'stroke-width': 1 / s, 'stroke-dasharray': `${6 / s} ${5 / s}` });
  renderPanels();
  renderInk();
  renderTexts();
  renderSketch();
  renderPersp();
  renderGhost();
  renderOverlay();
  hintEl.classList.toggle('hidden', !(P.panels.length === 0 && S.mode === 'panel' && !S.action));
}

function panelRec(p) {
  let r = els.get(p.id);
  if (r) return r;
  const clip = svgEl('clipPath', { id: 'c-' + p.id });
  const clipPoly = svgEl('path');
  clip.append(clipPoly);
  const mask = svgEl('mask', { id: 'm-' + p.id, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse' });
  const maskG = svgEl('g');
  mask.append(maskG);
  defs.append(clip, mask);
  const g = svgEl('g');
  const fill = svgEl('path');
  const clipG = svgEl('g', { 'clip-path': `url(#c-${p.id})` });
  const xf = svgEl('g');
  const img = svgEl('image', { preserveAspectRatio: 'none' });
  xf.append(img); clipG.append(xf);
  // Ink drawn inside this panel lives in the panel's own layer, so panels above (and their pop-outs) cover it.
  const pink = svgEl('g', { 'clip-path': `url(#c-${p.id})` });
  const border = svgEl('path', { fill: 'none', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '20' });
  const pop = svgEl('g');
  const pimg = svgEl('image', { preserveAspectRatio: 'none' });
  pop.append(pimg);
  g.append(fill, clipG, pink, border, pop);
  r = { g, clip, clipPoly, mask, maskG, fill, clipG, xf, img, pink, border, pop, pimg, href: null, maskRef: null, maskLen: -1 };
  els.set(p.id, r);
  return r;
}

function maskInner(mask) {
  return mask.map((m) => `<path d="${linePath(m.pts)}" fill="none" stroke="${m.e ? '#000' : '#fff'}" stroke-width="${m.size}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}

function imageHref(p) {
  const im = p.image;
  if (!fxOn(p.fx)) { fxHref.delete(p.id); return imageURL(im.id); }
  const u = fxURL(im.id, p.fx, invalidate);
  if (u) { fxHref.set(p.id, u); return u; }
  return fxHref.get(p.id) || imageURL(im.id);
}

function renderPanels() {
  const P = S.page;
  const seen = new Set();
  P.panels.forEach((p, i) => {
    const r = panelRec(p);
    seen.add(p.id);
    const d = panelPath(p, P.w);
    r.clipPoly.setAttribute('d', d);
    r.fill.setAttribute('d', d);
    r.border.setAttribute('d', d);
    r.fill.setAttribute('fill', p.fill || '#fff');
    const bw = p.border ?? P.border;
    setA(r.border, { stroke: P.borderColor, 'stroke-width': bw });
    r.border.style.display = bw > 0 ? '' : 'none';
    const im = p.image;
    if (im) {
      const href = imageHref(p);
      if (r.href !== href) {
        for (const e of [r.img, r.pimg]) setA(e, { href, x: -im.w / 2, y: -im.h / 2, width: im.w, height: im.h });
        r.href = href;
      }
      const tr = imgTransform(im);
      r.xf.setAttribute('transform', tr);
      r.clipG.style.display = '';
      if (p.popout === 'all' || p.popout === 'mask') {
        r.pop.style.display = '';
        r.pop.setAttribute('transform', tr);
        if (p.popout === 'mask') {
          r.pop.setAttribute('mask', `url(#m-${p.id})`);
          setA(r.mask, { x: -im.w, y: -im.h, width: im.w * 2, height: im.h * 2 });
          const live = S.action && S.action.type === 'mask' && S.sel === p.id;
          if (live || r.maskRef !== p.mask || r.maskLen !== p.mask.length) {
            r.maskG.innerHTML = maskInner(p.mask);
            r.maskRef = p.mask; r.maskLen = p.mask.length;
          }
        } else r.pop.removeAttribute('mask');
      } else r.pop.style.display = 'none';
    } else {
      r.clipG.style.display = 'none';
      r.pop.style.display = 'none';
      r.href = null;
    }
    if (panelsG.children[i] !== r.g) panelsG.insertBefore(r.g, panelsG.children[i] || null);
  });
  for (const [id, r] of els) {
    if (!seen.has(id)) { r.g.remove(); r.clip.remove(); r.mask.remove(); els.delete(id); }
  }
}

function renderInk() {
  const P = S.page;
  const key = `${S.sketchVer}|${P.ink.length}|${P.panels.length}`;
  if (P.ink === renderInk.ref && key === inkKey) return;
  renderInk.ref = P.ink;
  inkKey = key;
  const byPanel = new Map();
  let free = '';
  for (const st of P.ink) {
    const path = `<path d="${strokeD(st)}" fill="${st.color}"/>`;
    if (st.panel && els.has(st.panel)) byPanel.set(st.panel, (byPanel.get(st.panel) || '') + path);
    else free += path;
  }
  for (const [id, r] of els) r.pink.innerHTML = byPanel.get(id) || '';
  inkG.innerHTML = free;
}

function renderPersp() {
  const P = S.page;
  const on = P.persp && P.persp.on;
  const key = on ? JSON.stringify(P.persp) + S.view.s.toFixed(4) : 'off';
  if (key === perspKey) return;
  perspKey = key;
  if (!on) { perspG.innerHTML = ''; return; }
  const s = S.view.s;
  perspG.innerHTML = guideLines(P).map((l) => `<line x1="${l.a[0]}" y1="${l.a[1]}" x2="${l.b[0]}" y2="${l.b[1]}" stroke="${l.c}" stroke-opacity="${l.horizon ? 0.8 : 0.35}" stroke-width="${(l.horizon ? 1.6 : 1) / s}"/>`).join('');
}

function renderTexts() {
  textsG.innerHTML = S.page.texts.map((t) => `<g transform="translate(${t.x} ${t.y}) rotate(${t.r || 0})">${textSVG(t)}</g>`).join('');
}

function renderSketch() {
  const P = S.page;
  const key = `${S.sketchVer}|${P.strokes.length}|${P.panels.length}`;
  if (P.strokes !== renderSketch.ref || key !== sketchKey) {
    renderSketch.ref = P.strokes;
    sketchKey = key;
    const byId = new Map(P.panels.map((p) => [p.id, p]));
    let free = '';
    const groups = new Map();
    for (const st of P.strokes) {
      const path = `<path d="${strokeD(st)}" fill="${st.color}"/>`;
      const host = st.panel && byId.get(st.panel);
      if (!host) { free += path; continue; }
      if (host.sketchHidden) continue;
      groups.set(host.id, (groups.get(host.id) || '') + path);
    }
    let h = free;
    for (const [id, paths] of groups) h += `<g clip-path="url(#c-${id})">${paths}</g>`;
    sketchG.innerHTML = h;
  }
  sketchG.setAttribute('opacity', P.sketchOpacity);
  sketchG.style.display = P.sketchVisible ? '' : 'none';
  liveG.setAttribute('opacity', S.live && S.live.layer === 'ink' ? 1 : P.sketchOpacity);
  if (S.live) {
    const host = S.live.panel && els.get(S.live.panel);
    liveG.innerHTML = `<g ${host ? `clip-path="url(#c-${S.live.panel})"` : ''}><path d="${strokePath(S.live.pts, S.live.size)}" fill="${S.live.color}"/></g>`;
  } else liveG.innerHTML = '';
}

function renderGhost() {
  const p = selPanel();
  const show = (S.mode === 'image' || S.mode === 'mask') && p && p.image;
  ghostG.style.display = show ? '' : 'none';
  if (!show) return;
  const im = p.image;
  if (ghostG.dataset.img !== im.id) {
    setA(ghostImg, { href: imageURL(im.id), x: -im.w / 2, y: -im.h / 2, width: im.w, height: im.h });
    ghostG.dataset.img = im.id;
  }
  ghostG.setAttribute('transform', imgTransform(im));
  const poly = 'M' + p.pts.map((q) => q[0] + ',' + q[1]).join('L') + 'Z';
  ghostClipPath.setAttribute('d', `M-100000,-100000H100000V100000H-100000Z${poly}`);
}

function guideLine(g, s) {
  const L = (S.page.w + S.page.h) * 2;
  const a = add(g.a, mul(g.d, -L)), b = add(g.a, mul(g.d, L));
  const col = g.k === 'gutter' ? '#ff9f1c' : '#19c3ff';
  return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}" stroke-width="${1.5 / s}"/>`;
}

function textHandles(t) {
  const c = [t.x, t.y];
  return {
    size: add(c, rot([t.w / 2, t.h / 2], t.r || 0)),
    tail: hasTail(t) && t.tail ? t.tail : null,
  };
}

function renderOverlay() {
  const s = S.view.s, a = S.action, P = S.page;
  let h = '';
  if (P.format === 'spread') h += `<line x1="${P.w / 2}" y1="0" x2="${P.w / 2}" y2="${P.h}" stroke="#3b8cff" stroke-opacity=".5" stroke-width="${1.5 / s}" stroke-dasharray="${10 / s} ${6 / s}"/>`;
  if (P.persp && P.persp.on && S.mode === 'sketch') {
    P.persp.vps.forEach((vp, i) => {
      h += `<circle cx="${vp[0]}" cy="${vp[1]}" r="${11 / s}" fill="${VP_COLORS[i]}" stroke="#fff" stroke-width="${3 / s}"/>`;
    });
  }
  if (a && a.type === 'stroke' && a.dir) {
    const st = S.live.pts[0];
    h += guideLine({ a: [st[0], st[1]], d: a.dir, k: 'align' }, s);
  }
  for (const g of S.guides) h += guideLine(g, s);
  if (a && a.type === 'rect') {
    const [x0, y0] = a.a, [x1, y1] = a.b;
    h += `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" fill="rgba(59,140,255,.12)" stroke="#3b8cff" stroke-width="${2 / s}" stroke-dasharray="${7 / s} ${5 / s}"/>`;
  }
  if (a && a.type === 'split') {
    h += `<line x1="${a.a[0]}" y1="${a.a[1]}" x2="${a.b[0]}" y2="${a.b[1]}" stroke="#ff3d77" stroke-width="${2.5 / s}" stroke-dasharray="${8 / s} ${5 / s}"/>`;
  }
  const p = selPanel();
  if (p && S.mode === 'panel') {
    const n = p.pts.length;
    h += `<polygon points="${ptsStr(p.pts)}" fill="none" stroke="#3b8cff" stroke-width="${2 / s}"/>`;
    for (let i = 0; i < n; i++) {
      const m = mid(p.pts[i], p.pts[(i + 1) % n]);
      h += `<circle cx="${m[0]}" cy="${m[1]}" r="${6 / s}" fill="#3b8cff" stroke="#fff" stroke-width="${1.5 / s}"/>`;
    }
    for (const q of p.pts) h += `<circle cx="${q[0]}" cy="${q[1]}" r="${10 / s}" fill="#fff" stroke="#3b8cff" stroke-width="${3 / s}"/>`;
  }
  if (p && (S.mode === 'image' || S.mode === 'mask')) {
    h += `<polygon points="${ptsStr(p.pts)}" fill="none" stroke="#3b8cff" stroke-width="${2 / s}" stroke-dasharray="${8 / s} ${6 / s}"/>`;
    if (S.mode === 'mask' && p.image) {
      const im = p.image;
      h += `<g transform="${imgTransform(im)}"><rect x="${-im.w / 2}" y="${-im.h / 2}" width="${im.w}" height="${im.h}" fill="#ff2d6f" opacity="0.42" mask="url(#m-${p.id})"/></g>`;
    }
  }
  const t = selText();
  if (t && S.mode === 'text') {
    h += `<g transform="translate(${t.x} ${t.y}) rotate(${t.r || 0})"><rect x="${-t.w / 2}" y="${-t.h / 2}" width="${t.w}" height="${t.h}" fill="none" stroke="#3b8cff" stroke-width="${1.5 / s}" stroke-dasharray="${6 / s} ${4 / s}"/></g>`;
    const H = textHandles(t);
    if (H.tail) h += `<circle cx="${H.tail[0]}" cy="${H.tail[1]}" r="${9 / s}" fill="#ff9f1c" stroke="#fff" stroke-width="${2.5 / s}"/>`;
    h += `<rect x="${H.size[0] - 9 / s}" y="${H.size[1] - 9 / s}" width="${18 / s}" height="${18 / s}" rx="${4 / s}" fill="#fff" stroke="#3b8cff" stroke-width="${3 / s}"/>`;
  }
  if (S.cursor && ((S.mode === 'sketch' && S.sketchTool === 'erase') || S.mode === 'mask')) {
    const r = S.mode === 'mask' ? S.maskSize * unit() / 2 : eraserRadius();
    h += `<circle cx="${S.cursor[0]}" cy="${S.cursor[1]}" r="${r}" fill="none" stroke="#fff" stroke-width="${1.5 / s}"/><circle cx="${S.cursor[0]}" cy="${S.cursor[1]}" r="${r}" fill="none" stroke="#000" stroke-width="${0.75 / s}" stroke-dasharray="${3 / s}"/>`;
  }
  overlayG.innerHTML = h;
}

/* ================================================================ pointer input */

function onDown(e) {
  e.preventDefault();
  S.rect = null;
  if (e.pointerType === 'pen') {
    if (!S.penSeen) { S.penSeen = true; if (S.mode === 'sketch' || S.mode === 'mask') updateCtx(); }
  }
  // Palm rejection: while the pencil is down, ignore fingers.
  if (e.pointerType === 'touch' && [...S.pointers.values()].some((p) => p.type === 'pen')) return;
  try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const pt = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
  S.pointers.set(e.pointerId, pt);
  const touches = [...S.pointers.values()].filter((p) => p.type === 'touch');

  if (e.pointerType === 'touch' && touches.length >= 2) {
    if (S.gesture) { S.gesture.maxTouches = Math.max(S.gesture.maxTouches, touches.length); return; }
    cancelAction();
    startGesture(touches[0], touches[1]);
    return;
  }
  if (S.pointers.size > 1 || S.gesture) return;

  if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || S.space)) {
    S.action = { type: 'pan', sx: e.clientX, sy: e.clientY, tx0: S.view.tx, ty0: S.view.ty };
    return;
  }
  startAction(e, pt);
}

function onMove(e) {
  const pt = S.pointers.get(e.pointerId);
  if (!pt) {
    // Hover (mouse or a hovering pencil): show the brush outline.
    if (S.mode === 'mask' || (S.mode === 'sketch' && S.sketchTool === 'erase')) {
      S.cursor = toPage(e.clientX, e.clientY);
      invalidate();
    }
    return;
  }
  pt.x = e.clientX; pt.y = e.clientY;
  if (S.gesture) { updateGesture(); return; }
  if (!S.action) return;
  const a = S.action;
  if (a.type === 'stroke' || a.type === 'mask' || a.type === 'erase') {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) moveAction(ev);
  } else moveAction(e);
  invalidate();
}

function onUp(e) {
  const pt = S.pointers.get(e.pointerId);
  if (!pt) return;
  S.pointers.delete(e.pointerId);
  if (S.gesture) {
    if (S.gesture.ids.includes(e.pointerId)) endGesture();
    return;
  }
  if (S.action) endAction(e, pt);
  if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') S.cursor = null;
  invalidate();
}

function cancelAction() {
  restoreBefore();
  S.action = null; S.live = null; S.guides = [];
  invalidate();
}

function snap(p, lines) {
  if (!S.snap || !lines) return { p, dd: Infinity, guides: [] };
  return snapPoint(p, lines, SNAP_PX / S.view.s);
}

function pressureOf(e) {
  if (e.pointerType === 'pen') return Math.max(0.05, Math.pow(e.pressure || 0.5, 0.85));
  return 0.55;
}

function hitPanel(p) {
  const arr = S.page.panels;
  for (let i = arr.length - 1; i >= 0; i--) if (pointInPoly(p, arr[i].pts)) return arr[i];
  return null;
}

function hitTextAt(p) {
  const arr = S.page.texts;
  for (let i = arr.length - 1; i >= 0; i--) if (hitText(arr[i], p)) return arr[i];
  return null;
}

function panAction(e, extra = {}) {
  return { type: 'pan', sx: e.clientX, sy: e.clientY, tx0: S.view.tx, ty0: S.view.ty, ...extra };
}

function startAction(e, pt) {
  const p = toPage(e.clientX, e.clientY);
  const drawing = S.mode === 'sketch' || S.mode === 'mask';
  const offPage = p[0] < 0 || p[1] < 0 || p[0] > S.page.w || p[1] > S.page.h;
  if ((drawing && pt.type === 'touch' && S.penSeen) || (!drawing && S.mode !== 'text' && offPage)) {
    S.action = panAction(e);
    return;
  }
  switch (S.mode) {
    case 'panel': startPanelAction(p); break;
    case 'split': S.action = { type: 'split', a: p, b: p }; break;
    case 'image': startImageAction(p); break;
    case 'text': startTextAction(p, e); break;
    case 'sketch': {
      const P = S.page;
      if (P.persp && P.persp.on) {
        const i = P.persp.vps.findIndex((vp) => dist(vp, p) < HANDLE_HIT / S.view.s);
        if (i >= 0) { begin(); S.action = { type: 'vp', i }; break; }
      }
      begin();
      if (S.sketchTool === 'erase') { S.action = { type: 'erase' }; S.cursor = p; eraseAt(p); }
      else {
        const ink = S.layer === 'ink';
        if (!ink && !P.sketchVisible) P.sketchVisible = true;
        S.live = {
          color: ink ? S.inkColor : S.sketchColor,
          size: (ink ? S.inkSize : S.sketchSize) * unit(),
          pts: [[p[0], p[1], pressureOf(e)]],
        };
        const host = S.stickSketch ? hitPanel(p) : null;
        if (host) S.live.panel = host.id;
        S.action = { type: 'stroke', layer: S.layer, ruled: !!(P.persp && P.persp.on && P.persp.snap), p0: p };
        S.live.layer = S.layer;
      }
      break;
    }
    case 'mask': startMaskStroke(p); break;
  }
  invalidate();
}

function startPanelAction(p) {
  const s = S.view.s;
  const sel = selPanel();
  if (sel) {
    let bi = -1, bd = HANDLE_HIT / s;
    sel.pts.forEach((q, i) => { const d = dist(q, p); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) {
      begin();
      S.action = { type: 'vertex', i: bi, p0: p, lines: buildSnapLines(S.page, sel.id).concat(selfLines(sel.pts, bi)) };
      return;
    }
    const n = sel.pts.length;
    bd = EDGE_HIT / s;
    for (let i = 0; i < n; i++) {
      const a = sel.pts[i], b = sel.pts[(i + 1) % n];
      const d = Math.min(distToSeg(p, a, b), dist(p, mid(a, b)) * 0.6);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) {
      begin();
      S.action = { type: 'edge', i: bi, p0: p, orig: clone(sel.pts), lines: buildSnapLines(S.page, sel.id) };
      return;
    }
  }
  const hit = hitPanel(p);
  if (hit) {
    if (S.sel !== hit.id) { S.sel = hit.id; updateCtx(); }
    begin();
    S.action = {
      type: 'move', id: hit.id, p0: p, moved: false,
      orig: clone(hit.pts), img0: hit.image ? [hit.image.x, hit.image.y] : null,
      strokes: allLines(S.page).filter((st) => st.panel === hit.id).map((st) => ({ st, pts: clone(st.pts) })),
      lines: buildSnapLines(S.page, hit.id),
    };
    return;
  }
  const lines = buildSnapLines(S.page, null);
  const a = snap(p, lines).p;
  S.action = { type: 'rect', a, b: a, p0: p, lines };
}

function startImageAction(p) {
  const hit = hitPanel(p);
  if (hit && hit.id !== S.sel) { S.sel = hit.id; S.look = false; updateCtx(); }
  const t = selPanel();
  if (!t) return;
  if (!t.image) { S.action = { type: 'noop' }; return; }
  begin();
  S.action = { type: 'image', p0: p, x0: t.image.x, y0: t.image.y };
}

function startTextAction(p, e) {
  const s = S.view.s;
  const t = selText();
  if (t) {
    const H = textHandles(t);
    if (H.tail && dist(H.tail, p) < HANDLE_HIT / s) { begin(); S.action = { type: 'ttail' }; return; }
    if (dist(H.size, p) < HANDLE_HIT / s) { begin(); S.action = { type: 'tsize' }; return; }
  }
  const hit = hitTextAt(p);
  if (hit) {
    if (S.tsel !== hit.id) { S.tsel = hit.id; updateCtx(); }
    begin();
    S.action = { type: 'tmove', id: hit.id, p0: p, x0: hit.x, y0: hit.y, moved: false };
    return;
  }
  // Empty spot: a tap adds a balloon (or deselects), a drag pans.
  S.action = panAction(e, { tnew: p, moved: false });
}

function toLocal(p, im) {
  const v = rot(sub(p, [im.x, im.y]), -(im.r || 0));
  return [v[0] / (im.s * (im.f || 1)), v[1] / im.s];
}

function startMaskStroke(p) {
  const t = selPanel();
  if (!t || !t.image) return;
  begin();
  if (t.popout !== 'mask') t.popout = 'mask';
  const stroke = { pts: [toLocal(p, t.image)], size: S.maskSize * unit() / t.image.s, e: S.maskTool === 'erase' ? 1 : 0 };
  t.mask.push(stroke);
  S.cursor = p;
  S.action = { type: 'mask', stroke };
}

function eraserRadius() { return Math.max(10 / S.view.s, S.sketchSize * unit() * 2); }

function eraseAt(p) {
  const r = eraserRadius();
  const P = S.page;
  const key = layerKey();
  const keep = P[key].filter((st) => {
    const pts = st.pts, rr = r + st.size / 2;
    if (pts.length === 1) return dist(pts[0], p) > rr;
    for (let i = 1; i < pts.length; i++) if (distToSeg(p, pts[i - 1], pts[i]) < rr) return false;
    return true;
  });
  if (keep.length !== P[key].length) P[key] = keep;
}

function moveAction(ev) {
  const a = S.action;
  const P = S.page;
  if (a.type === 'pan') {
    if (!a.moved && Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) < TAP_SLOP) return;
    a.moved = true;
    S.view.tx = a.tx0 + (ev.clientX - a.sx);
    S.view.ty = a.ty0 + (ev.clientY - a.sy);
    return;
  }
  const p = toPage(ev.clientX, ev.clientY);
  switch (a.type) {
    case 'rect': {
      const r = snap(p, a.lines);
      a.b = r.p; S.guides = r.guides;
      break;
    }
    case 'vp': P.persp.vps[a.i] = p; break;
    case 'vertex': {
      const sel = selPanel();
      if (!a.moved && dist(p, a.p0) * S.view.s < TAP_SLOP) return;
      a.moved = true;
      const r = snap(p, a.lines);
      sel.pts[a.i] = r.p; S.guides = r.guides;
      break;
    }
    case 'edge': {
      const sel = selPanel(), n = sel.pts.length;
      const i = a.i, j = (i + 1) % n;
      const d = sub(p, a.p0);
      if (!a.moved && len(d) * S.view.s < TAP_SLOP) return;
      a.moved = true;
      const ci = add(a.orig[i], d), cj = add(a.orig[j], d);
      const si = snap(ci, a.lines), sj = snap(cj, a.lines);
      const best = si.dd <= sj.dd ? { s: si, c: ci } : { s: sj, c: cj };
      const delta = best.s.dd < Infinity ? sub(best.s.p, best.c) : [0, 0];
      sel.pts[i] = add(ci, delta); sel.pts[j] = add(cj, delta);
      S.guides = best.s.guides;
      break;
    }
    case 'move': {
      const d = sub(p, a.p0);
      if (!a.moved && len(d) * S.view.s < TAP_SLOP) return;
      a.moved = true;
      const pn = P.panels.find((q) => q.id === a.id);
      if (!pn) return;
      const cand = a.orig.map((q) => add(q, d));
      let best = null;
      for (const c of cand) { const r = snap(c, a.lines); if (!best || r.dd < best.r.dd) best = { r, c }; }
      const delta = best && best.r.dd < Infinity ? sub(best.r.p, best.c) : [0, 0];
      const tot = add(d, delta);
      pn.pts = cand.map((q) => add(q, delta));
      if (pn.image && a.img0) { pn.image.x = a.img0[0] + tot[0]; pn.image.y = a.img0[1] + tot[1]; }
      for (const { st, pts } of a.strokes) st.pts = pts.map((q) => [q[0] + tot[0], q[1] + tot[1], q[2]]);
      if (a.strokes.length) S.sketchVer++;
      S.guides = best ? best.r.guides : [];
      break;
    }
    case 'split': {
      let b = p;
      const v = sub(b, a.a);
      const ang = Math.atan2(v[1], v[0]) * 180 / Math.PI;
      const near = Math.round(ang / 90) * 90;
      if (S.snap && Math.abs(ang - near) < 3) b = add(a.a, rot([len(v), 0], near));
      a.b = b;
      break;
    }
    case 'stroke': {
      const pts = S.live.pts;
      if (a.ruled) {
        // Perspective ruler: once the direction is clear, the line runs straight along the closest guide.
        const v = sub(p, a.p0);
        if (!a.dir) {
          if (len(v) * S.view.s < 12) return;
          a.dir = bestDir(snapDirs(P, a.p0), v);
        }
        const t = v[0] * a.dir[0] + v[1] * a.dir[1];
        S.live.pts = [pts[0], [a.p0[0] + a.dir[0] * t, a.p0[1] + a.dir[1] * t, pressureOf(ev)]];
        return;
      }
      const last = pts[pts.length - 1];
      if (dist(last, p) < 1.2 / S.view.s) return;
      const k = 0.6;
      pts.push([last[0] + (p[0] - last[0]) * k, last[1] + (p[1] - last[1]) * k, pressureOf(ev)]);
      break;
    }
    case 'erase': S.cursor = p; eraseAt(p); break;
    case 'mask': {
      const t = selPanel();
      if (!t || !t.image) return;
      S.cursor = p;
      const lp = toLocal(p, t.image);
      const pts = a.stroke.pts;
      if (dist(pts[pts.length - 1], lp) * t.image.s * S.view.s < 1.5) return;
      pts.push(lp);
      break;
    }
    case 'image': {
      const t = selPanel();
      t.image.x = a.x0 + p[0] - a.p0[0];
      t.image.y = a.y0 + p[1] - a.p0[1];
      break;
    }
    case 'tmove': {
      const t = selText();
      const d = sub(p, a.p0);
      if (!a.moved && len(d) * S.view.s < TAP_SLOP) return;
      a.moved = true;
      t.x = a.x0 + d[0]; t.y = a.y0 + d[1];
      break;
    }
    case 'ttail': selText().tail = p; break;
    case 'tsize': {
      const t = selText();
      const l = rot(sub(p, [t.x, t.y]), -(t.r || 0));
      t.w = Math.max(t.size * 1.5, Math.abs(l[0]) * 2);
      t.h = Math.max(t.size * 1.2, Math.abs(l[1]) * 2);
      t.auto = false;
      break;
    }
  }
}

function endAction(e, pt) {
  const a = S.action;
  S.action = null;
  S.guides = [];
  const P = S.page;
  switch (a.type) {
    case 'pan':
      if (a.tnew && !a.moved) {
        if (S.tsel) { S.tsel = null; updateCtx(); }
        else addText(a.tnew);
      }
      break;
    case 'rect': {
      const [x0, y0] = a.a, [x1, y1] = a.b;
      const minP = MIN_PANEL / S.view.s;
      if (Math.abs(x1 - x0) > minP && Math.abs(y1 - y0) > minP) {
        begin();
        const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
        const pn = newPanel([[L, T], [R, T], [R, B], [L, B]]);
        P.panels.push(pn);
        S.sel = pn.id;
        commit();
      } else if (S.sel) S.sel = null;
      updateCtx();
      break;
    }
    case 'move': {
      commit();
      if (!a.moved && isDoubleTap(a.id)) {
        const pn = P.panels.find((q) => q.id === a.id);
        if (pn && pn.image) setMode('image');
        else if (pn) pickImage(pn.id);
      }
      break;
    }
    case 'tmove': {
      commit();
      if (!a.moved && isDoubleTap(a.id)) editText();
      break;
    }
    case 'vertex': case 'edge': {
      commit();
      if (a.moved) break;
      const sel = selPanel();
      if (!sel || !isDoubleTap(`${a.type}:${sel.id}:${a.i}`)) break;
      if (a.type === 'vertex') {
        if (sel.pts.length <= 3) { toast('A panel needs at least 3 corners'); break; }
        changePanelPts(sel, (pts) => pts.filter((_, k) => k !== a.i));
        toast('Corner removed');
      } else {
        const n = sel.pts.length, A = sel.pts[a.i], Bp = sel.pts[(a.i + 1) % n];
        const d = sub(Bp, A), l2 = d[0] * d[0] + d[1] * d[1] || 1;
        const t = Math.max(0.05, Math.min(0.95, ((a.p0[0] - A[0]) * d[0] + (a.p0[1] - A[1]) * d[1]) / l2));
        changePanelPts(sel, (pts) => { pts.splice(a.i + 1, 0, [A[0] + d[0] * t, A[1] + d[1] * t]); return pts; });
        toast('Corner added · drag it to bend the edge');
      }
      break;
    }
    case 'vp': case 'erase': case 'image': case 'mask': case 'ttail': commit(); break;
    case 'tsize': commit(); break;
    case 'stroke': {
      if (S.live) {
        const key = a.layer === 'ink' ? 'ink' : 'strokes';
        const st = S.live;
        delete st.layer;
        if (st.pts.length > 1 || !a.ruled) P[key] = P[key].concat([st]);
        S.live = null;
      }
      commit();
      break;
    }
    case 'split': doSplit(a.a, a.b); break;
  }
  if (a.type === 'image') updateCtx();
}

function isDoubleTap(id) {
  const now = performance.now();
  const lt = S.lastTap;
  if (lt && lt.id === id && now - lt.t < 380) { S.lastTap = null; return true; }
  S.lastTap = { id, t: now };
  return false;
}

/* ---------------------------------------------------------- two-finger gestures */

function startGesture(t1, t2) {
  const sel = selPanel();
  const g = { ids: [t1.id, t2.id], t0: performance.now(), maxTouches: 2, moved: false, c1: [t1.x, t1.y], c2: [t2.x, t2.y] };
  const p1 = toPage(t1.x0, t1.y0);
  if (S.mode === 'image' && sel && sel.image && pointInPoly(p1, sel.pts)) {
    begin();
    g.type = 'img';
    g.p1 = toPage(t1.x, t1.y); g.p2 = toPage(t2.x, t2.y);
    g.im0 = { ...sel.image };
  } else {
    g.type = 'view';
    g.v0 = { ...S.view };
  }
  S.gesture = g;
}

function updateGesture() {
  const g = S.gesture;
  const a = S.pointers.get(g.ids[0]), b = S.pointers.get(g.ids[1]);
  if (!a || !b) return;
  const c1 = [a.x, a.y], c2 = [b.x, b.y];
  if (!g.moved && (dist(c1, g.c1) > 10 || dist(c2, g.c2) > 10)) g.moved = true;
  if (g.type === 'view') {
    const r = stageRect();
    const k = dist(c1, c2) / Math.max(1, dist(g.c1, g.c2));
    const s = Math.min(8, Math.max(0.03, g.v0.s * k));
    const m0 = mid(g.c1, g.c2), m1 = mid(c1, c2);
    const px = (m0[0] - r.left - g.v0.tx) / g.v0.s, py = (m0[1] - r.top - g.v0.ty) / g.v0.s;
    S.view.s = s;
    S.view.tx = m1[0] - r.left - px * s;
    S.view.ty = m1[1] - r.top - py * s;
  } else {
    const sel = selPanel();
    if (!sel || !sel.image) return;
    const q1 = toPage(a.x, a.y), q2 = toPage(b.x, b.y);
    const u = sub(g.p2, g.p1), v = sub(q2, q1);
    const ds = len(v) / Math.max(1e-6, len(u));
    const dr = (Math.atan2(v[1], v[0]) - Math.atan2(u[1], u[0])) * 180 / Math.PI;
    const m0 = mid(g.p1, g.p2), m1 = mid(q1, q2);
    const rel = mul(rot(sub([g.im0.x, g.im0.y], m0), dr), ds);
    const im = sel.image;
    im.x = m1[0] + rel[0]; im.y = m1[1] + rel[1];
    im.s = g.im0.s * ds;
    im.r = g.im0.r + dr;
  }
  invalidate();
}

function endGesture() {
  const g = S.gesture;
  S.gesture = null;
  const quick = !g.moved && performance.now() - g.t0 < 320;
  if (g.type === 'img') {
    if (quick) restoreBefore(); else commit();
    updateCtx();
  }
  if (quick) { if (g.maxTouches >= 3) redo(); else undo(); }
  invalidate();
}

/* ================================================================ panel operations */

function newPanel(pts) {
  return { id: uid('p'), pts, border: null, fill: '#ffffff', image: null, popout: 'none', mask: [] };
}

function doSplit(a, b) {
  if (dist(a, b) * S.view.s < 20) return;
  const P = S.page;
  begin();
  const out = [];
  let did = 0;
  for (const p of P.panels) {
    if (segCrossesPoly(a, b, p.pts)) {
      const parts = splitPoly(p.pts, a, b, P.gutter);
      if (parts.length === 2) {
        did++;
        const c = clone(p);
        c.id = uid('p');
        p.pts = parts[0];
        c.pts = parts[1];
        // Sketch lines go with whichever half they start in.
        for (const st of allLines(P)) if (st.panel === p.id && pointInPoly(st.pts[0], parts[1])) st.panel = c.id;
        out.push(p, c);
        continue;
      }
    }
    out.push(p);
  }
  P.panels = out;
  commit();
  if (!did) toast('Draw the line right across a panel to split it');
  else { S.sel = null; updateCtx(); }
}

function reorder(kind) {
  const isText = S.mode === 'text';
  const arr = isText ? S.page.texts : S.page.panels;
  const id = isText ? S.tsel : S.sel;
  const i = arr.findIndex((p) => p.id === id);
  if (i < 0) return;
  begin();
  const [p] = arr.splice(i, 1);
  const j = { front: arr.length, forward: Math.min(arr.length, i + 1), backward: Math.max(0, i - 1), back: 0 }[kind];
  arr.splice(j, 0, p);
  commit();
  invalidate();
  toast(`Layer ${j + 1} of ${arr.length}${j === arr.length - 1 ? ' (top)' : j === 0 ? ' (bottom)' : ''}`);
}

function change(fn) {
  const p = selPanel();
  if (!p) return;
  begin(); fn(p); commit(); invalidate();
}

function changeText(fn) {
  const t = selText();
  if (!t) return;
  begin(); fn(t); if (t.auto) autoSize(t); commit(); invalidate();
}

function changePage(fn) { begin(); fn(S.page); commit(); invalidate(); }

function changePanelPts(p, fn) { begin(); p.pts = fn(p.pts.map((q) => q.slice())); commit(); invalidate(); updateCtx(); }

function coverScale(p) {
  const b = bbox(p.pts), im = p.image;
  return Math.max(b.w / im.w, b.h / im.h);
}

function fitImage(p, cover) {
  const b = bbox(p.pts), im = p.image;
  im.s = cover ? Math.max(b.w / im.w, b.h / im.h) : Math.min(b.w / im.w, b.h / im.h);
  im.x = b.cx; im.y = b.cy; im.r = 0;
}

function pickImage(id) {
  const input = $('#fileImage');
  input.value = '';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    toast('Loading image…');
    try {
      const info = await importImage(f);
      const p = S.page && S.page.panels.find((q) => q.id === id);
      if (!p) return;
      begin();
      p.image = { id: info.id, w: info.w, h: info.h, x: 0, y: 0, s: 1, r: 0, f: 1 };
      p.mask = [];
      if (p.popout === 'mask') p.popout = 'none';
      fitImage(p, true);
      commit();
      S.sel = p.id;
      updateCtx(); invalidate();
      toast('Image added · double-tap the panel to move it');
    } catch (err) {
      console.error(err);
      toast('Could not load that image');
    }
  };
  input.click();
}

function deleteSel() {
  if (S.mode === 'text') {
    if (!S.tsel) return;
    changePage((P) => { P.texts = P.texts.filter((t) => t.id !== S.tsel); });
    S.tsel = null; updateCtx();
    return;
  }
  if (!S.sel) return;
  begin();
  const id = S.sel;
  S.page.panels = S.page.panels.filter((p) => p.id !== id);
  S.page.strokes = S.page.strokes.filter((st) => st.panel !== id);
  S.page.ink = S.page.ink.filter((st) => st.panel !== id);
  S.sel = null;
  commit(); updateCtx(); invalidate();
}

function duplicateSel() {
  const P = S.page;
  const off = P.gutter * 2;
  if (S.mode === 'text') {
    const t = selText();
    if (!t) return;
    begin();
    const c = clone(t);
    c.id = uid('t'); c.x += off; c.y += off;
    if (c.tail) c.tail = [c.tail[0] + off, c.tail[1] + off];
    P.texts.splice(P.texts.indexOf(t) + 1, 0, c);
    S.tsel = c.id;
    commit(); updateCtx(); invalidate();
    return;
  }
  const p = selPanel();
  if (!p) return;
  begin();
  const c = clone(p);
  c.id = uid('p');
  c.pts = c.pts.map((q) => [q[0] + off, q[1] + off]);
  if (c.image) { c.image.x += off; c.image.y += off; }
  P.panels.splice(P.panels.indexOf(p) + 1, 0, c);
  for (const key of ['strokes', 'ink']) {
    const copies = P[key].filter((st) => st.panel === p.id).map((st) => ({ ...clone(st), panel: c.id, pts: st.pts.map((q) => [q[0] + off, q[1] + off, q[2]]) }));
    if (copies.length) P[key] = P[key].concat(copies);
  }
  S.sel = c.id;
  commit(); updateCtx(); invalidate();
}

/* ---------------------------------------------------------- text */

function addText(p) {
  const P = S.page;
  const t = newText(S.textKind, p[0], p[1], 24 * unit());
  t.id = uid('t');
  begin();
  P.texts.push(t);
  S.tsel = t.id;
  updateCtx(); invalidate();
  if (t.kind === 'sfx') { commit(); editText(); }
  else editText(true);
}

function editText(isNew = false) {
  const t = selText();
  if (!t) return;
  begin();
  const body = openSheet(isNew ? 'New ' + TEXT_KINDS.find((k) => k[0] === t.kind)[1].toLowerCase() : 'Edit text',
    `<textarea id="txtEdit" rows="4" placeholder="Type the words…">${esc(t.text)}</textarea>
     <p class="note">${t.auto ? 'The balloon resizes to fit. ' : ''}Return starts a new line. Apple Pencil Scribble works here too.</p>
     <button class="btn primary wide" id="txtDone">Done</button>`, {
    top: true,
    onClose: () => {
      const cur = S.page && S.page.texts.find((x) => x.id === t.id);
      if (cur && !cur.text.trim()) { S.page.texts = S.page.texts.filter((x) => x.id !== t.id); S.tsel = null; }
      commit(); updateCtx(); invalidate();
    },
  });
  const ta = body.querySelector('#txtEdit');
  ta.addEventListener('input', () => {
    const cur = S.page.texts.find((x) => x.id === t.id);
    if (!cur) return;
    cur.text = ta.value;
    if (cur.auto) autoSize(cur);
    // A brand-new balloon keeps its tail just outside as it grows.
    if (isNew && hasTail(cur) && cur.tail) cur.tail = [cur.x - cur.w * 0.2, cur.y + cur.h * 0.95];
    invalidate();
  });
  body.querySelector('#txtDone').addEventListener('click', closeSheet);
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60);
}

/* ================================================================ modes + context bar */

function setMode(m) {
  if (m === 'mask' && !(selPanel() && selPanel().image)) return;
  cancelAction();
  if (m !== 'image' && m !== 'mask') S.look = false;
  S.mode = m;
  S.cursor = null;
  updateCtx(); invalidate();
}

const B = (act, ic, label, cls = '') => `<button class="cbtn ${cls}" data-act="${act}">${icon(ic)}<span>${label}</span></button>`;
const SEG = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-val="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const RNG = (name, label, min, max, step, val) => `<label class="rng"><span>${label}</span><input type="range" data-rng="${name}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
const SEP = '<i class="sep"></i>';
const TIP = (t) => `<span class="tip">${t}</span>`;
const POP = (p) => `<span class="lbl">Pop out</span>` + SEG('popout', [['none', 'Off'], ['all', 'Whole'], ['mask', 'Painted']], p.popout);
const SW = (attr, colors, cur) => `<div class="swatches">${colors.map((c) => `<button data-${attr}="${c}" class="${c === cur ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`;

function updateCtx() {
  document.querySelectorAll('.rail .tool').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode || (S.mode === 'mask' && b.dataset.mode === 'image')));
  const P = S.page, p = selPanel();
  if (!P) return;
  let h = '';
  switch (S.mode) {
    case 'panel':
      if (!p) {
        h = B('layouts', 'layout', 'Layouts') + (P.panels.length ? B('saveLayout', 'download', 'Save layout') : '')
          + B('snap', 'magnet', 'Snap', S.snap ? 'on' : '') + B('guides', 'eye', 'Margins', S.showGuides ? 'on' : '')
          + TIP('Drag on the page to draw a panel · tap one to edit · two fingers pan and zoom · two-finger tap undoes');
      } else {
        const hasSketch = P.strokes.some((st) => st.panel === p.id);
        const style = p.style || 'straight';
        h = B('pickImage', 'image', p.image ? 'Replace image' : 'Add image')
          + (p.image ? B('toImage', 'move', 'Adjust image') : '')
          + SEP + `<span class="lbl">Edge</span>` + SEG('pstyle', PANEL_STYLES, style)
          + (style !== 'straight' ? RNG('pamt', style === 'rounded' ? 'Radius' : 'Size', 5, 100, 1, p.amt ?? 50) : '')
          + TIP(`${p.pts.length} corners · double-tap an edge to add one, a corner to remove it`)
          + SEP + POP(p)
          + SEP + B('front', 'front', 'Front') + B('forward', 'up', 'Up') + B('backward', 'down', 'Down') + B('back', 'backmost', 'Back')
          + SEP + RNG('border', 'Border', 0, Math.round(30 * unit()), 1, p.border ?? P.border)
          + `<span class="lbl">Fill</span>` + SW('fill', FILLS, p.fill)
          + (hasSketch ? B('panelSketch', 'pencil', 'Sketch', p.sketchHidden ? '' : 'on') : '')
          + B('square', 'rect', 'Square up') + B('dup', 'copy', 'Duplicate') + B('del', 'trash', 'Delete', 'danger');
      }
      break;
    case 'split':
      h = B('snap', 'magnet', 'Snap angle', S.snap ? 'on' : '') + TIP(`Drag a line across panels to cut them apart with a ${Math.round(P.gutter)} px gutter`);
      break;
    case 'image':
      if (!p) h = TIP('Tap a panel to pick it');
      else if (!p.image) h = B('pickImage', 'image', 'Add image') + TIP('This panel has no image yet');
      else if (S.look) {
        const fx = p.fx || {};
        const mode = fx.mode || 'none';
        h = SEG('fxMode', FX_MODES, mode)
          + RNG('fxB', 'Brightness', -60, 60, 1, fx.b || 0)
          + RNG('fxC', 'Contrast', -60, 80, 1, fx.c || 0)
          + (mode === 'tone' ? RNG('fxK', 'Dot size', 0, 100, 1, fx.k ?? 50) : '')
          + (mode === 'ink' ? RNG('fxK', 'Ink', 0, 100, 1, fx.k ?? 50) : '')
          + B('fxReset', 'undo', 'Reset') + B('lookDone', 'check', 'Done', 'primary');
      } else {
        h = B('fill', 'maximize', 'Fill') + B('fit', 'minimize', 'Fit') + B('flip', 'flip', 'Flip')
          + RNG('zoom', 'Zoom', 10, 400, 1, Math.round(p.image.s / coverScale(p) * 100))
          + RNG('rot', 'Rotate', -180, 180, 1, Math.round(((p.image.r % 360) + 540) % 360 - 180))
          + B('look', 'sparkle', 'Look', fxOn(p.fx) ? 'on' : '')
          + SEP + POP(p) + B('paintMask', 'brush', 'Paint pop-out')
          + SEP + B('pickImage', 'image', 'Replace') + B('rmImage', 'trash', 'Remove', 'danger') + B('done', 'check', 'Done', 'primary');
      }
      break;
    case 'mask':
      h = SEG('maskTool', [['paint', 'Paint'], ['erase', 'Erase']], S.maskTool)
        + RNG('maskSize', 'Brush', 4, 200, 1, S.maskSize)
        + B('maskClear', 'trash', 'Clear') + B('maskInvert', 'popout', 'Whole image')
        + TIP('Paint over the parts that should break out of the frame (pink)')
        + B('maskDone', 'check', 'Done', 'primary');
      break;
    case 'text': {
      const t = selText();
      if (!t) {
        h = `<span class="lbl">New</span>` + SEG('textKind', TEXT_KINDS, S.textKind)
          + TIP('Tap the page to add one · drag the orange dot to aim the tail');
      } else {
        h = B('editText', 'edit', 'Edit text') + SEG('tKind', TEXT_KINDS, t.kind)
          + RNG('txSize', 'Size', Math.round(8 * unit()), Math.round(t.kind === 'sfx' ? 160 * unit() : 50 * unit()), 1, Math.round(t.size))
          + RNG('txRot', 'Tilt', -45, 45, 1, Math.round(t.r || 0))
          + B('caps', 'type', 'ABC', t.caps ? 'on' : '')
          + (hasTail(t) ? B('tail', 'tail', 'Tail', t.tail ? 'on' : '') : '')
          + `<span class="lbl">Colour</span>` + SW('tfill', t.kind === 'sfx' ? SFX_COLORS : FILLS.slice(0, 4), t.fill)
          + B('fitText', 'fit', 'Fit to text', t.auto ? 'on' : '')
          + SEP + B('front', 'front', 'Front') + B('back', 'backmost', 'Back')
          + B('dup', 'copy', 'Duplicate') + B('del', 'trash', 'Delete', 'danger');
      }
      break;
    }
    case 'sketch': {
      const ink = S.layer === 'ink';
      const pm = P.persp && P.persp.on ? String(P.persp.mode) : 'off';
      h = SEG('layer', [['sketch', 'Sketch'], ['ink', 'Ink']], S.layer)
        + SEG('sketchTool', [['pen', ink ? 'Pen' : 'Pencil'], ['erase', 'Eraser']], S.sketchTool)
        + (ink
          ? SW('ink', INKS, S.sketchTool === 'pen' ? S.inkColor : '')
          : SW('swatch', SWATCHES, S.sketchTool === 'pen' ? S.sketchColor : ''))
        + RNG('sketchSize', 'Size', 0.5, 20, 0.5, ink ? S.inkSize : S.sketchSize)
        + (ink ? '' : RNG('sketchOp', 'Opacity', 10, 100, 1, Math.round(P.sketchOpacity * 100)))
        + B('stick', 'panel', 'Stick to panels', S.stickSketch ? 'on' : '')
        + SEP + `<span class="lbl">Perspective</span>` + SEG('persp', [['off', 'Off'], ['1', '1-pt'], ['2', '2-pt'], ['3', '3-pt']], pm)
        + (pm !== 'off' ? B('perspSnap', 'magnet', 'Ruler', P.persp.snap ? 'on' : '') + B('perspReset', 'undo', 'Reset points') : '')
        + SEP + (ink ? '' : B('sketchVis', 'eye', 'Show', P.sketchVisible ? 'on' : ''))
        + B('sketchClear', 'trash', ink ? 'Clear ink' : 'Clear sketch', 'danger')
        + TIP(pm !== 'off' ? 'Drag the coloured dots to move vanishing points' + (P.persp.snap ? ' · lines run straight along the guides' : '')
          : ink ? 'Ink stays in exports; the blue sketch is for planning'
            : S.penSeen ? 'Pencil draws · finger pans' : 'Finger draws until you use Apple Pencil');
      break;
    }
  }
  ctxBar.innerHTML = h;
}

function onCtxClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act) return act(b.dataset.act);
  if (b.dataset.swatch) { S.sketchColor = b.dataset.swatch; S.sketchTool = 'pen'; updateCtx(); return; }
  if (b.dataset.ink) { S.inkColor = b.dataset.ink; S.sketchTool = 'pen'; updateCtx(); return; }
  if (b.dataset.fill) { change((p) => { p.fill = b.dataset.fill; }); updateCtx(); return; }
  if (b.dataset.tfill) { changeText((t) => { t.fill = b.dataset.tfill; }); updateCtx(); return; }
  const seg = b.closest('[data-seg]');
  if (seg) setSeg(seg.dataset.seg, b.dataset.val);
}

function setSeg(name, v) {
  if (name === 'popout') {
    change((p) => { p.popout = v; });
    if (v === 'mask') {
      const p = selPanel();
      if (p && p.image) { setMode('mask'); if (!p.mask.length) toast('Paint the part that should pop out'); return; }
    }
    updateCtx();
    return;
  }
  if (name === 'pstyle') { change((p) => { p.style = v; if (p.amt == null) p.amt = 50; }); updateCtx(); return; }
  if (name === 'layer') { S.layer = v; S.sketchTool = 'pen'; updateCtx(); return; }
  if (name === 'persp') {
    changePage((P) => {
      if (v === 'off') { if (P.persp) P.persp.on = false; return; }
      const mode = +v;
      const keep = P.persp && P.persp.vps && P.persp.vps.length >= mode && P.persp.mode >= mode;
      P.persp = { on: true, mode, snap: P.persp ? !!P.persp.snap : false, vps: keep ? P.persp.vps.slice(0, mode) : defaultVPs(P, mode) };
    });
    updateCtx();
    return;
  }
  if (name === 'fxMode') { change((p) => { p.fx = { ...(p.fx || {}), mode: v }; }); updateCtx(); return; }
  if (name === 'tKind') {
    changeText((t) => {
      const was = t.kind;
      t.kind = v;
      if (v === 'sfx' && was !== 'sfx') { t.size *= 2.6; t.fill = SFX_COLORS[0]; t.auto = true; }
      if (was === 'sfx' && v !== 'sfx') { t.size /= 2.6; t.fill = '#ffffff'; t.auto = true; }
      if (v === 'caption') { t.fill = '#fff6bf'; t.caps = false; }
      if (hasTail(t) && !t.tail) t.tail = [t.x - t.w * 0.2, t.y + t.h * 0.95];
    });
    S.textKind = v;
    updateCtx();
    return;
  }
  if (name === 'textKind') S.textKind = v;
  if (name === 'maskTool') S.maskTool = v;
  if (name === 'sketchTool') S.sketchTool = v;
  updateCtx(); invalidate();
}

function onRange(name, v) {
  const p = selPanel(), t = selText();
  switch (name) {
    case 'border': if (p) { begin(); p.border = v; } break;
    case 'zoom': if (p && p.image) { begin(); p.image.s = coverScale(p) * v / 100; } break;
    case 'rot': if (p && p.image) { begin(); p.image.r = v; } break;
    case 'fxB': if (p) { begin(); p.fx = { ...(p.fx || {}), b: v }; } break;
    case 'fxC': if (p) { begin(); p.fx = { ...(p.fx || {}), c: v }; } break;
    case 'fxK': if (p) { begin(); p.fx = { ...(p.fx || {}), k: v }; } break;
    case 'txSize': if (t) { begin(); t.size = v; if (t.auto) autoSize(t); } break;
    case 'txRot': if (t) { begin(); t.r = v; } break;
    case 'sketchOp': begin(); S.page.sketchOpacity = v / 100; break;
    case 'sketchSize': if (S.layer === 'ink') S.inkSize = v; else S.sketchSize = v; break;
    case 'pamt': if (p) { begin(); p.amt = v; } break;
    case 'maskSize': S.maskSize = v; break;
  }
  invalidate();
}

function act(name) {
  switch (name) {
    case 'layouts': return openLayouts();
    case 'snap': S.snap = !S.snap; updateCtx(); break;
    case 'guides': S.showGuides = !S.showGuides; updateCtx(); invalidate(); break;
    case 'pickImage': if (selPanel()) pickImage(selPanel().id); break;
    case 'toImage': setMode('image'); break;
    case 'front': case 'forward': case 'backward': case 'back': reorder(name); break;
    case 'square': change((q) => { const b = bbox(q.pts); q.pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]; }); break;
    case 'dup': duplicateSel(); break;
    case 'del': deleteSel(); break;
    case 'panelSketch': change((q) => { q.sketchHidden = !q.sketchHidden; }); updateCtx(); break;
    case 'fill': case 'fit': change((q) => fitImage(q, name === 'fill')); updateCtx(); break;
    case 'flip': change((q) => { q.image.f = -(q.image.f || 1); }); break;
    case 'look': S.look = true; updateCtx(); break;
    case 'lookDone': S.look = false; updateCtx(); break;
    case 'fxReset': change((q) => { q.fx = null; }); updateCtx(); break;
    case 'paintMask': change((q) => { q.popout = 'mask'; }); setMode('mask'); break;
    case 'rmImage': change((q) => { q.image = null; q.popout = 'none'; q.mask = []; q.fx = null; }); updateCtx(); break;
    case 'done': setMode('panel'); break;
    case 'maskClear': change((q) => { q.mask = []; }); break;
    case 'maskInvert': change((q) => { q.popout = 'all'; q.mask = []; }); setMode('image'); toast('Whole image pops out'); break;
    case 'maskDone': setMode('image'); break;
    case 'editText': editText(); break;
    case 'caps': changeText((t) => { t.caps = !t.caps; }); updateCtx(); break;
    case 'tail': changeText((t) => { t.tail = t.tail ? null : [t.x - t.w * 0.2, t.y + t.h * 0.95]; }); updateCtx(); break;
    case 'fitText': changeText((t) => { t.auto = true; }); updateCtx(); break;
    case 'stick': S.stickSketch = !S.stickSketch; updateCtx(); toast(S.stickSketch ? 'New lines stick to the panel they start in' : 'New lines float over the page'); break;
    case 'sketchVis': changePage((P) => { P.sketchVisible = !P.sketchVisible; }); updateCtx(); break;
    case 'sketchClear': {
      const key = layerKey();
      if (S.page[key].length && confirm(`Clear every ${key === 'ink' ? 'ink' : 'sketch'} line on this page?`)) changePage((P) => { P[key] = []; });
      break;
    }
    case 'saveLayout': saveLayout(); break;
    case 'perspSnap': changePage((P) => { P.persp.snap = !P.persp.snap; }); updateCtx(); break;
    case 'perspReset': changePage((P) => { P.persp.vps = defaultVPs(P, P.persp.mode); }); break;
  }
}

function onKey(e) {
  if (!S.page || $('#editor').classList.contains('hidden')) return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  if (sheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && ((S.sel && S.mode === 'panel') || (S.tsel && S.mode === 'text'))) { e.preventDefault(); deleteSel(); }
  else if (e.key === 'Escape') { S.sel = null; S.tsel = null; setMode('panel'); }
  else if (e.key === ' ') S.space = true;
  else if (!mod && k === 'p') setMode('panel');
  else if (!mod && k === 'b') setMode('sketch');
  else if (!mod && k === 'i') setMode('image');
  else if (!mod && k === 'x') setMode('split');
  else if (!mod && k === 't') setMode('text');
  else if (!mod && k === 'e' && S.mode === 'sketch') { S.sketchTool = S.sketchTool === 'erase' ? 'pen' : 'erase'; updateCtx(); }
}

/* ================================================================ sheets */

function miniLayoutSVG(page, polys) {
  const sw = page.w / 120;
  return `<svg class="lay" viewBox="${-page.w * 0.04} ${-page.h * 0.04} ${page.w * 1.08} ${page.h * 1.08}" preserveAspectRatio="xMidYMid meet">`
    + `<rect width="${page.w}" height="${page.h}" fill="#fff"/>`
    + polys.map((pts) => `<polygon points="${ptsStr(pts)}" fill="#dfe6f3" stroke="#111" stroke-width="${sw}"/>`).join('')
    + '</svg>';
}

// Panels of a saved layout, scaled onto this page.
function scaledLayout(L, page) {
  return L.panels.map((q) => ({ pts: q.pts.map(([x, y]) => [x * page.w, y * page.h]), style: q.style, amt: q.amt }));
}

function customSVG(page, L) {
  const sw = page.w / 120;
  return `<svg class="lay" viewBox="${-page.w * 0.04} ${-page.h * 0.04} ${page.w * 1.08} ${page.h * 1.08}" preserveAspectRatio="xMidYMid meet">`
    + `<rect width="${page.w}" height="${page.h}" fill="#fff"/>`
    + scaledLayout(L, page).map((q) => `<path d="${panelPath(q, page.w)}" fill="#dfe6f3" stroke="#111" stroke-width="${sw}"/>`).join('')
    + '</svg>';
}

// Replace the page's panels with new shapes; lines drawn in the old panels stay but float free.
function applyLayout(shapes) {
  changePage((pg) => {
    const old = new Set(pg.panels.map((p) => p.id));
    pg.panels = shapes.map((q) => {
      const pn = newPanel(q.pts);
      if (q.style && q.style !== 'straight') { pn.style = q.style; pn.amt = q.amt; }
      return pn;
    });
    for (const key of ['strokes', 'ink']) pg[key] = pg[key].map((st) => (old.has(st.panel) ? { ...st, panel: undefined } : st));
  });
}

function saveLayout() {
  const P = S.page;
  if (!P.panels.length) { toast('Draw some panels first'); return; }
  const name = prompt('Name this layout', `My layout ${customLayouts().length + 1}`);
  if (name == null || !name.trim()) return;
  const list = customLayouts();
  list.push({
    id: uid('ly'), name: name.trim(), aspect: P.w / P.h,
    panels: P.panels.map((p) => ({ pts: p.pts.map(([x, y]) => [+(x / P.w).toFixed(5), +(y / P.h).toFixed(5)]), style: p.style || 'straight', amt: p.amt ?? 50 })),
  });
  setCustomLayouts(list);
  toast(`Saved “${name.trim()}” · find it under Layouts`);
}

function openLayouts() {
  const P = S.page;
  const mine = customLayouts();
  const html = (mine.length ? `<div class="group-title">Yours</div><div class="choices">${mine.map((L) => `<div class="choice-wrap"><button class="choice" data-mine="${L.id}">${customSVG(P, L)}<b>${esc(L.name)}</b></button><button class="choice-del" data-del="${L.id}" title="Delete">${icon('x')}</button></div>`).join('')}</div><div class="group-title">Built in</div>` : '')
    + `<div class="choices">${LAYOUTS.map((L) => `<button class="choice" data-lay="${L.id}">${miniLayoutSVG(P, buildLayout(L, P))}<b>${L.name}</b></button>`).join('')}</div>`
    + `<p class="note">Built-in layouts use this page's margin (${P.margin}) and gutter (${P.gutter}). Your own layouts stretch to fit the page. Save one with <b>Save layout</b> in the Panels bar.</p>`;
  const body = openSheet('Layouts', html, { wide: true });
  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const L = customLayouts().find((x) => x.id === del.dataset.del);
      if (L && confirm(`Delete the layout “${L.name}”?`)) { setCustomLayouts(customLayouts().filter((x) => x.id !== L.id)); openLayouts(); }
      return;
    }
    const b = e.target.closest('[data-lay],[data-mine]');
    if (!b) return;
    if (S.page.panels.length && !confirm('Replace the panels on this page with this layout? (Undo can bring them back.)')) return;
    if (b.dataset.mine) {
      const L = customLayouts().find((x) => x.id === b.dataset.mine);
      if (L) applyLayout(scaledLayout(L, S.page));
    } else {
      const L = LAYOUTS.find((x) => x.id === b.dataset.lay);
      applyLayout(buildLayout(L, S.page).map((pts) => ({ pts })));
    }
    S.sel = null;
    closeSheet(); updateCtx();
  });
}

function openLayers() {
  const body = openSheet('Layers', '<div id="layerList"></div><p class="note">Top of the list is drawn on top. A panel higher up covers the ones below, including their pop-outs. Speech balloons always sit above panels.</p>');
  const list = body.querySelector('#layerList');
  const draw = () => {
    const P = S.page;
    const arr = P.panels.map((p, i) => ({ p, i })).reverse();
    if (!arr.length) { list.innerHTML = '<p class="muted">No panels yet.</p>'; return; }
    list.innerHTML = arr.map(({ p, i }) => {
      const b = bbox(p.pts);
      const pad = Math.max(b.w, b.h) * 0.08;
      const vb = `${b.x0 - pad} ${b.y0 - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
      const img = p.image ? `<defs><clipPath id="lc-${p.id}"><polygon points="${ptsStr(p.pts)}"/></clipPath></defs><g clip-path="url(#lc-${p.id})"><g transform="${imgTransform(p.image)}"><image href="${imageURL(p.image.id)}" x="${-p.image.w / 2}" y="${-p.image.h / 2}" width="${p.image.w}" height="${p.image.h}" preserveAspectRatio="none"/></g></g>` : '';
      const tags = [p.image ? 'image' : 'empty', p.popout !== 'none' ? 'pops out' : ''].filter(Boolean).join(' · ');
      return `<div class="layer ${p.id === S.sel ? 'on' : ''}" data-id="${p.id}">
        <svg class="lthumb" viewBox="${vb}"><polygon points="${ptsStr(p.pts)}" fill="#f2f2f2"/>${img}<polygon points="${ptsStr(p.pts)}" fill="none" stroke="#111" stroke-width="${Math.max(b.w, b.h) / 25}"/></svg>
        <span>Panel ${i + 1}<small>${tags}</small></span>
        <button class="cbtn" data-lact="forward" title="Up">${icon('up')}</button>
        <button class="cbtn" data-lact="backward" title="Down">${icon('down')}</button></div>`;
    }).join('');
  };
  draw();
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.layer');
    if (!row) return;
    S.sel = row.dataset.id;
    if (S.mode !== 'panel' && S.mode !== 'image') S.mode = 'panel';
    const b = e.target.closest('[data-lact]');
    if (b) reorder(b.dataset.lact);
    updateCtx(); invalidate(); draw();
  });
}

function renamePage() {
  const n = prompt('Page name', S.page.name);
  if (n == null || !n.trim()) return;
  changePage((P) => { P.name = n.trim(); });
  $('#pageName').textContent = S.page.name;
}

function openSettings() {
  const P = S.page;
  const scroll = P.format === 'scroll';
  const html = `<div class="form">
    <label class="row"><span>Name</span><input type="text" data-f="name" value="${esc(P.name)}"></label>
    <label class="row"><span>Margin<small>Space around the panel area</small></span><input type="number" inputmode="numeric" min="0" data-f="margin" value="${P.margin}"></label>
    <label class="row"><span>Gutter<small>Gap between panels (snapping, split, layouts)</small></span><input type="number" inputmode="numeric" min="0" data-f="gutter" value="${P.gutter}"></label>
    <label class="row"><span>Border width<small>Default for panels without their own</small></span><input type="number" inputmode="numeric" min="0" data-f="border" value="${P.border}"></label>
    <label class="row"><span>Border colour</span><input type="color" data-f="borderColor" value="${P.borderColor}"></label>
    <label class="row"><span>Page colour<small>Shows in the gutters</small></span><input type="color" data-f="bg" value="${P.bg}"></label>
    ${scroll ? `<div class="row"><span>Scroll length<small id="lenNote">${P.h} px</small></span><div class="btns">
      <button class="btn" data-len="-1">− ${SCROLL_STEP}</button><button class="btn" data-len="1">+ ${SCROLL_STEP}</button><button class="btn" data-len="trim">Trim to panels</button></div></div>` : ''}
    <div class="row"><span>Size<small>${P.w} × <span id="hNote">${P.h}</span> px</small></span><span></span></div>
  </div>`;
  const body = openSheet('Page settings', html);
  body.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    let v = e.target.value;
    if (e.target.type === 'number') { v = Math.max(0, +v || 0); }
    if (f === 'name' && !String(v).trim()) return;
    changePage((pg) => { pg[f] = f === 'name' ? String(v).trim() : v; });
    if (f === 'name') $('#pageName').textContent = S.page.name;
    updateCtx();
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-len]');
    if (!b) return;
    changePage((pg) => {
      if (b.dataset.len === 'trim') {
        let maxY = 0;
        for (const p of pg.panels) for (const q of p.pts) maxY = Math.max(maxY, q[1]);
        pg.h = Math.max(SCROLL_STEP, Math.ceil(maxY + pg.margin));
      } else pg.h = Math.max(SCROLL_STEP, pg.h + SCROLL_STEP * +b.dataset.len);
    });
    body.querySelector('#lenNote').textContent = S.page.h + ' px';
    body.querySelector('#hNote').textContent = S.page.h;
  });
}

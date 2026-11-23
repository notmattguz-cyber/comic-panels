import { hydrateIcons } from './icons.js';

const $ = (s) => document.querySelector(s);

export function uid(prefix = 'k') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let onClose = null;

export function openSheet(title, body, opts = {}) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title;
  // A fresh body each time, so listeners added by the previous sheet go away with it.
  const old = $('#sheetBody');
  const b = document.createElement('div');
  b.id = 'sheetBody';
  old.replaceWith(b);
  if (typeof body === 'string') b.innerHTML = body;
  else b.append(body);
  sheet.classList.toggle('wide', !!opts.wide);
  sheet.classList.toggle('top', !!opts.top);
  sheet.classList.remove('hidden');
  onClose = opts.onClose || null;
  hydrateIcons(b);
  return b;
}

export function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.classList.contains('hidden')) return;
  sheet.classList.add('hidden');
  const f = onClose;
  onClose = null;
  if (f) f();
}

export const sheetOpen = () => !$('#sheet').classList.contains('hidden');

export function toast(msg, ms = 1900) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

export function initUI() {
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'sheet') closeSheet();
  });
}

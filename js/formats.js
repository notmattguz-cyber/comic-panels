import { uid } from './ui.js';

// Sizes in pixels at export scale 1.
export const FORMATS = {
  comic: { label: 'Comic page', sub: 'US comic · 1988 × 3056', w: 1988, h: 3056, margin: 118, gutter: 42, border: 8 },
  scroll: { label: 'Scroll', sub: 'Webtoon · 800 wide, grows as needed', w: 800, h: 3840, margin: 40, gutter: 90, border: 4 },
  ig45: { label: 'Portrait 4:5', sub: '1080 × 1350', w: 1080, h: 1350, margin: 48, gutter: 24, border: 5 },
  ig11: { label: 'Square 1:1', sub: '1080 × 1080', w: 1080, h: 1080, margin: 48, gutter: 24, border: 5 },
  ig916: { label: 'Story 9:16', sub: '1080 × 1920', w: 1080, h: 1920, margin: 48, gutter: 24, border: 5 },
};

export const FORMAT_GROUPS = [
  { name: 'Page', keys: ['comic'] },
  { name: 'Scroll', keys: ['scroll'] },
  { name: 'Instagram', keys: ['ig45', 'ig11', 'ig916'] },
];

export const SCROLL_STEP = 1280;

export function newPage(key, name) {
  const f = FORMATS[key];
  const now = Date.now();
  return {
    id: uid('pg'), name, format: key,
    w: f.w, h: f.h, margin: f.margin, gutter: f.gutter, border: f.border,
    borderColor: '#111111', bg: '#ffffff',
    panels: [], strokes: [],
    sketchOpacity: 0.85, sketchVisible: true,
    created: now, updated: now,
  };
}

export function formatLabel(page) {
  const f = FORMATS[page.format];
  if (!f) return '';
  if (page.format === 'scroll') return `Scroll · ${page.w} × ${page.h}`;
  if (page.format.startsWith('ig')) return `Instagram ${f.label.split(' ')[1]}`;
  return f.label;
}

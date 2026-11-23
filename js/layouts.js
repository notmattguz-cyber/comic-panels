// Starter layouts. rows: [heightWeight, columns, skew]; skew leans the column gutters (fraction of page width).
// tilts: one per gap between rows, leans that horizontal gutter (fraction of page height, + = right side higher).
export const LAYOUTS = [
  { id: 'splash', name: 'Splash', rows: [[1, 1]] },
  { id: 'two', name: '2 tiers', rows: [[1, 1], [1, 1]] },
  { id: 'three', name: '3 tiers', rows: [[1, 1], [1, 1], [1, 1]] },
  { id: 'grid4', name: '2 × 2', rows: [[1, 2], [1, 2]] },
  { id: 'grid6', name: '3 × 2', rows: [[1, 2], [1, 2], [1, 2]] },
  { id: 'nine', name: 'Nine grid', rows: [[1, 3], [1, 3], [1, 3]] },
  { id: 'hero', name: 'Big top', rows: [[3, 1], [2, 2]] },
  { id: 'classic', name: 'Classic', rows: [[1, 2], [1.2, 1], [1, 3]] },
  { id: 'action', name: 'Action slants', rows: [[1, 2, 0.07], [1.2, 1], [1, 2, -0.07]], tilts: [0.03, -0.03] },
  { id: 'diag', name: 'Diagonal duo', rows: [[1, 1], [1, 1]], tilts: [0.09] },
  { id: 'shards', name: 'Shards', rows: [[1, 2, 0.1], [1, 3, -0.06]], tilts: [-0.05] },
  { id: 'strip', name: 'Strip of 4', rows: [[1, 1], [1, 1], [1, 1], [1, 1]] },
];

export function buildLayout(L, page) {
  const { w, h, margin: m, gutter: g } = page;
  const x0 = m, x1 = w - m, y0 = m, y1 = h - m;
  const rows = L.rows;
  const tilts = L.tilts || [];
  const tot = rows.reduce((a, r) => a + r[0], 0);
  const availH = (y1 - y0) - g * (rows.length - 1);
  const cx = w / 2, half = (x1 - x0) / 2;
  const out = [];
  let y = y0;
  rows.forEach(([wt, cols, skew = 0], ri) => {
    const rh = availH * wt / tot;
    const ya = y, yb = y + rh;
    const tTop = ri > 0 ? (tilts[ri - 1] || 0) * h : 0;
    const tBot = ri < rows.length - 1 ? (tilts[ri] || 0) * h : 0;
    const yT = (x) => ya - tTop * (x - cx) / half;
    const yB = (x) => yb - tBot * (x - cx) / half;
    const cw = ((x1 - x0) - g * (cols - 1)) / cols;
    const k = skew * (x1 - x0);
    for (let c = 0; c < cols; c++) {
      const la = x0 + c * (cw + g), ra = la + cw;
      const lt = c === 0 ? x0 : la + k, lb = c === 0 ? x0 : la - k;
      const rt = c === cols - 1 ? x1 : ra + k, rb = c === cols - 1 ? x1 : ra - k;
      out.push([[lt, yT(lt)], [rt, yT(rt)], [rb, yB(rb)], [lb, yB(lb)]]);
    }
    y = yb + g;
  });
  return out;
}

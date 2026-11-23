// Snapping: page edges, margins, gutter-offset lines next to other panels (works for diagonal edges too),
// and alignment with straight edges of other panels.
import { sub, add, mul, dot, len, dist, mid, centroid } from './geom.js';

export function buildSnapLines(page, excludeId) {
  const L = [];
  const { w, h, margin: m, gutter: g } = page;
  const H = (y, k) => L.push({ a: [0, y], d: [1, 0], k });
  const V = (x, k) => L.push({ a: [x, 0], d: [0, 1], k });
  H(0, 'edge'); H(h, 'edge'); V(0, 'edge'); V(w, 'edge');
  if (m > 0) { H(m, 'margin'); H(h - m, 'margin'); V(m, 'margin'); V(w - m, 'margin'); }
  for (const p of page.panels) {
    if (p.id === excludeId) continue;
    const c = centroid(p.pts);
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      const a = p.pts[i], b = p.pts[(i + 1) % n];
      const e = sub(b, a);
      const l = len(e);
      if (l < 1) continue;
      const d = [e[0] / l, e[1] / l];
      let nn = [-d[1], d[0]];
      if (dot(nn, sub(mid(a, b), c)) < 0) nn = mul(nn, -1);
      // A line one gutter outside this edge, only near the edge itself.
      L.push({ a: add(a, mul(nn, g)), d, t0: -g * 4, t1: l + g * 4, k: 'gutter' });
      // Straight edges also give a page-wide alignment line.
      if (Math.abs(d[0]) < 0.03) L.push({ a, d: [0, 1], k: 'align' });
      else if (Math.abs(d[1]) < 0.03) L.push({ a, d: [1, 0], k: 'align' });
    }
  }
  return L;
}

export function selfLines(pts, i) {
  const n = pts.length, L = [];
  for (const j of [(i - 1 + n) % n, (i + 1) % n]) {
    L.push({ a: pts[j].slice(), d: [1, 0], k: 'self' });
    L.push({ a: pts[j].slice(), d: [0, 1], k: 'self' });
  }
  return L;
}

function intersect(l1, l2) {
  const cr = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
  if (Math.abs(cr) < 1e-9) return null;
  const w = sub(l2.a, l1.a);
  const t = (w[0] * l2.d[1] - w[1] * l2.d[0]) / cr;
  return add(l1.a, mul(l1.d, t));
}

export function snapPoint(p, lines, thr) {
  const near = [];
  for (const ln of lines) {
    const t = dot(sub(p, ln.a), ln.d);
    if (ln.t0 !== undefined && (t < ln.t0 || t > ln.t1)) continue;
    const q = add(ln.a, mul(ln.d, t));
    const dd = dist(p, q);
    if (dd < thr) near.push({ ln, q, dd });
  }
  if (!near.length) return { p, dd: Infinity, guides: [] };
  near.sort((x, y) => x.dd - y.dd);
  const best = near[0];
  for (let i = 1; i < near.length; i++) {
    const o = near[i];
    const cr = best.ln.d[0] * o.ln.d[1] - best.ln.d[1] * o.ln.d[0];
    if (Math.abs(cr) < 0.2) continue;
    const X = intersect(best.ln, o.ln);
    if (X && dist(X, p) < thr * 1.5) return { p: X, dd: dist(X, p), guides: [best.ln, o.ln] };
  }
  return { p: best.q, dd: best.dd, guides: [best.ln] };
}

// Pressure-sensitive stroke outlines (filled shapes) and plain centre-line paths.
const f = (v) => Math.round(v * 10) / 10;

export function strokePath(pts, size) {
  const n = pts.length;
  if (!n) return '';
  const rad = (i) => Math.max(0.35, size * (0.2 + 0.8 * (pts[i][2] ?? 0.5)) / 2);
  if (n === 1) {
    const [x, y] = pts[0], r = rad(0);
    return `M${f(x - r)},${f(y)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`;
  }
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const r = rad(i);
    L.push([pts[i][0] - ty * r, pts[i][1] + tx * r]);
    R.push([pts[i][0] + ty * r, pts[i][1] - tx * r]);
  }
  let d = `M${f(L[0][0])},${f(L[0][1])}` + smooth(L);
  const re = rad(n - 1);
  d += `A${f(re)},${f(re)} 0 0,0 ${f(R[n - 1][0])},${f(R[n - 1][1])}`;
  d += smooth(R.reverse());
  const rs = rad(0);
  d += `A${f(rs)},${f(rs)} 0 0,0 ${f(L[0][0])},${f(L[0][1])}Z`;
  return d;
}

function smooth(P) {
  let s = '';
  for (let i = 1; i < P.length - 1; i++) {
    const m0 = (P[i][0] + P[i + 1][0]) / 2, m1 = (P[i][1] + P[i + 1][1]) / 2;
    s += `Q${f(P[i][0])},${f(P[i][1])} ${f(m0)},${f(m1)}`;
  }
  const last = P[P.length - 1];
  return s + `L${f(last[0])},${f(last[1])}`;
}

export function linePath(pts) {
  if (!pts.length) return '';
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  if (pts.length === 1) return d + `L${f(pts[0][0] + 0.05)},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f(pts[i][0])},${f(pts[i][1])}`;
  return d;
}

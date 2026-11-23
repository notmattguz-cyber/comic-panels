// Panel outlines: straight, rounded corners, wavy (flashback/dream) and jagged (shock) borders.
// p.style: 'straight' | 'rounded' | 'wavy' | 'jagged'; p.amt: 0..100 strength. Page width sets the scale.
export const PANEL_STYLES = [['straight', 'Straight'], ['rounded', 'Rounded'], ['wavy', 'Wavy'], ['jagged', 'Jagged']];

const f = (v) => Math.round(v * 10) / 10;
const P = (p) => `${f(p[0])},${f(p[1])}`;

export function panelPath(p, pageW) {
  const pts = p.pts, n = pts.length;
  const style = p.style || 'straight';
  const u = pageW / 1000;
  const amt = (p.amt ?? 50) / 100;
  if (style === 'straight' || n < 3) return 'M' + pts.map(P).join('L') + 'Z';

  if (style === 'rounded') {
    const R = Math.max(1, amt * 90 * u);
    let d = '';
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n], v = pts[i], next = pts[(i + 1) % n];
      const l1 = Math.hypot(v[0] - prev[0], v[1] - prev[1]) || 1;
      const l2 = Math.hypot(next[0] - v[0], next[1] - v[1]) || 1;
      const r = Math.min(R, l1 / 2, l2 / 2);
      const a = [v[0] + (prev[0] - v[0]) * r / l1, v[1] + (prev[1] - v[1]) * r / l1];
      const b = [v[0] + (next[0] - v[0]) * r / l2, v[1] + (next[1] - v[1]) * r / l2];
      d += (i ? 'L' : 'M') + P(a) + 'Q' + P(v) + ' ' + P(b);
    }
    return d + 'Z';
  }

  // Wavy and jagged: walk each edge in steps, pushing points sideways.
  const amp = Math.max(2 * u, amt * 22 * u);
  const step = style === 'wavy' ? amp * 4 + 24 * u : amp * 2.2 + 10 * u;
  let d = 'M' + P(pts[0]);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    if (L < 1) continue;
    const k = Math.max(1, Math.round(L / step));
    const nx = -dy / L, ny = dx / L;
    for (let j = 0; j < k; j++) {
      const t0 = j / k, t1 = (j + 1) / k, tm = (t0 + t1) / 2;
      const s = j % 2 ? -1 : 1;
      const m = [a[0] + dx * tm + nx * amp * s, a[1] + dy * tm + ny * amp * s];
      const e = [a[0] + dx * t1, a[1] + dy * t1];
      if (style === 'wavy') d += 'Q' + P([a[0] + dx * tm + nx * amp * 2 * s, a[1] + dy * tm + ny * amp * 2 * s]) + ' ' + P(e);
      else d += 'L' + P(m) + 'L' + P(e);
    }
  }
  return d + 'Z';
}

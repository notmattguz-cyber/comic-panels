// Perspective guides for the sketch and ink layers: 1, 2 or 3 vanishing points.
// page.persp = { on, mode: 1|2|3, vps: [[x,y], ...], snap }
import { sub, norm, dot } from './geom.js';

export const VP_COLORS = ['#ff5d8f', '#19b6ff', '#45c46b'];

export function defaultVPs(page, mode) {
  const { w, h } = page;
  const hy = h * 0.38;
  if (mode === 1) return [[w / 2, hy]];
  if (mode === 2) return [[-0.35 * w, hy], [1.35 * w, hy]];
  return [[-0.35 * w, hy], [1.35 * w, hy], [w / 2, h * 2.1]];
}

// Rays from each vanishing point that fan across the page, plus the horizon.
export function guideLines(page, rays = 20) {
  const P = page.persp;
  const out = [];
  if (!P || !P.on) return out;
  const { w, h } = page;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const R = (w + h) * 4;
  P.vps.forEach((vp, vi) => {
    const inside = vp[0] >= 0 && vp[0] <= w && vp[1] >= 0 && vp[1] <= h;
    let a0, a1;
    if (inside) { a0 = 0; a1 = Math.PI * 2; }
    else {
      const base = Math.atan2(corners[0][1] - vp[1], corners[0][0] - vp[0]);
      const angs = corners.map((c) => {
        let a = Math.atan2(c[1] - vp[1], c[0] - vp[0]) - base;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        return a + base;
      });
      a0 = Math.min(...angs); a1 = Math.max(...angs);
    }
    const n = inside ? rays * 2 : rays;
    for (let i = 0; i <= n; i++) {
      if (inside && i === n) break;
      const a = a0 + (a1 - a0) * i / n;
      out.push({ a: vp, b: [vp[0] + Math.cos(a) * R, vp[1] + Math.sin(a) * R], c: VP_COLORS[vi] });
    }
  });
  const v = P.vps;
  if (P.mode === 1) out.push({ a: [-R, v[0][1]], b: [R, v[0][1]], c: '#ffb020', horizon: true });
  else {
    const d = norm(sub(v[1], v[0]));
    out.push({ a: [v[0][0] - d[0] * R, v[0][1] - d[1] * R], b: [v[0][0] + d[0] * R, v[0][1] + d[1] * R], c: '#ffb020', horizon: true });
  }
  return out;
}

// Directions a straight line drawn from `start` may follow.
export function snapDirs(page, start) {
  const P = page.persp;
  const dirs = P.vps.map((vp) => norm(sub(vp, start)));
  if (P.mode === 1) dirs.push([1, 0], [0, 1]);
  if (P.mode === 2) dirs.push([0, 1]);
  return dirs;
}

export function bestDir(dirs, v) {
  const u = norm(v);
  let best = dirs[0], bd = -1;
  for (const d of dirs) { const s = Math.abs(dot(u, d)); if (s > bd) { bd = s; best = d; } }
  return best;
}

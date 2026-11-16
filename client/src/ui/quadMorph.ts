/**
 * A box mapped onto any four-cornered shape on the page with one CSS matrix3d (a projective
 * transform). This is how AgentChart grows out of, and shrinks back into, a monitor seen in
 * perspective (EhrTransition.tsx). Pure math, unit-tested (tests/workstation.test.ts).
 */
export type Pt = [number, number];
/** corners: top-left, top-right, bottom-right, bottom-left */
export type Quad = [Pt, Pt, Pt, Pt];

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function lerpQuad(a: Quad, b: Quad, t: number): Quad {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]) as Quad;
}

/**
 * The homography (row-major 3 × 3, last entry 1) taking a w × h box with its origin at the top-left
 * onto quad q (Heckbert's square-to-quad, then scaled by 1/w, 1/h). null if q is degenerate.
 */
export function homography(w: number, h: number, q: Quad): number[] | null {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let k = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  // collapsed to a line or a point: no transform can draw it
  const det = a * (e - y0 * k) - b * (d - y0 * g) + x0 * (d * k - e * g);
  if (Math.abs(det) < 1e-9) return null;
  return [a / w, b / h, x0, d / w, e / h, y0, g / w, k / h, 1];
}

export function mapPoint(m: number[], x: number, y: number): Pt {
  const W = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / W, (m[3] * x + m[4] * y + m[5]) / W];
}

/** CSS transform (with transform-origin 0 0) putting a w × h element's corners on q, relative to its own untransformed top-left */
export function quadTransform(w: number, h: number, q: Quad): string | null {
  const m = homography(w, h, q);
  if (!m) return null;
  const [A, B, C, D, E, F, G, H] = m.map((v) => +v.toFixed(9));
  // matrix3d is column-major: (A D 0 G), (B E 0 H), (0 0 1 0), (C F 0 1)
  return `matrix3d(${A},${D},0,${G},${B},${E},0,${H},0,0,1,0,${C},${F},0,1)`;
}

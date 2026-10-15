// Small deterministic math helpers shared by the simulation and renderer.

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box. x/y are the top-left corner in world units (y grows downward). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function boxCenter(b: Box): Vec2 {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function overlapCenter(a: Box, b: Box): Vec2 {
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Round to 1/1000 to keep floating-point drift out of long simulations and snapshots. */
export const q = (v: number): number => Math.round(v * 1000) / 1000;

/** Mulberry32 — deterministic seeded PRNG. State is a plain number so it can be snapshotted. */
export function rngNext(state: { seed: number }): number {
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

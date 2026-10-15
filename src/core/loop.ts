// Fixed-timestep accumulator shared by the live match loop and the replay viewer.
// Simulation results never depend on the display refresh rate: only on how many fixed steps run.

export const STEP_MS = 1000 / 60;

export interface Accumulator {
  acc: number;
}

/**
 * Adds elapsed wall time and returns how many fixed steps to run now. Large stalls are
 * clamped (maxSteps) so a slow device drops time instead of spiralling.
 */
export function takeSteps(a: Accumulator, dtMs: number, maxSteps = 5, speed = 1): number {
  a.acc += Math.min(250, Math.max(0, dtMs)) * speed;
  let n = 0;
  while (a.acc >= STEP_MS - 1e-9 && n < maxSteps) {
    a.acc -= STEP_MS;
    n++;
  }
  if (n === maxSteps && a.acc >= STEP_MS) a.acc = 0;
  return n;
}

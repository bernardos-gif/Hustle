import '../src/characters';
import { IN, type ButtonName } from '../src/core/input';
import { Sim, type SimSettings } from '../src/combat/sim';
import type { CombatEvent } from '../src/combat/types';

/** Builds an input mask from numpad notation relative to `facing` plus buttons. */
export function mask(dir: number, buttons: ButtonName[] = [], facing: 1 | -1 = 1): number {
  let m = 0;
  const col = ((dir - 1) % 3) - 1; // -1 back, 0, 1 forward
  const row = Math.floor((dir - 1) / 3) - 1; // -1 down, 0, 1 up
  const hx = col * facing;
  if (hx > 0) m |= IN.RIGHT;
  if (hx < 0) m |= IN.LEFT;
  if (row > 0) m |= IN.UP;
  if (row < 0) m |= IN.DOWN;
  for (const b of buttons) m |= IN[b];
  return m;
}

export function makeSim(chars: [string, string] = ['riot', 'riot'], settings: Partial<SimSettings> = {}): Sim {
  return new Sim({ chars, seed: 7, settings: { training: true, ...settings } });
}

export type InputFn = (frame: number, sim: Sim) => number;

/** Steps the sim for n frames, collecting events. */
export function run(sim: Sim, n: number, p1: InputFn | number = 0, p2: InputFn | number = 0): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < n; i++) {
    const a = typeof p1 === 'number' ? p1 : p1(i, sim);
    const b = typeof p2 === 'number' ? p2 : p2(i, sim);
    out.push(...sim.step([a, b]));
  }
  return out;
}

/** Presses a button (with direction) for one frame, then neutral. */
export function tap(dir: number, buttons: ButtonName[], facing: 1 | -1 = 1): InputFn {
  return (i) => (i === 0 ? mask(dir, buttons, facing) : 0);
}

/** Places fighters at a given distance apart, centered. */
export function place(sim: Sim, dist: number, center = 700): void {
  const [a, b] = sim.state.fighters;
  a.x = center - dist / 2;
  b.x = center + dist / 2;
  a.facing = 1;
  b.facing = -1;
}

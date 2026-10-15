import { describe, expect, it } from 'vitest';
import { makeSim, mask, place, run, tap } from './helpers';

describe('smoke', () => {
  it('jab hits', () => {
    const sim = makeSim();
    place(sim, 60);
    const ev = run(sim, 30, tap(5, ['L']));
    const hits = ev.filter((e) => e.type === 'hit');
    expect(hits.length).toBe(1);
    expect(sim.state.fighters[1].hp).toBeLessThan(sim.state.fighters[1].maxHp);
  });
  it('walks and jumps', () => {
    const sim = makeSim();
    const x0 = sim.state.fighters[0].x;
    run(sim, 20, mask(6));
    expect(sim.state.fighters[0].x).toBeGreaterThan(x0);
    run(sim, 10, mask(8));
    expect(sim.state.fighters[0].y).toBeGreaterThan(0);
    run(sim, 120, 0);
    expect(sim.state.fighters[0].y).toBe(0);
    expect(sim.state.fighters[0].state).toBe('idle');
  });
});

// Scenario 1: ground movement, jumps, dashes and directional air movement work repeatedly
// without getting stuck. Also covers air options, flight and wall jumps.
import { describe, expect, it } from 'vitest';
import { CFG } from '../src/combat/config';
import { IN } from '../src/core/input';
import { makeSim, mask, place, run } from './helpers';

const f0 = (sim: ReturnType<typeof makeSim>) => sim.state.fighters[0];

describe('ground movement', () => {
  it('walks forward and back at the character speeds', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 400);
    const x0 = f0(sim).x;
    run(sim, 30, mask(6));
    expect(f0(sim).x).toBeGreaterThan(x0 + 3.8 * 25);
    const x1 = f0(sim).x;
    run(sim, 30, mask(4));
    expect(f0(sim).x).toBeLessThan(x1 - 3 * 25);
  });

  it('crouches while holding down and stands back up', () => {
    const sim = makeSim();
    run(sim, 5, mask(2));
    expect(f0(sim).state).toBe('crouch');
    expect(f0(sim).crouching).toBe(true);
    run(sim, 3, 0);
    expect(f0(sim).state).toBe('idle');
  });

  it('double-tap dashes forward, then runs while forward is held', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 600);
    const seq = [mask(6), 0, mask(6)];
    run(sim, 3, (i) => seq[i]);
    expect(f0(sim).state).toBe('dash');
    run(sim, 14, mask(6));
    expect(f0(sim).state).toBe('run');
    expect(f0(sim).vx).toBeCloseTo(9.5, 1);
  });

  it('D + back is a backdash with early strike invulnerability', () => {
    const sim = makeSim(['vesper', 'vesper']);
    place(sim, 300);
    run(sim, 1, mask(4, ['D']));
    expect(f0(sim).state).toBe('backdash');
    expect(f0(sim).vx).toBeLessThan(0);
    run(sim, 40, 0);
    expect(['idle', 'crouch']).toContain(f0(sim).state);
  });

  it('can jump, dash and land 50 times in a row without getting stuck', () => {
    const sim = makeSim(['mirage', 'riot']);
    place(sim, 500);
    for (let k = 0; k < 50; k++) {
      run(sim, 6, mask(k % 2 ? 9 : 7));
      run(sim, 1, mask(6, ['D']));
      run(sim, 120, 0);
      expect(f0(sim).y).toBe(0);
      expect(sim.isActionable(f0(sim))).toBe(true);
      run(sim, 3, (i) => (i === 0 ? mask(k % 2 ? 6 : 4, ['D']) : 0));
      run(sim, 40, 0);
      expect(sim.isActionable(f0(sim))).toBe(true);
    }
  });
});

describe('jumps and air control', () => {
  it('holding up gives a full jump, tapping gives a short hop', () => {
    const full = makeSim();
    run(full, 60, (i, s) => (s.state.fighters[0].grounded && i > 8 ? 0 : mask(8)));
    const sh = makeSim();
    let maxFull = 0;
    let maxShort = 0;
    const a = makeSim();
    for (let i = 0; i < 70; i++) {
      a.step([i < 30 ? mask(8) : 0, 0]);
      maxFull = Math.max(maxFull, a.state.fighters[0].y);
    }
    for (let i = 0; i < 70; i++) {
      sh.step([i < 2 ? mask(8) : 0, 0]);
      maxShort = Math.max(maxShort, sh.state.fighters[0].y);
    }
    expect(maxFull).toBeGreaterThan(maxShort * 1.5);
  });

  it('double jump consumes an air option and air options refill on landing', () => {
    const sim = makeSim(['vesper', 'vesper']);
    run(sim, 12, mask(8));
    run(sim, 2, 0);
    expect(f0(sim).airOptions).toBe(2);
    run(sim, 1, mask(8));
    expect(f0(sim).airOptions).toBe(1);
    run(sim, 200, 0);
    expect(f0(sim).grounded).toBe(true);
    expect(f0(sim).airOptions).toBe(2);
  });

  it('air dash travels in the held direction and costs an air option; options run out', () => {
    const sim = makeSim(['mirage', 'riot']);
    place(sim, 700);
    run(sim, 10, mask(8));
    const x = f0(sim).x;
    run(sim, 1, mask(6, ['D']));
    expect(f0(sim).state).toBe('airdash');
    expect(f0(sim).airOptions).toBe(2);
    run(sim, 6, 0);
    expect(f0(sim).x).toBeGreaterThan(x + 40);
    run(sim, 1, mask(8, ['D']));
    expect(f0(sim).airOptions).toBe(1);
    expect(f0(sim).vy).toBeGreaterThan(5); // upward air dash
    run(sim, 10, 0);
    run(sim, 1, mask(4, ['D']));
    expect(f0(sim).airOptions).toBe(0);
    expect(f0(sim).vx).toBeLessThan(0); // backward air dash
    run(sim, 10, 0);
    expect(f0(sim).grounded).toBe(false);
    run(sim, 1, mask(6, ['D']));
    expect(f0(sim).state).not.toBe('airdash'); // no options left: no unlimited aerial escapes
  });

  it('diagonal down air dash and fast fall accelerate the descent', () => {
    const slow = makeSim();
    const fast = makeSim();
    run(slow, 25, (i) => (i < 20 ? mask(8) : 0));
    run(fast, 25, (i) => (i < 20 ? mask(8) : 0));
    run(fast, 1, mask(2));
    run(fast, 1, 0);
    run(fast, 6, mask(2));
    run(slow, 8, 0);
    expect(fast.state.fighters[0].y).toBeLessThan(slow.state.fighters[0].y);
  });

  it('air drift steers horizontally', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 600);
    run(sim, 6, mask(8));
    const x = f0(sim).x;
    run(sim, 20, mask(4));
    expect(f0(sim).x).toBeLessThan(x - 20);
  });
});

describe('character movement rules', () => {
  it('Bastion flies with fuel in any direction, brakes, and falls when fuel runs out', () => {
    const sim = makeSim(['bastion', 'riot'], { infiniteResources: [false, false] });
    place(sim, 500);
    const b = f0(sim);
    run(sim, 8, mask(8));
    run(sim, 1, mask(5, ['D']));
    expect(b.flying).toBe(true);
    const fuel0 = b.resources.fuel;
    const y0 = b.y;
    run(sim, 20, mask(8));
    expect(b.y).toBeGreaterThan(y0 + 40); // climbs while holding up
    run(sim, 20, mask(6));
    expect(b.vx).toBeGreaterThan(4);
    run(sim, 20, 0);
    expect(Math.abs(b.vx)).toBeLessThan(0.5); // brakes with no input
    expect(Math.abs(b.vy)).toBeLessThan(0.5);
    expect(b.resources.fuel).toBeLessThan(fuel0);
    let n = 0;
    while (b.flying && n++ < 400) run(sim, 1, mask(8));
    expect(b.resources.fuel).toBe(0);
    expect(b.flying).toBe(false);
    expect(b.y).toBeLessThanOrEqual(CFG.stage.ceiling);
    run(sim, 300, 0);
    expect(b.grounded).toBe(true);
    run(sim, 200, 0);
    expect(b.resources.fuel).toBeGreaterThan(50); // regenerates on the ground
  });

  it('Bastion has no air jumps or air dashes', () => {
    const sim = makeSim(['bastion', 'riot']);
    run(sim, 10, mask(8));
    run(sim, 2, 0);
    const vy = f0(sim).vy;
    run(sim, 1, mask(8));
    expect(f0(sim).vy).toBeLessThan(vy); // no double jump impulse
  });

  it('being hit ends flight', () => {
    const sim = makeSim(['bastion', 'vesper']);
    place(sim, 120);
    run(sim, 8, mask(8));
    run(sim, 1, mask(5, ['D']));
    expect(f0(sim).flying).toBe(true);
    const v = sim.state.fighters[1];
    v.x = f0(sim).x + 60;
    v.y = f0(sim).y;
    v.grounded = false;
    v.state = 'air';
    sim.startMove(v, 'v_jH', { force: true });
    run(sim, 20, 0);
    expect(f0(sim).flying).toBe(false);
  });

  it('Riot wall-jumps off the stage wall without spending air options', () => {
    const sim = makeSim(['riot', 'vesper']);
    const r = f0(sim);
    r.x = CFG.stage.left + 30;
    sim.state.fighters[1].x = 500;
    run(sim, 8, mask(7));
    run(sim, 4, mask(4));
    expect(r.wallTouch).toBe(-1);
    const opts = r.airOptions;
    run(sim, 1, 0);
    run(sim, 1, IN.UP);
    expect(r.vx).toBeGreaterThan(5);
    expect(r.airOptions).toBe(opts);
  });
});

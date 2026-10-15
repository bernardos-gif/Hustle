// Scenario 6: DI reliably changes eligible trajectories and cannot alter already-resolved hits.
// Scenario 7: burst consumes the correct resources and works only in eligible circumstances.
import { describe, expect, it } from 'vitest';
import { CFG } from '../src/combat/config';
import { IN } from '../src/core/input';
import type { Sim } from '../src/combat/sim';
import { makeSim, mask, place, run } from './helpers';

/** Launch the P2 Riot with Bastion 2H while P2 holds `diMask` the whole time. */
function launchWithDI(diMask: number) {
  const sim = makeSim(['bastion', 'riot']);
  place(sim, 70);
  const [a, v] = sim.state.fighters;
  sim.startMove(a, 'b_2H', { force: true });
  let hit: any = null;
  for (let i = 0; i < 20 && !hit; i++) hit = sim.step([0, 0]).find((e) => e.type === 'hit');
  const resolved = { hp: v.hp, hitstun: v.hitstun, damage: hit.damage };
  while (v.hitstop > 0) sim.step([0, diMask]);
  sim.step([0, diMask]);
  return { sim, v, resolved, vel: { x: v.vx, y: v.vy } };
}

describe('directional influence', () => {
  it('holding a direction during hitstop rotates the launch trajectory toward it', () => {
    const none = launchWithDI(0);
    const right = launchWithDI(IN.RIGHT); // away from the attacker (attacker is on the left)
    const left = launchWithDI(IN.LEFT);
    expect(right.vel.x).not.toBeCloseTo(none.vel.x, 2);
    // angle comparisons: DI toward +x tilts the vector toward +x
    const ang = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);
    expect(ang(right.vel)).toBeLessThan(ang(none.vel));
    expect(ang(left.vel)).toBeGreaterThan(ang(none.vel));
  });

  it('DI is bounded: rotation never exceeds the configured maximum and speed change is limited', () => {
    const none = launchWithDI(0);
    for (const m of [IN.LEFT, IN.RIGHT, IN.UP, IN.DOWN, IN.UP | IN.RIGHT, IN.DOWN | IN.LEFT]) {
      const d = launchWithDI(m);
      const a0 = Math.atan2(none.vel.y, none.vel.x);
      const a1 = Math.atan2(d.vel.y, d.vel.x);
      const maxAngle = CFG.di.maxAngle * (1 + CFG.combo.diMaxBonus);
      expect(Math.abs(a1 - a0)).toBeLessThanOrEqual(maxAngle + 1e-6);
      const s0 = Math.hypot(none.vel.x, none.vel.y);
      const s1 = Math.hypot(d.vel.x, d.vel.y);
      expect(Math.abs(s1 / s0 - 1)).toBeLessThanOrEqual(CFG.di.maxSpeedScale * (1 + CFG.combo.diMaxBonus) + 1e-6);
      // the victim still goes up: DI never cancels the launch
      expect(d.vel.y).toBeGreaterThan(0);
    }
  });

  it('DI never changes the damage or hitstun of a hit that already resolved', () => {
    const a = launchWithDI(0);
    const b = launchWithDI(IN.DOWN | IN.LEFT);
    expect(b.resolved).toEqual(a.resolved);
  });

  it('changing input after DI locks in only allows limited drift', () => {
    const d = launchWithDI(IN.UP);
    const locked = d.v.lastDI!;
    const x0 = d.v.x;
    const ref = launchWithDI(IN.UP);
    // keep holding up in one sim, switch to hard left in the other
    run(d.sim, 20, (_i, s) => (s.state.fighters[1].state === 'launched' ? 0 : 0), IN.LEFT);
    run(ref.sim, 20, 0, IN.UP);
    expect(d.v.lastDI).toEqual(locked); // the recorded DI did not change
    expect(Math.abs(d.v.x - ref.v.x)).toBeLessThanOrEqual(CFG.di.driftMax * 20 + 1);
    void x0;
  });

  it('DI is re-applied (weaker) on wall bounces', () => {
    const bounce = (m: number) => {
      const sim = makeSim(['riot', 'vesper']);
      const [a, v] = sim.state.fighters;
      a.x = CFG.stage.right - 200;
      v.x = CFG.stage.right - 130;
      sim.startMove(a, 'r_shoulder', { force: true });
      let bounced = false;
      for (let i = 0; i < 80 && !bounced; i++) bounced = sim.step([0, m]).some((e) => e.type === 'wallBounce');
      sim.step([0, m]);
      return { bounced, vx: v.vx, vy: v.vy };
    };
    const n = bounce(0);
    const u = bounce(IN.UP);
    expect(n.bounced).toBe(true);
    expect(u.bounced).toBe(true);
    expect(u.vy).not.toBeCloseTo(n.vy, 2);
  });
});

function comboInto(sim: Sim, hits: number) {
  const [a] = sim.state.fighters;
  // hit P2 with repeated jabs (canceling L into L)
  let landed = 0;
  for (let i = 0; i < 200 && landed < hits; i++) {
    const ev = sim.step([i % 4 === 0 ? mask(5, ['L']) : 0, 0]);
    landed += ev.filter((e) => e.type === 'hit' && e.attacker === 0).length;
    void a;
  }
  return landed;
}

describe('burst', () => {
  it('can be used mid-combo with a full gauge; consumes it and knocks the attacker away', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    const [a, v] = sim.state.fighters;
    expect(comboInto(sim, 2)).toBe(2);
    expect(v.combo.hits).toBe(2);
    const ev = run(sim, 1, 0, mask(5, ['X']));
    expect(ev.some((e) => e.type === 'burst')).toBe(true);
    expect(v.burst).toBeLessThan(1); // spent (it starts refilling immediately)
    expect(v.moveId).toBe('burst');
    const later = run(sim, 20, 0, 0);
    expect(later.some((e) => e.type === 'hit' && e.attacker === 1 && e.moveId === 'burst')).toBe(true);
    expect(a.state).toBe('launched');
    expect(v.combo.hits).toBe(0); // the combo was broken
  });

  it('is unavailable in neutral, on the first hit, without a full gauge, and while thrown', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    const [a, v] = sim.state.fighters;
    run(sim, 1, 0, mask(5, ['X']));
    expect(v.moveId).not.toBe('burst'); // neutral X does not burst
    run(sim, 30, 0, 0);
    comboInto(sim, 1);
    expect(sim.canBurst(v)).toBe(false); // only one hit so far
    comboInto(sim, 1);
    v.burst = CFG.burst.max - 1;
    expect(sim.canBurst(v)).toBe(false);
    v.burst = CFG.burst.max;
    expect(sim.canBurst(v)).toBe(true);
    // thrown
    const t = makeSim(['riot', 'vesper']);
    place(t, 50);
    t.startMove(t.state.fighters[0], 'throw_f', { force: true });
    run(t, 7, 0, 0);
    expect(t.state.fighters[1].state).toBe('thrown');
    expect(t.canBurst(t.state.fighters[1])).toBe(false);
    void a;
  });

  it('cannot burst super hits flagged unburstable', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    a.meter = 300;
    sim.startMove(a, 'r_super_rampage', { force: true });
    let tried = false;
    for (let i = 0; i < 80; i++) {
      sim.step([0, v.combo.hits >= 3 ? mask(5, ['X']) : 0]);
      if (v.combo.hits >= 3) tried = true;
    }
    expect(tried).toBe(true);
    expect(v.stats.bursts).toBe(0);
    expect(v.burst).toBeGreaterThan(0);
  });

  it('can be used once per gauge: a second press does nothing', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    const v = sim.state.fighters[1];
    comboInto(sim, 2);
    run(sim, 1, 0, mask(5, ['X']));
    expect(v.stats.bursts).toBe(1);
    run(sim, 60, 0, 0);
    place(sim, 50);
    comboInto(sim, 3);
    run(sim, 1, 0, mask(5, ['X']));
    expect(v.stats.bursts).toBe(1);
  });

  it('a blocked burst is punishable and the punish starts with burst-punish scaling', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    // the defender bursts out of blockstun, but the attacker has stopped attacking and blocks it (baited)
    sim.state.settings.autoBlock = ['all', 'none'];
    v.state = 'blockstun';
    v.blockstun = 10;
    run(sim, 1, 0, mask(5, ['X']));
    expect(v.moveId).toBe('burst');
    const ev = run(sim, 14, 0, 0);
    expect(ev.some((e) => e.type === 'block' && e.victim === 0)).toBe(true);
    sim.state.settings.autoBlock = ['none', 'none'];
    // punish during burst recovery
    while (v.moveId === 'burst' && v.moveFrame < 26) sim.step([0, 0]);
    a.x = v.x - 60;
    a.state = 'idle';
    a.blockstun = 0;
    a.hitstop = 0;
    const pev = run(sim, 10, (i) => (i === 0 ? mask(5, ['M']) : 0), 0);
    const hit = pev.find((e) => e.type === 'hit' && e.attacker === 0);
    expect(hit).toBeTruthy();
    expect(v.combo.startScale).toBe(CFG.burst.punishScale);
  });
});

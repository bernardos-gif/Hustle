// Scenario 12: supers and temporary enhancements use their resources exactly once and expire.
// Scenario 13: character-specific systems work without breaking shared combat behaviour.
import { describe, expect, it } from 'vitest';
import { CFG } from '../src/combat/config';
import { makeSim, mask, place, run } from './helpers';

const starts = (ev: ReturnType<typeof run>, who = 0) => ev.filter((e) => e.type === 'moveStart' && e.fighter === who).map((e) => (e.type === 'moveStart' ? e.moveId : ''));

describe('supers and meter', () => {
  it('a super spends exactly its cost once, even if X is mashed', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.meter = 250;
    const ev = run(sim, 260, (i) => (i % 2 === 0 ? mask(5, ['X']) : 0));
    expect(starts(ev).filter((id) => id === 'v_super_duel').length).toBe(2);
    // 250 -> 150 -> 50, then not enough for a third
    expect(f.meter).toBeGreaterThanOrEqual(50);
    expect(f.meter).toBeLessThan(100);
  });

  it('cannot activate a super without enough meter; meter never goes negative', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.meter = 99;
    const ev = run(sim, 10, (i) => (i === 0 ? mask(5, ['X']) : 0));
    expect(starts(ev)).not.toContain('v_super_duel');
    expect(f.meter).toBe(99);
    f.meter = 150;
    const ev2 = run(sim, 10, (i) => (i === 0 ? mask(2, ['X']) : 0)); // 2 bar super
    expect(starts(ev2)).not.toContain('v_super_six');
    expect(f.meter).toBeGreaterThanOrEqual(0);
  });

  it('super freeze pauses both fighters briefly and then the super plays out', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 100);
    const [v, r] = sim.state.fighters;
    v.meter = 100;
    run(sim, 1, mask(5, ['X']));
    expect(sim.state.superFreeze).not.toBeNull();
    const rx = r.x;
    run(sim, 10, 0, mask(4, [], -1));
    expect(r.x).toBe(rx); // frozen
    const ev = run(sim, 80, 0, 0);
    expect(sim.state.superFreeze).toBeNull();
    expect(ev.some((e) => e.type === 'hit' && e.moveId === 'v_super_duel')).toBe(true);
  });

  it('meter is gained by landing hits, being hit, blocking and parrying', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    sim.startMove(a, 'r_5H', { force: true });
    run(sim, 30, 0, mask(4, [], -1));
    expect(a.meter).toBeGreaterThan(0);
    expect(v.meter).toBeGreaterThan(0); // blocked: defender gains too
  });
});

describe('install (Riot Overdrive)', () => {
  it('costs one bar, drains meter over time and ends when meter runs out', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.meter = 150;
    const ev = run(sim, 2, (i) => (i === 0 ? mask(5, ['X']) : 0));
    expect(starts(ev)).toContain('r_overdrive');
    expect(f.install).not.toBeNull();
    expect(f.meter).toBeCloseTo(50, 0);
    let ended = false;
    for (let i = 0; i < 700 && !ended; i++) ended = sim.step([0, 0]).some((e) => e.type === 'install' && !e.on);
    expect(ended).toBe(true);
    expect(f.install).toBeNull();
    expect(f.meter).toBeGreaterThanOrEqual(0);
  });

  it('cannot be re-activated while active, and swaps in enhanced moves', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.meter = 300;
    run(sim, 60, (i) => (i === 0 ? mask(5, ['X']) : 0));
    const m = f.meter;
    const ev = run(sim, 30, (i) => (i === 0 ? mask(5, ['X']) : 0));
    expect(starts(ev)).not.toContain('r_overdrive');
    expect(f.meter).toBeLessThan(m); // still just draining
    const ev2 = run(sim, 3, (i) => (i === 0 ? mask(5, ['S']) : 0));
    expect(starts(ev2)).toContain('r_rush_od');
  });

  it('boosts damage and movement speed while active', () => {
    const dmg = (install: boolean) => {
      const sim = makeSim(['riot', 'bastion']);
      place(sim, 60);
      const [a] = sim.state.fighters;
      if (install) a.install = { frames: 300, drain: 0 };
      a.meter = 300;
      sim.startMove(a, 'r_5H', { force: true });
      const h = run(sim, 20, 0, 0).find((e) => e.type === 'hit');
      return h?.type === 'hit' ? h.damage : 0;
    };
    expect(dmg(true)).toBeGreaterThan(dmg(false));
  });
});

describe('character resources', () => {
  it('Vesper: shots spend ammo, empty gun cannot fire, reload refills', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    for (let k = 0; k < 6; k++) run(sim, 40, (i) => (i === 0 ? mask(5, ['S']) : 0));
    expect(f.resources.ammo).toBe(0);
    const ev = run(sim, 40, (i) => (i === 0 ? mask(5, ['S']) : 0));
    expect(starts(ev)).not.toContain('v_shot');
    run(sim, 50, (i) => (i === 0 ? mask(4, ['S']) : 0));
    expect(f.resources.ammo).toBe(3);
  });

  it('Vesper: stance moves only exist inside Draw Stance', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    let ev = run(sim, 3, (i) => (i === 0 ? mask(5, ['L']) : 0));
    expect(starts(ev)).toEqual(['v_5L']);
    run(sim, 20, 0);
    ev = run(sim, 14, (i) => (i === 0 ? mask(2, ['S']) : i === 11 ? mask(5, ['L']) : 0));
    expect(starts(ev)).toEqual(['v_stance', 'v_iai']);
    void f;
  });

  it('Vesper: Six-Shot Execution fires one bullet per remaining round', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.meter = 200;
    f.resources.ammo = 3;
    const ev = run(sim, 90, (i) => (i === 0 ? mask(2, ['X']) : 0));
    expect(ev.filter((e) => e.type === 'spawn' && e.projectile === 'v_bullet_super').length).toBe(3);
    expect(f.resources.ammo).toBe(0);
  });

  it('Solenne: spells cost mana, are refused without it, and channeling restores it', () => {
    const sim = makeSim(['solenne', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.resources.mana = 30;
    run(sim, 50, (i) => (i === 0 ? mask(6, ['S']) : 0));
    expect(f.resources.mana).toBeLessThan(30 - 20 + 1 + 50 * 0.16);
    f.resources.mana = 5;
    const ev = run(sim, 10, (i) => (i === 0 ? mask(5, ['S']) : 0));
    expect(starts(ev)).not.toContain('s_fire');
    const before = f.resources.mana;
    run(sim, 90, mask(1, ['S']));
    expect(f.resources.mana).toBeGreaterThan(before + 40);
  });

  it('Solenne has four different meter-powered spells', () => {
    for (const [dir, id, cost] of [
      [5, 's_super_pillar', 100],
      [6, 's_super_wall', 100],
      [4, 's_super_storm', 200],
      [2, 's_super_meteor', 300],
    ] as [number, string, number][]) {
      const sim = makeSim(['solenne', 'riot']);
      place(sim, 400);
      const f = sim.state.fighters[0];
      f.meter = 300;
      const ev = run(sim, 3, (i) => (i === 0 ? mask(dir, ['X']) : 0));
      expect(starts(ev), id).toContain(id);
      expect(f.meter).toBeCloseTo(300 - cost, 0);
    }
  });

  it('Mirage: anchor + blink teleports back to the anchor; ghost step lands behind the opponent', () => {
    const sim = makeSim(['mirage', 'riot']);
    place(sim, 400);
    const [m, r] = sim.state.fighters;
    run(sim, 30, (i) => (i === 0 ? mask(2, ['S']) : 0));
    const ax = m.x;
    run(sim, 40, mask(6));
    expect(m.x).toBeGreaterThan(ax + 50);
    const ev = run(sim, 30, (i) => (i === 0 ? mask(8, ['S']) : 0));
    expect(ev.some((e) => e.type === 'teleport')).toBe(true);
    expect(m.x).toBeCloseTo(ax, 0);
    expect(sim.state.projectiles.some((p) => p.defId === 'm_anchor')).toBe(false); // consumed
    // blink is unavailable without an anchor
    const ev2 = run(sim, 10, (i) => (i === 0 ? mask(8, ['S']) : 0));
    expect(starts(ev2)).not.toContain('m_blink');
    // ghost step
    run(sim, 30, 0);
    const side = Math.sign(m.x - r.x);
    run(sim, 8, mask(8));
    run(sim, 30, (i) => (i === 0 ? mask(5, ['S']) : 0));
    expect(Math.sign(m.x - r.x)).toBe(-side);
  });

  it('Mirage regains an air option when an aerial attack hits', () => {
    const sim = makeSim(['mirage', 'riot']);
    place(sim, 50);
    const [m, r] = sim.state.fighters;
    for (const f of [m, r]) {
      f.y = 200;
      f.grounded = false;
      f.state = 'air';
      f.vy = 0;
    }
    m.airOptions = 1;
    sim.startMove(m, 'm_jL', { force: true });
    run(sim, 6, 0, 0);
    expect(m.airOptions).toBe(2);
  });

  it('Riot: Heat builds through aggression, decays when passive, and boosts damage', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    run(sim, 3, (i) => [mask(6), 0, mask(6)][i]);
    run(sim, 100, mask(6));
    const heat = f.resources.heat;
    expect(heat).toBeGreaterThan(5);
    run(sim, 200, 0);
    expect(f.resources.heat).toBeLessThan(heat);
    const hit = (h: number) => {
      const s = makeSim(['riot', 'bastion']);
      place(s, 60);
      s.state.fighters[0].resources.heat = h;
      s.startMove(s.state.fighters[0], 'r_5H', { force: true });
      const e = run(s, 20, 0, 0).find((x) => x.type === 'hit');
      return e?.type === 'hit' ? e.damage : 0;
    };
    expect(hit(100)).toBeGreaterThan(hit(0));
  });

  it('Riot: Final Heat requires 50 heat and consumes it', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 70);
    const f = sim.state.fighters[0];
    f.meter = 300;
    f.resources.heat = 20;
    let ev = run(sim, 3, (i) => (i === 0 ? mask(2, ['X']) : 0));
    expect(starts(ev)).not.toContain('r_super_final');
    run(sim, 30, 0);
    f.resources.heat = 80;
    ev = run(sim, 60, (i) => (i === 0 ? mask(2, ['X']) : 0));
    expect(starts(ev)).toContain('r_super_final');
    expect(f.resources.heat).toBeLessThan(5);
  });

  it('Bastion: fuel-costing specials are refused without fuel', () => {
    const sim = makeSim(['bastion', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.resources.fuel = 10;
    const ev = run(sim, 5, (i) => (i === 0 ? mask(6, ['S']) : 0));
    expect(starts(ev)).not.toContain('b_piston');
    f.resources.fuel = 50;
    const ev2 = run(sim, 5, (i) => (i === 0 ? mask(6, ['S']) : 0));
    expect(starts(ev2)).toContain('b_piston');
    expect(f.resources.fuel).toBeLessThanOrEqual(50 - 20 + 5 * 0.55 + 0.01); // cost paid once (plus ground regen)
  });

  it('resources never go negative or above max under random play', () => {
    for (const id of ['vesper', 'solenne', 'bastion', 'riot', 'mirage']) {
      const sim = makeSim([id, 'riot']);
      let seed = 3;
      for (let i = 0; i < 2000; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        sim.step([seed & 4095, 0]);
        const f = sim.state.fighters[0];
        expect(f.meter).toBeGreaterThanOrEqual(0);
        expect(f.meter).toBeLessThanOrEqual(CFG.meter.max);
        expect(f.burst).toBeGreaterThanOrEqual(0);
        expect(f.airOptions).toBeGreaterThanOrEqual(0);
        expect(f.feints).toBeGreaterThanOrEqual(0);
        for (const r of sim.char(f).resources) {
          expect(f.resources[r.name]).toBeGreaterThanOrEqual(0);
          expect(f.resources[r.name]).toBeLessThanOrEqual(r.max);
        }
      }
    }
  });
});

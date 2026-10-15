// Scenario 2: every attack respects its own startup, active and recovery timing.
// Scenario 3: hitboxes trigger damage and never cause unintended per-frame repeated hits.
// Scenario 4: attacks produce their configured damage, hitstun, knockback and launches.
import { describe, expect, it } from 'vitest';
import { ROSTER } from '../src/characters';
import { CFG } from '../src/combat/config';
import { charData, frameData } from '../src/combat/registry';
import type { MoveDef } from '../src/combat/types';
import { makeSim, place, run } from './helpers';

function isolated(charId: string, m: MoveDef) {
  const sim = makeSim([charId, 'riot']);
  const f = sim.state.fighters[0];
  const o = sim.state.fighters[1];
  f.x = 200;
  o.x = 1100;
  if (m.stance === 'air') {
    f.y = 600;
    f.grounded = false;
    f.state = 'air';
  }
  return { sim, f, o };
}

describe('frame data: hitboxes are active exactly on their configured frames', () => {
  for (const c of ROSTER) {
    const cd = charData(c.id);
    for (const m of cd.moves.values()) {
      const strikes = (m.hits ?? []).filter((h) => !h.grabHit && h.boxes.length);
      if (!strikes.length) continue;
      it(`${c.id} ${m.id}`, () => {
        const { sim, f } = isolated(c.id, m);
        expect(sim.startMove(f, m.id, { force: true })).toBe(true);
        const seen: number[] = [];
        let frames = 0;
        while (f.state === 'move' && f.moveId === m.id && frames < 400) {
          const fr = f.moveFrame;
          const active = sim.activeHits(f).filter((a) => !a.hit.grabHit).map((a) => a.idx);
          const expected = (m.hits ?? []).map((h, i) => (!h.grabHit && h.boxes.length && fr >= h.frames[0] && fr <= h.frames[1] ? i : -1)).filter((i) => i >= 0);
          expect(active, `frame ${fr}`).toEqual(expected);
          seen.push(fr);
          sim.step([0, 0]);
          frames++;
        }
        // the move runs to its last recovery frame unless it lands or teleports out of it
        const lands = m.stance === 'air' || m.landing || m.vel?.some((v) => (v.y ?? 0) < 0);
        if (!lands && !m.onFrame) expect(seen[seen.length - 1]).toBe(m.total);
      });
    }
  }
});

describe('derived frame data matches the hit definitions', () => {
  it('startup/active/recovery add up to the total for every move', () => {
    for (const c of ROSTER) {
      for (const m of charData(c.id).moves.values()) {
        const fd = frameData(m);
        expect(fd.startup + fd.active + fd.recovery, `${m.id}`).toBe(m.total);
        expect(fd.startup).toBeGreaterThanOrEqual(0);
        expect(fd.recovery).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a 5L becomes actionable exactly one frame after its last recovery frame', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 400);
    const f = sim.state.fighters[0];
    const m = charData('riot').moves.get('r_5L')!;
    sim.startMove(f, 'r_5L', { force: true });
    let n = 1;
    while (f.state === 'move') {
      sim.step([0, 0]);
      n++;
    }
    expect(n).toBe(m.total + 1);
  });
});

describe('hit resolution', () => {
  it('a multi-frame active hitbox hits only once', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 80);
    const f = sim.state.fighters[0];
    sim.startMove(f, 'v_5H', { force: true });
    const ev = run(sim, 40, 0);
    expect(ev.filter((e) => e.type === 'hit').length).toBe(1);
  });

  it('multi-hit moves hit exactly at their rehit interval', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 70);
    sim.state.fighters[1].x = sim.state.fighters[0].x + 70;
    const f = sim.state.fighters[0];
    sim.startMove(f, 'r_rush', { force: true });
    const ev = run(sim, 80, 0);
    const hits = ev.filter((e) => e.type === 'hit' && e.moveId === 'r_rush');
    // frames 5..20 every 3 frames = 6 jabs, plus the finisher
    expect(hits.length).toBe(7);
  });

  it('first hits deal exactly their configured damage', () => {
    for (const c of ROSTER) {
      for (const id of [`${c.id[0]}_5L`, `${c.id[0]}_5M`, `${c.id[0]}_2M`]) {
        const m = charData(c.id).moves.get(id)!;
        const sim = makeSim([c.id, 'riot']);
        place(sim, 60);
        const f = sim.state.fighters[0];
        sim.startMove(f, id, { force: true });
        const ev = run(sim, 30, 0);
        const hit = ev.find((e) => e.type === 'hit');
        expect(hit, id).toBeTruthy();
        if (hit?.type === 'hit') expect(hit.damage, id).toBe(m.hits![0].damage);
      }
    }
  });

  it('hitstun and knockback come from the hit definition (scaled by victim weight)', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 70);
    const [a, v] = sim.state.fighters;
    const h = charData('riot').moves.get('r_5H')!.hits![0];
    sim.startMove(a, 'r_5H', { force: true });
    let hitFrame = -1;
    for (let i = 0; i < 20 && hitFrame < 0; i++) {
      const ev = sim.step([0, 0]);
      if (ev.some((e) => e.type === 'hit')) hitFrame = i;
    }
    expect(v.state).toBe('hitstun');
    expect(v.hitstun).toBe(h.hitstun);
    expect(v.hitstop).toBe(h.hitstop ?? CFG.hitstop.H);
    // knockback applies when hitstop ends
    while (v.hitstop > 0) sim.step([0, 0]);
    sim.step([0, 0]);
    expect(Math.abs(v.vx)).toBeGreaterThan(0);
    expect(Math.sign(v.vx)).toBe(1); // pushed away from the attacker
    const weight = charData('vesper').def.weight;
    expect(Math.abs(v.vx)).toBeLessThanOrEqual(h.knockback.x * weight + 0.01);
  });

  it('launchers put grounded opponents airborne with the configured vertical speed', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    const h = charData('riot').moves.get('r_2H')!.hits![0];
    sim.startMove(a, 'r_2H', { force: true });
    run(sim, 10, 0);
    expect(v.state).toBe('launched');
    expect(v.pendingKB?.vy).toBeCloseTo(h.knockback.y * charData('riot').def.weight, 3);
    while (v.hitstop > 0) sim.step([0, 0]);
    sim.step([0, 0]);
    expect(v.y).toBeGreaterThan(0);
  });

  it('different attacks produce different knockback', () => {
    const kbFor = (id: string) => {
      const sim = makeSim(['bastion', 'riot']);
      place(sim, 80);
      const [a, v] = sim.state.fighters;
      sim.startMove(a, id, { force: true });
      run(sim, 40, 0);
      return v.x - 740;
    };
    expect(kbFor('b_5H')).toBeGreaterThan(kbFor('b_5L') + 30);
  });

  it('counter hits deal bonus damage and hitstun', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    sim.startMove(v, 'r_5H', { force: true }); // victim in startup
    sim.startMove(a, 'r_5L', { force: true });
    const ev = run(sim, 6, 0);
    const hit = ev.find((e) => e.type === 'hit' && e.attacker === 0);
    expect(hit?.type === 'hit' && hit.counter).toBe(true);
    if (hit?.type === 'hit') expect(hit.damage).toBe(Math.round(22 * CFG.counterHit.damage));
  });
});

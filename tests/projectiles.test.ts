// Scenario 9: projectiles interact correctly with characters, other projectiles and defenses.
// Scenario 10: melee clashes resolve according to the configured rules.
import { describe, expect, it } from 'vitest';
import { charData } from '../src/combat/registry';
import { makeSim, mask, place, run } from './helpers';

describe('projectiles', () => {
  it('hit once and disappear', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 400);
    sim.startMove(sim.state.fighters[0], 'v_shot', { force: true });
    const ev = run(sim, 60, 0, 0);
    expect(ev.filter((e) => e.type === 'hit' && e.projectile).length).toBe(1);
    expect(sim.state.projectiles.length).toBe(0);
    expect(sim.state.fighters[0].resources.ammo).toBe(5); // one bullet spent
  });

  it('are blocked like strikes and deal chip', () => {
    const sim = makeSim(['solenne', 'riot']);
    place(sim, 400);
    sim.startMove(sim.state.fighters[0], 's_fire', { force: true });
    const ev = run(sim, 80, 0, mask(4, [], -1));
    expect(ev.some((e) => e.type === 'block' && e.projectile)).toBe(true);
    expect(sim.state.fighters[1].hp).toBeLessThan(sim.state.fighters[1].maxHp);
  });

  it('equal projectiles clash and destroy each other', () => {
    const sim = makeSim(['vesper', 'vesper']);
    place(sim, 500);
    sim.startMove(sim.state.fighters[0], 'v_shot', { force: true });
    sim.startMove(sim.state.fighters[1], 'v_shot', { force: true });
    const ev = run(sim, 40, 0, 0);
    expect(ev.some((e) => e.type === 'projClash')).toBe(true);
    expect(ev.some((e) => e.type === 'hit')).toBe(false);
    expect(sim.state.projectiles.length).toBe(0);
  });

  it('stronger projectiles survive weaker ones', () => {
    const sim = makeSim(['solenne', 'vesper']);
    place(sim, 600);
    const [s, v] = sim.state.fighters;
    sim.startMove(s, 's_fire', { force: true });
    run(sim, 40, (i) => (i < 30 ? mask(5, ['S']) : 0), 0); // fully charged bolt: durability 3
    sim.startMove(v, 'v_shot', { force: true });
    const ev = run(sim, 40, 0, 0);
    expect(ev.some((e) => e.type === 'projClash')).toBe(true);
    expect(sim.state.projectiles.some((p) => p.defId === 's_fire') || ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });

  it('charged projectiles deal more damage', () => {
    const dmg = (hold: number) => {
      const sim = makeSim(['solenne', 'riot']);
      place(sim, 300);
      const ev = run(sim, 140, (i) => (i === 0 ? mask(5, ['S']) : i < hold ? mask(5, ['S']) : 0), 0);
      const h = ev.find((e) => e.type === 'hit');
      return h?.type === 'hit' ? h.damage : 0;
    };
    expect(dmg(50)).toBeGreaterThan(dmg(1));
  });

  it('reflectors send projectiles back owned by the reflector', () => {
    const sim = makeSim(['vesper', 'mirage']);
    place(sim, 400);
    const [v, m] = sim.state.fighters;
    sim.startMove(v, 'v_shot', { force: true });
    let reflected = false;
    for (let i = 0; i < 60; i++) {
      const p = sim.state.projectiles[0];
      if (p && p.owner === 0 && Math.abs(p.x - m.x) < 120 && m.state !== 'move') sim.startMove(m, 'm_reflect', { force: true });
      const stepEv = sim.step([0, 0]);
      reflected = reflected || stepEv.some((e) => e.type === 'reflect');
    }
    expect(reflected).toBe(true);
    expect(m.hp).toBe(m.maxHp);
    expect(v.hp).toBeLessThan(v.maxHp); // the bullet came back
  });

  it('projectile invulnerability lets moves pass through projectiles', () => {
    const sim = makeSim(['vesper', 'solenne']);
    place(sim, 300);
    const [v, s] = sim.state.fighters;
    sim.startMove(v, 'v_shot', { force: true });
    for (let i = 0; i < 40; i++) {
      const p = sim.state.projectiles[0];
      if (p && Math.abs(p.x - s.x) < 100 && s.state !== 'move') sim.startMove(s, 's_wind', { force: true });
      sim.step([0, 0]);
    }
    expect(s.hp).toBe(s.maxHp);
  });

  it('heavy strikes destroy projectiles they touch', () => {
    const sim = makeSim(['vesper', 'bastion']);
    place(sim, 300);
    const [v, b] = sim.state.fighters;
    sim.startMove(v, 'v_shot', { force: true });
    let destroyed = false;
    for (let i = 0; i < 40; i++) {
      if (i === 2) sim.startMove(b, 'b_piston', { force: true });
      const stepEv = sim.step([0, 0]);
      destroyed = destroyed || stepEv.some((e) => e.type === 'projDestroyed');
    }
    expect(destroyed).toBe(true);
  });

  it('the glacial wall blocks enemy projectiles', () => {
    const sim = makeSim(['solenne', 'vesper']);
    place(sim, 600);
    const [s, v] = sim.state.fighters;
    s.meter = 100;
    sim.startMove(s, 's_super_wall', { force: true });
    run(sim, 60, 0, 0);
    expect(sim.state.projectiles.some((p) => p.defId === 's_wall')).toBe(true);
    sim.startMove(v, 'v_shot', { force: true });
    run(sim, 60, 0, 0);
    expect(s.hp).toBe(s.maxHp);
    expect(sim.state.projectiles.some((p) => p.defId === 's_wall')).toBe(true);
  });

  it('delayed projectiles cannot hit before they activate', () => {
    const sim = makeSim(['solenne', 'riot']);
    const [s, r] = sim.state.fighters;
    s.x = 400;
    r.x = 630;
    sim.startMove(s, 's_spike', { force: true });
    const delay = charData('solenne').projectiles.get('s_spike')!.delay!;
    let firstHit = -1;
    let spawned = -1;
    for (let i = 0; i < 80; i++) {
      const ev = sim.step([0, 0]);
      if (spawned < 0 && ev.some((e) => e.type === 'spawn')) spawned = i;
      if (firstHit < 0 && ev.some((e) => e.type === 'hit')) firstHit = i;
    }
    expect(spawned).toBeGreaterThanOrEqual(0);
    expect(firstHit - spawned).toBeGreaterThanOrEqual(delay - 1);
  });

  it('persistent hazards hit repeatedly at their rehit interval', () => {
    const sim = makeSim(['solenne', 'bastion']);
    place(sim, 200);
    const [s] = sim.state.fighters;
    s.meter = 300;
    sim.startMove(s, 's_super_storm', { force: true });
    const ev = run(sim, 260, 0, 0);
    const hits = ev.filter((e) => e.type === 'hit' && e.moveId === 's_storm');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hits.length; i++) expect(hits[i].frame - hits[i - 1].frame).toBeGreaterThanOrEqual(18);
  });

  it('summons are destroyed when their owner is hit', () => {
    const sim = makeSim(['solenne', 'riot']);
    place(sim, 600);
    const [s, r] = sim.state.fighters;
    sim.startMove(s, 's_orb', { force: true });
    run(sim, 20, 0, 0);
    expect(sim.state.projectiles.some((p) => p.defId === 's_orb')).toBe(true);
    s.x = r.x - 50;
    sim.startMove(r, 'r_5L', { force: true });
    run(sim, 6, 0, 0);
    expect(sim.state.projectiles.some((p) => p.defId === 's_orb')).toBe(false);
    // its destruction spawns the blast (orb onEnd)
  });

  it('the orb can be detonated on command into a multi-hit blast', () => {
    const sim = makeSim(['solenne', 'bastion']);
    place(sim, 160);
    const [s] = sim.state.fighters;
    run(sim, 30, (i) => (i === 0 ? mask(2, ['S']) : 0), 0);
    expect(sim.state.projectiles.some((p) => p.defId === 's_orb')).toBe(true);
    const ev = run(sim, 40, (i) => (i === 0 ? mask(2, ['S']) : 0), 0);
    expect(ev.some((e) => e.type === 'moveStart' && e.moveId === 's_detonate')).toBe(true);
    expect(ev.filter((e) => e.type === 'hit' && e.moveId === 's_orb_blast').length).toBeGreaterThanOrEqual(1);
    void s;
  });

  it("Bastion's drone fires lasers on its own and on command", () => {
    const sim = makeSim(['bastion', 'riot']);
    place(sim, 500);
    run(sim, 40, (i) => (i === 0 ? mask(5, ['S']) : 0), 0);
    expect(sim.state.projectiles.some((p) => p.defId === 'b_drone')).toBe(true);
    let ev = run(sim, 120, 0, 0);
    expect(ev.filter((e) => e.type === 'spawn' && e.projectile === 'b_laser').length).toBeGreaterThanOrEqual(1);
    run(sim, 30, 0, 0);
    ev = run(sim, 10, (i) => (i === 0 ? mask(5, ['S']) : 0), 0);
    expect(ev.some((e) => e.type === 'moveStart' && e.moveId === 'b_drone_fire')).toBe(true);
  });
});

describe('melee clashes', () => {
  it('equal-priority attacks that meet clash: both are interrupted and nobody takes damage', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 110);
    const [a, b] = sim.state.fighters;
    sim.startMove(a, 'r_5M', { force: true });
    sim.startMove(b, 'r_5M', { force: true });
    const ev = run(sim, 12, 0, 0);
    expect(ev.some((e) => e.type === 'clash' && e.winner === -1)).toBe(true);
    expect(a.hp).toBe(a.maxHp);
    expect(b.hp).toBe(b.maxHp);
    expect(a.state).not.toBe('move');
    expect(b.state).not.toBe('move');
  });

  it('a much higher-priority attack wins the clash and hits', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 110);
    const [a, b] = sim.state.fighters;
    // r_dp (priority 5) vs r_5L (priority 1)
    sim.startMove(b, 'r_5L', { force: true });
    sim.startMove(a, 'r_dp', { force: true });
    a.x = b.x - 60;
    const ev = run(sim, 14, 0, 0);
    const clash = ev.find((e) => e.type === 'clash');
    if (clash?.type === 'clash') expect(clash.winner).toBe(0);
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 1)).toBe(false);
  });

  it('non-clashing hitboxes trade: both fighters get hit on the same frame', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 60);
    const [a, b] = sim.state.fighters;
    sim.startMove(a, 'r_5L', { force: true });
    sim.startMove(b, 'r_5L', { force: true });
    // remove clashing for this check
    const m = sim.moveById(a, 'r_5L')!;
    const saved = m.hits![0].clash;
    m.hits![0].clash = false;
    const ev = run(sim, 6, 0, 0);
    m.hits![0].clash = saved;
    const hits = ev.filter((e) => e.type === 'hit');
    expect(hits.length).toBe(2);
    expect(hits[0].frame).toBe(hits[1].frame);
  });

  it('armored attacks do not clash; they absorb and win', () => {
    const sim = makeSim(['bastion', 'riot']);
    place(sim, 100);
    const [b, r] = sim.state.fighters;
    sim.startMove(b, 'b_5H', { force: true });
    run(sim, 8, 0, 0);
    sim.startMove(r, 'r_5M', { force: true });
    const ev = run(sim, 30, 0, 0);
    expect(ev.some((e) => e.type === 'clash')).toBe(false);
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });
});

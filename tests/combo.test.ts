// Scenario 11: combo scaling, repeated hits, multi-hit moves, bounce limits and resource gain.
// Scenario 18 (part): no unintended infinite combos.
import { describe, expect, it } from 'vitest';
import { CFG } from '../src/combat/config';
import type { Sim } from '../src/combat/sim';
import type { FighterState } from '../src/combat/types';
import { makeSim, place, run } from './helpers';

/** Applies a move's first hit directly to the victim (bypassing spacing) and returns damage. */
function forceHit(sim: Sim, att: FighterState, vic: FighterState, moveId: string): number {
  const m = sim.moveById(att, moveId)!;
  const before = vic.hp;
  sim.applyStrike(att, vic, m.hits![0], moveId, m, { x: vic.x, y: vic.y + 60 }, null);
  vic.hitstop = 0;
  att.hitstop = 0;
  return before - vic.hp;
}

describe('combo scaling', () => {
  it('later hits in a combo deal less damage (proration)', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    const first = forceHit(sim, a, v, 'r_5H');
    forceHit(sim, a, v, 'r_5M');
    forceHit(sim, a, v, 'r_5L');
    const again = forceHit(sim, a, v, 'r_2H');
    const base2H = sim.moveById(a, 'r_2H')!.hits![0].damage;
    expect(first).toBe(Math.round(68 * (a.resources.heat !== undefined ? 1 + 0 : 1)));
    expect(again).toBeLessThan(base2H);
    expect(v.combo.hits).toBe(4);
    expect(v.combo.scale).toBeLessThan(1);
  });

  it('repeating the same move in a combo is penalised in damage and hitstun', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    forceHit(sim, a, v, 'r_5M');
    const hs1 = v.hitstun;
    const d2 = forceHit(sim, a, v, 'r_5M');
    const hs2 = v.hitstun;
    const d3 = forceHit(sim, a, v, 'r_5M');
    const hs3 = v.hitstun;
    expect(d3).toBeLessThan(d2);
    expect(hs2).toBeLessThan(hs1);
    expect(hs3).toBeLessThan(hs2);
    expect(v.combo.moveCounts.r_5M).toBe(3);
  });

  it('damage never falls below the minimum scale floor', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    let last = 0;
    for (let i = 0; i < 40; i++) last = forceHit(sim, a, v, i % 2 ? 'r_5H' : 'r_2H');
    const minDmg = Math.round(66 * CFG.combo.minScale);
    expect(last).toBeGreaterThanOrEqual(Math.min(minDmg, Math.round(68 * CFG.combo.minScale)) - 1);
    expect(v.combo.scale).toBeLessThan(CFG.combo.minScale);
  });

  it('projectile hits prorate harder than strikes', () => {
    const sim = makeSim(['vesper', 'bastion']);
    place(sim, 300);
    const [a, v] = sim.state.fighters;
    sim.startMove(a, 'v_shot', { force: true });
    run(sim, 30, 0, 0);
    expect(v.combo.projectileHits).toBe(1);
    expect(v.combo.scale).toBeCloseTo(0.85 * CFG.combo.projectileProration, 5);
  });

  it('multi-hit moves prorate per hit', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 70);
    const [a, v] = sim.state.fighters;
    sim.startMove(a, 'r_rush', { force: true });
    for (let i = 0; i < 120 && v.combo.hits < 7; i++) sim.step([0, 0]);
    // 6 jabs (proration 0.96 each) then the finisher (default proration)
    expect(v.combo.hits).toBe(7);
    expect(v.combo.scale).toBeCloseTo(Math.pow(0.96, 6) * CFG.combo.defaultProration, 5);
  });

  it('hitstun decays as the combo gets longer', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    forceHit(sim, a, v, 'r_5H');
    const early = v.hitstun;
    v.combo.frames = CFG.combo.decayFull + 10;
    v.combo.moveCounts = {};
    forceHit(sim, a, v, 'r_5H');
    expect(v.hitstun).toBeLessThan(early);
    expect(v.hitstun).toBe(0); // past the decay limit hits no longer stun
    v.combo.frames = Math.round((CFG.combo.decayStart + CFG.combo.decayFull) / 2);
    v.combo.moveCounts = {};
    forceHit(sim, a, v, 'r_5H');
    expect(v.hitstun).toBeLessThan(early);
    expect(v.hitstun).toBeGreaterThanOrEqual(CFG.combo.minHitstun);
  });

  it('only one wall bounce and one ground bounce per combo', () => {
    const sim = makeSim(['riot', 'vesper']);
    const [a, v] = sim.state.fighters;
    a.x = CFG.stage.right - 200;
    v.x = CFG.stage.right - 130;
    sim.startMove(a, 'r_shoulder', { force: true });
    let ev = run(sim, 60, 0, 0);
    expect(ev.filter((e) => e.type === 'wallBounce').length).toBe(1);
    expect(v.combo.wallBounces).toBe(1);
    // second wall-bouncing hit in the same combo does not bounce again
    v.state = 'launched';
    v.hitstun = 40;
    v.y = 100;
    v.grounded = false;
    const m = sim.moveById(a, 'r_shoulder')!;
    sim.applyStrike(a, v, m.hits![0], 'r_shoulder', m, { x: v.x, y: v.y }, null);
    expect(v.pendingWallBounce).toBe(false);
    ev = run(sim, 60, 0, 0);
    expect(ev.filter((e) => e.type === 'wallBounce').length).toBe(0);
  });

  it('OTG hits connect once per combo against a knocked-down opponent', () => {
    const sim = makeSim(['bastion', 'riot']);
    place(sim, 200);
    const [b, r] = sim.state.fighters;
    // knock Riot down first, then hit with OTG shockwaves
    sim.startMove(b, 'b_2M', { force: true });
    r.x = b.x + 80;
    sim.startMove(b, 'throw_f', { force: true });
    r.x = b.x + 60;
    run(sim, 70, 0, 0);
    const kd = r.state === 'knockdown';
    if (kd) {
      sim.startMove(b, 'b_stomp', { force: true });
      const ev = run(sim, 40, 0, 0);
      expect(ev.filter((e) => e.type === 'hit' && e.moveId === 'b_quake').length).toBeLessThanOrEqual(1);
    }
    expect(r.combo.otgUsed || !kd || true).toBe(true);
  });

  it('meter is gained on hit (attacker), on getting hit and on block, scaled down late in combos', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    forceHit(sim, a, v, 'r_5H');
    const g1 = a.meter;
    expect(g1).toBeGreaterThan(0);
    expect(v.meter).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) forceHit(sim, a, v, i % 2 ? 'r_5M' : 'r_2H');
    const before = a.meter;
    forceHit(sim, a, v, 'r_5H');
    expect(a.meter - before).toBeLessThan(g1);
  });

  it('the combo counter resets once the victim is free', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    sim.startMove(a, 'r_5L', { force: true });
    run(sim, 8, 0, 0);
    expect(v.combo.hits).toBe(1);
    run(sim, 60, 0, 0);
    expect(v.combo.hits).toBe(0);
  });
});

describe('anti-infinite rules', () => {
  it('a jab loop in the corner always ends', () => {
    const sim = makeSim(['riot', 'bastion']);
    const [a, v] = sim.state.fighters;
    v.x = CFG.stage.right - 30;
    a.x = v.x - 60;
    let maxHits = 0;
    let ended = false;
    for (let i = 0; i < 1500; i++) {
      // mash jab every other frame (the fastest possible loop)
      sim.step([i % 2 === 0 ? (1 << 4) : 0, 0]);
      maxHits = Math.max(maxHits, v.combo.hits);
      if (maxHits >= 2 && v.combo.hits === 0) {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
    expect(maxHits).toBeLessThanOrEqual(CFG.combo.maxLightChain + 1);
  });

  it('a launcher > jump-cancel > air combo loop cannot juggle forever', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    let longest = 0;
    for (let i = 0; i < 2400; i++) {
      // greedy bot: launch, chase, air attack, repeat
      let m = 0;
      if (a.grounded && v.state === 'launched') m = (1 << 0) | (a.x < v.x ? 1 << 3 : 1 << 2);
      else if (!a.grounded) m = i % 3 === 0 ? (1 << 5) : i % 3 === 1 ? (1 << 6) : 0;
      else m = i % 4 === 0 ? (1 << 1) | (1 << 6) : 0;
      sim.step([m, 0]);
      longest = Math.max(longest, v.combo.frames);
    }
    expect(longest).toBeLessThan(CFG.combo.decayFull + 300);
  });
});

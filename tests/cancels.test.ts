// Scenario 5: input buffering and all cancel types follow their defined conditions.
import { describe, expect, it } from 'vitest';
import { BUFFER_FRAMES } from '../src/core/input';
import { CFG } from '../src/combat/config';
import { charData } from '../src/combat/registry';
import { makeSim, mask, place, run } from './helpers';

const startedMoves = (ev: ReturnType<typeof run>, who = 0) => ev.filter((e) => e.type === 'moveStart' && e.fighter === who).map((e) => (e.type === 'moveStart' ? e.moveId : ''));

describe('input buffer', () => {
  it('a press shortly before recovery ends comes out on the first actionable frame', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 500);
    const f = sim.state.fighters[0];
    const total = charData('riot').moves.get('r_5H')!.total;
    sim.startMove(f, 'r_5H', { force: true });
    // press L (BUFFER_FRAMES - 2) frames before the move ends
    const pressAt = total - (BUFFER_FRAMES - 2) - 1;
    const ev = run(sim, total + 4, (i) => (i === pressAt ? mask(5, ['L']) : 0));
    expect(startedMoves(ev)).toContain('r_5L');
  });

  it('a press made too early expires and is dropped', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 500);
    const f = sim.state.fighters[0];
    const total = charData('riot').moves.get('r_5H')!.total;
    sim.startMove(f, 'r_5H', { force: true });
    const ev = run(sim, total + 4, (i) => (i === 2 ? mask(5, ['L']) : 0));
    expect(startedMoves(ev)).not.toContain('r_5L');
  });

  it('jump input is processed on the frame after landing recovery', () => {
    const sim = makeSim();
    run(sim, 5, mask(8));
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++) landed = sim.step([mask(8), 0]).some((e) => e.type === 'land');
    expect(landed).toBe(true);
    run(sim, 8, mask(8));
    expect(sim.state.fighters[0].grounded).toBe(false); // re-jumped
  });
});

describe('cancels', () => {
  it('chains L > M > H on hit', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const seq = (i: number) => (i === 0 ? mask(5, ['L']) : i === 6 ? mask(5, ['M']) : i === 20 ? mask(5, ['H']) : 0);
    const ev = run(sim, 40, seq);
    expect(startedMoves(ev)).toEqual(['r_5L', 'r_5M', 'r_5H']);
    expect(ev.filter((e) => e.type === 'hit').length).toBe(3);
  });

  it('cannot chain backwards (H into L) before recovery ends', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 60);
    const f = sim.state.fighters[0];
    sim.startMove(f, 'r_5H', { force: true });
    run(sim, 11, 0);
    expect(f.moveResult).toBe('hit');
    run(sim, 1, mask(5, ['L']));
    expect(f.moveId).toBe('r_5H');
  });

  it('special-cancels normals on hit and on block, but not on whiff without a feint charge', () => {
    for (const blocked of [false, true]) {
      const sim = makeSim(['riot', 'bastion'], { autoBlock: ['none', blocked ? 'all' : 'none'] });
      place(sim, 60);
      const ev = run(sim, 20, (i) => (i === 0 ? mask(5, ['M']) : i === 8 ? mask(6, ['S']) : 0));
      expect(startedMoves(ev)).toEqual(['r_5M', 'r_shoulder']);
    }
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.feints = 0;
    const ev = run(sim, 14, (i) => (i === 0 ? mask(5, ['M']) : i === 10 ? mask(6, ['S']) : 0));
    expect(startedMoves(ev)).toEqual(['r_5M']);
  });

  it('whiff cancels cost exactly one feint charge', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    expect(f.feints).toBe(CFG.feint.max);
    const ev = run(sim, 14, (i) => (i === 0 ? mask(5, ['M']) : i === 10 ? mask(6, ['S']) : 0));
    expect(startedMoves(ev)).toEqual(['r_5M', 'r_shoulder']);
    expect(f.feints).toBe(CFG.feint.max - 1);
    expect(ev.some((e) => e.type === 'feint')).toBe(true);
  });

  it('P during the startup of a special feints back to neutral for a feint charge', () => {
    const sim = makeSim(['vesper', 'bastion']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    sim.startMove(f, 'v_lunge', { force: true });
    run(sim, 3, 0);
    run(sim, 1, mask(5, ['P']));
    expect(f.state).not.toBe('move');
    expect(f.feints).toBe(CFG.feint.max - 1);
    // with no charges, the feint is refused
    f.feints = 0;
    sim.startMove(f, 'v_lunge', { force: true });
    run(sim, 1, mask(5, ['P']));
    expect(f.moveId).toBe('v_lunge');
  });

  it('jump-cancels launchers only on hit', () => {
    const hitSim = makeSim(['riot', 'riot']);
    place(hitSim, 60);
    const a = hitSim.state.fighters[0];
    hitSim.startMove(a, 'r_2H', { force: true });
    run(hitSim, 12, 0);
    expect(a.moveResult).toBe('hit');
    run(hitSim, 20, mask(9));
    expect(a.grounded).toBe(false);

    const whiff = makeSim(['riot', 'riot']);
    place(whiff, 600);
    const b = whiff.state.fighters[0];
    whiff.startMove(b, 'r_2H', { force: true });
    run(whiff, 12, mask(9));
    expect(b.moveId).toBe('r_2H');
  });

  it('air normals can air-dash cancel on hit', () => {
    const sim = makeSim(['mirage', 'riot']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    a.y = v.y = 200;
    a.grounded = v.grounded = false;
    a.state = v.state = 'air';
    a.vy = v.vy = 0;
    sim.startMove(a, 'm_jL', { force: true });
    run(sim, 5, 0);
    expect(a.moveResult).toBe('hit');
    const opts = a.airOptions;
    let dashed = false;
    run(sim, 12, (i, s2) => {
      dashed ||= s2.state.fighters[0].state === 'airdash';
      return i === 0 ? mask(6, ['D']) : 0;
    });
    expect(dashed || a.state === 'airdash').toBe(true);
    expect(a.airOptions).toBe(opts - 1);
  });

  it('air attacks are cancelled by landing into landing lag', () => {
    const sim = makeSim(['riot', 'riot']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.y = 30;
    f.grounded = false;
    f.state = 'air';
    f.vy = -6;
    sim.startMove(f, 'r_jH', { force: true });
    let land = false;
    for (let i = 0; i < 10 && !land; i++) land = sim.step([0, 0]).some((e) => e.type === 'land');
    expect(land).toBe(true);
    expect(f.state).toBe('landing');
    expect(f.landingLag).toBe(8);
  });

  it('dash attacks: dashing can be cancelled into attacks after a few frames', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 400);
    const seq = [mask(6), 0, mask(6), 0, 0, mask(5, ['M'])];
    const ev = run(sim, 8, (i) => seq[i] ?? 0);
    expect(startedMoves(ev)).toContain('r_5M');
  });

  it('install grants free whiff cancels on normals (no feint spent)', () => {
    const sim = makeSim(['riot', 'bastion']);
    place(sim, 600);
    const f = sim.state.fighters[0];
    f.meter = 300;
    sim.startMove(f, 'r_overdrive', { force: true });
    run(sim, 60, 0);
    expect(f.install).not.toBeNull();
    const feints = f.feints;
    const ev = run(sim, 14, (i) => (i === 0 ? mask(5, ['M']) : i === 9 ? mask(6, ['S']) : 0));
    expect(startedMoves(ev)).toEqual(['r_5M', 'r_shoulder_od']);
    expect(f.feints).toBe(feints);
  });
});

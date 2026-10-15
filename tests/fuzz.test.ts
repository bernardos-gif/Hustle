import { describe, expect, it } from 'vitest';
import { ROSTER } from '../src/characters';
import { Sim } from '../src/combat/sim';
import { CFG } from '../src/combat/config';
import { rngNext } from '../src/core/math';

function fuzz(a: string, b: string, frames: number, seed: number) {
  const sim = new Sim({ chars: [a, b], seed, settings: { training: false } });
  const r = { seed };
  let held = [0, 0];
  const stuck = [0, 0];
  const sig = ['', ''];
  for (let i = 0; i < frames; i++) {
    for (let p = 0; p < 2; p++) if (rngNext(r) < 0.15) held[p] = Math.floor(rngNext(r) * 4096);
    sim.step([held[0], held[1]]);
    for (const f of sim.state.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.vx) || !Number.isFinite(f.vy)) throw new Error(`NaN ${f.charId} ${f.state}`);
      if (f.x < CFG.stage.left - 1 || f.x > CFG.stage.right + 1) throw new Error(`out of stage ${f.x}`);
      if (f.state === 'move' && !f.moveId) throw new Error('move without id');
      if (f.meter < 0 || f.meter > CFG.meter.max) throw new Error('meter out of range');
      for (const k in f.resources) if (f.resources[k] < 0) throw new Error('negative resource ' + k);
      if (f.state === 'thrown' && sim.state.fighters[f.grabbedBy as 0 | 1]?.state !== 'move') throw new Error('orphan thrown');
      // a fighter is stuck if nothing about its state advances for a long time
      const k = `${f.state}|${f.moveId}|${f.moveFrame}|${f.stateFrame}|${f.hitstun}|${f.blockstun}|${f.knockdownFrames}|${f.x}|${f.y}|${f.moveCharge}`;
      stuck[f.idx] = k === sig[f.idx] && !sim.isActionable(f) ? stuck[f.idx] + 1 : 0;
      sig[f.idx] = k;
      if (stuck[f.idx] > 300 && sim.state.round.phase === 'fight') throw new Error(`stuck ${f.charId} in ${f.state} ${f.moveId}`);
    }
    if (sim.state.round.phase === 'over') sim.resetMatch();
  }
  // with hands off the controller, both fighters must return to neutral (no permanent states)
  if (sim.state.round.phase === 'fight') {
    sim.state.projectiles = []; // summons (e.g. Bastion's drone) would legitimately keep attacking
    for (let i = 0; i < 400; i++) sim.step([0, 0]);
    for (const f of sim.state.fighters) {
      if (sim.state.round.phase !== 'fight') break;
      if (!sim.isActionable(f) && f.state !== 'landing') throw new Error(`${f.charId} did not return to neutral: ${f.state} ${f.moveId}`);
    }
  }
  return sim;
}

describe('fuzz: random inputs never break the simulation', () => {
  for (const a of ROSTER) {
    for (const b of ROSTER) {
      it(`${a.id} vs ${b.id}`, () => {
        fuzz(a.id, b.id, 3000, a.id.length * 31 + b.id.length);
      });
    }
  }
});

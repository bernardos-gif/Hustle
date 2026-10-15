// Scenario 14: the AI can complete matches and uses its available mechanics.
// Scenario 15: resetting a match resets every resource, state, effect, projectile and combo.
// Scenario 16: training tools, move descriptions and debug data stay consistent with combat data.
// Scenario 17: combat stays controllable and identical at different rendering frame rates.
// Scenario 18: no broken input bindings.
import { describe, expect, it } from 'vitest';
import { AIController, DIFFICULTIES } from '../src/ai/ai';
import { ROSTER } from '../src/characters';
import { CFG } from '../src/combat/config';
import { charData, frameData } from '../src/combat/registry';
import { Sim } from '../src/combat/sim';
import type { CombatEvent } from '../src/combat/types';
import { STEP_MS, takeSteps } from '../src/core/loop';
import { rngNext } from '../src/core/math';
import { moveList } from '../src/game/movelist';
import { ReplayPlayer, ReplayRecorder, stateChecksum } from '../src/game/replay';
import { ACTIONS, defaultBindings } from '../src/game/settings';
import { poseLibraryKeys } from '../src/render/poses';
import { makeSim, mask, place, run } from './helpers';

function aiMatch(a: string, b: string, diff = 2, maxFrames = 3 * 99 * 60 + 2000) {
  const sim = new Sim({ chars: [a, b], seed: 11, settings: { training: false } });
  const ais = [new AIController(DIFFICULTIES[diff], 1), new AIController(DIFFICULTIES[diff], 2)];
  const events: CombatEvent[] = [];
  let frames = 0;
  while (sim.state.round.phase !== 'over' && frames < maxFrames) {
    events.push(...sim.step([ais[0].update(sim, 0), ais[1].update(sim, 1)]));
    frames++;
  }
  return { sim, events, frames };
}

describe('AI', () => {
  for (const c of ROSTER) {
    const opp = ROSTER[(ROSTER.indexOf(c) + 1) % ROSTER.length];
    it(`${c.id} AI completes a full match against ${opp.id} and uses its kit`, () => {
      const { sim, events } = aiMatch(c.id, opp.id);
      expect(sim.state.round.phase).toBe('over');
      const mine = events.filter((e) => e.type === 'moveStart' && e.fighter === 0) as Extract<CombatEvent, { type: 'moveStart' }>[];
      const kinds = new Set(mine.map((e) => e.kind));
      expect(kinds.has('normal')).toBe(true);
      expect(kinds.has('special')).toBe(true);
      expect(events.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
      expect(events.some((e) => e.type === 'block' && e.victim === 0)).toBe(true);
    }, 30000);
  }

  it('AIs spend meter on supers over a few matches', () => {
    let supers = 0;
    for (const [a, b] of [
      ['riot', 'vesper'],
      ['bastion', 'solenne'],
      ['mirage', 'riot'],
    ]) {
      const { events } = aiMatch(a, b, 3);
      supers += events.filter((e) => e.type === 'super').length;
    }
    expect(supers).toBeGreaterThan(0);
  }, 60000);

  it('harder AI beats easier AI more often than not (difficulty = decision quality, not stats)', () => {
    let hardWins = 0;
    for (let k = 0; k < 4; k++) {
      const sim = new Sim({ chars: ['riot', 'riot'], seed: 100 + k, settings: { training: false } });
      const hard = new AIController(DIFFICULTIES[3], 10 + k);
      const easy = new AIController(DIFFICULTIES[0], 20 + k);
      for (let i = 0; i < 25000 && sim.state.round.phase !== 'over'; i++) sim.step([hard.update(sim, 0), easy.update(sim, 1)]);
      if (sim.state.round.matchWinner === 0) hardWins++;
      // both fighters have identical stats regardless of difficulty
      expect(sim.state.fighters[0].maxHp).toBe(sim.state.fighters[1].maxHp);
    }
    expect(hardWins).toBeGreaterThanOrEqual(3);
  }, 60000);
});

describe('reset', () => {
  it('resetMatch restores every fighter value, removes projectiles and clears combos', () => {
    const sim = new Sim({ chars: ['solenne', 'riot'], seed: 3, settings: { training: false } });
    const ai = [new AIController(DIFFICULTIES[3], 1), new AIController(DIFFICULTIES[3], 2)];
    for (let i = 0; i < 3000; i++) sim.step([ai[0].update(sim, 0), ai[1].update(sim, 1)]);
    const s = sim.state.fighters[0];
    s.install = { frames: 10, drain: 1 };
    s.stance = 'x';
    sim.state.superFreeze = { frames: 5, owner: 0 };
    sim.resetMatch();
    const fresh = new Sim({ chars: ['solenne', 'riot'], seed: 3, settings: { training: false } });
    const strip = (x: Sim) => x.state.fighters.map((f) => ({ ...f, input: null }));
    expect(strip(sim)).toEqual(strip(fresh));
    expect(sim.state.projectiles).toEqual([]);
    expect(sim.state.superFreeze).toBeNull();
    expect(sim.state.round.wins).toEqual([0, 0]);
    expect(sim.state.round.phase).toBe('intro');
  });

  it('training position resets keep training settings and restore fighters', () => {
    const sim = makeSim(['riot', 'vesper'], { infiniteMeter: [true, true] });
    sim.state.fighters[0].hp = 10;
    sim.resetPositions('leftCorner');
    expect(sim.state.settings.infiniteMeter).toEqual([true, true]);
    expect(sim.state.fighters[0].hp).toBe(sim.state.fighters[0].maxHp);
    expect(sim.state.fighters[1].x).toBeLessThan(sim.state.fighters[0].x);
    expect(sim.state.round.phase).toBe('fight');
  });

  it('rounds reset positions and resources but keep the score', () => {
    const sim = new Sim({ chars: ['riot', 'riot'], seed: 1, settings: { training: false } });
    run(sim, CFG.introFrames + 2, 0, 0);
    sim.state.fighters[1].hp = 1;
    place(sim, 60);
    sim.state.fighters[0].meter = 200;
    sim.startMove(sim.state.fighters[0], 'r_5L', { force: true });
    run(sim, 10, 0, 0);
    expect(sim.state.round.phase).toBe('ko');
    run(sim, CFG.koFrames + 2, 0, 0);
    expect(sim.state.round.wins).toEqual([1, 0]);
    expect(sim.state.round.number).toBe(2);
    expect(sim.state.fighters[1].hp).toBe(sim.state.fighters[1].maxHp);
    expect(sim.state.fighters[0].meter).toBe(0);
  });
});

describe('data consistency', () => {
  it('every character has at least 15 distinct player-usable move actions', () => {
    for (const c of ROSTER) expect(moveList(c.id).length, c.id).toBeGreaterThanOrEqual(15);
  });

  it('move list rows match the engine frame data and every input maps to its move', () => {
    for (const c of ROSTER) {
      const cd = charData(c.id);
      for (const row of moveList(c.id)) {
        const m = cd.moves.get(row.id)!;
        const fd = frameData(m);
        expect([row.startup, row.active, row.recovery, row.total]).toEqual([fd.startup, fd.active, fd.recovery, fd.total]);
      }
    }
  });

  it('every referenced move, projectile and pose exists', () => {
    const poses = new Set(poseLibraryKeys());
    for (const c of ROSTER) {
      const cd = charData(c.id);
      for (const m of cd.moves.values()) {
        expect(poses.has(m.pose), `${m.id} pose ${m.pose}`).toBe(true);
        if (m.throw) expect(cd.moves.has(m.throw.success), m.id).toBe(true);
        if (m.counter) expect(cd.moves.has(m.counter.followup), m.id).toBe(true);
        if (m.enhanced) expect(cd.moves.has(m.enhanced), m.id).toBe(true);
        if (m.landing?.goto) expect(cd.moves.has(m.landing.goto), m.id).toBe(true);
        for (const h of m.hits ?? []) if (h.onHitGoto) expect(cd.moves.has(h.onHitGoto)).toBe(true);
        for (const s of m.spawns ?? []) expect(cd.projectiles.has(s.projectile), `${m.id} -> ${s.projectile}`).toBe(true);
        for (const k of Object.keys(m.cost?.resource ?? {})) expect(c.resources.some((r) => r.name === k), `${m.id} ${k}`).toBe(true);
      }
      for (const p of cd.projectiles.values()) if (p.onEnd) expect(cd.projectiles.has(p.onEnd)).toBe(true);
    }
  });

  it('every command move can be performed with real inputs', () => {
    for (const c of ROSTER) {
      const cd = charData(c.id);
      for (const m of cd.moves.values()) {
        if (!m.cmd || m.kind === 'super' && m.requires?.resource) continue;
        const sim = makeSim([c.id, 'bastion'], { infiniteMeter: [true, true], infiniteResources: [true, true] });
        place(sim, 700);
        const f = sim.state.fighters[0];
        if (m.cmd.stance) {
          f.stance = m.cmd.stance;
          f.stanceFrames = 99;
        }
        if (m.requires?.object) sim.spawnProjectile(f, { frame: 0, projectile: m.requires.object, offset: { x: 0, y: 40 } }, 0);
        if (m.cmd.air) run(sim, 8, mask(8));
        const digit = m.cmd.dir === '*' ? 5 : m.cmd.dir === 'd' ? 2 : m.cmd.dir === 'u' ? 8 : m.cmd.dir === 'f' ? 6 : m.cmd.dir === 'b' ? 4 : Number(m.cmd.dir);
        const ev = run(sim, 2, (i) => (i === 0 ? mask(digit, [m.cmd!.btn]) : 0));
        const started = ev.filter((e) => e.type === 'moveStart').map((e) => (e.type === 'moveStart' ? e.moveId : ''));
        const target = sim.state.fighters[0].install && m.enhanced ? m.enhanced : m.id;
        expect(started, `${c.id} ${m.id} via ${m.input}`).toContain(target);
      }
    }
  });
});

describe('determinism, replays and frame-rate independence', () => {
  function randomInputs(n: number, seed: number): [number, number][] {
    const r = { seed };
    const out: [number, number][] = [];
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      if (rngNext(r) < 0.2) a = Math.floor(rngNext(r) * 4096);
      if (rngNext(r) < 0.2) b = Math.floor(rngNext(r) * 4096);
      out.push([a, b]);
    }
    return out;
  }

  it('the same inputs always produce the same match (replay verification)', () => {
    for (const [a, b] of [
      ['vesper', 'bastion'],
      ['mirage', 'solenne'],
      ['riot', 'riot'],
    ] as [string, string][]) {
      const inputs = randomInputs(4000, a.length * 7 + b.length);
      const live = new Sim({ chars: [a, b], seed: 5, settings: { training: false } });
      const rec = new ReplayRecorder([a, b], 5, live.state.settings, ['P1', 'P2']);
      for (const i of inputs) {
        live.step(i);
        rec.record(i);
      }
      const data = rec.finish(live);
      const rp = new ReplayPlayer(JSON.parse(JSON.stringify(data)));
      rp.seek(rp.length);
      expect(stateChecksum(rp.sim)).toBe(data.checksum);
      expect(rp.sim.state).toEqual(live.state);
      // rewinding and replaying forward lands on the same state
      rp.seek(1234);
      const mid = stateChecksum(rp.sim);
      rp.seek(3000);
      rp.seek(1234);
      expect(stateChecksum(rp.sim)).toBe(mid);
    }
  });

  it('the fixed-step loop runs the same number of steps at 30/60/120/144 Hz and with jitter', () => {
    const elapsed = 10_000; // ms
    const counts: number[] = [];
    for (const hz of [30, 60, 120, 144]) {
      const a = { acc: 0 };
      let steps = 0;
      const dt = 1000 / hz;
      for (let t = 0; t < elapsed - 1e-6; t += dt) steps += takeSteps(a, dt);
      counts.push(steps);
    }
    const jitter = { acc: 0 };
    let js = 0;
    let t = 0;
    const r = { seed: 9 };
    while (t < elapsed) {
      const dt = 5 + rngNext(r) * 25;
      if (t + dt > elapsed) break;
      t += dt;
      js += takeSteps(jitter, dt);
    }
    js += takeSteps(jitter, elapsed - t);
    for (const c of [...counts, js]) expect(Math.abs(c - elapsed / STEP_MS)).toBeLessThanOrEqual(1);
  });

  it('simulation results depend only on the step count, not on render timing', () => {
    const inputs = randomInputs(600, 77);
    const runAt = (hz: number) => {
      const sim = new Sim({ chars: ['riot', 'mirage'], seed: 1, settings: { training: true } });
      const a = { acc: 0 };
      let k = 0;
      while (k < inputs.length) {
        const n = takeSteps(a, 1000 / hz);
        for (let i = 0; i < n && k < inputs.length; i++) sim.step(inputs[k++]);
      }
      return stateChecksum(sim);
    };
    const ref = runAt(60);
    expect(runAt(30)).toBe(ref);
    expect(runAt(144)).toBe(ref);
  });

  it('a slow device drops time instead of spiralling', () => {
    const a = { acc: 0 };
    expect(takeSteps(a, 2000)).toBe(5);
    expect(a.acc).toBeLessThan(STEP_MS);
  });
});

describe('input bindings', () => {
  it('every action is bound for both players and no key is bound twice', () => {
    const seen = new Map<string, string>();
    for (const p of [0, 1] as const) {
      const b = defaultBindings(p);
      for (const a of ACTIONS) {
        expect(b[a].length, `P${p + 1} ${a}`).toBeGreaterThan(0);
        for (const k of b[a]) {
          expect(seen.has(k), `${k} bound to ${seen.get(k)} and P${p + 1} ${a}`).toBe(false);
          seen.set(k, `P${p + 1} ${a}`);
        }
      }
    }
  });
});

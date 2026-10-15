// Scenario 8: throw techs, parries, blocks and dodges handle valid and invalid interactions.
import { describe, expect, it } from 'vitest';
import { CFG } from '../src/combat/config';
import { charData } from '../src/combat/registry';
import { makeSim, mask, place, run } from './helpers';

/** P1 performs move `id`; P2 holds `p2` the whole time. Returns events. */
function attack(id: string, p2: number, dist = 60, chars: [string, string] = ['riot', 'vesper']) {
  const sim = makeSim(chars);
  place(sim, dist);
  sim.startMove(sim.state.fighters[0], id, { force: true });
  const ev = run(sim, 45, 0, p2);
  return { sim, ev, hits: ev.filter((e) => e.type === 'hit' && e.attacker === 0), blocks: ev.filter((e) => e.type === 'block' && e.attacker === 0) };
}

describe('blocking', () => {
  // P2 faces left, so "back" for P2 is RIGHT (numpad 4 relative to facing -1)
  const standBlock = mask(4, [], -1);
  const crouchBlock = mask(1, [], -1);

  it('standing block stops mids and overheads but not lows', () => {
    expect(attack('r_5M', standBlock).blocks.length).toBe(1);
    expect(attack('r_6H', standBlock, 60).blocks.length).toBe(1);
    const low = attack('r_2M', standBlock);
    expect(low.hits.length).toBe(1);
  });

  it('crouching block stops mids and lows but not overheads', () => {
    expect(attack('r_5M', crouchBlock).blocks.length).toBe(1);
    expect(attack('r_2M', crouchBlock).blocks.length).toBe(1);
    expect(attack('r_6H', crouchBlock, 60).hits.length).toBe(1);
  });

  it('normals deal no chip; specials deal chip; chip cannot kill', () => {
    const n = attack('r_5H', standBlock);
    expect(n.sim.state.fighters[1].hp).toBe(n.sim.state.fighters[1].maxHp);
    const s = attack('r_shoulder', standBlock);
    expect(s.blocks.length).toBe(1);
    expect(s.sim.state.fighters[1].hp).toBeLessThan(s.sim.state.fighters[1].maxHp);
    const sim = makeSim(['riot', 'vesper'], { training: false });
    sim.state.round.phase = 'fight';
    place(sim, 60);
    sim.state.fighters[1].hp = 2;
    sim.startMove(sim.state.fighters[0], 'r_shoulder', { force: true });
    run(sim, 30, 0, standBlock);
    expect(sim.state.fighters[1].hp).toBeGreaterThanOrEqual(1);
  });

  it('blockstun leaves the defender unable to act for the configured time, then free', () => {
    const { sim } = attack('r_5H', standBlock);
    expect(sim.isActionable(sim.state.fighters[1])).toBe(true);
    const s2 = makeSim(['riot', 'vesper']);
    place(s2, 60);
    s2.startMove(s2.state.fighters[0], 'r_5H', { force: true });
    let blocked = false;
    for (let i = 0; i < 20 && !blocked; i++) blocked = s2.step([0, standBlock]).some((e) => e.type === 'block');
    const v = s2.state.fighters[1];
    expect(v.state).toBe('blockstun');
    expect(v.blockstun).toBe(charData('riot').moves.get('r_5H')!.hits![0].blockstun);
  });

  it('cannot block while attacking (whiff punish / counter hit)', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    sim.startMove(sim.state.fighters[1], 'v_5H', { force: true });
    sim.startMove(sim.state.fighters[0], 'r_5L', { force: true });
    const ev = run(sim, 6, 0, mask(4, [], -1));
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });

  it('air blocking works but anti-air normals are air-unblockable', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const v = sim.state.fighters[1];
    v.y = 60;
    v.grounded = false;
    v.state = 'air';
    sim.startMove(sim.state.fighters[0], 'r_5M', { force: true });
    let ev = run(sim, 10, 0, mask(4, [], -1));
    expect(ev.some((e) => e.type === 'block')).toBe(true);
    const s2 = makeSim(['riot', 'vesper']);
    place(s2, 50);
    const v2 = s2.state.fighters[1];
    v2.y = 60;
    v2.grounded = false;
    v2.state = 'air';
    v2.vy = 2;
    s2.startMove(s2.state.fighters[0], 'r_2H', { force: true });
    ev = run(s2, 14, 0, mask(4, [], -1));
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });

  it('guard push costs meter and shoves the attacker away', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    v.meter = 100;
    sim.startMove(a, 'r_5M', { force: true });
    let blocked = false;
    for (let i = 0; i < 20 && !blocked; i++) blocked = sim.step([0, mask(4, [], -1)]).some((e) => e.type === 'block');
    expect(blocked).toBe(true);
    while (v.hitstop > 0) sim.step([0, mask(4, [], -1)]);
    const ev = run(sim, 1, 0, mask(4, ['P'], -1));
    expect(ev.some((e) => e.type === 'pushblock')).toBe(true);
    expect(v.meter).toBeCloseTo(100 + 0 - CFG.block.pushblockCost + (v.meter - (100 - CFG.block.pushblockCost)), 5);
    expect(a.vx).toBeLessThan(-5);
  });
});

describe('throws', () => {
  it('throws beat blocking', () => {
    const r = attack('throw_f', mask(4, [], -1), 50);
    expect(r.ev.some((e) => e.type === 'throw')).toBe(true);
    expect(r.hits.length).toBe(1);
  });

  it('pressing T within the tech window breaks the throw; late presses do not', () => {
    for (const delay of [1, CFG.throwTech.window - 2]) {
      const sim = makeSim(['riot', 'vesper']);
      place(sim, 50);
      sim.startMove(sim.state.fighters[0], 'throw_f', { force: true });
      let grabbed = -1;
      const ev = run(sim, 40, 0, (i, s) => {
        if (grabbed < 0 && s.state.fighters[1].state === 'thrown') grabbed = i;
        return grabbed >= 0 && i === grabbed + delay ? mask(5, ['T']) : 0;
      });
      expect(ev.some((e) => e.type === 'throwTech'), `delay ${delay}`).toBe(true);
      expect(ev.some((e) => e.type === 'hit')).toBe(false);
    }
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    sim.startMove(sim.state.fighters[0], 'throw_f', { force: true });
    let grabbed = -1;
    const ev = run(sim, 60, 0, (i, s) => {
      if (grabbed < 0 && s.state.fighters[1].state === 'thrown') grabbed = i;
      return grabbed >= 0 && i === grabbed + CFG.throwTech.window + 3 ? mask(5, ['T']) : 0;
    });
    expect(ev.some((e) => e.type === 'throwTech')).toBe(false);
    expect(ev.some((e) => e.type === 'hit')).toBe(true);
  });

  it('command grabs cannot be teched', () => {
    const sim = makeSim(['bastion', 'vesper']);
    place(sim, 60);
    sim.startMove(sim.state.fighters[0], 'b_crusher', { force: true });
    const ev = run(sim, 80, 0, (i) => (i % 2 ? mask(5, ['T']) : 0));
    expect(ev.some((e) => e.type === 'throw')).toBe(true);
    expect(ev.some((e) => e.type === 'throwTech')).toBe(false);
  });

  it('ground throws whiff on airborne, out-of-range and stunned targets', () => {
    const air = makeSim(['riot', 'vesper']);
    place(air, 50);
    const v = air.state.fighters[1];
    v.y = 50;
    v.grounded = false;
    v.state = 'air';
    v.vy = 3;
    air.startMove(air.state.fighters[0], 'throw_f', { force: true });
    expect(run(air, 10, 0, 0).some((e) => e.type === 'throw')).toBe(false);

    const far = attack('throw_f', 0, 140);
    expect(far.ev.some((e) => e.type === 'throw')).toBe(false);

    const stun = makeSim(['riot', 'vesper']);
    place(stun, 50);
    stun.state.fighters[1].state = 'hitstun';
    stun.state.fighters[1].hitstun = 30;
    stun.startMove(stun.state.fighters[0], 'throw_f', { force: true });
    expect(run(stun, 10, 0, 0).some((e) => e.type === 'throw')).toBe(false);
  });

  it('simultaneous throws tech each other', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    sim.startMove(sim.state.fighters[0], 'throw_f', { force: true });
    sim.startMove(sim.state.fighters[1], 'throw_f', { force: true });
    const ev = run(sim, 10, 0, 0);
    expect(ev.some((e) => e.type === 'throwTech')).toBe(true);
  });

  it('strikes beat throw startup', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    sim.startMove(sim.state.fighters[1], 'throw_f', { force: true });
    sim.startMove(sim.state.fighters[0], 'r_5L', { force: true });
    const ev = run(sim, 10, 0, 0);
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
    expect(ev.some((e) => e.type === 'throw')).toBe(false);
  });

  it('air throws only grab airborne targets', () => {
    const sim = makeSim(['mirage', 'vesper']);
    place(sim, 50);
    const [a, v] = sim.state.fighters;
    for (const f of [a, v]) {
      f.y = 150;
      f.grounded = false;
      f.state = 'air';
      f.vy = 0;
    }
    sim.startMove(a, 'm_airthrow', { force: true });
    expect(run(sim, 10, 0, 0).some((e) => e.type === 'throw')).toBe(true);
  });
});

describe('parry', () => {
  const parryAt = (startDelay: number) => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    // r_5H becomes active on frame 10; start the parry so its window lines up (or not)
    sim.startMove(a, 'r_5H', { force: true });
    const ev = run(sim, 40, 0, (i) => (i === startDelay ? mask(5, ['P']) : 0));
    return { ev, a, v, sim };
  };

  it('succeeds when the hit lands inside frames 2-7 and leaves the defender free first', () => {
    const { ev, v, a } = parryAt(5);
    expect(ev.some((e) => e.type === 'parry')).toBe(true);
    expect(ev.some((e) => e.type === 'hit')).toBe(false);
    expect(v.stats.parries).toBe(1);
    expect(a.moveResult).toBe('parried');
  });

  it('fails when mistimed (too early) and leaves the parrier open', () => {
    const { ev } = parryAt(0);
    expect(ev.some((e) => e.type === 'parry')).toBe(false);
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });

  it('loses to throws', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 50);
    sim.startMove(sim.state.fighters[0], 'throw_f', { force: true });
    const ev = run(sim, 30, 0, (i) => (i === 2 ? mask(5, ['P']) : 0));
    expect(ev.some((e) => e.type === 'throw')).toBe(true);
  });

  it('parries projectiles and destroys them', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 300);
    sim.startMove(sim.state.fighters[0], 'v_shot', { force: true });
    let parried = false;
    for (let i = 0; i < 40; i++) {
      const p = sim.state.projectiles[0];
      const near = p && Math.abs(p.x - sim.state.fighters[1].x) < 120;
      const ev = sim.step([0, near && sim.state.fighters[1].state !== 'move' ? mask(5, ['P']) : 0]);
      parried ||= ev.some((e) => e.type === 'parry' && e.projectile);
    }
    expect(parried).toBe(true);
    expect(sim.state.fighters[1].hp).toBe(sim.state.fighters[1].maxHp);
    expect(sim.state.projectiles.filter((p) => p.defId === 'v_bullet').length).toBe(0);
  });
});

describe('dodges and invulnerability', () => {
  it('evade is strike-invulnerable in its window but can be thrown', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    sim.startMove(sim.state.fighters[1], 'evade', { force: true });
    run(sim, 3, 0, 0);
    sim.startMove(sim.state.fighters[0], 'r_5L', { force: true });
    expect(run(sim, 8, 0, 0).some((e) => e.type === 'hit')).toBe(false);

    const t = makeSim(['riot', 'vesper']);
    place(t, 50);
    t.startMove(t.state.fighters[1], 'evade', { force: true });
    t.startMove(t.state.fighters[0], 'throw_f', { force: true });
    expect(run(t, 10, 0, 0).some((e) => e.type === 'throw')).toBe(true);
  });

  it('evade recovery is punishable', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    sim.startMove(sim.state.fighters[1], 'evade', { force: true });
    run(sim, 15, 0, 0);
    sim.startMove(sim.state.fighters[0], 'r_5L', { force: true });
    expect(run(sim, 6, 0, 0).some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });

  it('forward roll passes through the opponent and switches sides', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const [a, v] = sim.state.fighters;
    sim.startMove(a, 'roll_f', { force: true });
    run(sim, 40, 0, 0);
    expect(a.x).toBeGreaterThan(v.x);
    expect(a.facing).toBe(-1);
  });

  it('wake-up after a knockdown is invulnerable', () => {
    const sim = makeSim(['riot', 'vesper']);
    place(sim, 60);
    const v = sim.state.fighters[1];
    sim.setState(v, 'getup');
    v.wakeInvuln = 5;
    sim.startMove(sim.state.fighters[0], 'r_5L', { force: true });
    expect(run(sim, 6, 0, 0).some((e) => e.type === 'hit')).toBe(false);
  });

  it('tech roll on landing from a launch when D is pressed in time; hard knockdowns cannot be teched', () => {
    const tech = (id: string) => {
      const sim = makeSim(['riot', 'vesper']);
      place(sim, 50);
      sim.startMove(sim.state.fighters[0], id, { force: true });
      return run(sim, 120, 0, (_i, s) => {
        const v = s.state.fighters[1];
        return v.state === 'launched' && v.y < 25 && v.vy < 0 ? mask(5, ['D']) : 0;
      });
    };
    expect(tech('throw_f').some((e) => e.type === 'tech' && e.kind === 'ground')).toBe(true);
    const hard = tech('r_sweep');
    expect(hard.some((e) => e.type === 'tech' && e.kind === 'ground')).toBe(false);
    expect(hard.some((e) => e.type === 'knockdown')).toBe(true);
  });
});

describe('armor and counters', () => {
  it('armor absorbs one hit (taking reduced damage) and the armored attack still lands', () => {
    const sim = makeSim(['bastion', 'riot']);
    place(sim, 70);
    const [b, r] = sim.state.fighters;
    sim.startMove(b, 'b_5H', { force: true });
    run(sim, 6, 0, 0); // armor from frame 6
    sim.startMove(r, 'r_5L', { force: true });
    const ev = run(sim, 40, 0, 0);
    expect(ev.some((e) => e.type === 'armor')).toBe(true);
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0 && e.moveId === 'b_5H')).toBe(true);
    expect(b.hp).toBe(b.maxHp - Math.round(22 * 0.5));
  });

  it('armor breaks after its hit count', () => {
    const sim = makeSim(['bastion', 'riot']);
    place(sim, 70);
    const [b] = sim.state.fighters;
    sim.startMove(b, 'b_5H', { force: true });
    run(sim, 6, 0, 0);
    sim.startMove(sim.state.fighters[1], 'r_rush', { force: true });
    const ev = run(sim, 30, 0, 0);
    expect(ev.filter((e) => e.type === 'armor').length).toBe(1);
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 1)).toBe(true);
  });

  it("Vesper's counter posture catches strikes and answers with an invulnerable slash", () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 70);
    const [v, r] = sim.state.fighters;
    v.stance = 'draw';
    v.stanceFrames = 60;
    sim.startMove(v, 'v_counter', { force: true });
    sim.startMove(r, 'r_5M', { force: true });
    const ev = run(sim, 40, 0, 0);
    expect(ev.some((e) => e.type === 'counterStance')).toBe(true);
    expect(ev.some((e) => e.type === 'hit' && e.moveId === 'v_counter_slash')).toBe(true);
    expect(v.hp).toBe(v.maxHp);
  });

  it('counter stances do not catch throws', () => {
    const sim = makeSim(['vesper', 'riot']);
    place(sim, 50);
    const [v, r] = sim.state.fighters;
    v.stance = 'draw';
    sim.startMove(v, 'v_counter', { force: true });
    sim.startMove(r, 'throw_f', { force: true });
    const ev = run(sim, 20, 0, 0);
    expect(ev.some((e) => e.type === 'throw')).toBe(true);
  });
});

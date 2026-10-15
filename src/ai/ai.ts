// CPU opponent. It reads the real move definitions (hitbox reach, startup, guard type, cancel
// rules, costs) and produces controller input like a human would. Difficulty only changes
// reaction delay and decision quality — never damage or physics.

import type { ButtonName } from '../core/input';
import { IN } from '../core/input';
import { rngNext } from '../core/math';
import { frameData } from '../combat/registry';
import type { Sim } from '../combat/sim';
import type { FighterState, MoveDef } from '../combat/types';

export interface Difficulty {
  name: string;
  reaction: number; // frames of perception delay
  accuracy: number; // chance to make the right defensive read
  aggression: number;
  comboSkill: number; // chance to continue a combo route
  techRate: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { name: 'Easy', reaction: 26, accuracy: 0.35, aggression: 0.35, comboSkill: 0.35, techRate: 0.15 },
  { name: 'Normal', reaction: 18, accuracy: 0.6, aggression: 0.55, comboSkill: 0.65, techRate: 0.45 },
  { name: 'Hard', reaction: 12, accuracy: 0.8, aggression: 0.7, comboSkill: 0.85, techRate: 0.75 },
  { name: 'Brutal', reaction: 8, accuracy: 0.92, aggression: 0.8, comboSkill: 0.97, techRate: 0.95 },
];

interface Obs {
  state: string;
  moveId: string | null;
  moveFrame: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  crouching: boolean;
}

interface MoveInfo {
  move: MoveDef;
  reachMin: number;
  reachMax: number;
  yMin: number;
  yMax: number;
  startup: number;
  total: number;
  damage: number;
  guard: string;
  launch: boolean;
  projectile: boolean;
  air: boolean;
}

/** Per-character tactical preferences (all referenced moves come from the character's data). */
const PROFILES: Record<string, { range: number; zoning: string[]; antiAir: string[]; reversal: string[]; approach: string[]; enders: string[] }> = {
  vesper: { range: 210, zoning: ['v_shot', 'v_5M'], antiAir: ['v_2H', 'v_dp'], reversal: ['v_dp'], approach: ['v_lunge', 'v_stance'], enders: ['v_lunge', 'v_shot'] },
  mirage: { range: 140, zoning: ['m_hook', 'm_decoy'], antiAir: ['m_5H'], reversal: [], approach: ['m_rush', 'm_2M', 'm_6M'], enders: ['m_rush', 'm_4H'] },
  solenne: { range: 330, zoning: ['s_fire', 's_spike', 's_bolt', 's_orb'], antiAir: ['s_2H'], reversal: ['s_wind'], approach: ['s_spike'], enders: ['s_spike', 's_bolt'] },
  bastion: { range: 160, zoning: ['b_piston', 'b_stomp', 'b_drone'], antiAir: ['b_2H', 'b_rocket'], reversal: ['b_rocket'], approach: ['b_crusher', 'b_5H'], enders: ['b_piston'] },
  riot: { range: 90, zoning: [], antiAir: ['r_4H', 'r_2H', 'r_dp'], reversal: ['r_dp'], approach: ['r_shoulder', 'r_6M', 'r_3M', 'r_flash'], enders: ['r_rush', 'r_shoulder'] },
};

export class AIController {
  diff: Difficulty;
  private hist: Obs[] = [];
  private rng: { seed: number };
  private plan: number[] = [];
  private hold = 0;
  private holdFrames = 0;
  private infos = new Map<string, MoveInfo>();
  private lastDecision = 0;
  private cooldown = 0;
  private zoneCooldown = 0;

  constructor(diff: Difficulty, seed = 99) {
    this.diff = diff;
    this.rng = { seed };
  }

  private r(): number {
    return rngNext(this.rng);
  }

  private info(m: MoveDef): MoveInfo {
    let i = this.infos.get(m.id);
    if (i) return i;
    let reachMin = Infinity;
    let reachMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let damage = 0;
    let guard = 'mid';
    let launch = false;
    let travel = 0;
    for (const v of m.vel ?? []) if (v.x && v.x > 0) travel += v.x * ((v.until ?? v.frame) - v.frame + 1);
    for (const h of m.hits ?? []) {
      damage += h.damage;
      if (h.guard !== 'mid') guard = h.guard;
      if (h.launch || h.knockback.y > 6) launch = true;
      for (const b of h.boxes) {
        reachMin = Math.min(reachMin, b.x);
        reachMax = Math.max(reachMax, b.x + b.w);
        yMin = Math.min(yMin, b.y);
        yMax = Math.max(yMax, b.y + b.h);
      }
    }
    if (m.throw) {
      reachMin = 0;
      reachMax = m.throw.box.x + m.throw.box.w;
      yMin = 0;
      yMax = 120;
      damage = 90;
    }
    const projectile = !!m.spawns?.length;
    if (projectile) {
      reachMin = 0;
      reachMax = 900;
      yMin = 0;
      yMax = 140;
      damage = 40;
    }
    if (reachMin === Infinity) {
      reachMin = 0;
      reachMax = 0;
      yMin = 0;
      yMax = 0;
    }
    const fd = frameData(m);
    i = { move: m, reachMin, reachMax: reachMax + travel * 0.6, yMin, yMax, startup: fd.startup, total: m.total, damage, guard, launch, projectile, air: m.stance === 'air' };
    this.infos.set(m.id, i);
    return i;
  }

  /** Converts a move command into an input mask for the current facing. */
  private press(f: FighterState, m: MoveDef): number {
    const c = m.cmd!;
    const digit = c.dir === '*' ? 5 : c.dir === 'd' ? 2 : c.dir === 'u' ? 8 : c.dir === 'f' ? 6 : c.dir === 'b' ? 4 : Number(c.dir);
    return this.maskFor(f, digit, [c.btn]);
  }

  private maskFor(f: FighterState, digit: number, buttons: ButtonName[]): number {
    let m = 0;
    const col = ((digit - 1) % 3) - 1;
    const row = Math.floor((digit - 1) / 3) - 1;
    const hx = col * f.facing;
    if (hx > 0) m |= IN.RIGHT;
    if (hx < 0) m |= IN.LEFT;
    if (row > 0) m |= IN.UP;
    if (row < 0) m |= IN.DOWN;
    for (const b of buttons) m |= IN[b];
    return m;
  }

  reset(): void {
    this.hist = [];
    this.plan = [];
    this.hold = 0;
    this.holdFrames = 0;
  }

  /** Can this move be started by input right now (resources, stance, ground/air)? */
  private usable(sim: Sim, f: FighterState, id: string): MoveDef | null {
    const m = sim.moveById(f, id);
    if (!m || !m.cmd) return null;
    if (m.cmd.stance && m.cmd.stance !== f.stance) return null;
    return sim.canStart(f, m) ? m : null;
  }

  private inRange(sim: Sim, f: FighterState, o: Obs, i: MoveInfo, slack = 0): boolean {
    if (i.projectile) return true;
    const dx = (o.x - f.x) * f.facing;
    const oc = sim.char(sim.opp(f));
    const front = dx - oc.width / 2;
    const back = dx + oc.width / 2;
    const dy = o.y - f.y;
    const oh = o.crouching ? oc.crouchHeight : oc.height;
    return back >= i.reachMin - slack && front <= i.reachMax + slack && dy + oh >= i.yMin && dy <= i.yMax;
  }

  private observe(sim: Sim, o: FighterState): Obs {
    return { state: o.state, moveId: o.moveId, moveFrame: o.moveFrame, x: o.x, y: o.y, vx: o.vx, vy: o.vy, grounded: o.grounded, crouching: o.crouching };
  }

  update(sim: Sim, idx: 0 | 1): number {
    const f = sim.state.fighters[idx];
    const opp = sim.opp(f);
    this.hist.push(this.observe(sim, opp));
    if (this.hist.length > 60) this.hist.shift();
    if (sim.state.round.phase !== 'fight') {
      this.plan = [];
      return 0;
    }
    // what the CPU "sees" is delayed by its reaction time
    const seen = this.hist[Math.max(0, this.hist.length - 1 - this.diff.reaction)];
    if (this.plan.length) return this.plan.shift()!;

    const d = this.diff;
    const c = sim.char(f);
    const prof = PROFILES[c.id] ?? PROFILES.riot;
    const away = f.x < opp.x ? IN.LEFT : IN.RIGHT;
    const toward = f.x < opp.x ? IN.RIGHT : IN.LEFT;

    // ---- being hit: DI, burst, tech
    if (f.state === 'launched' || f.state === 'hitstun' || f.state === 'crumple' || f.pendingKB) {
      let m = 0;
      if (this.r() < d.accuracy) m |= away | IN.UP; // survival DI: away and up
      if (f.combo.hits >= 4 && sim.canBurst(f) && this.r() < 0.04 + d.accuracy * 0.06) m |= IN.X;
      if (f.state === 'launched' && f.y < 40 && f.vy < 0 && this.r() < d.techRate) m |= IN.D;
      return m;
    }
    if (f.state === 'thrown') return this.r() < d.techRate * 0.25 ? IN.T : 0;
    if (f.state === 'blockstun') {
      const om = sim.move(opp);
      const low = om?.hits?.some((h) => h.guard === 'low' && opp.moveFrame <= h.frames[1]);
      let m = away | (low ? IN.DOWN : 0);
      if (f.combo.hits === 0 && sim.canBurst(f) && this.r() < 0.003) m |= IN.X;
      if (f.meter > 150 && this.r() < 0.02 * d.accuracy) m |= IN.P;
      return m;
    }

    // ---- combo continuation: our move hit, look for a cancel that reaches
    if (f.state === 'move' && (f.moveResult === 'hit' || f.moveResult === 'block')) {
      if (this.r() > d.comboSkill) return 0;
      const next = this.pickCancel(sim, f, seen, f.moveResult === 'hit');
      return next;
    }
    if (f.state === 'move' || f.state === 'jumpsquat' || f.state === 'landing' || f.state === 'getup' || f.state === 'knockdown' || f.state === 'techroll') return this.hold;

    if (this.cooldown > 0) {
      this.cooldown--;
      return this.hold;
    }

    const dist = Math.abs(opp.x - f.x);
    const seenMove = seen.moveId ? sim.moveById(opp, seen.moveId) : null;

    // ---- defense: react to a (perceived) incoming attack
    if (seenMove && seen.state === 'move' && seenMove.kind !== 'movement' && seenMove.kind !== 'defense') {
      const fd = frameData(seenMove);
      const threat = seenMove.hits?.length || seenMove.throw || seenMove.spawns?.length;
      const stillComing = seen.moveFrame <= fd.startup + fd.active;
      if (threat && stillComing && (dist < 320 || seenMove.spawns?.length)) {
        if (this.r() < d.accuracy) {
          if (seenMove.throw && dist < 140) {
            // throws beat blocking: jump or backdash
            if (this.r() < 0.5) return this.queue([this.maskFor(f, 7, [])], 8);
            return IN.D | away;
          }
          const r = this.r();
          if (r < 0.12 * d.accuracy && f.grounded) return IN.P; // parry read
          const reversal = prof.reversal.map((id) => this.usable(sim, f, id)).find((m) => m);
          if (r > 0.92 && reversal && dist < 160) return this.press(f, reversal);
          const low = seenMove.hits?.some((h) => h.guard === 'low');
          const high = seenMove.hits?.some((h) => h.guard === 'high');
          this.hold = away | (low && !high ? IN.DOWN : 0);
          this.holdFrames = 10;
          return this.hold;
        }
      }
    }

    // ---- projectiles heading our way: block (crouch for lows), jump over, or parry
    for (const p of sim.state.projectiles) {
      if (p.owner === f.idx || p.dead) continue;
      const def = sim.projDef(p.owner, p.defId);
      if (!def || def.inert) continue;
      const dx = f.x - p.x;
      const approaching = Math.sign(p.vx) === Math.sign(dx) || Math.abs(p.vx) < 0.5;
      const close = Math.abs(dx) < 90 + Math.abs(p.vx) * (d.reaction * 0.5 + 6) && Math.abs(p.y - (f.y + 60)) < 220;
      if (!approaching || !close || p.age < Math.min(d.reaction, 10)) continue;
      if (this.r() > d.accuracy + 0.15) break;
      const r = this.r();
      if (r < 0.08 * d.accuracy && f.grounded && def.parryable !== false) return IN.P;
      if (r > 0.9 && f.grounded && def.hit.guard !== 'low') return this.queue([this.maskFor(f, 8, [])], 4);
      this.hold = away | (def.hit.guard === 'low' ? IN.DOWN : 0);
      this.holdFrames = 12;
      return this.hold;
    }

    // ---- punish recovery
    if (seenMove && seen.state === 'move') {
      const fd = frameData(seenMove);
      const remaining = seenMove.total - seen.moveFrame - d.reaction;
      if (seen.moveFrame > fd.startup + fd.active && remaining > 4) {
        const best = this.bestStarter(sim, f, seen, remaining);
        if (best) return this.press(f, best.move);
      }
    }

    // ---- anti-air
    if (!seen.grounded && seen.vy < 2 && dist < 220 && seen.y < 220 && seen.state !== 'launched' && this.r() < d.accuracy) {
      for (const id of prof.antiAir) {
        const m = this.usable(sim, f, id);
        if (m && this.inRange(sim, f, { ...seen, y: Math.max(0, seen.y - 40) }, this.info(m), 30)) return this.press(f, m);
      }
    }

    // ---- character specific resource management
    if (c.id === 'vesper' && f.resources.ammo <= 1 && dist > 380) {
      const m = this.usable(sim, f, 'v_reload');
      if (m) return this.press(f, m);
    }
    if (c.id === 'solenne' && f.resources.mana < 20 && dist > 450) {
      const m = this.usable(sim, f, 's_channel');
      if (m) return this.queue(Array(40).fill(this.press(f, m)), 1);
    }
    if (c.id === 'riot' && f.meter >= 100 && !f.install && dist < 400 && this.r() < 0.02) {
      const m = this.usable(sim, f, 'r_overdrive');
      if (m) return this.press(f, m);
    }
    if (c.id === 'mirage' && dist > 300 && this.r() < 0.02) {
      const m = this.usable(sim, f, 'm_anchor');
      if (m) return this.press(f, m);
    }

    // ---- offense: attack if something reaches
    if (this.r() < d.aggression * 0.35) {
      const best = this.bestStarter(sim, f, this.observe(sim, opp), 99);
      if (best && (best.reachMax < 300 || this.r() < 0.4)) {
        // occasionally throw a close, blocking opponent
        if (dist < 90 && this.r() < 0.25 && f.grounded) return IN.T | (this.r() < 0.5 ? away : 0);
        // mix-ups: overhead / low
        return this.press(f, best.move);
      }
    }

    // ---- zoning at range (with a cooldown so the CPU also moves and fights up close)
    if (this.zoneCooldown > 0) this.zoneCooldown--;
    if (dist > 260 && prof.zoning.length && this.zoneCooldown === 0 && this.r() < 0.05 + d.aggression * 0.04) {
      for (const id of prof.zoning) {
        const m = this.usable(sim, f, id);
        if (m && (this.info(m).projectile || this.inRange(sim, f, this.observe(sim, opp), this.info(m)))) {
          this.zoneCooldown = 45 + Math.floor(this.r() * 60);
          return this.press(f, m);
        }
      }
    }
    // being zoned out: close the distance through the air
    const incoming = sim.state.projectiles.some((p) => p.owner !== f.idx && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 400);
    if (incoming && dist > 300 && f.grounded && this.r() < 0.04 * (0.5 + d.aggression)) {
      if (c.flight && f.resources.fuel > 50) return this.queue([this.maskFor(f, 9, []), this.maskFor(f, 9, []), this.maskFor(f, 9, ['D'])], 3);
      return this.queue([this.maskFor(f, 9, [])], 4);
    }

    // ---- super when the opponent is in range and we have meter
    if (f.meter >= 100 && this.r() < 0.01 * d.aggression) {
      const supers = [...sim.cdata(f).moves.values()].filter((m) => m.kind === 'super' && m.cmd && sim.canStart(f, m) && !m.install);
      const s = supers.find((m) => this.inRange(sim, f, this.observe(sim, opp), this.info(m)));
      if (s) return this.press(f, s);
    }

    // ---- movement / spacing
    if (f.flying) {
      // Bastion flight: drift toward the opponent and land
      if (f.resources.fuel < 20 || this.r() < 0.05) return IN.D;
      return toward | IN.DOWN;
    }
    if (!f.grounded) {
      // air: attack on the way down if in range
      for (const m of sim.cdata(f).moves.values()) {
        if (!m.cmd?.air || m.kind !== 'normal' || !sim.canStart(f, m)) continue;
        if (this.inRange(sim, f, this.observe(sim, opp), this.info(m)) && f.vy < 3) return this.press(f, m);
      }
      return toward;
    }
    const want = prof.range;
    this.holdFrames--;
    if (this.holdFrames > 0) return this.hold;
    const r = this.r();
    if (dist > want + 80) {
      if (r < 0.06 * (0.5 + d.aggression)) return this.queue([toward], 2, IN.D | toward);
      if (r < 0.1 && c.id === 'bastion' && f.resources.fuel > 60) return this.queue([this.maskFor(f, 9, [])], 6);
      if (r < 0.06) return this.queue([this.maskFor(f, 9, [])], 3);
      this.hold = toward;
    } else if (dist < want - 60) {
      this.hold = r < 0.5 ? away : 0;
      if (r < 0.04) return IN.D | away;
    } else {
      this.hold = r < 0.3 ? (r < 0.12 ? IN.DOWN | away : away) : r < 0.6 ? toward : 0;
      if (r > 0.97) return this.queue([this.maskFor(f, 9, [])], 3);
    }
    this.holdFrames = 8 + Math.floor(this.r() * 14);
    return this.hold;
  }

  private queue(masks: number[], repeat: number, first?: number): number {
    this.plan = [];
    for (const m of masks) for (let i = 0; i < repeat; i++) this.plan.push(m);
    const out = first ?? this.plan.shift() ?? 0;
    this.cooldown = 4;
    return out;
  }

  /** Best attack that would connect within `maxStartup` frames. */
  private bestStarter(sim: Sim, f: FighterState, o: Obs, maxStartup: number): MoveInfo | null {
    let best: MoveInfo | null = null;
    let bestScore = -Infinity;
    const air = !f.grounded;
    for (const m of sim.cdata(f).moves.values()) {
      if (!m.cmd || m.hidden || m.kind === 'defense' || m.kind === 'movement' || m.kind === 'throw') continue;
      if (!!m.cmd.air !== air) continue;
      if (m.kind === 'super' && f.meter < 100) continue;
      if (m.cmd.stance && m.cmd.stance !== f.stance) continue;
      if (!sim.canStart(f, m)) continue;
      const i = this.info(m);
      if (i.projectile || !i.damage) continue;
      if (i.startup > maxStartup) continue;
      if (!this.inRange(sim, f, o, i)) continue;
      let score = i.damage / 10 - i.startup * 0.8 + (i.launch ? 4 : 0) - (m.kind === 'super' ? 6 : 0);
      if (o.crouching && i.guard === 'high') score += 3;
      if (!o.crouching && i.guard === 'low') score += 2;
      score += this.r() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** Picks the next move in a combo using the current move's actual cancel rules. */
  private pickCancel(sim: Sim, f: FighterState, o: Obs, hit: boolean): number {
    const cur = sim.move(f);
    if (!cur) return 0;
    // jump cancel launchers to chase in the air
    if (hit && cur.cancels?.onHit?.includes('jump') && f.grounded && this.r() < 0.7) {
      const opp = sim.opp(f);
      if (opp.state === 'launched') return this.maskFor(f, 9, []);
    }
    const opts = sim.cancelOptions(f);
    let best: MoveDef | null = null;
    let bestScore = -Infinity;
    for (const m of opts) {
      if (m.kind === 'super' && (!hit || this.r() > 0.5)) continue;
      const i = this.info(m);
      if (!i.projectile && !this.inRange(sim, f, this.observe(sim, sim.opp(f)), i, 10)) continue;
      if (!hit && m.kind !== 'special') continue;
      let score = i.damage / 10 - i.startup * 0.5 + (i.launch ? 3 : 0) + this.r() * 3;
      if (m.kind === 'super') score += 8;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best ? this.press(f, best) : 0;
  }
}

// The deterministic combat simulation. One call to step() advances exactly one 1/60s frame.
// All mutable state lives in `state` as plain data so it can be snapshotted for replays,
// rewinding and (in the future) rollback networking.

import { BUTTON_PRIORITY, IN, commandDir, consume, dirMatches, dirVector, feedInput, held, newInputBuffer, numpadDir, pressed, type ButtonName } from '../core/input';
import { boxesOverlap, clamp, overlapCenter, q, rngNext, sign, type Box } from '../core/math';
import { CFG } from './config';
import { charData, type CharData } from './registry';
import type {
  CancelTag,
  CombatEvent,
  ComboState,
  FighterState,
  HitDef,
  LocalBox,
  MoveDef,
  ProjectileDef,
  ProjectileState,
  SpawnEvent,
} from './types';

export type AutoBlock = 'none' | 'all' | 'random';

export interface SimSettings {
  training: boolean;
  infiniteHp: [boolean, boolean];
  infiniteMeter: [boolean, boolean];
  infiniteBurst: [boolean, boolean];
  infiniteResources: [boolean, boolean];
  noTimer: boolean;
  autoBlock: [AutoBlock, AutoBlock];
}

export interface RoundState {
  phase: 'intro' | 'fight' | 'ko' | 'over';
  phaseFrames: number;
  timer: number;
  number: number;
  wins: [number, number];
  winner: number; // -1 none / draw
  matchWinner: number;
}

export interface AdvantageTracker {
  att: number;
  def: number;
  attReady: number;
  defReady: number;
}

export interface SimState {
  frame: number;
  fighters: [FighterState, FighterState];
  projectiles: ProjectileState[];
  nextProjId: number;
  rng: { seed: number };
  round: RoundState;
  superFreeze: { frames: number; owner: number } | null;
  settings: SimSettings;
  adv: AdvantageTracker | null;
}

export interface SimOptions {
  chars: [string, string];
  seed?: number;
  settings?: Partial<SimSettings>;
}

interface ActiveHit {
  idx: number;
  hit: HitDef;
  boxes: Box[];
}

interface PendingStrike {
  att: FighterState;
  def: FighterState;
  hit: HitDef;
  hitIdx: number;
  moveId: string;
  move: MoveDef;
  box: Box;
  hurt: Box;
}

const ACTIONABLE = new Set(['idle', 'walk', 'run', 'crouch', 'air']);
const BLOCK_STATES = new Set(['idle', 'walk', 'crouch', 'blockstun', 'landing', 'air', 'run']);
const STUNNED = new Set(['hitstun', 'launched', 'crumple', 'thrown']);

export function defaultSettings(): SimSettings {
  return {
    training: false,
    infiniteHp: [false, false],
    infiniteMeter: [false, false],
    infiniteBurst: [false, false],
    infiniteResources: [false, false],
    noTimer: false,
    autoBlock: ['none', 'none'],
  };
}

export function newCombo(): ComboState {
  return {
    hits: 0,
    damage: 0,
    scale: 1,
    frames: 0,
    wallBounces: 0,
    groundBounces: 0,
    otgUsed: false,
    moveCounts: {},
    route: [],
    projectileHits: 0,
    cancels: 0,
    bursted: false,
    startScale: 1,
    lastHitDamage: 0,
  };
}

const STRENGTH_RANK: Record<string, number> = { L: 1, M: 2, H: 3, S: 4, X: 5 };
const DEFAULT_PRIORITY: Record<string, number> = { L: 1, M: 2, H: 3, S: 3, X: 6 };

export class Sim {
  state: SimState;
  events: CombatEvent[] = [];
  readonly charIds: [string, string];
  private data: [CharData, CharData];

  constructor(opts: SimOptions) {
    this.charIds = opts.chars;
    this.data = [charData(opts.chars[0]), charData(opts.chars[1])];
    const settings = { ...defaultSettings(), ...(opts.settings ?? {}) };
    this.state = {
      frame: 0,
      fighters: [this.newFighter(0), this.newFighter(1)],
      projectiles: [],
      nextProjId: 1,
      rng: { seed: opts.seed ?? 12345 },
      round: { phase: settings.training ? 'fight' : 'intro', phaseFrames: 0, timer: CFG.roundFrames, number: 1, wins: [0, 0], winner: -1, matchWinner: -1 },
      superFreeze: null,
      settings,
      adv: null,
    };
  }

  // ---------------------------------------------------------------- setup

  private newFighter(idx: 0 | 1): FighterState {
    const c = this.data[idx].def;
    const resources: Record<string, number> = {};
    for (const r of c.resources) resources[r.name] = r.start;
    const mid = (CFG.stage.left + CFG.stage.right) / 2;
    return {
      idx,
      charId: c.id,
      x: mid + (idx === 0 ? -170 : 170),
      y: 0,
      vx: 0,
      vy: 0,
      facing: idx === 0 ? 1 : -1,
      state: 'idle',
      stateFrame: 0,
      grounded: true,
      crouching: false,
      hp: c.maxHp,
      maxHp: c.maxHp,
      meter: 0,
      burst: CFG.burst.max,
      airOptions: c.maxAirOptions,
      feints: CFG.feint.max,
      feintRegen: 0,
      resources,
      install: null,
      stance: null,
      stanceFrames: 0,
      moveId: null,
      moveFrame: 0,
      moveHits: [],
      moveHitFrame: [],
      moveResult: 'none',
      moveCharge: 0,
      moveArmorHits: 0,
      canceledFrom: null,
      hitstun: 0,
      blockstun: 0,
      hitstop: 0,
      landingLag: 0,
      knockdownFrames: 0,
      wakeInvuln: 0,
      airRecoverInvuln: 0,
      pendingKB: null,
      hardKnockdown: false,
      pendingGroundBounce: false,
      pendingWallBounce: false,
      lastHitDI: 1,
      counterHit: false,
      grabbedBy: -1,
      grabHold: { x: 0, y: 0 },
      grabTechable: false,
      throwTechWindow: 0,
      combo: newCombo(),
      flying: false,
      fastFalling: false,
      helpless: false,
      driftAccum: 0,
      unburstable: false,
      neutralFrames: 0,
      jumpHeld: false,
      burstPunishable: 0,
      lastDI: null,
      input: newInputBuffer(),
      advantage: null,
      wallTouch: 0,
      lastDamageTaken: 0,
      stats: { hitsLanded: 0, damageDealt: 0, supers: 0, bursts: 0, parries: 0, techs: 0 },
    };
  }

  /** Resets positions/resources for a new round (keeps win counts). */
  resetRound(): void {
    const r = this.state.round;
    this.state.fighters = [this.newFighter(0), this.newFighter(1)];
    this.state.projectiles = [];
    this.state.superFreeze = null;
    this.state.adv = null;
    r.phase = this.state.settings.training ? 'fight' : 'intro';
    r.phaseFrames = 0;
    r.timer = CFG.roundFrames;
    r.winner = -1;
  }

  /** Full match reset. */
  resetMatch(): void {
    this.state.round = { phase: 'intro', phaseFrames: 0, timer: CFG.roundFrames, number: 1, wins: [0, 0], winner: -1, matchWinner: -1 };
    this.state.frame = 0;
    this.resetRound();
  }

  /** Training reset: place fighters at a position preset. */
  resetPositions(preset: 'center' | 'leftCorner' | 'rightCorner' | 'swap' = 'center'): void {
    const keepSettings = this.state.settings;
    this.resetRound();
    this.state.settings = keepSettings;
    const [a, b] = this.state.fighters;
    const L = CFG.stage.left;
    const R = CFG.stage.right;
    if (preset === 'leftCorner') {
      a.x = L + 160;
      b.x = L + 40;
    } else if (preset === 'rightCorner') {
      a.x = R - 160;
      b.x = R - 40;
    } else if (preset === 'swap') {
      const t = a.x;
      a.x = b.x;
      b.x = t;
    }
    a.facing = a.x < b.x ? 1 : -1;
    b.facing = (-a.facing) as 1 | -1;
  }

  snapshot(): SimState {
    return structuredClone(this.state);
  }

  restore(s: SimState): void {
    this.state = structuredClone(s);
  }

  // ---------------------------------------------------------------- accessors

  char(f: FighterState) {
    return this.data[f.idx].def;
  }
  cdata(f: FighterState): CharData {
    return this.data[f.idx];
  }
  opp(f: FighterState): FighterState {
    return this.state.fighters[f.idx === 0 ? 1 : 0];
  }
  move(f: FighterState): MoveDef | null {
    return f.moveId ? this.data[f.idx].moves.get(f.moveId) ?? null : null;
  }
  moveById(f: FighterState, id: string): MoveDef | undefined {
    return this.data[f.idx].moves.get(id);
  }
  projDef(owner: number, id: string): ProjectileDef | undefined {
    return this.data[owner].projectiles.get(id) ?? this.data[owner === 0 ? 1 : 0].projectiles.get(id);
  }
  emit(e: CombatEvent): void {
    this.events.push(e);
  }
  rand(): number {
    return rngNext(this.state.rng);
  }

  isActionable(f: FighterState): boolean {
    if (f.state === 'air') return !f.helpless;
    return ACTIONABLE.has(f.state);
  }

  // ---------------------------------------------------------------- main step

  step(inputs: [number, number]): CombatEvent[] {
    this.events = [];
    const s = this.state;
    s.frame++;
    const r = s.round;
    r.phaseFrames++;
    const live = r.phase === 'fight';
    for (const f of s.fighters) feedInput(f.input, live ? inputs[f.idx] : 0);

    if (r.phase === 'intro' && r.phaseFrames >= CFG.introFrames) {
      r.phase = 'fight';
      r.phaseFrames = 0;
      this.emit({ type: 'round', frame: s.frame, phase: 'fight', winner: -1 });
    }

    if (s.superFreeze) {
      s.superFreeze.frames--;
      if (s.superFreeze.frames <= 0) s.superFreeze = null;
      return this.events;
    }

    for (const f of s.fighters) {
      this.checkBurst(f);
      if (f.hitstop > 0) {
        f.hitstop--;
        if (f.hitstop === 0 && f.pendingKB) this.applyKnockback(f);
        continue;
      }
      if (f.pendingKB) this.applyKnockback(f);
      this.updateFighter(f);
    }
    for (const f of s.fighters) this.positionThrown(f);
    this.updateProjectiles();
    this.resolveBodies();
    this.resolveCollisions();
    for (const f of s.fighters) this.positionThrown(f);
    this.updateFacing();
    this.updateCombos();
    this.trackAdvantage();
    this.updateRound();
    return this.events;
  }

  // ---------------------------------------------------------------- fighter update

  private updateFighter(f: FighterState): void {
    const c = this.char(f);
    const st = this.state.settings;
    f.stateFrame++;
    if (f.wakeInvuln > 0) f.wakeInvuln--;
    if (f.airRecoverInvuln > 0) f.airRecoverInvuln--;
    if (f.burstPunishable > 0) f.burstPunishable--;
    if (f.throwTechWindow > 0 && f.state !== 'thrown') f.throwTechWindow = 0;

    // resource regeneration
    if (f.feints < CFG.feint.max) {
      if (++f.feintRegen >= CFG.feint.regenFrames) {
        f.feints++;
        f.feintRegen = 0;
      }
    } else f.feintRegen = 0;
    f.burst = Math.min(CFG.burst.max, f.burst + CFG.burst.regenPerFrame);
    for (const rd of c.resources) {
      let v = f.resources[rd.name] + (rd.regen ?? 0) + (f.grounded ? rd.groundRegen ?? 0 : 0);
      f.resources[rd.name] = clamp(v, 0, rd.max);
    }
    if (st.infiniteMeter[f.idx]) f.meter = CFG.meter.max;
    if (st.infiniteBurst[f.idx]) f.burst = CFG.burst.max;
    if (st.infiniteResources[f.idx]) for (const rd of c.resources) f.resources[rd.name] = rd.max;

    if (f.install) {
      f.install.frames--;
      f.meter = Math.max(0, f.meter - f.install.drain);
      if (f.install.frames <= 0 || f.meter <= 0) {
        f.install = null;
        this.emit({ type: 'install', frame: this.state.frame, fighter: f.idx, on: false });
      }
    }
    if (f.stance) {
      f.stanceFrames--;
      if (f.stanceFrames <= 0 || (f.state !== 'idle' && f.state !== 'move' && f.state !== 'crouch')) f.stance = null;
    }
    c.onUpdate?.(this, f);

    switch (f.state) {
      case 'idle':
      case 'walk':
      case 'run':
      case 'crouch':
        this.groundNeutral(f);
        break;
      case 'jumpsquat':
        if (f.stateFrame >= 4) this.launchJump(f);
        break;
      case 'air':
        this.airNeutral(f);
        break;
      case 'landing':
        if (f.landingLag <= 0) this.resume(f);
        else f.landingLag--;
        break;
      case 'dash':
        this.updateDash(f);
        break;
      case 'backdash':
        if (f.stateFrame >= c.backdashFrames) this.resume(f);
        break;
      case 'airdash':
        this.updateAirdash(f);
        break;
      case 'move':
        this.advanceMove(f);
        break;
      case 'blockstun':
        if (pressed(f.input, 'P') && f.meter >= CFG.block.pushblockCost && f.grounded) {
          consume(f.input, 'P');
          f.blockstun = 0;
          this.startMove(f, 'pushblock', { force: true });
          break;
        }
        if (f.blockstun <= 0) this.resume(f);
        else f.blockstun--;
        break;
      case 'hitstun':
        if (f.hitstun <= 0) this.resume(f);
        else f.hitstun--;
        break;
      case 'crumple':
        if (--f.hitstun <= 0) this.knockDown(f, false);
        break;
      case 'launched':
        this.updateLaunched(f);
        break;
      case 'knockdown':
        if (this.state.round.phase === 'ko' && f.hp <= 0) break;
        if (--f.knockdownFrames <= 0) this.setState(f, 'getup');
        break;
      case 'getup':
        f.wakeInvuln = 2;
        if (f.stateFrame >= CFG.knockdown.getupFrames) {
          f.wakeInvuln = 4;
          this.resume(f);
        }
        break;
      case 'techroll':
        f.wakeInvuln = 2;
        if (f.stateFrame >= CFG.knockdown.techRollFrames) {
          f.vx = 0;
          this.resume(f);
        }
        break;
      case 'thrown':
        if (f.throwTechWindow > 0) {
          f.throwTechWindow--;
          if (pressed(f.input, 'T') && f.grabTechable) {
            consume(f.input, 'T');
            this.throwTech(this.opp(f), f);
          }
        }
        break;
      case 'throwtech':
        if (f.stateFrame >= CFG.throwTech.stun) this.resume(f);
        break;
      case 'ko':
      case 'win':
        break;
    }
    this.physics(f);
  }

  setState(f: FighterState, s: FighterState['state']): void {
    f.state = s;
    f.stateFrame = 0;
    if (s !== 'move') {
      f.moveId = null;
      f.moveFrame = 0;
    }
  }

  toNeutral(f: FighterState): void {
    f.helpless = false;
    if (f.y > 0.01) {
      this.setState(f, 'air');
      f.grounded = false;
    } else {
      f.grounded = true;
      this.setState(f, f.input.cur & IN.DOWN ? 'crouch' : 'idle');
    }
  }

  private groundNeutral(f: FighterState): void {
    const c = this.char(f);
    const inp = f.input;
    if (this.tryActions(f, null, null)) return;
    const d = numpadDir(inp.cur, f.facing);
    const spd = c.speedMult ? c.speedMult(f) : 1;
    if (inp.doubleTap) {
      const fwd = (inp.doubleTap === 6 ? 1 : -1) === f.facing;
      if (fwd) this.startDash(f);
      else this.startBackdash(f);
      return;
    }
    if (d >= 7) {
      this.setState(f, 'jumpsquat');
      f.vx *= 0.5;
      return;
    }
    f.crouching = d <= 3;
    if (f.crouching) {
      if (f.state !== 'crouch') this.setState(f, 'crouch');
      return;
    }
    if (d === 6) {
      if (f.state === 'run') {
        f.vx = c.runSpeed * spd * f.facing;
        return;
      }
      if (f.state !== 'walk') this.setState(f, 'walk');
      f.vx = c.walkSpeed * spd * f.facing;
    } else if (d === 4) {
      if (f.state !== 'walk') this.setState(f, 'walk');
      f.vx = -c.backWalkSpeed * spd * f.facing;
    } else if (f.state !== 'idle') {
      this.setState(f, 'idle');
    }
  }

  private launchJump(f: FighterState): void {
    const c = this.char(f);
    const d = numpadDir(f.input.cur, f.facing);
    const full = (f.input.cur & IN.UP) !== 0;
    f.vy = full ? c.jumpVel : c.shortHopVel;
    const hx = d === 9 ? 1 : d === 7 ? -1 : 0;
    const spd = c.speedMult ? c.speedMult(f) : 1;
    // Running jumps keep extra momentum.
    const carry = Math.abs(f.vx) > c.jumpHSpeed ? f.vx * 0.8 : 0;
    f.vx = carry && sign(carry) === hx * f.facing ? carry : hx * c.jumpHSpeed * spd * f.facing;
    f.grounded = false;
    f.jumpHeld = full;
    this.setState(f, 'air');
    this.emit({ type: 'jump', frame: this.state.frame, fighter: f.idx, air: false, x: f.x, y: f.y });
  }

  private airNeutral(f: FighterState): void {
    const c = this.char(f);
    const inp = f.input;
    if (f.helpless) return;
    if (this.tryActions(f, null, null)) return;
    const upEdge = (inp.cur & IN.UP) !== 0 && (inp.prev & IN.UP) === 0;
    // variable jump height: releasing up while rising cuts the jump
    if (f.jumpHeld && !(inp.cur & IN.UP)) {
      f.jumpHeld = false;
      if (f.vy > 2) f.vy *= 0.55;
    }
    if (upEdge && c.wallJump && f.wallTouch !== 0) {
      f.vx = -f.wallTouch * 7.5;
      f.vy = c.jumpVel * 0.92;
      f.facing = (-f.wallTouch) as 1 | -1;
      f.jumpHeld = true;
      this.emit({ type: 'jump', frame: this.state.frame, fighter: f.idx, air: true, x: f.x, y: f.y });
      return;
    }
    if (upEdge && f.airOptions > 0 && !f.flying) {
      f.airOptions--;
      const v = dirVector(inp.cur);
      f.vy = c.doubleJumpVel;
      f.vx = v.x * c.jumpHSpeed * 1.05;
      f.jumpHeld = true;
      f.fastFalling = false;
      this.emit({ type: 'jump', frame: this.state.frame, fighter: f.idx, air: true, x: f.x, y: f.y });
      return;
    }
    if (f.flying) {
      this.updateFlight(f);
      return;
    }
    if ((inp.cur & IN.DOWN) && !(inp.prev & IN.DOWN) && f.vy < 3) f.fastFalling = true;
    const v = dirVector(inp.cur);
    const spd = c.speedMult ? c.speedMult(f) : 1;
    if (v.x !== 0) {
      const max = c.airMaxSpeed * spd;
      const nv = f.vx + sign(v.x) * c.airAccel;
      if (Math.abs(nv) <= max || Math.abs(nv) < Math.abs(f.vx)) f.vx = nv;
      else if (Math.abs(f.vx) < max) f.vx = sign(v.x) * max;
    }
  }

  private updateFlight(f: FighterState): void {
    const c = this.char(f);
    const fl = c.flight!;
    const v = dirVector(f.input.cur);
    f.resources[fl.resource] -= fl.drain;
    if (v.x !== 0 || v.y !== 0) {
      f.vx += v.x * fl.accel;
      f.vy += v.y * fl.accel;
      f.resources[fl.resource] -= fl.drain * 0.5;
    } else {
      f.vx *= fl.brake;
      f.vy *= fl.brake;
    }
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > fl.maxSpeed) {
      f.vx *= fl.maxSpeed / sp;
      f.vy *= fl.maxSpeed / sp;
    }
    if (f.resources[fl.resource] <= 0) {
      f.resources[fl.resource] = 0;
      this.endFlight(f);
    }
  }

  endFlight(f: FighterState): void {
    if (!f.flying) return;
    f.flying = false;
    this.emit({ type: 'flight', frame: this.state.frame, fighter: f.idx, on: false });
  }

  private startDash(f: FighterState): void {
    const c = this.char(f);
    this.setState(f, 'dash');
    const spd = c.speedMult ? c.speedMult(f) : 1;
    f.vx = c.dashSpeed * spd * f.facing;
    this.emit({ type: 'dash', frame: this.state.frame, fighter: f.idx, kind: 'dash', x: f.x, y: f.y, dir: f.facing });
  }

  private startBackdash(f: FighterState): void {
    const c = this.char(f);
    this.setState(f, 'backdash');
    f.vx = -c.backdashSpeed * f.facing;
    f.vy = 2.2;
    f.y = 0.01;
    f.grounded = false;
    this.emit({ type: 'dash', frame: this.state.frame, fighter: f.idx, kind: 'backdash', x: f.x, y: f.y, dir: -f.facing });
  }

  private updateDash(f: FighterState): void {
    const c = this.char(f);
    // dash attacks / jump cancels after a few frames
    if (f.stateFrame >= 3 && this.tryActions(f, ['any', 'super', 'jump'], null)) return;
    if (f.stateFrame >= c.dashFrames) {
      const d = numpadDir(f.input.cur, f.facing);
      if (d === 6) {
        this.setState(f, 'run');
        f.vx = c.runSpeed * f.facing;
      } else this.resume(f);
    }
  }

  private startAirdash(f: FighterState, d: number): void {
    const c = this.char(f);
    f.airOptions--;
    const dx = d === 5 ? 1 : ((d - 1) % 3) - 1;
    const dy = d === 5 ? 0 : Math.floor((d - 1) / 3) - 1;
    const len = Math.hypot(dx, dy) || 1;
    f.vx = (dx / len) * c.airDashSpeed * f.facing;
    f.vy = (dy / len) * c.airDashSpeed * (dy > 0 ? 0.85 : 1);
    if (dx < 0 && dy === 0) f.vx *= 0.85;
    f.fastFalling = false;
    this.setState(f, 'airdash');
    this.emit({ type: 'dash', frame: this.state.frame, fighter: f.idx, kind: 'airdash', x: f.x, y: f.y, dir: sign(f.vx) || f.facing });
  }

  private updateAirdash(f: FighterState): void {
    const c = this.char(f);
    if (f.stateFrame >= 5 && this.tryActions(f, ['any', 'super'], null)) return;
    if (f.stateFrame >= c.airDashFrames) {
      f.vx *= 0.75;
      f.vy *= 0.5;
      this.setState(f, 'air');
    }
  }

  private updateLaunched(f: FighterState): void {
    f.hitstun--;
    // limited drift DI while tumbling
    const v = dirVector(f.input.cur);
    if (v.x !== 0 && Math.abs(f.driftAccum + v.x * CFG.di.driftAccel) <= CFG.di.driftMax) {
      f.driftAccum += v.x * CFG.di.driftAccel;
      f.vx += v.x * CFG.di.driftAccel;
    }
    if (f.hitstun <= 0 && !f.grounded && f.hp > 0) {
      // air recovery: regain control with a brief strike invulnerability
      this.setState(f, 'air');
      f.airRecoverInvuln = CFG.knockdown.airRecoverInvuln;
      f.pendingGroundBounce = false;
      f.pendingWallBounce = false;
      this.emit({ type: 'tech', frame: this.state.frame, fighter: f.idx, kind: 'air' });
    }
  }

  // ---------------------------------------------------------------- actions & moves

  /** Finds the move a button press maps to given the current direction, air state and stance. */
  resolveMove(f: FighterState, btn: ButtonName, air: boolean): MoveDef | null {
    const cd = this.cdata(f);
    const d = numpadDir(commandDir(f.input, btn), f.facing);
    for (const cmd of cd.commands) {
      if (cmd.btn !== btn || cmd.air !== air) continue;
      if (cmd.stance && cmd.stance !== f.stance) continue;
      if (!dirMatches(cmd.dir, d)) continue;
      let m = cmd.move;
      if (f.install && m.enhanced) m = cd.moves.get(m.enhanced) ?? m;
      if (!this.canStart(f, m)) continue;
      return m;
    }
    return null;
  }

  canStart(f: FighterState, m: MoveDef): boolean {
    const air = !f.grounded;
    if (m.stance === 'air' && !air) return false;
    if (m.stance === 'ground' && air) return false;
    const rq = m.requires;
    if (rq) {
      if (rq.resource) for (const k in rq.resource) if ((f.resources[k] ?? 0) < rq.resource[k]) return false;
      if (rq.stance !== undefined && rq.stance !== f.stance) return false;
      if (rq.install && !f.install) return false;
      if (rq.noInstall && f.install) return false;
      if (rq.object && !this.state.projectiles.some((p) => p.owner === f.idx && p.defId === rq.object && !p.dead)) return false;
      if (rq.noObject && this.state.projectiles.some((p) => p.owner === f.idx && p.defId === rq.noObject && !p.dead)) return false;
      if (rq.minHeight && f.y < rq.minHeight) return false;
    }
    const cost = m.cost;
    if (cost) {
      if (cost.meter && f.meter < cost.meter) return false;
      if (cost.resource) for (const k in cost.resource) if ((f.resources[k] ?? 0) < cost.resource[k]) return false;
      if (cost.airOption && f.airOptions < cost.airOption) return false;
      if (cost.feint && f.feints < cost.feint) return false;
    }
    return true;
  }

  private cancelAllowed(tags: CancelTag[], from: MoveDef | null, cand: MoveDef, f?: FighterState): boolean {
    for (const t of tags) {
      if (t === 'any' && cand.kind !== 'super' && cand.kind !== 'system') return true;
      if (t === 'special' && cand.kind === 'special') return true;
      if (t === 'super' && cand.kind === 'super') return true;
      if (t === 'stance' && cand.cmd?.stance) return true;
      if (t === 'chain' && from && (cand.kind === 'normal' || cand.kind === 'command')) {
        const a = STRENGTH_RANK[from.strength ?? 'M'];
        const b = STRENGTH_RANK[cand.strength ?? 'M'];
        if (b > a) return true;
        // light-into-light chains are limited per combo so jab loops cannot go on forever
        if (a === 1 && b === 1 && (!f || (this.opp(f).combo.moveCounts[cand.id] ?? 0) < CFG.combo.maxLightChain)) return true;
      }
      if (t.startsWith('#') && cand.id === t.slice(1)) return true;
    }
    return false;
  }

  /**
   * Attempts to start an action from buffered input. `tags` null means neutral (everything allowed).
   * Returns true when something started.
   */
  private tryActions(f: FighterState, tags: CancelTag[] | null, from: MoveDef | null, feint = false): boolean {
    const inp = f.input;
    const air = !f.grounded;
    const c = this.char(f);
    for (const btn of BUTTON_PRIORITY) {
      if (!pressed(inp, btn)) continue;
      if (btn === 'D') {
        const d = numpadDir(commandDir(inp, 'D'), f.facing);
        if (f.stance) {
          const sm = this.resolveMove(f, 'D', air);
          if (sm?.cmd?.stance && (!tags || this.cancelAllowed(tags, from, sm, f))) {
            consume(inp, 'D');
            this.startMove(f, sm.id, { canceled: !!from, feint });
            return true;
          }
        }
        if (!air) {
          if (d === 1 || d === 2 || d === 3) {
            const m = this.resolveMove(f, 'D', false);
            if (!m || (tags && !tags.includes('dash') && !this.cancelAllowed(tags, from, m, f))) continue;
            consume(inp, 'D');
            if (from) this.noteCancel(f, from, m.id);
            this.startMove(f, m.id, { canceled: !!from, feint });
            return true;
          }
          if (tags && !tags.includes('dash')) continue;
          consume(inp, 'D');
          if (from) this.noteCancel(f, from, 'dash');
          if (d === 4 || d === 7) this.startBackdash(f);
          else this.startDash(f);
          return true;
        }
        if (tags && !tags.includes('dash') && !tags.includes('any')) continue;
        if (c.flight) {
          const fl = c.flight;
          consume(inp, 'D');
          if (f.flying) this.endFlight(f);
          else if (f.resources[fl.resource] >= fl.minFuel) {
            f.flying = true;
            f.fastFalling = false;
            f.vy = Math.max(f.vy, 0);
            if (f.state === 'move') this.setState(f, 'air');
            this.emit({ type: 'flight', frame: this.state.frame, fighter: f.idx, on: true });
          }
          return true;
        }
        if (f.airOptions > 0) {
          consume(inp, 'D');
          if (from) this.noteCancel(f, from, 'airdash');
          this.startAirdash(f, d);
          return true;
        }
        continue;
      }
      const m = this.resolveMove(f, btn, air);
      if (!m) continue;
      if (tags && !this.cancelAllowed(tags, from, m, f)) continue;
      consume(inp, btn);
      if (from) this.noteCancel(f, from, m.id);
      this.startMove(f, m.id, { canceled: !!from, feint });
      return true;
    }
    if (tags === null || tags.includes('jump')) {
      const d = numpadDir(inp.cur, f.facing);
      const upEdge = (inp.cur & IN.UP) !== 0 && (inp.prev & IN.UP) === 0;
      if (from && d >= 7) {
        if (!air) {
          this.noteCancel(f, from, 'jump');
          this.setState(f, 'jumpsquat');
          return true;
        } else if (f.airOptions > 0 && upEdge) {
          this.noteCancel(f, from, 'jump');
          this.setState(f, 'air');
          f.airOptions--;
          f.vy = this.char(f).doubleJumpVel;
          f.vx = dirVector(inp.cur).x * this.char(f).jumpHSpeed;
          this.emit({ type: 'jump', frame: this.state.frame, fighter: f.idx, air: true, x: f.x, y: f.y });
          return true;
        }
      }
    }
    return false;
  }

  /** Moves the fighter could cancel into right now (used by the AI and the training display). */
  cancelOptions(f: FighterState): MoveDef[] {
    const m = this.move(f);
    if (!m?.cancels) return [];
    const cn = m.cancels;
    const first = this.firstActive(m);
    const win = cn.window ?? [first, m.total - 1];
    if (f.moveFrame < win[0] - 3 || f.moveFrame > win[1]) return [];
    const tags: CancelTag[] = [];
    if (f.moveResult === 'hit' && cn.onHit) tags.push(...cn.onHit);
    if (f.moveResult === 'block' && cn.onBlock) tags.push(...cn.onBlock);
    if (cn.always) tags.push(...cn.always);
    if (!tags.length) return [];
    const out: MoveDef[] = [];
    for (const c of this.cdata(f).moves.values()) {
      if (!c.cmd || c.hidden) continue;
      if (!!c.cmd.air !== !f.grounded) continue;
      if (c.cmd.stance && c.cmd.stance !== f.stance) continue;
      if (!this.canStart(f, c) || !this.cancelAllowed(tags, m, c, f)) continue;
      out.push(c);
    }
    return out;
  }

  private noteCancel(f: FighterState, from: MoveDef, to: string): void {
    const o = this.opp(f);
    if (o.combo.hits > 0) {
      o.combo.cancels++;
      o.combo.route.push(`>${to}`);
    }
    f.canceledFrom = from.id;
  }

  startMove(f: FighterState, id: string, opts: { canceled?: boolean; feint?: boolean; force?: boolean } = {}): boolean {
    const m = this.moveById(f, id);
    if (!m) return false;
    if (!opts.force && !this.canStart(f, m)) return false;
    const cost = m.cost;
    if (cost) {
      if (cost.meter) f.meter = Math.max(0, f.meter - cost.meter);
      if (cost.resource) for (const k in cost.resource) f.resources[k] = Math.max(0, f.resources[k] - cost.resource[k]);
      if (cost.airOption) f.airOptions = Math.max(0, f.airOptions - cost.airOption);
      if (cost.feint) f.feints = Math.max(0, f.feints - cost.feint);
    }
    if (opts.feint) {
      f.feints = Math.max(0, f.feints - 1);
      this.emit({ type: 'feint', frame: this.state.frame, fighter: f.idx });
    }
    if (f.stance && !m.cmd?.stance && m.setStance === undefined) f.stance = null;
    this.setState(f, 'move');
    f.moveId = m.id;
    f.moveFrame = 0;
    f.moveHits = (m.hits ?? []).map(() => 0);
    f.moveHitFrame = (m.hits ?? []).map(() => -99);
    f.moveResult = 'none';
    f.moveCharge = 0;
    f.moveArmorHits = m.armor?.hits ?? 0;
    f.fastFalling = false;
    f.crouching = f.grounded && !!m.cmd && 'd123'.includes(m.cmd.dir);
    if (!opts.canceled) f.canceledFrom = null;
    if (m.kind === 'super') f.stats.supers++;
    this.emit({ type: 'moveStart', frame: this.state.frame, fighter: f.idx, moveId: m.id, kind: m.kind, canceled: !!opts.canceled, feint: !!opts.feint });
    if (m.superFreeze) {
      this.state.superFreeze = { frames: m.superFreeze, owner: f.idx };
      this.emit({ type: 'super', frame: this.state.frame, fighter: f.idx, moveId: m.id });
    }
    if (m.install) {
      f.install = { frames: m.install.frames, drain: m.install.drainPerFrame };
      this.emit({ type: 'install', frame: this.state.frame, fighter: f.idx, on: true });
    }
    this.advanceMove(f);
    return true;
  }

  private firstActive(m: MoveDef): number {
    let first = Infinity;
    for (const h of m.hits ?? []) if (!h.grabHit) first = Math.min(first, h.frames[0]);
    if (m.throw) first = Math.min(first, m.throw.frames[0]);
    for (const s of m.spawns ?? []) first = Math.min(first, s.frame);
    if (m.parry) first = Math.min(first, m.parry.frames[0]);
    if (m.counter) first = Math.min(first, m.counter.frames[0]);
    return first === Infinity ? 1 : first;
  }

  private lastActive(m: MoveDef): number {
    let last = 0;
    for (const h of m.hits ?? []) last = Math.max(last, h.frames[1]);
    if (m.throw) last = Math.max(last, m.throw.frames[1]);
    for (const s of m.spawns ?? []) last = Math.max(last, s.frame);
    return last;
  }

  private advanceMove(f: FighterState): void {
    const m = this.move(f);
    if (!m) {
      this.toNeutral(f);
      return;
    }
    // charge: hold the move on its hold frame while the button is held
    if (m.charge && f.moveFrame === m.charge.holdFrame && held(f.input, m.charge.button) && f.moveCharge < m.charge.maxFrames) {
      f.moveCharge++;
      return;
    }
    f.moveFrame++;
    const fr = f.moveFrame;
    for (const v of m.vel ?? []) {
      if (fr < v.frame || fr > (v.until ?? v.frame)) continue;
      if (v.mode === 'add') {
        if (v.x !== undefined) f.vx += v.x * f.facing;
        if (v.y !== undefined) f.vy += v.y;
      } else {
        if (v.x !== undefined) f.vx = v.x * f.facing;
        if (v.y !== undefined) f.vy = v.y;
      }
      if ((v.y ?? 0) > 0) f.grounded = false;
    }
    if (m.autoFaceAt === fr) this.faceOpponent(f);
    for (const s of m.spawns ?? []) if (s.frame === fr) this.spawnProjectile(f, s, m.charge ? f.moveCharge / m.charge.maxFrames : 0);
    for (const e of m.fx ?? []) if (e.frame === fr) this.emit({ type: 'fx', frame: this.state.frame, fighter: f.idx, cue: e.cue, x: f.x, y: f.y });
    m.onFrame?.({ sim: this, f, opp: this.opp(f), frame: fr, move: m });
    if (f.state !== 'move' || f.moveId !== m.id) return; // hook changed state

    // feint: P during startup of a feintable move cancels it back to neutral for a feint charge
    const first = this.firstActive(m);
    const feintable = m.feintable ?? (m.kind === 'special' || m.strength === 'H');
    if (feintable && fr < first && pressed(f.input, 'P') && f.feints > 0) {
      consume(f.input, 'P');
      f.feints--;
      this.emit({ type: 'feint', frame: this.state.frame, fighter: f.idx });
      this.toNeutral(f);
      return;
    }

    if (fr > m.total) {
      this.endMove(f, m);
      return;
    }
    this.checkCancels(f, m, fr, first);
  }

  private checkCancels(f: FighterState, m: MoveDef, fr: number, first: number): void {
    const cn = m.cancels;
    if (!cn) return;
    const win = cn.window ?? [first, m.total - 1];
    if (fr < win[0] || fr > win[1]) return;
    const tags: CancelTag[] = [];
    if (f.moveResult === 'hit' && cn.onHit) tags.push(...cn.onHit);
    if (f.moveResult === 'block' && cn.onBlock) tags.push(...cn.onBlock);
    if (cn.always) tags.push(...cn.always);
    const extra: CancelTag[] = f.install && (m.kind === 'normal' || m.kind === 'command') ? ['special', 'chain'] : [];
    if (tags.length && this.tryActions(f, tags, m)) return;
    // free (whiff) cancels cost a feint charge, unless an install grants them
    // a move only counts as whiffed once all of its active frames have passed without contact
    if ((f.moveResult === 'none' || f.moveResult === 'whiff') && fr > Math.max(first, this.lastActive(m))) {
      const wt = [...(cn.onWhiff ?? []), ...extra];
      if (!wt.length) return;
      const free = extra.length > 0;
      if (!free && f.feints <= 0) return;
      this.tryActions(f, wt, m, !free);
    }
  }

  private endMove(f: FighterState, m: MoveDef): void {
    if (m.setStance !== undefined) {
      f.stance = m.setStance;
      f.stanceFrames = m.stanceFrames ?? 90;
    }
    if (f.moveResult === 'none') f.moveResult = 'whiff';
    if (m.id === 'burst') f.burstPunishable = 0;
    const helpless = !!m.helpless && !f.grounded;
    this.toNeutral(f);
    f.helpless = helpless;
    this.resume(f);
  }

  /** Returns to neutral and immediately processes buffered input, so the first actionable
   *  frame after any recovery can start a new action. */
  private resume(f: FighterState): void {
    if (f.state !== 'idle' && f.state !== 'crouch' && f.state !== 'air') this.toNeutral(f);
    if (f.state === 'air') this.airNeutral(f);
    else this.groundNeutral(f);
  }

  /** Ends a move early because the fighter was interrupted. */
  private interrupt(f: FighterState): void {
    f.moveId = null;
    f.moveFrame = 0;
    f.stance = null;
    f.helpless = false;
    if (f.flying) this.endFlight(f);
    const o = this.opp(f);
    if (o.state === 'thrown' && o.grabbedBy === f.idx) {
      o.grabbedBy = -1;
      this.toNeutral(o);
    }
    this.destroySummons(f);
  }

  /** Summons that must be protected vanish when their owner is hit or grabbed. */
  private destroySummons(f: FighterState): void {
    for (const p of this.state.projectiles) {
      if (p.owner === f.idx && !p.dead && this.projDef(p.owner, p.defId)?.ownerHitDestroys) this.killProjectile(p);
    }
  }

  faceOpponent(f: FighterState): void {
    const o = this.opp(f);
    if (Math.abs(o.x - f.x) > 1) f.facing = o.x > f.x ? 1 : -1;
  }

  // ---------------------------------------------------------------- physics

  private physics(f: FighterState): void {
    const c = this.char(f);
    if (f.state === 'thrown') return;
    const m = f.state === 'move' ? this.move(f) : null;
    const wasGrounded = f.grounded;
    if (!f.grounded || f.vy > 0) {
      let g = c.gravity;
      if (m) g *= m.gravity ?? 1;
      if (f.state === 'airdash') g = 0;
      if (f.flying && (f.state === 'air' || f.state === 'move')) g = m?.gravity && m.gravity > 1 ? c.gravity * 0.5 : 0;
      if (f.state === 'launched') {
        const sc = 1 + Math.min(CFG.combo.maxGravityScale - 1, (f.combo.frames / 60) * CFG.combo.gravityScalingPerSecond);
        g *= sc;
      }
      if (f.state === 'backdash') g = c.gravity * 0.6;
      f.vy -= g;
      const maxFall = f.fastFalling ? c.fastFallSpeed : f.state === 'launched' ? c.fallSpeed * 1.3 : c.fallSpeed;
      if (f.fastFalling && f.state === 'air') f.vy = Math.min(f.vy, -c.fastFallSpeed * 0.7);
      if (f.vy < -maxFall && !f.flying) f.vy = -maxFall;
    }
    f.x += f.vx;
    f.y += f.vy;
    if (f.y > CFG.stage.ceiling) {
      f.y = CFG.stage.ceiling;
      if (f.vy > 0) f.vy = 0;
    }
    if (f.y <= 0) {
      f.y = 0;
      if (!wasGrounded || f.vy < 0) {
        f.grounded = true;
        const vyImpact = f.vy;
        f.vy = 0;
        if (!wasGrounded) this.onLand(f, vyImpact);
      }
      f.grounded = true;
    } else {
      f.grounded = false;
      f.crouching = false;
    }

    if (f.grounded) {
      let fr = CFG.physics.groundFriction;
      if (f.state === 'hitstun' || f.state === 'blockstun' || f.state === 'knockdown' || f.state === 'crumple') fr = CFG.physics.hitstunFriction;
      if (m) fr = m.friction ?? fr;
      if (f.state === 'walk' || f.state === 'run' || f.state === 'dash' || f.state === 'techroll') fr = f.state === 'dash' ? 0.93 : 1;
      if (f.state === 'move' && m?.vel?.some((v) => v.until && f.moveFrame >= v.frame && f.moveFrame <= v.until)) fr = 1;
      f.vx *= fr;
      if (Math.abs(f.vx) < 0.05) f.vx = 0;
    }

    // walls
    const half = c.width / 2;
    const L = CFG.stage.left + half;
    const R = CFG.stage.right - half;
    f.wallTouch = 0;
    if (f.x <= L + 2) f.wallTouch = -1;
    if (f.x >= R - 2) f.wallTouch = 1;
    if (f.x < L || f.x > R) {
      const side = f.x < L ? -1 : 1;
      f.x = side < 0 ? L : R;
      if (f.state === 'launched' && f.pendingWallBounce && Math.abs(f.vx) >= CFG.physics.wallBounceMinSpeed && f.combo.wallBounces < CFG.combo.maxWallBounces) {
        f.combo.wallBounces++;
        f.pendingWallBounce = false;
        f.vx = -f.vx * 0.55;
        f.vy = Math.max(f.vy, 7);
        f.hitstun = Math.max(f.hitstun, 26);
        this.applyDI(f, CFG.di.bounceFactor * f.lastHitDI, 'wall');
        this.emit({ type: 'wallBounce', frame: this.state.frame, fighter: f.idx, x: f.x, y: f.y });
      } else if (sign(f.vx) === side) {
        f.vx = f.state === 'launched' ? -f.vx * 0.15 : 0;
      }
    }
    f.x = q(f.x);
    f.y = q(f.y);
    f.vx = q(f.vx);
    f.vy = q(f.vy);
  }

  private onLand(f: FighterState, vyImpact: number): void {
    const c = this.char(f);
    f.fastFalling = false;
    f.driftAccum = 0;
    if (f.flying) this.endFlight(f);
    if (f.state !== 'launched') f.airOptions = c.maxAirOptions;
    switch (f.state) {
      case 'air':
      case 'airdash':
        this.setState(f, 'landing');
        f.landingLag = f.helpless ? 10 : f.stateFrame < 3 && f.state === 'airdash' ? 6 : 2;
        f.helpless = false;
        f.vx *= 0.6;
        this.emit({ type: 'land', frame: this.state.frame, fighter: f.idx, x: f.x, hard: false });
        break;
      case 'backdash':
        this.setState(f, 'landing');
        f.landingLag = Math.max(1, c.backdashFrames - f.stateFrame);
        f.vx *= 0.3;
        break;
      case 'move': {
        const m = this.move(f)!;
        const mode = m.landing?.mode ?? (m.stance === 'air' ? 'end' : 'continue');
        if (mode === 'end') {
          this.setState(f, 'landing');
          f.landingLag = m.landing?.lag ?? CFG.landingLag.default;
          f.vx *= 0.5;
          this.emit({ type: 'land', frame: this.state.frame, fighter: f.idx, x: f.x, hard: true });
        } else if (mode === 'goto' && m.landing?.goto) {
          this.startMove(f, m.landing.goto, { force: true, canceled: true });
        }
        break;
      }
      case 'launched': {
        if (f.pendingGroundBounce && f.combo.groundBounces < CFG.combo.maxGroundBounces) {
          f.combo.groundBounces++;
          f.pendingGroundBounce = false;
          f.vy = Math.max(6, Math.abs(vyImpact) * 0.6 + 3);
          f.y = 0.01;
          f.grounded = false;
          f.hitstun = Math.max(f.hitstun, 24);
          this.applyDI(f, CFG.di.bounceFactor * f.lastHitDI, 'ground');
          this.emit({ type: 'groundBounce', frame: this.state.frame, fighter: f.idx, x: f.x, y: 0 });
          return;
        }
        const techPress = f.input.press.D;
        if (!f.hardKnockdown && f.hp > 0 && techPress >= 0 && techPress <= CFG.knockdown.techWindow) {
          consume(f.input, 'D');
          this.setState(f, 'techroll');
          const d = numpadDir(f.input.cur, f.facing);
          f.vx = d === 6 ? 5 * f.facing : d === 4 ? -5 * f.facing : 0;
          f.stats.techs++;
          f.airOptions = c.maxAirOptions;
          this.emit({ type: 'tech', frame: this.state.frame, fighter: f.idx, kind: 'ground' });
          return;
        }
        this.knockDown(f, f.hardKnockdown);
        f.airOptions = c.maxAirOptions;
        break;
      }
      default:
        break;
    }
  }

  private knockDown(f: FighterState, hard: boolean): void {
    this.setState(f, 'knockdown');
    f.knockdownFrames = hard ? CFG.knockdown.hard : CFG.knockdown.soft;
    f.hardKnockdown = false;
    f.pendingGroundBounce = false;
    f.pendingWallBounce = false;
    f.vx *= 0.4;
    f.hitstun = 0;
    this.emit({ type: 'knockdown', frame: this.state.frame, fighter: f.idx, x: f.x });
  }

  private positionThrown(f: FighterState): void {
    if (f.state !== 'thrown' || f.grabbedBy < 0) return;
    const g = this.state.fighters[f.grabbedBy as 0 | 1];
    if (g.state !== 'move') {
      // grabber was interrupted: release
      f.grabbedBy = -1;
      this.toNeutral(f);
      return;
    }
    f.x = clamp(g.x + g.facing * f.grabHold.x, CFG.stage.left + 20, CFG.stage.right - 20);
    f.y = Math.max(0, g.y + f.grabHold.y);
    f.vx = 0;
    f.vy = 0;
    f.grounded = f.y <= 0;
  }

  private resolveBodies(): void {
    const [a, b] = this.state.fighters;
    if (a.state === 'thrown' || b.state === 'thrown') return;
    const ca = this.char(a);
    const cb = this.char(b);
    const noPush = (f: FighterState) => {
      if (f.state === 'knockdown' || f.state === 'techroll' || f.state === 'ko') return true;
      const m = this.move(f);
      return !!(m?.noPush && f.moveFrame >= m.noPush[0] && f.moveFrame <= m.noPush[1]);
    };
    if (noPush(a) || noPush(b)) return;
    const ha = a.crouching ? ca.crouchHeight : ca.height;
    const hb = b.crouching ? cb.crouchHeight : cb.height;
    if (a.y > b.y + hb - 10 || b.y > a.y + ha - 10) return;
    const minDist = (ca.width + cb.width) / 2;
    const dx = b.x - a.x;
    const overlap = minDist - Math.abs(dx);
    if (overlap <= 0) return;
    let dir = sign(dx);
    if (dir === 0) dir = a.facing;
    const L = CFG.stage.left;
    const R = CFG.stage.right;
    let pa = overlap / 2;
    let pb = overlap / 2;
    // if one is against the wall, the other takes the full push
    if (a.x - dir * pa < L + ca.width / 2 || a.x - dir * pa > R - ca.width / 2) {
      pb = overlap;
      pa = 0;
    } else if (b.x + dir * pb < L + cb.width / 2 || b.x + dir * pb > R - cb.width / 2) {
      pa = overlap;
      pb = 0;
    }
    a.x = q(a.x - dir * pa);
    b.x = q(b.x + dir * pb);

    // camera separation limit
    const sep = b.x - a.x;
    if (Math.abs(sep) > CFG.maxSeparation) {
      const excess = Math.abs(sep) - CFG.maxSeparation;
      const s = sign(sep);
      // push back whoever is moving away
      if (Math.abs(a.vx) > Math.abs(b.vx)) a.x += s * excess;
      else b.x -= s * excess;
    }
  }

  private updateFacing(): void {
    for (const f of this.state.fighters) {
      if (f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'landing' || f.state === 'jumpsquat' || f.state === 'getup') {
        const before = f.facing;
        this.faceOpponent(f);
        if (before !== f.facing && f.state === 'walk') f.vx = 0;
      }
    }
  }

  // ---------------------------------------------------------------- projectiles

  spawnProjectile(f: FighterState, s: SpawnEvent, charge: number): ProjectileState | null {
    const def = this.projDef(f.idx, s.projectile);
    if (!def) return null;
    const o = this.opp(f);
    if (def.maxCount) {
      const mine = this.state.projectiles.filter((p) => p.owner === f.idx && p.defId === def.id && !p.dead);
      while (mine.length >= def.maxCount) this.killProjectile(mine.shift()!, true);
    }
    let x = f.x + f.facing * s.offset.x;
    let y = f.y + s.offset.y;
    if (s.atOpponent) {
      x = o.x + f.facing * s.offset.x;
      y = s.offset.y;
    }
    if (s.groundAhead !== undefined) {
      x = f.x + f.facing * s.groundAhead;
      y = 0;
    }
    const spd = s.vel ?? def.speed;
    const cs = def.chargeScaling ? 1 + charge * 0.6 : 1;
    const p: ProjectileState = {
      id: this.state.nextProjId++,
      defId: def.id,
      owner: f.idx,
      x: clamp(x, CFG.stage.left, CFG.stage.right),
      y,
      vx: spd.x * f.facing * (def.chargeScaling ? 1 + charge * 0.3 : 1),
      vy: spd.y,
      facing: f.facing,
      age: 0,
      durability: def.durability * (def.chargeScaling ? 1 + Math.round(charge * 2) : 1),
      hitsLeft: def.hits,
      lastHitFrame: -999,
      hitstop: 0,
      charge: def.chargeScaling ? charge : 0,
      dead: false,
      data: { scale: cs },
    };
    this.state.projectiles.push(p);
    this.emit({ type: 'spawn', frame: this.state.frame, owner: f.idx, projectile: def.id, x: p.x, y: p.y });
    return p;
  }

  killProjectile(p: ProjectileState, silent = false): void {
    if (p.dead) return;
    p.dead = true;
    if (!silent) this.emit({ type: 'projDestroyed', frame: this.state.frame, x: p.x, y: p.y, id: p.id });
    const def = this.projDef(p.owner, p.defId);
    if (def?.onEnd) {
      const owner = this.state.fighters[p.owner];
      const np = this.spawnProjectile(owner, { frame: 0, projectile: def.onEnd, offset: { x: 0, y: 0 } }, p.charge);
      if (np) {
        np.x = p.x;
        np.y = p.y;
        np.facing = p.facing;
        np.vx = Math.abs(np.vx) * p.facing;
      }
    }
  }

  private updateProjectiles(): void {
    const s = this.state;
    for (const p of s.projectiles) {
      if (p.dead) continue;
      if (p.hitstop > 0) {
        p.hitstop--;
        continue;
      }
      const def = this.projDef(p.owner, p.defId)!;
      p.age++;
      def.update?.(this, p);
      if (p.dead) continue;
      if (def.homing && p.age > (def.delay ?? 0)) {
        const t = s.fighters[p.owner === 0 ? 1 : 0];
        const dy = t.y + 50 - p.y;
        const dx = t.x - p.x;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const len = Math.hypot(dx, dy) || 1;
        p.vx += (dx / len) * def.homing;
        p.vy += (dy / len) * def.homing;
        const ns = Math.hypot(p.vx, p.vy);
        p.vx *= sp / ns;
        p.vy *= sp / ns;
      }
      if (def.followOwner) {
        const o = s.fighters[p.owner];
        p.x = o.x + p.facing * (p.data.ox ?? 0);
        p.y = o.y + (p.data.oy ?? 0);
      } else {
        p.vy -= def.gravity ?? 0;
        p.x += p.vx;
        p.y += p.vy;
      }
      if (p.y < 0 && (def.groundDestroy || (def.gravity ?? 0) > 0)) {
        p.y = 0;
        if (def.groundDestroy) {
          this.killProjectile(p);
          continue;
        }
        p.vy = 0;
      }
      if (p.age >= def.lifetime || p.x < CFG.stage.left - 60 || p.x > CFG.stage.right + 60 || p.y > 900) this.killProjectile(p, p.age < def.lifetime);
    }
    s.projectiles = s.projectiles.filter((p) => !p.dead);
  }

  projBox(p: ProjectileState): Box {
    const def = this.projDef(p.owner, p.defId)!;
    const sc = p.data.scale ?? 1;
    const b = def.box;
    const w = b.w * sc;
    const h = b.h * sc;
    return { x: p.x - w / 2 + (p.facing === 1 ? b.x : -b.x), y: p.y + b.y * sc, w, h };
  }

  projActive(p: ProjectileState): boolean {
    const def = this.projDef(p.owner, p.defId)!;
    return !p.dead && !def.inert && p.age >= (def.delay ?? 0);
  }

  // ---------------------------------------------------------------- boxes

  toWorld(f: FighterState, b: LocalBox): Box {
    const x = f.facing === 1 ? f.x + b.x : f.x - b.x - b.w;
    return { x, y: f.y + b.y, w: b.w, h: b.h };
  }

  hurtboxes(f: FighterState): Box[] {
    const c = this.char(f);
    const w = c.width;
    if (f.state === 'knockdown' || f.state === 'getup') return [{ x: f.x - c.height / 2, y: f.y, w: c.height, h: 26 }];
    const m = f.state === 'move' ? this.move(f) : null;
    if (m?.hurt) {
      for (const h of m.hurt) if (f.moveFrame >= h.frames[0] && f.moveFrame <= h.frames[1]) return h.boxes.map((b) => this.toWorld(f, b));
    }
    const boxes: Box[] = [];
    if (f.crouching && f.grounded && f.state !== 'hitstun') {
      boxes.push({ x: f.x - w / 2, y: f.y, w, h: c.crouchHeight });
    } else if (!f.grounded) {
      boxes.push({ x: f.x - w / 2, y: f.y + 8, w, h: c.height - 16 });
    } else boxes.push({ x: f.x - w / 2, y: f.y, w, h: c.height });
    // limbs extend the hurtbox during non-disjoint attacks so whiffs can be punished
    if (m && !m.disjoint) {
      for (const h of m.hits ?? []) {
        if (h.grabHit) continue;
        if (f.moveFrame >= h.frames[0] && f.moveFrame <= h.frames[1] + 6) {
          for (const hb of h.boxes) boxes.push(this.toWorld(f, { x: hb.x, y: hb.y + hb.h * 0.15, w: hb.w * 0.75, h: hb.h * 0.7 }));
        }
      }
    }
    return boxes;
  }

  activeHits(f: FighterState): ActiveHit[] {
    if (f.state !== 'move') return [];
    const m = this.move(f);
    if (!m?.hits) return [];
    const out: ActiveHit[] = [];
    const fr = f.moveFrame;
    m.hits.forEach((h, i) => {
      if (fr < h.frames[0] || fr > h.frames[1]) return;
      const n = f.moveHits[i] ?? 0;
      if (n > 0) {
        if (!h.rehit) return;
        if (fr - f.moveHitFrame[i] < h.rehit) return;
      }
      out.push({ idx: i, hit: h, boxes: h.boxes.map((b) => this.toWorld(f, b)) });
    });
    return out;
  }

  private invulnTo(f: FighterState, type: 'strike' | 'throw' | 'projectile'): boolean {
    if (f.state === 'getup' || f.state === 'techroll') return true;
    if (type !== 'throw' && (f.wakeInvuln > 0 || f.airRecoverInvuln > 0)) return true;
    if (type === 'throw' && f.wakeInvuln > 0) return true;
    if (f.state === 'backdash' && f.stateFrame <= (type === 'throw' ? 10 : 6)) return true;
    if (f.state === 'move') {
      const m = this.move(f);
      for (const iv of m?.invuln ?? []) if (f.moveFrame >= iv.frames[0] && f.moveFrame <= iv.frames[1] && iv.types.includes(type)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- collisions

  private resolveCollisions(): void {
    const s = this.state;
    const [a, b] = s.fighters;
    const hitsA = this.activeHits(a).filter((h) => !h.hit.grabHit);
    const hitsB = this.activeHits(b).filter((h) => !h.hit.grabHit);

    // 1. melee clashes
    this.resolveClashes(a, b, hitsA, hitsB);

    // 2. projectile vs projectile
    const projs = s.projectiles.filter((p) => this.projActive(p) || this.projDef(p.owner, p.defId)?.wall);
    for (let i = 0; i < projs.length; i++) {
      for (let j = i + 1; j < projs.length; j++) {
        const p1 = projs[i];
        const p2 = projs[j];
        if (p1.owner === p2.owner || p1.dead || p2.dead) continue;
        if (!boxesOverlap(this.projBox(p1), this.projBox(p2))) continue;
        const d1 = this.projDef(p1.owner, p1.defId)!;
        const d2 = this.projDef(p2.owner, p2.defId)!;
        if (d1.inert || d2.inert) continue;
        const c = overlapCenter(this.projBox(p1), this.projBox(p2));
        p1.durability -= d2.wall ? 99 : d2.power;
        p2.durability -= d1.wall ? 99 : d1.power;
        p1.hitstop = p2.hitstop = 3;
        this.emit({ type: 'projClash', frame: s.frame, x: c.x, y: c.y });
        if (p1.durability <= 0) this.killProjectile(p1);
        if (p2.durability <= 0) this.killProjectile(p2);
      }
    }

    // 3. strikes vs projectiles (destroy / reflect)
    for (const f of s.fighters) {
      const m = this.move(f);
      const hs = f.idx === 0 ? hitsA : hitsB;
      for (const p of s.projectiles) {
        if (p.dead || p.owner === f.idx || !this.projActive(p)) continue;
        const def = this.projDef(p.owner, p.defId)!;
        const pb = this.projBox(p);
        if (m?.reflect && f.moveFrame >= m.reflect.frames[0] && f.moveFrame <= m.reflect.frames[1] && def.reflectable) {
          if (boxesOverlap(this.toWorld(f, m.reflect.box), pb)) {
            p.owner = f.idx;
            p.facing = f.facing;
            p.vx = Math.abs(p.vx) * 1.25 * f.facing;
            p.vy = -p.vy * 0.5;
            p.age = Math.min(p.age, Math.floor(def.lifetime / 3));
            p.hitsLeft = def.hits;
            p.lastHitFrame = -999;
            f.moveResult = 'hit';
            this.emit({ type: 'reflect', frame: s.frame, x: p.x, y: p.y, by: f.idx });
            continue;
          }
        }
        for (const ah of hs) {
          if (!(ah.hit.destroysProjectiles || def.strikeDestroyable)) continue;
          if (ah.boxes.some((bx) => boxesOverlap(bx, pb))) {
            p.durability -= ah.hit.destroysProjectiles ? 99 : 1;
            if (p.durability <= 0) this.killProjectile(p);
            break;
          }
        }
      }
    }

    // 4. strikes vs fighters (collected first so trades resolve simultaneously)
    const pending: PendingStrike[] = [];
    const struck = new Set<number>();
    for (const [att, hits] of [
      [a, hitsA],
      [b, hitsB],
    ] as [FighterState, ActiveHit[]][]) {
      const def = this.opp(att);
      if (def.state === 'ko' && def.hp <= 0) continue;
      const hurts = this.hurtboxes(def);
      const m = this.move(att)!;
      for (const ah of hits) {
        let found: { box: Box; hurt: Box } | null = null;
        for (const bx of ah.boxes) {
          for (const hb of hurts) if (boxesOverlap(bx, hb)) found = { box: bx, hurt: hb };
          if (found) break;
        }
        if (!found) continue;
        if (def.state === 'knockdown' || def.state === 'getup') {
          if (!ah.hit.otg || def.combo.otgUsed || def.state === 'getup') continue;
        }
        pending.push({ att, def, hit: ah.hit, hitIdx: ah.idx, moveId: m.id, move: m, ...found });
        break; // one hit per move per frame
      }
    }
    for (const ps of pending) {
      const res = this.applyStrike(ps.att, ps.def, ps.hit, ps.moveId, ps.move, overlapCenter(ps.box, ps.hurt), null);
      if (res === 'hit' || res === 'block') struck.add(ps.def.idx);
      if (res === 'invuln') continue; // invulnerable: the hit stays live for later frames
      ps.att.moveHits[ps.hitIdx] = (ps.att.moveHits[ps.hitIdx] ?? 0) + 1;
      ps.att.moveHitFrame[ps.hitIdx] = ps.att.moveFrame;
    }

    // grab follow-up hits connect automatically with the held opponent
    for (const att of s.fighters) {
      const victim = this.opp(att);
      if (victim.state !== 'thrown' || victim.grabbedBy !== att.idx) continue;
      for (const ah of this.activeHits(att)) {
        if (!ah.hit.grabHit) continue;
        const m = this.move(att)!;
        att.moveHits[ah.idx]++;
        att.moveHitFrame[ah.idx] = att.moveFrame;
        this.applyStrike(att, victim, ah.hit, m.id, m, { x: victim.x, y: victim.y + 60 }, null);
      }
    }

    // 5. throws (strikes beat throws on the same frame)
    const throwing = s.fighters.filter((f) => {
      const m = this.move(f);
      return m?.throw && f.moveResult === 'none' && f.moveFrame >= m.throw.frames[0] && f.moveFrame <= m.throw.frames[1] && !struck.has(f.idx);
    });
    const connects: FighterState[] = [];
    for (const f of throwing) {
      const m = this.move(f)!;
      const t = m.throw!;
      const v = this.opp(f);
      if (struck.has(v.idx)) continue;
      if (!this.throwable(v, t.target)) continue;
      const tb = this.toWorld(f, t.box);
      if (!this.hurtboxes(v).some((h) => boxesOverlap(tb, h))) continue;
      connects.push(f);
    }
    if (connects.length === 2) {
      this.throwTech(connects[0], connects[1]);
    } else if (connects.length === 1) {
      this.throwConnect(connects[0], this.opp(connects[0]));
    }

    // 6. projectiles vs fighters
    for (const p of s.projectiles) {
      if (p.dead || !this.projActive(p)) continue;
      const def = this.projDef(p.owner, p.defId)!;
      const t = s.fighters[p.owner === 0 ? 1 : 0];
      if (t.state === 'knockdown' || t.state === 'getup' || (t.state === 'ko' && t.hp <= 0)) continue;
      const rehit = def.rehit ?? (def.hits > 1 ? 8 : 0);
      if (p.lastHitFrame > 0 && s.frame - p.lastHitFrame < rehit) continue;
      if (p.lastHitFrame > 0 && !rehit) continue;
      const pb = this.projBox(p);
      const hurt = this.hurtboxes(t).find((h) => boxesOverlap(pb, h));
      if (!hurt) continue;
      if (this.invulnTo(t, 'projectile')) continue;
      const owner = s.fighters[p.owner];
      const hit: HitDef = { ...def.hit, frames: [0, 0], boxes: [] };
      if (p.charge > 0) {
        hit.damage = Math.round(hit.damage * (1 + p.charge * 0.8));
        hit.hitstun = Math.round(hit.hitstun * (1 + p.charge * 0.3));
        hit.knockback = { x: hit.knockback.x * (1 + p.charge * 0.4), y: hit.knockback.y * (1 + p.charge * 0.4) };
      }
      p.lastHitFrame = s.frame;
      const result = this.applyStrike(owner, t, hit, p.defId, null, overlapCenter(pb, hurt), p);
      if (result === 'parried') {
        this.killProjectile(p);
        continue;
      }
      p.hitsLeft--;
      p.hitstop = Math.min(4, hit.hitstop ?? 4);
      if (p.hitsLeft <= 0) this.killProjectile(p, true);
    }
  }

  private resolveClashes(a: FighterState, b: FighterState, hitsA: ActiveHit[], hitsB: ActiveHit[]): void {
    if (!hitsA.length || !hitsB.length) return;
    const ma = this.move(a)!;
    const mb = this.move(b)!;
    const armored = (f: FighterState, m: MoveDef) => !!(m.armor && f.moveArmorHits > 0 && f.moveFrame >= m.armor.frames[0] && f.moveFrame <= m.armor.frames[1]);
    if (armored(a, ma) || armored(b, mb)) return;
    for (const ha of hitsA) {
      if (ha.hit.clash === false) continue;
      for (const hb of hitsB) {
        if (hb.hit.clash === false) continue;
        let where: Box | null = null;
        for (const x of ha.boxes) for (const y of hb.boxes) if (boxesOverlap(x, y)) where = x;
        if (!where) continue;
        const pa = ha.hit.priority ?? DEFAULT_PRIORITY[ma.strength ?? 'M'];
        const pb = hb.hit.priority ?? DEFAULT_PRIORITY[mb.strength ?? 'M'];
        const c = { x: (a.x + b.x) / 2, y: where.y + where.h / 2 };
        if (Math.abs(pa - pb) >= CFG.clash.priorityGap) {
          // the stronger attack wins: the weaker hitbox is nullified
          const loser = pa > pb ? b : a;
          const lh = pa > pb ? hb : ha;
          loser.moveHits[lh.idx]++;
          loser.moveHitFrame[lh.idx] = loser.moveFrame;
          lh.boxes = [];
          this.emit({ type: 'clash', frame: this.state.frame, x: c.x, y: c.y, winner: pa > pb ? a.idx : b.idx });
        } else {
          // even clash: both attacks are interrupted, both fighters rebound and are free to act
          for (const [f, h] of [
            [a, ha],
            [b, hb],
          ] as [FighterState, ActiveHit][]) {
            f.moveHits[h.idx]++;
            h.boxes = [];
            f.hitstop = CFG.hitstop.clash;
            f.vx = -f.facing * CFG.clash.rebound;
            f.moveId = null;
            this.toNeutral(f);
          }
          hitsA.length = 0;
          hitsB.length = 0;
          this.emit({ type: 'clash', frame: this.state.frame, x: c.x, y: c.y, winner: -1 });
          return;
        }
      }
    }
  }

  private throwable(v: FighterState, target: 'ground' | 'air' | 'any'): boolean {
    if (v.grabbedBy >= 0) return false;
    if (['hitstun', 'blockstun', 'launched', 'knockdown', 'getup', 'techroll', 'thrown', 'throwtech', 'crumple', 'ko'].includes(v.state)) return false;
    if (this.invulnTo(v, 'throw')) return false;
    if (target === 'ground' && !v.grounded) return false;
    if (target === 'air' && v.grounded) return false;
    return true;
  }

  private throwConnect(att: FighterState, v: FighterState): void {
    const m = this.move(att)!;
    const t = m.throw!;
    att.moveResult = 'hit';
    if (t.swapSides) att.facing = (-att.facing) as 1 | -1;
    this.interrupt(v);
    this.setState(v, 'thrown');
    v.grabbedBy = att.idx;
    v.grabHold = t.hold;
    v.grabTechable = t.techable;
    v.throwTechWindow = t.techable ? CFG.throwTech.window : 0;
    v.vx = v.vy = 0;
    v.crouching = false;
    v.facing = (-att.facing) as 1 | -1;
    this.emit({ type: 'throw', frame: this.state.frame, attacker: att.idx, victim: v.idx, moveId: m.id });
    this.startMove(att, t.success, { force: true, canceled: true });
    att.moveResult = 'hit';
    this.positionThrown(v);
  }

  throwTech(a: FighterState, b: FighterState): void {
    for (const f of [a, b]) {
      if (f.state === 'move') f.moveId = null;
      f.grabbedBy = -1;
      this.setState(f, 'throwtech');
      f.y = 0;
      f.grounded = true;
      this.faceOpponent(f);
      f.vx = -f.facing * CFG.throwTech.push;
      f.stats.techs += f === b ? 1 : 0;
    }
    this.emit({ type: 'throwTech', frame: this.state.frame, x: (a.x + b.x) / 2, y: 60 });
  }

  pushblock(f: FighterState): void {
    const o = this.opp(f);
    const dir = sign(o.x - f.x) || f.facing;
    const atWall = (dir > 0 && o.x >= CFG.stage.right - 40) || (dir < 0 && o.x <= CFG.stage.left + 40);
    if (Math.abs(o.x - f.x) < 220) {
      if (atWall) f.vx = -dir * CFG.block.pushblockForce;
      else o.vx = dir * CFG.block.pushblockForce;
    }
    this.emit({ type: 'pushblock', frame: this.state.frame, fighter: f.idx });
  }

  // ---------------------------------------------------------------- hit application

  private isBlocking(def: FighterState, att: FighterState, hit: HitDef, proj: ProjectileState | null): boolean {
    if (!BLOCK_STATES.has(def.state)) return false;
    if (def.state === 'landing' && def.landingLag > 2) return false;
    if (def.state === 'air' && def.helpless) return false;
    if (hit.guard === 'unblockable') return false;
    if (!def.grounded && hit.airUnblockable) return false;
    const auto = this.state.settings.autoBlock[def.idx];
    let mode = auto;
    if (mode === 'random') mode = this.rand() < 0.5 ? 'all' : 'none';
    if (mode === 'all') {
      if (def.grounded) def.crouching = hit.guard === 'low' || (hit.guard === 'mid' && def.crouching);
      return true;
    }
    const srcX = proj ? proj.x - proj.vx * 3 : att.x;
    let away = sign(def.x - srcX);
    if (away === 0) away = -att.facing === def.facing ? def.facing : att.facing;
    const v = dirVector(def.input.cur);
    if (sign(v.x) !== away) return false;
    const crouch = (def.input.cur & IN.DOWN) !== 0;
    if (def.grounded) {
      if (hit.guard === 'low' && !crouch) return false;
      if (hit.guard === 'high' && crouch) return false;
      def.crouching = crouch;
    }
    return true;
  }

  /** Applies a strike. Returns 'hit' | 'block' | 'parried' | 'armor' | 'invuln' | 'counter'. */
  applyStrike(att: FighterState, def: FighterState, hit: HitDef, moveId: string, move: MoveDef | null, at: { x: number; y: number }, proj: ProjectileState | null): string {
    const s = this.state;
    const isProj = !!proj;
    const strength = move?.strength ?? (isProj ? 'S' : 'M');
    const type = isProj ? 'projectile' : 'strike';
    if (!hit.grabHit && this.invulnTo(def, type)) return 'invuln';
    const dm = def.state === 'move' ? this.move(def) : null;
    const pdef = proj ? this.projDef(proj.owner, proj.defId) : null;

    // parry
    if (!hit.grabHit && dm?.parry && def.moveFrame >= dm.parry.frames[0] && def.moveFrame <= dm.parry.frames[1] && (!isProj || (dm.parry.projectiles && pdef?.parryable !== false))) {
      const air = !def.grounded;
      this.startMove(def, air ? 'parry_success_air' : 'parry_success', { force: true });
      def.hitstop = 4;
      if (!isProj) {
        att.hitstop = CFG.hitstop.parry;
        att.moveResult = 'parried';
      }
      def.meter = Math.min(CFG.meter.max, def.meter + CFG.meter.onParry);
      def.stats.parries++;
      this.emit({ type: 'parry', frame: s.frame, defender: def.idx, attacker: att.idx, x: at.x, y: at.y, projectile: isProj });
      return 'parried';
    }
    // counter stance
    if (!hit.grabHit && dm?.counter && def.moveFrame >= dm.counter.frames[0] && def.moveFrame <= dm.counter.frames[1] && !isProj) {
      att.hitstop = 14;
      att.moveResult = 'parried';
      this.emit({ type: 'counterStance', frame: s.frame, fighter: def.idx });
      this.startMove(def, dm.counter.followup, { force: true });
      def.hitstop = 6;
      return 'counter';
    }
    // armor
    if (!hit.grabHit && dm?.armor && def.moveArmorHits > 0 && def.moveFrame >= dm.armor.frames[0] && def.moveFrame <= dm.armor.frames[1] && hit.guard !== 'unblockable') {
      def.moveArmorHits--;
      const dmg = Math.round(hit.damage * (dm.armor.damageMult ?? 0.5));
      this.damage(def, dmg);
      const hs = Math.min(CFG.hitstop.max, hit.hitstop ?? CFG.hitstop[strength as 'L']);
      def.hitstop = hs;
      if (!isProj) att.hitstop = hs;
      if (!isProj && att.moveResult === 'none') att.moveResult = 'block';
      this.emit({ type: 'armor', frame: s.frame, defender: def.idx, x: at.x, y: at.y });
      return 'armor';
    }
    const dir = isProj ? sign(proj!.vx) || proj!.facing : sign(def.x - att.x) || att.facing;

    // block
    if (!hit.grabHit && this.isBlocking(def, att, hit, proj)) {
      const chip = Math.round(hit.chip ?? (move?.kind === 'special' || move?.kind === 'super' || isProj ? hit.damage * 0.15 : 0));
      if (chip > 0) {
        const lethal = def.hp - chip <= 0;
        if (!lethal || CFG.block.chipKills || move?.kind === 'super') this.damage(def, chip);
        else def.hp = 1;
      }
      if (def.state === 'move') this.interrupt(def);
      this.setState(def, 'blockstun');
      def.blockstun = hit.blockstun + (def.grounded ? 0 : CFG.block.airBlockstunBonus);
      const push = hit.blockPush ?? Math.max(2.5, hit.knockback.x * 0.7);
      const wallSide = dir > 0 ? CFG.stage.right - 40 : CFG.stage.left + 40;
      const atWall = dir > 0 ? def.x >= wallSide : def.x <= wallSide;
      if (atWall && !isProj && CFG.block.pushbackWallTransfer) att.vx = -dir * push;
      else def.vx = dir * push;
      if (!def.grounded) def.vy = Math.max(def.vy, 1.5);
      const hs = Math.round(Math.min(CFG.hitstop.max, hit.hitstop ?? CFG.hitstop[strength as 'L']) * 0.75);
      def.hitstop = hs;
      if (!isProj) {
        att.hitstop = hs;
        if (att.moveResult !== 'hit') att.moveResult = 'block';
        this.startAdvantage(att, def);
      }
      att.meter = Math.min(CFG.meter.max, att.meter + (hit.meterGain ?? hit.damage * 0.1) * CFG.meter.onBlockAtk);
      def.meter = Math.min(CFG.meter.max, def.meter + hit.damage * 0.1 * CFG.meter.onBlockDef);
      this.emit({ type: 'block', frame: s.frame, attacker: att.idx, victim: def.idx, moveId, chip, x: at.x, y: at.y, projectile: isProj });
      this.char(att).onHitLanded?.(this, att, def, true);
      return 'block';
    }

    // ---- hit
    const combo = def.combo;
    if (combo.hits === 0) {
      combo.scale = def.burstPunishable > 0 ? CFG.burst.punishScale : 1;
      combo.startScale = combo.scale;
    }
    const counter = !hit.grabHit && ((dm != null && def.moveFrame <= this.lastActive(dm) && dm.kind !== 'defense') || def.burstPunishable > 0);
    const repeats = combo.moveCounts[moveId] ?? 0;
    let scale = combo.scale * Math.pow(CFG.combo.repeatPenalty, repeats);
    scale = Math.max(scale, hit.minDamage ?? CFG.combo.minScale);
    const dmult = this.char(att).damageMult?.(att) ?? 1;
    const dmg = Math.max(1, Math.round(hit.damage * scale * (counter ? CFG.counterHit.damage : 1) * dmult));
    this.damage(def, dmg);

    let hitstun = hit.hitstun * (counter ? CFG.counterHit.hitstun : 1);
    if (!hit.ignoreDecay && combo.frames > CFG.combo.decayStart) {
      const t = Math.min(1, (combo.frames - CFG.combo.decayStart) / (CFG.combo.decayFull - CFG.combo.decayStart));
      hitstun *= 1 - t * CFG.combo.maxDecay;
    }
    if (!hit.ignoreDecay) hitstun *= Math.max(0.3, 1 - CFG.combo.repeatHitstunPenalty * repeats);
    hitstun = Math.max(CFG.combo.minHitstun, Math.round(hitstun));
    // hard anti-infinite: once a combo has run past the decay limit, hits no longer stun
    if (combo.frames >= CFG.combo.decayFull && !hit.grabHit) hitstun = 0;

    combo.scale *= hit.proration ?? CFG.combo.defaultProration;
    if (isProj) {
      combo.scale *= CFG.combo.projectileProration;
      combo.projectileHits++;
    }
    if (!def.grounded) combo.scale *= CFG.combo.airborneProration;
    combo.hits++;
    combo.damage += dmg;
    combo.lastHitDamage = dmg;
    combo.moveCounts[moveId] = repeats + 1;
    combo.route.push(moveId);
    if ((def.state === 'knockdown' || def.state === 'getup') && hit.otg) combo.otgUsed = true;

    const wasThrown = def.state === 'thrown';
    const keepHeld = hit.grabHit && !hit.release && wasThrown;
    if (def.state === 'move') this.interrupt(def);
    else this.destroySummons(def);
    if (def.flying) this.endFlight(def);
    def.counterHit = counter;
    def.unburstable = !!hit.unburstable;
    def.lastHitDI = hit.di ?? 1;
    def.hardKnockdown = !!hit.hardKnockdown;
    def.pendingGroundBounce = !!hit.groundBounce && combo.groundBounces < CFG.combo.maxGroundBounces;
    def.pendingWallBounce = !!hit.wallBounce && combo.wallBounces < CFG.combo.maxWallBounces;
    def.driftAccum = 0;
    def.burstPunishable = 0;
    def.fastFalling = false;
    def.helpless = false;

    if (hit.pullTo) {
      def.x = clamp(att.x + att.facing * hit.pullTo.x, CFG.stage.left + 20, CFG.stage.right - 20);
      def.y = Math.max(0, att.y + hit.pullTo.y);
      def.grounded = def.y <= 0;
    }

    const weight = this.char(def).weight;
    const kx = hit.knockback.x * weight * dir;
    const ky = hit.knockback.y * weight;
    if (keepHeld) {
      def.hitstun = hitstun;
    } else {
      if (wasThrown) {
        def.grabbedBy = -1;
        def.grabTechable = false;
      }
      const launched = !def.grounded || hit.launch || ky > 0 || def.hp <= 0;
      if (launched) {
        this.setState(def, 'launched');
        def.grounded = false;
        if (def.y <= 0) def.y = 0.01;
      } else if (hit.crumple) {
        this.setState(def, 'crumple');
      } else {
        this.setState(def, 'hitstun');
      }
      def.hitstun = hitstun;
      const kvy = def.hp <= 0 ? Math.max(ky, 7) : ky;
      def.pendingKB = { vx: kx, vy: launched ? Math.max(kvy, def.grounded ? 3 : kvy) : 0, di: hit.di ?? 1, launched };
      def.vx = 0;
      def.vy = 0;
      def.crouching = def.crouching && !launched;
    }

    // meter & burst
    const gain = (hit.meterGain ?? dmg * 0.35) * CFG.meter.onHitMult * Math.max(0.4, combo.scale);
    att.meter = Math.min(CFG.meter.max, att.meter + gain);
    def.meter = Math.min(CFG.meter.max, def.meter + dmg * 0.1 * CFG.meter.onHurt);
    def.burst = Math.min(CFG.burst.max, def.burst + dmg * CFG.burst.onDamageMult);

    let hs = hit.hitstop ?? CFG.hitstop[strength as 'L'] ?? 8;
    if (counter) hs += CFG.hitstop.counterBonus;
    hs = Math.min(CFG.hitstop.max, hs);
    def.hitstop = hs;
    if (!isProj) {
      att.hitstop = hs;
      att.moveResult = 'hit';
      this.startAdvantage(att, def);
    }
    if (this.char(att).airOptionsOnHit && !att.grounded) att.airOptions = Math.min(this.char(att).maxAirOptions, att.airOptions + this.char(att).airOptionsOnHit!);
    att.stats.hitsLanded++;
    att.stats.damageDealt += dmg;

    this.emit({
      type: 'hit',
      frame: s.frame,
      attacker: att.idx,
      victim: def.idx,
      moveId,
      damage: dmg,
      x: at.x,
      y: at.y,
      counter,
      launch: def.state === 'launched',
      strength,
      spark: hit.spark,
      projectile: isProj,
      comboHits: combo.hits,
      scale: combo.scale,
      super: move?.kind === 'super',
    });
    this.char(att).onHitLanded?.(this, att, def, false);
    if (hit.onHitGoto && !isProj) this.startMove(att, hit.onHitGoto, { force: true, canceled: true });
    return 'hit';
  }

  private damage(f: FighterState, dmg: number): void {
    f.hp -= dmg;
    f.lastDamageTaken = dmg;
    if (this.state.settings.training || this.state.settings.infiniteHp[f.idx]) {
      if (f.hp < 1) f.hp = 1;
    }
    if (f.hp <= 0) {
      f.hp = 0;
      if (this.state.round.phase === 'fight') {
        this.state.round.phase = 'ko';
        this.state.round.phaseFrames = 0;
        this.state.round.winner = f.idx === 0 ? 1 : 0;
        this.emit({ type: 'ko', frame: this.state.frame, fighter: f.idx });
      }
    }
  }

  /** Called once hitstop ends: applies stored knockback with the victim's directional influence. */
  private applyKnockback(f: FighterState): void {
    const kb = f.pendingKB!;
    f.pendingKB = null;
    f.vx = kb.vx;
    f.vy = kb.vy;
    if (kb.launched) f.grounded = false;
    this.applyDI(f, kb.di, 'hit');
  }

  /**
   * Directional influence: rotates the trajectory toward the held direction and scales its
   * speed slightly. Bounded so it can reduce but never fully escape the consequences of a hit.
   */
  applyDI(f: FighterState, strength: number, _why: string): void {
    const inp = dirVector(f.input.cur);
    const before = { x: f.vx, y: f.vy };
    if ((inp.x === 0 && inp.y === 0) || strength <= 0) {
      f.lastDI = { frame: this.state.frame, input: inp, before, after: { ...before }, strength: 0 };
      return;
    }
    const bonus = Math.min(CFG.combo.diMaxBonus, f.combo.hits * CFG.combo.diGrowthPerHit);
    const st = strength * (1 + bonus);
    const sp = Math.hypot(f.vx, f.vy);
    if (sp < 0.01) return;
    const ux = f.vx / sp;
    const uy = f.vy / sp;
    if (f.state === 'launched') {
      const cross = ux * inp.y - uy * inp.x; // + = counter-clockwise
      const dot = ux * inp.x + uy * inp.y;
      const ang = clamp(cross, -1, 1) * CFG.di.maxAngle * st;
      const ns = sp * (1 + clamp(dot, -1, 1) * CFG.di.maxSpeedScale * st);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const rx = ux * ca - uy * sa;
      const ry = ux * sa + uy * ca;
      f.vx = q(rx * ns);
      f.vy = q(ry * ns);
    } else {
      // grounded hitstun: DI only adjusts slide distance
      const dot = sign(f.vx) * inp.x;
      f.vx = q(f.vx * (1 + dot * CFG.di.maxSpeedScale * st));
    }
    f.lastDI = { frame: this.state.frame, input: inp, before, after: { x: f.vx, y: f.vy }, strength: st };
  }

  // ---------------------------------------------------------------- burst

  canBurst(f: FighterState): boolean {
    if (this.state.round.phase !== 'fight') return false;
    if (f.burst < CFG.burst.max) return false;
    if (f.state === 'thrown' || f.unburstable && (f.state === 'launched' || f.state === 'hitstun')) return false;
    if (f.state === 'blockstun') return true;
    if (f.state === 'hitstun' || f.state === 'launched' || f.state === 'crumple') return f.combo.hits >= CFG.burst.minComboHits;
    return false;
  }

  private checkBurst(f: FighterState): void {
    if (!pressed(f.input, 'X') || !this.canBurst(f)) return;
    consume(f.input, 'X');
    f.burst = 0;
    f.hitstop = 0;
    f.pendingKB = null;
    f.hitstun = 0;
    f.blockstun = 0;
    f.vx = 0;
    f.vy = 0;
    f.combo.bursted = true;
    f.stats.bursts++;
    this.startMove(f, 'burst', { force: true });
    f.burstPunishable = 44;
    this.emit({ type: 'burst', frame: this.state.frame, fighter: f.idx, x: f.x, y: f.y + 60 });
  }

  // ---------------------------------------------------------------- bookkeeping

  private updateCombos(): void {
    for (const f of this.state.fighters) {
      if (f.combo.hits > 0) {
        if (STUNNED.has(f.state) || f.hitstop > 0 || f.pendingKB) f.combo.frames++;
        else if (f.state !== 'knockdown') f.combo = newCombo(); // combo persists through a knockdown for OTG follow-ups
      }
      if (this.isActionable(f) || f.state === 'blockstun') f.neutralFrames++;
      else f.neutralFrames = 0;
      if (this.state.settings.infiniteHp[f.idx] && f.neutralFrames > 50 && f.hp < f.maxHp) f.hp = f.maxHp;
    }
  }

  private startAdvantage(att: FighterState, def: FighterState): void {
    this.state.adv = { att: att.idx, def: def.idx, attReady: -1, defReady: -1 };
  }

  private trackAdvantage(): void {
    const a = this.state.adv;
    if (!a) return;
    const att = this.state.fighters[a.att];
    const def = this.state.fighters[a.def];
    const ready = (f: FighterState) => this.isActionable(f);
    if (a.attReady < 0 && ready(att)) a.attReady = this.state.frame;
    if (a.defReady < 0 && ready(def)) a.defReady = this.state.frame;
    if (a.attReady >= 0 && a.defReady >= 0) {
      att.advantage = a.defReady - a.attReady;
      this.state.adv = null;
    }
    if (def.state === 'knockdown') this.state.adv = null;
  }

  private updateRound(): void {
    const s = this.state;
    const r = s.round;
    if (s.settings.training) return;
    if (r.phase === 'fight' && !s.settings.noTimer) {
      r.timer--;
      if (r.timer <= 0) {
        const [a, b] = s.fighters;
        const pa = a.hp / a.maxHp;
        const pb = b.hp / b.maxHp;
        r.winner = pa > pb ? 0 : pb > pa ? 1 : -1;
        r.phase = 'ko';
        r.phaseFrames = 0;
        this.emit({ type: 'round', frame: s.frame, phase: 'timeout', winner: r.winner });
      }
    }
    if (r.phase === 'ko' && r.phaseFrames >= CFG.koFrames) {
      if (r.winner >= 0) r.wins[r.winner]++;
      else {
        r.wins[0]++;
        r.wins[1]++;
      }
      const done = r.wins[0] >= CFG.roundsToWin || r.wins[1] >= CFG.roundsToWin;
      if (done) {
        r.phase = 'over';
        r.matchWinner = r.wins[0] === r.wins[1] ? -1 : r.wins[0] > r.wins[1] ? 0 : 1;
        this.emit({ type: 'round', frame: s.frame, phase: 'over', winner: r.matchWinner });
        const w = s.fighters[r.matchWinner];
        if (w && w.hp > 0) this.setState(w, 'win');
      } else {
        r.number++;
        this.resetRound();
        this.emit({ type: 'round', frame: s.frame, phase: 'next', winner: r.winner });
      }
    }
  }
}

// Training-mode dummy behaviour. Everything here produces *inputs* (or toggles the sim's
// training settings), so the dummy obeys exactly the same rules as a player.

import { IN } from '../core/input';
import type { Sim } from '../combat/sim';
import { AIController, DIFFICULTIES } from '../ai/ai';

export type DummyMode = 'stand' | 'crouch' | 'jump' | 'cpu' | 'record' | 'playback';
export type DIMode = 'none' | 'away' | 'toward' | 'up' | 'down' | 'random';
export type TechMode = 'none' | 'neutral' | 'back' | 'forward' | 'random';
export type BurstMode = 'never' | 'after3' | 'after6';
export type ReversalMode = 'none' | 'parry' | 'jump' | 'backdash';

export interface TrainingConfig {
  dummy: DummyMode;
  block: 'none' | 'all' | 'random';
  di: DIMode;
  tech: TechMode;
  burst: BurstMode;
  throwTech: boolean;
  reversal: ReversalMode;
  infiniteHp: boolean;
  infiniteMeter: boolean;
  infiniteBurst: boolean;
  infiniteResources: boolean;
  boxes: boolean;
  frameData: boolean;
  diDisplay: boolean;
  inputs: boolean;
}

export function defaultTraining(): TrainingConfig {
  return {
    dummy: 'stand',
    block: 'none',
    di: 'none',
    tech: 'none',
    burst: 'never',
    throwTech: false,
    reversal: 'none',
    infiniteHp: true,
    infiniteMeter: true,
    infiniteBurst: true,
    infiniteResources: true,
    boxes: false,
    frameData: true,
    diDisplay: true,
    inputs: true,
  };
}

export class TrainingDummy {
  cfg: TrainingConfig;
  recording: number[] = [];
  private playIdx = 0;
  private ai = new AIController(DIFFICULTIES[1], 4242);
  private rand = 1;
  private wasStunned = false;

  constructor(cfg: TrainingConfig) {
    this.cfg = cfg;
  }

  apply(sim: Sim, idx: 0 | 1): void {
    const s = sim.state.settings;
    const other = idx === 0 ? 1 : 0;
    s.autoBlock[idx] = this.cfg.block;
    s.autoBlock[other] = 'none';
    s.infiniteHp = [this.cfg.infiniteHp, this.cfg.infiniteHp];
    s.infiniteMeter = [this.cfg.infiniteMeter, this.cfg.infiniteMeter];
    s.infiniteBurst = [this.cfg.infiniteBurst, this.cfg.infiniteBurst];
    s.infiniteResources = [this.cfg.infiniteResources, this.cfg.infiniteResources];
  }

  private r(): number {
    this.rand = (this.rand * 1103515245 + 12345) & 0x7fffffff;
    return this.rand / 0x7fffffff;
  }

  /** Called with the player's own input while recording (player controls the dummy's slot). */
  record(mask: number): void {
    this.recording.push(mask);
    if (this.recording.length > 60 * 20) this.recording.shift();
  }

  startPlayback(): void {
    this.playIdx = 0;
  }

  input(sim: Sim, idx: 0 | 1): number {
    const f = sim.state.fighters[idx];
    const o = sim.opp(f);
    const away = f.x < o.x ? IN.LEFT : IN.RIGHT;
    const toward = f.x < o.x ? IN.RIGHT : IN.LEFT;
    const stunned = f.state === 'hitstun' || f.state === 'launched' || f.state === 'crumple' || f.pendingKB !== null || f.hitstop > 0 && f.combo.hits > 0;
    let m = 0;

    if (this.cfg.dummy === 'cpu') return this.ai.update(sim, idx);
    if (this.cfg.dummy === 'playback' && this.recording.length) {
      // recordings are stored facing-relative so they mirror correctly
      let r = this.recording[this.playIdx++ % this.recording.length];
      if (f.facing < 0) {
        const l = r & IN.LEFT;
        const rr = r & IN.RIGHT;
        r = (r & ~(IN.LEFT | IN.RIGHT)) | (l ? IN.RIGHT : 0) | (rr ? IN.LEFT : 0);
      }
      return r;
    }

    if (stunned) {
      switch (this.cfg.di) {
        case 'away':
          m |= away;
          break;
        case 'toward':
          m |= toward;
          break;
        case 'up':
          m |= IN.UP;
          break;
        case 'down':
          m |= IN.DOWN;
          break;
        case 'random':
          m |= [away, toward, IN.UP, IN.DOWN, away | IN.UP][Math.floor(this.r() * 5)];
          break;
      }
      const need = this.cfg.burst === 'after3' ? 3 : this.cfg.burst === 'after6' ? 6 : 999;
      if (f.combo.hits >= need && sim.canBurst(f)) m |= IN.X;
      if (f.state === 'launched' && this.cfg.tech !== 'none' && f.y < 50 && f.vy < 0) {
        m |= IN.D;
        const t = this.cfg.tech === 'random' ? ['neutral', 'back', 'forward'][Math.floor(this.r() * 3)] : this.cfg.tech;
        if (t === 'back') m |= away;
        if (t === 'forward') m |= toward;
      }
      this.wasStunned = true;
      return m;
    }
    if (f.state === 'thrown') return this.cfg.throwTech && f.throwTechWindow > 0 && f.throwTechWindow < 8 ? IN.T : 0;

    // reversal on wakeup / after blockstun
    if (this.cfg.reversal !== 'none' && (f.state === 'getup' || f.state === 'blockstun' || (this.wasStunned && sim.isActionable(f)))) {
      this.wasStunned = false;
      if (this.cfg.reversal === 'parry') m |= IN.P;
      if (this.cfg.reversal === 'jump') m |= IN.UP;
      if (this.cfg.reversal === 'backdash') m |= IN.D | away;
      return m;
    }
    if (sim.isActionable(f)) this.wasStunned = false;

    switch (this.cfg.dummy) {
      case 'crouch':
        return IN.DOWN;
      case 'jump':
        return f.grounded ? IN.UP : 0;
      default:
        return 0;
    }
  }
}

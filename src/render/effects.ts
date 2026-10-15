// Event-driven visual effects: hit sparks, impact bursts, shockwaves, dust, speed lines,
// afterimages, projectile trails, configurable auras, screen shake/zoom and flashes.
// Effects only *read* the simulation; they never influence gameplay.

import type { Sim } from '../combat/sim';
import type { CharacterDef, CombatEvent, FighterState } from '../combat/types';
import type { Joints } from './skeleton';

export type SparkStyle = 'classic' | 'star' | 'slash' | 'ring' | 'pixel';
export type AuraRegion = 'core' | 'hands' | 'feet' | 'head' | 'weapon' | 'back';
export type AuraTrigger = 'always' | 'dash' | 'charge' | 'install' | 'super' | 'lowHp' | 'flight' | 'stance' | 'air' | 'heat' | 'attack';
export type AuraShape = 'flame' | 'spark' | 'orb' | 'smoke';

export interface AuraConfig {
  id: string;
  label: string;
  region: AuraRegion;
  trigger: AuraTrigger;
  shape: AuraShape;
  color: string;
  size: number;
  rate: number; // particles per frame
  lifetime: number;
  speed: number;
  rise: number;
  enabled: boolean;
}

export interface FxSettings {
  particleDensity: number; // 0..2
  shake: number; // 0..1
  flashes: number; // 0..1
  zoom: boolean;
  sparkStyle: SparkStyle;
  sparkScale: number;
  afterimages: boolean;
  speedLines: boolean;
  auras: Record<string, AuraConfig[]>;
}

export function defaultAuras(): Record<string, AuraConfig[]> {
  const a = (id: string, label: string, region: AuraRegion, trigger: AuraTrigger, shape: AuraShape, color: string, size: number, rate: number, lifetime = 24, speed = 1, rise = 1): AuraConfig => ({
    id,
    label,
    region,
    trigger,
    shape,
    color,
    size,
    rate,
    lifetime,
    speed,
    rise,
    enabled: true,
  });
  return {
    vesper: [
      a('v_stance', 'Stance glint (hands)', 'hands', 'stance', 'spark', '#ffd166', 3, 0.6, 20, 1.2, 0.5),
      a('v_weapon', 'Blade trail (weapon)', 'weapon', 'attack', 'spark', '#fff3b0', 2.5, 1.2, 12, 0.3, 0),
      a('v_super', 'Super flame (core)', 'core', 'super', 'flame', '#ffb703', 8, 2, 26, 1.2, 2),
    ],
    mirage: [
      a('m_wisp', 'Phase wisps (head)', 'head', 'always', 'smoke', '#c77dff', 5, 0.25, 30, 0.5, 0.8),
      a('m_air', 'Air trail (feet)', 'feet', 'air', 'orb', '#e0aaff', 3, 0.8, 18, 0.2, 0),
      a('m_dash', 'Dash sparks (core)', 'core', 'dash', 'spark', '#9d4edd', 3, 2, 14, 2, 0),
    ],
    solenne: [
      a('s_charge', 'Channel flames (hands)', 'hands', 'charge', 'flame', '#4cc9f0', 7, 2, 24, 1.4, 2),
      a('s_orb', 'Staff motes (weapon)', 'weapon', 'always', 'orb', '#4cc9f0', 2.5, 0.3, 30, 0.4, 0.6),
      a('s_super', 'Arcane surge (core)', 'core', 'super', 'flame', '#f72585', 9, 2.5, 26, 1.4, 2.4),
    ],
    bastion: [
      a('b_flight', 'Thruster plume (back)', 'back', 'flight', 'flame', '#ff9e00', 9, 3, 16, 2.4, -2.6),
      a('b_damage', 'Damage smoke (core)', 'core', 'lowHp', 'smoke', '#6c757d', 9, 0.6, 40, 0.6, 1.4),
      a('b_super', 'Overheat (hands)', 'hands', 'super', 'flame', '#f77f00', 8, 2, 20, 1.2, 1.6),
    ],
    riot: [
      a('r_install', 'Overdrive blaze (core)', 'core', 'install', 'flame', '#ef233c', 11, 3, 24, 1.6, 2.6),
      a('r_heat', 'Heat fists (hands)', 'hands', 'heat', 'flame', '#ffd60a', 5, 1.2, 16, 1, 1.8),
      a('r_dash', 'Dash streaks (feet)', 'feet', 'dash', 'spark', '#ffd60a', 3, 2, 12, 2, 0),
    ],
  };
}

export function defaultFxSettings(): FxSettings {
  return { particleDensity: 1, shake: 1, flashes: 1, zoom: true, sparkStyle: 'classic', sparkScale: 1, afterimages: true, speedLines: true, auras: defaultAuras() };
}

interface Particle {
  kind: 'dot' | 'spark' | 'ring' | 'line' | 'shard' | 'smoke' | 'flame' | 'star' | 'square' | 'bolt' | 'slash' | 'shock';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  rot: number;
  vr: number;
  grav: number;
  drag: number;
  additive: boolean;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface Afterimage {
  joints: Joints;
  charId: string;
  facing: number;
  color: string;
  life: number;
  max: number;
}

const SPARK_COLORS: Record<string, string[]> = {
  light: ['#ffffff', '#ffe8a3'],
  medium: ['#ffffff', '#ffd166', '#ff9f1c'],
  heavy: ['#ffffff', '#ff9f1c', '#ff4d6d'],
  slash: ['#ffffff', '#caf0f8', '#90e0ef'],
  blunt: ['#ffffff', '#ffd166', '#f4a261'],
  electric: ['#ffffff', '#ffee32', '#4cc9f0'],
  fire: ['#fff3b0', '#ff9e00', '#ff4800'],
  ice: ['#ffffff', '#caf0f8', '#48cae4'],
  super: ['#ffffff', '#f72585', '#4cc9f0', '#ffd60a'],
};

export class Effects {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  afterimages: Afterimage[] = [];
  shakeAmt = 0;
  shakeX = 0;
  shakeY = 0;
  flash = 0;
  flashColor = '#ffffff';
  zoomPunch = 0;
  darken = 0;
  banner: { text: string; owner: number; life: number; color: string } | null = null;
  speedLines: { x: number; y: number; dir: number; life: number; color: string }[] = [];
  settings: FxSettings;
  private jointsCache: (Joints | null)[] = [null, null];

  constructor(settings: FxSettings) {
    this.settings = settings;
  }

  clear(): void {
    this.particles = [];
    this.texts = [];
    this.afterimages = [];
    this.speedLines = [];
    this.shakeAmt = this.flash = this.zoomPunch = this.darken = 0;
    this.banner = null;
  }

  private n(count: number): number {
    return Math.max(0, Math.round(count * this.settings.particleDensity));
  }

  private add(p: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y' | 'color'>): void {
    if (this.particles.length > 1400) return;
    this.particles.push({ vx: 0, vy: 0, life: 20, size: 4, grow: 0, rot: 0, vr: 0, grav: 0, drag: 0.92, additive: true, ...p, max: p.life ?? 20 });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount * this.settings.shake);
  }

  flashScreen(alpha: number, color = '#ffffff'): void {
    this.flash = Math.max(this.flash, alpha * this.settings.flashes * 0.85);
    this.flashColor = color;
  }

  text(text: string, x: number, y: number, color: string, size = 26, life = 40): void {
    this.texts.push({ text, x, y, life, max: life, color, size });
  }

  setJoints(idx: number, j: Joints): void {
    this.jointsCache[idx] = j;
  }

  /** Spawns a hit spark using the configured style and the attack's spark type. */
  spark(x: number, y: number, type: string, power: number, dir: number): void {
    const cols = SPARK_COLORS[type] ?? SPARK_COLORS.medium;
    const sc = this.settings.sparkScale * (0.6 + power * 0.5);
    const style = this.settings.sparkStyle;
    const pick = () => cols[Math.floor(Math.random() * cols.length)];
    this.add({ kind: 'ring', x, y, color: cols[0], size: 8 * sc, grow: 3.2 * sc, life: 10 });
    this.add({ kind: 'dot', x, y, color: '#ffffff', size: 20 * sc, grow: -1.5, life: 6 });
    const count = this.n(8 + power * 8);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (4 + Math.random() * 8) * sc;
      const bias = dir * 3;
      const k = style === 'pixel' ? 'square' : style === 'star' ? 'star' : 'spark';
      this.add({ kind: k, x, y, vx: Math.cos(a) * sp + bias, vy: Math.sin(a) * sp, color: pick(), size: (style === 'pixel' ? 5 : 3) * sc, life: 10 + Math.random() * 10, drag: 0.85, rot: a, vr: 0.2 });
    }
    if (style === 'slash' || type === 'slash') {
      const a = -0.6 + Math.random() * 1.2;
      this.add({ kind: 'slash', x, y, color: cols[1] ?? '#fff', size: 70 * sc, rot: a, life: 9, grow: 4 });
    }
    if (style === 'ring' || type === 'heavy' || type === 'super') {
      this.add({ kind: 'ring', x, y, color: cols[2] ?? cols[1], size: 12 * sc, grow: 5 * sc, life: 16 });
      if (type === 'super') this.add({ kind: 'ring', x, y, color: cols[3], size: 4, grow: 7 * sc, life: 22 });
    }
    if (style === 'star') this.add({ kind: 'star', x, y, color: cols[1] ?? '#fff', size: 18 * sc, grow: 2, life: 10, vr: 0.1 });
    if (type === 'electric') for (let i = 0; i < this.n(4); i++) this.add({ kind: 'bolt', x, y, color: '#ffee32', size: 40 * sc, rot: Math.random() * Math.PI * 2, life: 8 });
    if (type === 'fire') for (let i = 0; i < this.n(10); i++) this.add({ kind: 'flame', x, y, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 5, color: pick(), size: 9 * sc, grow: -0.3, life: 22, drag: 0.9, grav: -0.15 });
    if (type === 'ice') for (let i = 0; i < this.n(8); i++) this.add({ kind: 'shard', x, y, vx: (Math.random() - 0.5) * 12, vy: Math.random() * 10, color: pick(), size: 7 * sc, life: 26, grav: 0.4, vr: 0.3, additive: false });
  }

  dust(x: number, y: number, n: number, dir = 0): void {
    for (let i = 0; i < this.n(n); i++) {
      this.add({ kind: 'smoke', x: x + (Math.random() - 0.5) * 30, y: y + 4, vx: (Math.random() - 0.5) * 4 - dir * 2, vy: Math.random() * 2.5, color: '#c9b79c', size: 7 + Math.random() * 8, grow: 0.4, life: 26 + Math.random() * 14, drag: 0.9, additive: false });
    }
  }

  shockwave(x: number, y: number, power: number, color = '#ffe8a3'): void {
    this.add({ kind: 'shock', x, y, color, size: 10, grow: 9 * power, life: 18 });
    this.dust(x, y, 10 * power);
    for (let i = 0; i < this.n(8 * power); i++) {
      this.add({ kind: 'square', x, y: y + 4, vx: (Math.random() - 0.5) * 16, vy: 4 + Math.random() * 9, color: '#8d7b68', size: 4 + Math.random() * 4, grav: 0.5, life: 34, drag: 0.98, additive: false, vr: 0.4 });
    }
  }

  addSpeedLines(x: number, y: number, dir: number, color: string): void {
    if (!this.settings.speedLines) return;
    for (let i = 0; i < this.n(8); i++) this.speedLines.push({ x: x - dir * Math.random() * 60, y: y + (Math.random() - 0.5) * 110, dir, life: 10 + Math.random() * 6, color });
  }

  addAfterimage(j: Joints, f: FighterState, color: string, life = 16): void {
    if (!this.settings.afterimages) return;
    this.afterimages.push({ joints: JSON.parse(JSON.stringify(j)), charId: f.charId, facing: f.facing, color, life, max: life });
    if (this.afterimages.length > 40) this.afterimages.shift();
  }

  /** Converts simulation events into effects. */
  handleEvents(events: CombatEvent[], sim: Sim, chars: CharacterDef[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const power = e.super ? 3 : e.strength === 'H' || e.strength === 'S' ? 2 : e.strength === 'M' ? 1.3 : 0.8;
          const att = sim.state.fighters[e.attacker];
          this.spark(e.x, e.y, e.spark ?? (e.strength === 'H' ? 'heavy' : e.strength === 'L' ? 'light' : 'medium'), power + (e.counter ? 0.6 : 0), Math.sign(sim.state.fighters[e.victim].x - att.x));
          this.shake(Math.min(14, 2 + e.damage / 14 + (e.launch ? 3 : 0)));
          if (e.counter) this.text('COUNTER', e.x, e.y + 70, '#ff4d6d', 24);
          if (e.launch && e.damage > 40) {
            this.addSpeedLines(e.x, e.y, Math.sign(sim.state.fighters[e.victim].x - att.x) || 1, '#ffffff');
            if (this.settings.zoom) this.zoomPunch = Math.max(this.zoomPunch, 0.06);
          }
          if (e.super || e.damage >= 120) {
            this.flashScreen(0.35);
            if (this.settings.zoom) this.zoomPunch = Math.max(this.zoomPunch, 0.1);
          }
          break;
        }
        case 'block':
          this.add({ kind: 'ring', x: e.x, y: e.y, color: '#4cc9f0', size: 10, grow: 3, life: 10 });
          for (let i = 0; i < this.n(6); i++) this.add({ kind: 'spark', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, color: '#90e0ef', size: 3, life: 10 });
          this.shake(2);
          break;
        case 'parry':
          this.add({ kind: 'ring', x: e.x, y: e.y, color: '#ffffff', size: 14, grow: 6, life: 14 });
          this.add({ kind: 'star', x: e.x, y: e.y, color: '#bde0fe', size: 30, grow: 2, life: 12, vr: 0.2 });
          this.text('PARRY', e.x, e.y + 60, '#bde0fe', 26);
          this.flashScreen(0.25, '#bde0fe');
          break;
        case 'armor':
          this.add({ kind: 'ring', x: e.x, y: e.y, color: '#f77f00', size: 16, grow: 3, life: 12 });
          this.text('ARMOR', e.x, e.y + 50, '#fcbf49', 18, 26);
          break;
        case 'clash':
          this.spark(e.x, e.y, 'super', 2.5, 0);
          this.add({ kind: 'star', x: e.x, y: e.y, color: '#ffffff', size: 40, grow: 3, life: 14 });
          this.text('CLASH', e.x, e.y + 70, '#ffffff', 28);
          this.flashScreen(0.45);
          this.shake(10);
          break;
        case 'projClash':
          this.spark(e.x, e.y, 'electric', 1.2, 0);
          break;
        case 'projDestroyed':
          for (let i = 0; i < this.n(8); i++) this.add({ kind: 'spark', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9, color: '#ffffff', size: 3, life: 12 });
          break;
        case 'reflect':
          this.add({ kind: 'ring', x: e.x, y: e.y, color: '#80ffdb', size: 10, grow: 5, life: 14 });
          this.text('REFLECT', e.x, e.y + 50, '#80ffdb', 20);
          break;
        case 'throw':
          this.shake(4);
          break;
        case 'throwTech':
          this.spark(e.x, e.y, 'electric', 1.4, 0);
          this.text('TECH', e.x, e.y + 80, '#80ffdb', 24);
          break;
        case 'burst': {
          const c = chars[e.fighter]?.palette.aura ?? '#ffffff';
          this.add({ kind: 'ring', x: e.x, y: e.y, color: '#ffffff', size: 20, grow: 14, life: 20 });
          this.add({ kind: 'ring', x: e.x, y: e.y, color: c, size: 10, grow: 10, life: 26 });
          for (let i = 0; i < this.n(40); i++) {
            const a = Math.random() * Math.PI * 2;
            this.add({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14, color: c, size: 4, life: 24, drag: 0.9 });
          }
          this.text('BURST', e.x, e.y + 90, c, 34, 50);
          this.flashScreen(0.6, c);
          this.shake(12);
          break;
        }
        case 'counterStance':
          this.text('COUNTER!', sim.state.fighters[e.fighter].x, sim.state.fighters[e.fighter].y + 150, '#ffd166', 28);
          this.flashScreen(0.3, '#ffd166');
          break;
        case 'wallBounce':
          this.shockwave(e.x, e.y + 60, 1.4, '#ffffff');
          this.text('WALL BOUNCE', e.x, e.y + 130, '#ffd166', 18, 30);
          this.shake(9);
          break;
        case 'groundBounce':
          this.shockwave(e.x, 0, 1.4);
          this.text('GROUND BOUNCE', e.x, 140, '#ffd166', 18, 30);
          this.shake(8);
          break;
        case 'land':
          this.dust(e.x, 0, e.hard ? 8 : 4);
          break;
        case 'knockdown':
          this.dust(e.x, 0, 14);
          this.shake(4);
          break;
        case 'tech':
          this.text(e.kind === 'air' ? 'RECOVER' : 'TECH ROLL', sim.state.fighters[e.fighter].x, sim.state.fighters[e.fighter].y + 140, '#80ffdb', 16, 26);
          break;
        case 'jump':
          if (e.air) this.add({ kind: 'ring', x: e.x, y: e.y + 4, color: chars[e.fighter]?.palette.aura ?? '#fff', size: 8, grow: 2.5, life: 12 });
          else this.dust(e.x, 0, 5);
          break;
        case 'dash': {
          const f = sim.state.fighters[e.fighter];
          if (e.kind === 'airdash') this.add({ kind: 'ring', x: e.x, y: e.y + 60, color: chars[e.fighter]?.palette.aura ?? '#fff', size: 10, grow: 3, life: 12 });
          else this.dust(e.x, 0, 6, e.dir);
          const j = this.jointsCache[f.idx];
          if (j) this.addAfterimage(j, f, chars[e.fighter]?.palette.aura ?? '#fff', 14);
          break;
        }
        case 'super': {
          const f = sim.state.fighters[e.fighter];
          const mv = sim.move(f);
          this.darken = 1;
          this.banner = { text: mv?.name ?? 'SUPER', owner: e.fighter, life: 70, color: chars[e.fighter]?.palette.aura ?? '#fff' };
          this.add({ kind: 'ring', x: f.x, y: f.y + 70, color: '#ffffff', size: 10, grow: 10, life: 22 });
          this.flashScreen(0.4, chars[e.fighter]?.palette.aura ?? '#fff');
          if (this.settings.zoom) this.zoomPunch = 0.12;
          break;
        }
        case 'install':
          if (e.on) this.text('OVERDRIVE', sim.state.fighters[e.fighter].x, sim.state.fighters[e.fighter].y + 160, '#ef233c', 26, 50);
          break;
        case 'teleport': {
          const c = chars[e.fighter]?.palette.aura ?? '#fff';
          for (const [x, y, out] of [
            [e.fromX, e.fromY, true],
            [e.x, e.y, false],
          ] as [number, number, boolean][]) {
            for (let i = 0; i < this.n(16); i++) {
              const a = Math.random() * Math.PI * 2;
              const r = out ? 0 : 60;
              this.add({ kind: 'spark', x: x + Math.cos(a) * r, y: y + 60 + Math.sin(a) * r, vx: Math.cos(a) * (out ? 6 : -4), vy: Math.sin(a) * (out ? 6 : -4), color: c, size: 3, life: 14 });
            }
            this.add({ kind: 'ring', x, y: y + 60, color: c, size: out ? 50 : 5, grow: out ? -3 : 4, life: 14 });
          }
          break;
        }
        case 'fx': {
          const f = sim.state.fighters[e.fighter];
          const c = chars[e.fighter]?.palette.aura ?? '#fff';
          const j = this.jointsCache[f.idx];
          switch (e.cue) {
            case 'speedlines':
              this.addSpeedLines(f.x, f.y + 60, f.facing, c);
              break;
            case 'afterimage':
              if (j) this.addAfterimage(j, f, c, 18);
              break;
            case 'flash':
              this.add({ kind: 'slash', x: f.x + f.facing * 60, y: f.y + 70, color: '#ffffff', size: 140, rot: f.facing * 0.1, life: 10, grow: 6 });
              this.flashScreen(0.15);
              break;
            case 'shockwave':
              this.shockwave(f.x + f.facing * 40, 0, 1.6);
              this.shake(7);
              break;
            case 'thruster':
              for (let i = 0; i < this.n(14); i++) this.add({ kind: 'flame', x: f.x - f.facing * 20, y: f.y + 40, vx: -f.facing * (2 + Math.random() * 4), vy: -2 - Math.random() * 3, color: i % 2 ? '#ff9e00' : '#ffba08', size: 10, grow: -0.3, life: 18 });
              break;
            case 'steam':
              for (let i = 0; i < this.n(10); i++) this.add({ kind: 'smoke', x: f.x, y: f.y + 90, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, color: '#dee2e6', size: 8, grow: 0.5, life: 30, additive: false });
              break;
            case 'superflash':
              this.add({ kind: 'ring', x: f.x, y: f.y + 70, color: c, size: 120, grow: -5, life: 22 });
              break;
            case 'charge':
            case 'stance':
            case 'armor':
            case 'wind':
            case 'install':
              this.add({ kind: 'ring', x: f.x, y: f.y + 60, color: e.cue === 'armor' ? '#f77f00' : c, size: 60, grow: -2.5, life: 16 });
              break;
            case 'burst':
              break;
          }
          break;
        }
        case 'spawn':
          this.add({ kind: 'ring', x: e.x, y: e.y, color: chars[e.owner]?.palette.aura ?? '#fff', size: 4, grow: 2.5, life: 10 });
          break;
        case 'ko':
          this.flashScreen(0.8);
          this.shake(16);
          if (this.settings.zoom) this.zoomPunch = 0.15;
          break;
        case 'feint':
          this.text('FEINT', sim.state.fighters[e.fighter].x, sim.state.fighters[e.fighter].y + 140, '#e9c46a', 16, 22);
          break;
        case 'pushblock':
          this.add({ kind: 'ring', x: sim.state.fighters[e.fighter].x, y: sim.state.fighters[e.fighter].y + 60, color: '#4cc9f0', size: 20, grow: 6, life: 14 });
          break;
        case 'flight':
          if (e.on) this.add({ kind: 'ring', x: sim.state.fighters[e.fighter].x, y: sim.state.fighters[e.fighter].y + 20, color: '#ff9e00', size: 10, grow: 4, life: 14 });
          break;
        default:
          break;
      }
    }
  }

  /** Continuous effects derived from fighter state (auras, trails). Called once per sim frame. */
  tickFighter(f: FighterState, j: Joints, c: CharacterDef, sim: Sim): void {
    this.jointsCache[f.idx] = j;
    const auras = this.settings.auras[c.id] ?? [];
    const m = sim.move(f);
    for (const a of auras) {
      if (!a.enabled) continue;
      let on = false;
      switch (a.trigger) {
        case 'always':
          on = true;
          break;
        case 'dash':
          on = f.state === 'dash' || f.state === 'airdash' || f.state === 'run' || f.state === 'backdash';
          break;
        case 'charge':
          on = !!m?.charge && f.moveFrame === m.charge.holdFrame;
          break;
        case 'install':
          on = !!f.install;
          break;
        case 'super':
          on = m?.kind === 'super';
          break;
        case 'lowHp':
          on = f.hp < f.maxHp * 0.35;
          break;
        case 'flight':
          on = f.flying;
          break;
        case 'stance':
          on = !!f.stance;
          break;
        case 'air':
          on = !f.grounded && f.state !== 'launched';
          break;
        case 'heat':
          on = (f.resources.heat ?? 0) >= 50;
          break;
        case 'attack':
          on = !!m && (m.hits?.some((h) => f.moveFrame >= h.frames[0] && f.moveFrame <= h.frames[1]) ?? false);
          break;
      }
      if (!on) continue;
      const rate = a.rate * this.settings.particleDensity;
      let count = Math.floor(rate);
      if (Math.random() < rate - count) count++;
      for (let i = 0; i < count; i++) {
        const pts = this.regionPoints(a.region, j, f, c);
        const p = pts[Math.floor(Math.random() * pts.length)];
        const kind = a.shape === 'flame' ? 'flame' : a.shape === 'orb' ? 'dot' : a.shape === 'smoke' ? 'smoke' : 'spark';
        this.add({
          kind,
          x: p.x + (Math.random() - 0.5) * 10,
          y: p.y + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * a.speed * 2,
          vy: a.rise * (0.5 + Math.random() * 0.8),
          color: a.color,
          size: a.size * (0.6 + Math.random() * 0.6),
          grow: a.shape === 'smoke' ? 0.3 : -a.size / a.lifetime,
          life: a.lifetime * (0.7 + Math.random() * 0.5),
          drag: 0.94,
          additive: a.shape !== 'smoke',
        });
      }
    }
    // speed afterimages for very fast movement
    if (this.settings.afterimages && (f.state === 'airdash' || (m?.tags?.includes('fast') ?? false) || Math.abs(f.vx) > 11) && sim.state.frame % 3 === 0) {
      this.addAfterimage(j, f, c.palette.aura, 10);
    }
  }

  private regionPoints(r: AuraRegion, j: Joints, f: FighterState, c: CharacterDef): { x: number; y: number }[] {
    switch (r) {
      case 'hands':
        return [j.handF, j.handB];
      case 'feet':
        return [j.footF, j.footB];
      case 'head':
        return [j.head];
      case 'weapon': {
        if (c.id === 'vesper') {
          const dx = j.handF.x - j.elbowF.x;
          const dy = j.handF.y - j.elbowF.y;
          const L = Math.hypot(dx, dy) || 1;
          return [0.3, 0.6, 0.9].map((k) => ({ x: j.handF.x + (dx / L) * 82 * k, y: j.handF.y + (dy / L) * 82 * k }));
        }
        if (c.id === 'solenne') {
          const tilt = Math.max(-0.5, Math.min(0.5, (j.handB.x - j.elbowB.x) / 60)) * f.facing;
          return [{ x: j.handB.x + Math.sin(tilt) * 70 * f.facing, y: j.handB.y + 70 }];
        }
        return [j.handF];
      }
      case 'back':
        return [{ x: j.neck.x - f.facing * 22, y: j.neck.y - 56 }];
      default:
        return [j.hip, { x: (j.hip.x + j.neck.x) / 2, y: (j.hip.y + j.neck.y) / 2 }, j.neck];
    }
  }

  /** Projectile trails, emitted once per sim frame. */
  tickProjectiles(sim: Sim): void {
    for (const p of sim.state.projectiles) {
      const def = sim.projDef(p.owner, p.defId);
      if (!def) continue;
      const active = p.age >= (def.delay ?? 0);
      switch (def.style) {
        case 'fire':
          for (let i = 0; i < this.n(2 + p.charge * 3); i++) this.add({ kind: 'flame', x: p.x, y: p.y, vx: -p.vx * 0.2 + (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 2, color: i % 2 ? '#ff9e00' : '#ff4800', size: 10 * (p.data.scale ?? 1), grow: -0.4, life: 18 });
          break;
        case 'bullet':
          this.add({ kind: 'line', x: p.x, y: p.y, vx: 0, vy: 0, color: def.color, size: 30, rot: Math.atan2(p.vy, p.vx), life: 5 });
          break;
        case 'orb':
        case 'storm':
          if (Math.random() < 0.6) this.add({ kind: 'spark', x: p.x + (Math.random() - 0.5) * 40, y: p.y + (Math.random() - 0.5) * 40, color: def.color, size: 3, life: 14, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 });
          break;
        case 'meteor':
          for (let i = 0; i < this.n(4); i++) this.add({ kind: 'flame', x: p.x, y: p.y, vx: -p.vx * 0.3 + (Math.random() - 0.5) * 3, vy: -p.vy * 0.3, color: i % 2 ? '#ff9e00' : '#ffd60a', size: 22, grow: -0.8, life: 22 });
          break;
        case 'quake':
          if (sim.state.frame % 2 === 0) this.dust(p.x, 0, 2, Math.sign(p.vx));
          break;
        case 'spike':
          if (!active && sim.state.frame % 3 === 0) this.add({ kind: 'ring', x: p.x, y: 2, color: '#90e0ef', size: 30, grow: -1, life: 8 });
          if (active && p.age === (def.delay ?? 0)) this.shockwave(p.x, 0, 0.8, '#caf0f8');
          break;
        case 'pillar':
          if (!active && sim.state.frame % 3 === 0) this.add({ kind: 'ring', x: p.x, y: 4, color: '#ff4800', size: 50, grow: -2, life: 8 });
          if (active) for (let i = 0; i < this.n(4); i++) this.add({ kind: 'flame', x: p.x + (Math.random() - 0.5) * 80, y: Math.random() * 240, vx: 0, vy: 4 + Math.random() * 4, color: i % 2 ? '#ff4800' : '#ffba08', size: 18, grow: -0.6, life: 20 });
          break;
        case 'hook':
          this.add({ kind: 'dot', x: p.x, y: p.y, color: def.color, size: 4, life: 8 });
          break;
        case 'decoy':
          if (p.age === (def.delay ?? 0)) this.spark(p.x, p.y + 60, 'electric', 2, 0);
          break;
        case 'laser':
          this.add({ kind: 'line', x: p.x, y: p.y, color: def.color, size: 22, rot: Math.atan2(p.vy, p.vx), life: 4 });
          break;
        default:
          break;
      }
    }
  }

  /** Advance one simulation frame. */
  update(): void {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= p.drag;
      p.vy = p.vy * p.drag - p.grav;
      p.size = Math.max(0, p.size + p.grow);
      p.rot += p.vr;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.size > 0.1);
    for (const t of this.texts) {
      t.life--;
      t.y += 0.8;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const a of this.afterimages) a.life--;
    this.afterimages = this.afterimages.filter((a) => a.life > 0);
    for (const s of this.speedLines) {
      s.life--;
      s.x += s.dir * 9;
    }
    this.speedLines = this.speedLines.filter((s) => s.life > 0);
    this.shakeAmt *= 0.82;
    if (this.shakeAmt < 0.3) this.shakeAmt = 0;
    this.shakeX = (Math.random() - 0.5) * this.shakeAmt * 2;
    this.shakeY = (Math.random() - 0.5) * this.shakeAmt * 2;
    this.flash *= 0.8;
    this.zoomPunch *= 0.86;
    this.darken = Math.max(0, this.darken - 0.035);
    if (this.banner && --this.banner.life <= 0) this.banner = null;
  }

  drawWorld(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const s of this.speedLines) {
      ctx.globalAlpha = Math.min(1, s.life / 8) * 0.8;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.dir * 90, s.y);
      ctx.stroke();
    }
    for (const p of this.particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 1.4);
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      switch (p.kind) {
        case 'dot':
        case 'flame':
        case 'smoke':
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'spark': {
          const sp = Math.hypot(p.vx, p.vy);
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * (1.5 + sp * 0.05), p.y - p.vy * (1.5 + sp * 0.05));
          ctx.stroke();
          break;
        }
        case 'square':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
          break;
        case 'shard':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(0, p.size);
          ctx.lineTo(p.size * 0.4, 0);
          ctx.lineTo(0, -p.size);
          ctx.lineTo(-p.size * 0.4, 0);
          ctx.fill();
          ctx.restore();
          break;
        case 'ring':
        case 'shock':
          ctx.lineWidth = p.kind === 'shock' ? 5 * t + 1 : 3 * t + 1;
          ctx.beginPath();
          if (p.kind === 'shock') ctx.ellipse(p.x, p.y, p.size, p.size * 0.22, 0, 0, Math.PI * 2);
          else ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'line':
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(p.rot) * p.size, p.y - Math.sin(p.rot) * p.size);
          ctx.stroke();
          break;
        case 'slash':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(-p.size, 0);
          ctx.quadraticCurveTo(0, p.size * 0.12 * t + 3, p.size, 0);
          ctx.quadraticCurveTo(0, -p.size * 0.04, -p.size, 0);
          ctx.fill();
          ctx.restore();
          break;
        case 'star': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 ? p.size * 0.25 : p.size;
            const a = (i / 8) * Math.PI * 2;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'bolt': {
          ctx.lineWidth = 2;
          ctx.beginPath();
          let x = p.x;
          let y = p.y;
          ctx.moveTo(x, y);
          for (let i = 0; i < 5; i++) {
            x += Math.cos(p.rot) * p.size / 5 + (Math.random() - 0.5) * 10;
            y += Math.sin(p.rot) * p.size / 5 + (Math.random() - 0.5) * 10;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          break;
        }
      }
    }
    ctx.restore();
  }
}

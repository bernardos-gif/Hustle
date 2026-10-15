// Render-only animation state layered on top of the simulation: pose smoothing between states,
// double-jump flips, secondary motion (scarves, coat tails, headbands, cables) and attack smear
// trails. None of this feeds back into gameplay — hitboxes always follow the frame data.

import type { Sim } from '../combat/sim';
import type { CharacterDef, CombatEvent, FighterState } from '../combat/types';
import { blendPose, computePose, type Pose } from './poses';
import { buildJoints, weaponTip, type Joints, type Vec } from './skeleton';

interface ChainDef {
  anchor: (j: Joints, f: FighterState) => Vec;
  segs: number;
  len: number;
  width: [number, number];
  color: (c: CharacterDef) => string;
  gravity?: number;
  /** Drawn in front of the body instead of behind it. */
  front?: boolean;
}

const back = (j: Joints, f: FighterState, dx: number, dy: number): Vec => ({ x: j.hip.x - f.facing * dx, y: j.hip.y + dy });
const headBack = (j: Joints, f: FighterState, dx: number, dy: number): Vec => ({ x: j.head.x - f.facing * dx, y: j.head.y + dy });

const CHAINS: Record<string, ChainDef[]> = {
  vesper: [
    { anchor: (j, f) => back(j, f, 6, 8), segs: 5, len: 10, width: [9, 4], color: (c) => c.palette.primary },
    { anchor: (j, f) => headBack(j, f, 2, j.headR * 1.3), segs: 4, len: 6, width: [5, 2], color: (c) => c.palette.accent, gravity: 0.35 },
  ],
  mirage: [{ anchor: (j, f) => ({ x: j.neck.x - f.facing * 4, y: j.neck.y - 2 }), segs: 9, len: 10, width: [8, 3], color: (c) => c.palette.secondary, gravity: 0.45 }],
  solenne: [
    { anchor: (j, f) => back(j, f, 4, 12), segs: 6, len: 9, width: [6, 2], color: (c) => c.palette.secondary },
    { anchor: (j, f) => headBack(j, f, j.headR * 0.8, 2), segs: 4, len: 8, width: [7, 3], color: () => '#f1faee' },
  ],
  bastion: [{ anchor: (j, f) => ({ x: j.neck.x - f.facing * 30, y: j.neck.y - 40 }), segs: 5, len: 10, width: [4, 3], color: () => '#212529' }],
  riot: [
    { anchor: (j, f) => headBack(j, f, j.headR * 0.9, 4), segs: 4, len: 8, width: [4, 2], color: (c) => c.palette.secondary, gravity: 0.3 },
    { anchor: (j, f) => headBack(j, f, j.headR * 0.9, 1), segs: 3, len: 8, width: [4, 2], color: (c) => c.palette.secondary, gravity: 0.3 },
  ],
};

/** Frames for a full double-jump front flip. */
const FLIP = 13;

export interface Chain {
  def: ChainDef;
  pts: Vec[];
  prev: Vec[];
}

export class FighterAnim {
  pose: Pose | null = null;
  joints: Joints | null = null;
  flip = 0;
  hitFlash = 0;
  chains: Chain[] = [];
  smear: Vec[] = [];
  smearColor = '#ffffff';
  private lastAnchor: Vec | null = null;

  reset(): void {
    this.pose = null;
    this.flip = 0;
    this.hitFlash = 0;
    this.chains = [];
    this.smear = [];
    this.lastAnchor = null;
  }

  tick(sim: Sim, f: FighterState, c: CharacterDef, events: CombatEvent[]): Joints {
    for (const e of events) {
      if (e.type === 'jump' && e.fighter === f.idx && e.air) this.flip = FLIP;
      if (e.type === 'hit' && e.victim === f.idx) this.hitFlash = 3;
    }
    if (this.flip > 0) this.flip--;
    if (f.state !== 'air') this.flip = 0; // landing or getting hit ends the flip
    if (this.hitFlash > 0 && f.hitstop === 0) this.hitFlash--;

    const target = computePose(sim, f, sim.state.frame);
    // gameplay-timed states snap; locomotion states ease between poses
    const snappy = f.state === 'move' || f.state === 'hitstun' || f.state === 'launched' || f.state === 'blockstun' || f.state === 'thrown' || f.state === 'techroll' || f.state === 'knockdown' || f.state === 'crumple';
    let pose: Pose;
    if (!this.pose || snappy) pose = target;
    else {
      const prev = { ...this.pose, rot: wrapNear(this.pose.rot, target.rot) };
      pose = blendPose(prev, target, 0.45);
    }
    this.pose = pose;
    const drawn = { ...pose };
    if (this.flip > 0) drawn.rot += (1 - this.flip / FLIP) * 360;
    const j = buildJoints(f, c, drawn);
    this.joints = j;
    this.tickChains(f, c, j);
    this.tickSmear(sim, f, c, j);
    return j;
  }

  private tickChains(f: FighterState, c: CharacterDef, j: Joints): void {
    const defs = CHAINS[c.id] ?? [];
    if (this.chains.length !== defs.length) this.chains = defs.map((def) => ({ def, pts: [], prev: [] }));
    const a0 = defs[0]?.anchor(j, f);
    const teleported = a0 && this.lastAnchor && Math.hypot(a0.x - this.lastAnchor.x, a0.y - this.lastAnchor.y) > 90;
    this.lastAnchor = a0 ?? null;
    for (const ch of this.chains) {
      const a = ch.def.anchor(j, f);
      if (!ch.pts.length || teleported) {
        ch.pts = Array.from({ length: ch.def.segs + 1 }, (_, i) => ({ x: a.x - f.facing * i * ch.def.len, y: a.y - i * 2 }));
        ch.prev = ch.pts.map((p) => ({ ...p }));
      }
      const g = ch.def.gravity ?? 0.6;
      ch.pts[0] = a;
      for (let i = 1; i < ch.pts.length; i++) {
        const p = ch.pts[i];
        const pv = ch.prev[i];
        const vx = (p.x - pv.x) * 0.86;
        const vy = (p.y - pv.y) * 0.86;
        ch.prev[i] = { ...p };
        p.x += vx - f.facing * 0.15; // slight trailing breeze
        p.y += vy - g;
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < ch.pts.length; i++) {
          const p0 = ch.pts[i - 1];
          const p1 = ch.pts[i];
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = (d - ch.def.len) / d;
          p1.x -= dx * k;
          p1.y -= dy * k;
        }
      }
    }
  }

  private tickSmear(sim: Sim, f: FighterState, c: CharacterDef, j: Joints): void {
    const m = f.state === 'move' ? sim.move(f) : null;
    const active = m?.hits?.find((h) => !h.grabHit && h.boxes.length && f.moveFrame >= h.frames[0] && f.moveFrame <= h.frames[1] + 1);
    if (!m || !active) {
      this.smear = this.smear.slice(2);
      return;
    }
    if (f.hitstop > 0) return; // frozen during hitstop
    // the limb closest to the active hitbox is the one that is striking
    const b = sim.toWorld(f, active.boxes[0]);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const cands = [weaponTip(j, c.id), j.handF, j.footF, j.handB, j.footB];
    let best = cands[0];
    let bd = Infinity;
    for (const p of cands) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    this.smear.push({ ...best });
    if (this.smear.length > 5) this.smear.shift();
    this.smearColor = m.kind === 'super' ? c.palette.aura : '#ffffff';
  }
}

function wrapNear(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return b + d;
}

export function drawChains(ctx: CanvasRenderingContext2D, anim: FighterAnim, c: CharacterDef, front: boolean, outline: string): void {
  for (const ch of anim.chains) {
    if (!!ch.def.front !== front || ch.pts.length < 2) continue;
    const col = ch.def.color(c);
    for (const [color, extra] of [
      [outline, 2],
      [col, 0],
    ] as [string, number][]) {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      for (let i = 1; i < ch.pts.length; i++) {
        const t = (i - 1) / (ch.pts.length - 2 || 1);
        ctx.lineWidth = ch.def.width[0] + (ch.def.width[1] - ch.def.width[0]) * t + extra;
        ctx.beginPath();
        ctx.moveTo(ch.pts[i - 1].x, ch.pts[i - 1].y);
        ctx.lineTo(ch.pts[i].x, ch.pts[i].y);
        ctx.stroke();
      }
    }
  }
}

/** Crescent-shaped motion smear following the striking limb. */
export function drawSmear(ctx: CanvasRenderingContext2D, anim: FighterAnim): void {
  const s = anim.smear;
  if (s.length < 2) return;
  ctx.fillStyle = anim.smearColor;
  ctx.beginPath();
  const n = s.length;
  // build a ribbon that tapers toward the oldest point
  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = s[i];
    const q = s[Math.min(n - 1, i + 1)];
    const r = s[Math.max(0, i - 1)];
    let dx = q.x - r.x;
    let dy = q.y - r.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const w = 2 + (i / (n - 1)) * 13;
    left.push({ x: p.x - dy * w, y: p.y + dx * w });
    right.push({ x: p.x + dy * w, y: p.y - dx * w });
  }
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (const p of right.reverse()) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
}

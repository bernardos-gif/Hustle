// Converts a Pose into world-space joint positions and draws a stylised fighter with
// character-specific silhouettes and accessories.

import type { CharacterDef, FighterState } from '../combat/types';
import type { Pose } from './poses';

export interface Vec {
  x: number;
  y: number;
}

export interface Joints {
  hip: Vec;
  neck: Vec;
  head: Vec;
  headR: number;
  shoulder: Vec;
  elbowF: Vec;
  handF: Vec;
  elbowB: Vec;
  handB: Vec;
  kneeF: Vec;
  footF: Vec;
  kneeB: Vec;
  footB: Vec;
}

const rad = (d: number) => (d * Math.PI) / 180;

export function buildJoints(f: FighterState, c: CharacterDef, pose: Pose): Joints {
  const h = c.height;
  const thigh = 0.245 * h;
  const shin = 0.245 * h;
  const torso = 0.3 * h;
  const ua = 0.165 * h;
  const fa = 0.16 * h;
  const headR = 0.078 * h;
  const fc = f.facing;
  const v = (a: number, len: number): Vec => ({ x: Math.sin(rad(a)) * len * fc, y: -Math.cos(rad(a)) * len });
  const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
  const hip: Vec = { x: f.x + fc * pose.hipX * h, y: f.y + (thigh + shin) * (1 - pose.hipY) + pose.lift * h };
  const neck = add(hip, { x: Math.sin(rad(pose.lean)) * torso * fc, y: Math.cos(rad(pose.lean)) * torso });
  const head = add(neck, { x: Math.sin(rad(pose.lean + pose.head)) * headR * 1.25 * fc, y: Math.cos(rad(pose.lean + pose.head)) * headR * 1.25 });
  const shoulder = add(neck, { x: -Math.sin(rad(pose.lean)) * 0.03 * h * fc, y: -0.03 * h });
  const elbowF = add(shoulder, v(pose.aF[0], ua));
  const handF = add(elbowF, v(pose.aF[0] + pose.aF[1], fa));
  const elbowB = add(shoulder, v(pose.aB[0], ua));
  const handB = add(elbowB, v(pose.aB[0] + pose.aB[1], fa));
  const kneeF = add(hip, v(pose.lF[0], thigh));
  const footF = add(kneeF, v(pose.lF[0] + pose.lF[1], shin));
  const kneeB = add(hip, v(pose.lB[0], thigh));
  const footB = add(kneeB, v(pose.lB[0] + pose.lB[1], shin));
  const j: Joints = { hip, neck, head, headR, shoulder, elbowF, handF, elbowB, handB, kneeF, footF, kneeB, footB };
  // whole-body rotation around the hips
  if (pose.rot) {
    const a = -rad(pose.rot) * fc;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const k of Object.keys(j) as (keyof Joints)[]) {
      if (k === 'headR' || k === 'hip') continue;
      const p = j[k] as Vec;
      const dx = p.x - hip.x;
      const dy = p.y - hip.y;
      (j[k] as Vec) = { x: hip.x + dx * ca - dy * sa, y: hip.y + dx * sa + dy * ca };
    }
  }
  // plant the lowest point on the ground when grounded and upright
  if (f.grounded && Math.abs(pose.rot) < 30) {
    const low = Math.min(j.footF.y, j.footB.y);
    const dy = f.y - low;
    if (Math.abs(dy) < h * 0.6) for (const k of Object.keys(j) as (keyof Joints)[]) if (k !== 'headR') (j[k] as Vec).y += dy;
  } else if (Math.abs(pose.rot) >= 60) {
    // lying down: keep the body above the floor
    let low = Infinity;
    for (const k of Object.keys(j) as (keyof Joints)[]) if (k !== 'headR') low = Math.min(low, (j[k] as Vec).y);
    const dy = f.y + 4 - low;
    for (const k of Object.keys(j) as (keyof Joints)[]) if (k !== 'headR') (j[k] as Vec).y += dy;
  }
  return j;
}

export interface DrawStyle {
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  alpha: number;
  outline: string;
  /** Silhouette-only draw (afterimages). */
  flat?: string;
  extendTo?: number | null; // piston arm reach in world x
  flash?: number; // hit flash 0..1
}

type Ctx = CanvasRenderingContext2D;

function line(ctx: Ctx, a: Vec, b: Vec, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function limb(ctx: Ctx, a: Vec, b: Vec, c: Vec, w: number, color: string, outline: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = w + 4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

/** Draws a fighter in world space (the canvas transform maps world units, y up). */
export function drawFighter(ctx: Ctx, f: FighterState, c: CharacterDef, j: Joints, st: DrawStyle, t: number): void {
  ctx.save();
  ctx.globalAlpha = st.alpha;
  const flat = st.flat;
  const heavy = c.id === 'bastion';
  const lw = heavy ? 15 : c.id === 'riot' ? 10 : 9;
  const P = flat ?? st.primary;
  const S = flat ?? st.secondary;
  const A = flat ?? st.accent;
  const SK = flat ?? st.skin;
  const O = flat ?? st.outline;
  const fc = f.facing;

  // back limbs first (darker)
  const back = flat ?? shade(st.primary, -0.25);
  limb(ctx, j.hip, j.kneeB, j.footB, lw, back, O);
  limb(ctx, j.shoulder, j.elbowB, j.handB, lw - 2, back, O);

  // character back accessories
  if (c.id === 'solenne' && !flat) {
    // staff held upright in the back hand, tilting with the arm
    const tilt = Math.max(-0.5, Math.min(0.5, (j.handB.x - j.elbowB.x) / 60)) * fc;
    const a = { x: j.handB.x - Math.sin(tilt) * 55 * fc, y: j.handB.y - 55 };
    const b = { x: j.handB.x + Math.sin(tilt) * 70 * fc, y: j.handB.y + 70 };
    line(ctx, a, b, 5, '#8d6e63');
    ctx.fillStyle = st.secondary;
    ctx.shadowColor = st.secondary;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (c.id === 'bastion') {
    // jetpack
    const bx = j.neck.x - fc * 22;
    const by = j.neck.y - 30;
    ctx.fillStyle = flat ?? '#495057';
    ctx.fillRect(bx - 12, by - 26, 24, 44);
    if (!flat && f.flying) {
      ctx.fillStyle = Math.floor(t / 2) % 2 ? '#ffba08' : '#f48c06';
      ctx.beginPath();
      ctx.moveTo(bx - 9, by - 26);
      ctx.lineTo(bx + 9, by - 26);
      ctx.lineTo(bx, by - 26 - 26 - Math.random() * 14);
      ctx.fill();
    }
  }

  // torso
  ctx.lineCap = 'round';
  const tw = heavy ? 30 : c.id === 'riot' ? 18 : 16;
  line(ctx, j.hip, j.neck, tw + 4, O);
  line(ctx, j.hip, j.neck, tw, P);
  // belt / sash
  const mid = { x: (j.hip.x * 3 + j.neck.x) / 4, y: (j.hip.y * 3 + j.neck.y) / 4 };
  ctx.fillStyle = S;
  ctx.beginPath();
  ctx.arc(mid.x, mid.y, tw / 2.2, 0, Math.PI * 2);
  ctx.fill();

  if (c.id === 'solenne' && !flat) {
    // robe skirt
    ctx.fillStyle = st.primary;
    ctx.strokeStyle = O;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(j.hip.x - 10, j.hip.y + 8);
    ctx.lineTo(j.hip.x + 10, j.hip.y + 8);
    const kx = (j.kneeF.x + j.kneeB.x) / 2;
    const ky = Math.min(j.kneeF.y, j.kneeB.y);
    ctx.lineTo(Math.max(j.kneeF.x, j.kneeB.x, kx + 18), ky - 6);
    ctx.lineTo(Math.min(j.kneeF.x, j.kneeB.x, kx - 18), ky - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // front leg
  limb(ctx, j.hip, j.kneeF, j.footF, lw, P, O);
  // boots
  ctx.fillStyle = flat ?? shade(st.primary, -0.4);
  ctx.beginPath();
  ctx.arc(j.footF.x, j.footF.y, lw * 0.7, 0, Math.PI * 2);
  ctx.arc(j.footB.x, j.footB.y, lw * 0.7, 0, Math.PI * 2);
  ctx.fill();

  // head
  ctx.fillStyle = O;
  ctx.beginPath();
  ctx.arc(j.head.x, j.head.y, j.headR + 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = heavy ? flat ?? '#adb5bd' : SK;
  if (heavy) {
    ctx.fillRect(j.head.x - j.headR, j.head.y - j.headR, j.headR * 2, j.headR * 2);
    if (!flat) {
      ctx.fillStyle = st.secondary;
      ctx.fillRect(j.head.x - j.headR * 0.2 + fc * j.headR * 0.3, j.head.y - 2, j.headR * 0.9, 6);
    }
  } else {
    ctx.beginPath();
    ctx.arc(j.head.x, j.head.y, j.headR, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!flat) {
    if (c.id === 'vesper') {
      // tricorn-ish hat brim
      ctx.fillStyle = st.primary;
      ctx.beginPath();
      ctx.ellipse(j.head.x, j.head.y + j.headR * 0.55, j.headR * 1.5, j.headR * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(j.head.x - j.headR * 0.8, j.head.y + j.headR * 0.5, j.headR * 1.6, j.headR * 0.8);
      ctx.fillStyle = st.accent;
      ctx.fillRect(j.head.x - j.headR * 0.8, j.head.y + j.headR * 0.5, j.headR * 1.6, 3);
    } else if (c.id === 'mirage') {
      // hood
      ctx.fillStyle = st.primary;
      ctx.beginPath();
      ctx.arc(j.head.x - fc * 3, j.head.y + 2, j.headR * 1.1, Math.PI * 0.1, Math.PI * 0.9);
      ctx.fill();
      // eye glow
      ctx.fillStyle = st.accent;
      ctx.fillRect(j.head.x + fc * j.headR * 0.4 - 3, j.head.y, 6, 3);
    } else if (c.id === 'riot') {
      // spiky hair + headband
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.15 + i * 0.17);
        ctx.moveTo(j.head.x + Math.cos(a) * j.headR * 0.7, j.head.y + Math.sin(a) * j.headR * 0.7);
        ctx.lineTo(j.head.x + Math.cos(a) * j.headR * 1.7 - fc * 6, j.head.y + Math.sin(a) * j.headR * 1.7);
        ctx.lineTo(j.head.x + Math.cos(a + 0.25) * j.headR * 0.7, j.head.y + Math.sin(a + 0.25) * j.headR * 0.7);
      }
      ctx.fill();
      ctx.fillStyle = st.secondary;
      ctx.fillRect(j.head.x - j.headR, j.head.y + 2, j.headR * 2, 4);
    } else if (c.id === 'solenne') {
      ctx.fillStyle = '#f1faee';
      ctx.beginPath();
      ctx.arc(j.head.x - fc * 4, j.head.y + 2, j.headR * 1.05, Math.PI * 0.05, Math.PI * 0.95);
      ctx.fill();
      ctx.fillStyle = st.secondary;
      ctx.beginPath();
      ctx.arc(j.head.x, j.head.y + j.headR * 0.6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // front arm (+ piston extension)
  let hand = j.handF;
  if (st.extendTo != null) {
    hand = { x: st.extendTo, y: j.handF.y };
    line(ctx, j.elbowF, hand, lw + 4, O);
    line(ctx, j.elbowF, hand, lw - 2, '#868e96');
    // piston rings
    for (let k = 1; k < 4; k++) {
      const px = j.elbowF.x + ((hand.x - j.elbowF.x) * k) / 4;
      line(ctx, { x: px, y: hand.y - 9 }, { x: px, y: hand.y + 9 }, 4, S);
    }
  }
  limb(ctx, j.shoulder, j.elbowF, j.handF, lw - 1, P, O);
  // fists
  ctx.fillStyle = c.id === 'riot' ? A : heavy ? S : SK;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, heavy ? 11 : 6.5, 0, Math.PI * 2);
  ctx.arc(j.handB.x, j.handB.y, heavy ? 10 : 6, 0, Math.PI * 2);
  ctx.fill();
  if (heavy) {
    // shoulder pads
    ctx.fillStyle = S;
    ctx.beginPath();
    ctx.arc(j.shoulder.x, j.shoulder.y, 15, 0, Math.PI * 2);
    ctx.fill();
  }

  if (c.id === 'vesper') {
    // rapier from the front hand along the forearm
    const dx = j.handF.x - j.elbowF.x;
    const dy = j.handF.y - j.elbowF.y;
    const L = Math.hypot(dx, dy) || 1;
    const tip = { x: j.handF.x + (dx / L) * 82, y: j.handF.y + (dy / L) * 82 };
    if (f.stance === 'draw' && f.state !== 'move') {
      // sheathed: blade along the hip
      line(ctx, { x: j.hip.x - fc * 40, y: j.hip.y - 6 }, { x: j.hip.x + fc * 30, y: j.hip.y + 10 }, 5, flat ?? '#6c584c');
    } else {
      line(ctx, j.handF, tip, 3, flat ?? '#e9ecef');
      ctx.fillStyle = flat ?? st.secondary;
      ctx.beginPath();
      ctx.arc(j.handF.x, j.handF.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (st.flash && st.flash > 0 && !flat) {
    ctx.globalAlpha = st.flash * st.alpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw + 6;
    ctx.beginPath();
    ctx.moveTo(j.hip.x, j.hip.y);
    ctx.lineTo(j.neck.x, j.neck.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  r = f(r);
  g = f(g);
  b = f(b);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

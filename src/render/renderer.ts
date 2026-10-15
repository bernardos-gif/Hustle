// Draws the stage, fighters, projectiles and effects with a dynamic camera.

import { CFG } from '../combat/config';
import type { Sim } from '../combat/sim';
import type { CharacterDef, FighterState, ProjectileState } from '../combat/types';
import { Effects } from './effects';
import { computePose } from './poses';
import { buildJoints, drawFighter, type Joints } from './skeleton';

export const VIEW_W = 1280;
export const VIEW_H = 720;
export const GROUND_Y = 620;

export class Camera {
  x = 700;
  y = 0;
  zoom = 1;

  follow(sim: Sim, punch: number): void {
    const [a, b] = sim.state.fighters;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const span = maxX - minX + 360;
    let z = Math.min(1.35, Math.max(0.78, VIEW_W / span));
    const top = Math.max(a.y, b.y);
    if (top > 250) z = Math.min(z, Math.max(0.7, (GROUND_Y - 60) / (top + 180)));
    z *= 1 + punch;
    this.zoom += (z - this.zoom) * 0.12;
    const halfW = VIEW_W / 2 / this.zoom;
    let cx = (minX + maxX) / 2;
    cx = Math.max(CFG.stage.left - 60 + halfW, Math.min(CFG.stage.right + 60 - halfW, cx));
    if (halfW * 2 > CFG.stage.width + 120) cx = (CFG.stage.left + CFG.stage.right) / 2;
    this.x += (cx - this.x) * 0.2;
    const ty = Math.max(0, top - 300) * 0.6;
    this.y += (ty - this.y) * 0.1;
  }

  /** World (y up) -> screen. */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.x) * this.zoom + VIEW_W / 2, y: GROUND_Y - (y - this.y) * this.zoom };
  }

  apply(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    ctx.setTransform(this.zoom, 0, 0, -this.zoom, VIEW_W / 2 - this.x * this.zoom + sx, GROUND_Y + this.y * this.zoom + sy);
  }
}

export interface RenderOptions {
  hideHud: boolean;
  boxes: boolean;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  camera = new Camera();
  fx: Effects;
  joints: (Joints | null)[] = [null, null];
  private hitFlash = [0, 0];
  private stars: { x: number; y: number; s: number }[] = [];

  constructor(ctx: CanvasRenderingContext2D, fx: Effects) {
    this.ctx = ctx;
    this.fx = fx;
    for (let i = 0; i < 90; i++) this.stars.push({ x: Math.random() * 2400 - 500, y: 200 + Math.random() * 700, s: Math.random() * 2 + 0.5 });
  }

  /** Called once per simulation frame. */
  tick(sim: Sim, chars: CharacterDef[], events: ReturnType<Sim['step']>): void {
    for (const f of sim.state.fighters) {
      const j = buildJoints(f, chars[f.idx], computePose(sim, f, sim.state.frame));
      this.joints[f.idx] = j;
      this.fx.tickFighter(f, j, chars[f.idx], sim);
    }
    for (const e of events) if (e.type === 'hit') this.hitFlash[e.victim] = 1;
    this.fx.handleEvents(events, sim, chars);
    this.fx.tickProjectiles(sim);
    this.fx.update();
    this.hitFlash = this.hitFlash.map((v) => v * 0.7);
  }

  draw(sim: Sim, chars: CharacterDef[], time: number): void {
    const ctx = this.ctx;
    this.camera.follow(sim, this.fx.zoomPunch);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackground(time);
    this.camera.apply(ctx, this.fx.shakeX, this.fx.shakeY);
    this.drawStage();
    // afterimages
    for (const a of this.fx.afterimages) {
      const c = chars.find((x) => x.id === a.charId);
      if (!c) continue;
      const f = { facing: a.facing, charId: a.charId, stance: null, state: 'idle', flying: false } as unknown as FighterState;
      drawFighter(ctx, f, c, a.joints, { primary: '', secondary: '', accent: '', skin: '', outline: '', alpha: (a.life / a.max) * 0.45, flat: a.color }, time);
    }
    // super darken behind fighters
    if (this.fx.darken > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(0,0,10,${this.fx.darken * 0.55})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
      this.camera.apply(ctx, this.fx.shakeX, this.fx.shakeY);
    }
    for (const p of sim.state.projectiles) this.drawProjectile(sim, p, time);
    // draw the fighter that is attacking on top
    const order = [...sim.state.fighters].sort((a, b) => (a.state === 'move' ? 1 : 0) - (b.state === 'move' ? 1 : 0));
    for (const f of order) this.drawFighterState(sim, f, chars[f.idx], time);
    this.fx.drawWorld(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // floating texts in screen space
    for (const t of this.fx.texts) {
      const p = this.camera.toScreen(t.x, t.y);
      ctx.globalAlpha = Math.min(1, t.life / 12);
      ctx.font = `900 italic ${t.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      ctx.strokeText(t.text, p.x, p.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  drawOverlay(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.fx.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.8, this.fx.flash);
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
    const b = this.fx.banner;
    if (b) {
      const t = 1 - b.life / 70;
      const slide = Math.min(1, t * 6);
      const y = 300;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life / 10);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, y - 40, VIEW_W, 80);
      ctx.fillStyle = b.color;
      ctx.fillRect(0, y - 40, VIEW_W, 4);
      ctx.fillRect(0, y + 36, VIEW_W, 4);
      ctx.font = '900 italic 52px system-ui, sans-serif';
      ctx.textAlign = b.owner === 0 ? 'left' : 'right';
      const x = b.owner === 0 ? -400 + slide * 480 : VIEW_W + 400 - slide * 480;
      ctx.fillStyle = '#fff';
      ctx.fillText(b.text.toUpperCase(), x, y + 18);
      ctx.restore();
    }
  }

  private drawBackground(time: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#0b0a1f');
    g.addColorStop(0.55, '#2a1650');
    g.addColorStop(1, '#5a2a52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // parallax stars
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      const x = (s.x - this.camera.x * 0.2 * s.s) % 1800;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(time * 0.02 + s.x);
      ctx.fillRect(x < 0 ? x + 1800 : x, VIEW_H - s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // distant skyline
    ctx.fillStyle = '#1a1033';
    for (let i = 0; i < 24; i++) {
      const bx = i * 110 - ((this.camera.x * 0.35) % 110) - 120;
      const h = 80 + ((i * 73) % 140);
      ctx.fillRect(bx, GROUND_Y - h - 40, 90, h + 40);
      ctx.fillStyle = '#ffcf6b22';
      for (let w = 0; w < 6; w++) if ((i * 7 + w * 3) % 5 === 0) ctx.fillRect(bx + 12 + (w % 3) * 24, GROUND_Y - h - 20 + Math.floor(w / 3) * 30, 10, 14);
      ctx.fillStyle = '#1a1033';
    }
    // moon
    ctx.fillStyle = '#ffe8d6';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(1000 - this.camera.x * 0.05, 140, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawStage(): void {
    const ctx = this.ctx;
    const L = CFG.stage.left;
    const R = CFG.stage.right;
    // floor
    ctx.fillStyle = '#231942';
    ctx.fillRect(L - 400, -400, R - L + 800, 400);
    ctx.fillStyle = '#5e548e';
    ctx.fillRect(L - 400, -6, R - L + 800, 6);
    ctx.strokeStyle = '#9f86c022';
    ctx.lineWidth = 2;
    for (let x = L - 400; x < R + 400; x += 70) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (x - 700) * 0.5, -300);
      ctx.stroke();
    }
    // walls
    for (const wx of [L, R]) {
      const dir = wx === L ? -1 : 1;
      ctx.fillStyle = '#3d2c6b';
      ctx.fillRect(wx + (dir < 0 ? -60 : 0), 0, 60, 900);
      ctx.fillStyle = '#e0aaff55';
      ctx.fillRect(wx + (dir < 0 ? -4 : 0), 0, 4, 900);
    }
  }

  private drawFighterState(sim: Sim, f: FighterState, c: CharacterDef, time: number): void {
    const ctx = this.ctx;
    const j = this.joints[f.idx] ?? buildJoints(f, c, computePose(sim, f, time));
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(f.x, 1, c.width * 0.8 * Math.max(0.4, 1 - f.y / 500), 6, 0, 0, Math.PI * 2);
    ctx.fill();
    let extendTo: number | null = null;
    const m = sim.move(f);
    if (m?.pose === 'piston') {
      const h = m.hits?.[0];
      if (h && f.moveFrame >= h.frames[0] && f.moveFrame <= h.frames[1] + 6 && h.boxes[0]) extendTo = f.x + f.facing * (h.boxes[0].x + h.boxes[0].w);
    }
    // invulnerability shimmer
    const invuln = f.wakeInvuln > 0 || f.airRecoverInvuln > 0 || f.state === 'techroll' || (m?.invuln?.some((iv) => f.moveFrame >= iv.frames[0] && f.moveFrame <= iv.frames[1]) ?? false);
    const pal = c.palette;
    const alpha = invuln ? 0.65 + 0.25 * Math.sin(time * 0.6) : 1;
    drawFighter(ctx, f, c, j, { primary: pal.primary, secondary: pal.secondary, accent: pal.accent, skin: pal.skin, outline: '#0b0a14', alpha, extendTo, flash: this.hitFlash[f.idx] }, time);
    // player marker
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = this.camera.toScreen(f.x, f.y + c.height + 34);
    ctx.fillStyle = f.idx === 0 ? '#4cc9f0' : '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y - 8);
    ctx.lineTo(p.x + 6, p.y - 8);
    ctx.lineTo(p.x, p.y);
    ctx.fill();
    ctx.restore();
    this.camera.apply(ctx, this.fx.shakeX, this.fx.shakeY);
  }

  private drawProjectile(sim: Sim, p: ProjectileState, time: number): void {
    const ctx = this.ctx;
    const def = sim.projDef(p.owner, p.defId);
    if (!def) return;
    const b = sim.projBox(p);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const active = p.age >= (def.delay ?? 0);
    ctx.save();
    switch (def.style) {
      case 'bullet':
      case 'laser':
        ctx.fillStyle = def.color;
        ctx.shadowColor = def.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        break;
      case 'fire': {
        const r = Math.max(b.w, b.h) / 2;
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 1.3);
        g.addColorStop(0, '#fff3b0');
        g.addColorStop(0.4, '#ff9e00');
        g.addColorStop(1, 'rgba(255,72,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'orb':
      case 'storm': {
        const r = Math.max(b.w, b.h) / 2;
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.3, def.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        if (def.style === 'storm') ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
        else ctx.arc(cx, cy, r * (1 + 0.1 * Math.sin(time * 0.3)), 0, Math.PI * 2);
        ctx.fill();
        if (def.style === 'storm' && Math.floor(time / 3) % 4 === 0) {
          ctx.strokeStyle = '#ffee32';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          let y = cy;
          let x = cx;
          while (y > 0) {
            y -= 30;
            x += (Math.random() - 0.5) * 30;
            ctx.lineTo(x, Math.max(0, y));
          }
          ctx.stroke();
        }
        break;
      }
      case 'beam': {
        if (!active) break;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 4;
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.moveTo(b.x, cy);
          for (let x = b.x; x < b.x + b.w; x += 20) ctx.lineTo(x, cy + (Math.random() - 0.5) * b.h);
          ctx.stroke();
        }
        break;
      }
      case 'spike':
      case 'pillar':
      case 'wall': {
        if (!active) {
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 0.8);
          ctx.fillStyle = def.color;
          ctx.fillRect(b.x, -3, b.w, 6);
          break;
        }
        const grow = Math.min(1, (p.age - (def.delay ?? 0) + 1) / 5);
        ctx.fillStyle = def.color;
        ctx.globalAlpha = def.style === 'pillar' ? 0.75 : 0.9;
        if (def.style === 'pillar') {
          const g = ctx.createLinearGradient(0, 0, 0, b.h);
          g.addColorStop(0, '#ffba08');
          g.addColorStop(1, 'rgba(255,72,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(b.x, 0, b.w, b.h * grow);
        } else {
          ctx.beginPath();
          ctx.moveTo(b.x, 0);
          ctx.lineTo(cx, b.h * grow);
          ctx.lineTo(b.x + b.w, 0);
          ctx.fill();
          if (def.style === 'wall') ctx.fillRect(b.x + 4, 0, b.w - 8, b.h * grow * 0.85);
        }
        break;
      }
      case 'meteor': {
        const r = b.w / 2;
        const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
        g.addColorStop(0, '#fff3b0');
        g.addColorStop(0.5, '#ff9e00');
        g.addColorStop(1, '#6a040f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'blast': {
        ctx.globalCompositeOperation = 'lighter';
        const r = Math.max(b.w, b.h) / 2 * Math.min(1, p.age / 4);
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, def.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'hook': {
        const o = sim.state.fighters[p.owner];
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x + o.facing * 20, o.y + 70);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.fillStyle = '#e0aaff';
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'anchor':
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 0.2);
        ctx.beginPath();
        ctx.ellipse(p.x, 4, 28, 8, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, 4);
        ctx.lineTo(p.x, 70);
        ctx.stroke();
        break;
      case 'decoy': {
        const o = this.joints[p.owner];
        ctx.globalAlpha = active ? 0.9 : 0.35 + 0.2 * Math.sin(time);
        ctx.fillStyle = def.color;
        if (active) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath();
          ctx.arc(cx, cy, 70 * Math.min(1, (p.age - (def.delay ?? 0)) / 4), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(p.x - 16, 0, 32, 110);
          void o;
        }
        break;
      }
      case 'star':
        ctx.fillStyle = def.color;
        ctx.translate(cx, cy);
        ctx.rotate(time * 0.5);
        ctx.fillRect(-7, -7, 14, 14);
        break;
      case 'drone':
        ctx.fillStyle = '#495057';
        ctx.fillRect(cx - 18, cy - 10, 36, 20);
        ctx.fillStyle = (p.data.cool ?? 0) < 15 ? '#ff0054' : def.color;
        ctx.beginPath();
        ctx.arc(cx + p.facing * 10, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#adb5bd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 24, cy + 14);
        ctx.lineTo(cx + 24, cy + 14);
        ctx.stroke();
        break;
      case 'quake':
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(b.x, 0);
        ctx.lineTo(cx, b.h);
        ctx.lineTo(b.x + b.w, 0);
        ctx.fill();
        break;
      default:
        ctx.fillStyle = def.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.restore();
  }
}

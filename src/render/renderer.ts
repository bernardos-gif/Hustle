// Draws the stage, fighters, projectiles and effects with a dynamic camera.
// The world is rendered into a low-resolution buffer and scaled up with nearest-neighbour
// filtering, and fighters go through a pixel pass (hard alpha + 1px sprite outline), which gives
// the whole battle a crisp pixel-art look while hitboxes stay at full simulation precision.

import { CFG } from '../combat/config';
import type { Sim } from '../combat/sim';
import type { CharacterDef, CombatEvent, FighterState, ProjectileState } from '../combat/types';
import { pixelText } from '../ui/pixelfont';
import { FighterAnim, drawChains, drawSmear } from './anim';
import { Effects } from './effects';
import { drawFighter, shade, type Joints } from './skeleton';

export const VIEW_W = 1280;
export const VIEW_H = 720;
export const GROUND_Y = 620;
/** Size of one world "pixel" on screen. */
export const PX = 3;
export const LOW_W = Math.ceil(VIEW_W / PX);
export const LOW_H = Math.ceil(VIEW_H / PX);
const OUTLINE: [number, number, number] = [11, 7, 20];

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

  /** Applies the world transform; `k` scales to a lower-resolution buffer. Translation snaps to
   *  whole buffer pixels so the pixel art does not shimmer while the camera moves. */
  apply(ctx: CanvasRenderingContext2D, sx: number, sy: number, k = 1): void {
    const z = this.zoom * k;
    ctx.setTransform(z, 0, 0, -z, Math.round((VIEW_W / 2 - this.x * this.zoom + sx) * k), Math.round((GROUND_Y + this.y * this.zoom + sy) * k));
  }
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

/** Hard-edges every sprite on the canvas (no half-transparent pixels) and adds a 1px outline. */
export function pixelate(ctx: CanvasRenderingContext2D, w: number, h: number, outline: [number, number, number] = OUTLINE): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    if (a >= 100) {
      solid[i] = 1;
      d[i * 4 + 3] = 255;
    } else d[i * 4 + 3] = 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) {
        d[i * 4] = outline[0];
        d[i * 4 + 1] = outline[1];
        d[i * 4 + 2] = outline[2];
        d[i * 4 + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Small deterministic PRNG for stable background layouts. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

interface Building {
  x: number;
  w: number;
  h: number;
  lights: number[];
  sign: number;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  camera = new Camera();
  fx: Effects;
  anims: [FighterAnim, FighterAnim] = [new FighterAnim(), new FighterAnim()];
  private world: HTMLCanvasElement;
  wctx: CanvasRenderingContext2D;
  private sprites: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private stars: { x: number; y: number; b: number }[] = [];
  private far: Building[] = [];
  private near: Building[] = [];

  constructor(ctx: CanvasRenderingContext2D, fx: Effects) {
    this.ctx = ctx;
    this.fx = fx;
    [this.world, this.wctx] = makeCanvas(LOW_W, LOW_H);
    [this.sprites, this.sctx] = makeCanvas(LOW_W, LOW_H);
    const r = seeded(7);
    for (let i = 0; i < 70; i++) this.stars.push({ x: Math.floor(r() * 700), y: Math.floor(r() * 150), b: r() });
    let x = 0;
    while (x < 900) {
      const w = 14 + Math.floor(r() * 22);
      this.far.push({ x, w, h: 30 + Math.floor(r() * 70), lights: Array.from({ length: 12 }, () => (r() < 0.3 ? 1 : 0)), sign: -1 });
      x += w + 2 + Math.floor(r() * 6);
    }
    x = 0;
    while (x < 1100) {
      const w = 22 + Math.floor(r() * 30);
      this.near.push({ x, w, h: 22 + Math.floor(r() * 50), lights: Array.from({ length: 16 }, () => (r() < 0.25 ? 1 : 0)), sign: r() < 0.35 ? Math.floor(r() * 3) : -1 });
      x += w + 6 + Math.floor(r() * 14);
    }
  }

  get joints(): (Joints | null)[] {
    return [this.anims[0].joints, this.anims[1].joints];
  }

  resetAnims(): void {
    for (const a of this.anims) a.reset();
  }

  /** Called once per simulation frame. */
  tick(sim: Sim, chars: CharacterDef[], events: CombatEvent[]): void {
    for (const f of sim.state.fighters) {
      const j = this.anims[f.idx].tick(sim, f, chars[f.idx], events);
      this.fx.tickFighter(f, j, chars[f.idx], sim);
    }
    this.fx.handleEvents(events, sim, chars);
    this.fx.tickProjectiles(sim);
    this.fx.update();
  }

  draw(sim: Sim, chars: CharacterDef[], time: number): void {
    const ctx = this.ctx;
    const w = this.wctx;
    const k = 1 / PX;
    this.camera.follow(sim, this.fx.zoomPunch);
    for (const f of sim.state.fighters) if (!this.anims[f.idx].joints) this.anims[f.idx].tick(sim, f, chars[f.idx], []);
    w.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackground(time);
    this.camera.apply(w, this.fx.shakeX, this.fx.shakeY, k);
    this.drawStage();
    // shadows
    for (const f of sim.state.fighters) {
      const c = chars[f.idx];
      w.fillStyle = 'rgba(5,3,15,0.45)';
      w.beginPath();
      w.ellipse(f.x, 1, c.width * 0.8 * Math.max(0.4, 1 - f.y / 500), 7, 0, 0, Math.PI * 2);
      w.fill();
    }
    // afterimages keep their translucency, so they go straight onto the world layer
    for (const a of this.fx.afterimages) {
      const c = chars.find((x) => x.id === a.charId);
      if (!c) continue;
      const f = { facing: a.facing, charId: a.charId, stance: null, state: 'idle', flying: false } as unknown as FighterState;
      drawFighter(w, f, c, a.joints, { primary: '', secondary: '', accent: '', skin: '', outline: '', alpha: (a.life / a.max) * 0.5, flat: a.color }, time);
    }
    if (this.fx.darken > 0) {
      w.save();
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.fillStyle = `rgba(0,0,10,${this.fx.darken * 0.55})`;
      w.fillRect(0, 0, LOW_W, LOW_H);
      w.restore();
      this.camera.apply(w, this.fx.shakeX, this.fx.shakeY, k);
    }
    for (const p of sim.state.projectiles) this.drawProjectile(sim, p, time);

    // fighters: drawn on their own layer, then pixelated
    const s = this.sctx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, LOW_W, LOW_H);
    const order = [...sim.state.fighters].sort((a, b) => (a.state === 'move' ? 1 : 0) - (b.state === 'move' ? 1 : 0));
    for (const f of order) {
      // hitstop shake on the fighter that got hit
      const victim = f.hitstop > 0 && (f.state === 'hitstun' || f.state === 'launched' || f.state === 'blockstun' || f.state === 'crumple');
      const shake = victim ? (time % 2 ? 1 : -1) * 3 * PX : 0;
      this.camera.apply(s, this.fx.shakeX + shake, this.fx.shakeY, k);
      this.drawFighterState(s, sim, f, chars[f.idx], time, f.idx === 1 && chars[0].id === chars[1].id);
    }
    pixelate(s, LOW_W, LOW_H);
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.drawImage(this.sprites, 0, 0);
    this.camera.apply(w, this.fx.shakeX, this.fx.shakeY, k);
    this.fx.drawWorld(w);

    // upscale to the screen
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world, 0, 0, LOW_W * PX, LOW_H * PX);
    // player markers and floating combat text in crisp screen space
    for (const f of sim.state.fighters) {
      const c = chars[f.idx];
      const p = this.camera.toScreen(f.x, f.y + c.height + 30);
      const bob = Math.floor(time / 10) % 2;
      ctx.fillStyle = '#0b0718';
      ctx.fillRect(Math.round(p.x) - 9, Math.round(p.y) - 12 + bob * 2, 18, 3);
      ctx.fillStyle = f.idx === 0 ? '#4cc9f0' : '#ff4d6d';
      for (let r = 0; r < 4; r++) ctx.fillRect(Math.round(p.x) - 6 + r * 1.5 * 2, Math.round(p.y) - 9 + r * 3 + bob * 2, 12 - r * 6 + 0, 3);
      pixelText(ctx, f.idx === 0 ? 'P1' : 'P2', p.x, p.y - 26 + bob * 2, { scale: 2, color: f.idx === 0 ? '#4cc9f0' : '#ff4d6d', align: 'center' });
    }
    for (const t of this.fx.texts) {
      const p = this.camera.toScreen(t.x, t.y);
      const pop = t.max - t.life < 4 ? 1 : 0;
      pixelText(ctx, t.text, p.x, p.y, { scale: Math.max(2, Math.round(t.size / 8)) + pop, color: t.color, align: 'center', valign: 'middle', alpha: Math.min(1, t.life / 12) });
    }
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
      ctx.fillStyle = 'rgba(5,3,15,0.82)';
      ctx.fillRect(0, y - 44, VIEW_W, 88);
      ctx.fillStyle = b.color;
      for (let x = 0; x < VIEW_W; x += 12) {
        ctx.fillRect(x, y - 44, 6, 4);
        ctx.fillRect(x + 6, y + 40, 6, 4);
      }
      const x = b.owner === 0 ? -500 + slide * 580 : VIEW_W + 500 - slide * 580;
      pixelText(ctx, b.text.toUpperCase(), x, y, { scale: 6, color: '#ffffff', align: b.owner === 0 ? 'left' : 'right', valign: 'middle', shadow: b.color });
      ctx.restore();
    }
  }

  /** Pixel-art backdrop drawn directly in buffer pixels: dithered sky, stars, moon, two
   *  parallax skyline layers with flickering windows and neon signs. */
  private drawBackground(time: number): void {
    const w = this.wctx;
    const groundY = Math.round((GROUND_Y + this.camera.y * this.camera.zoom) / PX);
    const bands = ['#0b0a1f', '#130e2e', '#1d1340', '#2b1852', '#3e1f5f', '#572765', '#733066'];
    const bh = Math.ceil(groundY / bands.length);
    for (let i = 0; i < bands.length; i++) {
      w.fillStyle = bands[i];
      w.fillRect(0, i * bh, LOW_W, bh + 1);
      // checkerboard dither into the next band
      if (i < bands.length - 1) {
        w.fillStyle = bands[i + 1];
        for (let y = i * bh + bh - 2; y < i * bh + bh; y++) for (let x = (y % 2); x < LOW_W; x += 2) w.fillRect(x, y, 1, 1);
      }
    }
    const camX = this.camera.x;
    for (const s of this.stars) {
      const x = ((((s.x - camX * 0.04) % 700) + 700) % 700) - 100;
      if (x < 0 || x >= LOW_W) continue;
      const on = s.b > 0.85 ? Math.floor(time / 20 + s.b * 10) % 3 !== 0 : true;
      if (!on) continue;
      w.fillStyle = s.b > 0.7 ? '#ffffff' : '#9a8cc7';
      w.fillRect(x, s.y, 1, 1);
      if (s.b > 0.95) {
        w.fillStyle = '#9a8cc788';
        w.fillRect(x - 1, s.y, 3, 1);
        w.fillRect(x, s.y - 1, 1, 3);
      }
    }
    // moon
    const mx = Math.round(330 - camX * 0.015);
    const my = 58;
    const R = 15;
    for (let dy = -R - 3; dy <= R + 3; dy++) {
      for (let dx = -R - 3; dx <= R + 3; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= R) w.fillStyle = (dx + dy) % 7 === 0 && d < R - 3 && dx < 0 ? '#e7c9b4' : d > R - 1.5 ? '#f3d9c4' : '#ffe8d6';
        else if (d <= R + 3 && (dx + dy) % 2 === 0) w.fillStyle = '#ffe8d622';
        else continue;
        w.fillRect(mx + dx, my + dy, 1, 1);
      }
    }
    const skyline = (layer: Building[], par: number, color: string, base: number, wrap: number, lit: string) => {
      const off = (((camX * par) % wrap) + wrap) % wrap;
      for (const b of layer) {
        for (const rep of [0, wrap]) {
          const x = Math.round(b.x - off + rep - 40);
          if (x > LOW_W || x + b.w < 0) continue;
          const top = base - b.h;
          w.fillStyle = color;
          w.fillRect(x, top, b.w, b.h);
          w.fillRect(x + Math.floor(b.w / 2), top - 4, 1, 4); // antenna
          // windows
          for (let i = 0; i < b.lights.length; i++) {
            const wx = x + 3 + (i % 4) * Math.floor((b.w - 4) / 4);
            const wy = top + 4 + Math.floor(i / 4) * 7;
            if (wy > base - 4) continue;
            const flick = b.lights[i] && Math.floor(time / 90 + i * 7 + b.x) % 11 !== 0;
            w.fillStyle = flick ? lit : '#00000033';
            w.fillRect(wx, wy, 2, 2);
          }
          if (b.sign >= 0) {
            const col = ['#ff4d6d', '#4cc9f0', '#ffd60a'][b.sign];
            const on = Math.floor(time / 6 + b.x) % 40 !== 0;
            w.fillStyle = on ? col : '#2b1852';
            w.fillRect(x + 2, top + 2, Math.max(4, b.w - 4), 2);
          }
        }
      }
    };
    skyline(this.far, 0.12, '#1a1033', groundY - 6, 900, '#ffcf6b55');
    skyline(this.near, 0.32, '#24174a', groundY, 1100, '#ffcf6baa');
    // haze line above the floor
    w.fillStyle = '#ff4d6d22';
    w.fillRect(0, groundY - 3, LOW_W, 3);
  }

  private drawStage(): void {
    const w = this.wctx;
    const L = CFG.stage.left;
    const R = CFG.stage.right;
    w.fillStyle = '#231942';
    w.fillRect(L - 600, -500, R - L + 1200, 500);
    // checkered floor tiles
    for (let x = L - 600; x < R + 600; x += 80) {
      w.fillStyle = Math.floor((x - L) / 80) % 2 ? '#2a1f4f' : '#211843';
      w.fillRect(x, -26, 80, 20);
      w.fillStyle = Math.floor((x - L) / 80) % 2 ? '#1e1640' : '#261c4a';
      w.fillRect(x, -60, 80, 34);
    }
    w.fillStyle = '#8a7cc0';
    w.fillRect(L - 600, -3, R - L + 1200, 3);
    w.fillStyle = '#5e548e';
    w.fillRect(L - 600, -6, R - L + 1200, 3);
    // walls: riveted pillars
    for (const wx of [L, R]) {
      const dir = wx === L ? -1 : 1;
      const x0 = wx + (dir < 0 ? -70 : 0);
      w.fillStyle = '#3d2c6b';
      w.fillRect(x0, 0, 70, 900);
      w.fillStyle = '#2c1f52';
      for (let y = 0; y < 900; y += 60) w.fillRect(x0, y, 70, 6);
      w.fillStyle = '#e0aaff88';
      w.fillRect(wx + (dir < 0 ? -6 : 0), 0, 6, 900);
    }
  }

  private drawFighterState(ctx: CanvasRenderingContext2D, sim: Sim, f: FighterState, c: CharacterDef, time: number, mirror = false): void {
    const anim = this.anims[f.idx];
    const j = anim.joints!;
    let extendTo: number | null = null;
    const m = sim.move(f);
    if (m?.pose === 'piston') {
      const h = m.hits?.[0];
      if (h && f.moveFrame >= h.frames[0] && f.moveFrame <= h.frames[1] + 6 && h.boxes[0]) extendTo = f.x + f.facing * (h.boxes[0].x + h.boxes[0].w);
    }
    const invuln = f.wakeInvuln > 0 || f.airRecoverInvuln > 0 || f.state === 'techroll' || (m?.invuln?.some((iv) => f.moveFrame >= iv.frames[0] && f.moveFrame <= iv.frames[1]) ?? false);
    // mirror matches: player 2 wears an alternate colour scheme
    const pal = mirror ? { ...c.palette, primary: shade(c.palette.primary, 0.35), secondary: c.palette.accent, accent: c.palette.secondary } : c.palette;
    // hit flash = solid white sprite; invulnerability = flickering aura-coloured silhouette
    const flat = anim.hitFlash > 1 ? '#ffffff' : invuln && Math.floor(time / 3) % 2 === 0 ? pal.aura : undefined;
    drawChains(ctx, anim, c, false, '#0b0714');
    drawFighter(ctx, f, c, j, { primary: pal.primary, secondary: pal.secondary, accent: pal.accent, skin: pal.skin, outline: '#0b0a14', alpha: 1, extendTo, flat }, time);
    drawChains(ctx, anim, c, true, '#0b0714');
    drawSmear(ctx, anim);
  }

  private drawProjectile(sim: Sim, p: ProjectileState, time: number): void {
    const ctx = this.wctx;
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
        const o = this.anims[p.owner].joints;
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

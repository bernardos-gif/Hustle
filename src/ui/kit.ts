// Pixel-art UI kit: theme colours, bevelled panels, bars, buttons and mouse hit regions.

import { pixelText, textWidth, type TextOpts } from './pixelfont';

export const THEME = {
  bg0: '#0b0718',
  bg1: '#170f2e',
  panel: '#1d1438',
  panelHi: '#2c2052',
  border: '#05030c',
  edge: '#4a3a85',
  edgeHi: '#7d68c9',
  text: '#f2ecff',
  dim: '#9a8cc7',
  faint: '#5d5288',
  gold: '#ffd60a',
  cyan: '#4cc9f0',
  red: '#ff4d6d',
  green: '#06d6a0',
  orange: '#ff9f1c',
  p1: '#4cc9f0',
  p2: '#ff4d6d',
};

type Ctx = CanvasRenderingContext2D;

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  hover?: () => void;
  click?: () => void;
  wheel?: (dy: number) => void;
}

/** Mouse state plus the clickable regions registered while drawing the previous frame. */
export class Pointer {
  x = -1;
  y = -1;
  moved = false;
  clicks: { x: number; y: number }[] = [];
  wheel = 0;
  regions: Region[] = [];
  private next: Region[] = [];

  constructor(canvas: HTMLCanvasElement, viewW: number, viewH: number) {
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * viewW, y: ((e.clientY - r.top) / r.height) * viewH };
    };
    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      this.moved = this.moved || Math.abs(p.x - this.x) + Math.abs(p.y - this.y) > 1;
      this.x = p.x;
      this.y = p.y;
    });
    canvas.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      this.x = p.x;
      this.y = p.y;
      this.clicks.push(p);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  add(r: Region): void {
    this.next.push(r);
  }

  /** Call at the start of a frame: dispatches hover/click/wheel to last frame's regions. */
  dispatch(): void {
    const hit = (x: number, y: number) => {
      for (let i = this.regions.length - 1; i >= 0; i--) {
        const r = this.regions[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
      }
      return null;
    };
    if (this.moved) hit(this.x, this.y)?.hover?.();
    for (const c of this.clicks) {
      const r = hit(c.x, c.y);
      r?.hover?.();
      r?.click?.();
    }
    if (this.wheel) {
      const r = this.regions.find((q) => q.wheel && this.x >= q.x && this.x <= q.x + q.w && this.y >= q.y && this.y <= q.y + q.h) ?? this.regions.find((q) => q.wheel);
      r?.wheel?.(this.wheel);
    }
    this.moved = false;
    this.clicks = [];
    this.wheel = 0;
  }

  /** Call before drawing a frame. */
  beginFrame(): void {
    this.regions = this.next;
    this.next = [];
  }

  over(x: number, y: number, w: number, h: number): boolean {
    return this.x >= x && this.x <= x + w && this.y >= y && this.y <= y + h;
  }
}

/** Chamfered, bevelled pixel panel. */
export function panel(ctx: Ctx, x: number, y: number, w: number, h: number, o: { fill?: string; edge?: string; accent?: string; cut?: number; alpha?: number } = {}): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  const c = o.cut ?? 6;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  const shape = (inset: number) => {
    const cc = Math.max(0, c - inset / 2);
    ctx.beginPath();
    ctx.moveTo(x + inset + cc, y + inset);
    ctx.lineTo(x + w - inset - cc, y + inset);
    ctx.lineTo(x + w - inset, y + inset + cc);
    ctx.lineTo(x + w - inset, y + h - inset - cc);
    ctx.lineTo(x + w - inset - cc, y + h - inset);
    ctx.lineTo(x + inset + cc, y + h - inset);
    ctx.lineTo(x + inset, y + h - inset - cc);
    ctx.lineTo(x + inset, y + inset + cc);
    ctx.closePath();
  };
  ctx.fillStyle = THEME.border;
  shape(0);
  ctx.fill();
  ctx.fillStyle = o.edge ?? THEME.edge;
  shape(3);
  ctx.fill();
  ctx.fillStyle = o.fill ?? THEME.panel;
  shape(6);
  ctx.fill();
  // top highlight + bottom shade (pixel bevel)
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x + 6 + c, y + 6, w - 12 - c * 2, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 6 + c, y + h - 9, w - 12 - c * 2, 3);
  if (o.accent) {
    ctx.fillStyle = o.accent;
    ctx.fillRect(x + c + 3, y + 3, Math.min(48, w - 2 * c - 6), 3);
  }
  ctx.restore();
}

/** Segmented pixel bar. `value` in 0..1. */
export function bar(ctx: Ctx, x: number, y: number, w: number, h: number, value: number, color: string, o: { back?: string; segments?: number; rtl?: boolean; trail?: number; trailColor?: string; shine?: boolean } = {}): void {
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = THEME.border;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = o.back ?? '#241a44';
  ctx.fillRect(x, y, w, h);
  const fill = (v: number, col: string) => {
    const fw = Math.round(Math.max(0, Math.min(1, v)) * w);
    ctx.fillStyle = col;
    ctx.fillRect(o.rtl ? x + w - fw : x, y, fw, h);
    return fw;
  };
  if (o.trail !== undefined && o.trail > value) fill(o.trail, o.trailColor ?? THEME.red);
  const fw = fill(value, color);
  if (o.shine !== false && fw > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(o.rtl ? x + w - fw : x, y, fw, Math.max(1, Math.floor(h / 4)));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(o.rtl ? x + w - fw : x, y + h - Math.max(1, Math.floor(h / 4)), fw, Math.max(1, Math.floor(h / 4)));
  }
  if (o.segments && o.segments > 1) {
    ctx.fillStyle = THEME.border;
    for (let i = 1; i < o.segments; i++) ctx.fillRect(x + Math.round((w * i) / o.segments) - 1, y, 2, h);
  }
}

/** Pixel diamond pip. */
export function pip(ctx: Ctx, x: number, y: number, on: boolean, color: string, size = 5): void {
  ctx.fillStyle = THEME.border;
  diamond(ctx, x, y, size + 2);
  ctx.fillStyle = on ? color : '#2b2245';
  diamond(ctx, x, y, size);
  if (on) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x - 1, y - size + 2, 2, 2);
  }
}

function diamond(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

export function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts = {}): number {
  return pixelText(ctx, s, x, y, o);
}

export { textWidth };

/** Menu row with selection highlight; registers a mouse region. */
export function menuRow(
  ctx: Ctx,
  ptr: Pointer,
  x: number,
  y: number,
  w: number,
  label: string,
  selected: boolean,
  o: { value?: string; onHover?: () => void; onClick?: () => void; onLeft?: () => void; onRight?: () => void; scale?: number; color?: string; time?: number; disabled?: boolean } = {},
): void {
  const s = o.scale ?? 2;
  const h = 7 * s + 12;
  if (selected) {
    ctx.fillStyle = 'rgba(255,214,10,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = THEME.gold;
    ctx.fillRect(x, y, 3, h);
    const bob = Math.floor(((o.time ?? 0) / 8) % 2);
    text(ctx, '▶', x + 8 + bob * 2, y + 6, { scale: s, color: THEME.gold });
  }
  const col = o.disabled ? THEME.faint : selected ? THEME.gold : o.color ?? THEME.text;
  text(ctx, label, x + 14 + 6 * s, y + 6, { scale: s, color: col });
  if (o.value !== undefined) {
    const vx = x + w - 10;
    const hasArrows = !!(o.onLeft || o.onRight);
    const vw = text(ctx, o.value, hasArrows ? vx - 7 * s : vx, y + 6, { scale: s, color: selected ? '#ffffff' : THEME.cyan, align: 'right' });
    if (hasArrows) {
      const lx = vx - 7 * s - vw - 8 * s;
      text(ctx, '◀', lx, y + 6, { scale: s, color: selected ? THEME.gold : THEME.faint });
      text(ctx, '▶', vx - 5 * s, y + 6, { scale: s, color: selected ? THEME.gold : THEME.faint });
      ptr.add({ x: lx - 4, y, w: 7 * s + 8, h, hover: o.onHover, click: o.onLeft });
      ptr.add({ x: vx - 6 * s, y, w: 7 * s + 8, h, hover: o.onHover, click: o.onRight });
    }
  }
  ptr.add({ x, y, w: o.value !== undefined && (o.onLeft || o.onRight) ? w * 0.55 : w, h, hover: o.onHover, click: o.onClick ?? o.onRight });
}

/** Retro screen wipe made of diagonal blocks. `t` goes 0..1. */
export function wipe(ctx: Ctx, W: number, H: number, t: number, color = THEME.bg0): void {
  if (t <= 0) return;
  const size = 40;
  ctx.fillStyle = color;
  for (let gy = 0; gy < H / size + 1; gy++) {
    for (let gx = 0; gx < W / size + 1; gx++) {
      const d = (gx + gy) / (W / size + H / size);
      const k = Math.max(0, Math.min(1, t * 2 - d));
      if (k <= 0) continue;
      const s = size * k;
      ctx.fillRect(gx * size + (size - s) / 2, gy * size + (size - s) / 2, s, s);
    }
  }
}

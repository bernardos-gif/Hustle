// Renders fighters as standalone pixel sprites (HUD portraits, character select, title screen).

import { Sim } from '../combat/sim';
import type { CharacterDef, FighterState } from '../combat/types';
import { computePose } from './poses';
import { pixelate } from './renderer';
import { buildJoints, drawFighter } from './skeleton';

const previews = new Map<string, Sim>();
export function previewSim(id: string): Sim {
  let s = previews.get(id);
  if (!s) {
    s = new Sim({ chars: [id, id], settings: { training: true } });
    previews.set(id, s);
  }
  return s;
}

export interface SpriteOpts {
  w: number;
  h: number;
  /** World units -> sprite pixels. */
  scale: number;
  /** Where the fighter's feet go, in sprite pixels. */
  footX: number;
  footY: number;
  state?: FighterState['state'];
  stateFrame?: number;
  time?: number;
  facing?: 1 | -1;
  flat?: string;
}

const cache = new Map<string, HTMLCanvasElement>();

/** Draws the fighter into a small canvas and pixelates it. Static sprites are cached. */
export function fighterSprite(c: CharacterDef, o: SpriteOpts, cacheKey?: string): HTMLCanvasElement {
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)!;
  const canvas = document.createElement('canvas');
  canvas.width = o.w;
  canvas.height = o.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const sim = previewSim(c.id);
  const f = sim.state.fighters[0];
  f.x = 0;
  f.y = 0;
  f.grounded = true;
  f.facing = o.facing ?? 1;
  f.state = o.state ?? 'idle';
  f.stateFrame = o.stateFrame ?? 30;
  f.stance = null;
  const pose = computePose(sim, f, o.time ?? 0);
  const j = buildJoints(f, c, pose);
  ctx.setTransform(o.scale, 0, 0, -o.scale, o.footX, o.footY);
  const p = c.palette;
  drawFighter(ctx, f, c, j, { primary: p.primary, secondary: p.secondary, accent: p.accent, skin: p.skin, outline: '#0b0a14', alpha: 1, flat: o.flat }, o.time ?? 0);
  pixelate(ctx, o.w, o.h);
  if (cacheKey) cache.set(cacheKey, canvas);
  return canvas;
}

/** Head-and-shoulders portrait used by the HUD. */
export function portrait(c: CharacterDef, facing: 1 | -1): HTMLCanvasElement {
  const size = 34;
  const scale = size / (c.height * 0.62);
  return fighterSprite(c, { w: size, h: size, scale, footX: size / 2 + facing * 2, footY: size + c.height * 0.52 * scale, facing }, `portrait:${c.id}:${facing}`);
}

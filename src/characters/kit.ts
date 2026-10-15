// Helpers for writing compact, readable move data. They only fill in defaults — every move is
// still a plain MoveDef interpreted by the shared engine.

import type { CancelDef, GuardType, HitDef, LocalBox, MoveDef, ProjectileDef, Strength } from '../combat/types';

export interface StrikeSpec extends Partial<Omit<MoveDef, 'hits' | 'cancels'>> {
  id: string;
  name: string;
  input: string;
  desc: string;
  strength: Strength;
  /** startup, active, recovery */
  f: [number, number, number];
  box: LocalBox | LocalBox[];
  dmg: number;
  guard?: GuardType;
  hitstun?: number;
  blockstun?: number;
  kb?: [number, number];
  hit?: Partial<HitDef>;
  /** Additional hits (absolute frames). */
  extraHits?: HitDef[];
  cancels?: CancelDef | 'none';
  air?: boolean;
  pose: string;
}

const HS: Record<Strength, number> = { L: 13, M: 17, H: 21, S: 20, X: 24 };

export function defaultCancels(kind: MoveDef['kind'], s: Strength, air: boolean): CancelDef | undefined {
  if (kind === 'super' || kind === 'throw' || kind === 'defense' || kind === 'movement') return undefined;
  if (kind === 'special') return { onHit: ['super'], onBlock: ['super'] };
  if (air) {
    if (s === 'L') return { onHit: ['chain', 'special', 'super', 'dash'], onBlock: ['chain', 'special', 'super'], onWhiff: ['chain'] };
    if (s === 'M') return { onHit: ['chain', 'special', 'super', 'dash', 'jump'], onBlock: ['chain', 'special', 'super'], onWhiff: ['special'] };
    return { onHit: ['special', 'super', 'jump', 'dash'], onBlock: ['special', 'super'], onWhiff: ['special'] };
  }
  if (s === 'L') return { onHit: ['chain', 'special', 'super'], onBlock: ['chain', 'special', 'super'], onWhiff: ['chain'] };
  if (s === 'M') return { onHit: ['chain', 'special', 'super'], onBlock: ['chain', 'special', 'super'], onWhiff: ['special', 'chain'] };
  return { onHit: ['special', 'super'], onBlock: ['special', 'super'], onWhiff: ['special'] };
}

export function strike(sp: StrikeSpec): MoveDef {
  const [st, ac, rc] = sp.f;
  const kind = sp.kind ?? 'normal';
  const air = sp.air ?? sp.stance === 'air';
  const hitstun = sp.hitstun ?? HS[sp.strength];
  const hit: HitDef = {
    frames: [st + 1, st + ac],
    boxes: Array.isArray(sp.box) ? sp.box : [sp.box],
    damage: sp.dmg,
    guard: sp.guard ?? 'mid',
    hitstun,
    blockstun: sp.blockstun ?? Math.max(6, hitstun - 4),
    knockback: { x: sp.kb?.[0] ?? 3, y: sp.kb?.[1] ?? 0 },
    ...(sp.hit ?? {}),
  };
  const { f: _f, box: _b, dmg: _d, guard: _g, hitstun: _h, blockstun: _bs, kb: _kb, hit: _hit, extraHits, cancels, air: _air, ...rest } = sp;
  const m: MoveDef = {
    kind,
    stance: air ? 'air' : 'ground',
    total: st + ac + rc,
    ...rest,
    hits: [hit, ...(extraHits ?? [])],
    cancels: cancels === 'none' ? undefined : cancels ?? defaultCancels(kind, sp.strength, air),
  } as MoveDef;
  if (air && !m.landing) m.landing = { mode: 'end', lag: sp.strength === 'L' ? 3 : sp.strength === 'M' ? 5 : 8 };
  return m;
}

/** A hit that repeats every `every` frames across [from, to]. */
export function multiHit(from: number, to: number, every: number, box: LocalBox | LocalBox[], dmg: number, extra: Partial<HitDef> = {}): HitDef {
  return {
    frames: [from, to],
    boxes: Array.isArray(box) ? box : [box],
    damage: dmg,
    guard: 'mid',
    hitstun: 16,
    blockstun: 12,
    knockback: { x: 1.5, y: 0 },
    rehit: every,
    proration: 0.96,
    ...extra,
  };
}

export function hitAt(from: number, to: number, box: LocalBox | LocalBox[], dmg: number, extra: Partial<HitDef> = {}): HitDef {
  return {
    frames: [from, to],
    boxes: Array.isArray(box) ? box : [box],
    damage: dmg,
    guard: 'mid',
    hitstun: 20,
    blockstun: 14,
    knockback: { x: 4, y: 0 },
    ...extra,
  };
}

export function projectile(p: Partial<ProjectileDef> & Pick<ProjectileDef, 'id' | 'name' | 'box' | 'speed' | 'lifetime' | 'hit' | 'style' | 'color'>): ProjectileDef {
  return {
    durability: 1,
    power: 1,
    hits: 1,
    parryable: true,
    reflectable: true,
    ...p,
  };
}

export const B = (x: number, y: number, w: number, h: number): LocalBox => ({ x, y, w, h });

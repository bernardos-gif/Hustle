// Character registry and per-character lookup tables (moves by id, input commands, projectiles).

import type { CharacterDef, MoveDef, ProjectileDef } from './types';
import { universalMoves } from './universal';

export interface Command {
  move: MoveDef;
  btn: string;
  dir: string;
  air: boolean;
  stance?: string;
  /** Lower sorts first. Exact digits are more specific than direction groups. */
  specificity: number;
}

export interface CharData {
  def: CharacterDef;
  moves: Map<string, MoveDef>;
  commands: Command[];
  projectiles: Map<string, ProjectileDef>;
}

const registry = new Map<string, CharacterDef>();
const cache = new Map<string, CharData>();

export function registerCharacter(def: CharacterDef): void {
  registry.set(def.id, def);
  cache.delete(def.id);
}

export function allCharacters(): CharacterDef[] {
  return [...registry.values()];
}

function specificity(dir: string): number {
  if (dir === '*') return 3;
  if (dir === '5') return 2;
  if (dir.length === 1 && dir >= '1' && dir <= '9') return 0;
  return 1;
}

export function charData(id: string): CharData {
  let d = cache.get(id);
  if (d) return d;
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown character ${id}`);
  const moves = new Map<string, MoveDef>();
  for (const m of universalMoves(def)) moves.set(m.id, m);
  for (const m of def.moves) moves.set(m.id, m);
  const commands: Command[] = [];
  for (const m of moves.values()) {
    if (!m.cmd) continue;
    commands.push({
      move: m,
      btn: m.cmd.btn,
      dir: m.cmd.dir,
      air: !!m.cmd.air,
      stance: m.cmd.stance,
      specificity: specificity(m.cmd.dir) * 10 - (m.cmd.priority ?? 0),
    });
  }
  // Stance-specific commands are always more specific than generic ones.
  commands.sort((a, b) => (a.stance ? -100 : 0) + a.specificity - ((b.stance ? -100 : 0) + b.specificity));
  const projectiles = new Map<string, ProjectileDef>();
  for (const p of def.projectiles) projectiles.set(p.id, p);
  d = { def, moves, commands, projectiles };
  cache.set(id, d);
  return d;
}

/** Derived frame data for display and tests. */
export function frameData(m: MoveDef): { startup: number; active: number; recovery: number; total: number } {
  const ranges: [number, number][] = [];
  for (const h of m.hits ?? []) if (!h.grabHit) ranges.push(h.frames);
  if (m.throw) ranges.push(m.throw.frames);
  if (m.parry) ranges.push(m.parry.frames);
  if (m.counter) ranges.push(m.counter.frames);
  for (const s of m.spawns ?? []) ranges.push([s.frame, s.frame]);
  if (!ranges.length) return { startup: 0, active: 0, recovery: m.total, total: m.total };
  const first = Math.min(...ranges.map((r) => r[0]));
  const last = Math.max(...ranges.map((r) => r[1]));
  return { startup: first - 1, active: last - first + 1, recovery: m.total - last, total: m.total };
}

export function totalDamage(m: MoveDef): number {
  let d = 0;
  for (const h of m.hits ?? []) {
    const n = h.rehit ? Math.floor((h.frames[1] - h.frames[0]) / h.rehit) + 1 : 1;
    d += h.damage * n;
  }
  return d;
}

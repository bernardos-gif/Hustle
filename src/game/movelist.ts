// Builds the move list directly from character data so it can never drift from the engine.

import { CFG } from '../combat/config';
import { charData, frameData, totalDamage } from '../combat/registry';
import type { MoveDef } from '../combat/types';

export interface MoveRow {
  id: string;
  name: string;
  input: string;
  kind: string;
  startup: number;
  active: number;
  recovery: number;
  total: number;
  damage: number;
  guard: string;
  cost: string;
  props: string;
  desc: string;
}

const KIND_ORDER: Record<string, number> = { normal: 0, command: 1, throw: 2, special: 3, super: 4, movement: 5, defense: 6, system: 7 };

export function describeCost(m: MoveDef): string {
  const parts: string[] = [];
  if (m.cost?.meter) parts.push(`${m.cost.meter / CFG.meter.perBar} bar${m.cost.meter > CFG.meter.perBar ? 's' : ''}`);
  for (const [k, v] of Object.entries(m.cost?.resource ?? {})) parts.push(`${v} ${k}`);
  if (m.cost?.airOption) parts.push(`${m.cost.airOption} air`);
  for (const [k, v] of Object.entries(m.requires?.resource ?? {})) parts.push(`needs ${v} ${k}`);
  if (m.requires?.object) parts.push(`needs ${m.requires.object.replace(/^\w_/, '')}`);
  if (m.id === 'burst') parts.push('full burst');
  return parts.join(', ') || '—';
}

export function describeProps(m: MoveDef): string {
  const p: string[] = [];
  const hits = m.hits ?? [];
  if (hits.some((h) => h.launch)) p.push('launch');
  if (hits.some((h) => h.wallBounce)) p.push('wall bounce');
  if (hits.some((h) => h.groundBounce)) p.push('ground bounce');
  if (hits.some((h) => h.hardKnockdown)) p.push('hard KD');
  if (hits.some((h) => h.otg)) p.push('OTG');
  if (hits.filter((h) => !h.grabHit).length > 1 || hits.some((h) => h.rehit)) p.push('multi-hit');
  if (hits.some((h) => h.airUnblockable)) p.push('anti-air');
  if (hits.some((h) => h.unburstable)) p.push('unburstable');
  if (m.invuln?.length) p.push(`invuln ${m.invuln.map((i) => `${i.frames[0]}-${i.frames[1]}`).join(',')}`);
  if (m.armor) p.push(`armor ${m.armor.frames[0]}-${m.armor.frames[1]}`);
  if (m.parry) p.push(`parry ${m.parry.frames[0]}-${m.parry.frames[1]}`);
  if (m.counter) p.push(`counter ${m.counter.frames[0]}-${m.counter.frames[1]}`);
  if (m.throw) p.push(m.throw.techable ? 'techable' : 'untechable');
  if (m.spawns?.length) p.push('projectile');
  if (m.charge) p.push('chargeable');
  if (m.install) p.push(`install ${Math.round(m.install.frames / 60)}s`);
  if (m.superFreeze) p.push('super freeze');
  if (m.helpless) p.push('helpless');
  if (m.disjoint) p.push('disjoint');
  if (m.cancels?.onHit?.includes('jump')) p.push('jump-cancel');
  return p.join(' · ');
}

export function moveList(charId: string): MoveRow[] {
  const cd = charData(charId);
  const rows: MoveRow[] = [];
  for (const m of cd.moves.values()) {
    if (m.hidden || m.kind === 'system' && m.id !== 'burst') continue;
    if (!m.input) continue;
    const fd = frameData(m);
    const guards = new Set((m.hits ?? []).filter((h) => !h.grabHit).map((h) => h.guard));
    let guard = [...guards].join('/') || (m.throw ? 'throw' : m.spawns?.length ? 'projectile' : '—');
    if (m.spawns?.length) {
      const pd = cd.projectiles.get(m.spawns[0].projectile);
      if (pd) guard = pd.hit.guard;
    }
    let damage = totalDamage(m);
    if (m.throw) {
      const s = cd.moves.get(m.throw.success);
      if (s) damage = totalDamage(s);
    }
    if (m.spawns?.length) {
      for (const s of m.spawns) {
        const pd = cd.projectiles.get(s.projectile);
        if (pd && !pd.inert) {
          damage += pd.hit.damage * pd.hits;
          if (pd.onEnd) {
            const e = cd.projectiles.get(pd.onEnd);
            if (e) damage += e.hit.damage * e.hits;
          }
        }
      }
    }
    if (m.counter) {
      const s = cd.moves.get(m.counter.followup);
      if (s) damage = totalDamage(s);
    }
    rows.push({
      id: m.id,
      name: m.name,
      input: m.input,
      kind: m.kind,
      startup: fd.startup,
      active: fd.active,
      recovery: fd.recovery,
      total: m.total,
      damage,
      guard,
      cost: describeCost(m),
      props: describeProps(m),
      desc: m.desc,
    });
  }
  rows.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
  return rows;
}

/** Universal mechanics described for the move list footer. */
export const UNIVERSAL_HELP = [
  'Move: walk, hold up to jump (tap = short hop), double-tap for dash / backdash, hold forward after a dash to run.',
  'D: dash (ground), backdash (4D, early invuln), roll (1D/3D), evade (2D), air dash (8-way, costs an air option). Bastion: D toggles jet flight.',
  'Air options: double jump and air dash share them; refilled on landing. Down in the air = fast fall.',
  'Block: hold back (crouch-block lows, stand-block overheads). Throws beat block; T within 10f of being grabbed techs.',
  'P: timed parry (frames 2-7). In blockstun: Guard Push (25 meter). During a special/heavy startup: Feint (costs 1 feint pip).',
  'Feint pips also pay for whiff cancels on eligible moves; they regenerate over time.',
  'Hold a direction while hit for DI; it is locked in when hitstop ends. D just before landing in tumble = tech roll.',
  'X while being comboed (2+ hits) or blocking with a full gauge = Burst. Bursts can be blocked and punished.',
];

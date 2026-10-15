// VESPER — precision duelist. Rapier + flintlock. Disjointed sword pokes, a limited-ammo pistol,
// a draw stance with lightning-fast iai strikes and a counter, and huge punishes (Lunge).
// Weaknesses: lowest health in the cast, ammo must be reloaded, heavy moves are slow.

import type { CharacterDef, MoveDef } from '../combat/types';
import { B, hitAt, multiHit, projectile, strike } from './kit';

const moves: MoveDef[] = [
  strike({ id: 'v_5L', name: 'Pommel Jab', input: '5L', desc: 'Fast close-range jab. Chains into itself and everything.', strength: 'L', f: [4, 2, 7], box: B(14, 70, 46, 20), dmg: 28, kb: [2.5, 0], pose: 'jab', cmd: { btn: 'L', dir: '5' } }),
  strike({ id: 'v_5M', name: 'Fleche Thrust', input: '5M', desc: 'Long disjointed rapier poke. Excellent spacing tool.', strength: 'M', f: [7, 3, 13], box: B(20, 64, 92, 16), dmg: 52, kb: [4, 0], pose: 'thrust', disjoint: true, cmd: { btn: 'M', dir: '5' } }),
  strike({ id: 'v_5H', name: 'Riposte Slash', input: '5H', desc: 'Wide sword arc. Big reward, slow recovery.', strength: 'H', f: [11, 4, 18], box: B(8, 38, 98, 64), dmg: 84, kb: [6, 0], pose: 'slash_wide', disjoint: true, hit: { spark: 'slash' }, cmd: { btn: 'H', dir: '5' } }),
  strike({ id: 'v_2L', name: 'Low Prick', input: '2L', desc: 'Quick low poke.', strength: 'L', f: [5, 2, 8], box: B(14, 4, 62, 18), dmg: 24, guard: 'low', pose: 'lowjab', cmd: { btn: 'L', dir: 'd' } }),
  strike({ id: 'v_2M', name: 'Shin Cut', input: '2M', desc: 'Ranged low slash.', strength: 'M', f: [8, 3, 15], box: B(10, 0, 90, 18), dmg: 46, guard: 'low', kb: [3, 0], pose: 'sweep', disjoint: true, hit: { spark: 'slash' }, cmd: { btn: 'M', dir: 'd' } }),
  strike({
    id: 'v_2H', name: 'Rising Arc', input: '2H', desc: 'Launcher and anti-air. Jump-cancel on hit to follow up in the air.', strength: 'H', f: [9, 4, 22], box: B(4, 60, 70, 95), dmg: 72, kb: [1.5, 13.5], pose: 'slash_up', disjoint: true,
    hit: { launch: true, priority: 4, airUnblockable: true, spark: 'slash' }, cancels: { onHit: ['special', 'super', 'jump'], onBlock: ['special', 'super'], onWhiff: ['special'] }, cmd: { btn: 'H', dir: 'd' },
  }),
  strike({ id: 'v_6H', name: 'Pommel Drop', input: '6H', desc: 'Stepping overhead — must be blocked standing.', strength: 'H', kind: 'command', f: [19, 3, 16], box: B(14, 40, 62, 72), dmg: 70, guard: 'high', kb: [3, 0], pose: 'overhead', vel: [{ frame: 4, until: 14, x: 3, mode: 'set' }], cmd: { btn: 'H', dir: '6' } }),
  strike({ id: 'v_3H', name: 'Reaping Sweep', input: '3H', desc: 'Long low sweep that knocks down.', strength: 'H', kind: 'command', f: [10, 3, 22], box: B(14, 0, 98, 16), dmg: 66, guard: 'low', kb: [2.5, 5], pose: 'sweep', disjoint: true, hit: { launch: true, hardKnockdown: true, spark: 'slash' }, cmd: { btn: 'H', dir: '3' } }),
  strike({ id: 'v_4M', name: 'Hilt Bash', input: '4M', desc: 'Close shove that pushes the opponent far away. Safe on block.', strength: 'M', kind: 'command', f: [6, 2, 12], box: B(8, 55, 44, 42), dmg: 42, kb: [9, 0], blockstun: 16, pose: 'elbow', cmd: { btn: 'M', dir: '4' } }),
  strike({ id: 'v_jL', name: 'Air Jab', input: 'j.L', desc: 'Fast air jab.', strength: 'L', air: true, f: [4, 3, 8], box: B(10, 50, 56, 30), dmg: 26, pose: 'air_punch', cmd: { btn: 'L', dir: '*', air: true } }),
  strike({ id: 'v_jM', name: 'Air Thrust', input: 'j.M', desc: 'Horizontal disjointed air poke.', strength: 'M', air: true, f: [7, 4, 12], box: B(16, 42, 90, 18), dmg: 44, pose: 'air_thrust', disjoint: true, cmd: { btn: 'M', dir: '*', air: true } }),
  strike({ id: 'v_jH', name: 'Crescent Slash', input: 'j.H', desc: 'Huge downward arc. Great jump-in.', strength: 'H', air: true, f: [9, 5, 16], box: B(-10, 0, 104, 92), dmg: 62, kb: [4, -2], guard: 'high', pose: 'air_slash', disjoint: true, hit: { spark: 'slash' }, cmd: { btn: 'H', dir: '*', air: true } }),
  strike({
    id: 'v_j2H', name: 'Plunging Strike', input: 'j.2H', desc: 'Dives diagonally sword-first. Ground-bounces airborne victims.', strength: 'H', air: true, f: [8, 14, 10], box: B(0, -12, 54, 50), dmg: 58, guard: 'high', kb: [2, -6],
    pose: 'divekick', disjoint: true, vel: [{ frame: 8, until: 22, x: 5, y: -14, mode: 'set' }], gravity: 0, hit: { groundBounce: true }, landing: { mode: 'end', lag: 10 }, cmd: { btn: 'H', dir: 'd', air: true },
  }),
  {
    id: 'v_shot', name: 'Flintlock Shot', input: '5S', desc: 'Fast bullet with long hitstun — a combo extender. Costs 1 ammo.', kind: 'special', strength: 'S', stance: 'ground', total: 30,
    spawns: [{ frame: 10, projectile: 'v_bullet', offset: { x: 50, y: 78 } }], cost: { resource: { ammo: 1 } }, pose: 'shoot', sfx: 'gun', cmd: { btn: 'S', dir: '5' },
    cancels: { window: [11, 29], always: ['super'] },
  },
  {
    id: 'v_reload', name: 'Reload', input: '4S', desc: 'Loads 3 bullets on frame 30. Can be feinted with P.', kind: 'special', strength: 'S', stance: 'ground', total: 40, pose: 'reload', feintable: true, cmd: { btn: 'S', dir: '4' },
    onFrame: ({ f, frame }) => {
      if (frame === 30) f.resources.ammo = Math.min(6, f.resources.ammo + 3);
    },
  },
  strike({
    id: 'v_lunge', name: 'Fleche Lunge', input: '6S', desc: 'Explosive long-range lunge. Wall-bounces. Heavily punishable on block.', strength: 'S', kind: 'special', f: [12, 6, 24], box: B(20, 55, 100, 24), dmg: 105, hitstun: 26, blockstun: 12, kb: [9, 5.5],
    pose: 'thrust', disjoint: true, vel: [{ frame: 9, until: 17, x: 13, mode: 'set' }, { frame: 18, x: 1, mode: 'set' }], hit: { wallBounce: true, launch: true, priority: 4, spark: 'slash' }, cmd: { btn: 'S', dir: '6' }, fx: [{ frame: 9, cue: 'speedlines' }],
  }),
  {
    id: 'v_stance', name: 'Draw Stance', input: '2S', desc: 'Sheathes the blade. From stance: L Iai Flash, M Rising Moon, H Counter Posture, S Quick Draw, D Stance Step.', kind: 'special', strength: 'S', stance: 'ground', total: 9,
    setStance: 'draw', stanceFrames: 80, pose: 'draw', cmd: { btn: 'S', dir: 'd' }, fx: [{ frame: 1, cue: 'stance' }],
  },
  strike({ id: 'v_iai', name: 'Iai Flash', input: '[stance] L', desc: 'Lightning-fast wide draw slash (4f startup).', strength: 'H', kind: 'special', f: [4, 2, 16], box: B(8, 48, 118, 30), dmg: 68, kb: [6, 1], pose: 'slash_wide', disjoint: true, hit: { spark: 'slash', priority: 4 }, cancels: { onHit: ['super', 'special'] }, cmd: { btn: 'L', dir: '*', stance: 'draw' }, fx: [{ frame: 4, cue: 'flash' }] }),
  strike({ id: 'v_moon', name: 'Rising Moon', input: '[stance] M', desc: 'Stance launcher.', strength: 'H', kind: 'special', f: [6, 4, 20], box: B(4, 40, 82, 110), dmg: 64, kb: [2, 14], pose: 'slash_up', disjoint: true, hit: { launch: true, spark: 'slash' }, cancels: { onHit: ['jump', 'super', 'special'] }, cmd: { btn: 'M', dir: '*', stance: 'draw' } }),
  {
    id: 'v_counter', name: 'Counter Posture', input: '[stance] H', desc: 'Catches any strike on frames 2-16 and answers with an invulnerable wall-bouncing slash. Loses to throws and projectiles.', kind: 'special', strength: 'S', stance: 'ground', total: 32,
    counter: { frames: [2, 16], followup: 'v_counter_slash' }, pose: 'parry', cmd: { btn: 'H', dir: '*', stance: 'draw' },
  },
  strike({
    id: 'v_counter_slash', name: 'Counter Slash', input: '', desc: '', hidden: true, strength: 'H', kind: 'special', f: [3, 4, 22], box: B(-10, 30, 130, 90), dmg: 115, hitstun: 30, kb: [11, 5],
    pose: 'slash_wide', disjoint: true, invuln: [{ frames: [1, 10], types: ['strike', 'throw', 'projectile'] }], hit: { wallBounce: true, launch: true, spark: 'slash' }, fx: [{ frame: 3, cue: 'flash' }],
  }),
  {
    id: 'v_quickdraw', name: 'Quick Draw', input: '[stance] S', desc: 'Faster pistol shot from stance (5f). Costs 1 ammo.', kind: 'special', strength: 'S', stance: 'ground', total: 22,
    spawns: [{ frame: 5, projectile: 'v_bullet', offset: { x: 50, y: 70 } }], cost: { resource: { ammo: 1 } }, pose: 'shoot', sfx: 'gun', cmd: { btn: 'S', dir: '*', stance: 'draw' },
  },
  {
    id: 'v_step', name: 'Stance Step', input: '[stance] D', desc: 'Blurs forward while staying in stance. Strike-invulnerable 1-8.', kind: 'special', strength: 'S', stance: 'ground', total: 14,
    vel: [{ frame: 1, until: 8, x: 11, mode: 'set' }, { frame: 9, x: 0, mode: 'set' }], invuln: [{ frames: [1, 8], types: ['strike'] }], setStance: 'draw', stanceFrames: 50, pose: 'draw', cmd: { btn: 'D', dir: '*', stance: 'draw' }, fx: [{ frame: 1, cue: 'afterimage' }],
  },
  strike({
    id: 'v_dp', name: 'Ascending Flash', input: '8S', desc: 'Invulnerable rising slash (strike-invuln 1-8). Leaves you helpless and very punishable.', strength: 'S', kind: 'special', f: [5, 9, 26], box: B(0, 40, 64, 112), dmg: 92, kb: [3, 12.5],
    pose: 'slash_up', disjoint: true, invuln: [{ frames: [1, 8], types: ['strike', 'throw'] }], vel: [{ frame: 6, y: 12, x: 2.5, mode: 'set' }], helpless: true, landing: { mode: 'continue' }, hit: { launch: true, priority: 5, spark: 'slash' }, cmd: { btn: 'S', dir: '8' }, fx: [{ frame: 6, cue: 'flash' }],
  }),
  {
    id: 'v_airshot', name: 'Air Shot', input: 'j.S', desc: 'Fires downward at 30°. Briefly hangs in the air. Costs 1 ammo.', kind: 'special', strength: 'S', stance: 'air', total: 26, gravity: 0.35,
    spawns: [{ frame: 9, projectile: 'v_bullet', offset: { x: 30, y: 60 }, vel: { x: 18, y: -9 } }], cost: { resource: { ammo: 1 } }, landing: { mode: 'end', lag: 6 }, pose: 'shoot_air', sfx: 'gun', cmd: { btn: 'S', dir: '*', air: true },
    vel: [{ frame: 1, y: 1.5, mode: 'set' }],
  },
  {
    id: 'v_super_duel', name: 'Grand Duel', input: '5X', desc: '1 bar. Invulnerable flurry of thrusts ending in a wall-bouncing launch.', kind: 'super', strength: 'X', stance: 'ground', total: 62, superFreeze: 28, cost: { meter: 100 },
    invuln: [{ frames: [1, 12], types: ['strike', 'throw', 'projectile'] }], vel: [{ frame: 3, until: 10, x: 15, mode: 'set' }, { frame: 11, x: 0.5, mode: 'set' }], disjoint: true, pose: 'rush',
    hits: [
      multiHit(6, 26, 4, B(0, 30, 112, 80), 22, { hitstun: 22, knockback: { x: 0.8, y: 0.6 }, unburstable: true, ignoreDecay: true, spark: 'slash', proration: 0.98, pullTo: { x: 75, y: 0 } }),
      hitAt(31, 33, B(0, 20, 120, 110), 90, { hitstun: 34, knockback: { x: 11, y: 8 }, launch: true, wallBounce: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 15 }),
    ],
    cmd: { btn: 'X', dir: '5' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 'v_super_six', name: 'Six-Shot Execution', input: '2X', desc: '2 bars. Empties the cylinder: one bullet per remaining ammo, each unburstable.', kind: 'super', strength: 'X', stance: 'ground', total: 54, superFreeze: 28, cost: { meter: 200 },
    requires: { resource: { ammo: 1 } }, invuln: [{ frames: [1, 8], types: ['strike', 'projectile'] }], pose: 'shoot', cmd: { btn: 'X', dir: 'd' },
    onFrame: ({ sim, f, frame }) => {
      if (frame >= 10 && frame <= 35 && (frame - 10) % 5 === 0 && f.resources.ammo > 0) {
        f.resources.ammo--;
        sim.spawnProjectile(f, { frame, projectile: 'v_bullet_super', offset: { x: 52, y: 66 + ((frame / 5) % 2) * 14 } }, 0);
      }
    },
    fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 'v_super_air', name: 'Falling Star', input: 'j.X', desc: '1 bar. Aerial dive of blade strikes that spikes the opponent.', kind: 'super', strength: 'X', stance: 'air', total: 44, superFreeze: 22, cost: { meter: 100 }, gravity: 0,
    invuln: [{ frames: [1, 10], types: ['strike', 'projectile'] }], vel: [{ frame: 6, until: 26, x: 9, y: -11, mode: 'set' }], disjoint: true, pose: 'divekick', landing: { mode: 'end', lag: 14 },
    hits: [
      multiHit(6, 22, 4, B(-10, -20, 90, 90), 24, { hitstun: 24, unburstable: true, ignoreDecay: true, spark: 'slash', knockback: { x: 2, y: -2 } }),
      hitAt(24, 27, B(-20, -30, 120, 100), 80, { hitstun: 30, knockback: { x: 4, y: -10 }, groundBounce: true, unburstable: true, ignoreDecay: true, spark: 'super' }),
    ],
    cmd: { btn: 'X', dir: '*', air: true }, fx: [{ frame: 1, cue: 'superflash' }],
  },
];

export const VESPER: CharacterDef = {
  id: 'vesper',
  name: 'Vesper',
  title: 'The Last Duelist',
  archetype: 'Precision duelist',
  blurb: 'Disjointed rapier pokes, a six-round flintlock and a draw stance with frame-perfect counters. Fragile, but every opening is lethal.',
  maxHp: 940,
  walkSpeed: 3.2,
  backWalkSpeed: 2.6,
  runSpeed: 7,
  dashSpeed: 9.5,
  dashFrames: 14,
  backdashSpeed: 8,
  backdashFrames: 18,
  jumpVel: 13.5,
  shortHopVel: 9,
  jumpHSpeed: 4.3,
  doubleJumpVel: 12,
  airDashSpeed: 10.5,
  airDashFrames: 12,
  gravity: 0.62,
  fallSpeed: 13,
  fastFallSpeed: 17,
  airAccel: 0.35,
  airMaxSpeed: 4.8,
  weight: 1.04,
  maxAirOptions: 2,
  width: 42,
  height: 124,
  crouchHeight: 78,
  resources: [{ name: 'ammo', label: 'AMMO', max: 6, start: 6, display: 'pips', color: '#ffd166' }],
  moves,
  projectiles: [
    projectile({ id: 'v_bullet', name: 'Bullet', box: B(0, -4, 26, 8), speed: { x: 22, y: 0 }, lifetime: 50, style: 'bullet', color: '#ffd166', hit: { damage: 38, guard: 'mid', hitstun: 22, blockstun: 10, knockback: { x: 3, y: 0 }, chip: 4, spark: 'light', proration: 0.85 }, power: 1 }),
    projectile({ id: 'v_bullet_super', name: 'Execution Round', box: B(0, -5, 30, 10), speed: { x: 26, y: 0 }, lifetime: 45, style: 'bullet', color: '#ff9f1c', hit: { damage: 45, guard: 'mid', hitstun: 30, blockstun: 12, knockback: { x: 2, y: 2 }, unburstable: true, ignoreDecay: true, spark: 'heavy', proration: 0.95 }, power: 3, parryable: true }),
  ],
  palette: { primary: '#1f2a44', secondary: '#c9a227', accent: '#e63946', aura: '#ffd166', skin: '#f1d3b3' },
};

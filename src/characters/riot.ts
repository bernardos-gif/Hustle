// RIOT — high-speed brawler. Fastest normals, a Heat gauge that builds with aggression and
// decays when passive (more Heat = more damage), wall jumps, a cross-up Flash Step, a slide,
// and Overdrive: a meter-draining install that speeds Riot up, grants free whiff cancels on
// normals and swaps several specials for enhanced versions.

import type { CharacterDef, FighterState, MoveDef } from '../combat/types';
import { B, hitAt, multiHit, strike } from './kit';

const heatMult = (f: FighterState) => 1 + (f.resources.heat ?? 0) / 100 * 0.15;

const moves: MoveDef[] = [
  strike({ id: 'r_5L', name: 'Jab', input: '5L', desc: '3-frame jab. The fastest button in the game.', strength: 'L', f: [3, 2, 7], box: B(12, 76, 42, 18), dmg: 22, hitstun: 12, pose: 'jab', cmd: { btn: 'L', dir: '5' } }),
  strike({ id: 'r_5M', name: 'Straight', input: '5M', desc: 'Quick straight punch.', strength: 'M', f: [6, 3, 11], box: B(14, 70, 58, 20), dmg: 44, pose: 'straight', cmd: { btn: 'M', dir: '5' } }),
  strike({ id: 'r_5H', name: 'Spinning Backfist', input: '5H', desc: 'Spinning backfist with big pushback.', strength: 'H', f: [9, 3, 16], box: B(8, 64, 74, 34), dmg: 68, kb: [7, 0], pose: 'hook', hit: { spark: 'blunt' }, cmd: { btn: 'H', dir: '5' } }),
  strike({ id: 'r_2L', name: 'Low Jab', input: '2L', desc: 'Fast low punch.', strength: 'L', f: [4, 2, 7], box: B(12, 4, 48, 18), dmg: 20, guard: 'low', pose: 'lowjab', cmd: { btn: 'L', dir: 'd' } }),
  strike({ id: 'r_2M', name: 'Shin Kick', input: '2M', desc: 'Low kick.', strength: 'M', f: [6, 3, 12], box: B(10, 0, 62, 20), dmg: 40, guard: 'low', pose: 'lowkick', cmd: { btn: 'M', dir: 'd' } }),
  strike({
    id: 'r_2H', name: 'Rising Uppercut', input: '2H', desc: 'Launcher. Jump-cancel on hit.', strength: 'H', f: [8, 4, 20], box: B(6, 60, 56, 92), dmg: 66, kb: [2, 13.5], pose: 'uppercut',
    hit: { launch: true, airUnblockable: true, priority: 4 }, cancels: { onHit: ['special', 'super', 'jump'], onBlock: ['special', 'super'], onWhiff: ['special'] }, cmd: { btn: 'H', dir: 'd' },
  }),
  strike({ id: 'r_6M', name: 'Rush Elbow', input: '6M', desc: 'Stepping elbow; plus on block for continued pressure.', strength: 'M', kind: 'command', f: [10, 3, 10], box: B(10, 60, 52, 40), dmg: 46, blockstun: 18, kb: [3, 0], pose: 'elbow', vel: [{ frame: 2, until: 10, x: 6.5, mode: 'set' }], cmd: { btn: 'M', dir: '6' } }),
  strike({ id: 'r_6H', name: 'Hammer Fist', input: '6H', desc: 'Jumping overhead hammer fist.', strength: 'H', kind: 'command', f: [17, 3, 15], box: B(10, 20, 58, 90), dmg: 66, guard: 'high', pose: 'overhead', vel: [{ frame: 3, y: 5, x: 3, mode: 'set' }], landing: { mode: 'continue' }, cmd: { btn: 'H', dir: '6' } }),
  strike({
    id: 'r_3M', name: 'Baseball Slide', input: '3M', desc: 'Long low-profile slide that knocks down.', strength: 'M', kind: 'command', f: [6, 12, 14], box: B(6, 0, 60, 22), dmg: 48, guard: 'low', kb: [2, 5], pose: 'slide',
    vel: [{ frame: 4, until: 17, x: 10, mode: 'set' }], hurt: [{ frames: [3, 26], boxes: [B(-26, 0, 74, 34)] }], hit: { launch: true }, cmd: { btn: 'M', dir: '3' },
  }),
  strike({ id: 'r_4H', name: 'Knee Lift', input: '4H', desc: 'Anti-air knee with upper-body invulnerability (head hurtbox removed 4-10).', strength: 'H', kind: 'command', f: [7, 3, 18], box: B(6, 50, 50, 70), dmg: 60, kb: [2, 11], pose: 'knee', hit: { launch: true, airUnblockable: true, priority: 4 }, hurt: [{ frames: [4, 10], boxes: [B(-21, 0, 42, 70)] }], cmd: { btn: 'H', dir: '4' } }),
  strike({ id: 'r_jL', name: 'Air Jab', input: 'j.L', desc: 'Fast air jab.', strength: 'L', air: true, f: [3, 3, 7], box: B(10, 50, 48, 28), dmg: 22, pose: 'air_punch', cmd: { btn: 'L', dir: '*', air: true } }),
  strike({ id: 'r_jM', name: 'Air Knee', input: 'j.M', desc: 'Air knee that hits a little behind too.', strength: 'M', air: true, f: [5, 4, 10], box: B(-14, 30, 70, 46), dmg: 40, pose: 'air_knee', cmd: { btn: 'M', dir: '*', air: true } }),
  strike({ id: 'r_jH', name: 'Tornado Kick', input: 'j.H', desc: 'Spinning kick hitting both sides.', strength: 'H', air: true, f: [8, 6, 13], box: B(-50, 20, 120, 50), dmg: 56, kb: [5, 2], pose: 'spin', cmd: { btn: 'H', dir: '*', air: true } }),
  strike({
    id: 'r_j2H', name: 'Axe Drop', input: 'j.2H', desc: 'Overhead axe kick that ground-bounces.', strength: 'H', air: true, f: [10, 5, 14], box: B(0, -10, 60, 70), dmg: 62, guard: 'high', kb: [2, -10], pose: 'air_hammer',
    hit: { groundBounce: true, spark: 'heavy' }, vel: [{ frame: 1, y: 2, mode: 'add' }], cmd: { btn: 'H', dir: 'd', air: true },
  }),
  {
    id: 'r_rush', name: 'Rush Combo', input: '5S', desc: 'Flurry of 6 jabs into a finishing hook.', kind: 'special', strength: 'S', stance: 'ground', total: 40, enhanced: 'r_rush_od', pose: 'rush',
    vel: [{ frame: 3, until: 20, x: 2, mode: 'set' }],
    hits: [
      multiHit(5, 20, 3, B(10, 50, 60, 50), 12, { hitstun: 14, blockstun: 10, spark: 'light' }),
      hitAt(25, 27, B(10, 50, 70, 50), 50, { hitstun: 22, knockback: { x: 7, y: 3 }, launch: true, spark: 'medium' }),
    ],
    cancels: { onHit: ['super'], onBlock: ['super'] }, cmd: { btn: 'S', dir: '5' },
  },
  {
    id: 'r_rush_od', name: 'Rush Combo (OD)', input: '5S [Overdrive]', desc: 'Overdrive: twice as many jabs, finisher wall-bounces.', kind: 'special', strength: 'S', stance: 'ground', total: 46, hidden: false, pose: 'rush',
    vel: [{ frame: 3, until: 28, x: 2.5, mode: 'set' }],
    hits: [
      multiHit(4, 28, 2, B(10, 50, 64, 54), 9, { hitstun: 14, blockstun: 10, spark: 'light', proration: 0.97 }),
      hitAt(31, 33, B(10, 50, 76, 54), 70, { hitstun: 26, knockback: { x: 11, y: 5.5 }, launch: true, wallBounce: true, spark: 'heavy' }),
    ],
    cancels: { onHit: ['super', 'special'], onBlock: ['super'] },
  },
  strike({
    id: 'r_shoulder', name: 'Shoulder Charge', input: '6S', desc: 'Charging shoulder that wall-bounces.', strength: 'S', kind: 'special', f: [6, 11, 16], box: B(10, 40, 50, 70), dmg: 76, kb: [10, 5.5], pose: 'shoulder', enhanced: 'r_shoulder_od',
    vel: [{ frame: 4, until: 16, x: 12, mode: 'set' }, { frame: 17, x: 1, mode: 'set' }], hit: { wallBounce: true, launch: true, spark: 'heavy' }, cmd: { btn: 'S', dir: '6' }, fx: [{ frame: 4, cue: 'speedlines' }],
  }),
  strike({
    id: 'r_shoulder_od', name: 'Shoulder Charge (OD)', input: '6S [Overdrive]', desc: 'Overdrive: armored (1 hit) and faster.', strength: 'S', kind: 'special', f: [4, 11, 12], box: B(10, 40, 54, 74), dmg: 90, kb: [12, 6], pose: 'shoulder',
    armor: { frames: [1, 14], hits: 1, damageMult: 0.5 }, vel: [{ frame: 2, until: 14, x: 15, mode: 'set' }, { frame: 15, x: 1, mode: 'set' }], hit: { wallBounce: true, launch: true, spark: 'heavy' }, fx: [{ frame: 2, cue: 'speedlines' }],
  }),
  {
    id: 'r_flash', name: 'Flash Step', input: '4S', desc: 'Blurs through the opponent (strike-invulnerable 2-8) and turns around. Cancelable into anything from frame 10.', kind: 'special', strength: 'S', stance: 'ground', total: 20,
    vel: [{ frame: 2, until: 8, x: 16, mode: 'set' }, { frame: 9, x: 2, mode: 'set' }], noPush: [1, 12], invuln: [{ frames: [2, 8], types: ['strike'] }], autoFaceAt: 10, pose: 'dash', cmd: { btn: 'S', dir: '4' },
    cancels: { window: [10, 19], always: ['any', 'super', 'jump'] }, fx: [{ frame: 2, cue: 'afterimage' }],
  },
  strike({
    id: 'r_dp', name: 'Tiger Knee', input: '8S', desc: 'Strike-invulnerable (1-6) rising knee. Helpless after.', strength: 'S', kind: 'special', f: [5, 8, 24], box: B(4, 50, 54, 90), dmg: 86, kb: [3, 12.5], pose: 'knee',
    invuln: [{ frames: [1, 6], types: ['strike'] }], vel: [{ frame: 5, y: 11.5, x: 4, mode: 'set' }], helpless: true, landing: { mode: 'continue' }, hit: { launch: true, priority: 5, spark: 'heavy' }, cmd: { btn: 'S', dir: 'u' },
  }),
  strike({
    id: 'r_sweep', name: 'Cyclone Sweep', input: '2S', desc: 'Spinning low sweep. Hard knockdown.', strength: 'S', kind: 'special', f: [8, 8, 20], box: B(-40, 0, 120, 20), dmg: 58, guard: 'low', kb: [3, 5], pose: 'sweep',
    hit: { launch: true, hardKnockdown: true }, cmd: { btn: 'S', dir: 'd' },
  }),
  strike({
    id: 'r_meteor', name: 'Meteor Fist', input: 'j.S', desc: 'Diving punch that ground-bounces on hit.', strength: 'S', kind: 'special', air: true, f: [8, 16, 10], box: B(4, -8, 52, 48), dmg: 58, guard: 'high', kb: [3, -7], pose: 'divekick',
    vel: [{ frame: 8, until: 24, x: 11, y: -11, mode: 'set' }], gravity: 0, hit: { groundBounce: true, spark: 'heavy' }, landing: { mode: 'end', lag: 8 }, cmd: { btn: 'S', dir: '*', air: true },
  }),
  {
    id: 'r_overdrive', name: 'Overdrive', input: '5X', desc: '1 bar to activate, then drains meter (up to 10s). +20% movement speed, +15% damage, free whiff cancels on normals, enhanced Rush Combo and Shoulder Charge.', kind: 'super', strength: 'X', stance: 'ground', total: 20, superFreeze: 20,
    cost: { meter: 100 }, requires: { noInstall: true }, install: { frames: 600, drainPerFrame: 0.2 }, invuln: [{ frames: [1, 12], types: ['strike', 'throw', 'projectile'] }], pose: 'burst', cmd: { btn: 'X', dir: '5' }, fx: [{ frame: 1, cue: 'superflash' }, { frame: 2, cue: 'install' }],
  },
  {
    id: 'r_super_rampage', name: 'Rampage', input: '6X', desc: '1 bar. Dashing grab-punch flurry into an uppercut finisher.', kind: 'super', strength: 'X', stance: 'ground', total: 62, superFreeze: 24, cost: { meter: 100 },
    invuln: [{ frames: [1, 10], types: ['strike', 'throw', 'projectile'] }], vel: [{ frame: 4, until: 12, x: 14, mode: 'set' }, { frame: 13, x: 0, mode: 'set' }], pose: 'rush',
    hits: [
      multiHit(6, 34, 3, B(0, 30, 90, 90), 16, { hitstun: 22, unburstable: true, ignoreDecay: true, pullTo: { x: 55, y: 0 }, spark: 'medium', proration: 0.98 }),
      hitAt(40, 42, B(0, 40, 80, 130), 90, { hitstun: 34, knockback: { x: 3, y: 15 }, launch: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 15 }),
    ],
    cmd: { btn: 'X', dir: '6' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 'r_super_final', name: 'Final Heat', input: '2X', desc: '2 bars + 50 Heat. Point-blank haymaker; consumes all Heat and scales with it.', kind: 'super', strength: 'X', stance: 'ground', total: 50, superFreeze: 30, cost: { meter: 200 },
    requires: { resource: { heat: 50 } }, invuln: [{ frames: [1, 8], types: ['strike', 'throw', 'projectile'] }], pose: 'heavy_punch', vel: [{ frame: 6, until: 10, x: 10, mode: 'set' }],
    hits: [hitAt(10, 12, B(6, 40, 80, 90), 220, { hitstun: 40, knockback: { x: 16, y: 6 }, launch: true, wallBounce: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 16 })],
    onFrame: ({ f, frame }) => {
      if (frame === 13) f.resources.heat = 0;
    },
    cmd: { btn: 'X', dir: 'd' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
];

export const RIOT: CharacterDef = {
  id: 'riot',
  name: 'Riot',
  title: 'Street Comet',
  archetype: 'High-speed brawler',
  blurb: '3-frame jabs, wall jumps, cross-up flash steps and a Heat gauge that rewards never backing off. Overdrive turns pressure into a blur.',
  maxHp: 1000,
  walkSpeed: 3.8,
  backWalkSpeed: 3,
  runSpeed: 9.5,
  dashSpeed: 12,
  dashFrames: 11,
  backdashSpeed: 9,
  backdashFrames: 14,
  jumpVel: 14,
  shortHopVel: 9,
  jumpHSpeed: 5,
  doubleJumpVel: 12.5,
  airDashSpeed: 11.5,
  airDashFrames: 10,
  gravity: 0.68,
  fallSpeed: 14,
  fastFallSpeed: 19,
  airAccel: 0.5,
  airMaxSpeed: 5.5,
  weight: 1.08,
  maxAirOptions: 1,
  wallJump: true,
  width: 42,
  height: 115,
  crouchHeight: 72,
  resources: [{ name: 'heat', label: 'HEAT', max: 100, start: 0, display: 'bar', color: '#ef233c' }],
  onUpdate: (_sim, f) => {
    // Heat builds while moving forward / dashing, decays while passive or retreating.
    const r = f.resources;
    const forward = f.vx * f.facing > 2.5 && (f.state === 'run' || f.state === 'dash' || f.state === 'walk');
    if (forward) r.heat = Math.min(100, r.heat + 0.12);
    else if (f.vx * f.facing < -1 || f.state === 'blockstun') r.heat = Math.max(0, r.heat - 0.25);
    else r.heat = Math.max(0, r.heat - 0.04);
  },
  onHitLanded: (_sim, f, _v, blocked) => {
    f.resources.heat = Math.min(100, f.resources.heat + (blocked ? 2 : 5));
  },
  damageMult: (f) => heatMult(f) * (f.install ? 1.15 : 1),
  speedMult: (f) => (f.install ? 1.2 : 1),
  moves,
  projectiles: [],
  palette: { primary: '#2b2d42', secondary: '#ef233c', accent: '#ffd60a', aura: '#ef233c', skin: '#8d5524' },
};

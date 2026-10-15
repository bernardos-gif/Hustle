// BASTION — mechanized heavyweight. No air jumps or air dashes: instead a fuel tank powers
// free 8-way jet flight (D in the air). Armored long-range pistons, an untechable command grab,
// an air grab piledriver, a drone summon and ground shockwaves. Slow, huge, hits like a truck.

import type { CharacterDef, MoveDef } from '../combat/types';
import { B, hitAt, projectile, strike } from './kit';

const moves: MoveDef[] = [
  strike({ id: 'b_5L', name: 'Piston Jab', input: '5L', desc: 'Heavy jab — slower than other lights, but long.', strength: 'L', f: [6, 2, 10], box: B(20, 82, 58, 24), dmg: 38, pose: 'jab', cmd: { btn: 'L', dir: '5' } }),
  strike({ id: 'b_5M', name: 'Hammer Hook', input: '5M', desc: 'Swinging hook with big pushback.', strength: 'M', f: [10, 4, 16], box: B(14, 62, 78, 44), dmg: 68, kb: [6, 0], pose: 'hook', hit: { spark: 'blunt' }, cmd: { btn: 'M', dir: '5' } }),
  strike({
    id: 'b_5H', name: 'Gigaton Straight', input: '5H', desc: 'Armored (1 hit, frames 6-16) haymaker that wall-bounces.', strength: 'H', f: [16, 4, 24], box: B(20, 70, 108, 36), dmg: 118, kb: [10, 3], pose: 'heavy_punch',
    armor: { frames: [6, 16], hits: 1, damageMult: 0.5 }, hit: { wallBounce: true, launch: true, spark: 'heavy', hitstop: 14 }, cmd: { btn: 'H', dir: '5' }, fx: [{ frame: 6, cue: 'armor' }],
  }),
  strike({ id: 'b_2L', name: 'Low Knuckle', input: '2L', desc: 'Low punch.', strength: 'L', f: [6, 2, 10], box: B(18, 4, 60, 22), dmg: 32, guard: 'low', pose: 'lowjab', cmd: { btn: 'L', dir: 'd' } }),
  strike({ id: 'b_2M', name: 'Ground Smash', input: '2M', desc: 'Low fist smash.', strength: 'M', f: [12, 4, 18], box: B(20, 0, 84, 24), dmg: 66, guard: 'low', kb: [3, 0], pose: 'lowjab', hit: { spark: 'blunt' }, cmd: { btn: 'M', dir: 'd' } }),
  strike({
    id: 'b_2H', name: 'Uplift', input: '2H', desc: 'Huge rising uppercut launcher. Anti-air with high priority.', strength: 'H', f: [12, 5, 26], box: B(8, 60, 76, 116), dmg: 92, kb: [1.5, 13], pose: 'uppercut',
    hit: { launch: true, airUnblockable: true, priority: 5, spark: 'heavy' }, cancels: { onHit: ['special', 'super', 'jump'], onBlock: ['special', 'super'], onWhiff: ['special'] }, cmd: { btn: 'H', dir: 'd' },
  }),
  strike({
    id: 'b_6H', name: 'Overhead Hammer', input: '6H', desc: 'Armored two-fisted overhead that ground-bounces.', strength: 'H', kind: 'command', f: [24, 5, 20], box: B(18, 10, 88, 120), dmg: 105, guard: 'high', kb: [2, 4], pose: 'slam',
    armor: { frames: [8, 24], hits: 1, damageMult: 0.5 }, hit: { launch: true, groundBounce: true, spark: 'heavy', hitstop: 14 }, cmd: { btn: 'H', dir: '6' }, fx: [{ frame: 29, cue: 'shockwave' }],
  }),
  strike({ id: 'b_jL', name: 'Air Knuckle', input: 'j.L', desc: 'Air jab.', strength: 'L', air: true, f: [5, 3, 9], box: B(12, 50, 56, 32), dmg: 34, pose: 'air_punch', cmd: { btn: 'L', dir: '*', air: true } }),
  strike({ id: 'b_jM', name: 'Elbow Drop', input: 'j.M', desc: 'Downward elbow.', strength: 'M', air: true, f: [8, 5, 13], box: B(0, 0, 66, 60), dmg: 58, guard: 'high', kb: [3, -2], pose: 'air_hammer', cmd: { btn: 'M', dir: '*', air: true } }),
  strike({ id: 'b_jH', name: 'Sledge Spike', input: 'j.H', desc: 'Double-fisted spike. Ground-bounces.', strength: 'H', air: true, f: [11, 5, 16], box: B(-6, -10, 86, 80), dmg: 82, guard: 'high', kb: [2, -10], pose: 'air_hammer', hit: { groundBounce: true, spark: 'heavy' }, cmd: { btn: 'H', dir: '*', air: true } }),
  strike({
    id: 'b_j2H', name: 'Meteor Press', input: 'j.2H', desc: 'Body-slam dive; landing creates a shockwave.', strength: 'H', air: true, f: [8, 30, 6], box: B(-30, -14, 92, 60), dmg: 80, guard: 'high', kb: [3, 6], pose: 'stomp',
    vel: [{ frame: 8, until: 38, x: 2, y: -17, mode: 'set' }], gravity: 0, hit: { launch: true, spark: 'heavy' }, landing: { mode: 'goto', goto: 'b_quake_land' }, cmd: { btn: 'H', dir: 'd', air: true },
  }),
  strike({ id: 'b_quake_land', name: 'Impact', input: '', desc: '', hidden: true, strength: 'H', f: [1, 4, 18], box: B(-80, 0, 160, 30), dmg: 40, guard: 'low', kb: [4, 6], pose: 'stomp', hit: { launch: true, otg: true, spark: 'heavy' }, cancels: 'none', fx: [{ frame: 1, cue: 'shockwave' }] }),
  strike({
    id: 'b_piston', name: 'Piston Punch', input: '6S', desc: '20 fuel. The arm extends across a third of the screen. Armored frames 4-14. Very punishable whiff.', strength: 'S', kind: 'special', f: [14, 6, 28], box: B(40, 72, 190, 28), dmg: 98, kb: [8, 2], pose: 'piston',
    cost: { resource: { fuel: 20 } }, armor: { frames: [4, 14], hits: 1, damageMult: 0.5 }, hit: { wallBounce: true, launch: true, spark: 'heavy', destroysProjectiles: true }, cmd: { btn: 'S', dir: '6' }, fx: [{ frame: 14, cue: 'steam' }],
  }),
  {
    id: 'b_crusher', name: 'Crusher Grab', input: '4S', desc: 'Untechable command grab with long range. Massive recovery if it whiffs.', kind: 'special', strength: 'S', stance: 'ground', total: 52,
    throw: { frames: [10, 12], box: B(0, 0, 98, 130), target: 'ground', success: 'b_crusher_hit', techable: false, hold: { x: 60, y: 40 } }, pose: 'grab_heavy', cmd: { btn: 'S', dir: '4' },
  },
  {
    id: 'b_crusher_hit', name: 'Crusher (hit)', input: '', desc: '', hidden: true, kind: 'special', strength: 'S', stance: 'ground', total: 54, pose: 'slam',
    hits: [
      hitAt(20, 20, [], 60, { grabHit: true, guard: 'unblockable', hitstun: 40, knockback: { x: 0, y: 0 }, spark: 'heavy', proration: 0.8 }),
      hitAt(38, 38, [], 120, { grabHit: true, release: true, guard: 'unblockable', hitstun: 36, knockback: { x: 11, y: 6 }, launch: true, wallBounce: true, spark: 'heavy', proration: 0.6, hitstop: 14 }),
    ],
    cancels: { window: [44, 53], onHit: ['super'] }, fx: [{ frame: 38, cue: 'shockwave' }],
  },
  {
    id: 'b_drone', name: 'Deploy Drone', input: '5S', desc: '30 fuel. A drone hovers behind Bastion and fires a laser every 80 frames. Destroyed if Bastion is hit.', kind: 'special', strength: 'S', stance: 'ground', total: 30,
    cost: { resource: { fuel: 30 } }, requires: { noObject: 'b_drone' }, spawns: [{ frame: 14, projectile: 'b_drone', offset: { x: -40, y: 170 } }], pose: 'summon', cmd: { btn: 'S', dir: '5' },
    cancels: { window: [18, 29], always: ['any'] },
  },
  {
    id: 'b_drone_fire', name: 'Drone Fire', input: '5S (drone out)', desc: 'Commands the drone to fire immediately.', kind: 'special', strength: 'S', stance: 'ground', total: 14,
    requires: { object: 'b_drone' }, pose: 'cast', cmd: { btn: 'S', dir: '5', priority: 1 }, cancels: { window: [6, 13], always: ['any'] },
    onFrame: ({ sim, f, frame }) => {
      if (frame !== 4) return;
      const d = sim.state.projectiles.find((p) => p.owner === f.idx && p.defId === 'b_drone' && !p.dead);
      if (d) d.data.fire = 1;
    },
  },
  strike({
    id: 'b_rocket', name: 'Rocket Uppercut', input: '8S', desc: '25 fuel. Armored rising uppercut (frames 1-10). Leaves Bastion helpless.', strength: 'S', kind: 'special', f: [8, 10, 28], box: B(6, 60, 72, 120), dmg: 108, kb: [3, 13.5], pose: 'rocket_up',
    cost: { resource: { fuel: 25 } }, armor: { frames: [1, 10], hits: 2, damageMult: 0.5 }, vel: [{ frame: 8, y: 13, x: 2, mode: 'set' }], helpless: true, landing: { mode: 'continue' }, hit: { launch: true, priority: 5, spark: 'heavy' }, cmd: { btn: 'S', dir: 'u' }, fx: [{ frame: 8, cue: 'thruster' }],
  }),
  {
    id: 'b_stomp', name: 'Seismic Stomp', input: '2S', desc: 'Sends a low shockwave along the ground. Hits knocked-down opponents.', kind: 'special', strength: 'S', stance: 'ground', total: 40,
    spawns: [{ frame: 16, projectile: 'b_quake', offset: { x: 40, y: 0 } }], pose: 'stomp', cmd: { btn: 'S', dir: 'd' }, fx: [{ frame: 16, cue: 'shockwave' }],
  },
  strike({
    id: 'b_slam', name: 'Thruster Slam', input: 'j.S', desc: '20 fuel. Rocket-powered diagonal dive that ground-bounces.', strength: 'S', kind: 'special', air: true, f: [10, 20, 10], box: B(0, -10, 70, 80), dmg: 85, guard: 'high', kb: [3, -8], pose: 'divekick',
    cost: { resource: { fuel: 20 } }, vel: [{ frame: 10, until: 30, x: 10, y: -12, mode: 'set' }], gravity: 0, hit: { groundBounce: true, spark: 'heavy' }, landing: { mode: 'goto', goto: 'b_quake_land' }, cmd: { btn: 'S', dir: '*', air: true }, fx: [{ frame: 10, cue: 'thruster' }],
  }),
  {
    id: 'b_skyhook', name: 'Skyhook', input: 'j.T', desc: 'Air grab into a piledriver.', kind: 'throw', stance: 'air', total: 30,
    throw: { frames: [6, 10], box: B(0, -20, 84, 130), target: 'any', success: 'b_skyhook_hit', techable: true, hold: { x: 30, y: 100 } }, landing: { mode: 'end', lag: 10 }, pose: 'grab_heavy', cmd: { btn: 'T', dir: '*', air: true },
  },
  {
    id: 'b_skyhook_hit', name: 'Piledriver', input: '', desc: '', hidden: true, kind: 'throw', stance: 'air', total: 60, gravity: 0, pose: 'slam',
    vel: [{ frame: 1, until: 10, x: 0, y: 6, mode: 'set' }, { frame: 11, until: 60, x: 0, y: -16, mode: 'set' }],
    landing: { mode: 'goto', goto: 'b_pile_land' },
  },
  {
    id: 'b_super_mega', name: 'Gigaton Megablast', input: '5X', desc: '1 bar. Fully armored rocket punch that crosses the screen and wall-bounces.', kind: 'super', strength: 'X', stance: 'ground', total: 64, superFreeze: 28, cost: { meter: 100 },
    armor: { frames: [1, 34], hits: 99, damageMult: 0.4 }, vel: [{ frame: 18, until: 32, x: 15, mode: 'set' }, { frame: 33, x: 0, mode: 'set' }], pose: 'piston',
    hits: [hitAt(18, 34, B(10, 50, 130, 70), 240, { hitstun: 40, knockback: { x: 15, y: 7 }, launch: true, wallBounce: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 16, destroysProjectiles: true, priority: 9 })],
    cmd: { btn: 'X', dir: '5' }, fx: [{ frame: 1, cue: 'superflash' }, { frame: 18, cue: 'thruster' }],
  },
  {
    id: 'b_super_suplex', name: 'Orbital Suplex', input: '4X', desc: '2 bars. Strike-invulnerable untechable command grab super.', kind: 'super', strength: 'X', stance: 'ground', total: 46, superFreeze: 20, cost: { meter: 200 },
    invuln: [{ frames: [1, 9], types: ['strike', 'projectile'] }], throw: { frames: [8, 10], box: B(0, 0, 110, 140), target: 'ground', success: 'b_suplex_hit', techable: false, hold: { x: 40, y: 0 } }, pose: 'grab_heavy', cmd: { btn: 'X', dir: '4' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 'b_suplex_hit', name: 'Orbital Suplex (hit)', input: '', desc: '', hidden: true, kind: 'super', strength: 'X', stance: 'ground', total: 80, gravity: 0.6, pose: 'slam',
    vel: [{ frame: 6, y: 18, x: 0, mode: 'set' }],
    hits: [hitAt(30, 30, [], 80, { grabHit: true, guard: 'unblockable', hitstun: 60, knockback: { x: 0, y: 0 }, unburstable: true, ignoreDecay: true, spark: 'heavy' })],
    landing: { mode: 'goto', goto: 'b_suplex_land' },
  },
  {
    id: 'b_super_air', name: 'Satellite Drop', input: 'j.X', desc: '1 bar. Thrusters fire straight down for a screen-shaking crash.', kind: 'super', strength: 'X', stance: 'air', total: 40, superFreeze: 20, cost: { meter: 100 }, gravity: 0,
    armor: { frames: [1, 40], hits: 99, damageMult: 0.4 }, vel: [{ frame: 6, until: 40, x: 3, y: -22, mode: 'set' }], pose: 'stomp', landing: { mode: 'goto', goto: 'b_super_air_land' },
    hits: [hitAt(6, 40, B(-40, -30, 140, 100), 120, { hitstun: 36, knockback: { x: 2, y: -10 }, groundBounce: true, unburstable: true, ignoreDecay: true, spark: 'super' })],
    cmd: { btn: 'X', dir: '*', air: true }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  strike({ id: 'b_super_air_land', name: 'Satellite Impact', input: '', desc: '', hidden: true, strength: 'X', kind: 'super', f: [1, 6, 26], box: B(-160, 0, 320, 60), dmg: 90, guard: 'unblockable', kb: [7, 10], pose: 'stomp', hit: { launch: true, otg: true, unburstable: true, spark: 'super' }, cancels: 'none', fx: [{ frame: 1, cue: 'shockwave' }] }),
];

// Grab follow-ups that finish on landing release the victim through these landing moves.
moves.push(
  {
    id: 'b_pile_land', name: 'Piledriver Impact', input: '', desc: '', hidden: true, kind: 'throw', stance: 'ground', total: 30, pose: 'stomp',
    hits: [hitAt(1, 1, [], 140, { grabHit: true, release: true, guard: 'unblockable', hitstun: 40, knockback: { x: 6, y: 9 }, launch: true, hardKnockdown: true, spark: 'heavy', proration: 0.6, hitstop: 15 })],
    cancels: { window: [16, 29], onHit: ['super'] }, fx: [{ frame: 1, cue: 'shockwave' }],
  },
  {
    id: 'b_suplex_land', name: 'Orbital Impact', input: '', desc: '', hidden: true, kind: 'super', stance: 'ground', total: 36, pose: 'stomp',
    hits: [hitAt(1, 1, [], 260, { grabHit: true, release: true, guard: 'unblockable', hitstun: 50, knockback: { x: 6, y: 10 }, launch: true, hardKnockdown: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 16 })],
    fx: [{ frame: 1, cue: 'shockwave' }],
  },
);

export const BASTION: CharacterDef = {
  id: 'bastion',
  name: 'Bastion',
  title: 'Siege Engine',
  archetype: 'Mechanized heavyweight',
  blurb: 'Armored pistons, an untechable command grab and jet-fuel flight in any direction. Slow and enormous, with the most health in the cast.',
  maxHp: 1200,
  walkSpeed: 2.2,
  backWalkSpeed: 1.8,
  runSpeed: 5,
  dashSpeed: 7.5,
  dashFrames: 18,
  backdashSpeed: 6,
  backdashFrames: 20,
  jumpVel: 11.5,
  shortHopVel: 8,
  jumpHSpeed: 3.4,
  doubleJumpVel: 0,
  airDashSpeed: 0,
  airDashFrames: 0,
  gravity: 0.72,
  fallSpeed: 15,
  fastFallSpeed: 20,
  airAccel: 0.2,
  airMaxSpeed: 3.5,
  weight: 0.8,
  maxAirOptions: 0,
  width: 60,
  height: 140,
  crouchHeight: 96,
  resources: [{ name: 'fuel', label: 'FUEL', max: 100, start: 100, groundRegen: 0.55, display: 'bar', color: '#f77f00' }],
  flight: { resource: 'fuel', drain: 0.3, accel: 0.75, maxSpeed: 8, brake: 0.86, minFuel: 12 },
  moves,
  projectiles: [
    projectile({
      id: 'b_drone', name: 'Drone', box: B(0, -16, 34, 30), speed: { x: 0, y: 0 }, lifetime: 900, inert: true, maxCount: 1, ownerHitDestroys: true, style: 'drone', color: '#f77f00',
      hit: { damage: 0, guard: 'mid', hitstun: 0, blockstun: 0, knockback: { x: 0, y: 0 } },
      update: (sim, p) => {
        const o = sim.state.fighters[p.owner];
        const t = sim.state.fighters[p.owner === 0 ? 1 : 0];
        // hover behind the owner
        const tx = o.x - o.facing * 50;
        const ty = o.y + 165;
        p.vx = (tx - p.x) * 0.12;
        p.vy = (ty - p.y) * 0.12;
        p.facing = t.x > p.x ? 1 : -1;
        p.data.cool = (p.data.cool ?? 40) - 1;
        const want = p.data.fire === 1;
        p.data.fire = 0;
        if (p.data.cool <= 0 || (want && p.data.cool <= 60)) {
          p.data.cool = 80;
          const dx = t.x - p.x;
          const dy = t.y + 60 - p.y;
          const len = Math.hypot(dx, dy) || 1;
          const shot = sim.spawnProjectile(o, { frame: 0, projectile: 'b_laser', offset: { x: 0, y: 0 } }, 0);
          if (shot) {
            shot.x = p.x;
            shot.y = p.y;
            shot.facing = dx >= 0 ? 1 : -1;
            shot.vx = (dx / len) * 13;
            shot.vy = (dy / len) * 13;
          }
        }
      },
    }),
    projectile({ id: 'b_laser', name: 'Drone Laser', box: B(0, -5, 22, 10), speed: { x: 13, y: 0 }, lifetime: 70, groundDestroy: true, style: 'laser', color: '#ff5400', hit: { damage: 30, guard: 'mid', hitstun: 18, blockstun: 10, knockback: { x: 2, y: 1 }, spark: 'electric', proration: 0.85 } }),
    projectile({ id: 'b_quake', name: 'Shockwave', box: B(0, 0, 50, 34), speed: { x: 9, y: 0 }, lifetime: 55, style: 'quake', color: '#f4a261', power: 2, durability: 2, reflectable: false, hit: { damage: 55, guard: 'low', hitstun: 24, blockstun: 12, knockback: { x: 2, y: 7 }, launch: true, otg: true, spark: 'heavy' } }),
  ],
  palette: { primary: '#343a40', secondary: '#f77f00', accent: '#fcbf49', aura: '#f77f00', skin: '#6c757d' },
};

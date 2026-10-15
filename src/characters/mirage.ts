// MIRAGE — mobility trickster. Three air options (one refunded on air hits), an anchor she can
// blink back to, a tether that yanks opponents in, an exploding decoy, cross-up rushes and an
// air teleport behind the opponent. Low health and light weight (flies far when hit).

import type { CharacterDef, FighterState, MoveDef } from '../combat/types';
import type { Sim } from '../combat/sim';
import { CFG } from '../combat/config';
import { B, hitAt, projectile, strike } from './kit';

function teleport(sim: Sim, f: FighterState, x: number, y: number): void {
  const fromX = f.x;
  const fromY = f.y;
  f.x = Math.max(CFG.stage.left + 30, Math.min(CFG.stage.right - 30, x));
  f.y = Math.max(0, y);
  f.grounded = f.y <= 0;
  f.vx = 0;
  f.vy = 0;
  sim.faceOpponent(f);
  sim.emit({ type: 'teleport', frame: sim.state.frame, fighter: f.idx, fromX, fromY, x: f.x, y: f.y });
}

const moves: MoveDef[] = [
  strike({ id: 'm_5L', name: 'Flick Kick', input: '5L', desc: 'Fast snap kick.', strength: 'L', f: [4, 2, 8], box: B(12, 55, 52, 22), dmg: 25, pose: 'kick_mid', cmd: { btn: 'L', dir: '5' } }),
  strike({ id: 'm_5M', name: 'Spinning Heel', input: '5M', desc: 'Mid-range spinning kick.', strength: 'M', f: [7, 3, 12], box: B(4, 60, 72, 30), dmg: 44, kb: [4, 0], pose: 'roundhouse', cmd: { btn: 'M', dir: '5' } }),
  strike({ id: 'm_5H', name: 'Crescent Kick', input: '5H', desc: 'Launching crescent kick. Jump-cancelable on hit.', strength: 'H', f: [10, 4, 17], box: B(0, 70, 82, 52), dmg: 64, kb: [3, 12.5], pose: 'kick_high', hit: { launch: true }, cancels: { onHit: ['special', 'super', 'jump'], onBlock: ['special', 'super'], onWhiff: ['special'] }, cmd: { btn: 'H', dir: '5' } }),
  strike({ id: 'm_2L', name: 'Low Tap', input: '2L', desc: 'Quick low kick.', strength: 'L', f: [4, 2, 8], box: B(12, 0, 54, 18), dmg: 22, guard: 'low', pose: 'lowkick', cmd: { btn: 'L', dir: 'd' } }),
  strike({
    id: 'm_2M', name: 'Phantom Slide', input: '2M', desc: 'Low-profile slide that travels under projectiles and high attacks.', strength: 'M', f: [5, 9, 12], box: B(4, 0, 62, 20), dmg: 44, guard: 'low', kb: [3, 0], pose: 'slide',
    vel: [{ frame: 4, until: 13, x: 8.5, mode: 'set' }], hurt: [{ frames: [3, 22], boxes: [B(-24, 0, 70, 34)] }], cmd: { btn: 'M', dir: 'd' },
  }),
  strike({ id: 'm_2H', name: 'Scissor Sweep', input: '2H', desc: 'Low sweep, knocks down.', strength: 'H', f: [9, 3, 20], box: B(8, 0, 86, 18), dmg: 60, guard: 'low', kb: [2, 4.5], pose: 'sweep', hit: { launch: true }, cmd: { btn: 'H', dir: 'd' } }),
  strike({
    id: 'm_6M', name: 'Hop Kick', input: '6M', desc: 'Hopping overhead kick that passes over lows.', strength: 'M', kind: 'command', f: [16, 3, 12], box: B(8, 30, 58, 50), dmg: 46, guard: 'high', pose: 'air_kick',
    vel: [{ frame: 3, y: 6.5, x: 4, mode: 'set' }], landing: { mode: 'continue' }, cmd: { btn: 'M', dir: '6' },
  }),
  strike({ id: 'm_4H', name: 'Mirror Palm', input: '4H', desc: 'Palm blast that wall-bounces.', strength: 'H', kind: 'command', f: [12, 3, 18], box: B(10, 48, 62, 50), dmg: 66, kb: [10, 1], pose: 'palm', hit: { wallBounce: true, launch: true }, cmd: { btn: 'H', dir: '4' } }),
  strike({ id: 'm_jL', name: 'Air Flick', input: 'j.L', desc: 'Fast air kick.', strength: 'L', air: true, f: [4, 3, 7], box: B(8, 30, 52, 30), dmg: 24, pose: 'air_kick', cmd: { btn: 'L', dir: '*', air: true } }),
  strike({ id: 'm_jM', name: 'Air Spin', input: 'j.M', desc: 'Hits on both sides — a cross-up tool.', strength: 'M', air: true, f: [6, 5, 11], box: B(-44, 28, 104, 40), dmg: 40, pose: 'spin', cmd: { btn: 'M', dir: '*', air: true } }),
  strike({ id: 'm_jH', name: 'Air Axe', input: 'j.H', desc: 'Overhead axe kick. Spikes and ground-bounces airborne foes.', strength: 'H', air: true, f: [9, 4, 14], box: B(0, 4, 62, 62), dmg: 58, guard: 'high', kb: [2, -9], pose: 'air_hammer', hit: { groundBounce: true }, cmd: { btn: 'H', dir: '*', air: true } }),
  strike({
    id: 'm_j2M', name: 'Divekick', input: 'j.2M', desc: 'Steep divekick. Mix up its angle and timing.', strength: 'M', air: true, f: [6, 16, 8], box: B(6, -6, 46, 40), dmg: 42, guard: 'high', kb: [3, 0], pose: 'divekick',
    vel: [{ frame: 6, until: 22, x: 9, y: -10, mode: 'set' }], gravity: 0, landing: { mode: 'end', lag: 7 }, cmd: { btn: 'M', dir: 'd', air: true },
  }),
  {
    id: 'm_airthrow', name: 'Sky Toss', input: 'j.T', desc: 'Air throw. Grabs airborne opponents and hurls them downward.', kind: 'throw', stance: 'air', total: 30,
    throw: { frames: [5, 8], box: B(0, 20, 70, 90), target: 'air', success: 'm_airthrow_hit', techable: true, hold: { x: 50, y: 0 } }, landing: { mode: 'end', lag: 8 }, pose: 'throw_reach', cmd: { btn: 'T', dir: '*', air: true },
  },
  {
    id: 'm_airthrow_hit', name: 'Sky Toss (hit)', input: '', desc: '', hidden: true, kind: 'throw', stance: 'air', total: 26, gravity: 0, vel: [{ frame: 1, x: 0, y: 0, mode: 'set' }], landing: { mode: 'end', lag: 4 },
    hits: [hitAt(14, 14, [], 80, { grabHit: true, release: true, guard: 'unblockable', hitstun: 30, knockback: { x: 3, y: -10 }, groundBounce: true, launch: true, proration: 0.6 })],
    cancels: { window: [16, 25], onHit: ['special', 'super', 'dash', 'jump'] }, pose: 'throw_toss',
  },
  {
    id: 'm_hook', name: 'Tether Hook', input: '5S', desc: 'Throws a hook that yanks the opponent right in front of you.', kind: 'special', strength: 'S', stance: 'ground', total: 36,
    spawns: [{ frame: 10, projectile: 'm_hook', offset: { x: 40, y: 70 } }], pose: 'cast', cmd: { btn: 'S', dir: '5' }, cancels: { window: [20, 35], always: ['super'] },
  },
  {
    id: 'm_anchor', name: 'Plant Anchor', input: '2S', desc: 'Leaves a phase anchor where you stand (one at a time). Blink returns you to it.', kind: 'special', strength: 'S', stance: 'ground', total: 20,
    spawns: [{ frame: 8, projectile: 'm_anchor', offset: { x: 0, y: 0 } }], pose: 'summon', cmd: { btn: 'S', dir: 'd' }, cancels: { window: [12, 19], always: ['any'] },
  },
  {
    id: 'm_blink', name: 'Blink', input: '8S (ground or air)', desc: 'Teleports to your anchor on frame 8, consuming it. Fully invulnerable 1-10.', kind: 'special', strength: 'S', stance: 'ground', total: 22,
    requires: { object: 'm_anchor' }, invuln: [{ frames: [1, 10], types: ['strike', 'throw', 'projectile'] }], pose: 'teleport', cmd: { btn: 'S', dir: 'u' },
    cancels: { window: [12, 21], always: ['any', 'jump'] },
    onFrame: ({ sim, f, frame }) => {
      if (frame !== 8) return;
      const a = sim.state.projectiles.find((p) => p.owner === f.idx && p.defId === 'm_anchor' && !p.dead);
      if (!a) return;
      teleport(sim, f, a.x, a.y);
      sim.killProjectile(a, true);
    },
  },
  {
    id: 'm_blink_air', name: 'Air Blink', input: 'j.8S', desc: 'Airborne blink to the anchor. Costs an air option.', kind: 'special', strength: 'S', stance: 'air', total: 22, gravity: 0.2,
    requires: { object: 'm_anchor' }, cost: { airOption: 1 }, invuln: [{ frames: [1, 10], types: ['strike', 'throw', 'projectile'] }], pose: 'teleport', cmd: { btn: 'S', dir: 'u', air: true },
    vel: [{ frame: 1, x: 0, y: 0, mode: 'set' }], cancels: { window: [12, 21], always: ['any'] }, landing: { mode: 'continue' },
    onFrame: ({ sim, f, frame }) => {
      if (frame !== 8) return;
      const a = sim.state.projectiles.find((p) => p.owner === f.idx && p.defId === 'm_anchor' && !p.dead);
      if (!a) return;
      teleport(sim, f, a.x, a.y);
      sim.killProjectile(a, true);
    },
  },
  strike({
    id: 'm_rush', name: 'Phantom Rush', input: '6S', desc: 'Dashes through the opponent, striking on the way. Strike-invulnerable 3-10 and switches sides.', strength: 'S', kind: 'special', f: [5, 8, 14], box: B(-10, 20, 70, 90), dmg: 48, kb: [-3, 7],
    pose: 'dash_strike', vel: [{ frame: 3, until: 13, x: 14, mode: 'set' }, { frame: 14, x: 1, mode: 'set' }], noPush: [1, 16], invuln: [{ frames: [3, 10], types: ['strike'] }], autoFaceAt: 16, hit: { launch: true }, cmd: { btn: 'S', dir: '6' }, fx: [{ frame: 3, cue: 'afterimage' }],
  }),
  {
    id: 'm_decoy', name: 'Decoy', input: '4S', desc: 'Hops back leaving an afterimage that detonates after half a second.', kind: 'special', strength: 'S', stance: 'ground', total: 26,
    spawns: [{ frame: 2, projectile: 'm_decoy', offset: { x: 0, y: 0 } }], vel: [{ frame: 2, until: 9, x: -9, mode: 'set' }, { frame: 10, x: 0, mode: 'set' }], invuln: [{ frames: [1, 6], types: ['strike'] }],
    pose: 'evade', cmd: { btn: 'S', dir: '4' }, cancels: { window: [14, 25], always: ['special'] },
  },
  {
    id: 'm_ghost', name: 'Ghost Step', input: 'j.S', desc: 'Teleports behind the opponent on frame 11. Costs an air option. Readable startup.', kind: 'special', strength: 'S', stance: 'air', total: 28, gravity: 0.15,
    cost: { airOption: 1 }, vel: [{ frame: 1, x: 0, y: 0, mode: 'set' }], pose: 'teleport', cmd: { btn: 'S', dir: '*', air: true }, landing: { mode: 'continue' },
    cancels: { window: [13, 27], always: ['any'] },
    onFrame: ({ sim, f, opp, frame }) => {
      if (frame !== 11) return;
      teleport(sim, f, opp.x - opp.facing * 70, Math.max(opp.y + 40, 60));
    },
  },
  {
    id: 'm_stars', name: 'Mirror Shards', input: 'j.2S', desc: 'Fans three shards downward.', kind: 'special', strength: 'S', stance: 'air', total: 30, gravity: 0.3, pose: 'cast_down', cmd: { btn: 'S', dir: 'd', air: true },
    spawns: [
      { frame: 9, projectile: 'm_star', offset: { x: 20, y: 50 }, vel: { x: 12, y: -4 } },
      { frame: 9, projectile: 'm_star', offset: { x: 20, y: 50 }, vel: { x: 10, y: -8 } },
      { frame: 9, projectile: 'm_star', offset: { x: 20, y: 50 }, vel: { x: 6, y: -11 } },
    ],
    landing: { mode: 'end', lag: 6 },
  },
  {
    id: 'm_super_steps', name: 'Thousand Steps', input: '5X', desc: '1 bar. Teleports around the opponent striking from alternating sides, then launches.', kind: 'super', strength: 'X', stance: 'ground', total: 62, superFreeze: 26, cost: { meter: 100 },
    invuln: [{ frames: [1, 44], types: ['strike', 'throw', 'projectile'] }], pose: 'dash_strike', noPush: [1, 62], gravity: 0,
    hits: [
      hitAt(4, 6, B(-20, 0, 120, 120), 20, { hitstun: 30, knockback: { x: 0.5, y: 0 }, unburstable: true, ignoreDecay: true, spark: 'medium' }),
      hitAt(13, 15, B(-60, 0, 140, 140), 30, { hitstun: 30, knockback: { x: 0.5, y: 2 }, unburstable: true, ignoreDecay: true, spark: 'medium' }),
      hitAt(22, 24, B(-60, -20, 140, 160), 30, { hitstun: 30, knockback: { x: 0.5, y: 2 }, unburstable: true, ignoreDecay: true, spark: 'medium' }),
      hitAt(31, 33, B(-60, -20, 140, 160), 30, { hitstun: 30, knockback: { x: 0.5, y: 2 }, unburstable: true, ignoreDecay: true, spark: 'medium' }),
      hitAt(40, 42, B(-60, -20, 140, 180), 80, { hitstun: 34, knockback: { x: 5, y: 13 }, launch: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 14 }),
    ],
    onFrame: ({ sim, f, opp, frame }) => {
      if (frame === 1) f.vx = 14 * f.facing;
      if (frame === 12 || frame === 21 || frame === 30 || frame === 39) {
        if (f.moveHits[0] === 0) return; // whiffed the opener: no teleports
        const side = frame === 21 || frame === 39 ? 1 : -1;
        teleport(sim, f, opp.x + side * opp.facing * 65, opp.y);
      }
      if (frame === 44 && f.y > 0) f.vy = -4;
    },
    cmd: { btn: 'X', dir: '5' }, fx: [{ frame: 1, cue: 'superflash' }], landing: { mode: 'continue' },
  },
  {
    id: 'm_super_mirror', name: 'Mirror Lock', input: '2X', desc: '2 bars. Counter super: catches a strike on frames 4-30, then shatters the attacker.', kind: 'super', strength: 'X', stance: 'ground', total: 44, superFreeze: 20, cost: { meter: 200 },
    counter: { frames: [4, 30], followup: 'm_mirror_hit' }, pose: 'parry', cmd: { btn: 'X', dir: 'd' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 'm_mirror_hit', name: 'Mirror Shatter', input: '', desc: '', hidden: true, kind: 'super', strength: 'X', stance: 'ground', total: 48,
    invuln: [{ frames: [1, 30], types: ['strike', 'throw', 'projectile'] }], pose: 'palm', fx: [{ frame: 1, cue: 'flash' }],
    hits: [
      hitAt(3, 5, B(-40, 0, 170, 150), 60, { hitstun: 40, knockback: { x: 0.5, y: 0 }, unburstable: true, ignoreDecay: true, spark: 'super', pullTo: { x: 60, y: 0 } }),
      hitAt(18, 20, B(-40, 0, 170, 150), 170, { hitstun: 40, knockback: { x: 12, y: 9 }, launch: true, wallBounce: true, unburstable: true, ignoreDecay: true, spark: 'super', hitstop: 16 }),
    ],
  },
];

export const MIRAGE: CharacterDef = {
  id: 'mirage',
  name: 'Mirage',
  title: 'Phase Thief',
  archetype: 'Mobility trickster',
  blurb: 'Three air options, anchor teleports, a tether hook and cross-up rushes. Always somewhere else — but she cannot take many hits.',
  maxHp: 880,
  walkSpeed: 3.7,
  backWalkSpeed: 3.2,
  runSpeed: 8.6,
  dashSpeed: 11,
  dashFrames: 12,
  backdashSpeed: 9.5,
  backdashFrames: 16,
  jumpVel: 14.5,
  shortHopVel: 9.5,
  jumpHSpeed: 4.9,
  doubleJumpVel: 12.5,
  airDashSpeed: 12,
  airDashFrames: 10,
  gravity: 0.6,
  fallSpeed: 12,
  fastFallSpeed: 18,
  airAccel: 0.45,
  airMaxSpeed: 5.6,
  weight: 1.12,
  maxAirOptions: 3,
  airOptionsOnHit: 1,
  width: 40,
  height: 118,
  crouchHeight: 72,
  resources: [],
  moves,
  projectiles: [
    projectile({ id: 'm_hook', name: 'Tether Hook', box: B(0, -8, 26, 16), speed: { x: 16, y: 0 }, lifetime: 22, style: 'hook', color: '#c77dff', hit: { damage: 28, guard: 'mid', hitstun: 30, blockstun: 10, knockback: { x: 0, y: 0 }, pullTo: { x: 62, y: 0 }, spark: 'electric', proration: 0.85 }, reflectable: false }),
    projectile({ id: 'm_anchor', name: 'Phase Anchor', box: B(0, 0, 30, 30), speed: { x: 0, y: 0 }, lifetime: 900, inert: true, maxCount: 1, style: 'anchor', color: '#c77dff', hit: { damage: 0, guard: 'mid', hitstun: 0, blockstun: 0, knockback: { x: 0, y: 0 } } }),
    projectile({ id: 'm_decoy', name: 'Decoy', box: B(0, 0, 80, 120), speed: { x: 0, y: 0 }, lifetime: 44, delay: 30, maxCount: 1, style: 'decoy', color: '#e0aaff', hit: { damage: 50, guard: 'mid', hitstun: 26, blockstun: 14, knockback: { x: 4, y: 9 }, launch: true, spark: 'electric' }, reflectable: false, parryable: true }),
    projectile({ id: 'm_star', name: 'Mirror Shard', box: B(0, -6, 16, 12), speed: { x: 10, y: -6 }, lifetime: 40, style: 'star', color: '#e0aaff', groundDestroy: true, strikeDestroyable: true, hit: { damage: 18, guard: 'mid', hitstun: 16, blockstun: 9, knockback: { x: 2, y: 0 }, spark: 'light' } }),
  ],
  palette: { primary: '#3c096c', secondary: '#9d4edd', accent: '#e0aaff', aura: '#c77dff', skin: '#e8c8a8' },
};

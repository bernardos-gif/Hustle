// SOLENNE — elemental spellcaster. Spells cost mana (regenerates, or channel it), supers cost
// meter. Chargeable fire bolts, delayed frost spikes, a multi-hit lightning beam, a summoned
// orb she can detonate on command, and four different meter-powered spells.

import type { CharacterDef, MoveDef } from '../combat/types';
import { B, hitAt, multiHit, projectile, strike } from './kit';

const moves: MoveDef[] = [
  strike({ id: 's_5L', name: 'Spark Palm', input: '5L', desc: 'Quick electric palm.', strength: 'L', f: [5, 2, 9], box: B(12, 62, 48, 26), dmg: 26, pose: 'palm', hit: { spark: 'electric' }, cmd: { btn: 'L', dir: '5' } }),
  strike({ id: 's_5M', name: 'Staff Poke', input: '5M', desc: 'Long disjointed staff jab.', strength: 'M', f: [8, 3, 13], box: B(16, 56, 84, 16), dmg: 46, kb: [4, 0], pose: 'thrust', disjoint: true, cmd: { btn: 'M', dir: '5' } }),
  strike({ id: 's_5H', name: 'Flame Sweep', input: '5H', desc: 'Burning staff arc in front of her.', strength: 'H', f: [12, 5, 18], box: B(0, 30, 98, 76), dmg: 78, kb: [6, 1], pose: 'slash_wide', disjoint: true, hit: { spark: 'fire' }, cmd: { btn: 'H', dir: '5' } }),
  strike({ id: 's_2L', name: 'Low Staff', input: '2L', desc: 'Low staff tap.', strength: 'L', f: [5, 2, 9], box: B(12, 0, 60, 16), dmg: 22, guard: 'low', pose: 'lowjab', disjoint: true, cmd: { btn: 'L', dir: 'd' } }),
  strike({ id: 's_2M', name: 'Frost Trip', input: '2M', desc: 'Freezing low sweep with long reach.', strength: 'M', f: [8, 3, 15], box: B(10, 0, 88, 16), dmg: 44, guard: 'low', kb: [2, 0], pose: 'sweep', hit: { spark: 'ice' }, cmd: { btn: 'M', dir: 'd' } }),
  strike({
    id: 's_2H', name: 'Updraft', input: '2H', desc: 'Column of wind that launches. Jump-cancelable on hit.', strength: 'H', f: [10, 6, 22], box: B(-10, 40, 92, 110), dmg: 66, kb: [1, 14], pose: 'cast_up',
    hit: { launch: true, airUnblockable: true, spark: 'ice' }, cancels: { onHit: ['special', 'super', 'jump'], onBlock: ['special', 'super'], onWhiff: ['special'] }, cmd: { btn: 'H', dir: 'd' },
  }),
  strike({ id: 's_6H', name: 'Stone Fist', input: '6H', desc: 'Slow overhead earth slam.', strength: 'H', kind: 'command', f: [20, 4, 18], box: B(14, 0, 72, 120), dmg: 74, guard: 'high', kb: [3, 0], pose: 'slam', hit: { spark: 'heavy' }, cmd: { btn: 'H', dir: '6' } }),
  strike({ id: 's_jL', name: 'Air Spark', input: 'j.L', desc: 'Fast air palm.', strength: 'L', air: true, f: [5, 3, 8], box: B(8, 40, 52, 34), dmg: 24, pose: 'air_punch', hit: { spark: 'electric' }, cmd: { btn: 'L', dir: '*', air: true } }),
  strike({ id: 's_jM', name: 'Staff Wheel', input: 'j.M', desc: 'Spinning staff that covers both sides.', strength: 'M', air: true, f: [7, 6, 12], box: B(-50, 20, 116, 60), dmg: 40, pose: 'spin', disjoint: true, cmd: { btn: 'M', dir: '*', air: true } }),
  strike({ id: 's_jH', name: 'Flare Burst', input: 'j.H', desc: 'Fire bursts beneath her, spiking opponents.', strength: 'H', air: true, f: [10, 5, 15], box: B(-20, -30, 90, 70), dmg: 58, guard: 'high', kb: [2, -8], pose: 'cast_down', hit: { spark: 'fire', groundBounce: true }, cmd: { btn: 'H', dir: '*', air: true } }),
  {
    id: 's_fire', name: 'Fire Bolt', input: '5S (hold to charge)', desc: '15 mana. Hold S to charge up to 40f: bigger, faster, more damage and durability.', kind: 'special', strength: 'S', stance: 'ground', total: 34,
    charge: { holdFrame: 8, maxFrames: 40, button: 'S' }, cost: { resource: { mana: 15 } }, spawns: [{ frame: 12, projectile: 's_fire', offset: { x: 46, y: 70 } }], pose: 'cast', sfx: 'fire', cmd: { btn: 'S', dir: '5' },
    cancels: { window: [14, 33], always: ['super'] }, fx: [{ frame: 1, cue: 'charge' }],
  },
  {
    id: 's_spike', name: 'Frost Spike', input: '6S', desc: '20 mana. Marks the ground ahead; an ice spike erupts 22 frames later and launches.', kind: 'special', strength: 'S', stance: 'ground', total: 36,
    cost: { resource: { mana: 20 } }, spawns: [{ frame: 14, projectile: 's_spike', offset: { x: 0, y: 0 }, groundAhead: 230 }], pose: 'cast_down', sfx: 'ice', cmd: { btn: 'S', dir: '6' },
    cancels: { window: [16, 35], always: ['special', 'super'] },
  },
  {
    id: 's_bolt', name: 'Chain Lightning', input: '4S', desc: '25 mana. Multi-hit lightning beam in front of her.', kind: 'special', strength: 'S', stance: 'ground', total: 42,
    cost: { resource: { mana: 25 } }, spawns: [{ frame: 10, projectile: 's_bolt', offset: { x: 0, y: 0 } }], pose: 'channel', sfx: 'zap', cmd: { btn: 'S', dir: '4' },
  },
  {
    id: 's_orb', name: 'Arcane Orb', input: '2S', desc: '25 mana. Summons a slow orb that drifts forward. Destroyed if Solenne is hit.', kind: 'special', strength: 'S', stance: 'ground', total: 28,
    cost: { resource: { mana: 25 } }, requires: { noObject: 's_orb' }, spawns: [{ frame: 12, projectile: 's_orb', offset: { x: 50, y: 90 } }], pose: 'summon', cmd: { btn: 'S', dir: 'd' },
    cancels: { window: [16, 27], always: ['any'] },
  },
  {
    id: 's_detonate', name: 'Detonate', input: '2S (orb out)', desc: 'Detonates the orb into a multi-hit blast wherever it is.', kind: 'special', strength: 'S', stance: 'ground', total: 16,
    requires: { object: 's_orb' }, pose: 'channel', cmd: { btn: 'S', dir: 'd', priority: 1 }, cancels: { window: [8, 15], always: ['any'] },
    onFrame: ({ sim, f, frame }) => {
      if (frame !== 6) return;
      const o = sim.state.projectiles.find((p) => p.owner === f.idx && p.defId === 's_orb' && !p.dead);
      if (o) sim.killProjectile(o);
    },
  },
  {
    id: 's_detonate_air', name: 'Air Detonate', input: 'j.2S (orb out)', desc: 'Detonates the orb from the air.', kind: 'special', strength: 'S', stance: 'air', total: 18, gravity: 0.4,
    requires: { object: 's_orb' }, pose: 'channel', cmd: { btn: 'S', dir: 'd', air: true, priority: 1 }, landing: { mode: 'end', lag: 4 },
    onFrame: ({ sim, f, frame }) => {
      if (frame !== 6) return;
      const o = sim.state.projectiles.find((p) => p.owner === f.idx && p.defId === 's_orb' && !p.dead);
      if (o) sim.killProjectile(o);
    },
  },
  {
    id: 's_wind', name: 'Wind Step', input: '8S', desc: '10 mana. Levitating hop, projectile-invulnerable 1-14. Repositions over fireballs.', kind: 'special', strength: 'S', stance: 'ground', total: 24,
    cost: { resource: { mana: 10 } }, vel: [{ frame: 3, y: 10, x: 4, mode: 'set' }], gravity: 0.5, invuln: [{ frames: [1, 14], types: ['projectile'] }], landing: { mode: 'continue' }, pose: 'cast_up', cmd: { btn: 'S', dir: 'u' },
    cancels: { window: [10, 23], always: ['any'] }, fx: [{ frame: 3, cue: 'wind' }],
  },
  {
    id: 's_channel', name: 'Mana Channel', input: '1S (hold)', desc: 'Kneels and channels while S is held, regenerating mana quickly. Completely open to attack.', kind: 'special', strength: 'S', stance: 'ground', total: 18,
    charge: { holdFrame: 6, maxFrames: 180, button: 'S' }, pose: 'channel', cmd: { btn: 'S', dir: '1', priority: 1 }, feintable: true, fx: [{ frame: 1, cue: 'charge' }],
  },
  {
    id: 's_airfire', name: 'Falling Ember', input: 'j.S', desc: '15 mana. Fire bolt angled downward.', kind: 'special', strength: 'S', stance: 'air', total: 30, gravity: 0.3,
    cost: { resource: { mana: 15 } }, spawns: [{ frame: 11, projectile: 's_fire', offset: { x: 30, y: 50 }, vel: { x: 7, y: -6 } }], pose: 'cast_down', cmd: { btn: 'S', dir: '*', air: true }, landing: { mode: 'end', lag: 6 },
    vel: [{ frame: 1, y: 1, mode: 'set' }],
  },
  {
    id: 's_super_pillar', name: 'Inferno Pillar', input: '5X', desc: '1 bar. A pillar of fire erupts under the opponent after 18 frames.', kind: 'super', strength: 'X', stance: 'ground', total: 40, superFreeze: 24, cost: { meter: 100 },
    spawns: [{ frame: 8, projectile: 's_pillar', offset: { x: 0, y: 0 }, atOpponent: true }], invuln: [{ frames: [1, 8], types: ['strike', 'projectile'] }], pose: 'cast_up', cmd: { btn: 'X', dir: '5' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 's_super_wall', name: 'Glacial Wall', input: '6X', desc: '1 bar. Raises an ice wall that launches on emergence and blocks enemy projectiles for 5 seconds.', kind: 'super', strength: 'X', stance: 'ground', total: 36, superFreeze: 20, cost: { meter: 100 },
    spawns: [{ frame: 6, projectile: 's_wall', offset: { x: 0, y: 0 }, groundAhead: 110 }], pose: 'cast', cmd: { btn: 'X', dir: '6' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 's_super_storm', name: 'Tempest', input: '4X', desc: '2 bars. Summons a homing storm cloud that strikes repeatedly for 4 seconds.', kind: 'super', strength: 'X', stance: 'ground', total: 40, superFreeze: 24, cost: { meter: 200 },
    spawns: [{ frame: 10, projectile: 's_storm', offset: { x: 120, y: 200 } }], pose: 'channel', cmd: { btn: 'X', dir: '4' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
  {
    id: 's_super_meteor', name: 'Starfall', input: '2X', desc: '3 bars. A meteor crashes toward the opponent and explodes. Huge chip if blocked.', kind: 'super', strength: 'X', stance: 'ground', total: 50, superFreeze: 30, cost: { meter: 300 },
    spawns: [{ frame: 14, projectile: 's_meteor', offset: { x: -260, y: 620 } }], invuln: [{ frames: [1, 14], types: ['strike', 'throw', 'projectile'] }], pose: 'cast_up', cmd: { btn: 'X', dir: 'd' }, fx: [{ frame: 1, cue: 'superflash' }],
  },
];

export const SOLENNE: CharacterDef = {
  id: 'solenne',
  name: 'Solenne',
  title: 'Storm Archivist',
  archetype: 'Elemental spellcaster',
  blurb: 'Fire, frost, lightning and arcane orbs, fuelled by mana. Four different meter-powered spells. Floaty and slow up close.',
  maxHp: 950,
  walkSpeed: 2.8,
  backWalkSpeed: 2.6,
  runSpeed: 6,
  dashSpeed: 8,
  dashFrames: 15,
  backdashSpeed: 9,
  backdashFrames: 18,
  jumpVel: 12.5,
  shortHopVel: 8.5,
  jumpHSpeed: 3.8,
  doubleJumpVel: 10.5,
  airDashSpeed: 8.5,
  airDashFrames: 14,
  gravity: 0.5,
  fallSpeed: 9.5,
  fastFallSpeed: 14,
  airAccel: 0.3,
  airMaxSpeed: 4,
  weight: 1.06,
  maxAirOptions: 2,
  width: 42,
  height: 122,
  crouchHeight: 78,
  resources: [{ name: 'mana', label: 'MANA', max: 100, start: 60, regen: 0.16, display: 'bar', color: '#4cc9f0' }],
  onUpdate: (sim, f) => {
    if (f.moveId === 's_channel' && f.moveFrame === 6 && f.hitstop === 0) f.resources.mana = Math.min(100, f.resources.mana + 0.75);
  },
  moves,
  projectiles: [
    projectile({ id: 's_fire', name: 'Fire Bolt', box: B(0, -14, 34, 28), speed: { x: 8.5, y: 0 }, lifetime: 120, style: 'fire', color: '#ff7b00', chargeScaling: true, power: 1, durability: 1, hit: { damage: 48, guard: 'mid', hitstun: 20, blockstun: 14, knockback: { x: 5, y: 0 }, spark: 'fire' } }),
    projectile({ id: 's_spike', name: 'Frost Spike', box: B(0, 0, 54, 120), speed: { x: 0, y: 0 }, lifetime: 34, delay: 22, style: 'spike', color: '#90e0ef', power: 2, durability: 3, hit: { damage: 60, guard: 'low', hitstun: 30, blockstun: 14, knockback: { x: 1, y: 12.5 }, launch: true, spark: 'ice' } }),
    projectile({ id: 's_bolt', name: 'Chain Lightning', box: B(150, 48, 230, 28), speed: { x: 0, y: 0 }, lifetime: 30, delay: 8, hits: 5, rehit: 5, followOwner: true, style: 'beam', color: '#ffee32', power: 3, durability: 9, reflectable: false, parryable: false, hit: { damage: 14, guard: 'mid', hitstun: 16, blockstun: 10, knockback: { x: 1.5, y: 0 }, spark: 'electric', proration: 0.95 } }),
    projectile({ id: 's_orb', name: 'Arcane Orb', box: B(0, -18, 36, 36), speed: { x: 1.4, y: 0 }, lifetime: 420, style: 'orb', color: '#b5179e', power: 2, durability: 2, ownerHitDestroys: true, maxCount: 1, onEnd: 's_orb_blast', hit: { damage: 40, guard: 'mid', hitstun: 22, blockstun: 12, knockback: { x: 3, y: 4 }, launch: true, spark: 'electric' } }),
    projectile({ id: 's_orb_blast', name: 'Orb Blast', box: B(0, -60, 130, 130), speed: { x: 0, y: 0 }, lifetime: 24, hits: 3, rehit: 6, style: 'blast', color: '#f72585', power: 5, durability: 99, reflectable: false, hit: { damage: 26, guard: 'mid', hitstun: 22, blockstun: 12, knockback: { x: 2, y: 6 }, launch: true, spark: 'super', proration: 0.9 } }),
    projectile({ id: 's_pillar', name: 'Inferno Pillar', box: B(0, 0, 90, 260), speed: { x: 0, y: 0 }, lifetime: 50, delay: 18, hits: 6, rehit: 5, style: 'pillar', color: '#ff4800', power: 9, durability: 99, reflectable: false, parryable: false, hit: { damage: 32, guard: 'mid', hitstun: 26, blockstun: 12, knockback: { x: 0.3, y: 7 }, launch: true, unburstable: true, ignoreDecay: true, spark: 'fire', proration: 0.97, chip: 8 } }),
    projectile({ id: 's_wall', name: 'Glacial Wall', box: B(0, 0, 44, 170), speed: { x: 0, y: 0 }, lifetime: 300, hits: 1, wall: true, style: 'wall', color: '#caf0f8', power: 99, durability: 999, reflectable: false, parryable: false, hit: { damage: 70, guard: 'mid', hitstun: 30, blockstun: 16, knockback: { x: 3, y: 12 }, launch: true, unburstable: true, spark: 'ice' },
      update: (_sim, p) => {
        if (p.age === 12) p.hitsLeft = 0; // only hits as it emerges
      },
    }),
    projectile({ id: 's_storm', name: 'Tempest', box: B(0, -90, 150, 180), speed: { x: 1.5, y: 0 }, lifetime: 240, hits: 12, rehit: 18, homing: 0.06, style: 'storm', color: '#7209b7', power: 4, durability: 99, reflectable: false, parryable: false, hit: { damage: 18, guard: 'mid', hitstun: 18, blockstun: 10, knockback: { x: 0.5, y: 3 }, spark: 'electric', proration: 0.97, chip: 4 } }),
    projectile({ id: 's_meteor', name: 'Starfall', box: B(0, -50, 100, 100), speed: { x: 9, y: -10 }, lifetime: 120, hits: 1, groundDestroy: true, homing: 0.25, onEnd: 's_meteor_blast', style: 'meteor', color: '#ff9e00', power: 20, durability: 99, reflectable: false, parryable: false, hit: { damage: 200, guard: 'mid', hitstun: 40, blockstun: 22, knockback: { x: 6, y: 10 }, launch: true, unburstable: true, ignoreDecay: true, spark: 'super', chip: 40, hitstop: 16 } }),
    projectile({ id: 's_meteor_blast', name: 'Starfall Blast', box: B(0, -20, 260, 160), speed: { x: 0, y: 0 }, lifetime: 22, hits: 1, style: 'blast', color: '#ff6d00', power: 20, durability: 99, reflectable: false, parryable: false, hit: { damage: 110, guard: 'mid', hitstun: 34, blockstun: 18, knockback: { x: 7, y: 11 }, launch: true, unburstable: true, ignoreDecay: true, spark: 'super', chip: 22 } }),
  ],
  palette: { primary: '#14213d', secondary: '#4cc9f0', accent: '#f72585', aura: '#4cc9f0', skin: '#c68b59' },
};

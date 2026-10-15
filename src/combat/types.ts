// Data definitions for the combat engine. Everything a fighter can do is described by a
// MoveDef; the engine interprets these generically. Character modules may attach small
// hook functions for genuinely unique mechanics, but hit resolution, damage, scaling,
// buffering and collision are always handled by the shared engine.

import type { ButtonName, InputBufferState } from '../core/input';
import type { Box, Vec2 } from '../core/math';
import type { Sim } from './sim';

/** Box in fighter-local space: x is distance in front of the fighter's origin (facing-relative),
 *  y is height above the fighter's feet. */
export interface LocalBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GuardType = 'mid' | 'high' | 'low' | 'unblockable';
export type InvulnType = 'strike' | 'throw' | 'projectile';
export type Strength = 'L' | 'M' | 'H' | 'S' | 'X';

export interface HitDef {
  /** Inclusive move-frame range (1-based) during which this hit is active. */
  frames: [number, number];
  boxes: LocalBox[];
  damage: number;
  /** Damage dealt through block. */
  chip?: number;
  guard: GuardType;
  hitstun: number;
  blockstun: number;
  /** Freeze frames for both fighters on contact (capped by the engine). */
  hitstop?: number;
  /** x is away from the attacker, y is upward. */
  knockback: Vec2;
  /** Pushback applied on block (away from attacker). */
  blockPush?: number;
  /** Forces an airborne launch even on grounded opponents. */
  launch?: boolean;
  groundBounce?: boolean;
  wallBounce?: boolean;
  /** Hard knockdowns cannot be teched on landing. */
  hardKnockdown?: boolean;
  /** Can hit an opponent lying on the ground (once per combo). */
  otg?: boolean;
  /** Multiplier applied to the combo's damage scale after this hit (default 0.9). */
  proration?: number;
  /** Minimum fraction of damage regardless of scaling (default 0.15). */
  minDamage?: number;
  /** Strength of directional influence the victim may apply to this hit's knockback (default 1). */
  di?: number;
  /** Clash priority; higher wins. Defaults are derived from strength. */
  priority?: number;
  /** Can this hitbox clash with other active hitboxes (default true for strikes). */
  clash?: boolean;
  meterGain?: number;
  /** For repeated hits inside one window: frames between rehits. */
  rehit?: number;
  /** Cannot be air-blocked. */
  airUnblockable?: boolean;
  /** Pull the victim to this local offset from the attacker on hit (vacuum / hook). */
  pullTo?: Vec2;
  /** The move transitions to this move id when this hit connects (not on block). */
  onHitGoto?: string;
  /** Destroys projectiles that overlap this hitbox. */
  destroysProjectiles?: boolean;
  /** Super hits cannot be bursted. */
  unburstable?: boolean;
  /** Hit spark style hint for the effects system. */
  spark?: 'light' | 'medium' | 'heavy' | 'slash' | 'blunt' | 'electric' | 'fire' | 'ice' | 'super';
  /** Automatically connects with the grabbed opponent (throw follow-up hits). */
  grabHit?: boolean;
  /** Releases the grabbed opponent when it connects. */
  release?: boolean;
  /** Overrides combo hitstun decay (used by supers to guarantee their own hits). */
  ignoreDecay?: boolean;
  /** Crumple: grounded stagger that ends in a knockdown. */
  crumple?: boolean;
}

export interface ThrowDef {
  frames: [number, number];
  box: LocalBox;
  /** 'ground' throws only grab grounded targets, 'air' only airborne ones. */
  target: 'ground' | 'air' | 'any';
  /** Move id the attacker transitions to on a successful grab. */
  success: string;
  techable: boolean;
  /** Where the victim is held, relative to the grabber. */
  hold: Vec2;
  /** Back throws swap sides when performed. */
  swapSides?: boolean;
}

export interface VelEvent {
  frame: number;
  /** Optional last frame for continuous application. */
  until?: number;
  x?: number; // facing-relative
  y?: number;
  mode?: 'set' | 'add';
}

export interface InvulnWindow {
  frames: [number, number];
  types: InvulnType[];
}

export interface SpawnEvent {
  frame: number;
  projectile: string;
  offset: Vec2;
  /** Optional override of the projectile's initial velocity (facing-relative). */
  vel?: Vec2;
  /** Spawn relative to the opponent instead of self. */
  atOpponent?: boolean;
  /** Spawn at a fixed forward distance on the ground. */
  groundAhead?: number;
}

export type CancelTag =
  | 'chain' // normal chain into stronger normals / command normals
  | 'special'
  | 'super'
  | 'jump'
  | 'dash'
  | 'stance'
  | 'any'
  | `#${string}`; // explicit move id

export interface CancelDef {
  /** Frames during which cancels are allowed (defaults to first active frame until end of move - 2). */
  window?: [number, number];
  onHit?: CancelTag[];
  onBlock?: CancelTag[];
  /** Whiff cancels cost a free-cancel (feint) charge. */
  onWhiff?: CancelTag[];
  /** Allowed regardless of contact (e.g. movement-cancel specials). */
  always?: CancelTag[];
}

export interface CostDef {
  meter?: number;
  /** Character resource costs. */
  resource?: Record<string, number>;
  airOption?: number;
  feint?: number;
}

export interface RequireDef {
  resource?: Record<string, number>;
  stance?: string | null;
  install?: boolean;
  noInstall?: boolean;
  /** Requires the character to own an object of this projectile type. */
  object?: string;
  noObject?: string;
  /** Minimum distance from the ground (air moves). */
  minHeight?: number;
}

export interface ChargeDef {
  /** Frame at which the move pauses while the button is held. */
  holdFrame: number;
  maxFrames: number;
  button: ButtonName;
}

export interface ParryDef {
  frames: [number, number];
  /** Frames of recovery the parrying fighter is left with after success. */
  successRecovery: number;
  projectiles: boolean;
}

export interface CounterDef {
  frames: [number, number];
  followup: string;
}

export interface ReflectDef {
  frames: [number, number];
  box: LocalBox;
}

export type PoseKey = string;

export interface MoveDef {
  id: string;
  name: string;
  /** Human readable input description for the move list. */
  input: string;
  desc: string;
  kind: 'normal' | 'command' | 'special' | 'super' | 'throw' | 'movement' | 'defense' | 'system';
  strength?: Strength;
  /** Where the move can be started. */
  stance: 'ground' | 'air';
  total: number;
  hits?: HitDef[];
  throw?: ThrowDef;
  vel?: VelEvent[];
  /** Gravity multiplier while performing the move (air moves). */
  gravity?: number;
  /** Ground friction multiplier while performing the move. */
  friction?: number;
  invuln?: InvulnWindow[];
  armor?: { frames: [number, number]; hits: number; damageMult?: number };
  parry?: ParryDef;
  counter?: CounterDef;
  reflect?: ReflectDef;
  spawns?: SpawnEvent[];
  cancels?: CancelDef;
  /** 'end' = move ends on landing, with landing lag frames; 'continue' = carries on. */
  landing?: { mode: 'end' | 'continue' | 'goto'; lag?: number; goto?: string };
  /** For ground moves that become airborne: becomes airborne at this frame. */
  cost?: CostDef;
  requires?: RequireDef;
  charge?: ChargeDef;
  /** Super freeze frames applied at move start. */
  superFreeze?: number;
  /** Starts a temporary enhancement. */
  install?: { frames: number; drainPerFrame: number };
  /** Move id used instead of this one while an install is active. */
  enhanced?: string;
  /** Stance entered when the move ends (null to clear). */
  setStance?: string | null;
  stanceFrames?: number;
  /** Fighter passes through the opponent's pushbox during these frames. */
  noPush?: [number, number];
  /** Throw-invulnerable recovery etc. are covered by invuln; this marks moves that can be
   *  canceled into from neutral idle "feint" (cancel to neutral with a feint charge). */
  feintable?: boolean;
  /** Turn around at this frame to face the opponent (cross-up moves). */
  autoFaceAt?: number;
  /** Hurtbox overrides (replaces the default body hurtbox) during frame ranges. */
  hurt?: { frames: [number, number]; boxes: LocalBox[] }[];
  /** Hitboxes are disjointed (weapons): no automatic hurtbox extension. */
  disjoint?: boolean;
  /** After the move ends in the air, the fighter cannot act until landing. */
  helpless?: boolean;
  /** Per-frame custom behaviour for unique mechanics. */
  onFrame?: (ctx: MoveCtx) => void;
  /** Pose archetype used by the renderer. */
  pose: PoseKey;
  /** Visual effect cues for the effects system: frame -> cue name. */
  fx?: { frame: number; cue: string }[];
  /** Sound cue on startup. */
  sfx?: string;
  /** Command used for input mapping. */
  cmd?: { btn: ButtonName; dir: string; air?: boolean; stance?: string; priority?: number; hold?: boolean };
  /** Hidden from the move list (internal follow-ups). */
  hidden?: boolean;
  /** Move counts as aerial pursuit (for effects). */
  tags?: string[];
}

export interface MoveCtx {
  sim: Sim;
  f: FighterState;
  opp: FighterState;
  frame: number;
  move: MoveDef;
}

export interface ProjectileDef {
  id: string;
  name: string;
  box: LocalBox;
  speed: Vec2; // facing relative
  gravity?: number;
  lifetime: number;
  /** Hits absorbed from other projectiles before vanishing. */
  durability: number;
  /** Strength when clashing with other projectiles. */
  power: number;
  hit: Omit<HitDef, 'frames' | 'boxes'>;
  /** Number of times it can hit fighters before disappearing. */
  hits: number;
  /** Frames between hits on the same target for persistent hazards. */
  rehit?: number;
  /** Frames after spawn before it becomes active. */
  delay?: number;
  parryable?: boolean;
  reflectable?: boolean;
  /** Melee strikes can destroy it. */
  strikeDestroyable?: boolean;
  /** Doesn't hit anything; a marker object (e.g. teleport anchor). */
  inert?: boolean;
  /** Destroyed when its owner gets hit (summons that need protecting). */
  ownerHitDestroys?: boolean;
  /** Blocks opposing projectiles like a wall. */
  wall?: boolean;
  homing?: number;
  /** Max simultaneous instances per owner. */
  maxCount?: number;
  /** Destroyed on contact with the ground. */
  groundDestroy?: boolean;
  /** Follows the owner's position (e.g. attached auras/beams). */
  followOwner?: boolean;
  /** Custom per-frame behaviour. */
  update?: (sim: Sim, p: ProjectileState) => void;
  /** Projectile spawned when this one expires or is destroyed. */
  onEnd?: string;
  /** Visual style key. */
  style: string;
  color: string;
  chargeScaling?: boolean;
}

export interface ResourceDef {
  name: string;
  label: string;
  max: number;
  start: number;
  regen?: number;
  /** Regen only while grounded. */
  groundRegen?: number;
  display: 'bar' | 'pips';
  color: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  archetype: string;
  blurb: string;
  maxHp: number;
  walkSpeed: number;
  backWalkSpeed: number;
  runSpeed: number;
  dashSpeed: number;
  dashFrames: number;
  backdashSpeed: number;
  backdashFrames: number;
  jumpVel: number;
  shortHopVel: number;
  jumpHSpeed: number;
  doubleJumpVel: number;
  airDashSpeed: number;
  airDashFrames: number;
  gravity: number;
  fallSpeed: number;
  fastFallSpeed: number;
  airAccel: number;
  airMaxSpeed: number;
  weight: number; // knockback multiplier (lower = heavier)
  maxAirOptions: number;
  /** Air options regained when landing a hit while airborne (trickster). */
  airOptionsOnHit?: number;
  width: number;
  height: number;
  crouchHeight: number;
  resources: ResourceDef[];
  /** Flight resource name if the character can fly. */
  flight?: { resource: string; drain: number; accel: number; maxSpeed: number; brake: number; minFuel: number };
  /** Can jump off walls. */
  wallJump?: boolean;
  moves: MoveDef[];
  projectiles: ProjectileDef[];
  palette: { primary: string; secondary: string; accent: string; aura: string; skin: string };
  /** Character-specific per-frame logic (resource decay, etc). */
  onUpdate?: (sim: Sim, f: FighterState) => void;
  /** Called when one of this character's hits connects. */
  onHitLanded?: (sim: Sim, f: FighterState, victim: FighterState, blocked: boolean) => void;
  /** Damage multiplier hook (install bonuses etc). */
  damageMult?: (f: FighterState) => number;
  /** Extra global movement multiplier hook. */
  speedMult?: (f: FighterState) => number;
}

export type FighterStateName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'crouch'
  | 'jumpsquat'
  | 'air'
  | 'landing'
  | 'dash'
  | 'backdash'
  | 'airdash'
  | 'move'
  | 'blockstun'
  | 'hitstun'
  | 'launched'
  | 'knockdown'
  | 'getup'
  | 'techroll'
  | 'thrown'
  | 'throwtech'
  | 'crumple'
  | 'ko'
  | 'win';

export interface ComboState {
  hits: number;
  damage: number;
  scale: number;
  frames: number;
  wallBounces: number;
  groundBounces: number;
  otgUsed: boolean;
  moveCounts: Record<string, number>;
  route: string[];
  projectileHits: number;
  cancels: number;
  bursted: boolean;
  /** Starting scale modifier (burst punish etc). */
  startScale: number;
  lastHitDamage: number;
}

export interface PendingKnockback {
  vx: number;
  vy: number;
  di: number;
  launched: boolean;
  /** Recorded once applied, for the training display. */
}

export interface DIRecord {
  frame: number;
  input: Vec2;
  before: Vec2;
  after: Vec2;
  strength: number;
}

export interface FighterState {
  idx: 0 | 1;
  charId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: FighterStateName;
  stateFrame: number;
  grounded: boolean;
  crouching: boolean;
  hp: number;
  maxHp: number;
  meter: number;
  burst: number;
  airOptions: number;
  feints: number;
  feintRegen: number;
  resources: Record<string, number>;
  install: { frames: number; drain: number } | null;
  stance: string | null;
  stanceFrames: number;
  // move execution
  moveId: string | null;
  moveFrame: number;
  /** Per hit index: number of times it has connected (hit or block) during this move. */
  moveHits: number[];
  /** Frame of last connection for each hit index (for rehit spacing). */
  moveHitFrame: number[];
  moveResult: 'none' | 'hit' | 'block' | 'whiff' | 'parried';
  moveCharge: number;
  moveArmorHits: number;
  canceledFrom: string | null;
  // stun & timers
  hitstun: number;
  blockstun: number;
  hitstop: number;
  landingLag: number;
  knockdownFrames: number;
  wakeInvuln: number;
  airRecoverInvuln: number;
  pendingKB: PendingKnockback | null;
  hardKnockdown: boolean;
  pendingGroundBounce: boolean;
  pendingWallBounce: boolean;
  /** DI strength of the hit that put us in hitstun (for bounces). */
  lastHitDI: number;
  counterHit: boolean;
  // throws
  grabbedBy: 0 | 1 | -1;
  grabHold: Vec2;
  grabTechable: boolean;
  throwTechWindow: number;
  // combo against this fighter
  combo: ComboState;
  // flags
  flying: boolean;
  fastFalling: boolean;
  helpless: boolean;
  driftAccum: number;
  unburstable: boolean;
  /** Frames since last returning to neutral (used to restore hp in training). */
  neutralFrames: number;
  jumpHeld: boolean;
  burstPunishable: number;
  lastDI: DIRecord | null;
  input: InputBufferState;
  /** Frame advantage measurement for the training display. */
  advantage: number | null;
  wallTouch: number; // -1 left wall, 1 right wall, 0 none
  /** Training: infinite hp/meter */
  lastDamageTaken: number;
  stats: { hitsLanded: number; damageDealt: number; supers: number; bursts: number; parries: number; techs: number };
}

export interface ProjectileState {
  id: number;
  defId: string;
  owner: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  age: number;
  durability: number;
  hitsLeft: number;
  lastHitFrame: number;
  hitstop: number;
  charge: number; // 0..1 charge scale
  dead: boolean;
  /** Generic data slot for custom behaviour. */
  data: Record<string, number>;
}

export type CombatEvent =
  | { type: 'hit'; frame: number; attacker: number; victim: number; moveId: string; damage: number; x: number; y: number; counter: boolean; launch: boolean; strength: string; spark?: string; projectile: boolean; comboHits: number; scale: number; super: boolean }
  | { type: 'block'; frame: number; attacker: number; victim: number; moveId: string; chip: number; x: number; y: number; projectile: boolean }
  | { type: 'parry'; frame: number; defender: number; attacker: number; x: number; y: number; projectile: boolean }
  | { type: 'armor'; frame: number; defender: number; x: number; y: number }
  | { type: 'clash'; frame: number; x: number; y: number; winner: number }
  | { type: 'projClash'; frame: number; x: number; y: number }
  | { type: 'projDestroyed'; frame: number; x: number; y: number; id: number }
  | { type: 'reflect'; frame: number; x: number; y: number; by: number }
  | { type: 'throw'; frame: number; attacker: number; victim: number; moveId: string }
  | { type: 'throwTech'; frame: number; x: number; y: number }
  | { type: 'whiffThrow'; frame: number; fighter: number }
  | { type: 'burst'; frame: number; fighter: number; x: number; y: number }
  | { type: 'counterStance'; frame: number; fighter: number }
  | { type: 'wallBounce'; frame: number; fighter: number; x: number; y: number }
  | { type: 'groundBounce'; frame: number; fighter: number; x: number; y: number }
  | { type: 'land'; frame: number; fighter: number; x: number; hard: boolean }
  | { type: 'knockdown'; frame: number; fighter: number; x: number }
  | { type: 'tech'; frame: number; fighter: number; kind: 'ground' | 'air' }
  | { type: 'jump'; frame: number; fighter: number; air: boolean; x: number; y: number }
  | { type: 'dash'; frame: number; fighter: number; kind: string; x: number; y: number; dir: number }
  | { type: 'moveStart'; frame: number; fighter: number; moveId: string; kind: string; canceled: boolean; feint: boolean }
  | { type: 'super'; frame: number; fighter: number; moveId: string }
  | { type: 'install'; frame: number; fighter: number; on: boolean }
  | { type: 'spawn'; frame: number; owner: number; projectile: string; x: number; y: number }
  | { type: 'fx'; frame: number; fighter: number; cue: string; x: number; y: number }
  | { type: 'ko'; frame: number; fighter: number }
  | { type: 'round'; frame: number; phase: string; winner: number }
  | { type: 'pushblock'; frame: number; fighter: number }
  | { type: 'feint'; frame: number; fighter: number }
  | { type: 'teleport'; frame: number; fighter: number; fromX: number; fromY: number; x: number; y: number }
  | { type: 'flight'; frame: number; fighter: number; on: boolean };

export interface WorldBox extends Box {
  owner: number;
}

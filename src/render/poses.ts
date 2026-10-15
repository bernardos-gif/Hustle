// Procedural skeleton poses. Each move references a pose archetype; the renderer blends from
// neutral -> wind-up during startup, holds the strike pose during active frames and blends back
// during recovery, so animation timing always matches the real frame data.

import { lerp } from '../core/math';
import type { Sim } from '../combat/sim';
import type { FighterState } from '../combat/types';
import { frameData } from '../combat/registry';

/** Angles in degrees. Limb angle 0 = pointing straight down, +90 = pointing forward, 180 = up. */
export interface Pose {
  lean: number; // torso tilt, + forward
  hipY: number; // 0 standing .. 1 deep crouch (fraction of leg length lowered)
  hipX: number; // forward hip shift (fraction of height)
  aF: [number, number]; // front arm: shoulder, elbow bend (added)
  aB: [number, number];
  lF: [number, number]; // front leg: hip, knee bend (added, negative folds shin back)
  lB: [number, number];
  head: number;
  rot: number; // whole-body rotation around the hips
  lift: number; // extra vertical offset (fraction of height)
  squash: number; // <1 squashes (wider, shorter), >1 stretches
}

export const P = (lean: number, hipY: number, aF: [number, number], aB: [number, number], lF: [number, number], lB: [number, number], extra: Partial<Pose> = {}): Pose => ({
  lean,
  hipY,
  hipX: 0,
  aF,
  aB,
  lF,
  lB,
  head: 0,
  rot: 0,
  lift: 0,
  squash: 1,
  ...extra,
});

export const NEUTRAL = P(6, 0.06, [40, 70], [25, 80], [14, -18], [-14, -10]);
const CROUCH = P(18, 0.42, [55, 60], [35, 70], [60, -110], [-10, -100]);

/** Character fighting stances: the base every idle loop and attack blends from and back to. */
const STANCES: Record<string, Pose> = {
  vesper: P(0, 0.12, [72, 18], [-70, 85], [32, -28], [-30, -6]), // fencer en garde, blade forward
  mirage: P(18, 0.22, [62, 62], [-40, 75], [38, -64], [-26, -42]), // low, coiled
  solenne: P(2, 0.04, [52, 80], [28, 45], [10, -8], [-10, -6]), // upright caster, staff held
  bastion: P(10, 0.14, [52, 72], [36, 82], [28, -26], [-26, -12]), // planted heavyweight
  riot: P(12, 0.12, [52, 112], [38, 125], [24, -26], [-22, -14]), // boxer's guard
};

const CROUCHES: Record<string, Pose> = {
  vesper: P(16, 0.44, [72, 20], [-50, 80], [64, -112], [-14, -100]),
  riot: P(20, 0.44, [56, 110], [40, 120], [62, -110], [-10, -100]),
};

const WINS: Record<string, Pose> = {
  vesper: P(-4, 0.04, [172, 4], [-60, 90], [12, -8], [-14, -4]),
  mirage: P(10, 0.1, [70, 130], [60, 130], [20, -16], [-18, -10]),
  solenne: P(-6, 0.02, [120, 40], [172, 4], [8, -6], [-8, -4], { lift: 0.04 }),
  bastion: P(-4, 0.08, [100, 115], [96, 118], [24, -14], [-24, -10]),
  riot: P(-6, 0.04, [176, 4], [44, 122], [16, -10], [-16, -8]),
};

export function stanceFor(charId: string): Pose {
  return STANCES[charId] ?? NEUTRAL;
}

interface PoseSet {
  wind: Pose;
  hit: Pose;
}

const LIB: Record<string, PoseSet> = {
  jab: { wind: P(4, 0.08, [30, 100], [30, 90], [16, -16], [-16, -10]), hit: P(12, 0.08, [92, 0], [20, 100], [22, -14], [-20, -6]) },
  straight: { wind: P(0, 0.1, [20, 120], [40, 80], [14, -18], [-16, -10]), hit: P(20, 0.1, [95, 0], [10, 110], [28, -10], [-26, -4]) },
  hook: { wind: P(-6, 0.12, [60, 110], [30, 80], [16, -20], [-16, -12]), hit: P(22, 0.12, [100, 30], [10, 100], [24, -16], [-24, -6], { rot: 4 }) },
  heavy_punch: { wind: P(-14, 0.16, [10, 130], [50, 60], [12, -24], [-24, -16]), hit: P(26, 0.16, [96, 0], [-10, 80], [34, -8], [-34, 0]) },
  uppercut: { wind: P(14, 0.35, [30, 120], [40, 70], [40, -70], [-16, -40]), hit: P(-8, 0, [165, 10], [30, 90], [10, -5], [-20, -10], { lift: 0.05 }) },
  lowjab: { wind: P(22, 0.42, [60, 80], [40, 70], [60, -110], [-10, -100]), hit: P(30, 0.42, [80, 0], [30, 90], [62, -108], [-14, -96]) },
  sweep: { wind: P(30, 0.45, [70, 40], [30, 50], [40, -90], [-20, -100]), hit: P(36, 0.5, [80, 20], [-20, 40], [88, -4], [-30, -110]) },
  lowkick: { wind: P(10, 0.3, [40, 70], [30, 80], [30, -60], [-10, -60]), hit: P(14, 0.3, [50, 60], [30, 80], [80, 0], [-20, -70]) },
  kick_mid: { wind: P(-6, 0.08, [50, 70], [30, 80], [60, -100], [-10, -6]), hit: P(-18, 0.06, [60, 60], [20, 70], [92, -2], [-6, -2]) },
  kick_high: { wind: P(-10, 0.08, [60, 60], [30, 80], [80, -100], [-6, -6]), hit: P(-30, 0.04, [70, 60], [40, 60], [140, -4], [-4, -2]) },
  roundhouse: { wind: P(-4, 0.08, [70, 50], [40, 60], [50, -90], [-6, -6], { rot: -10 }), hit: P(-26, 0.04, [80, 40], [10, 60], [110, -2], [-6, -2], { rot: 8 }) },
  knee: { wind: P(10, 0.1, [60, 80], [40, 70], [40, -60], [-14, -10]), hit: P(-4, 0, [110, 60], [80, 70], [120, -150], [-10, -10], { lift: 0.06 }) },
  elbow: { wind: P(-6, 0.12, [40, 130], [30, 80], [16, -20], [-16, -12]), hit: P(24, 0.12, [80, 130], [20, 100], [30, -16], [-26, -4]) },
  palm: { wind: P(-4, 0.14, [40, 110], [50, 100], [18, -24], [-18, -14]), hit: P(18, 0.14, [88, 0], [80, 10], [30, -16], [-28, -6]) },
  shoulder: { wind: P(10, 0.18, [30, 90], [20, 80], [30, -40], [-20, -20]), hit: P(36, 0.16, [10, 120], [-10, 100], [40, -50], [-40, -10]) },
  overhead: { wind: P(-14, 0.06, [170, 20], [150, 30], [20, -30], [-20, -20], { lift: 0.04 }), hit: P(34, 0.18, [60, 0], [70, 0], [30, -40], [-30, -20]) },
  slam: { wind: P(-16, 0.06, [175, 10], [175, 10], [16, -20], [-16, -10]), hit: P(38, 0.3, [40, 0], [40, 0], [40, -70], [-30, -40]) },
  stomp: { wind: P(0, 0.05, [70, 50], [70, 50], [70, -120], [-6, -6], { lift: 0.04 }), hit: P(20, 0.36, [40, 30], [40, 30], [30, -50], [-30, -50]) },
  thrust: { wind: P(-4, 0.14, [40, 130], [60, 60], [20, -30], [-20, -14]), hit: P(22, 0.2, [92, 0], [140, 30], [50, -40], [-40, -4]) },
  air_thrust: { wind: P(0, 0.2, [40, 130], [60, 60], [50, -90], [-10, -90]), hit: P(14, 0.2, [92, 0], [140, 30], [40, -80], [-20, -60]) },
  slash_wide: { wind: P(-14, 0.12, [160, 40], [40, 60], [18, -24], [-20, -10], { rot: -6 }), hit: P(24, 0.2, [70, 0], [10, 80], [40, -30], [-34, -6], { rot: 6 }) },
  slash_up: { wind: P(20, 0.36, [20, 10], [30, 60], [50, -90], [-14, -60]), hit: P(-12, 0.02, [175, 0], [40, 80], [16, -6], [-20, -10], { lift: 0.05 }) },
  draw: { wind: P(14, 0.22, [10, 120], [20, 110], [34, -50], [-30, -30]), hit: P(16, 0.24, [10, 125], [20, 110], [36, -52], [-32, -30]) },
  shoot: { wind: P(-2, 0.08, [70, 20], [30, 90], [16, -18], [-16, -10]), hit: P(-6, 0.08, [92, 0], [20, 100], [18, -16], [-18, -8]) },
  shoot_air: { wind: P(10, 0.2, [50, 20], [30, 90], [50, -90], [-10, -80]), hit: P(20, 0.2, [60, 0], [20, 100], [50, -90], [-10, -80]) },
  reload: { wind: P(10, 0.12, [40, 120], [50, 110], [16, -18], [-16, -10]), hit: P(14, 0.14, [50, 130], [60, 120], [16, -18], [-16, -10]) },
  cast: { wind: P(-8, 0.1, [130, 40], [40, 80], [16, -20], [-16, -10]), hit: P(14, 0.12, [92, 0], [80, 10], [28, -14], [-26, -6]) },
  cast_up: { wind: P(10, 0.3, [40, 40], [40, 40], [30, -60], [-20, -50]), hit: P(-10, 0.02, [170, 0], [160, 10], [10, -6], [-10, -10], { lift: 0.04 }) },
  cast_down: { wind: P(-6, 0.2, [150, 30], [130, 30], [40, -80], [-10, -70]), hit: P(30, 0.2, [40, 0], [30, 0], [40, -80], [-10, -70]) },
  channel: { wind: P(10, 0.3, [80, 70], [70, 80], [40, -70], [-20, -60]), hit: P(10, 0.34, [90, 80], [80, 90], [44, -80], [-20, -70]) },
  summon: { wind: P(0, 0.1, [60, 90], [60, 90], [16, -18], [-16, -10]), hit: P(-6, 0.06, [150, 20], [120, 20], [16, -16], [-16, -8]) },
  piston: { wind: P(-12, 0.16, [20, 130], [40, 60], [16, -26], [-24, -16]), hit: P(14, 0.16, [92, 0], [-10, 90], [30, -12], [-30, -2]) },
  grab_heavy: { wind: P(10, 0.18, [70, 40], [60, 40], [20, -30], [-20, -14]), hit: P(30, 0.2, [95, 10], [90, 10], [36, -30], [-30, -6]) },
  rocket_up: { wind: P(20, 0.4, [20, 120], [30, 60], [50, -90], [-20, -70]), hit: P(-10, 0, [178, 0], [10, 60], [6, -10], [-10, -30], { lift: 0.04 }) },
  air_punch: { wind: P(6, 0.24, [30, 110], [20, 90], [50, -100], [-6, -90]), hit: P(14, 0.24, [92, 0], [10, 110], [46, -90], [-10, -80]) },
  air_kick: { wind: P(-6, 0.24, [70, 50], [40, 60], [60, -130], [-10, -80]), hit: P(-24, 0.24, [80, 40], [40, 60], [100, -4], [-10, -80]) },
  air_knee: { wind: P(4, 0.24, [70, 60], [40, 60], [50, -100], [-10, -80]), hit: P(-6, 0.24, [80, 80], [50, 60], [110, -150], [-20, -40]) },
  air_slash: { wind: P(-20, 0.24, [170, 20], [40, 50], [50, -90], [-10, -80]), hit: P(30, 0.24, [40, 0], [10, 60], [50, -90], [-10, -80], { rot: 10 }) },
  air_hammer: { wind: P(-20, 0.24, [175, 10], [170, 10], [60, -120], [-10, -90]), hit: P(30, 0.24, [40, 0], [40, 0], [40, -90], [-20, -80]) },
  divekick: { wind: P(10, 0.24, [70, 60], [40, 60], [60, -130], [-10, -80]), hit: P(30, 0.1, [120, 40], [80, 60], [40, -4], [-40, -100], { rot: 30 }) },
  spin: { wind: P(0, 0.24, [100, 20], [100, 20], [70, -40], [-50, -40], { rot: -30 }), hit: P(0, 0.24, [100, 10], [100, 10], [90, -10], [-80, -10], { rot: 160 }) },
  slide: { wind: P(30, 0.4, [40, 50], [20, 60], [50, -80], [-20, -100]), hit: P(-50, 0.7, [140, 30], [160, 20], [86, -2], [40, -90]) },
  dash: { wind: P(30, 0.2, [-20, 60], [-40, 50], [50, -60], [-40, -40]), hit: P(36, 0.2, [-30, 50], [-50, 40], [60, -50], [-50, -30]) },
  dash_strike: { wind: P(30, 0.2, [-20, 60], [-40, 50], [50, -60], [-40, -40]), hit: P(30, 0.2, [92, 0], [-40, 40], [60, -50], [-50, -30]) },
  rush: { wind: P(14, 0.14, [40, 110], [70, 10], [26, -24], [-26, -10]), hit: P(20, 0.14, [92, 0], [40, 110], [28, -16], [-26, -6]) },
  teleport: { wind: P(0, 0.2, [130, 30], [130, 30], [20, -40], [-20, -40]), hit: P(0, 0.1, [20, 10], [20, 10], [6, -6], [-6, -6]) },
  throw_reach: { wind: P(6, 0.12, [60, 50], [50, 50], [18, -20], [-18, -10]), hit: P(24, 0.14, [92, 0], [86, 0], [30, -16], [-26, -6]) },
  throw_toss: { wind: P(20, 0.16, [80, 30], [80, 30], [24, -20], [-24, -10]), hit: P(-24, 0.1, [160, 20], [150, 20], [20, -10], [-26, -6], { rot: -8 }) },
  parry: { wind: P(-6, 0.16, [110, 120], [80, 120], [18, -24], [-20, -14]), hit: P(-10, 0.16, [130, 110], [100, 120], [20, -26], [-22, -14]) },
  pushblock: { wind: P(0, 0.14, [80, 30], [70, 30], [16, -20], [-16, -10]), hit: P(14, 0.14, [96, 0], [92, 0], [26, -14], [-26, -6]) },
  roll: { wind: P(40, 0.5, [60, 60], [60, 60], [80, -140], [40, -130]), hit: P(40, 0.5, [60, 60], [60, 60], [80, -140], [40, -130], { rot: 360 }) },
  evade: { wind: P(-20, 0.2, [30, 60], [20, 60], [10, -40], [-30, -20]), hit: P(-24, 0.24, [20, 70], [10, 70], [10, -50], [-34, -30], { hipX: -0.06 }) },
  burst: { wind: P(10, 0.3, [40, 120], [40, 120], [30, -60], [-30, -60]), hit: P(-10, 0.05, [150, 0], [150, 0], [30, -6], [-30, -6]) },
};

export function poseLibraryKeys(): string[] {
  return Object.keys(LIB);
}

const lerpPair = (x: [number, number], y: [number, number], t: number): [number, number] => [lerp(x[0], y[0], t), lerp(x[1], y[1], t)];

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    lean: lerp(a.lean, b.lean, t),
    hipY: lerp(a.hipY, b.hipY, t),
    hipX: lerp(a.hipX, b.hipX, t),
    aF: lerpPair(a.aF, b.aF, t),
    aB: lerpPair(a.aB, b.aB, t),
    lF: lerpPair(a.lF, b.lF, t),
    lB: lerpPair(a.lB, b.lB, t),
    head: lerp(a.head, b.head, t),
    rot: lerp(a.rot, b.rot, t),
    lift: lerp(a.lift, b.lift, t),
    squash: lerp(a.squash, b.squash, t),
  };
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Anticipation: reach the wind-up quickly, then hold it just before release. */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
/** Follow-through: swing slightly past the stance before settling. */
const easeOutBack = (t: number) => {
  const c1 = 1.5;
  const x = clamp01(t) - 1;
  return 1 + (c1 + 1) * x * x * x + c1 * x * x;
};
/** Sprite-like stepping: loops advance in discrete frames like hand-drawn animation. */
const step = (v: number, steps: number) => Math.floor(v * steps) / steps;

function airBase(f: FighterState): Pose {
  if (f.vy > 4) return P(4, 0.18, [130, 40], [100, 40], [44, -80], [-14, -34], { squash: 1.07 });
  if (f.vy > -4) return P(10, 0.3, [84, 60], [70, 60], [78, -132], [40, -118]); // apex tuck
  return P(4, 0.1, [118, 36], [86, 40], [22, -32], [-16, -22], { squash: 1.03 });
}

function walkCycle(st: Pose, f: FighterState, run: boolean): Pose {
  const len = run ? 70 : 52; // world units per full stride
  const ph = step((((f.x * f.facing) / len) % 1 + 1) % 1, 8) * Math.PI * 2;
  const s = Math.sin(ph);
  const lift = (p: number) => Math.max(0, -Math.cos(p));
  if (run) {
    return P(28, 0.14 + Math.abs(s) * 0.05, [40 - s * 60, 95], [40 + s * 60, 95], [18 + s * 52, -24 - lift(ph) * 100], [-10 - s * 52, -24 - lift(ph + Math.PI) * 100], { head: -6 });
  }
  return {
    ...st,
    lean: st.lean + 3,
    hipY: st.hipY + Math.abs(s) * 0.035,
    aF: [st.aF[0] - s * 10, st.aF[1]],
    aB: [st.aB[0] + s * 10, st.aB[1]],
    lF: [10 + s * 28, -12 - lift(ph) * 55],
    lB: [-10 - s * 28, -12 - lift(ph + Math.PI) * 55],
  };
}

export function computePose(sim: Sim, f: FighterState, t: number): Pose {
  const s = f.state;
  const sf = f.stateFrame;
  const st = stanceFor(f.charId);
  const crouch = CROUCHES[f.charId] ?? CROUCH;
  switch (s) {
    case 'idle': {
      if (f.stance) return LIB.draw.hit;
      // 4-frame breathing loop (Riot bounces on his toes)
      const bounce = f.charId === 'riot';
      const k = step(((t / (bounce ? 22 : 48)) % 1 + 1) % 1, 4);
      const b = bounce ? Math.abs(Math.sin(k * Math.PI)) * 0.05 : Math.sin(k * Math.PI * 2) * 0.018;
      const float = f.charId === 'solenne' ? Math.sin(k * Math.PI * 2) * 0.012 : 0;
      return { ...st, hipY: st.hipY + b, lift: float, aF: [st.aF[0] + b * 60, st.aF[1]], aB: [st.aB[0] - b * 40, st.aB[1]] };
    }
    case 'walk':
      return walkCycle(st, f, false);
    case 'run':
      return walkCycle(st, f, true);
    case 'crouch':
      return sf < 3 ? blendPose(st, crouch, sf / 3) : crouch;
    case 'jumpsquat':
      return { ...blendPose(st, crouch, 0.6), squash: 0.84 };
    case 'landing':
      return { ...blendPose(crouch, st, Math.min(1, sf / 6)), squash: Math.min(1, 0.82 + sf * 0.045) };
    case 'air':
      if (f.flying) return P(14, 0.1, [60, 30], [40, 30], [20, -30], [-10, -20]);
      if (f.helpless) return P(0, 0.1, [150, 30], [130, 30], [20, -40], [-20, -60], { rot: step((sf % 24) / 24, 8) * 360 });
      return airBase(f);
    case 'dash':
      return P(34, 0.18, [-30, 60], [-50, 50], [62, -50], [-48, -26], { squash: 0.95 });
    case 'backdash':
      return P(-22, 0.16, [70, 70], [40, 60], [34, -44], [-30, -40]);
    case 'airdash':
      return P(40, 0.2, [-40, 40], [-60, 40], [30, -60], [-40, -50], { squash: 0.92 });
    case 'blockstun':
      if (!f.grounded) return P(-6, 0.22, [110, 120], [90, 120], [50, -100], [-10, -80]);
      return f.crouching ? P(10, 0.44, [100, 125], [80, 125], [62, -112], [-10, -100]) : P(-8, 0.12, [104, 125], [84, 125], [20, -22], [-18, -10]);
    case 'hitstun':
    case 'crumple': {
      // alternate between two reactions so combos read clearly
      const v = f.combo.hits % 2;
      const k = Math.max(0, 1 - sf / 6);
      const snap = v === 0 ? P(-26 - k * 10, 0.14, [24, 40], [-36, 30], [26, -32], [-12, -6], { head: -28 }) : P(30 + k * 8, 0.22, [64, 22], [40, 26], [12, -24], [-22, -30], { head: 22 });
      if (s === 'crumple') return blendPose(snap, P(40, 0.6, [20, 10], [10, 10], [70, -140], [10, -120], { head: 30 }), Math.min(1, sf / 30));
      return snap;
    }
    case 'launched':
    case 'thrown': {
      if (s === 'thrown') return P(-30, 0.1, [130, 40], [100, 40], [30, -50], [-10, -20], { rot: -60, head: -30 });
      const tumble = f.combo.hits >= 3 || Math.abs(f.vy) > 10;
      const rot = tumble ? -step((sf % 30) / 30, 8) * 360 : Math.atan2(-f.vy, Math.abs(f.vx) + 2) * (180 / Math.PI) * 0.6 - 30;
      return P(-30, 0.1, [130, 40], [100, 40], [30, -50], [-10, -20], { rot, head: -30 });
    }
    case 'knockdown': {
      const bounce = sf < 8 ? Math.sin((sf / 8) * Math.PI) * 0.06 : 0;
      return P(0, 0, [170, 0], [160, 0], [0, 0], [6, -10], { rot: -90, lift: -0.02 + bounce });
    }
    case 'getup': {
      const k = sf / 18;
      const lying = P(0, 0, [170, 0], [160, 0], [0, 0], [6, -10], { rot: -90 });
      return k < 0.5 ? blendPose(lying, crouch, k * 2) : blendPose(crouch, st, (k - 0.5) * 2);
    }
    case 'techroll':
      return P(40, 0.5, [60, 60], [60, 60], [80, -140], [40, -130], { rot: -step((sf % 20) / 20, 8) * 360 });
    case 'throwtech':
      return P(-20, 0.14, [70, 20], [60, 20], [20, -20], [-26, -16]);
    case 'win': {
      const w = WINS[f.charId] ?? WINS.riot;
      const bob = step(((t / 40) % 1 + 1) % 1, 4);
      return { ...blendPose(st, w, Math.min(1, sf / 12)), hipY: w.hipY + Math.sin(bob * Math.PI * 2) * 0.015 };
    }
    case 'ko':
      return P(0, 0, [170, 0], [160, 0], [0, 0], [6, -10], { rot: -90 });
    case 'move': {
      const m = sim.move(f);
      if (!m) return st;
      const set = LIB[m.pose] ?? LIB.jab;
      const fd = frameData(m);
      const fr = f.moveFrame;
      const base = !f.grounded && m.stance === 'air' ? airBase(f) : m.cmd?.dir && 'd123'.includes(m.cmd.dir) && m.stance === 'ground' ? crouch : st;
      const startup = Math.max(1, fd.startup);
      // charge moves hold their wind-up while the button is held
      if (m.charge && fr === m.charge.holdFrame) return { ...set.wind, squash: 0.97 + Math.sin(t * 0.5) * 0.02 };
      if (fr <= startup) return blendPose(base, set.wind, easeOutCubic(fr / startup));
      const actEnd = startup + Math.max(1, fd.active);
      if (fr <= actEnd) {
        if (m.pose === 'rush') {
          const k = ((fr - startup) % 6) / 6;
          return blendPose(set.hit, set.wind, k < 0.5 ? k * 2 : 2 - k * 2);
        }
        if (m.pose === 'roll' || m.pose === 'spin') return blendPose(set.wind, set.hit, (fr - startup) / Math.max(1, fd.active));
        // first active frame stretches into the strike
        return fr === startup + 1 ? { ...set.hit, squash: 1.04 } : set.hit;
      }
      const rec = Math.max(1, m.total - actEnd);
      return blendPose(set.hit, base, easeOutBack((fr - actEnd) / rec));
    }
  }
  return st;
}

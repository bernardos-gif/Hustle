// Global combat tuning. Every rule the engine applies is parameterised here so it can be
// inspected in the training display and asserted in tests.

export const FPS = 60;

export const CFG = {
  stage: { left: 0, right: 1400, width: 1400, ceiling: 820 },
  /** Max horizontal distance between fighters (camera limit). */
  maxSeparation: 900,
  roundFrames: 99 * FPS,
  roundsToWin: 2,
  introFrames: 70,
  koFrames: 150,

  meter: { max: 300, perBar: 100, onHitMult: 1.0, onHurt: 0.45, onBlockAtk: 0.35, onBlockDef: 0.5, onWhiffSpecial: 2, onParry: 12 },
  burst: { max: 1000, regenPerFrame: 0.6, onDamageMult: 2.2, minComboHits: 2, damage: 10, recoveryVulnerable: 24, punishScale: 1.15 },
  feint: { max: 2, regenFrames: 240 },

  combo: {
    defaultProration: 0.9,
    minScale: 0.18,
    /** Extra multiplier per repeat of the same move in one combo. */
    repeatPenalty: 0.75,
    /** Hitstun reduction per repeat of the same move. */
    repeatHitstunPenalty: 0.12,
    /** Projectile hits prorate harder. */
    projectileProration: 0.92,
    /** Hits against an already airborne opponent prorate a little more. */
    airborneProration: 0.97,
    /** Hitstun decay begins after this many combo frames... */
    decayStart: 90,
    /** ...and reaches maxDecay hitstun reduction at decayFull frames. */
    decayFull: 480,
    maxDecay: 0.85,
    minHitstun: 4,
    /** Max times the same light normal may chain into itself within one combo. */
    maxLightChain: 3,
    /** Extra gravity applied to juggled fighters as the combo continues. */
    gravityScalingPerSecond: 0.18,
    maxGravityScale: 1.8,
    maxWallBounces: 1,
    maxGroundBounces: 1,
    /** DI strength grows with combo length. */
    diGrowthPerHit: 0.04,
    diMaxBonus: 0.6,
  },

  di: {
    /** Max rotation (radians) DI can apply to a launch vector at strength 1. */
    maxAngle: 0.32,
    /** Max speed scaling DI can apply (in or out) at strength 1. */
    maxSpeedScale: 0.12,
    /** Fraction of DI strength re-applied on wall/ground bounces. */
    bounceFactor: 0.6,
    /** Small horizontal drift allowed during air hitstun (per frame). */
    driftAccel: 0.04,
    driftMax: 1.2,
  },

  hitstop: { L: 6, M: 8, H: 11, S: 9, X: 13, max: 16, counterBonus: 3, clash: 12, parry: 10 },
  counterHit: { damage: 1.1, hitstun: 1.25 },
  block: { chipKills: false, pushbackWallTransfer: true, airBlockstunBonus: 2, pushblockCost: 25, pushblockStun: 8, pushblockForce: 9 },
  throwTech: { window: 10, push: 7, stun: 16 },
  landingLag: { default: 4 },
  knockdown: { soft: 26, hard: 44, getupFrames: 18, wakeInvuln: 18, techRollFrames: 20, airRecoverInvuln: 8, techWindow: 8 },
  physics: { groundFriction: 0.82, hitstunFriction: 0.9, pushboxStrength: 0.5, wallBounceMinSpeed: 4 },
  clash: { priorityGap: 2, rebound: 4 },
};

export type CombatConfig = typeof CFG;

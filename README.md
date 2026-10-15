# HUSTLE // Real-Time

A deep 2D fighting game with fully continuous, real-time control. It aims for the mechanical
breadth of *Your Only Move Is HUSTLE* (DI, bursts, free cancels, wild aerial movement,
projectile and object interactions, character-specific systems) without the turn-based planning
layer. You move, attack, block, dodge and react at 60 fps, with no action phases and no menus
during combat.

The game runs in the browser (TypeScript + Canvas 2D, no runtime dependencies). The combat engine
is deterministic and runs headless, so the same code drives the game, the replays, the AI and
the automated tests.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 258 automated combat tests (vitest)
npm run build      # typecheck + production build into dist/
npm run smoke      # builds, then runs a real-browser gameplay smoke test (Playwright/Chromium)
npm run standalone # rebuilds hustle-rt.html: the whole game in one offline HTML file
```

**No install needed:** download [`hustle-rt.html`](hustle-rt.html) and open it in any modern
browser (double-click works, no server). Settings and replays are saved in that browser.

## Controls

| Action | Player 1 | Player 2 | Gamepad |
| --- | --- | --- | --- |
| Move / jump / crouch | W A S D | Arrow keys | Stick / D-pad |
| Light / Medium / Heavy | J / K / L | Numpad 1 / 2 / 3 (or `,` `.` `/`) | A / X / Y |
| Special | U | Numpad 4 (or M) | B |
| Super (Burst while being comboed) | I | Numpad 5 (or `;`) | RB |
| Throw | O | Numpad 6 (or `'`) | LB |
| Dash / dodge / air dash / tech | Space | Numpad 0 (or Right Shift) | RT |
| Parry / feint / guard push | H | Numpad . (or N) | LT |
| Pause / menu | Esc | Esc | Start |

Every key can be rebound from **Controls**. Moves use numpad notation, relative to the direction
you face: `6` is forward, `2` is down, `3` is down-forward, and so on. `2H` means down + Heavy.

## Universal mechanics

- **Movement**: walk, hold up to jump (tap up for a short hop), double-tap to dash or backdash,
  hold forward after a dash to run, fast-fall by tapping down in the air, and air-control drift.
- **Air options** (HUD pips): double jumps and 8-way air dashes share one pool, which refills on landing.
- **D (dash button)**: forward dash, `4D` backdash (with early invulnerability), `3D`/`1D` roll,
  `2D` evade, and air dash in the air. For Bastion, D in the air toggles jet flight instead.
- **Blocking**: hold back. Crouch-block to stop lows, stand-block to stop overheads, and you can
  block in the air. Anti-air normals can't be air-blocked. Throws beat blocking.
- **Throws**: `T` and `4T` (back throw, swaps sides). Press T within 8 frames of being grabbed
  to tech. Two throws on the same frame tech each other. Strikes beat throw startup.
  Command grabs can't be teched.
- **Parry** (`P`): active on frames 2-7. It beats strikes and parryable projectiles and leaves
  you free to act almost immediately. A whiffed parry has 20 frames of recovery, and throws
  beat it.
- **Guard Push**: press P during blockstun to spend 25 meter and shove the attacker away.
- **Feint / free cancel** (HUD pips, regenerate over time): spend a pip to cancel an eligible
  move that whiffed into its allowed follow-ups, or press P during the startup of a special or
  heavy to cancel it back to neutral.
- **Cancels** are data-driven per move: normal chains (light into light is limited to 3 per
  combo), special, super, jump, dash, air-dash and landing cancels, plus character-specific
  routes. Inputs are buffered for 8 frames and remember the direction held when you pressed.
- **DI**: hold a direction while you're being hit. It locks in when hitstop ends and can rotate
  your launch by up to about 18° and change its speed by up to 12%. Both limits grow by up to 60%
  during long combos. DI is re-applied (weaker) on wall and ground bounces. Limited drift is
  allowed while tumbling. DI never changes damage or hitstun, and never changes a hit after the
  fact.
- **Burst** (`X` while being comboed with 2+ hits, or while blocking, needs a full gauge): an
  invulnerable shockwave that breaks the combo. It can be blocked or baited, has 24 punishable
  frames of recovery, and a combo that punishes it starts at 115% damage scaling. Supers
  marked unburstable, and being thrown, can't be bursted.
- **Recovery**: when hitstun ends in the air you regain control (air recovery, with brief
  invulnerability). Press D just before landing from a tumble to tech roll (not possible after a
  hard knockdown). Getting up from a knockdown is invulnerable.
- **Clashes**: attacks of equal priority that meet cancel each other. Both fighters rebound
  and can act. If the priority gap is 2 or more, the stronger attack wins and still hits.
  Armor ignores clashes, and attacks marked as not clashable trade.
- **Combo rules**:
  - Every hit applies proration, so damage scales down; it never falls below an 18% floor.
  - Reusing the same move costs extra damage and hitstun.
  - Projectiles and hits on airborne opponents prorate more.
  - Juggled opponents fall faster as the combo goes on.
  - Hitstun decays after 1.5 s of combo.
  - One wall bounce and one ground bounce per combo.
  - One OTG hit per combo.
  - Past 8 s of combo, hits no longer cause hitstun. This is a hard anti-infinite rule.
- **Meter**: 3 bars, gained by hitting, getting hit, blocking and parrying. Gain shrinks as a
  combo's scaling drops. Supers cost 1-3 bars and play a short super freeze (under 0.5 s).

## Roster

All five fighters share the engine but play very differently. Each has 31-36 move actions,
including the universal ones; the in-game **Move List** reads directly from the game data.

| Fighter | Archetype | Unique systems |
| --- | --- | --- |
| **Vesper** | Precision duelist | Disjointed rapier, six-round pistol (ammo, reload), Draw Stance with 4-frame iai slash, stance launcher, counter posture and stance step, invulnerable rising slash, *Six-Shot Execution* (scales with remaining ammo). Lowest HP. |
| **Mirage** | Mobility trickster | 3 air options (refunded on air hits), phase anchor + blink teleport, ghost step behind the opponent, tether hook pull, exploding decoy, cross-up rush, air throw, **Mirror Pane** projectile reflector, teleporting super, counter super. |
| **Solenne** | Elemental caster | Mana (regenerates, or channel it), chargeable fire bolt, delayed frost spike, multi-hit lightning beam, summoned orb with command detonation, levitation, **four** meter-powered spells (pillar, ice wall that blocks projectiles, homing storm, meteor). |
| **Bastion** | Mechanized heavyweight | No air jumps; fuel-powered 8-way **jet flight** with braking. Armored long-range piston, untechable command grab, air grab piledriver, drone summon that fires on its own or on command, ground shockwave with OTG, armored supers. Highest HP. |
| **Riot** | High-speed brawler | 3-frame jab, wall jumps, slide, cross-up Flash Step, **Heat** (builds with aggression, raises damage), **Overdrive** install (drains meter; adds movement speed and damage, gives free whiff cancels, and swaps in enhanced specials), Final Heat super. |

## Modes and tools

- **Versus CPU**: four difficulties. Difficulty only changes reaction delay and decision
  quality, never stats.
- **Versus Player**: local two-player on one keyboard and/or gamepads.
- **CPU vs CPU**: two AIs fight each other.
- **Training**:
  - Reset to center or either corner, and swap sides.
  - Dummy behaviour: stand, crouch, jump, CPU, or record/playback (you control the dummy, then
    it replays).
  - Dummy block (none/all/random), DI direction, tech, burst, reversal and throw-tech settings.
  - Infinite health, meter, burst and resources.
  - Hitbox, hurtbox, throwbox and pushbox overlay.
  - Frame-data panel (startup/active/recovery bar, current frame, invulnerability, armor,
    cancel window, costs, measured frame advantage, combo scaling, DI vector) and input
    history with the live buffer.
  - DI indicator with a predicted trajectory, computed by running a copy of the real simulation
    forward.
- **Replays**: every match is recorded as inputs; the last 8 are kept in the browser. Playback
  supports pause, frame step, rewind, ±2 s seek, 0.125x-4x speed, hiding the HUD and debug
  overlays. Replays are verified bit-exact against the live match in tests.
- **Options**:
  - Particle density, screen shake, flash intensity and zoom punches, plus a one-click
    reduced-effects preset.
  - Hit-spark style (classic/star/slash/ring/pixel) and size.
  - Afterimages and speed lines.
  - An **Aura editor**: each character has several auras attached to body regions (core,
    hands, feet, head, weapon, back), fired by gameplay triggers (dash, charge, install, super,
    flight, stance, low HP, heat, attack…). Color, size, spawn rate, lifetime, speed, region,
    trigger and shape are all editable.

## Architecture

```
src/core/        input bitmasks, buffer, numpad directions, fixed-step loop, math, RNG
src/combat/      types (MoveDef/HitDef/ProjectileDef/…), config (all tuning), sim (engine),
                 registry (per-character lookup + frame data), universal moves
src/characters/  data-driven fighters (+ small hooks only for genuinely unique mechanics)
src/ai/          CPU opponent reading real move data (reach, startup, guard, cancels, costs)
src/render/      procedural skeleton poses synced to frame data, effects, HUD, debug overlay
src/audio/       synthesized WebAudio sound effects driven by combat events
src/game/        app shell, menus, devices/bindings, training dummy, replays, move list
tests/           vitest suites for every required combat scenario + fuzzing
scripts/smoke.mjs  real-browser smoke test (Playwright)
```

- `Sim.step([p1Input, p2Input])` advances exactly one frame. All state is plain data
  (`snapshot()`/`restore()`), and nothing in the simulation reads wall-clock time or
  `Math.random`.
- Each step runs these phases in order: inputs and burst checks → fighter state machines
  (hitstop, moves, cancels, physics) → projectiles → pushboxes → collisions (melee clashes →
  projectile clashes → strike-vs-projectile destroy/reflect → simultaneous strikes, so trades
  work → grab follow-ups → throws → projectile hits) → facing → combo bookkeeping → frame
  advantage → round flow.
- Adding a fighter means writing a data file of `MoveDef`s and `ProjectileDef`s and calling
  `registerCharacter`. Hit resolution, scaling, buffering, cancels, DI, burst and collisions are
  shared.

## Test coverage

`npm test` runs 258 tests:

| Required scenario | Covered in |
| --- | --- |
| 1. Movement, jumps, dashes, air control (repeated 50×), flight, wall jump | `tests/movement.test.ts` |
| 2-4. Every move's hitboxes are active on exactly its frames (all 5 characters); one hit per active window; damage, hitstun, knockback and launch values; counter hits | `tests/frames.test.ts` |
| 5. Buffer timing, chains, special, jump, air-dash, landing and dash-attack cancels, whiff cancels and feints | `tests/cancels.test.ts` |
| 6-7. DI direction and bounds, no retroactive change, bounce DI; all burst rules | `tests/di_burst.test.ts` |
| 8. High, low and air blocking; chip; guard push; throws, techs, throw-on-throw; parry timing; dodges; armor; counter stance | `tests/defense.test.ts` |
| 9-10. Projectiles vs fighters, projectiles and defenses; reflect; projectile invulnerability; delayed, persistent and summoned objects; clashes, priority and trades | `tests/projectiles.test.ts` |
| 11. Proration, repeat penalty, scaling floor, multi-hit, projectile scaling, hitstun decay, bounce limits, meter gain, anti-infinite loops | `tests/combo.test.ts` |
| 12-13. Super costs (exactly once), super freeze, install lifecycle, every character resource | `tests/resources.test.ts` |
| 14-18. AI completes matches for every character, uses specials and supers, and harder AI wins; full reset; data consistency; replay determinism; frame-rate independence; bindings | `tests/systems.test.ts` |
| 18. 3,000 frames of random input for all 25 matchups: no NaN, no out-of-bounds, no stuck states, no negative resources, everyone returns to neutral | `tests/fuzz.test.ts` |

## Status and known limitations

- **No online multiplayer.** It has not been implemented or tested; only local versus is
  available. The simulation is deterministic and supports snapshot/restore, which is the
  foundation rollback netcode would need, but no networking code exists.
- **Art** is procedural vector stick figures (an intentional nod to the genre). Poses are keyed
  to each move's real startup/active/recovery frames, but they are blended keyframes, not
  hand-animated sprites.
- **Sound** is synthesized at runtime. There is no music.
- **Balance** has had automated sanity passes (AI-vs-AI matches, anti-infinite tests) but no
  human playtesting at a competitive level.
- **Replays** are stored in `localStorage` (the 8 most recent); there is no file export yet.

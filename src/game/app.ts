// Application shell: menus, match flow, training mode, replay viewer, options and bindings.
// The match loop runs the simulation at a fixed 60 Hz regardless of display refresh rate.

import { ROSTER } from '../characters';
import { FPS } from '../combat/config';
import { Sim, defaultSettings, type SimSettings } from '../combat/sim';
import type { CharacterDef, CombatEvent } from '../combat/types';
import { IN } from '../core/input';
import { AIController, DIFFICULTIES } from '../ai/ai';
import { Sfx } from '../audio/sfx';
import { Effects, defaultFxSettings, type AuraConfig, type SparkStyle } from '../render/effects';
import { Hud, drawDebug } from '../render/hud';
import { computePose } from '../render/poses';
import { Renderer, VIEW_H, VIEW_W } from '../render/renderer';
import { buildJoints, drawFighter } from '../render/skeleton';
import { Devices, type MenuKey } from './devices';
import { UNIVERSAL_HELP, moveList } from './movelist';
import { ReplayPlayer, ReplayRecorder, loadReplays, saveReplay, type ReplayData } from './replay';
import { ACTIONS, ACTION_LABEL, defaultBindings, loadSettings, saveSettings, type Action, type Settings } from './settings';
import { TrainingDummy, defaultTraining, type TrainingConfig } from './training';

type Screen = 'title' | 'select' | 'match' | 'movelist' | 'options' | 'aura' | 'controls' | 'replays' | 'replay';
type Mode = 'cpu' | 'versus' | 'training' | 'watch';

const STEP_MS = 1000 / FPS;
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

interface MenuItem {
  label: string | (() => string);
  action?: () => void;
  left?: () => void;
  right?: () => void;
  hint?: string;
}

function cycle<T>(arr: readonly T[], cur: T, d: number): T {
  const i = arr.indexOf(cur);
  return arr[(i + d + arr.length) % arr.length];
}

export class App {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  settings: Settings;
  devices: Devices;
  sfx = new Sfx();
  fx: Effects;
  renderer: Renderer;
  hud = new Hud();

  screen: Screen = 'title';
  mode: Mode = 'cpu';
  menuIdx = 0;
  // select
  pick: [number, number] = [0, 1];
  selectPhase = 0;
  // match
  sim: Sim | null = null;
  chars: CharacterDef[] = [];
  labels: [string, string] = ['P1', 'P2'];
  ais: [AIController | null, AIController | null] = [null, null];
  recorder: ReplayRecorder | null = null;
  lastReplay: ReplayData | null = null;
  paused = false;
  pauseIdx = 0;
  overFrames = 0;
  resultsIdx = 0;
  acc = 0;
  lastTs = 0;
  time = 0;
  showBoxes = false;
  training: TrainingConfig = defaultTraining();
  dummy = new TrainingDummy(this.training);
  dummyRecording = false;
  // move list
  mlChar = 0;
  mlScroll = 0;
  mlReturn: Screen = 'title';
  // options / aura / controls
  optIdx = 0;
  auraChar = 0;
  auraIdx = 0;
  bindIdx = 0;
  bindPlayer: 0 | 1 = 0;
  waitingBind = false;
  // replays
  replayList: ReplayData[] = [];
  replayIdx = 0;
  rp: ReplayPlayer | null = null;
  rpPlaying = true;
  rpSpeed = 1;
  rpHideHud = false;
  rpBoxes = false;
  /** Measured simulation steps per second (for diagnostics/smoke tests). */
  stepsThisSecond = 0;
  sps = 0;
  private spsTimer = 0;
  errors: string[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.settings = loadSettings();
    this.devices = new Devices(this.settings);
    this.devices.onAnyInput = () => this.sfx.unlock();
    this.sfx.setVolume(this.settings.volume);
    this.fx = new Effects(this.settings.fx);
    this.renderer = new Renderer(this.ctx, this.fx);
    canvas.addEventListener('pointerdown', () => this.sfx.unlock());
  }

  start(): void {
    const loop = (ts: number) => {
      try {
        this.frame(ts);
      } catch (e) {
        this.errors.push(String((e as Error)?.stack ?? e));
        console.error(e);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ main loop

  frame(ts: number): void {
    const dt = this.lastTs ? Math.min(250, ts - this.lastTs) : STEP_MS;
    this.lastTs = ts;
    this.time++;
    this.devices.pollPadMenu();
    const menu = this.devices.takeMenu();
    const raw = this.devices.takeRaw();
    this.spsTimer += dt;
    if (this.spsTimer >= 1000) {
      this.sps = this.stepsThisSecond;
      this.stepsThisSecond = 0;
      this.spsTimer -= 1000;
    }

    switch (this.screen) {
      case 'title':
        this.menuInput(menu, this.titleItems());
        this.drawTitle();
        break;
      case 'select':
        this.selectInput(menu);
        this.drawSelect();
        break;
      case 'match':
        this.matchInput(menu, raw);
        if (!this.paused) this.advance(dt);
        this.drawMatch();
        break;
      case 'movelist':
        this.movelistInput(menu);
        this.drawMoveList();
        break;
      case 'options':
        this.menuInput(menu, this.optionItems(), () => this.go('title'));
        this.drawMenuScreen('OPTIONS', this.optionItems(), 'Left/Right to change · Enter to select · Esc to go back');
        break;
      case 'aura':
        this.menuInput(menu, this.auraItems(), () => this.go('options'));
        this.drawAura();
        break;
      case 'controls':
        this.controlsInput(menu, raw);
        this.drawControls();
        break;
      case 'replays':
        this.menuInput(menu, this.replayItems(), () => this.go('title'));
        this.drawMenuScreen('REPLAYS', this.replayItems(), 'Replays are deterministic input recordings (last 8 kept in this browser).');
        break;
      case 'replay':
        this.replayInput(menu, raw);
        this.advanceReplay(dt);
        this.drawReplay();
        break;
    }
  }

  private go(s: Screen): void {
    this.screen = s;
    this.menuIdx = 0;
    this.optIdx = 0;
  }

  private advance(dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP_MS && n < 5) {
      this.stepMatch();
      this.acc -= STEP_MS;
      n++;
    }
    if (n === 5) this.acc = 0; // never spiral: drop time if the device is too slow
  }

  /** One fixed simulation step of a live match. */
  stepMatch(): CombatEvent[] {
    const sim = this.sim!;
    const inputs: [number, number] = [0, 0];
    for (const i of [0, 1] as const) {
      const ai = this.ais[i];
      inputs[i] = ai ? ai.update(sim, i) : this.devices.sample(i);
    }
    if (this.mode === 'training') {
      const p1 = this.devices.sample(0);
      if (this.dummyRecording) {
        // the player drives the dummy while recording
        const f = sim.state.fighters[1];
        let r = p1;
        if (f.facing < 0) {
          const l = r & IN.LEFT;
          const rr = r & IN.RIGHT;
          r = (r & ~(IN.LEFT | IN.RIGHT)) | (l ? IN.RIGHT : 0) | (rr ? IN.LEFT : 0);
        }
        this.dummy.record(r);
        inputs[0] = 0;
        inputs[1] = p1;
      } else {
        inputs[0] = p1;
        inputs[1] = this.dummy.input(sim, 1);
      }
      this.dummy.apply(sim, 1);
    }
    this.devices.endStep();
    const events = sim.step(inputs);
    this.stepsThisSecond++;
    this.recorder?.record(inputs);
    this.renderer.tick(sim, this.chars, events);
    this.hud.tick(sim);
    this.sfx.handle(events, sim);
    for (const e of events) if (e.type === 'round' && e.phase === 'next') this.hud.reset();
    if (sim.state.round.phase === 'over') {
      this.overFrames++;
      if (this.overFrames === 1 && this.recorder) {
        this.lastReplay = this.recorder.finish(sim);
        saveReplay(this.lastReplay);
      }
    }
    return events;
  }

  // ------------------------------------------------------------------ match setup

  startMatch(mode: Mode, a: string, b: string): void {
    this.mode = mode;
    const settings: SimSettings = { ...defaultSettings(), training: mode === 'training' };
    const seed = (Date.now() & 0xffff) + 1;
    this.sim = new Sim({ chars: [a, b], seed, settings });
    this.chars = [ROSTER.find((c) => c.id === a)!, ROSTER.find((c) => c.id === b)!];
    const diff = DIFFICULTIES[this.settings.difficulty] ?? DIFFICULTIES[1];
    this.ais = [mode === 'watch' ? new AIController(DIFFICULTIES[2], seed + 1) : null, mode === 'cpu' || mode === 'watch' ? new AIController(diff, seed + 2) : null];
    this.labels = mode === 'cpu' ? ['P1', 'CPU'] : mode === 'watch' ? ['CPU 1', 'CPU 2'] : mode === 'training' ? ['P1', 'DUMMY'] : ['P1', 'P2'];
    this.recorder = mode === 'training' ? null : new ReplayRecorder([a, b], seed, settings, this.labels);
    this.overFrames = 0;
    this.resultsIdx = 0;
    this.paused = false;
    this.acc = 0;
    this.fx.clear();
    this.hud.reset();
    this.dummyRecording = false;
    if (mode === 'training') this.dummy.apply(this.sim, 1);
    this.screen = 'match';
  }

  private rematch(): void {
    if (!this.sim) return;
    this.startMatch(this.mode, this.sim.charIds[0], this.sim.charIds[1]);
  }

  // ------------------------------------------------------------------ menus

  private menuInput(menu: { key: MenuKey; player: number }[], items: MenuItem[], back?: () => void): void {
    for (const m of menu) {
      if (m.key === 'up') this.optIdx = (this.optIdx - 1 + items.length) % items.length;
      else if (m.key === 'down') this.optIdx = (this.optIdx + 1) % items.length;
      else if (m.key === 'left') items[this.optIdx]?.left?.();
      else if (m.key === 'right') items[this.optIdx]?.right?.();
      else if (m.key === 'confirm') (items[this.optIdx]?.action ?? items[this.optIdx]?.right)?.();
      else if ((m.key === 'back' || m.key === 'pause') && back) back();
    }
  }

  private titleItems(): MenuItem[] {
    const sel = (mode: Mode) => () => {
      this.mode = mode;
      this.selectPhase = 0;
      this.go('select');
    };
    return [
      { label: 'Versus CPU', action: sel('cpu'), hint: 'Fight the computer.' },
      { label: 'Versus Player (local)', action: sel('versus'), hint: 'Two players on one keyboard and/or gamepads.' },
      { label: 'Training', action: sel('training'), hint: 'Sandbox with dummy settings, hitboxes, frame data and DI display.' },
      { label: 'CPU vs CPU', action: sel('watch'), hint: 'Watch two AIs fight.' },
      {
        label: 'Replays',
        action: () => {
          this.replayList = loadReplays();
          if (this.lastReplay && !this.replayList.some((r) => r.date === this.lastReplay!.date)) this.replayList.unshift(this.lastReplay);
          this.go('replays');
        },
        hint: 'Watch recorded matches with pause, rewind, speed and frame stepping.',
      },
      {
        label: 'Move List',
        action: () => {
          this.mlReturn = 'title';
          this.mlScroll = 0;
          this.screen = 'movelist';
        },
        hint: 'Every move with real frame data, damage, cost and properties.',
      },
      { label: 'Options', action: () => this.go('options'), hint: 'Audio, visual effects, aura customisation, CPU difficulty.' },
      { label: 'Controls', action: () => this.go('controls'), hint: 'View and rebind keys.' },
    ];
  }

  private optionItems(): MenuItem[] {
    const s = this.settings;
    const fx = s.fx;
    const save = () => {
      saveSettings(s);
      this.sfx.setVolume(s.volume);
    };
    const num = (label: string, get: () => number, set: (v: number) => void, step: number, lo: number, hi: number, fmt = (v: number) => `${Math.round(v * 100)}%`): MenuItem => ({
      label: () => `${label}: ${fmt(get())}`,
      left: () => {
        set(Math.max(lo, Math.round((get() - step) * 100) / 100));
        save();
      },
      right: () => {
        set(Math.min(hi, Math.round((get() + step) * 100) / 100));
        save();
      },
    });
    const bool = (label: string, get: () => boolean, set: (v: boolean) => void): MenuItem => ({
      label: () => `${label}: ${get() ? 'ON' : 'OFF'}`,
      action: () => {
        set(!get());
        save();
      },
      left: () => {
        set(!get());
        save();
      },
      right: () => {
        set(!get());
        save();
      },
    });
    const styles: SparkStyle[] = ['classic', 'star', 'slash', 'ring', 'pixel'];
    return [
      num('Volume', () => s.volume, (v) => (s.volume = v), 0.1, 0, 1),
      { label: () => `CPU difficulty: ${DIFFICULTIES[s.difficulty].name}`, left: () => ((s.difficulty = Math.max(0, s.difficulty - 1)), save()), right: () => ((s.difficulty = Math.min(DIFFICULTIES.length - 1, s.difficulty + 1)), save()) },
      num('Particle density', () => fx.particleDensity, (v) => (fx.particleDensity = v), 0.25, 0, 2),
      num('Screen shake', () => fx.shake, (v) => (fx.shake = v), 0.25, 0, 1.5),
      num('Flash intensity', () => fx.flashes, (v) => (fx.flashes = v), 0.25, 0, 1),
      bool('Camera zoom punches', () => fx.zoom, (v) => (fx.zoom = v)),
      { label: () => `Hit spark style: ${fx.sparkStyle}`, left: () => ((fx.sparkStyle = cycle(styles, fx.sparkStyle, -1)), save()), right: () => ((fx.sparkStyle = cycle(styles, fx.sparkStyle, 1)), save()) },
      num('Hit spark size', () => fx.sparkScale, (v) => (fx.sparkScale = v), 0.25, 0.25, 2.5),
      bool('Afterimages', () => fx.afterimages, (v) => (fx.afterimages = v)),
      bool('Speed lines', () => fx.speedLines, (v) => (fx.speedLines = v)),
      bool('Input display (versus)', () => s.showInputs, (v) => (s.showInputs = v)),
      { label: 'Aura editor…', action: () => ((this.screen = 'aura'), (this.optIdx = 0)) },
      {
        label: 'Reduce intense effects (preset)',
        action: () => {
          fx.particleDensity = 0.5;
          fx.shake = 0.25;
          fx.flashes = 0.15;
          fx.zoom = false;
          save();
        },
      },
      {
        label: 'Reset visual settings',
        action: () => {
          const d = defaultFxSettings();
          Object.assign(fx, d);
          save();
        },
      },
      { label: 'Back', action: () => this.go('title') },
    ];
  }

  private auraItems(): MenuItem[] {
    const c = ROSTER[this.auraChar];
    const list = this.settings.fx.auras[c.id] ?? [];
    const save = () => saveSettings(this.settings);
    const items: MenuItem[] = [{ label: () => `Character: ◀ ${c.name} ▶`, left: () => (this.auraChar = (this.auraChar + ROSTER.length - 1) % ROSTER.length), right: () => (this.auraChar = (this.auraChar + 1) % ROSTER.length) }];
    const regions = ['core', 'hands', 'feet', 'head', 'weapon', 'back'] as const;
    const triggers = ['always', 'dash', 'charge', 'install', 'super', 'lowHp', 'flight', 'stance', 'air', 'heat', 'attack'] as const;
    const shapes = ['flame', 'spark', 'orb', 'smoke'] as const;
    for (const a of list) {
      const n = (label: string, key: 'size' | 'rate' | 'lifetime' | 'speed', step: number, lo: number, hi: number): MenuItem => ({
        label: () => `   ${label}: ${a[key].toFixed(2)}`,
        left: () => ((a[key] = Math.max(lo, +(a[key] - step).toFixed(2))), save()),
        right: () => ((a[key] = Math.min(hi, +(a[key] + step).toFixed(2))), save()),
      });
      items.push(
        { label: () => `${a.enabled ? '■' : '□'} ${a.label}`, action: () => ((a.enabled = !a.enabled), save()), left: () => ((a.enabled = !a.enabled), save()), right: () => ((a.enabled = !a.enabled), save()) },
        { label: () => `   Color: ${a.color}`, left: () => ((a.color = hueShift(a.color, -15)), save()), right: () => ((a.color = hueShift(a.color, 15)), save()) },
        n('Size', 'size', 0.5, 0.5, 30),
        n('Spawn rate', 'rate', 0.1, 0, 8),
        n('Lifetime', 'lifetime', 2, 4, 90),
        n('Speed', 'speed', 0.2, 0, 6),
        { label: () => `   Region: ${a.region}`, left: () => ((a.region = cycle(regions, a.region, -1)), save()), right: () => ((a.region = cycle(regions, a.region, 1)), save()) },
        { label: () => `   Trigger: ${a.trigger}`, left: () => ((a.trigger = cycle(triggers, a.trigger, -1) as AuraConfig['trigger']), save()), right: () => ((a.trigger = cycle(triggers, a.trigger, 1) as AuraConfig['trigger']), save()) },
        { label: () => `   Shape: ${a.shape}`, left: () => ((a.shape = cycle(shapes, a.shape, -1)), save()), right: () => ((a.shape = cycle(shapes, a.shape, 1)), save()) },
      );
    }
    items.push({ label: 'Back', action: () => ((this.screen = 'options'), (this.optIdx = 0)) });
    return items;
  }

  private replayItems(): MenuItem[] {
    const items: MenuItem[] = this.replayList.map((r) => ({
      label: `${r.date.slice(0, 16).replace('T', ' ')}  ${r.labels[0]} ${r.chars[0]} vs ${r.labels[1]} ${r.chars[1]}  (${Math.round(r.inputs.length / FPS)}s)`,
      action: () => this.openReplay(r),
    }));
    if (!items.length) items.push({ label: 'No replays yet — finish a match to record one.' });
    items.push({ label: 'Back', action: () => this.go('title') });
    return items;
  }

  openReplay(r: ReplayData): void {
    this.rp = new ReplayPlayer(r);
    this.chars = [ROSTER.find((c) => c.id === r.chars[0])!, ROSTER.find((c) => c.id === r.chars[1])!];
    this.labels = r.labels;
    this.rpPlaying = true;
    this.rpSpeed = 1;
    this.acc = 0;
    this.fx.clear();
    this.hud.reset();
    this.screen = 'replay';
  }

  // ------------------------------------------------------------------ select

  private selectInput(menu: { key: MenuKey; player: number }[]): void {
    const n = ROSTER.length;
    for (const m of menu) {
      // which cursor this key moves
      let who = this.selectPhase === 0 ? 0 : 1;
      if (this.mode === 'versus' && this.selectPhase < 2) {
        if (m.player !== who && m.key !== 'pause') continue;
      }
      if (this.selectPhase >= 2) who = 0;
      if (m.key === 'left') this.pick[who] = (this.pick[who] + n - 1) % n;
      else if (m.key === 'right') this.pick[who] = (this.pick[who] + 1) % n;
      else if (m.key === 'up' && this.selectPhase === 2 && (this.mode === 'cpu' || this.mode === 'watch')) this.settings.difficulty = Math.min(DIFFICULTIES.length - 1, this.settings.difficulty + 1);
      else if (m.key === 'down' && this.selectPhase === 2 && (this.mode === 'cpu' || this.mode === 'watch')) this.settings.difficulty = Math.max(0, this.settings.difficulty - 1);
      else if (m.key === 'confirm') {
        if (this.selectPhase < 2) this.selectPhase++;
        else {
          saveSettings(this.settings);
          this.startMatch(this.mode, ROSTER[this.pick[0]].id, ROSTER[this.pick[1]].id);
          return;
        }
      } else if (m.key === 'back' || m.key === 'pause') {
        if (this.selectPhase > 0) this.selectPhase--;
        else this.go('title');
      }
    }
  }

  // ------------------------------------------------------------------ match input

  private pauseItems(): MenuItem[] {
    const t = this.training;
    const items: MenuItem[] = [{ label: 'Resume', action: () => (this.paused = false) }];
    if (this.mode === 'training') {
      const c = <T,>(label: string, arr: readonly T[], get: () => T, set: (v: T) => void): MenuItem => ({
        label: () => `${label}: ${String(get())}`,
        left: () => set(cycle(arr, get(), -1)),
        right: () => set(cycle(arr, get(), 1)),
        action: () => set(cycle(arr, get(), 1)),
      });
      const b = (label: string, k: keyof TrainingConfig): MenuItem => c(label, [true, false], () => t[k] as boolean, (v) => ((t as any)[k] = v));
      items.push(
        c('Dummy', ['stand', 'crouch', 'jump', 'cpu', 'playback'] as const, () => t.dummy as any, (v) => (t.dummy = v)),
        c('Dummy block', ['none', 'all', 'random'] as const, () => t.block, (v) => (t.block = v)),
        c('Dummy DI', ['none', 'away', 'toward', 'up', 'down', 'random'] as const, () => t.di, (v) => (t.di = v)),
        c('Dummy tech', ['none', 'neutral', 'back', 'forward', 'random'] as const, () => t.tech, (v) => (t.tech = v)),
        c('Dummy burst', ['never', 'after3', 'after6'] as const, () => t.burst, (v) => (t.burst = v)),
        c('Dummy reversal', ['none', 'parry', 'jump', 'backdash'] as const, () => t.reversal, (v) => (t.reversal = v)),
        b('Dummy throw tech', 'throwTech'),
        b('Infinite health', 'infiniteHp'),
        b('Infinite meter', 'infiniteMeter'),
        b('Infinite burst', 'infiniteBurst'),
        b('Infinite resources', 'infiniteResources'),
        b('Hitboxes', 'boxes'),
        b('Frame data panel', 'frameData'),
        b('DI display + trajectory', 'diDisplay'),
        b('Input display', 'inputs'),
        { label: 'Reset: center', action: () => this.trainingReset('center') },
        { label: 'Reset: left corner', action: () => this.trainingReset('leftCorner') },
        { label: 'Reset: right corner', action: () => this.trainingReset('rightCorner') },
      );
    } else {
      items.push({ label: () => `Hitboxes: ${this.showBoxes ? 'ON' : 'OFF'}`, action: () => (this.showBoxes = !this.showBoxes) });
      items.push({ label: 'Restart match', action: () => this.rematch() });
    }
    items.push(
      {
        label: 'Move list',
        action: () => {
          this.mlReturn = 'match';
          this.mlChar = ROSTER.findIndex((c) => c.id === this.chars[0].id);
          this.mlScroll = 0;
          this.screen = 'movelist';
        },
      },
      { label: 'Character select', action: () => ((this.selectPhase = 0), this.go('select')) },
      { label: 'Quit to title', action: () => this.go('title') },
    );
    return items;
  }

  private trainingReset(p: 'center' | 'leftCorner' | 'rightCorner' | 'swap'): void {
    this.sim?.resetPositions(p);
    this.fx.clear();
    this.hud.reset();
    if (this.sim) this.dummy.apply(this.sim, 1);
    this.paused = false;
  }

  private resultsItems(): MenuItem[] {
    return [
      { label: 'Rematch', action: () => this.rematch() },
      { label: 'Watch replay', action: () => this.lastReplay && this.openReplay(this.lastReplay) },
      { label: 'Character select', action: () => ((this.selectPhase = 0), this.go('select')) },
      { label: 'Quit to title', action: () => this.go('title') },
    ];
  }

  private matchInput(menu: { key: MenuKey; player: number }[], raw: string[]): void {
    const sim = this.sim;
    if (!sim) return;
    if (sim.state.round.phase === 'over' && this.overFrames > 90) {
      const items = this.resultsItems();
      for (const m of menu) {
        if (m.key === 'up') this.resultsIdx = (this.resultsIdx + items.length - 1) % items.length;
        if (m.key === 'down') this.resultsIdx = (this.resultsIdx + 1) % items.length;
        if (m.key === 'confirm') items[this.resultsIdx].action?.();
      }
      return;
    }
    if (this.paused) {
      const items = this.pauseItems();
      for (const m of menu) {
        if (m.key === 'pause' || m.key === 'back') this.paused = false;
        else if (m.key === 'up') this.pauseIdx = (this.pauseIdx + items.length - 1) % items.length;
        else if (m.key === 'down') this.pauseIdx = (this.pauseIdx + 1) % items.length;
        else if (m.key === 'left') items[this.pauseIdx]?.left?.();
        else if (m.key === 'right') items[this.pauseIdx]?.right?.();
        else if (m.key === 'confirm') (items[this.pauseIdx]?.action ?? items[this.pauseIdx]?.right)?.();
      }
      this.pauseIdx = Math.min(this.pauseIdx, items.length - 1);
      return;
    }
    for (const m of menu) {
      if (m.key === 'pause') {
        this.paused = true;
        this.pauseIdx = 0;
      }
      if (m.key === 'tab') {
        if (this.mode === 'training') this.training.boxes = !this.training.boxes;
        else this.showBoxes = !this.showBoxes;
      }
    }
    if (this.mode === 'training') {
      for (const k of raw) {
        if (k === 'Digit1') this.trainingReset('center');
        if (k === 'Digit2') this.trainingReset('leftCorner');
        if (k === 'Digit3') this.trainingReset('rightCorner');
        if (k === 'Digit4') this.trainingReset('swap');
        if (k === 'Digit5') {
          this.dummyRecording = !this.dummyRecording;
          if (this.dummyRecording) this.dummy.recording = [];
          this.hud.announce(this.dummyRecording ? 'RECORDING DUMMY — you control P2' : `RECORDED ${this.dummy.recording.length} FRAMES`);
        }
        if (k === 'Digit6') {
          this.dummyRecording = false;
          this.training.dummy = this.training.dummy === 'playback' ? 'stand' : 'playback';
          this.dummy.startPlayback();
          this.hud.announce(this.training.dummy === 'playback' ? 'PLAYBACK ON' : 'PLAYBACK OFF');
        }
        if (k === 'Digit0') this.training.frameData = !this.training.frameData;
      }
    }
  }

  // ------------------------------------------------------------------ move list

  private movelistInput(menu: { key: MenuKey; player: number }[]): void {
    for (const m of menu) {
      if (m.key === 'left') ((this.mlChar = (this.mlChar + ROSTER.length - 1) % ROSTER.length), (this.mlScroll = 0));
      if (m.key === 'right') ((this.mlChar = (this.mlChar + 1) % ROSTER.length), (this.mlScroll = 0));
      if (m.key === 'up') this.mlScroll = Math.max(0, this.mlScroll - 1);
      if (m.key === 'down') this.mlScroll++;
      if (m.key === 'back' || m.key === 'pause' || m.key === 'confirm') {
        this.screen = this.mlReturn;
      }
    }
  }

  // ------------------------------------------------------------------ controls

  private controlsInput(menu: { key: MenuKey; player: number }[], raw: string[]): void {
    if (this.waitingBind) {
      const k = raw.find((r) => r !== 'Escape');
      if (raw.includes('Escape')) this.waitingBind = false;
      else if (k) {
        const act = ACTIONS[this.bindIdx];
        const b = this.settings.bindings[this.bindPlayer];
        // remove the key from any other action of either player to avoid conflicts
        for (const pb of this.settings.bindings) for (const a of ACTIONS) pb[a] = pb[a].filter((x) => x !== k);
        b[act] = [k, ...b[act].filter((x) => x !== k)].slice(0, 2);
        saveSettings(this.settings);
        this.waitingBind = false;
      }
      return;
    }
    for (const m of menu) {
      if (m.key === 'up') this.bindIdx = (this.bindIdx + ACTIONS.length + 1) % (ACTIONS.length + 2);
      if (m.key === 'down') this.bindIdx = (this.bindIdx + 1) % (ACTIONS.length + 2);
      if (m.key === 'left' || m.key === 'right') this.bindPlayer = this.bindPlayer === 0 ? 1 : 0;
      if (m.key === 'confirm') {
        if (this.bindIdx < ACTIONS.length) this.waitingBind = true;
        else if (this.bindIdx === ACTIONS.length) {
          this.settings.bindings = [defaultBindings(0), defaultBindings(1)];
          this.devices.settings = this.settings;
          saveSettings(this.settings);
        } else this.go('title');
      }
      if (m.key === 'back' || m.key === 'pause') this.go('title');
    }
  }

  // ------------------------------------------------------------------ replay viewer

  private replayInput(menu: { key: MenuKey; player: number }[], raw: string[]): void {
    const rp = this.rp;
    if (!rp) return;
    const seek = (f: number) => {
      rp.seek(f);
      this.fx.clear();
      this.hud.reset();
    };
    for (const k of raw) {
      if (k === 'Space') this.rpPlaying = !this.rpPlaying;
      if (k === 'KeyB') this.rpBoxes = !this.rpBoxes;
      if (k === 'KeyV') this.rpHideHud = !this.rpHideHud;
      if (k === 'KeyR') seek(0);
      if (k === 'Comma') seek(rp.frame - 120);
      if (k === 'Period') seek(rp.frame + 120);
    }
    for (const m of menu) {
      if (m.key === 'pause' || m.key === 'back') this.go('title');
      if (m.key === 'confirm') this.rpPlaying = !this.rpPlaying;
      if (m.key === 'up') this.rpSpeed = Math.min(4, this.rpSpeed * 2);
      if (m.key === 'down') this.rpSpeed = Math.max(0.125, this.rpSpeed / 2);
      if (m.key === 'left') {
        this.rpPlaying = false;
        seek(rp.frame - 1);
      }
      if (m.key === 'right') {
        this.rpPlaying = false;
        const ev = rp.step();
        this.renderer.tick(rp.sim, this.chars, ev);
        this.hud.tick(rp.sim);
      }
    }
  }

  private advanceReplay(dt: number): void {
    const rp = this.rp;
    if (!rp || !this.rpPlaying) return;
    this.acc += dt * this.rpSpeed;
    let n = 0;
    while (this.acc >= STEP_MS && n < 20) {
      if (rp.frame >= rp.length) {
        this.rpPlaying = false;
        break;
      }
      const ev = rp.step();
      this.renderer.tick(rp.sim, this.chars, ev);
      this.hud.tick(rp.sim);
      this.sfx.handle(ev, rp.sim);
      this.acc -= STEP_MS;
      n++;
    }
    if (n === 20) this.acc = 0;
  }

  // ------------------------------------------------------------------ drawing

  private clear(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H);
    g.addColorStop(0, '#0d0b1e');
    g.addColorStop(1, '#2d1446');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private text(s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight = 700): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private drawTitle(): void {
    this.clear();
    const ctx = this.ctx;
    // animated slashes
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = ['#ff4d6d', '#4cc9f0', '#ffd60a', '#c77dff', '#f77f00', '#80ffdb'][i];
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 3;
      const o = ((this.time * (2 + i)) % 1600) - 300;
      ctx.beginPath();
      ctx.moveTo(o, 0);
      ctx.lineTo(o - 400, VIEW_H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.text('HUSTLE', 90, 190, 120, '#ffffff', 'left', 900);
    this.text('// REAL-TIME', 96, 240, 40, '#ff4d6d', 'left', 900);
    this.text(`${ROSTER.length} fighters · ${ROSTER.reduce((n, c) => n + moveList(c.id).length, 0)} moves`, 1180, 160, 18, '#9ad1ff', 'right', 800);
    this.text('A continuous-action fighting game: frame data, DI, bursts, cancels — no turns.', 96, 280, 18, '#bbb');
    const items = this.titleItems();
    items.forEach((it, i) => {
      const sel = i === this.optIdx;
      this.text(`${sel ? '▶ ' : '  '}${typeof it.label === 'function' ? it.label() : it.label}`, 110, 350 + i * 38, sel ? 28 : 24, sel ? '#ffd60a' : '#ddd', 'left', sel ? 900 : 600);
    });
    const h = items[this.optIdx]?.hint;
    if (h) this.text(h, 110, 350 + items.length * 38 - 4, 16, '#9ad1ff');
    this.text('P1: WASD move · J/K/L light/med/heavy · U special · I super · O throw · Space dash · H parry · Enter/Esc', 90, VIEW_H - 40, 15, '#888');
    this.text('P2: Arrows · Numpad 1-6 / 0 / . (or , . / M ; \' RShift N) · Gamepads supported', 90, VIEW_H - 18, 15, '#888');
    // roster preview
    ROSTER.forEach((c, i) => this.drawPortrait(c, 800 + (i % 3) * 160 + (i >= 3 ? 80 : 0), 420 + Math.floor(i / 3) * 210, 0.9, i === Math.floor(this.time / 120) % ROSTER.length));
  }

  private drawPortrait(c: CharacterDef, x: number, y: number, scale: number, highlight: boolean): void {
    const ctx = this.ctx;
    const sim = previewSim(c.id);
    const f = sim.state.fighters[0];
    f.x = 0;
    f.y = 0;
    f.facing = 1;
    const pose = computePose(sim, f, this.time);
    const j = buildJoints(f, c, pose);
    ctx.save();
    ctx.setTransform(scale, 0, 0, -scale, x, y);
    if (highlight) {
      ctx.fillStyle = c.palette.aura + '33';
      ctx.beginPath();
      ctx.arc(0, 80, 90, 0, Math.PI * 2);
      ctx.fill();
    }
    drawFighter(ctx, f, c, j, { primary: c.palette.primary, secondary: c.palette.secondary, accent: c.palette.accent, skin: c.palette.skin, outline: '#0b0a14', alpha: 1 }, this.time);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawSelect(): void {
    this.clear();
    const modeName = { cpu: 'VERSUS CPU', versus: 'VERSUS', training: 'TRAINING', watch: 'CPU vs CPU' }[this.mode];
    this.text(`${modeName} — CHARACTER SELECT`, VIEW_W / 2, 60, 34, '#fff', 'center', 900);
    const phaseText =
      this.selectPhase === 0
        ? 'P1: choose your fighter (Left/Right, confirm with J or Enter)'
        : this.selectPhase === 1
          ? this.mode === 'versus'
            ? 'P2: choose your fighter (Left/Right, confirm with Numpad1 / Comma)'
            : this.mode === 'training'
              ? 'Choose the training dummy'
              : 'Choose the opponent'
          : this.mode === 'cpu' || this.mode === 'watch'
            ? `CPU difficulty: ${DIFFICULTIES[this.settings.difficulty].name} (Up/Down) — confirm to start`
            : 'Confirm to start';
    this.text(phaseText, VIEW_W / 2, 96, 18, '#ffd60a', 'center');
    const n = ROSTER.length;
    for (let i = 0; i < n; i++) {
      const c = ROSTER[i];
      const x = 140 + i * 250;
      const y = 330;
      const ctx = this.ctx;
      const s0 = this.pick[0] === i;
      const s1 = this.pick[1] === i && this.selectPhase >= 1;
      ctx.fillStyle = '#1b1530';
      ctx.fillRect(x - 100, y - 200, 200, 230);
      if (s0 || s1) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = s0 && s1 ? '#ffd60a' : s0 ? '#4cc9f0' : '#ff4d6d';
        ctx.strokeRect(x - 100, y - 200, 200, 230);
      }
      this.drawPortrait(c, x, y, 1.1, s0 || s1);
      this.text(c.name.toUpperCase(), x, y + 60, 24, '#fff', 'center', 900);
      this.text(c.archetype, x, y + 84, 14, c.palette.aura, 'center');
    }
    for (const p of [0, 1] as const) {
      if (p === 1 && this.selectPhase < 1) continue;
      const c = ROSTER[this.pick[p]];
      const x = p === 0 ? 60 : VIEW_W / 2 + 30;
      const y = 470;
      this.text(`${p === 0 ? (this.mode === 'watch' ? 'CPU 1' : 'P1') : this.mode === 'versus' ? 'P2' : this.mode === 'training' ? 'DUMMY' : 'CPU'}: ${c.name} — ${c.title}`, x, y, 20, p === 0 ? '#4cc9f0' : '#ff4d6d', 'left', 900);
      wrap(c.blurb, 70).forEach((l, i) => this.text(l, x, y + 26 + i * 20, 15, '#ddd'));
      const res = c.resources.map((r) => r.label).join(', ') || 'none';
      this.text(`HP ${c.maxHp} · walk ${c.walkSpeed} · air options ${c.maxAirOptions}${c.flight ? ' + jet flight' : ''}${c.wallJump ? ' + wall jump' : ''} · resources: ${res}`, x, y + 90, 14, '#9ad1ff');
      this.text(`${moveList(c.id).length} moves — see Move List for frame data`, x, y + 112, 14, '#888');
    }
  }

  private drawMatch(): void {
    const sim = this.sim;
    if (!sim) return;
    this.renderer.draw(sim, this.chars, this.time);
    const t = this.training;
    const training = this.mode === 'training';
    const boxes = training ? t.boxes : this.showBoxes;
    drawDebug(this.ctx, sim, this.renderer.camera, this.chars, {
      boxes,
      frameData: training && t.frameData,
      di: training && t.diDisplay,
      inputs: (training && t.inputs) || this.settings.showInputs,
    });
    this.hud.draw(this.ctx, sim, this.chars, this.labels);
    this.renderer.drawOverlay();
    if (training) {
      this.text('Esc: training menu · 1-3: reset (center/L/R corner) · 4: swap sides · 5: record dummy · 6: playback · Tab: hitboxes · 0: frame data', VIEW_W / 2, VIEW_H - 8, 13, '#aaa', 'center');
      if (this.dummyRecording) this.text('● REC', VIEW_W / 2, 120, 22, '#ff4d6d', 'center', 900);
    }
    if (this.paused) this.drawPause();
    if (sim.state.round.phase === 'over' && this.overFrames > 90) this.drawResults();
  }

  private drawPause(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(5,4,15,0.82)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const items = this.pauseItems();
    this.text(this.mode === 'training' ? 'TRAINING MENU' : 'PAUSED', VIEW_W / 2, 70, 36, '#fff', 'center', 900);
    const top = Math.max(0, this.pauseIdx - 12);
    items.slice(top, top + 24).forEach((it, k) => {
      const i = k + top;
      const sel = i === this.pauseIdx;
      const lab = typeof it.label === 'function' ? it.label() : it.label;
      this.text(`${sel ? '▶ ' : ''}${lab}`, VIEW_W / 2, 115 + k * 24, sel ? 20 : 17, sel ? '#ffd60a' : '#ddd', 'center', sel ? 900 : 600);
    });
    this.text('Up/Down select · Left/Right change · Enter confirm · Esc resume', VIEW_W / 2, VIEW_H - 16, 14, '#888', 'center');
  }

  private drawResults(): void {
    const sim = this.sim!;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5,4,15,0.7)';
    ctx.fillRect(0, 380, VIEW_W, 300);
    const st = sim.state.fighters.map((f) => f.stats);
    this.text(`Hits ${st[0].hitsLanded} / ${st[1].hitsLanded}   Damage ${st[0].damageDealt} / ${st[1].damageDealt}   Supers ${st[0].supers} / ${st[1].supers}   Bursts ${st[0].bursts} / ${st[1].bursts}   Parries ${st[0].parries} / ${st[1].parries}`, VIEW_W / 2, 420, 16, '#bbb', 'center');
    this.resultsItems().forEach((it, i) => {
      const sel = i === this.resultsIdx;
      this.text(`${sel ? '▶ ' : ''}${it.label as string}`, VIEW_W / 2, 470 + i * 36, sel ? 26 : 22, sel ? '#ffd60a' : '#ddd', 'center', 900);
    });
  }

  private drawMenuScreen(title: string, items: MenuItem[], footer: string): void {
    this.clear();
    this.text(title, 80, 80, 40, '#fff', 'left', 900);
    const top = Math.max(0, this.optIdx - 14);
    items.slice(top, top + 22).forEach((it, k) => {
      const i = k + top;
      const sel = i === this.optIdx;
      this.text(`${sel ? '▶ ' : '  '}${typeof it.label === 'function' ? it.label() : it.label}`, 90, 130 + k * 26, sel ? 20 : 17, sel ? '#ffd60a' : '#ddd', 'left', sel ? 900 : 600);
    });
    this.text(footer, 80, VIEW_H - 24, 14, '#888');
  }

  private drawAura(): void {
    const items = this.auraItems();
    this.drawMenuScreen('AURA EDITOR', items, 'Auras attach to body regions and fire from gameplay events. Changes save automatically.');
    // live preview: a fighter cycling through relevant states
    const c = ROSTER[this.auraChar];
    const sim = previewSim(c.id);
    const f = sim.state.fighters[0];
    const ctx = this.ctx;
    f.x = 0;
    f.y = 0;
    f.facing = 1;
    // force every trigger on for the preview
    const preview = { ...f, install: { frames: 100, drain: 0 }, stance: c.id === 'vesper' ? 'draw' : null, flying: c.id === 'bastion', hp: 1, resources: { ...f.resources, heat: 100 } } as typeof f;
    const pose = computePose(sim, f, this.time);
    const j = buildJoints(f, c, pose);
    const fx = this.previewFx ?? (this.previewFx = new Effects(this.settings.fx));
    fx.settings = this.settings.fx;
    const auras = this.settings.fx.auras[c.id] ?? [];
    const saved = auras.map((a) => a.trigger);
    for (const a of auras) a.trigger = 'always';
    fx.tickFighter(preview, j, c, sim);
    auras.forEach((a, i) => (a.trigger = saved[i]));
    fx.update();
    ctx.save();
    ctx.setTransform(1.6, 0, 0, -1.6, 960, 520);
    fx.drawWorld(ctx);
    drawFighter(ctx, f, c, j, { primary: c.palette.primary, secondary: c.palette.secondary, accent: c.palette.accent, skin: c.palette.skin, outline: '#0b0a14', alpha: 1 }, this.time);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.text('Preview (all triggers forced on)', 960, 600, 14, '#888', 'center');
  }
  private previewFx: Effects | null = null;

  private drawMoveList(): void {
    this.clear();
    const c = ROSTER[this.mlChar];
    const rows = moveList(c.id);
    this.text(`◀ ${c.name.toUpperCase()} ▶`, 60, 56, 34, c.palette.aura, 'left', 900);
    this.text(`${c.title} — ${c.archetype} · HP ${c.maxHp} · ${rows.length} moves`, 60, 82, 16, '#bbb');
    const cols = [60, 270, 400, 520, 580, 650, 760];
    const head = ['Move', 'Input', 'Start/Act/Rec', 'Dmg', 'Guard', 'Cost', 'Properties / description'];
    head.forEach((h, i) => this.text(h, cols[i], 112, 13, '#ffd60a', 'left', 900));
    const perPage = 14;
    this.mlScroll = Math.min(this.mlScroll, Math.max(0, rows.length - perPage));
    rows.slice(this.mlScroll, this.mlScroll + perPage).forEach((r, k) => {
      const y = 138 + k * 38;
      const kindColor = r.kind === 'super' ? '#ff4d6d' : r.kind === 'special' ? '#4cc9f0' : r.kind === 'throw' ? '#80ffdb' : '#ddd';
      this.text(r.name, cols[0], y, 15, kindColor, 'left', 800);
      this.text(r.input, cols[1], y, 13, '#fff', 'left', 600);
      this.text(r.startup || r.active ? `${r.startup}/${r.active}/${r.recovery}` : `${r.total}f`, cols[2], y, 13, '#ddd');
      this.text(r.damage ? String(r.damage) : '—', cols[3], y, 13, '#ddd');
      this.text(r.guard, cols[4], y, 13, '#ddd');
      this.text(r.cost, cols[5], y, 12, '#e9c46a');
      this.text(r.props || '', cols[6], y, 12, '#9ad1ff');
      this.text(r.desc.length > 92 ? r.desc.slice(0, 90) + '…' : r.desc, cols[6], y + 15, 11, '#aaa');
    });
    this.text(`Up/Down scroll (${this.mlScroll + 1}-${Math.min(rows.length, this.mlScroll + perPage)} of ${rows.length}) · Left/Right character · Esc back`, 60, 690, 13, '#888');
    UNIVERSAL_HELP.slice(0, 1).forEach((l) => this.text(l, 60, 710, 12, '#666'));
  }

  private drawControls(): void {
    this.clear();
    this.text('CONTROLS', 80, 70, 40, '#fff', 'left', 900);
    this.text('Up/Down select · Left/Right switch player · Enter to rebind (then press a key) · Esc back', 80, 100, 15, '#888');
    for (const p of [0, 1] as const) {
      const x = 120 + p * 520;
      this.text(p === 0 ? 'PLAYER 1' : 'PLAYER 2', x, 140, 22, p === this.bindPlayer ? '#ffd60a' : '#aaa', 'left', 900);
      ACTIONS.forEach((a: Action, i) => {
        const sel = this.bindIdx === i && this.bindPlayer === p;
        const keys = this.settings.bindings[p][a].join(' / ') || '(unbound)';
        this.text(`${ACTION_LABEL[a]}`, x, 175 + i * 30, 16, sel ? '#ffd60a' : '#ddd', 'left', sel ? 900 : 600);
        this.text(sel && this.waitingBind ? 'press a key…' : keys, x + 240, 175 + i * 30, 16, sel ? '#ffd60a' : '#9ad1ff');
      });
    }
    const y = 175 + ACTIONS.length * 30 + 20;
    this.text(`${this.bindIdx === ACTIONS.length ? '▶ ' : ''}Reset to defaults`, 120, y, 18, this.bindIdx === ACTIONS.length ? '#ffd60a' : '#ddd');
    this.text(`${this.bindIdx === ACTIONS.length + 1 ? '▶ ' : ''}Back`, 120, y + 28, 18, this.bindIdx === ACTIONS.length + 1 ? '#ffd60a' : '#ddd');
    this.text('Gamepad: stick/d-pad move · A light · X medium · Y heavy · B special · RB super · LB throw · RT dash · LT parry · Start pause', 80, VIEW_H - 50, 14, '#888');
    UNIVERSAL_HELP.slice(1, 3).forEach((l, i) => this.text(l, 80, VIEW_H - 30 + i * 16, 12, '#666'));
  }

  private drawReplay(): void {
    const rp = this.rp;
    if (!rp) return;
    const sim = rp.sim;
    this.renderer.draw(sim, this.chars, this.time);
    drawDebug(this.ctx, sim, this.renderer.camera, this.chars, { boxes: this.rpBoxes, frameData: this.rpBoxes, di: this.rpBoxes, inputs: this.rpBoxes });
    if (!this.rpHideHud) this.hud.draw(this.ctx, sim, this.chars, this.labels);
    this.renderer.drawOverlay();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, VIEW_H - 34, VIEW_W, 34);
    const p = rp.frame / Math.max(1, rp.length);
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(0, VIEW_H - 34, VIEW_W * p, 3);
    this.text(
      `REPLAY ${this.rpPlaying ? '▶' : '❚❚'}  frame ${rp.frame}/${rp.length}  speed ${this.rpSpeed}x   ·  Enter/Space play-pause · Left/Right frame step · Up/Down speed · , . rewind/forward 2s · R restart · B debug overlays · V hide HUD · Esc exit`,
      12,
      VIEW_H - 12,
      13,
      '#ddd',
    );
  }
}

const previews = new Map<string, Sim>();
function previewSim(id: string): Sim {
  let s = previews.get(id);
  if (!s) {
    s = new Sim({ chars: [id, id], settings: { training: true } });
    previews.set(id, s);
  }
  return s;
}

function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if ((line + ' ' + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

function hueShift(hex: string, deg: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * (s || 0.8);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}


// Application shell: menus, match flow, training mode, replay viewer, options and bindings.
// The match loop runs the simulation at a fixed 60 Hz regardless of display refresh rate.
// All UI is drawn with the built-in pixel font and pixel-art kit and supports keyboard,
// gamepad and mouse (hover, click, wheel).

import { ROSTER } from '../characters';
import { FPS } from '../combat/config';
import { frameData } from '../combat/registry';
import { Sim, defaultSettings, type SimSettings } from '../combat/sim';
import type { CharacterDef, CombatEvent } from '../combat/types';
import { IN } from '../core/input';
import { STEP_MS, takeSteps, type Accumulator } from '../core/loop';
import { AIController, DIFFICULTIES } from '../ai/ai';
import { Sfx } from '../audio/sfx';
import { Effects, defaultFxSettings, type AuraConfig, type SparkStyle } from '../render/effects';
import { Hud, drawDebug } from '../render/hud';
import { computePose } from '../render/poses';
import { fighterSprite, previewSim } from '../render/portrait';
import { PX, Renderer, VIEW_H, VIEW_W, pixelate } from '../render/renderer';
import { buildJoints, drawFighter } from '../render/skeleton';
import { THEME, Pointer, bar, menuRow, panel, text, textWidth, wipe } from '../ui/kit';
import { wrapPixel } from '../ui/pixelfont';
import { Devices, type MenuKey } from './devices';
import { UNIVERSAL_HELP, moveList, type MoveRow } from './movelist';
import { ReplayPlayer, ReplayRecorder, loadReplays, saveReplay, type ReplayData } from './replay';
import { ACTIONS, ACTION_LABEL, defaultBindings, loadSettings, saveSettings, type Settings } from './settings';
import { TrainingDummy, defaultTraining, type TrainingConfig } from './training';

type Screen = 'title' | 'select' | 'versus' | 'match' | 'movelist' | 'options' | 'aura' | 'controls' | 'replays' | 'replay';
type Mode = 'cpu' | 'versus' | 'training' | 'watch';
type MenuEv = { key: MenuKey; player: number };

interface MenuItem {
  label: string;
  value?: () => string;
  /** 0..1 slider shown next to the value. */
  slider?: () => number;
  action?: () => void;
  left?: () => void;
  right?: () => void;
  hint?: string;
  header?: boolean;
  color?: string;
}

/** Designer ratings shown on the character select screen (1-5). */
const STATS: Record<string, [number, number, number, number, number, number]> = {
  vesper: [4, 3, 5, 3, 2, 4],
  mirage: [2, 5, 3, 5, 2, 5],
  solenne: [3, 2, 5, 3, 3, 4],
  bastion: [5, 1, 4, 3, 5, 3],
  riot: [4, 5, 1, 4, 3, 2],
};
const STAT_NAMES = ['POWER', 'SPEED', 'RANGE', 'MOBILITY', 'DEFENSE', 'DIFFICULTY'];

const KEY_NAMES: Record<string, string> = {
  Space: 'SPACE',
  ArrowUp: '▲',
  ArrowDown: '▼',
  ArrowLeft: '◀',
  ArrowRight: '▶',
  ShiftLeft: 'LSHIFT',
  ShiftRight: 'RSHIFT',
  ControlLeft: 'LCTRL',
  ControlRight: 'RCTRL',
  AltLeft: 'LALT',
  AltRight: 'RALT',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Enter: 'ENTER',
  Tab: 'TAB',
  NumpadDecimal: 'NUM .',
  NumpadEnter: 'NUM ENT',
  NumpadAdd: 'NUM +',
  NumpadSubtract: 'NUM -',
  NumpadMultiply: 'NUM *',
  NumpadDivide: 'NUM /',
};

export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase().slice(0, 7);
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
  ptr: Pointer;
  sfx = new Sfx();
  fx: Effects;
  renderer: Renderer;
  hud = new Hud();

  screen: Screen = 'title';
  mode: Mode = 'cpu';
  /** Selected row for list screens (title, options, aura, replays). */
  optIdx = 0;
  // select
  pick: [number, number] = [0, 1];
  selectPhase = 0;
  vsTimer = 0;
  // match
  sim: Sim | null = null;
  chars: CharacterDef[] = [];
  labels: [string, string] = ['P1', 'P2'];
  ais: [AIController | null, AIController | null] = [null, null];
  recorder: ReplayRecorder | null = null;
  lastReplay: ReplayData | null = null;
  paused = false;
  pauseIdx = 0;
  /** Panel shown on top of the pause menu. */
  overlay: 'controls' | null = null;
  overFrames = 0;
  resultsIdx = 0;
  loop: Accumulator = { acc: 0 };
  lastTs = 0;
  time = 0;
  showBoxes = false;
  training: TrainingConfig = defaultTraining();
  dummy = new TrainingDummy(this.training);
  dummyRecording = false;
  // move list
  mlChar = 0;
  mlSel = 0;
  mlReturn: Screen = 'title';
  // aura
  auraChar = 0;
  private previewFx: Effects | null = null;
  // controls
  ctlRow = 0;
  ctlCol = 0;
  waitingBind = false;
  ctlNotice = '';
  ctlNoticeLife = 0;
  ctlReturn: 'title' | 'pause' = 'title';
  // replays
  replayList: ReplayData[] = [];
  rp: ReplayPlayer | null = null;
  rpPlaying = true;
  rpSpeed = 1;
  rpHideHud = false;
  rpBoxes = false;
  // title attract demo
  private demo: { sim: Sim; ais: [AIController, AIController]; chars: CharacterDef[]; loop: Accumulator } | null = null;
  private trans = 0;
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
    this.ptr = new Pointer(canvas, VIEW_W, VIEW_H);
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
    this.ptr.dispatch();
    this.ptr.beginFrame();
    this.spsTimer += dt;
    if (this.spsTimer >= 1000) {
      this.sps = this.stepsThisSecond;
      this.stepsThisSecond = 0;
      this.spsTimer -= 1000;
    }
    if (this.ctlNoticeLife > 0) this.ctlNoticeLife--;

    switch (this.screen) {
      case 'title':
        this.listInput(menu, this.titleItems(), (i) => (this.optIdx = i), () => this.optIdx);
        this.advanceDemo(dt);
        this.drawTitle();
        break;
      case 'select':
        this.selectInput(menu);
        this.drawSelect();
        break;
      case 'versus':
        if (menu.some((m) => m.key === 'confirm')) this.vsTimer = Math.max(this.vsTimer, 70);
        if (++this.vsTimer >= 80) this.startMatch(this.mode, ROSTER[this.pick[0]].id, ROSTER[this.pick[1]].id);
        else this.drawVersus();
        break;
      case 'match':
        {
          const wasPaused = this.paused;
          this.matchInput(menu, raw);
          if (wasPaused && !this.paused) this.devices.muteHeld();
        }
        if (!this.paused) this.advance(dt);
        else this.devices.endStep(); // taps made in menus must not leak into the fight
        this.drawMatch();
        break;
      case 'movelist':
        this.movelistInput(menu);
        this.drawMoveList();
        break;
      case 'options':
        this.listInput(menu, this.optionItems(), (i) => (this.optIdx = i), () => this.optIdx, () => this.go('title'));
        this.drawListScreen('OPTIONS', this.optionItems(), 'LEFT/RIGHT CHANGE · ENTER SELECT · ESC BACK');
        break;
      case 'aura':
        this.listInput(menu, this.auraItems(), (i) => (this.optIdx = i), () => this.optIdx, () => this.go('options'));
        this.drawAura();
        break;
      case 'controls':
        this.controlsInput(menu, raw);
        this.drawBackdrop();
        this.drawControlsPanel();
        break;
      case 'replays':
        this.listInput(menu, this.replayItems(), (i) => (this.optIdx = i), () => this.optIdx, () => this.go('title'));
        this.drawListScreen('REPLAYS', this.replayItems(), 'REPLAYS ARE INPUT RECORDINGS · LAST 8 KEPT IN THIS BROWSER');
        break;
      case 'replay':
        this.replayInput(menu, raw);
        this.advanceReplay(dt);
        this.drawReplay();
        break;
    }
    if (this.trans > 0) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      wipe(this.ctx, VIEW_W, VIEW_H, this.trans);
      this.trans = Math.max(0, this.trans - 0.07);
    }
  }

  private go(s: Screen): void {
    if (s !== this.screen) this.trans = 1;
    if (s === 'title') {
      this.renderer.resetAnims();
      this.fx.clear();
    }
    this.screen = s;
    this.optIdx = 0;
  }

  private advance(dt: number): void {
    if (!this.sim) return;
    const n = takeSteps(this.loop, dt);
    for (let i = 0; i < n; i++) this.stepMatch();
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

  /** Background CPU-vs-CPU fight on the title screen. */
  private advanceDemo(dt: number): void {
    if (!this.demo || this.demo.sim.state.round.phase === 'over' || this.demo.sim.state.frame > 60 * 45) {
      const a = ROSTER[Math.floor(Math.random() * ROSTER.length)];
      const b = ROSTER[Math.floor(Math.random() * ROSTER.length)];
      const seed = Math.floor(Math.random() * 1e6) + 1;
      this.demo = {
        sim: new Sim({ chars: [a.id, b.id], seed, settings: { training: false } }),
        ais: [new AIController(DIFFICULTIES[2], seed + 1), new AIController(DIFFICULTIES[2], seed + 2)],
        chars: [a, b],
        loop: { acc: 0 },
      };
      this.renderer.resetAnims();
      this.fx.clear();
    }
    const d = this.demo;
    const n = takeSteps(d.loop, dt);
    for (let i = 0; i < n; i++) {
      const ev = d.sim.step([d.ais[0].update(d.sim, 0), d.ais[1].update(d.sim, 1)]);
      this.renderer.tick(d.sim, d.chars, ev);
    }
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
    this.overlay = null;
    this.loop.acc = 0;
    this.devices.muteHeld();
    this.fx.clear();
    this.renderer.resetAnims();
    this.hud.reset();
    this.dummyRecording = false;
    if (mode === 'training') this.dummy.apply(this.sim, 1);
    if (this.screen !== 'match') this.trans = 1;
    this.screen = 'match';
  }

  private rematch(): void {
    if (!this.sim) return;
    this.startMatch(this.mode, this.sim.charIds[0], this.sim.charIds[1]);
  }

  // ------------------------------------------------------------------ generic list input

  private selectable(items: MenuItem[], i: number, d: number): number {
    const n = items.length;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!items[i].header) return i;
    }
    return i;
  }

  private listInput(menu: MenuEv[], items: MenuItem[], set: (i: number) => void, get: () => number, back?: () => void): void {
    let i = Math.min(get(), items.length - 1);
    if (items[i]?.header) i = this.selectable(items, i, 1);
    for (const m of menu) {
      if (m.key === 'up') i = this.selectable(items, i, -1);
      else if (m.key === 'down') i = this.selectable(items, i, 1);
      else if (m.key === 'left') items[i]?.left?.();
      else if (m.key === 'right') items[i]?.right?.();
      else if (m.key === 'confirm') (items[i]?.action ?? items[i]?.right)?.();
      else if ((m.key === 'back' || m.key === 'pause') && back) back();
    }
    set(i);
  }

  /** Draws a scrolling list of menu rows and registers mouse regions. */
  private drawList(items: MenuItem[], x: number, y: number, w: number, sel: number, setSel: (i: number) => void, rows: number, scale = 2): void {
    const ctx = this.ctx;
    const rowH = 7 * scale + 14;
    const top = Math.max(0, Math.min(sel - Math.floor(rows / 2), items.length - rows));
    const vis = items.slice(top, top + rows);
    vis.forEach((it, k) => {
      const i = top + k;
      const ry = y + k * rowH;
      if (it.header) {
        text(ctx, it.label, x + 8, ry + 10, { scale, color: THEME.faint });
        ctx.fillStyle = THEME.edge;
        ctx.fillRect(x + 16 + textWidth(it.label, scale), ry + 10 + 3 * scale, w - textWidth(it.label, scale) - 30, 2);
        return;
      }
      const selected = i === sel;
      const value = it.value?.();
      const sliderW = it.slider ? 120 : 0;
      menuRow(ctx, this.ptr, x, ry, w - sliderW - (it.slider ? 12 : 0), it.label, selected, {
        value,
        scale,
        time: this.time,
        color: it.color,
        onHover: () => setSel(i),
        onClick: it.action ?? it.right,
        onLeft: it.left,
        onRight: it.right,
      });
      if (it.slider) {
        const sx = x + w - sliderW - 8;
        bar(ctx, sx, ry + 9, sliderW, 10, it.slider(), selected ? THEME.gold : THEME.cyan, { segments: 10 });
        this.ptr.add({
          x: sx,
          y: ry,
          w: sliderW,
          h: rowH,
          hover: () => setSel(i),
          click: () => {
            const frac = (this.ptr.x - sx) / sliderW;
            const cur = it.slider!();
            const steps = Math.round(Math.abs(frac - cur) * 10);
            for (let s = 0; s < Math.max(1, steps); s++) (frac > cur ? it.right : it.left)?.();
          },
        });
      }
    });
    if (top > 0) text(ctx, '▲', x + w / 2, y - 16, { scale: 2, color: THEME.dim, align: 'center' });
    if (top + rows < items.length) text(ctx, '▼', x + w / 2, y + rows * rowH + 2, { scale: 2, color: THEME.dim, align: 'center' });
    this.ptr.add({
      x,
      y,
      w,
      h: rows * rowH,
      wheel: (d) => setSel(this.selectable(items, sel, d > 0 ? 1 : -1)),
    });
  }

  // ------------------------------------------------------------------ menus

  private titleItems(): MenuItem[] {
    const sel = (mode: Mode) => () => {
      this.mode = mode;
      this.selectPhase = 0;
      this.go('select');
    };
    return [
      { label: 'VERSUS CPU', action: sel('cpu'), hint: 'Fight the computer. Choose its difficulty after picking fighters.' },
      { label: 'VERSUS PLAYER', action: sel('versus'), hint: 'Two players on one keyboard and/or gamepads.' },
      { label: 'TRAINING', action: sel('training'), hint: 'Sandbox: dummy settings, hitboxes, frame data, DI display, recording.' },
      { label: 'CPU VS CPU', action: sel('watch'), hint: 'Watch two AIs fight.' },
      {
        label: 'REPLAYS',
        action: () => {
          this.replayList = loadReplays();
          if (this.lastReplay && !this.replayList.some((r) => r.date === this.lastReplay!.date)) this.replayList.unshift(this.lastReplay);
          this.go('replays');
        },
        hint: 'Watch recorded matches with pause, rewind, speed and frame stepping.',
      },
      {
        label: 'MOVE LIST',
        action: () => {
          this.mlReturn = 'title';
          this.mlSel = 0;
          this.go('movelist');
        },
        hint: 'Every move with real frame data, damage, cost and properties.',
      },
      { label: 'OPTIONS', action: () => this.go('options'), hint: 'Audio, visual effects, aura customisation, CPU difficulty.' },
      {
        label: 'CONTROLS',
        action: () => {
          this.ctlReturn = 'title';
          this.ctlRow = 0;
          this.ctlCol = 0;
          this.go('controls');
        },
        hint: 'View and remap keys for both players.',
      },
    ];
  }

  private optionItems(): MenuItem[] {
    const s = this.settings;
    const fx = s.fx;
    const save = () => {
      saveSettings(s);
      this.sfx.setVolume(s.volume);
    };
    const num = (label: string, get: () => number, set: (v: number) => void, step: number, lo: number, hi: number): MenuItem => ({
      label,
      value: () => `${Math.round(get() * 100)}%`,
      slider: () => (get() - lo) / (hi - lo),
      left: () => {
        set(Math.max(lo, Math.round((get() - step) * 100) / 100));
        save();
      },
      right: () => {
        set(Math.min(hi, Math.round((get() + step) * 100) / 100));
        save();
      },
    });
    const bool = (label: string, get: () => boolean, set: (v: boolean) => void): MenuItem => {
      const flip = () => {
        set(!get());
        save();
      };
      return { label, value: () => (get() ? 'ON' : 'OFF'), action: flip, left: flip, right: flip };
    };
    const styles: SparkStyle[] = ['classic', 'star', 'slash', 'ring', 'pixel'];
    return [
      { label: 'GAME', header: true },
      num('VOLUME', () => s.volume, (v) => (s.volume = v), 0.1, 0, 1),
      { label: 'CPU DIFFICULTY', value: () => DIFFICULTIES[s.difficulty].name.toUpperCase(), left: () => ((s.difficulty = Math.max(0, s.difficulty - 1)), save()), right: () => ((s.difficulty = Math.min(DIFFICULTIES.length - 1, s.difficulty + 1)), save()) },
      bool('INPUT DISPLAY (VERSUS)', () => s.showInputs, (v) => (s.showInputs = v)),
      { label: 'VISUAL EFFECTS', header: true },
      num('PARTICLE DENSITY', () => fx.particleDensity, (v) => (fx.particleDensity = v), 0.25, 0, 2),
      num('SCREEN SHAKE', () => fx.shake, (v) => (fx.shake = v), 0.25, 0, 1.5),
      num('FLASH INTENSITY', () => fx.flashes, (v) => (fx.flashes = v), 0.25, 0, 1),
      bool('CAMERA ZOOM PUNCHES', () => fx.zoom, (v) => (fx.zoom = v)),
      { label: 'HIT SPARK STYLE', value: () => fx.sparkStyle.toUpperCase(), left: () => ((fx.sparkStyle = cycle(styles, fx.sparkStyle, -1)), save()), right: () => ((fx.sparkStyle = cycle(styles, fx.sparkStyle, 1)), save()) },
      num('HIT SPARK SIZE', () => fx.sparkScale, (v) => (fx.sparkScale = v), 0.25, 0.25, 2.5),
      bool('AFTERIMAGES', () => fx.afterimages, (v) => (fx.afterimages = v)),
      bool('SPEED LINES', () => fx.speedLines, (v) => (fx.speedLines = v)),
      { label: 'AURA EDITOR', value: () => '▶', action: () => this.go('aura') },
      {
        label: 'REDUCE INTENSE EFFECTS',
        value: () => 'PRESET',
        action: () => {
          fx.particleDensity = 0.5;
          fx.shake = 0.25;
          fx.flashes = 0.15;
          fx.zoom = false;
          save();
        },
      },
      {
        label: 'RESET VISUAL SETTINGS',
        value: () => 'RESET',
        action: () => {
          Object.assign(fx, defaultFxSettings());
          save();
        },
      },
      { label: 'BACK', action: () => this.go('title') },
    ];
  }

  private auraItems(): MenuItem[] {
    const c = ROSTER[this.auraChar];
    const list = this.settings.fx.auras[c.id] ?? [];
    const save = () => saveSettings(this.settings);
    const items: MenuItem[] = [
      { label: 'CHARACTER', value: () => c.name.toUpperCase(), left: () => (this.auraChar = (this.auraChar + ROSTER.length - 1) % ROSTER.length), right: () => (this.auraChar = (this.auraChar + 1) % ROSTER.length) },
    ];
    const regions = ['core', 'hands', 'feet', 'head', 'weapon', 'back'] as const;
    const triggers = ['always', 'dash', 'charge', 'install', 'super', 'lowHp', 'flight', 'stance', 'air', 'heat', 'attack'] as const;
    const shapes = ['flame', 'spark', 'orb', 'smoke'] as const;
    for (const a of list) {
      const n = (label: string, key: 'size' | 'rate' | 'lifetime' | 'speed', step: number, lo: number, hi: number): MenuItem => ({
        label: `  ${label}`,
        value: () => a[key].toFixed(1),
        slider: () => (a[key] - lo) / (hi - lo),
        left: () => ((a[key] = Math.max(lo, +(a[key] - step).toFixed(2))), save()),
        right: () => ((a[key] = Math.min(hi, +(a[key] + step).toFixed(2))), save()),
      });
      const flip = () => ((a.enabled = !a.enabled), save());
      items.push(
        { label: a.label.toUpperCase(), header: true },
        { label: '  ENABLED', value: () => (a.enabled ? 'ON' : 'OFF'), action: flip, left: flip, right: flip },
        { label: '  COLOR', value: () => a.color.toUpperCase(), color: a.color, left: () => ((a.color = hueShift(a.color, -15)), save()), right: () => ((a.color = hueShift(a.color, 15)), save()) },
        n('SIZE', 'size', 0.5, 0.5, 30),
        n('SPAWN RATE', 'rate', 0.1, 0, 8),
        n('LIFETIME', 'lifetime', 2, 4, 90),
        n('SPEED', 'speed', 0.2, 0, 6),
        { label: '  REGION', value: () => a.region.toUpperCase(), left: () => ((a.region = cycle(regions, a.region, -1)), save()), right: () => ((a.region = cycle(regions, a.region, 1)), save()) },
        { label: '  TRIGGER', value: () => a.trigger.toUpperCase(), left: () => ((a.trigger = cycle(triggers, a.trigger, -1) as AuraConfig['trigger']), save()), right: () => ((a.trigger = cycle(triggers, a.trigger, 1) as AuraConfig['trigger']), save()) },
        { label: '  SHAPE', value: () => a.shape.toUpperCase(), left: () => ((a.shape = cycle(shapes, a.shape, -1)), save()), right: () => ((a.shape = cycle(shapes, a.shape, 1)), save()) },
      );
    }
    items.push({ label: 'BACK', action: () => this.go('options') });
    return items;
  }

  private replayItems(): MenuItem[] {
    const name = (id: string) => ROSTER.find((c) => c.id === id)?.name.toUpperCase() ?? id;
    const items: MenuItem[] = this.replayList.map((r) => ({
      label: `${name(r.chars[0])} VS ${name(r.chars[1])}`,
      value: () => `${r.date.slice(5, 16).replace('T', ' ')} · ${Math.round(r.inputs.length / FPS)}S`,
      action: () => this.openReplay(r),
    }));
    if (!items.length) items.push({ label: 'NO REPLAYS YET - FINISH A MATCH TO RECORD ONE', color: THEME.dim });
    items.push({ label: 'BACK', action: () => this.go('title') });
    return items;
  }

  openReplay(r: ReplayData): void {
    this.rp = new ReplayPlayer(r);
    this.chars = [ROSTER.find((c) => c.id === r.chars[0])!, ROSTER.find((c) => c.id === r.chars[1])!];
    this.labels = r.labels;
    this.rpPlaying = true;
    this.rpSpeed = 1;
    this.loop.acc = 0;
    this.fx.clear();
    this.renderer.resetAnims();
    this.hud.reset();
    this.trans = 1;
    this.screen = 'replay';
  }

  // ------------------------------------------------------------------ select

  private selectInput(menu: MenuEv[]): void {
    const n = ROSTER.length;
    for (const m of menu) {
      let who = this.selectPhase === 0 ? 0 : 1;
      if (this.mode === 'versus' && this.selectPhase < 2) {
        if (m.player !== who && m.key !== 'pause') continue;
      }
      if (this.selectPhase >= 2) who = 0;
      if (m.key === 'left' && this.selectPhase < 2) this.pick[who] = (this.pick[who] + n - 1) % n;
      else if (m.key === 'right' && this.selectPhase < 2) this.pick[who] = (this.pick[who] + 1) % n;
      else if ((m.key === 'up' || m.key === 'right') && this.selectPhase === 2 && this.hasCpu()) this.settings.difficulty = Math.min(DIFFICULTIES.length - 1, this.settings.difficulty + 1);
      else if ((m.key === 'down' || m.key === 'left') && this.selectPhase === 2 && this.hasCpu()) this.settings.difficulty = Math.max(0, this.settings.difficulty - 1);
      else if (m.key === 'confirm') this.selectConfirm();
      else if (m.key === 'back' || m.key === 'pause') {
        if (this.selectPhase > 0) this.selectPhase--;
        else this.go('title');
      }
    }
  }

  private hasCpu(): boolean {
    return this.mode === 'cpu' || this.mode === 'watch';
  }

  private selectConfirm(): void {
    if (this.selectPhase < 2) {
      this.selectPhase++;
      return;
    }
    saveSettings(this.settings);
    this.vsTimer = 0;
    this.trans = 1;
    this.screen = 'versus';
  }

  // ------------------------------------------------------------------ match input

  private pauseItems(): MenuItem[] {
    const t = this.training;
    const items: MenuItem[] = [{ label: 'RESUME', action: () => (this.paused = false) }];
    if (this.mode === 'training') {
      const c = <T,>(label: string, arr: readonly T[], get: () => T, set: (v: T) => void): MenuItem => ({
        label,
        value: () => String(get()).toUpperCase(),
        left: () => set(cycle(arr, get(), -1)),
        right: () => set(cycle(arr, get(), 1)),
        action: () => set(cycle(arr, get(), 1)),
      });
      const b = (label: string, k: keyof TrainingConfig): MenuItem => ({ ...c(label, [true, false], () => t[k] as boolean, (v) => ((t as any)[k] = v)), value: () => (t[k] ? 'ON' : 'OFF') });
      items.push(
        { label: 'DUMMY', header: true },
        c('BEHAVIOUR', ['stand', 'crouch', 'jump', 'cpu', 'playback'] as const, () => t.dummy as any, (v) => (t.dummy = v)),
        c('BLOCK', ['none', 'all', 'random'] as const, () => t.block, (v) => (t.block = v)),
        c('DI', ['none', 'away', 'toward', 'up', 'down', 'random'] as const, () => t.di, (v) => (t.di = v)),
        c('TECH', ['none', 'neutral', 'back', 'forward', 'random'] as const, () => t.tech, (v) => (t.tech = v)),
        c('BURST', ['never', 'after3', 'after6'] as const, () => t.burst, (v) => (t.burst = v)),
        c('REVERSAL', ['none', 'parry', 'jump', 'backdash'] as const, () => t.reversal, (v) => (t.reversal = v)),
        b('THROW TECH', 'throwTech'),
        { label: 'RESOURCES', header: true },
        b('INFINITE HEALTH', 'infiniteHp'),
        b('INFINITE METER', 'infiniteMeter'),
        b('INFINITE BURST', 'infiniteBurst'),
        b('INFINITE RESOURCES', 'infiniteResources'),
        { label: 'DISPLAY', header: true },
        b('HITBOXES', 'boxes'),
        b('FRAME DATA PANEL', 'frameData'),
        b('DI DISPLAY', 'diDisplay'),
        b('INPUT DISPLAY', 'inputs'),
        { label: 'POSITION', header: true },
        { label: 'RESET: CENTER', action: () => this.trainingReset('center') },
        { label: 'RESET: LEFT CORNER', action: () => this.trainingReset('leftCorner') },
        { label: 'RESET: RIGHT CORNER', action: () => this.trainingReset('rightCorner') },
        { label: 'GAME', header: true },
      );
    } else {
      items.push({ label: 'HITBOXES', value: () => (this.showBoxes ? 'ON' : 'OFF'), action: () => (this.showBoxes = !this.showBoxes), left: () => (this.showBoxes = !this.showBoxes), right: () => (this.showBoxes = !this.showBoxes) });
      items.push({ label: 'RESTART MATCH', action: () => this.rematch() });
    }
    items.push(
      {
        label: 'CONTROLS',
        value: () => 'VIEW / REMAP',
        action: () => {
          this.overlay = 'controls';
          this.ctlReturn = 'pause';
          this.ctlRow = 0;
          this.ctlCol = 0;
        },
      },
      {
        label: 'MOVE LIST',
        action: () => {
          this.mlReturn = 'match';
          this.mlChar = ROSTER.findIndex((c) => c.id === this.chars[0].id);
          this.mlSel = 0;
          this.screen = 'movelist';
        },
      },
      { label: 'CHARACTER SELECT', action: () => ((this.selectPhase = 0), this.go('select')) },
      { label: 'QUIT TO TITLE', action: () => this.go('title') },
    );
    return items;
  }

  private trainingReset(p: 'center' | 'leftCorner' | 'rightCorner' | 'swap'): void {
    this.sim?.resetPositions(p);
    this.fx.clear();
    this.renderer.resetAnims();
    this.hud.reset();
    if (this.sim) this.dummy.apply(this.sim, 1);
    this.dummy.startPlayback(); // recorded playback restarts in sync with the new positions
    this.paused = false;
  }

  private resultsItems(): MenuItem[] {
    return [
      { label: 'REMATCH', action: () => this.rematch() },
      { label: 'WATCH REPLAY', action: () => this.lastReplay && this.openReplay(this.lastReplay) },
      { label: 'CHARACTER SELECT', action: () => ((this.selectPhase = 0), this.go('select')) },
      { label: 'QUIT TO TITLE', action: () => this.go('title') },
    ];
  }

  private matchInput(menu: MenuEv[], raw: string[]): void {
    const sim = this.sim;
    if (!sim) return;
    if (sim.state.round.phase === 'over' && this.overFrames > 90) {
      this.listInput(menu, this.resultsItems(), (i) => (this.resultsIdx = i), () => this.resultsIdx);
      return;
    }
    if (this.paused) {
      if (this.overlay === 'controls') {
        this.controlsInput(menu, raw);
        return;
      }
      if (menu.some((m) => m.key === 'pause' || m.key === 'back')) {
        this.paused = false;
        return;
      }
      this.listInput(menu, this.pauseItems(), (i) => (this.pauseIdx = i), () => this.pauseIdx);
      return;
    }
    for (const m of menu) {
      if (m.key === 'pause') {
        this.paused = true;
        this.pauseIdx = 0;
        this.overlay = null;
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
          this.hud.announce(this.dummyRecording ? 'RECORDING DUMMY - YOU CONTROL P2' : `RECORDED ${this.dummy.recording.length} FRAMES`);
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

  private movelistInput(menu: MenuEv[]): void {
    const rows = moveList(ROSTER[this.mlChar].id);
    for (const m of menu) {
      if (m.key === 'left') ((this.mlChar = (this.mlChar + ROSTER.length - 1) % ROSTER.length), (this.mlSel = 0));
      if (m.key === 'right') ((this.mlChar = (this.mlChar + 1) % ROSTER.length), (this.mlSel = 0));
      if (m.key === 'up') this.mlSel = (this.mlSel + rows.length - 1) % rows.length;
      if (m.key === 'down') this.mlSel = (this.mlSel + 1) % rows.length;
      if (m.key === 'back' || m.key === 'pause') this.leaveMoveList();
    }
  }

  private leaveMoveList(): void {
    if (this.mlReturn === 'match') this.screen = 'match';
    else this.go(this.mlReturn);
  }

  // ------------------------------------------------------------------ controls (title screen and pause overlay)

  private closeControls(): void {
    this.waitingBind = false;
    if (this.ctlReturn === 'pause') this.overlay = null;
    else this.go('title');
  }

  /** Rows: one per action, then "reset defaults", then "back". Columns: P1 key 1/2, P2 key 1/2. */
  private controlsInput(menu: MenuEv[], raw: string[]): void {
    const rows = ACTIONS.length + 2;
    if (this.waitingBind) {
      if (raw.includes('Escape')) {
        this.waitingBind = false;
        return;
      }
      const k = raw[0];
      if (k) this.bindKey(k);
      return;
    }
    for (const r of raw) if (r === 'Delete') this.clearBinding();
    for (const m of menu) {
      if (m.key === 'up') this.ctlRow = (this.ctlRow + rows - 1) % rows;
      if (m.key === 'down') this.ctlRow = (this.ctlRow + 1) % rows;
      if (m.key === 'left') this.ctlCol = (this.ctlCol + 3) % 4;
      if (m.key === 'right') this.ctlCol = (this.ctlCol + 1) % 4;
      if (m.key === 'confirm') this.controlsActivate();
      if (m.key === 'back' || m.key === 'pause') this.closeControls();
    }
  }

  private controlsActivate(): void {
    if (this.ctlRow < ACTIONS.length) this.waitingBind = true;
    else if (this.ctlRow === ACTIONS.length) {
      this.settings.bindings = [defaultBindings(0), defaultBindings(1)];
      this.devices.settings = this.settings;
      saveSettings(this.settings);
      this.notice('CONTROLS RESET TO DEFAULTS');
    } else this.closeControls();
  }

  private notice(s: string): void {
    this.ctlNotice = s;
    this.ctlNoticeLife = 180;
  }

  private bindKey(k: string): void {
    const act = ACTIONS[this.ctlRow];
    const player = this.ctlCol < 2 ? 0 : 1;
    const slot = this.ctlCol % 2;
    // a key can only do one thing: remove it from any other action of either player
    for (let p = 0; p < 2; p++) {
      for (const a of ACTIONS) {
        const list = this.settings.bindings[p][a];
        if (list.includes(k) && !(p === player && a === act)) {
          this.settings.bindings[p][a] = list.filter((x) => x !== k);
          this.notice(`${keyName(k)} MOVED FROM P${p + 1} ${ACTION_LABEL[a].toUpperCase()}`);
        }
      }
    }
    const cur = this.settings.bindings[player][act].filter((x) => x !== k);
    if (slot === 0) cur.unshift(k);
    else if (cur.length === 0) cur.push(k);
    else cur.splice(1, 1, k);
    this.settings.bindings[player][act] = cur.slice(0, 2);
    saveSettings(this.settings);
    this.waitingBind = false;
  }

  private clearBinding(): void {
    if (this.ctlRow >= ACTIONS.length) return;
    const act = ACTIONS[this.ctlRow];
    const player = this.ctlCol < 2 ? 0 : 1;
    const list = this.settings.bindings[player][act];
    if (list.length <= 1) {
      this.notice('EVERY ACTION NEEDS AT LEAST ONE KEY');
      return;
    }
    list.splice(this.ctlCol % 2, 1);
    saveSettings(this.settings);
  }

  // ------------------------------------------------------------------ replay viewer

  private replayInput(menu: MenuEv[], raw: string[]): void {
    const rp = this.rp;
    if (!rp) return;
    const seek = (f: number) => {
      rp.seek(f);
      this.fx.clear();
      this.renderer.resetAnims();
      this.hud.reset();
    };
    // at the end of a replay, "play" starts it over instead of doing nothing
    const toggle = () => {
      if (!this.rpPlaying && rp.frame >= rp.length) seek(0);
      this.rpPlaying = !this.rpPlaying;
    };
    for (const k of raw) {
      if (k === 'Space') toggle();
      if (k === 'KeyB') this.rpBoxes = !this.rpBoxes;
      if (k === 'KeyV') this.rpHideHud = !this.rpHideHud;
      if (k === 'KeyR') seek(0);
      if (k === 'Comma') seek(rp.frame - 120);
      if (k === 'Period') seek(rp.frame + 120);
    }
    for (const m of menu) {
      if (m.key === 'pause' || m.key === 'back') this.go('title');
      if (m.key === 'confirm') toggle();
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
    const n = takeSteps(this.loop, dt, 20, this.rpSpeed);
    for (let i = 0; i < n; i++) {
      if (rp.frame >= rp.length) {
        this.rpPlaying = false;
        break;
      }
      const ev = rp.step();
      this.renderer.tick(rp.sim, this.chars, ev);
      this.hud.tick(rp.sim);
      this.sfx.handle(ev, rp.sim);
    }
  }

  // ------------------------------------------------------------------ drawing helpers

  /** Animated pixel backdrop for menu screens. */
  private drawBackdrop(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = THEME.bg0;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // scrolling diagonal stripes
    ctx.fillStyle = THEME.bg1;
    const off = (this.time * 0.5) % 48;
    for (let x = -VIEW_H; x < VIEW_W + 48; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x + off, 0);
      ctx.lineTo(x + off + 24, 0);
      ctx.lineTo(x + off + 24 + VIEW_H, VIEW_H);
      ctx.lineTo(x + off + VIEW_H, VIEW_H);
      ctx.fill();
    }
    // pixel grid shimmer at the bottom
    for (let i = 0; i < 40; i++) {
      const x = (i * 97 + this.time * (1 + (i % 3))) % VIEW_W;
      const y = VIEW_H - 20 - ((i * 53) % 200);
      ctx.fillStyle = i % 3 === 0 ? '#ff4d6d33' : '#4cc9f033';
      ctx.fillRect(Math.floor(x / 6) * 6, Math.floor(y / 6) * 6, 6, 6);
    }
  }

  private header(title: string, sub?: string): void {
    const ctx = this.ctx;
    text(ctx, title, 60, 40, { scale: 6, color: THEME.text, shadow: THEME.p2 });
    if (sub) text(ctx, sub, 64, 98, { scale: 2, color: THEME.dim });
  }

  private footer(s: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5,3,15,0.8)';
    ctx.fillRect(0, VIEW_H - 34, VIEW_W, 34);
    ctx.fillStyle = THEME.edge;
    ctx.fillRect(0, VIEW_H - 34, VIEW_W, 2);
    text(ctx, s, VIEW_W / 2, VIEW_H - 24, { scale: 2, color: THEME.dim, align: 'center' });
  }

  /** Big pixel sprite of a fighter, rendered at low resolution then scaled by `px`. */
  private sprite(c: CharacterDef, x: number, y: number, px: number, o: { state?: 'idle' | 'win'; facing?: 1 | -1; flat?: string; frame?: number } = {}): void {
    const w = 80;
    const h = 96;
    const scale = 0.62;
    const img = fighterSprite(c, { w, h, scale, footX: w / 2, footY: h - 6, state: o.state ?? 'idle', stateFrame: o.frame ?? 30, time: this.time, facing: o.facing ?? 1, flat: o.flat });
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(img, Math.round(x - (w * px) / 2), Math.round(y - (h - 6) * px), w * px, h * px);
  }

  // ------------------------------------------------------------------ title

  private drawTitle(): void {
    const ctx = this.ctx;
    const d = this.demo!;
    this.renderer.draw(d.sim, d.chars, this.time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // darken + vignette so the menu reads clearly over the attract demo
    ctx.fillStyle = 'rgba(8,5,20,0.62)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = 'rgba(8,5,20,0.55)';
    ctx.fillRect(0, 0, 560, VIEW_H);
    // logo with a per-letter wave
    const logo = 'HUSTLE';
    let lx = 60;
    for (let i = 0; i < logo.length; i++) {
      const bob = Math.round(Math.sin(this.time * 0.06 + i * 0.7) * 2) * 3;
      lx += text(ctx, logo[i], lx, 40 + bob, { scale: 14, color: THEME.text, shadow: THEME.p2 }) + 14;
    }
    text(ctx, '// REAL-TIME', 66, 150, { scale: 5, color: THEME.p2, shadow: '#3a0a18' });
    text(ctx, `${ROSTER.length} FIGHTERS · ${ROSTER.reduce((n, c) => n + moveList(c.id).length, 0)} MOVES · NO TURNS`, 68, 200, { scale: 2, color: THEME.dim });

    const items = this.titleItems();
    panel(ctx, 50, 236, 440, items.length * 38 + 30, { accent: THEME.p2 });
    items.forEach((it, i) => {
      menuRow(ctx, this.ptr, 62, 250 + i * 38, 416, it.label, i === this.optIdx, { scale: 3, time: this.time, onHover: () => (this.optIdx = i), onClick: it.action });
    });
    const hint = items[this.optIdx]?.hint ?? '';
    wrapPixel(hint, 460, 2).forEach((l, i) => text(ctx, l, 56, 236 + items.length * 38 + 46 + i * 20, { scale: 2, color: THEME.cyan }));
    // demo caption
    const names = `${d.chars[0].name.toUpperCase()} VS ${d.chars[1].name.toUpperCase()}`;
    text(ctx, `DEMO · ${names}`, VIEW_W - 24, 24, { scale: 2, color: THEME.faint, align: 'right' });
    const blink = Math.floor(this.time / 30) % 2 === 0;
    if (blink) text(ctx, 'PRESS ENTER', VIEW_W - 220, VIEW_H - 90, { scale: 3, color: THEME.gold, align: 'center' });
    this.footer('P1: WASD MOVE · J/K/L ATTACK · U SPECIAL · I SUPER · O THROW · SPACE DASH · H PARRY · ESC MENU · MOUSE OK');
  }

  // ------------------------------------------------------------------ select

  private drawSelect(): void {
    const ctx = this.ctx;
    this.drawBackdrop();
    const modeName = { cpu: 'VERSUS CPU', versus: 'VERSUS', training: 'TRAINING', watch: 'CPU VS CPU' }[this.mode];
    text(ctx, 'SELECT YOUR FIGHTER', VIEW_W / 2, 24, { scale: 5, align: 'center', color: THEME.text, shadow: THEME.p2 });
    const phaseText =
      this.selectPhase === 0
        ? 'P1: CHOOSE A FIGHTER'
        : this.selectPhase === 1
          ? this.mode === 'versus'
            ? 'P2: CHOOSE A FIGHTER'
            : this.mode === 'training'
              ? 'CHOOSE THE TRAINING DUMMY'
              : 'CHOOSE THE OPPONENT'
          : this.hasCpu()
            ? 'SET CPU DIFFICULTY · CONFIRM TO FIGHT'
            : 'CONFIRM TO FIGHT';
    text(ctx, `${modeName} · ${phaseText}`, VIEW_W / 2, 72, { scale: 2, align: 'center', color: THEME.gold });

    const n = ROSTER.length;
    const cw = 224;
    const gap = 16;
    const x0 = (VIEW_W - (n * cw + (n - 1) * gap)) / 2;
    for (let i = 0; i < n; i++) {
      const c = ROSTER[i];
      const x = x0 + i * (cw + gap);
      const y = 104;
      const s0 = this.pick[0] === i;
      const s1 = this.pick[1] === i && this.selectPhase >= 1;
      const edge = s0 && s1 ? THEME.gold : s0 ? THEME.p1 : s1 ? THEME.p2 : THEME.edge;
      panel(ctx, x, y, cw, 300, { fill: s0 || s1 ? '#251a4c' : THEME.panel, edge });
      // character colour glow
      ctx.fillStyle = c.palette.aura + '22';
      ctx.fillRect(x + 12, y + 30, cw - 24, 190);
      const locked = (s0 && this.selectPhase >= 1) || (s1 && this.selectPhase >= 2);
      this.sprite(c, x + cw / 2, y + 236, 2.4, { state: locked ? 'win' : 'idle', facing: s1 && !s0 ? -1 : 1 });
      text(ctx, c.name.toUpperCase(), x + cw / 2, y + 246, { scale: 3, align: 'center', color: THEME.text });
      text(ctx, c.archetype.toUpperCase(), x + cw / 2, y + 274, { scale: 1, align: 'center', color: c.palette.aura });
      const bob = Math.floor(this.time / 12) % 2;
      if (s0) text(ctx, '1P', x + 22, y + 16 + bob * 2, { scale: 3, color: THEME.p1 });
      if (s1) text(ctx, this.mode === 'versus' ? '2P' : this.mode === 'training' ? 'DMY' : 'CPU', x + cw - 22, y + 16 + bob * 2, { scale: 3, color: THEME.p2, align: 'right' });
      this.ptr.add({
        x,
        y,
        w: cw,
        h: 300,
        hover: () => {
          if (this.selectPhase < 2) this.pick[this.selectPhase === 0 ? 0 : 1] = i;
        },
        click: () => {
          if (this.selectPhase < 2) {
            this.pick[this.selectPhase === 0 ? 0 : 1] = i;
            this.selectConfirm();
          }
        },
      });
    }
    // info panels
    for (const p of [0, 1] as const) {
      const c = ROSTER[this.pick[p]];
      const x = p === 0 ? 40 : VIEW_W / 2 + 10;
      const y = 424;
      const w = VIEW_W / 2 - 50;
      const show = p === 0 || this.selectPhase >= 1;
      panel(ctx, x, y, w, 236, { accent: p === 0 ? THEME.p1 : THEME.p2, alpha: show ? 1 : 0.4 });
      if (!show) {
        text(ctx, 'WAITING...', x + w / 2, y + 108, { scale: 3, align: 'center', color: THEME.faint });
        continue;
      }
      const who = p === 0 ? (this.mode === 'watch' ? 'CPU 1' : 'P1') : this.mode === 'versus' ? 'P2' : this.mode === 'training' ? 'DUMMY' : 'CPU';
      text(ctx, `${who} · ${c.name.toUpperCase()}`, x + 20, y + 18, { scale: 3, color: p === 0 ? THEME.p1 : THEME.p2 });
      text(ctx, c.title.toUpperCase(), x + 20, y + 48, { scale: 2, color: THEME.dim });
      wrapPixel(c.blurb, w - 300, 1).slice(0, 6).forEach((l, i) => text(ctx, l, x + 20, y + 80 + i * 14, { scale: 1, color: THEME.text, shadow: null }));
      text(ctx, `HP ${c.maxHp} · ${moveList(c.id).length} MOVES`, x + 20, y + 178, { scale: 2, color: THEME.cyan });
      const res = c.resources.map((r) => r.label).join(' ') || 'NONE';
      text(ctx, `AIR ${c.maxAirOptions}${c.flight ? ' + FLIGHT' : ''}${c.wallJump ? ' + WALLJUMP' : ''} · ${res}`, x + 20, y + 202, { scale: 1, color: THEME.dim, shadow: null });
      const st = STATS[c.id] ?? [3, 3, 3, 3, 3, 3];
      st.forEach((v, i) => {
        const sy = y + 70 + i * 24;
        text(ctx, STAT_NAMES[i], x + w - 250, sy, { scale: 1, color: THEME.dim, shadow: null });
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = THEME.border;
          ctx.fillRect(x + w - 160 + k * 26, sy - 2, 22, 12);
          ctx.fillStyle = k < v ? c.palette.aura : '#2b2245';
          ctx.fillRect(x + w - 158 + k * 26, sy, 18, 8);
        }
      });
    }
    if (this.selectPhase === 2) {
      ctx.fillStyle = 'rgba(5,3,15,0.7)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      panel(ctx, VIEW_W / 2 - 260, 260, 520, 180, { accent: THEME.gold });
      if (this.hasCpu()) {
        text(ctx, 'CPU DIFFICULTY', VIEW_W / 2, 284, { scale: 3, align: 'center', color: THEME.dim });
        const name = DIFFICULTIES[this.settings.difficulty].name.toUpperCase();
        text(ctx, `◀  ${name}  ▶`, VIEW_W / 2, 330, { scale: 5, align: 'center', color: THEME.gold });
        this.ptr.add({ x: VIEW_W / 2 - 250, y: 320, w: 120, h: 50, click: () => (this.settings.difficulty = Math.max(0, this.settings.difficulty - 1)) });
        this.ptr.add({ x: VIEW_W / 2 + 130, y: 320, w: 120, h: 50, click: () => (this.settings.difficulty = Math.min(DIFFICULTIES.length - 1, this.settings.difficulty + 1)) });
      } else text(ctx, 'READY?', VIEW_W / 2, 310, { scale: 6, align: 'center', color: THEME.gold });
      menuRow(ctx, this.ptr, VIEW_W / 2 - 120, 388, 240, 'FIGHT!', true, { scale: 3, time: this.time, onClick: () => this.selectConfirm() });
    }
    this.footer('LEFT/RIGHT CHOOSE · CONFIRM (J / ENTER / CLICK) · BACK (K / ESC)');
  }

  private drawVersus(): void {
    const ctx = this.ctx;
    this.drawBackdrop();
    const a = ROSTER[this.pick[0]];
    const b = ROSTER[this.pick[1]];
    const t = Math.min(1, this.vsTimer / 14);
    const ease = 1 - Math.pow(1 - t, 3);
    // diagonal colour slabs
    ctx.fillStyle = THEME.p1 + '55';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(VIEW_W / 2 + 80 - (1 - ease) * 700, 0);
    ctx.lineTo(VIEW_W / 2 - 80 - (1 - ease) * 700, VIEW_H);
    ctx.lineTo(0, VIEW_H);
    ctx.fill();
    ctx.fillStyle = THEME.p2 + '55';
    ctx.beginPath();
    ctx.moveTo(VIEW_W, 0);
    ctx.lineTo(VIEW_W / 2 + 80 + (1 - ease) * 700, 0);
    ctx.lineTo(VIEW_W / 2 - 80 + (1 - ease) * 700, VIEW_H);
    ctx.lineTo(VIEW_W, VIEW_H);
    ctx.fill();
    this.sprite(a, 300 - (1 - ease) * 500, 600, 4.5, { state: 'win', facing: 1, frame: this.vsTimer });
    this.sprite(b, VIEW_W - 300 + (1 - ease) * 500, 600, 4.5, { state: 'win', facing: -1, frame: this.vsTimer });
    text(ctx, a.name.toUpperCase(), 300 - (1 - ease) * 500, 620, { scale: 5, align: 'center', color: THEME.p1 });
    text(ctx, b.name.toUpperCase(), VIEW_W - 300 + (1 - ease) * 500, 620, { scale: 5, align: 'center', color: THEME.p2 });
    this.ptr.add({ x: 0, y: 0, w: VIEW_W, h: VIEW_H, click: () => (this.vsTimer = Math.max(this.vsTimer, 70)) });
    const vs = Math.max(10, 22 - this.vsTimer);
    text(ctx, 'VS', VIEW_W / 2, VIEW_H / 2, { scale: vs, align: 'center', valign: 'middle', color: THEME.gold, shadow: '#7a2c00' });
  }

  // ------------------------------------------------------------------ match

  private drawMatch(): void {
    const sim = this.sim;
    if (!sim) return;
    const ctx = this.ctx;
    this.renderer.draw(sim, this.chars, this.time);
    const t = this.training;
    const training = this.mode === 'training';
    const boxes = training ? t.boxes : this.showBoxes;
    drawDebug(ctx, sim, this.renderer.camera, this.chars, {
      boxes,
      frameData: training && t.frameData,
      di: training && t.diDisplay,
      inputs: (training && t.inputs) || this.settings.showInputs,
    });
    this.hud.draw(ctx, sim, this.chars, this.labels);
    this.renderer.drawOverlay();
    if (training) {
      ctx.fillStyle = 'rgba(5,3,15,0.75)';
      ctx.fillRect(0, VIEW_H - 16, VIEW_W, 16);
      text(ctx, 'ESC MENU · 1/2/3 RESET · 4 SWAP · 5 RECORD · 6 PLAYBACK · TAB HITBOXES · 0 FRAME DATA', VIEW_W / 2, VIEW_H - 12, { scale: 1, color: THEME.dim, align: 'center', shadow: null });
      if (this.dummyRecording && Math.floor(this.time / 20) % 2 === 0) text(ctx, '● REC', VIEW_W / 2, 118, { scale: 3, color: THEME.red, align: 'center' });
    }
    if (this.paused) {
      if (this.overlay === 'controls') {
        ctx.fillStyle = 'rgba(5,3,15,0.75)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        this.drawControlsPanel();
      } else this.drawPause();
    }
    if (sim.state.round.phase === 'over' && this.overFrames > 90) this.drawResults();
  }

  private drawPause(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(5,3,15,0.72)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const items = this.pauseItems();
    const w = 600;
    const rows = Math.min(items.length, 17);
    const h = rows * 28 + 110;
    const x = (VIEW_W - w) / 2;
    const y = Math.max(20, (VIEW_H - h) / 2);
    panel(ctx, x, y, w, h, { accent: THEME.gold });
    text(ctx, this.mode === 'training' ? 'TRAINING MENU' : 'PAUSED', VIEW_W / 2, y + 22, { scale: 4, align: 'center', color: THEME.text, shadow: THEME.p2 });
    this.drawList(items, x + 20, y + 70, w - 40, this.pauseIdx, (i) => (this.pauseIdx = i), rows);
    this.footer('UP/DOWN SELECT · LEFT/RIGHT CHANGE · ENTER CONFIRM · ESC RESUME');
  }

  private drawResults(): void {
    const sim = this.sim!;
    const ctx = this.ctx;
    const r = sim.state.round;
    ctx.fillStyle = 'rgba(5,3,15,0.6)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const winner = r.matchWinner >= 0 ? this.chars[r.matchWinner] : null;
    if (winner) this.sprite(winner, 300, 560, 4, { state: 'win', facing: 1, frame: this.overFrames });
    panel(ctx, 560, 300, 640, 380, { accent: THEME.gold });
    const st = sim.state.fighters.map((f) => f.stats);
    const rows: [string, number, number][] = [
      ['HITS', st[0].hitsLanded, st[1].hitsLanded],
      ['DAMAGE', st[0].damageDealt, st[1].damageDealt],
      ['SUPERS', st[0].supers, st[1].supers],
      ['BURSTS', st[0].bursts, st[1].bursts],
      ['PARRIES', st[0].parries, st[1].parries],
    ];
    text(ctx, this.labels[0], 860, 322, { scale: 2, color: THEME.p1, align: 'center' });
    text(ctx, this.labels[1], 1080, 322, { scale: 2, color: THEME.p2, align: 'center' });
    rows.forEach(([k, a, b], i) => {
      const y = 350 + i * 26;
      text(ctx, k, 590, y, { scale: 2, color: THEME.dim });
      text(ctx, String(a), 860, y, { scale: 2, color: a >= b ? THEME.text : THEME.faint, align: 'center' });
      text(ctx, String(b), 1080, y, { scale: 2, color: b >= a ? THEME.text : THEME.faint, align: 'center' });
    });
    const items = this.resultsItems();
    items.forEach((it, i) => menuRow(ctx, this.ptr, 580, 492 + i * 42, 600, it.label, i === this.resultsIdx, { scale: 3, time: this.time, onHover: () => (this.resultsIdx = i), onClick: it.action }));
  }

  // ------------------------------------------------------------------ list screens

  private drawListScreen(title: string, items: MenuItem[], footer: string): void {
    this.drawBackdrop();
    this.header(title);
    panel(this.ctx, 50, 130, 760, 540, { accent: THEME.p2 });
    this.drawList(items, 70, 160, 720, this.optIdx, (i) => (this.optIdx = i), 17);
    const hint = items[this.optIdx]?.hint;
    if (hint) wrapPixel(hint, 380, 2).forEach((l, i) => text(this.ctx, l, 850, 160 + i * 20, { scale: 2, color: THEME.cyan }));
    this.footer(footer);
  }

  private drawAura(): void {
    const items = this.auraItems();
    this.drawListScreen('AURA EDITOR', items, 'AURAS ATTACH TO BODY REGIONS AND FIRE FROM GAMEPLAY EVENTS · CHANGES SAVE AUTOMATICALLY');
    // live preview with every trigger forced on
    const c = ROSTER[this.auraChar];
    const ctx = this.ctx;
    panel(ctx, 850, 130, 380, 540, { fill: '#120b26' });
    const sim = previewSim(c.id);
    const f = sim.state.fighters[0];
    f.x = 0;
    f.y = 0;
    f.facing = 1;
    f.state = 'idle';
    const preview = { ...f, install: { frames: 100, drain: 0 }, stance: c.id === 'vesper' ? 'draw' : null, flying: c.id === 'bastion', hp: 1, resources: { ...f.resources, heat: 100 } } as typeof f;
    const j = buildJoints(f, c, computePose(sim, f, this.time));
    const fx = this.previewFx ?? (this.previewFx = new Effects(this.settings.fx));
    fx.settings = this.settings.fx;
    const auras = this.settings.fx.auras[c.id] ?? [];
    const saved = auras.map((a) => a.trigger);
    for (const a of auras) a.trigger = 'always';
    fx.tickFighter(preview, j, c, sim);
    auras.forEach((a, i) => (a.trigger = saved[i]));
    fx.update();
    // draw into a low-res buffer so the preview matches the in-game pixel look
    const lw = Math.round(360 / PX);
    const lh = Math.round(500 / PX);
    const buf = document.createElement('canvas');
    buf.width = lw;
    buf.height = lh;
    const b = buf.getContext('2d', { willReadFrequently: true })!;
    const k = 1.5 / PX;
    b.setTransform(k, 0, 0, -k, lw / 2, lh - 30 / PX);
    const p = c.palette;
    drawFighter(b, f, c, j, { primary: p.primary, secondary: p.secondary, accent: p.accent, skin: p.skin, outline: '#0b0a14', alpha: 1 }, this.time);
    pixelate(b, lw, lh);
    b.setTransform(k, 0, 0, -k, lw / 2, lh - 30 / PX);
    fx.drawWorld(b);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 860, 150, lw * PX, lh * PX);
    text(ctx, 'PREVIEW · ALL TRIGGERS ON', 1040, 640, { scale: 1, align: 'center', color: THEME.dim, shadow: null });
  }

  // ------------------------------------------------------------------ move list

  private drawMoveList(): void {
    const ctx = this.ctx;
    this.drawBackdrop();
    const c = ROSTER[this.mlChar];
    const rows = moveList(c.id);
    this.mlSel = Math.min(this.mlSel, rows.length - 1);
    // character tabs
    ROSTER.forEach((rc, i) => {
      const x = 40 + i * 120;
      const on = i === this.mlChar;
      panel(ctx, x, 16, 112, 64, { fill: on ? '#2c2052' : THEME.panel, edge: on ? rc.palette.aura : THEME.edge, cut: 5 });
      text(ctx, rc.name.toUpperCase(), x + 56, 40, { scale: 2, align: 'center', color: on ? THEME.text : THEME.dim });
      this.ptr.add({ x, y: 16, w: 112, h: 64, click: () => ((this.mlChar = i), (this.mlSel = 0)) });
    });
    text(ctx, `${c.title.toUpperCase()} · ${c.archetype.toUpperCase()} · HP ${c.maxHp}`, 660, 40, { scale: 2, color: c.palette.aura });
    // list
    panel(ctx, 40, 96, 620, 576);
    const perPage = 18;
    const top = Math.max(0, Math.min(this.mlSel - Math.floor(perPage / 2), rows.length - perPage));
    text(ctx, 'MOVE', 64, 112, { scale: 2, color: THEME.faint });
    text(ctx, 'INPUT', 360, 112, { scale: 2, color: THEME.faint });
    text(ctx, 'S/A/R', 560, 112, { scale: 2, color: THEME.faint });
    rows.slice(top, top + perPage).forEach((r, k) => {
      const i = top + k;
      const y = 134 + k * 29;
      const sel = i === this.mlSel;
      if (sel) {
        ctx.fillStyle = 'rgba(255,214,10,0.12)';
        ctx.fillRect(52, y - 4, 596, 26);
        ctx.fillStyle = THEME.gold;
        ctx.fillRect(52, y - 4, 3, 26);
      }
      const kc = r.kind === 'super' ? THEME.red : r.kind === 'special' ? THEME.cyan : r.kind === 'throw' ? '#80ffdb' : r.kind === 'defense' || r.kind === 'movement' || r.kind === 'system' ? THEME.dim : THEME.text;
      text(ctx, r.name.toUpperCase().slice(0, 22), 64, y, { scale: 2, color: sel ? THEME.gold : kc });
      const inp = r.input.toUpperCase();
      text(ctx, inp.length > 14 ? `${inp.slice(0, 13)}.` : inp, 360, y, { scale: 2, color: THEME.text });
      text(ctx, r.startup || r.active ? `${r.startup}/${r.active}/${r.recovery}` : `${r.total}F`, 560, y, { scale: 2, color: THEME.dim });
      this.ptr.add({ x: 52, y: y - 4, w: 596, h: 26, hover: () => (this.mlSel = i), click: () => (this.mlSel = i) });
    });
    this.ptr.add({ x: 40, y: 96, w: 620, h: 576, wheel: (d) => (this.mlSel = Math.max(0, Math.min(rows.length - 1, this.mlSel + d))) });
    // details
    const r = rows[this.mlSel];
    if (r) this.drawMoveDetail(c, r);
    this.footer('UP/DOWN MOVE · LEFT/RIGHT CHARACTER · ESC BACK · MOUSE WHEEL SCROLLS');
  }

  private drawMoveDetail(c: CharacterDef, r: MoveRow): void {
    const ctx = this.ctx;
    const x = 680;
    const w = 560;
    panel(ctx, x, 96, w, 576, { accent: c.palette.aura });
    text(ctx, r.name.toUpperCase(), x + 24, 120, { scale: 3, color: THEME.text });
    // input keycap
    const iw = textWidth(r.input.toUpperCase(), 2) + 24;
    panel(ctx, x + 24, 160, iw, 36, { fill: THEME.bg0, cut: 4 });
    text(ctx, r.input.toUpperCase(), x + 36, 172, { scale: 2, color: THEME.gold });
    text(ctx, r.kind.toUpperCase(), x + 40 + iw, 172, { scale: 2, color: THEME.dim });
    // frame bar
    const m = previewSim(c.id).moveById(previewSim(c.id).state.fighters[0], r.id);
    if (m) {
      const fd = frameData(m);
      const total = Math.max(1, m.total);
      const bw = w - 48;
      const cell = Math.max(2, Math.min(10, Math.floor(bw / total)));
      text(ctx, 'FRAMES', x + 24, 214, { scale: 2, color: THEME.faint });
      for (let i = 1; i <= Math.min(total, Math.floor(bw / cell)); i++) {
        const active = m.hits?.some((h) => i >= h.frames[0] && i <= h.frames[1]) || (m.throw && i >= m.throw.frames[0] && i <= m.throw.frames[1]) || m.spawns?.some((s) => s.frame === i);
        const inv = m.invuln?.some((iv) => i >= iv.frames[0] && i <= iv.frames[1]);
        ctx.fillStyle = THEME.border;
        ctx.fillRect(x + 24 + (i - 1) * cell, 236, cell, 18);
        ctx.fillStyle = active ? THEME.red : i <= fd.startup ? THEME.green : '#3a86ff';
        ctx.fillRect(x + 24 + (i - 1) * cell, 238, cell - 1, 14);
        if (inv) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x + 24 + (i - 1) * cell, 238, cell - 1, 3);
        }
      }
      text(ctx, `STARTUP ${fd.startup}  ACTIVE ${fd.active}  RECOVERY ${fd.recovery}  TOTAL ${fd.total}`, x + 24, 264, { scale: 1, color: THEME.dim, shadow: null });
    }
    const stat = (k: string, v: string, y: number, col = THEME.text) => {
      text(ctx, k, x + 24, y, { scale: 2, color: THEME.faint });
      text(ctx, v.toUpperCase(), x + 170, y, { scale: 2, color: col });
    };
    stat('DAMAGE', r.damage ? String(r.damage) : '-', 292);
    stat('GUARD', r.guard, 318);
    stat('COST', r.cost, 344, THEME.gold);
    let y = 378;
    if (r.props) {
      text(ctx, 'PROPERTIES', x + 24, y, { scale: 2, color: THEME.faint });
      y += 24;
      for (const l of wrapPixel(r.props.toUpperCase(), w - 48, 2)) {
        text(ctx, l, x + 24, y, { scale: 2, color: THEME.cyan });
        y += 20;
      }
      y += 8;
    }
    for (const l of wrapPixel(r.desc, w - 48, 2).slice(0, 8)) {
      text(ctx, l, x + 24, y, { scale: 2, color: THEME.text });
      y += 20;
    }
    wrapPixel(UNIVERSAL_HELP[0], w - 48, 1).forEach((l, i) => text(ctx, l, x + 24, 628 + i * 12, { scale: 1, color: THEME.faint, shadow: null }));
  }

  // ------------------------------------------------------------------ controls

  private drawControlsPanel(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const x = 70;
    const y = 30;
    const w = VIEW_W - 140;
    const h = VIEW_H - 80;
    panel(ctx, x, y, w, h, { accent: THEME.cyan });
    text(ctx, 'CONTROLS', x + 28, y + 22, { scale: 4, color: THEME.text, shadow: THEME.p2 });
    text(ctx, this.ctlReturn === 'pause' ? 'CHANGES APPLY IMMEDIATELY · THE MATCH IS PAUSED' : 'CHANGES SAVE AUTOMATICALLY', x + w - 28, y + 32, { scale: 2, color: THEME.dim, align: 'right' });
    const colX = [x + 360, x + 520, x + 720, x + 880];
    const cw = 148;
    text(ctx, 'PLAYER 1', (colX[0] + colX[1] + cw) / 2, y + 70, { scale: 2, color: THEME.p1, align: 'center' });
    text(ctx, 'PLAYER 2', (colX[2] + colX[3] + cw) / 2, y + 70, { scale: 2, color: THEME.p2, align: 'center' });
    const rowH = 31;
    ACTIONS.forEach((a, r) => {
      const ry = y + 96 + r * rowH;
      const rowSel = this.ctlRow === r;
      if (rowSel) {
        ctx.fillStyle = 'rgba(255,214,10,0.08)';
        ctx.fillRect(x + 20, ry - 4, w - 40, rowH - 2);
      }
      text(ctx, ACTION_LABEL[a].toUpperCase(), x + 40, ry + 4, { scale: 2, color: rowSel ? THEME.gold : THEME.text });
      for (let col = 0; col < 4; col++) {
        const player = col < 2 ? 0 : 1;
        const key = this.settings.bindings[player][a][col % 2];
        const sel = rowSel && this.ctlCol === col;
        const cx = colX[col];
        const waiting = sel && this.waitingBind;
        panel(ctx, cx, ry - 4, cw, 26, { fill: sel ? '#3a2a6e' : THEME.bg0, edge: sel ? THEME.gold : THEME.edge, cut: 3 });
        const label = waiting ? (Math.floor(this.time / 15) % 2 ? 'PRESS KEY' : '') : key ? keyName(key) : '-';
        text(ctx, label, cx + cw / 2, ry + 3, { scale: 2, align: 'center', color: waiting ? THEME.gold : key ? THEME.text : THEME.faint, shadow: null });
        this.ptr.add({
          x: cx,
          y: ry - 4,
          w: cw,
          h: 26,
          hover: () => {
            if (!this.waitingBind) {
              this.ctlRow = r;
              this.ctlCol = col;
            }
          },
          click: () => {
            this.ctlRow = r;
            this.ctlCol = col;
            this.waitingBind = true;
          },
        });
      }
    });
    const by = y + 96 + ACTIONS.length * rowH + 6;
    menuRow(ctx, this.ptr, x + 30, by, 360, 'RESET TO DEFAULTS', this.ctlRow === ACTIONS.length, { scale: 2, time: this.time, onHover: () => (this.ctlRow = ACTIONS.length), onClick: () => ((this.ctlRow = ACTIONS.length), this.controlsActivate()) });
    menuRow(ctx, this.ptr, x + 420, by, 360, this.ctlReturn === 'pause' ? 'BACK TO PAUSE MENU' : 'BACK', this.ctlRow === ACTIONS.length + 1, { scale: 2, time: this.time, onHover: () => (this.ctlRow = ACTIONS.length + 1), onClick: () => this.closeControls() });
    if (this.ctlNoticeLife > 0) text(ctx, this.ctlNotice, x + w - 30, by + 8, { scale: 2, color: THEME.orange, align: 'right' });
    text(ctx, 'GAMEPAD: STICK/DPAD MOVE · A LIGHT · X MEDIUM · Y HEAVY · B SPECIAL · RB SUPER · LB THROW · RT DASH · LT PARRY · START PAUSE', x + w / 2, y + h - 40, { scale: 1, align: 'center', color: THEME.dim, shadow: null });
    this.footer(this.waitingBind ? 'PRESS THE NEW KEY · ESC CANCELS' : 'ARROWS SELECT · ENTER/CLICK REMAP · DELETE CLEARS 2ND KEY · ESC BACK');
  }

  // ------------------------------------------------------------------ replay viewer

  private drawReplay(): void {
    const rp = this.rp;
    if (!rp) return;
    const ctx = this.ctx;
    const sim = rp.sim;
    this.renderer.draw(sim, this.chars, this.time);
    drawDebug(ctx, sim, this.renderer.camera, this.chars, { boxes: this.rpBoxes, frameData: this.rpBoxes, di: this.rpBoxes, inputs: this.rpBoxes });
    if (!this.rpHideHud) this.hud.draw(ctx, sim, this.chars, this.labels);
    this.renderer.drawOverlay();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(5,3,15,0.85)';
    ctx.fillRect(0, VIEW_H - 44, VIEW_W, 44);
    const p = rp.frame / Math.max(1, rp.length);
    bar(ctx, 12, VIEW_H - 40, VIEW_W - 24, 6, p, THEME.p2, { shine: false });
    this.ptr.add({ x: 12, y: VIEW_H - 44, w: VIEW_W - 24, h: 14, click: () => {
      rp.seek(Math.round(((this.ptr.x - 12) / (VIEW_W - 24)) * rp.length));
      this.fx.clear();
      this.renderer.resetAnims();
      this.hud.reset();
    } });
    text(ctx, `${this.rpPlaying ? '▶' : '❚❚'} ${rp.frame}/${rp.length} · ${this.rpSpeed}X`, 14, VIEW_H - 24, { scale: 2, color: THEME.text });
    text(ctx, 'SPACE PLAY · ◀▶ STEP · ▲▼ SPEED · , . SEEK 2S · R RESTART · B DEBUG · V HUD · ESC EXIT', VIEW_W - 14, VIEW_H - 22, { scale: 1, color: THEME.dim, align: 'right', shadow: null });
  }
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



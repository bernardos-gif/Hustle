// Keyboard and gamepad devices. Key presses are latched between simulation steps so that a tap
// shorter than one frame is never lost.

import { IN } from '../core/input';
import type { Action, Settings } from './settings';

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'tab';

const ACTION_BIT: Record<Action, number> = {
  up: IN.UP,
  down: IN.DOWN,
  left: IN.LEFT,
  right: IN.RIGHT,
  L: IN.L,
  M: IN.M,
  H: IN.H,
  S: IN.S,
  T: IN.T,
  D: IN.D,
  P: IN.P,
  X: IN.X,
};

export class Devices {
  private down = new Set<string>();
  private latched = new Set<string>();
  menu: { key: MenuKey; player: number }[] = [];
  rawKeys: string[] = [];
  private padPrev: number[] = [0, 0];
  private padMenuPrev: number[] = [0, 0];
  settings: Settings;
  onAnyInput: (() => void) | null = null;

  constructor(settings: Settings) {
    this.settings = settings;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        this.menuFromKey(e.code, true);
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.down.add(e.code);
      this.latched.add(e.code);
      this.rawKeys.push(e.code);
      this.menuFromKey(e.code, false);
      this.onAnyInput?.();
      if (this.isGameKey(e.code) || e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
    });
  }

  private isGameKey(code: string): boolean {
    for (const b of this.settings.bindings) for (const k of Object.values(b)) if (k.includes(code)) return true;
    return false;
  }

  private menuFromKey(code: string, repeat: boolean): void {
    const push = (key: MenuKey, player: number): void => {
      this.menu.push({ key, player });
    };
    if (code === 'Escape') return repeat ? undefined : push('pause', 0);
    if (code === 'Enter' || code === 'NumpadEnter') return repeat ? undefined : push('confirm', 0);
    if (code === 'Backspace') return repeat ? undefined : push('back', 0);
    if (code === 'Tab') return repeat ? undefined : push('tab', 0);
    const before = this.menu.length;
    for (let p = 0; p < 2; p++) {
      const b = this.settings.bindings[p];
      if (b.up.includes(code)) push('up', p);
      else if (b.down.includes(code)) push('down', p);
      else if (b.left.includes(code)) push('left', p);
      else if (b.right.includes(code)) push('right', p);
      else if (!repeat && b.L.includes(code)) push('confirm', p);
      else if (!repeat && (b.M.includes(code) || b.P.includes(code))) push('back', p);
    }
    // arrow keys always navigate menus, even if they were rebound away from directions
    const arrows: Record<string, MenuKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (this.menu.length === before && arrows[code]) push(arrows[code], 0);
  }

  /** Samples one player's input for the next simulation step. */
  sample(player: 0 | 1): number {
    let m = 0;
    const b = this.settings.bindings[player];
    for (const a of Object.keys(b) as Action[]) {
      for (const k of b[a]) if (this.down.has(k) || this.latched.has(k)) m |= ACTION_BIT[a];
    }
    m |= this.samplePad(player);
    // opposite directions cancel out (SOCD neutral)
    if ((m & IN.LEFT) && (m & IN.RIGHT)) m &= ~(IN.LEFT | IN.RIGHT);
    if ((m & IN.UP) && (m & IN.DOWN)) m &= ~IN.DOWN;
    return m;
  }

  /** Clears latched taps after a simulation step consumed them. */
  endStep(): void {
    this.latched.clear();
  }

  private samplePad(player: number): number {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads?.[player];
    if (!p) return 0;
    let m = 0;
    const btn = (i: number) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] ?? 0;
    const ay = p.axes[1] ?? 0;
    if (btn(12) || ay < -0.5) m |= IN.UP;
    if (btn(13) || ay > 0.5) m |= IN.DOWN;
    if (btn(14) || ax < -0.5) m |= IN.LEFT;
    if (btn(15) || ax > 0.5) m |= IN.RIGHT;
    if (btn(0)) m |= IN.L;
    if (btn(2)) m |= IN.M;
    if (btn(3)) m |= IN.H;
    if (btn(1)) m |= IN.S;
    if (btn(5)) m |= IN.X;
    if (btn(4)) m |= IN.T;
    if (btn(7)) m |= IN.D;
    if (btn(6)) m |= IN.P;
    return m;
  }

  /** Converts gamepad edges into menu navigation (call once per render frame). */
  pollPadMenu(): void {
    for (let i = 0; i < 2; i++) {
      const m = this.samplePad(i);
      const prev = this.padMenuPrev[i];
      const edge = m & ~prev;
      if (edge & IN.UP) this.menu.push({ key: 'up', player: i });
      if (edge & IN.DOWN) this.menu.push({ key: 'down', player: i });
      if (edge & IN.LEFT) this.menu.push({ key: 'left', player: i });
      if (edge & IN.RIGHT) this.menu.push({ key: 'right', player: i });
      if (edge & IN.L) this.menu.push({ key: 'confirm', player: i });
      if (edge & IN.M) this.menu.push({ key: 'back', player: i });
      const pads = navigator.getGamepads?.();
      const start = !!pads?.[i]?.buttons[9]?.pressed;
      if (start && !this.padPrev[i]) this.menu.push({ key: 'pause', player: i });
      this.padPrev[i] = start ? 1 : 0;
      this.padMenuPrev[i] = m;
    }
  }

  takeMenu(): { key: MenuKey; player: number }[] {
    const m = this.menu;
    this.menu = [];
    return m;
  }

  takeRaw(): string[] {
    const r = this.rawKeys;
    this.rawKeys = [];
    return r;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
}

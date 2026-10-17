// Persistent user settings: key bindings, audio, visual effect customisation.

import { defaultFxSettings, type FxSettings } from '../render/effects';

export type Action = 'up' | 'down' | 'left' | 'right' | 'L' | 'M' | 'H' | 'S' | 'T' | 'D' | 'P' | 'X';
export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'L', 'M', 'H', 'S', 'X', 'T', 'D', 'P'];
export const ACTION_LABEL: Record<Action, string> = {
  up: 'Up / Jump',
  down: 'Down / Crouch',
  left: 'Left',
  right: 'Right',
  L: 'Light',
  M: 'Medium',
  H: 'Heavy',
  S: 'Special',
  X: 'Super / Burst',
  T: 'Throw',
  D: 'Dash / Dodge / Tech',
  P: 'Parry / Feint / Guard Push',
};

export type Bindings = Record<Action, string[]>;

export function defaultBindings(player: 0 | 1): Bindings {
  if (player === 0)
    return {
      up: ['KeyW'],
      down: ['KeyS'],
      left: ['KeyA'],
      right: ['KeyD'],
      L: ['KeyJ'],
      M: ['KeyK'],
      H: ['KeyL'],
      S: ['KeyU'],
      X: ['KeyI'],
      T: ['KeyO'],
      D: ['Space'],
      P: ['KeyH'],
    };
  return {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    L: ['Numpad1', 'Comma'],
    M: ['Numpad2', 'Period'],
    H: ['Numpad3', 'Slash'],
    S: ['Numpad4', 'KeyM'],
    X: ['Numpad5', 'Semicolon'],
    T: ['Numpad6', 'Quote'],
    D: ['Numpad0', 'ShiftRight'],
    P: ['NumpadDecimal', 'KeyN'],
  };
}

export interface Settings {
  bindings: [Bindings, Bindings];
  volume: number;
  musicVolume: number;
  fx: FxSettings;
  showInputs: boolean;
  difficulty: number;
}

const KEY = 'hustle-rt-settings-v1';

export function loadSettings(): Settings {
  const d: Settings = { bindings: [defaultBindings(0), defaultBindings(1)], volume: 0.5, musicVolume: 0.35, fx: defaultFxSettings(), showInputs: false, difficulty: 1 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    const fx = { ...d.fx, ...(s.fx ?? {}) };
    // merge auras per character so new aura definitions appear after updates
    fx.auras = { ...d.fx.auras };
    for (const k of Object.keys(d.fx.auras)) {
      const saved = s.fx?.auras?.[k] as FxSettings['auras'][string] | undefined;
      if (saved) fx.auras[k] = d.fx.auras[k].map((a) => ({ ...a, ...(saved.find((x) => x.id === a.id) ?? {}) }));
    }
    return { ...d, ...s, fx, bindings: [{ ...d.bindings[0], ...(s.bindings?.[0] ?? {}) }, { ...d.bindings[1], ...(s.bindings?.[1] ?? {}) }] };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

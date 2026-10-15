// Input representation shared by keyboard, gamepad, AI and replays.
// A frame of input is a bitmask of absolute directions + buttons, which keeps replays tiny
// and the simulation fully deterministic.

export const IN = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  L: 1 << 4, // light attack
  M: 1 << 5, // medium attack
  H: 1 << 6, // heavy attack
  S: 1 << 7, // special
  T: 1 << 8, // throw / grab
  D: 1 << 9, // dash / dodge / air dash / tech
  P: 1 << 10, // parry / guard push
  X: 1 << 11, // super / burst (in hitstun)
} as const;

export type ButtonName = 'L' | 'M' | 'H' | 'S' | 'T' | 'D' | 'P' | 'X';
export const BUTTONS: ButtonName[] = ['L', 'M', 'H', 'S', 'T', 'D', 'P', 'X'];
/** Order in which simultaneously-buffered buttons are considered when picking an action. */
export const BUTTON_PRIORITY: ButtonName[] = ['X', 'T', 'P', 'S', 'H', 'M', 'L', 'D'];

/** How many frames a press stays buffered before it expires. */
export const BUFFER_FRAMES = 8;
/** Window for double-tap dashes. */
export const DOUBLE_TAP_FRAMES = 12;

export interface InputBufferState {
  cur: number;
  prev: number;
  /** Age (frames since press) of the most recent unconsumed press of each button, -1 if none. */
  press: Record<ButtonName, number>;
  /** Frames each button has been held. */
  held: Record<ButtonName, number>;
  /** Short history of raw masks (newest last) used by the debug display and double taps. */
  history: number[];
  lastTapDir: number; // numpad 4 or 6 (absolute: 4 = left, 6 = right), 0 none
  lastTapAge: number;
  /** Set when a double tap is detected this frame (absolute numpad 4/6). */
  doubleTap: number;
}

export function newInputBuffer(): InputBufferState {
  const z = () => ({ L: -1, M: -1, H: -1, S: -1, T: -1, D: -1, P: -1, X: -1 });
  return {
    cur: 0,
    prev: 0,
    press: z(),
    held: { L: 0, M: 0, H: 0, S: 0, T: 0, D: 0, P: 0, X: 0 },
    history: [],
    lastTapDir: 0,
    lastTapAge: 99,
    doubleTap: 0,
  };
}

export function feedInput(b: InputBufferState, mask: number): void {
  b.prev = b.cur;
  b.cur = mask;
  for (const name of BUTTONS) {
    const bit = IN[name];
    const down = (mask & bit) !== 0;
    const wasDown = (b.prev & bit) !== 0;
    if (down && !wasDown) b.press[name] = 0;
    else if (b.press[name] >= 0) {
      b.press[name]++;
      if (b.press[name] > BUFFER_FRAMES) b.press[name] = -1;
    }
    b.held[name] = down ? b.held[name] + 1 : 0;
  }
  // double tap detection on horizontal directions
  b.doubleTap = 0;
  b.lastTapAge++;
  const h = mask & (IN.LEFT | IN.RIGHT);
  const ph = b.prev & (IN.LEFT | IN.RIGHT);
  if (h && h !== ph && (h === IN.LEFT || h === IN.RIGHT)) {
    const dir = h === IN.LEFT ? 4 : 6;
    if (b.lastTapDir === dir && b.lastTapAge <= DOUBLE_TAP_FRAMES) {
      b.doubleTap = dir;
      b.lastTapDir = 0;
    } else {
      b.lastTapDir = dir;
      b.lastTapAge = 0;
    }
  }
  b.history.push(mask);
  if (b.history.length > 30) b.history.shift();
}

export const pressed = (b: InputBufferState, n: ButtonName): boolean => b.press[n] >= 0;
export const justPressed = (b: InputBufferState, n: ButtonName): boolean => b.press[n] === 0;
export const held = (b: InputBufferState, n: ButtonName): boolean => b.held[n] > 0;
export const consume = (b: InputBufferState, n: ButtonName): void => {
  b.press[n] = -1;
};

/** Numpad notation direction relative to facing (6 = toward the facing side). */
export function numpadDir(mask: number, facing: number): number {
  const up = (mask & IN.UP) !== 0;
  const down = (mask & IN.DOWN) !== 0;
  const left = (mask & IN.LEFT) !== 0;
  const right = (mask & IN.RIGHT) !== 0;
  let hx = (right ? 1 : 0) - (left ? 1 : 0);
  const vy = (up ? 1 : 0) - (down ? 1 : 0);
  hx *= facing >= 0 ? 1 : -1;
  return 5 + hx + vy * 3;
}

/** Direction as a unit-ish vector in world space (x right, y up), not facing-relative. */
export function dirVector(mask: number): { x: number; y: number } {
  const x = ((mask & IN.RIGHT) !== 0 ? 1 : 0) - ((mask & IN.LEFT) !== 0 ? 1 : 0);
  const y = ((mask & IN.UP) !== 0 ? 1 : 0) - ((mask & IN.DOWN) !== 0 ? 1 : 0);
  if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
  return { x, y };
}

export function describeMask(mask: number): string {
  const d = numpadDir(mask, 1);
  let s = String(d);
  for (const n of BUTTONS) if (mask & IN[n]) s += n;
  return s;
}

/** Matches a numpad digit against a direction pattern used by move commands. */
export function dirMatches(pattern: string, d: number): boolean {
  switch (pattern) {
    case '*':
      return true;
    case 'd':
      return d === 1 || d === 2 || d === 3;
    case 'u':
      return d === 7 || d === 8 || d === 9;
    case 'f':
      return d === 3 || d === 6 || d === 9;
    case 'b':
      return d === 1 || d === 4 || d === 7;
    default:
      return pattern === String(d);
  }
}

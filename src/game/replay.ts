// Replays store the initial configuration plus every frame of input. Because the simulation is
// deterministic, playing the inputs back reproduces the exact same fight. Snapshots taken during
// playback make rewinding and seeking cheap.

import { Sim, type SimSettings } from '../combat/sim';

export interface ReplayData {
  version: 1;
  chars: [string, string];
  seed: number;
  settings: SimSettings;
  inputs: [number, number][];
  date: string;
  labels: [string, string];
  /** Final state hash, used to verify determinism. */
  checksum?: string;
}

export class ReplayRecorder {
  data: ReplayData;
  constructor(chars: [string, string], seed: number, settings: SimSettings, labels: [string, string]) {
    this.data = { version: 1, chars, seed, settings: structuredClone(settings), inputs: [], date: new Date().toISOString(), labels };
  }
  record(inputs: [number, number]): void {
    this.data.inputs.push([inputs[0], inputs[1]]);
  }
  finish(sim: Sim): ReplayData {
    this.data.checksum = stateChecksum(sim);
    return this.data;
  }
}

export function stateChecksum(sim: Sim): string {
  const s = sim.state;
  const parts = s.fighters.map((f) => `${f.x.toFixed(3)},${f.y.toFixed(3)},${f.hp},${f.meter.toFixed(2)},${f.state},${f.moveId}`);
  return `${s.frame}|${parts.join('|')}|${s.projectiles.length}|${s.round.wins.join(',')}`;
}

const SNAP_EVERY = 30;

export class ReplayPlayer {
  data: ReplayData;
  sim: Sim;
  frame = 0;
  private snaps = new Map<number, ReturnType<Sim['snapshot']>>();

  constructor(data: ReplayData) {
    this.data = data;
    this.sim = this.fresh();
    this.snaps.set(0, this.sim.snapshot());
  }

  private fresh(): Sim {
    return new Sim({ chars: this.data.chars, seed: this.data.seed, settings: this.data.settings });
  }

  get length(): number {
    return this.data.inputs.length;
  }

  /** Advances one frame; returns the frame's events. */
  step(): ReturnType<Sim['step']> {
    if (this.frame >= this.length) return [];
    const ev = this.sim.step(this.data.inputs[this.frame]);
    this.frame++;
    if (this.frame % SNAP_EVERY === 0 && !this.snaps.has(this.frame)) this.snaps.set(this.frame, this.sim.snapshot());
    return ev;
  }

  /** Jumps to an absolute frame (rewind or fast-forward) using the nearest snapshot. */
  seek(target: number): void {
    target = Math.max(0, Math.min(this.length, target));
    let base = 0;
    for (const k of this.snaps.keys()) if (k <= target && k > base) base = k;
    if (target < this.frame || base > this.frame) {
      this.sim.restore(this.snaps.get(base)!);
      this.frame = base;
    }
    while (this.frame < target) this.step();
  }
}

const STORE = 'hustle-rt-replays-v1';

export function loadReplays(): ReplayData[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '[]');
  } catch {
    return [];
  }
}

export function saveReplay(r: ReplayData): void {
  try {
    const all = loadReplays();
    all.unshift(r);
    localStorage.setItem(STORE, JSON.stringify(all.slice(0, 8)));
  } catch {
    /* quota exceeded or storage unavailable: replay stays in memory only */
  }
}

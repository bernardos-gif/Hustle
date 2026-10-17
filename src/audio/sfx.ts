// Procedural sound effects (WebAudio). Every sound is synthesised so no assets are required.
// Sounds are triggered by combat events, with per-character timbre variations.

import type { Sim } from '../combat/sim';
import type { CombatEvent } from '../combat/types';

export type UiSound = 'move' | 'confirm' | 'back' | 'lock' | 'error' | 'pause' | 'unpause';
export type MusicTrack = 'menu' | 'battle' | 'results';

const CHAR_PITCH: Record<string, number> = { vesper: 1.15, mirage: 1.3, solenne: 1.0, bastion: 0.6, riot: 0.95 };

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.5;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (typeof window === 'undefined' || !(window as any).AudioContext) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  unlock(): void {
    this.ensure();
  }

  /** Menu / interface cue. */
  ui(_kind: UiSound): void {
    /* implemented by the audio pass */
  }

  setMusicVolume(_v: number): void {
    /* implemented by the audio pass */
  }

  /** Starts (or crossfades to) a procedural music loop; null stops the music. */
  music(_track: MusicTrack | null): void {
    /* implemented by the audio pass */
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ensure();
    if (!c || !this.noiseBuf || !this.master) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  private tone(dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine'): void {
    const c = this.ensure();
    if (!c || !this.master) return;
    const o = c.createOscillator();
    o.type = type;
    const g = c.createGain();
    const t = c.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  handle(events: CombatEvent[], sim: Sim): void {
    if (!this.enabled) return;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const p = CHAR_PITCH[sim.state.fighters[e.attacker].charId] ?? 1;
          const big = e.super || e.damage > 90;
          this.noise(big ? 0.35 : 0.14, (big ? 900 : 1800) * p, 1.2, big ? 0.9 : 0.6);
          this.tone(big ? 0.3 : 0.12, (big ? 140 : 220) * p, 50, big ? 0.7 : 0.4, 'triangle');
          if (e.spark === 'slash') this.noise(0.1, 5000, 4, 0.35, 'highpass');
          if (e.spark === 'electric') this.tone(0.15, 1600, 400, 0.18, 'sawtooth');
          if (e.spark === 'fire') this.noise(0.3, 600, 0.6, 0.4, 'lowpass');
          if (e.counter) this.tone(0.2, 880, 1320, 0.2, 'square');
          break;
        }
        case 'block':
          this.noise(0.08, 3200, 3, 0.4);
          this.tone(0.06, 600, 500, 0.15, 'square');
          break;
        case 'parry':
          this.tone(0.25, 1400, 2200, 0.35, 'triangle');
          this.tone(0.25, 2100, 3300, 0.2, 'sine');
          break;
        case 'clash':
          this.tone(0.5, 1800, 1700, 0.35, 'square');
          this.noise(0.3, 4000, 2, 0.5);
          break;
        case 'burst':
          this.noise(0.6, 400, 0.5, 0.9, 'lowpass');
          this.tone(0.6, 200, 900, 0.4, 'sawtooth');
          break;
        case 'super':
          this.tone(0.5, 300, 1200, 0.35, 'sawtooth');
          this.noise(0.4, 2000, 1, 0.3);
          break;
        case 'throw':
          this.noise(0.12, 700, 1, 0.5);
          break;
        case 'throwTech':
          this.tone(0.2, 1000, 600, 0.3, 'square');
          break;
        case 'jump':
          this.noise(0.06, 1200, 1, 0.12);
          break;
        case 'dash':
          this.noise(0.12, 2400, 0.8, 0.18, 'highpass');
          break;
        case 'land':
        case 'knockdown':
          this.noise(0.15, 300, 1, e.type === 'knockdown' ? 0.6 : 0.2, 'lowpass');
          break;
        case 'wallBounce':
        case 'groundBounce':
          this.noise(0.3, 200, 1, 0.8, 'lowpass');
          this.tone(0.3, 90, 40, 0.6, 'sine');
          break;
        case 'spawn': {
          const id = e.projectile;
          if (id.includes('bullet')) {
            this.noise(0.12, 2500, 0.7, 0.7);
            this.tone(0.08, 300, 80, 0.4, 'square');
          } else if (id.includes('fire') || id.includes('pillar')) this.noise(0.4, 500, 0.5, 0.4, 'lowpass');
          else if (id.includes('bolt') || id.includes('laser')) this.tone(0.25, 1800, 300, 0.2, 'sawtooth');
          else this.tone(0.15, 500, 900, 0.15, 'triangle');
          break;
        }
        case 'teleport':
          this.tone(0.2, 300, 1600, 0.2, 'sine');
          break;
        case 'moveStart':
          if (e.kind === 'special' || e.kind === 'normal') this.noise(0.05, 3000, 2, 0.08, 'highpass');
          break;
        case 'ko':
          this.tone(1.2, 220, 40, 0.8, 'sawtooth');
          this.noise(0.8, 300, 0.5, 0.8, 'lowpass');
          break;
        case 'round':
          if (e.phase === 'fight') this.tone(0.4, 440, 880, 0.3, 'square');
          else if (e.phase === 'timeout') this.tone(0.8, 330, 110, 0.45, 'square');
          else if (e.phase === 'next') this.noise(0.3, 1500, 0.7, 0.25);
          else if (e.phase === 'over') {
            this.tone(0.25, 523, 523, 0.25, 'square');
            this.tone(0.45, 659, 784, 0.22, 'square');
            this.tone(0.9, 784, 1046, 0.2, 'triangle');
          }
          break;
        case 'armor':
          this.noise(0.18, 250, 1, 0.6, 'lowpass');
          this.tone(0.15, 160, 120, 0.4, 'square');
          break;
        case 'reflect':
          this.tone(0.2, 900, 1800, 0.25, 'triangle');
          break;
        case 'counterStance':
          this.tone(0.3, 660, 1320, 0.3, 'square');
          break;
        case 'tech':
          this.noise(0.08, 1500, 1, 0.2);
          break;
        case 'projClash':
          this.noise(0.2, 3000, 2, 0.4);
          this.tone(0.15, 1200, 900, 0.15, 'square');
          break;
        case 'install':
          if (e.on) this.tone(0.6, 100, 600, 0.4, 'sawtooth');
          break;
        case 'flight':
          if (e.on) this.noise(0.3, 800, 0.5, 0.3, 'lowpass');
          break;
        default:
          break;
      }
    }
  }
}

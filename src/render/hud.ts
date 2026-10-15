// Combat HUD (health, meters, burst, air options, character resources, combo counter, timer)
// and the observational training/debug overlay (boxes, frame data, DI, scaling, inputs).

import { CFG, FPS } from '../combat/config';
import { frameData } from '../combat/registry';
import type { Sim } from '../combat/sim';
import type { CharacterDef, FighterState } from '../combat/types';
import { describeMask, dirVector } from '../core/input';
import { Sim as SimClass } from '../combat/sim';
import { THEME, bar, panel, pip, text, textWidth } from '../ui/kit';
import { portrait } from './portrait';
import type { Camera } from './renderer';
import { VIEW_H, VIEW_W } from './renderer';

type Ctx = CanvasRenderingContext2D;


function txt(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', _weight = 700): void {
  // debug/training text uses the pixel font too (scale 1 for dense data, 2 for labels)
  text(ctx, s, x, y - (size > 14 ? 14 : 7), { scale: size > 14 ? 2 : 1, color, align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left', shadow: '#05030c', shadowOffset: 1 });
}

export class Hud {
  private shownHp = [0, 0];
  private hitFlash = [0, 0];
  private comboShow: { hits: number; damage: number; scale: number; life: number; pop: number }[] = [
    { hits: 0, damage: 0, scale: 1, life: 0, pop: 0 },
    { hits: 0, damage: 0, scale: 1, life: 0, pop: 0 },
  ];
  private bannerText = '';
  private bannerLife = 0;
  private lastPhase = '';
  private phaseAge = 0;

  announce(text: string, frames = 90): void {
    this.bannerText = text;
    this.bannerLife = frames;
  }

  tick(sim: Sim): void {
    for (const f of sim.state.fighters) {
      if (this.shownHp[f.idx] < f.hp || this.shownHp[f.idx] === 0) this.shownHp[f.idx] = f.hp;
      // the red "damage" bar drains once the combo is over
      if (f.combo.hits === 0) this.shownHp[f.idx] = Math.max(f.hp, this.shownHp[f.idx] - 6);
      if (f.lastDamageTaken > 0 && f.hitstop > 0) this.hitFlash[f.idx] = 6;
      else if (this.hitFlash[f.idx] > 0) this.hitFlash[f.idx]--;
      const att = 1 - f.idx;
      const cs = this.comboShow[att];
      if (f.combo.hits >= 2) {
        if (f.combo.hits !== cs.hits) cs.pop = 6;
        cs.hits = f.combo.hits;
        cs.damage = f.combo.damage;
        cs.scale = f.combo.scale;
        cs.life = 90;
      } else if (cs.life > 0) cs.life--;
      if (cs.pop > 0) cs.pop--;
    }
    if (this.bannerLife > 0) this.bannerLife--;
    const ph = sim.state.round.phase;
    if (ph !== this.lastPhase) {
      this.lastPhase = ph;
      this.phaseAge = 0;
    } else this.phaseAge++;
  }

  reset(): void {
    this.shownHp = [0, 0];
    for (const c of this.comboShow) c.life = 0;
  }

  draw(ctx: Ctx, sim: Sim, chars: CharacterDef[], labels: [string, string]): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const s = sim.state;
    for (const f of s.fighters) this.drawSide(ctx, sim, f, chars[f.idx], labels[f.idx]);
    // timer
    const cx = VIEW_W / 2;
    panel(ctx, cx - 54, 10, 108, 78, { fill: THEME.bg0 });
    const secs = Math.max(0, Math.ceil(s.round.timer / FPS));
    const t = s.settings.training ? '--' : String(secs).padStart(2, '0');
    const urgent = !s.settings.training && secs <= 10 && s.round.phase === 'fight';
    text(ctx, t, cx, 22, { scale: 6, align: 'center', color: urgent && Math.floor(s.frame / 15) % 2 ? THEME.red : THEME.text });
    // round wins
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < CFG.roundsToWin; i++) {
        const x = cx + (p === 0 ? -26 - i * 16 : 18 + i * 16);
        ctx.fillStyle = THEME.border;
        ctx.fillRect(x - 1, 95, 10, 10);
        ctx.fillStyle = s.round.wins[p] > i ? THEME.gold : '#33294d';
        ctx.fillRect(x, 96, 8, 8);
      }
    }
    // combo counters
    for (let p = 0; p < 2; p++) {
      const cs = this.comboShow[p];
      if (cs.life <= 0) continue;
      const x = p === 0 ? 40 : VIEW_W - 40;
      const al = p === 0 ? 'left' : 'right';
      const a = Math.min(1, cs.life / 20);
      const sc = 8 + (cs.pop > 3 ? 2 : cs.pop > 0 ? 1 : 0);
      const w = text(ctx, `${cs.hits}`, x, 150 - (sc - 8) * 3, { scale: sc, color: THEME.gold, align: al, alpha: a, shadow: '#7a2c00' });
      text(ctx, 'HITS', p === 0 ? x + w + 10 : x - w - 10, 178, { scale: 3, color: THEME.text, align: al, alpha: a });
      text(ctx, `${cs.damage} DMG`, x, 214, { scale: 3, color: THEME.red, align: al, alpha: a });
      text(ctx, `SCALE ${(cs.scale * 100).toFixed(0)}%`, x, 242, { scale: 2, color: THEME.dim, align: al, alpha: a });
    }
    // round announcements
    const age = this.phaseAge;
    const slam = (str: string, color: string, base: number) => {
      const sc = Math.max(base, base + 6 - age);
      text(ctx, str, cx, 300, { scale: sc, align: 'center', valign: 'middle', color, shadow: '#000000' });
    };
    if (s.round.phase === 'intro') {
      if (s.round.phaseFrames < 40) {
        const x = Math.min(cx, -200 + s.round.phaseFrames * 40);
        text(ctx, `ROUND ${s.round.number}`, x, 300, { scale: 8, align: 'center', valign: 'middle', color: THEME.text });
      } else text(ctx, 'READY', cx, 300, { scale: 8, align: 'center', valign: 'middle', color: THEME.cyan });
    }
    if (s.round.phase === 'fight' && s.round.phaseFrames < 40 && !s.settings.training) slam('FIGHT!', THEME.gold, 12);
    if (s.round.phase === 'ko') {
      const timeout = s.fighters.every((f) => f.hp > 0);
      slam(timeout ? 'TIME' : 'K.O.', THEME.red, 14);
      if (s.round.phaseFrames > 60) text(ctx, s.round.winner < 0 ? 'DRAW' : `${labels[s.round.winner]} WINS THE ROUND`, cx, 380, { scale: 3, align: 'center', color: THEME.text });
    }
    if (s.round.phase === 'over') text(ctx, s.round.matchWinner < 0 ? 'DRAW GAME' : `${labels[s.round.matchWinner]} WINS!`, cx, 250, { scale: 7, align: 'center', color: THEME.gold, shadow: '#7a2c00' });
    if (this.bannerLife > 0) {
      const bw = textWidth(this.bannerText, 2) + 40;
      panel(ctx, cx - bw / 2, 118, bw, 34, { fill: THEME.bg0, alpha: Math.min(1, this.bannerLife / 10) });
      text(ctx, this.bannerText, cx, 128, { scale: 2, align: 'center', color: '#80ffdb', alpha: Math.min(1, this.bannerLife / 10) });
    }
  }

  private drawSide(ctx: Ctx, sim: Sim, f: FighterState, c: CharacterDef, label: string): void {
    const left = f.idx === 0;
    const accent = left ? THEME.p1 : THEME.p2;
    const pw = 86;
    const W = 470;
    const px = left ? 16 : VIEW_W - 16 - pw;
    // portrait
    panel(ctx, px, 10, pw, 86, { fill: '#120b26', edge: accent, cut: 8 });
    const img = portrait(c, left ? 1 : -1);
    ctx.drawImage(img, px + 9, 18, 68, 68);
    // name plate
    const bx = left ? px + pw + 8 : px - 8 - W;
    text(ctx, c.name.toUpperCase(), left ? bx : bx + W, 12, { scale: 3, color: THEME.text, align: left ? 'left' : 'right' });
    text(ctx, label, left ? bx + textWidth(c.name.toUpperCase(), 3) + 12 : bx + W - textWidth(c.name.toUpperCase(), 3) - 12, 18, { scale: 2, color: accent, align: left ? 'left' : 'right' });
    // health
    const ratio = f.hp / f.maxHp;
    const hpCol = this.hitFlash[f.idx] > 3 ? '#ffffff' : ratio < 0.25 ? THEME.red : ratio < 0.5 ? THEME.gold : THEME.green;
    bar(ctx, bx, 40, W, 24, ratio, hpCol, { rtl: left, trail: Math.max(f.hp, this.shownHp[f.idx]) / f.maxHp, trailColor: '#e63946', segments: 10 });
    text(ctx, `${Math.ceil(f.hp)}`, left ? bx + 8 : bx + W - 8, 46, { scale: 2, color: '#0b0718', shadow: null, align: left ? 'left' : 'right' });
    // burst
    const full = f.burst >= CFG.burst.max;
    const bw = 190;
    const bbx = left ? bx + W - bw : bx;
    bar(ctx, bbx, 74, bw, 8, f.burst / CFG.burst.max, full ? (Math.floor(sim.state.frame / 8) % 2 ? '#ffffff' : c.palette.aura) : '#6c5ba7', { rtl: left });
    text(ctx, full ? 'BURST READY' : 'BURST', left ? bbx - 10 : bbx + bw + 10, 72, { scale: 2, color: full ? THEME.text : THEME.faint, align: left ? 'right' : 'left' });

    // bottom: super meter
    const mw = 330;
    const mx = left ? 24 : VIEW_W - 24 - mw;
    const my = VIEW_H - 40;
    const lvl = Math.floor(f.meter / CFG.meter.perBar);
    const part = (f.meter % CFG.meter.perBar) / CFG.meter.perBar;
    for (let i = 0; i < 3; i++) {
      const segW = (mw - 16) / 3;
      const sx = left ? mx + i * (segW + 8) : mx + (2 - i) * (segW + 8);
      const v = i < lvl ? 1 : i === lvl ? part : 0;
      bar(ctx, sx, my, segW, 14, v, i < lvl ? THEME.cyan : '#3a6fd8', { rtl: !left });
    }
    const lx = left ? mx + mw + 30 : mx - 30;
    panel(ctx, lx - 22, my - 22, 44, 44, { fill: THEME.bg0, edge: lvl > 0 ? THEME.cyan : THEME.edge, cut: 6 });
    text(ctx, `${lvl}`, lx, my + 1, { scale: 4, align: 'center', valign: 'middle', color: lvl > 0 ? THEME.cyan : THEME.faint });
    text(ctx, 'SUPER', left ? mx : mx + mw, my - 18, { scale: 2, color: '#9ad1ff', align: left ? 'left' : 'right' });

    // air options, feints and character resources
    let rx = left ? 24 : VIEW_W - 24;
    const ry = VIEW_H - 84;
    const dir = left ? 1 : -1;
    const pips = (n: number, max: number, color: string, name: string) => {
      const lw = text(ctx, name, rx, ry - 6, { scale: 2, color: THEME.dim, align: left ? 'left' : 'right' });
      for (let i = 0; i < max; i++) pip(ctx, rx + dir * (lw + 14 + i * 16), ry + 1, i < n, color);
      rx += dir * (lw + 14 + max * 16 + 16);
    };
    if (c.maxAirOptions > 0) pips(f.airOptions, c.maxAirOptions, '#80ffdb', 'AIR');
    pips(f.feints, CFG.feint.max, '#e9c46a', 'FEINT');
    for (const r of c.resources) {
      const v = f.resources[r.name];
      if (r.display === 'pips') pips(Math.floor(v), r.max, r.color, r.label);
      else {
        const lw = text(ctx, r.label, rx, ry - 6, { scale: 2, color: THEME.dim, align: left ? 'left' : 'right' });
        const w = 110;
        const x0 = left ? rx + lw + 12 : rx - lw - 12 - w;
        bar(ctx, x0, ry - 4, w, 10, v / r.max, r.color, { rtl: !left });
        rx += dir * (lw + 12 + w + 16);
      }
    }
    const tags: string[] = [];
    if (f.install) tags.push(`OVERDRIVE ${(f.install.frames / FPS).toFixed(1)}S`);
    if (f.stance) tags.push('DRAW STANCE');
    if (f.flying) tags.push('FLIGHT');
    if (f.burstPunishable > 0 && f.moveId === 'burst') tags.push('BURST RECOVERY');
    if (tags.length) text(ctx, tags.join(' · '), left ? 24 : VIEW_W - 24, VIEW_H - 118, { scale: 2, color: THEME.gold, align: left ? 'left' : 'right' });
  }
}

// ------------------------------------------------------------------ debug / training overlay

const predictor = { sim: null as SimClass | null, key: '' };

export function drawDebug(ctx: Ctx, sim: Sim, cam: Camera, chars: CharacterDef[], opts: { boxes: boolean; frameData: boolean; di: boolean; inputs: boolean }): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const s = sim.state;
  const toS = (x: number, y: number) => cam.toScreen(x, y);
  const rect = (b: { x: number; y: number; w: number; h: number }, stroke: string, fill: string) => {
    const a = toS(b.x, b.y + b.h);
    const w = b.w * cam.zoom;
    const h = b.h * cam.zoom;
    ctx.fillStyle = fill;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, w, h);
  };
  if (opts.boxes) {
    for (const f of s.fighters) {
      const c = chars[f.idx];
      rect({ x: f.x - c.width / 2, y: f.y, w: c.width, h: f.crouching ? c.crouchHeight : c.height }, '#ffd60a88', 'rgba(0,0,0,0)');
      for (const h of sim.hurtboxes(f)) rect(h, '#4cc9f0', 'rgba(76,201,240,0.18)');
      for (const ah of sim.activeHits(f)) for (const b of ah.boxes) rect(b, '#ff4d6d', 'rgba(255,77,109,0.35)');
      const m = sim.move(f);
      if (m?.throw && f.moveFrame >= m.throw.frames[0] && f.moveFrame <= m.throw.frames[1]) rect(sim.toWorld(f, m.throw.box), '#80ffdb', 'rgba(128,255,219,0.3)');
      if (m?.reflect && f.moveFrame >= m.reflect.frames[0] && f.moveFrame <= m.reflect.frames[1]) rect(sim.toWorld(f, m.reflect.box), '#ffffff', 'rgba(255,255,255,0.2)');
      const o = toS(f.x, f.y);
      ctx.fillStyle = '#fff';
      ctx.fillRect(o.x - 3, o.y - 1, 6, 2);
    }
    for (const p of s.projectiles) {
      const def = sim.projDef(p.owner, p.defId);
      const active = def && !def.inert && p.age >= (def.delay ?? 0);
      rect(sim.projBox(p), active ? '#ff9f1c' : '#888', active ? 'rgba(255,159,28,0.3)' : 'rgba(128,128,128,0.15)');
    }
  }

  if (opts.di) {
    for (const f of s.fighters) {
      const stunned = f.state === 'launched' || f.state === 'hitstun' || f.pendingKB !== null;
      if (!stunned) continue;
      const v = dirVector(f.input.cur);
      const o = toS(f.x, f.y + 60);
      ctx.strokeStyle = '#80ffdb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 26, 0, Math.PI * 2);
      ctx.stroke();
      if (v.x || v.y) {
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + v.x * 26, o.y - v.y * 26);
        ctx.stroke();
      }
      txt(ctx, 'DI', o.x, o.y - 32, 12, '#80ffdb', 'center', 900);
      // predicted trajectory: run a throwaway copy of the simulation forward with current inputs held
      if (f.state === 'launched' || f.pendingKB) {
        if (!predictor.sim || predictor.key !== sim.charIds.join()) {
          predictor.sim = new SimClass({ chars: sim.charIds, seed: 1 });
          predictor.key = sim.charIds.join();
        }
        const ps = predictor.sim;
        ps.restore(s);
        const inputs: [number, number] = [s.fighters[0].input.cur, s.fighters[1].input.cur];
        inputs[1 - f.idx] = 0;
        ctx.fillStyle = '#80ffdb';
        for (let i = 0; i < 45; i++) {
          ps.step(inputs);
          const pf = ps.state.fighters[f.idx];
          if (i % 2 === 0) {
            const p = toS(pf.x, pf.y + 60);
            ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
          }
          if (pf.state !== 'launched') break;
        }
      }
    }
  }

  if (opts.frameData) {
    for (const f of s.fighters) {
      const left = f.idx === 0;
      const x = left ? 20 : VIEW_W - 340;
      let y = 120;
      panel(ctx, x, y - 6, 320, 248, { fill: 'rgba(14,9,30,0.88)', cut: 5 });
      const line = (t: string, color = '#ddd') => {
        txt(ctx, t, x + 10, (y += 17), 13, color, 'left', 600);
      };
      const m = sim.move(f);
      line(`${chars[f.idx].name} — ${f.state}${f.stance ? ` [${f.stance}]` : ''}${f.flying ? ' [flying]' : ''}`, '#ffd60a');
      if (m) {
        const fd = frameData(m);
        line(`${m.name} (${m.id}) frame ${f.moveFrame}/${m.total}${f.moveCharge ? ` charge ${f.moveCharge}` : ''}`);
        line(`startup ${fd.startup}  active ${fd.active}  recovery ${fd.recovery}  result ${f.moveResult}`);
        const inv = m.invuln?.filter((iv) => f.moveFrame >= iv.frames[0] && f.moveFrame <= iv.frames[1]).flatMap((iv) => iv.types) ?? [];
        const arm = m.armor && f.moveFrame >= m.armor.frames[0] && f.moveFrame <= m.armor.frames[1] && f.moveArmorHits > 0;
        line(`invuln: ${inv.join(',') || '-'}   armor: ${arm ? f.moveArmorHits : '-'}`);
        const cn = m.cancels;
        const win = cn?.window;
        line(`cancels: ${cn ? `${win ? `[${win[0]}-${win[1]}] ` : ''}hit:${(cn.onHit ?? []).join('/') || '-'} whiff:${(cn.onWhiff ?? []).join('/') || '-'}` : 'none'}`);
        const cost = m.cost;
        line(`cost: ${cost ? JSON.stringify(cost).replace(/["{}]/g, '') : '-'}`);
        // frame bar
        const bx = x + 10;
        const by = y + 8;
        const w = Math.min(300 / m.total, 6);
        for (let i = 1; i <= m.total; i++) {
          const active = m.hits?.some((h) => i >= h.frames[0] && i <= h.frames[1]) || (m.throw && i >= m.throw.frames[0] && i <= m.throw.frames[1]);
          const st = i <= fd.startup;
          ctx.fillStyle = active ? '#ff4d6d' : st ? '#06d6a0' : '#3a86ff';
          if (i === f.moveFrame) ctx.fillStyle = '#fff';
          ctx.fillRect(bx + (i - 1) * w, by, Math.max(1, w - 1), 10);
        }
        y += 18;
      } else {
        line(`hitstun ${f.hitstun}  blockstun ${f.blockstun}  hitstop ${f.hitstop}`);
        line(`state frame ${f.stateFrame}  invuln ${f.wakeInvuln || f.airRecoverInvuln ? 'yes' : 'no'}`);
        line('');
        line('');
        line('');
        y += 18;
      }
      line(`adv ${f.advantage === null ? '-' : (f.advantage > 0 ? '+' : '') + f.advantage}   meter ${f.meter.toFixed(0)}  burst ${f.burst.toFixed(0)}`);
      const cb = sim.opp(f).combo;
      line(`combo ${cb.hits}h ${cb.damage}dmg scale ${(cb.scale * 100).toFixed(0)}% ${cb.frames}f wb${cb.wallBounces} gb${cb.groundBounces}`);
      if (f.lastDI) line(`DI in(${f.lastDI.input.x.toFixed(1)},${f.lastDI.input.y.toFixed(1)}) str ${f.lastDI.strength.toFixed(2)} v(${f.lastDI.before.x.toFixed(1)},${f.lastDI.before.y.toFixed(1)})→(${f.lastDI.after.x.toFixed(1)},${f.lastDI.after.y.toFixed(1)})`, '#80ffdb');
      else line('DI -');
      line(`vel (${f.vx.toFixed(1)}, ${f.vy.toFixed(1)}) pos (${f.x.toFixed(0)}, ${f.y.toFixed(0)})`);
    }
  }

  if (opts.inputs) {
    for (const f of s.fighters) {
      const left = f.idx === 0;
      const hist = f.input.history.slice(-14);
      const runs: { m: number; n: number }[] = [];
      for (const m of hist) {
        const last = runs[runs.length - 1];
        if (last && last.m === m) last.n++;
        else runs.push({ m, n: 1 });
      }
      let y = 380;
      for (const r of runs.reverse().slice(0, 10)) {
        txt(ctx, `${describeMask(r.m).replace(/^5$/, '·')} ${r.n}`, left ? 20 : VIEW_W - 20, (y += 16), 13, '#cfc', left ? 'left' : 'right', 600);
      }
      const buf = Object.entries(f.input.press).filter(([, v]) => v >= 0).map(([k, v]) => `${k}${v}`).join(' ');
      txt(ctx, `buffer: ${buf || '-'}`, left ? 20 : VIEW_W - 20, y + 20, 12, '#9ad1ff', left ? 'left' : 'right', 600);
    }
  }
}

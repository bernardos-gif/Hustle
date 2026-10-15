// Combat HUD (health, meters, burst, air options, character resources, combo counter, timer)
// and the observational training/debug overlay (boxes, frame data, DI, scaling, inputs).

import { CFG, FPS } from '../combat/config';
import { frameData } from '../combat/registry';
import type { Sim } from '../combat/sim';
import type { CharacterDef, FighterState } from '../combat/types';
import { describeMask, dirVector } from '../core/input';
import { Sim as SimClass } from '../combat/sim';
import type { Camera } from './renderer';
import { VIEW_H, VIEW_W } from './renderer';

type Ctx = CanvasRenderingContext2D;

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

function txt(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 700): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

export class Hud {
  private shownHp = [0, 0];
  private comboShow: { hits: number; damage: number; scale: number; life: number }[] = [
    { hits: 0, damage: 0, scale: 1, life: 0 },
    { hits: 0, damage: 0, scale: 1, life: 0 },
  ];
  private bannerText = '';
  private bannerLife = 0;

  announce(text: string, frames = 70): void {
    this.bannerText = text;
    this.bannerLife = frames;
  }

  tick(sim: Sim): void {
    for (const f of sim.state.fighters) {
      if (this.shownHp[f.idx] < f.hp || this.shownHp[f.idx] === 0) this.shownHp[f.idx] = f.hp;
      // the red "damage" bar drains once the combo is over
      if (f.combo.hits === 0) this.shownHp[f.idx] = Math.max(f.hp, this.shownHp[f.idx] - 6);
      const att = 1 - f.idx;
      const cs = this.comboShow[att];
      if (f.combo.hits >= 2) {
        cs.hits = f.combo.hits;
        cs.damage = f.combo.damage;
        cs.scale = f.combo.scale;
        cs.life = 90;
      } else if (cs.life > 0) cs.life--;
    }
    if (this.bannerLife > 0) this.bannerLife--;
  }

  reset(): void {
    this.shownHp = [0, 0];
    for (const c of this.comboShow) c.life = 0;
  }

  draw(ctx: Ctx, sim: Sim, chars: CharacterDef[], labels: [string, string]): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const s = sim.state;
    for (const f of s.fighters) this.drawSide(ctx, sim, f, chars[f.idx], labels[f.idx]);
    // timer
    const t = s.settings.training ? '∞' : String(Math.max(0, Math.ceil(s.round.timer / FPS)));
    ctx.fillStyle = 'rgba(10,8,25,0.85)';
    ctx.fillRect(VIEW_W / 2 - 42, 14, 84, 58);
    txt(ctx, t, VIEW_W / 2, 58, 40, '#fff', 'center', 900);
    // round pips
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < CFG.roundsToWin; i++) {
        const x = VIEW_W / 2 + (p === 0 ? -60 - i * 18 : 60 + i * 18);
        ctx.fillStyle = s.round.wins[p] > i ? '#ffd60a' : '#33294d';
        ctx.beginPath();
        ctx.arc(x, 84, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // combo counters
    for (let p = 0; p < 2; p++) {
      const cs = this.comboShow[p];
      if (cs.life <= 0) continue;
      const x = p === 0 ? 360 : VIEW_W - 360;
      const al = p === 0 ? 'left' : 'right';
      ctx.globalAlpha = Math.min(1, cs.life / 20);
      txt(ctx, `${cs.hits}`, x, 170, 60, '#ffd60a', al, 900);
      txt(ctx, 'HITS', x + (p === 0 ? 1 : -1) * (cs.hits >= 10 ? 74 : 40), 170, 22, '#fff', al, 900);
      txt(ctx, `${cs.damage} DMG`, x, 198, 20, '#ff4d6d', al, 800);
      txt(ctx, `scale ${(cs.scale * 100).toFixed(0)}%`, x, 220, 14, '#bbb', al, 600);
      ctx.globalAlpha = 1;
    }
    // round announcements
    if (s.round.phase === 'intro') txt(ctx, s.round.phaseFrames < 40 ? `ROUND ${s.round.number}` : 'FIGHT!', VIEW_W / 2, 330, 72, '#fff', 'center', 900);
    if (s.round.phase === 'fight' && s.round.phaseFrames < 30 && !s.settings.training) txt(ctx, 'FIGHT!', VIEW_W / 2, 330, 72, '#ffd60a', 'center', 900);
    if (s.round.phase === 'ko') {
      const timeout = s.fighters.every((f) => f.hp > 0);
      txt(ctx, timeout ? 'TIME' : 'K.O.', VIEW_W / 2, 330, 96, '#ff4d6d', 'center', 900);
      if (s.round.phaseFrames > 60) txt(ctx, s.round.winner < 0 ? 'DRAW' : `${labels[s.round.winner]} WINS THE ROUND`, VIEW_W / 2, 380, 28, '#fff', 'center', 800);
    }
    if (s.round.phase === 'over') {
      txt(ctx, s.round.matchWinner < 0 ? 'DRAW GAME' : `${labels[s.round.matchWinner]} WINS!`, VIEW_W / 2, 320, 64, '#ffd60a', 'center', 900);
    }
    if (this.bannerLife > 0) txt(ctx, this.bannerText, VIEW_W / 2, 140, 22, '#80ffdb', 'center', 800);
  }

  private drawSide(ctx: Ctx, sim: Sim, f: FighterState, c: CharacterDef, label: string): void {
    const left = f.idx === 0;
    const W = 500;
    const x0 = left ? 30 : VIEW_W - 30 - W;
    const dir = left ? 1 : -1;
    // health
    ctx.fillStyle = 'rgba(10,8,25,0.85)';
    ctx.fillRect(x0 - 4, 20, W + 8, 34);
    const hpw = (f.hp / f.maxHp) * W;
    const redw = (Math.max(f.hp, this.shownHp[f.idx]) / f.maxHp) * W;
    ctx.fillStyle = '#e63946';
    ctx.fillRect(left ? x0 + W - redw : x0, 24, redw, 26);
    const g = ctx.createLinearGradient(0, 24, 0, 50);
    const low = f.hp < f.maxHp * 0.3;
    g.addColorStop(0, low ? '#ffb703' : '#80ffdb');
    g.addColorStop(1, low ? '#fb8500' : '#06d6a0');
    ctx.fillStyle = g;
    ctx.fillRect(left ? x0 + W - hpw : x0, 24, hpw, 26);
    txt(ctx, `${label}  ${c.name.toUpperCase()}`, left ? x0 : x0 + W, 78, 18, '#fff', left ? 'left' : 'right', 900);
    txt(ctx, `${Math.ceil(f.hp)}`, left ? x0 + W - 6 : x0 + 6, 44, 16, '#0b0a14', left ? 'right' : 'left', 900);

    // burst gauge
    const bw = 180;
    const bx = left ? x0 + W - bw : x0;
    ctx.fillStyle = '#1b1530';
    ctx.fillRect(bx, 60, bw, 9);
    const full = f.burst >= CFG.burst.max;
    ctx.fillStyle = full ? (Math.floor(sim.state.frame / 8) % 2 ? '#ffffff' : c.palette.aura) : '#6c5ba7';
    const bfill = (f.burst / CFG.burst.max) * bw;
    ctx.fillRect(left ? bx + bw - bfill : bx, 60, bfill, 9);
    txt(ctx, full ? 'BURST READY' : 'BURST', left ? bx - 6 : bx + bw + 6, 69, 11, full ? '#fff' : '#9a8cc7', left ? 'right' : 'left', 800);

    // super meter (bottom)
    const mx = left ? 30 : VIEW_W - 30 - 360;
    const my = VIEW_H - 46;
    const lvl = Math.floor(f.meter / CFG.meter.perBar);
    ctx.fillStyle = 'rgba(10,8,25,0.85)';
    ctx.fillRect(mx - 4, my - 4, 368, 26);
    for (let i = 0; i < 3; i++) {
      const sx = left ? mx + i * 120 : mx + (2 - i) * 120;
      const v = Math.max(0, Math.min(1, (f.meter - i * CFG.meter.perBar) / CFG.meter.perBar));
      ctx.fillStyle = '#251d40';
      ctx.fillRect(sx, my, 116, 18);
      ctx.fillStyle = v >= 1 ? '#4cc9f0' : '#3a86ff88';
      ctx.fillRect(left ? sx : sx + 116 - 116 * v, my, 116 * v, 18);
    }
    txt(ctx, `${lvl}`, left ? mx + 380 : mx - 18, my + 18, 30, lvl > 0 ? '#4cc9f0' : '#555', 'center', 900);
    txt(ctx, 'SUPER', left ? mx : mx + 360, my - 8, 12, '#9ad1ff', left ? 'left' : 'right', 800);

    // air options + feints + char resources
    let rx = left ? 30 : VIEW_W - 30;
    let ry = VIEW_H - 74;
    const pip = (n: number, max: number, color: string, labelText: string) => {
      txt(ctx, labelText, rx, ry + 5, 11, '#ccc', left ? 'left' : 'right', 800);
      const lw = 52;
      for (let i = 0; i < max; i++) {
        const px = rx + dir * (lw + i * 16);
        ctx.fillStyle = i < n ? color : '#2b2245';
        ctx.beginPath();
        ctx.moveTo(px, ry - 6);
        ctx.lineTo(px + 6, ry);
        ctx.lineTo(px, ry + 6);
        ctx.lineTo(px - 6, ry);
        ctx.fill();
      }
      rx += dir * (lw + max * 16 + 20);
    };
    if (c.maxAirOptions > 0) pip(f.airOptions, c.maxAirOptions, '#80ffdb', 'AIR');
    pip(f.feints, CFG.feint.max, '#e9c46a', 'FEINT');
    for (const r of c.resources) {
      const v = f.resources[r.name];
      if (r.display === 'pips') pip(Math.floor(v), r.max, r.color, r.label);
      else {
        txt(ctx, r.label, rx, ry + 5, 11, '#ccc', left ? 'left' : 'right', 800);
        const w = 110;
        const bx2 = left ? rx + 44 : rx - 44 - w;
        ctx.fillStyle = '#2b2245';
        ctx.fillRect(bx2, ry - 5, w, 10);
        ctx.fillStyle = r.color;
        const fw = (v / r.max) * w;
        ctx.fillRect(left ? bx2 : bx2 + w - fw, ry - 5, fw, 10);
        rx += dir * (44 + w + 20);
      }
    }
    // status tags
    const tags: string[] = [];
    if (f.install) tags.push(`OVERDRIVE ${(f.install.frames / FPS).toFixed(1)}s`);
    if (f.stance) tags.push('DRAW STANCE');
    if (f.flying) tags.push('FLIGHT');
    if (f.burstPunishable > 0 && f.moveId === 'burst') tags.push('BURST RECOVERY');
    if (tags.length) txt(ctx, tags.join('  ·  '), left ? 30 : VIEW_W - 30, VIEW_H - 98, 14, '#ffd60a', left ? 'left' : 'right', 900);
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
      ctx.fillStyle = 'rgba(5,5,15,0.78)';
      ctx.fillRect(x, y, 320, 238);
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

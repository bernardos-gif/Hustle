// Gameplay smoke test in a real browser: builds are served with `vite preview`, then the
// script drives menus, runs CPU vs CPU and training matches, checks for console errors,
// verifies the simulation advances at 60 steps/s and saves screenshots.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const outDir = process.env.SMOKE_OUT ?? 'smoke-output';
mkdirSync(outDir, { recursive: true });
const port = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
};

try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/01-title.png` });

  // CPU vs CPU match through the real menus
  await page.evaluate(() => window.__app.startMatch('watch', 'riot', 'bastion'));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${outDir}/02-cpu-vs-cpu.png` });
  const st = await page.evaluate(() => ({ sps: window.__app.sps, frame: window.__app.sim.state.frame, hp: window.__app.sim.state.fighters.map((f) => f.hp), max: window.__app.sim.state.fighters.map((f) => f.maxHp), errs: window.__app.errors }));
  check(st.sps >= 55 && st.sps <= 62, `simulation runs at ~60 steps/s (got ${st.sps})`);
  check(st.hp[0] < st.max[0] || st.hp[1] < st.max[1], `CPUs deal damage (hp ${st.hp.join('/')})`);
  check(st.errs.length === 0, `no app errors (${st.errs.join(';')})`);

  // Training: keyboard-driven jab into the dummy
  await page.evaluate(() => window.__app.startMatch('training', 'vesper', 'solenne'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__app.sim;
    s.state.fighters[0].x = 650;
    s.state.fighters[1].x = 720;
    window.__app.training.boxes = true;
  });
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(80);
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(400);
  const comboDmg = await page.evaluate(() => window.__app.sim.state.fighters[1].stats.hitsLanded + window.__app.sim.state.fighters[0].stats.hitsLanded);
  check(comboDmg >= 1, `keyboard input lands hits in training (${comboDmg})`);
  await page.keyboard.down('KeyS');
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(160);
  await page.keyboard.up('KeyS');
  await page.screenshot({ path: `${outDir}/03-training-boxes.png` });

  // Super + effects screenshot (wait out the launcher's recovery first: the buffer is only 8 frames)
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const s = window.__app.sim;
    s.state.fighters[0].x = 640;
    s.state.fighters[1].x = 730;
  });
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(820);
  const superStarted = await page.evaluate(() => window.__app.sim.state.fighters[0].stats.supers);
  check(superStarted === 1, `super activates from keyboard (${superStarted})`);
  await page.screenshot({ path: `${outDir}/04-super.png` });

  // Move list and options screens render
  await page.evaluate(() => {
    window.__app.screen = 'movelist';
    window.__app.mlChar = 3;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/05-movelist.png` });

  // Replay: play a short CPU match, then open its replay
  await page.evaluate(() => window.__app.startMatch('watch', 'mirage', 'solenne'));
  await page.waitForTimeout(3000);
  const ok = await page.evaluate(() => {
    const app = window.__app;
    const data = app.recorder.data;
    app.openReplay(structuredClone(data));
    app.rp.seek(data.inputs.length);
    const a = app.rp.sim.state.fighters.map((f) => `${f.x.toFixed(2)},${f.hp},${f.state}`).join('|');
    const b = app.sim.state.fighters.map((f) => `${f.x.toFixed(2)},${f.hp},${f.state}`).join('|');
    app.rp.seek(60);
    return { a, b };
  });
  check(ok.a === ok.b, `replay reproduces the live match (${ok.a} vs ${ok.b})`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/06-replay.png` });
  check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);

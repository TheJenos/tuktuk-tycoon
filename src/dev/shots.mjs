// DEV TOOL: drives the scene harness (scene.html) in headless Chromium and prints behaviour checks, saving
// screenshots to <outDir>. Run: node src/dev/shots.mjs <outDir> [query, default "quality=high"]; with board=heroes
// it also checks the Hero die's faces and plays a Titan Smash.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
const query = process.argv[3] ?? 'quality=high';
const server = await createServer({ server: { port: 5400 + Math.floor(Math.random() * 400) }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.addInitScript(() => {
  window.rafCount = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => (window.rafCount++, raf(cb));
});
await page.goto(`${server.resolvedUrls.local[0]}src/dev/scene.html?${query}`);
await page.waitForFunction(() => !!window.harness && document.querySelector('canvas'), null, { timeout: 60000 });
await page.waitForTimeout(4000);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const idleRafs = await page.evaluate(async () => {
  const a = window.rafCount;
  await new Promise((r) => setTimeout(r, 2000));
  return window.rafCount - a;
});
console.log('frames requested in 2 s idle:', idleRafs);
await shot('1-overview');

// A turn: the dice, the walk, the drawn card (the harness rigs the first roll onto Chance)
await page.evaluate(() => window.harness.step());
await page.waitForTimeout(400);
await shot('2-dice');
await page.waitForFunction(() => window.cardAt !== undefined, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(500);
await shot('3-card');
await page.waitForFunction(() => window.harness.director.idle.get(), null, { timeout: 30000 });
for (const tile of [39, 10, 18]) {
  await page.evaluate((t) => window.harness.director.api('camera').focus(t, new AbortController().signal), tile);
  await page.waitForTimeout(2000);
  await shot(`4-tile${tile}`);
}
await page.evaluate(() => window.harness.director.api('camera').focus(null, new AbortController().signal));
await page.waitForTimeout(2000);

// Pointing at tiles through the one picking plane, and the picker's highlights
await page.mouse.move(965, 640);
await page.waitForTimeout(600);
const hoverGo = await page.evaluate(() => window.harness.ui.get().hover);
await page.mouse.move(640, 360);
await page.waitForTimeout(600);
console.log('hover over GO:', hoverGo, '/ over the middle:', await page.evaluate(() => window.harness.ui.get().hover));
await page.evaluate(() => window.harness.ui.update({ picker: { kind: 'space', legal: [5, 6, 8, 9, 11, 12], ghost: 8 } }));
await page.waitForTimeout(2500);
await shot('5-picker');
await page.evaluate(() => window.harness.ui.update({ picker: null }));

// Every throw shows the engine's values (the last throw of each step: the dice, or on Hero League the Hero die)
const rolls = await page.evaluate(async () => {
  const h = window.harness;
  const res = [];
  const lastThrow = () => h.director.view.get().log.findLast((e) => (e.ev.t === 'dice' && e.ev.purpose !== 'order') || e.ev.t === 'heroDie');
  for (let i = 0; i < 30; i++) {
    const before = lastThrow();
    h.step();
    await new Promise((r) => { const t = setInterval(() => h.director.idle.get() && (clearInterval(t), r()), 50); });
    const last = lastThrow();
    if (!last || last === before) continue;
    const d = last.ev;
    const want = d.t === 'heroDie' ? [d.hero] : [...d.w, ...(d.s === undefined ? [] : [d.s])];
    res.push({ want: want.join(), shown: h.dice().join() });
  }
  return res;
});
console.log('rolls checked:', rolls.length, 'mismatches:', JSON.stringify(rolls.filter((r) => r.want !== r.shown)));

if (query.includes('board=heroes')) {
  // Every Hero-die face lands on its hero, and a Titan Smash leaps two heroes across the board
  const faces = await page.evaluate(async () => {
    const h = window.harness;
    const out = [];
    for (let f = 1; f <= 6; f++) {
      await h.heroDie(f);
      out.push(h.dice().join());
    }
    return out;
  });
  console.log('hero die faces:', faces.join(' '));
  await page.evaluate(() => window.harness.director.fastForward());
  const smashed = await page.evaluate(() => {
    const h = window.harness;
    for (let i = 0; i < 200 && !(h.state().phase.k === 'preRoll' && !h.state().turn.roll && h.state().turn.seat === 's0'); i++) h.step();
    return h.smash();
  });
  await page.waitForTimeout(700);
  await shot('7-smash');
  console.log('titan smash:', smashed);
}

const lost = await page.evaluate(async () => {
  const ext = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
  ext.loseContext();
  await new Promise((r) => setTimeout(r, 500));
  const during = window.harness.ui.get().gl;
  ext.restoreContext();
  await new Promise((r) => setTimeout(r, 2000));
  return `${during} -> ${window.harness.ui.get().gl}`;
});
console.log('context loss:', lost);
await page.waitForTimeout(1500);
await shot('6-restored');
console.log(logs.filter((l) => !l.includes('THREE.Clock')).slice(0, 20).join('\n'));
await browser.close();
await server.close();

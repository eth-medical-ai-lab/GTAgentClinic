/**
 * End-to-end smoke test + screenshots: boots the real server, plays a few steps in
 * headless Chromium, saves screenshots. Usage: npx tsx tests/e2e-screenshots.ts [outDir] [--llm=offline]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots';
const llm = (process.argv.find((a) => a.startsWith('--llm=')) ?? '--llm=offline').split('=')[1];
const PORT = 5420 + Math.floor(Math.random() * 50);
mkdirSync(out, { recursive: true });

// spawn node directly (not via npx) so kill() reaches the server itself and no orphan is left behind
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), 'server/index.ts', '--port', String(PORT), '--llm', llm], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start:\n' + log)), 30000);
  const iv = setInterval(() => {
    if (log.includes('[server]')) {
      clearInterval(iv);
      clearTimeout(t);
      resolve();
    }
  }, 200);
});
console.log(log.trim());

// default: new headless mode on the real GPU (WebGPU on macOS/Windows); --swiftshader tests the CPU-rasterizer fallback
const browser = process.argv.includes('--swiftshader')
  ? await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  : await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name: string, p: Page = page) => {
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log(`📸 ${out}/${name}.png`);
};
const ac = (fn: string) => page.evaluate(fn);

await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
await page.waitForSelector('.menu-maps .map-card');
await page.waitForTimeout(800);
await shot('01-menu');

await page.click('text=Night Shift');
await page.click('button.start');
await page.waitForSelector('.hud-clock', { timeout: 15000 });
await page.waitForTimeout(4000);
await shot('02-first-person');

// jump ahead so patients arrive (Brunner +4, Keller +12)
await ac(`__ac.client.act({ type: 'wait', minutes: 14 })`);
await page.waitForTimeout(2500);
await ac(`__ac.store.set({ camera: 'top' })`);
await page.waitForTimeout(2500);
await shot('03-top-down');
await ac(`__ac.store.set({ camera: 'third' })`);
await page.waitForTimeout(2000);
await shot('04-third-person');

await page.keyboard.press('Tab');
await page.waitForTimeout(800);
await shot('05-tablet');
await page.keyboard.press('Escape');

// talk to the septic patient
const view = await page.evaluate(`__ac.store.get().view`) as { board: { id: string; bed: string }[] };
const brunner = view.board.find((r) => r.id === 'p_brunner');
if (brunner) {
  await ac(`__ac.client.act({ type: 'move', to: 'bed_4' })`);
  // stand at the foot of the bed in 3D too (talking needs you within earshot)
  await ac(`__acWorld.teleport(14, 4.1, 180)`);
  await page.waitForTimeout(400);
  await ac(`__ac.store.set({ camera: 'first', panel: { kind: 'npc', npcId: 'pt_p_brunner', tab: 'talk' } })`);
  await page.waitForTimeout(500);
  await page.fill('.chat-input textarea', "Hello Mrs. Brunner, I'm one of the doctors. Do you know where you are?");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(llm === 'offline' ? 1200 : 9000);
  await page.fill('.chat-input textarea', 'Does it burn when you pass urine?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(llm === 'offline' ? 1200 : 9000);
  await shot('06-talk-patient');
  await page.click('text=🩺 Examine');
  await page.click('text=Costovertebral angle tenderness');
  await page.waitForTimeout(600);
  await page.click('text=Delirium screen (CAM)');
  await page.waitForTimeout(800);
  await shot('07-exam');
}
// EHR: order sepsis labs
await ac(`__ac.client.act({ type: 'move', to: 'station' })`);
for (const code of ['lactate', 'bcx', 'cbc', 'cmp', 'ua', 'vitals_now']) await ac(`__ac.client.act({ type: 'order', patientId: 'p_brunner', code: '${code}' })`);
await ac(`__ac.client.act({ type: 'wait', minutes: 60 })`);
await page.waitForTimeout(1500);
await ac(`__ac.store.set({ panel: { kind: 'ehr', patientId: 'p_brunner', section: 'results' } })`);
await page.waitForTimeout(1500);
await shot('08-ehr-results');
await ac(`__ac.store.set({ panel: { kind: 'phone' } })`);
await page.waitForTimeout(500);
await page.click('text=Maple Street Family Medicine');
await page.waitForTimeout(800);
await page.fill('.chat-input textarea', 'Hi, this is the ED resident at AgentClinic General calling about Margarethe Brunner, date of birth February 11, 1945. Any prior urine cultures?');
await page.keyboard.press('Enter');
await page.waitForTimeout(llm === 'offline' ? 1500 : 10000);
await shot('09-phone-gp');

// end and debrief
await page.keyboard.press('Escape');
await ac(`__ac.client.act({ type: 'end_shift' })`);
await page.waitForSelector('.debrief', { timeout: 15000 });
await page.waitForTimeout(800);
await shot('10-debrief');

console.log(errors.length ? `⚠ browser errors:\n${errors.slice(0, 20).join('\n')}` : '✓ no browser errors');
await browser.close();
server.kill();
console.log(log.split('\n').filter((l) => /error|warn|\[npc\]/i.test(l)).slice(0, 20).join('\n'));
process.exit(0);

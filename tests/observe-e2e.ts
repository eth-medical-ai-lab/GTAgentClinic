/**
 * End-to-end check of observe mode on the real GPU, with the free scripted demo agent (no tokens):
 * boots a server, starts "Watch an AI doctor" from the main menu. The watcher, a med student,
 * starts on their own, tags along behind the ai_doctor NPC (T), breaks off with WASD, then follows
 * it between the station, the phone and bedsides. At a bedside the watcher talks to the patient,
 * off the record (and tries to give an order); the transcript panel is minimized to its chip (R,
 * a two-finger swipe, a right-drag) and widened (Shift+R); a chart opens read-only. Checks that the
 * think-aloud feed fills and that the shift ends with a debrief and the AI's reflection. Finally the
 * same seed is played again with nobody watching: the event log and debrief must be identical.
 *
 *   npx tsx tests/observe-e2e.ts [outDir] [--prod] [--map=night_shift|orientation]
 *
 * --prod serves the built client (npm run build first); default is the Vite dev middleware.
 * Exit code 1 if a check fails. The server and the agents it launches are stopped at the end.
 */
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/observe';
const map = args.find((a) => a.startsWith('--map='))?.split('=')[1] ?? 'night_shift';
const prod = args.includes('--prod');
mkdirSync(out, { recursive: true });

const PORT = 5700 + Math.floor(Math.random() * 80);
const serverArgs = ['server/index.ts', '--port', String(PORT), '--llm', 'offline', '--tts', 'off'];
if (!prod) serverArgs.push('--dev');
// spawn node directly (not via npx) so kill() reaches the server itself and no orphan is left behind
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), ...serverArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start:\n' + log)), 60000);
  const iv = setInterval(() => {
    if (log.includes('[server]')) {
      clearInterval(iv);
      clearTimeout(t);
      resolve();
    }
  }, 200);
});

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

type Doc = { location: string; spot: string; posture: string; activity?: string; bark?: { text: string } } | undefined;
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name: string, p: Page = page) => {
    await p.screenshot({ path: `${out}/${name}.png` });
    console.log(`📸 ${out}/${name}.png`);
  };
  const doctor = () => page.evaluate(`(() => { const v = __ac.store.get().view; const d = v && v.npcs.find((n) => n.id === 'ai_doctor'); return d ? { location: d.location, spot: d.spot, posture: d.posture, activity: d.activity, bark: d.bark } : undefined; })()`) as Promise<Doc>;
  const state = () => page.evaluate(`(() => { const s = __ac.store.get(); return { ended: !!(s.view && s.view.ended), debrief: !!s.debrief, feed: s.feed.map((e) => e.kind), clock: s.view ? s.view.t : 0, driver: s.view && s.view.driver, follow: s.follow, camera: s.camera }; })()`) as Promise<{ ended: boolean; debrief: boolean; feed: string[]; clock: number; driver?: { kind: string; label?: string; observe?: boolean }; follow: boolean; camera: string }>;

  // 1. the menu card
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
  await page.waitForSelector('.watch-ai', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Clinical actions' }).click();
  await page.selectOption('.watch-ai select', map);
  await page.click('.watch-ai button:has-text("Scripted demo")');
  await page.waitForTimeout(300);
  await page.locator('.watch-ai').scrollIntoViewIfNeeded();
  await shot('01-menu-watch-card');

  // 2. launch → spectator view following the AI doctor
  await page.click('.watch-ai button:has-text("Watch the AI doctor")');
  await page.waitForSelector('.ob-panel', { timeout: 60000 });
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 180000 }).catch(() => undefined);
  const s0 = await state();
  check('spectator attached to an agent-driven session', s0.driver?.kind === 'agent' && !!s0.driver.observe, JSON.stringify(s0.driver));
  check('the watcher starts on their own, in third person', !s0.follow && s0.camera === 'third', `follow=${s0.follow} camera=${s0.camera}`);
  const d0 = await doctor();
  check('ai_doctor NPC is in the view', !!d0, JSON.stringify(d0));
  await page.waitForTimeout(6000); // renderer + avatars warm up
  await shot('02-start');

  // the med student tags along (T) and walks up to the AI doctor; WASD breaks off
  const dist = () => page.evaluate(`__ac.store.get().distances.ai_doctor ?? 999`) as Promise<number>;
  const far = await dist();
  await page.keyboard.press('t');
  let near = far;
  const tTag = Date.now();
  while (Date.now() - tTag < 30000) {
    near = await dist();
    if (near < 3.2) break;
    await page.waitForTimeout(300);
  }
  const sTag = await state();
  check('T tags along: the med student walks up to the AI doctor', sTag.follow && near < 3.2, `distance ${far.toFixed(1)} → ${near.toFixed(1)} m`);
  await page.waitForTimeout(1200);
  await shot('02b-tagging-along');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyS');
  const sOff = await state();
  check('WASD ends tagging along', !sOff.follow, `follow=${sOff.follow}`);
  await page.keyboard.press('t'); // tag along again while the shift plays out

  // the watcher talks to someone close by, off the record: answered as a student, never seen by the AI. A patient
  // at the bedside if possible (one who isn't about to leave: no disposition yet), else anyone in earshot
  const nearest = (patientsOnly: boolean) =>
    page.evaluate(`(() => { const s = __ac.store.get(); let best = '', bd = 3.8, pt = 99; for (const n of s.view.npcs) { if (n.id === 'ai_doctor' || !n.talkable) continue; const isPt = n.id.startsWith('pt_'); const d = s.distances[n.id]; if (isPt && d !== undefined) pt = Math.min(pt, d); if (${patientsOnly} && !isPt) continue; if (isPt && s.view.board.some((r) => r.id === n.patientId && r.dispo)) continue; if (d !== undefined && d < bd) { bd = d; best = n.id; } } return { id: best, pt }; })()`) as Promise<{ id: string; pt: number }>;
  let closestPatient = 99;
  const npcReplies = () => page.evaluate(`document.querySelectorAll('.watcher-tablet .transcript .bubble.npc:not(.typing)').length`) as Promise<number>;
  const lastReply = () => page.evaluate(`[...document.querySelectorAll('.watcher-tablet .transcript .bubble.npc:not(.typing) .bubble-text')].map((b) => b.textContent).pop() || ''`) as Promise<string>;
  const watcherChat = async (npcId: string) => {
    await page.click('.ob-panel button:has-text("Walk freely")'); // stay with the patient while the AI doctor moves on
    await page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: '${npcId}', tab: 'talk' }, tabletMin: false })`);
    await page.waitForSelector('.watcher-tablet', { timeout: 10000 });
    await page.click('.watcher-tablet .quick .chip >> nth=0'); // "Hi, I'm a medical student with the doctor's team. …"
    await page.waitForFunction(`document.querySelectorAll('.watcher-tablet .transcript .bubble.npc:not(.typing)').length >= 1`, null, { timeout: 20000 }).catch(() => undefined);
    const order = 'Give 324 mg of aspirin now, and stop that metoprolol!';
    await page.fill('.watcher-tablet textarea', order);
    await page.keyboard.press('Enter');
    await page.waitForFunction(`document.querySelectorAll('.watcher-tablet .transcript .bubble.npc:not(.typing)').length >= 2`, null, { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(2500); // the reply streams in like dictation
    await shot('06a-watcher-chat');
    const replies = await npcReplies();
    const reply = await lastReply();
    check('the watcher talks to someone on the floor, off the record', replies >= 2, `${npcId}: ${replies} replies, last “${reply.slice(0, 80)}”`);
    // staff answer a student's order as a student's: no
    if (/^(rn_|att_)/.test(npcId)) check('… who takes no orders from a student', /orders from the doctor|belongs to the resident/.test(reply), reply.slice(0, 100));
    const agentSide = (await page.evaluate(`Promise.all([JSON.stringify(__ac.store.get().view.conversations), JSON.stringify(__ac.store.get().feed), fetch('/api/sessions/' + __ac.store.get().view.sessionId).then((r) => r.text())]).then((x) => x.join(' '))`)) as string;
    check('the AI doctor never sees it (view, feed, agent API)', !agentSide.includes("medical student with the doctor's team") && !agentSide.includes(order));
    await page.evaluate(`__ac.store.set({ panel: null })`);
  };
  // the transcript panel: R minimizes it to a chip (as do a two-finger swipe down and a right-drag), Shift+R widens it
  const panelIs = async (cls: string) => (await page.locator(`.ob-panel.${cls}`).count()) === 1;
  const transcriptPanel = async () => {
    await page.keyboard.press('r');
    await page.waitForTimeout(500);
    const chip = ((await page.textContent('.ob-dock').catch(() => '')) ?? '').replace(/\s+/g, ' ');
    check('R minimizes the transcript to a chip with what the AI doctor is doing', (await panelIs('min')) && chip.includes('AI resident'), chip.slice(0, 100));
    check('… remembered in this browser', (await page.evaluate(`localStorage.getItem('ac.observer.panel')`)) === 'min');
    await page.waitForTimeout(4000); // lines keep coming in: the chip counts them
    await shot('06b-transcript-chip');
    check('the chip shows an unread count and dot', (await page.locator('.ob-dock .ob-dock-n').count()) === 1 && (await page.locator('.ob-dock .ob-dock-dot').count()) === 1);
    await page.click('.ob-dock');
    await page.waitForTimeout(400);
    await page.keyboard.press('Shift+R');
    await page.waitForTimeout(600);
    check('Shift+R widens it for reading', await panelIs('max'));
    await shot('06c-transcript-wide');
    await page.click('.ob-winbtn >> nth=0');
    const head = (await page.locator('.ob-head').boundingBox())!;
    await page.mouse.move(head.x + head.width / 2, head.y + 30);
    // natural scrolling: two fingers down. A trackpad sends many small deltas ~16 ms apart; under a loaded
    // headless GPU each synthetic event can take longer than the pull's 200 ms window, so one big one stands in
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(500);
    check('a two-finger swipe down tucks it away', await panelIs('min'));
    await page.click('.ob-dock');
    await page.waitForTimeout(400);
    const h2 = (await page.locator('.ob-head').boundingBox())!;
    await page.mouse.move(h2.x + h2.width / 2, h2.y + 40);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(h2.x + h2.width / 2 + 60, h2.y + 170, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(500);
    check('so does a right-drag', await panelIs('min'));
    await page.click('.ob-dock');
    await page.waitForTimeout(300);
  };
  // the board and charts are open to the watcher, read-only
  const readOnlyChart = async (pid: string) => {
    await page.evaluate(`__ac.store.set({ panel: { kind: 'ehr', patientId: '${pid}' } })`);
    await page.waitForSelector('.ehr-root', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const r = (await page.evaluate(`__ac.client.act({ type: 'order', patientId: '${pid}', code: 'aspirin' })`)) as { ok: boolean; message?: string };
    check('charts open read-only: no New order, and orders are refused', (await page.locator('.ehr-root').count()) === 1 && (await page.locator('.ehr-neworder:visible').count()) === 0 && !r.ok, r.message);
    await shot('06d-chart-read-only');
    await page.evaluate(`__ac.store.set({ panel: null })`);
  };

  // 3. watch it work: sample the NPC, grab a few moments
  const poses = new Set<string>();
  const locations = new Set<string>();
  const spots = new Set<string>();
  const activities = new Set<string>();
  const wanted: Record<string, (d: NonNullable<Doc>) => boolean> = {
    '03-desk-ordering': (d) => d.spot.startsWith('desk') && d.posture === 'sit' && /^Ordering/.test(d.activity ?? ''),
    '04-on-the-phone': (d) => d.spot === 'phone' || /^Calling/.test(d.activity ?? ''),
    '05-bedside': (d) => d.location.startsWith('bed_') || d.location.startsWith('ft_'),
  };
  const taken = new Set<string>();
  const t0 = Date.now();
  let freeShot = false;
  let fast = false;
  let chatted = false;
  while (Date.now() - t0 < 12 * 60_000) {
    const d = await doctor();
    const st = await state();
    if (!chatted && taken.has('05-bedside')) {
      const bedsides = [...locations].filter((l) => /^(bed_|ft_)/.test(l)).length;
      const p = await nearest(true);
      closestPatient = Math.min(closestPatient, p.pt);
      const npcId = p.id || (bedsides >= 2 ? (await nearest(false)).id : '');
      if (npcId) {
        chatted = true;
        await watcherChat(npcId);
        await transcriptPanel();
        await readOnlyChart((await page.evaluate(`__ac.store.get().view.board[0].id`)) as string);
        await page.click('.ob-panel button:has-text("Tag along")');
      }
    }
    if (d) {
      poses.add(`${d.location}|${d.spot}|${d.posture}`);
      locations.add(d.location);
      spots.add(d.spot);
      if (d.activity) activities.add(d.activity);
      for (const [name, test] of Object.entries(wanted)) {
        if (!taken.has(name) && test(d)) {
          taken.add(name);
          await page.waitForTimeout(name === '05-bedside' ? 3500 : 1800); // let the avatar arrive / sit down
          await shot(name);
        }
      }
    }
    if (!freeShot && taken.has('05-bedside')) {
      freeShot = true;
      await page.click('.ob-panel button:has-text("Walk freely")');
      await page.evaluate(`__ac.store.set({ camera: 'top' })`);
      await page.waitForTimeout(2500);
      await shot('06-walk-freely-top');
      await page.evaluate(`__ac.store.set({ camera: 'third' })`);
      await page.click('.ob-panel button:has-text("Tag along")');
      await page.waitForTimeout(1500);
    }
    // once the interesting moments are captured, speed the rest of the shift up
    if (!fast && taken.size === Object.keys(wanted).length && freeShot && chatted) {
      fast = true;
      await shot('07-feed');
      await page.click('.ob-panel .seg button:has-text("Fast")');
    }
    if (st.ended && st.debrief) break;
    await page.waitForTimeout(400);
  }
  check('the watcher chatted with someone during the shift', chatted, `closest patient ${closestPatient.toFixed(1)} m`);
  console.log(`   ai_doctor poses seen: ${[...poses].join('  ')}`);
  console.log(`   activities (${activities.size}): ${[...activities].slice(0, 12).join(' / ')}…`);
  check('ai_doctor changed location over time', locations.size >= 3, [...locations].join(', '));
  check('ai_doctor changed spot/posture (desk, phone, bedside…)', spots.size >= 4 && [...poses].some((p) => p.endsWith('|sit')), [...spots].join(', '));
  check('activity labels describe the work', [...activities].some((a) => a.startsWith('Ordering')) && [...activities].some((a) => a.startsWith('Examining')) && [...activities].some((a) => a.startsWith('Calling')));

  // 4. the end: debrief card, reflection, run log
  await page.waitForSelector('.ob-end .ob-end-head', { timeout: 60000 });
  await page.waitForFunction(`__ac.store.get().feed.some((e) => e.kind === 'reflection')`, null, { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const st = await state();
  const kinds = new Set(st.feed);
  check('feed filled with reasoning, actions, results and events', st.feed.length >= 60 && ['thought', 'action', 'result', 'event', 'system'].every((k) => kinds.has(k)), `${st.feed.length} entries: ${[...kinds].join(', ')}`);
  check('shift ended with a debrief', st.ended && st.debrief);
  check('the AI reflection arrived', kinds.has('reflection'));
  const grade = await page.textContent('.ob-end .grade');
  check('end card shows the grade', !!grade && /^[A-F]$/.test(grade.trim()), grade ?? '');
  const runLog = await page.evaluate(`fetch('/api/runs/' + __ac.store.get().view.sessionId).then((r) => r.json()).then((j) => ({ narration: (j.narration || []).length, score: j.debrief && j.debrief.percent }))`) as { narration: number; score: number };
  check('run log saved with the transcript', runLog.narration >= 60, JSON.stringify(runLog));
  await shot('08-shift-over');
  await page.click('.ob-panel button:has-text("Full debrief")');
  await page.waitForSelector('.debrief', { timeout: 10000 });
  await page.waitForTimeout(600);
  await shot('09-debrief');
  let status = { running: true } as { running: boolean; current?: { state: string } };
  for (let i = 0; i < 30 && status.running; i++) {
    status = (await page.evaluate(`fetch('/api/observe').then((r) => r.json())`)) as typeof status;
    if (status.running) await page.waitForTimeout(500);
  }
  check('agent process finished on its own', !status.running && status.current?.state === 'finished', JSON.stringify(status.current?.state));

  // 5. the same seed again, nobody watching: the watched run, watcher chat and all, must be the same run
  type RunLog = { seed: number; player: string; log: unknown; debrief: { percent?: number } };
  const base = `http://127.0.0.1:${PORT}`;
  const sid = (await page.evaluate(`__ac.store.get().view.sessionId`)) as string;
  const watchedRun = (await (await fetch(`${base}/api/runs/${sid}`)).json()) as RunLog;
  const ref = (await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapId: map, seed: watchedRun.seed, playerName: watchedRun.player, llm: 'offline' }) })).json()) as { sessionId: string };
  const exit = await new Promise<number | null>((resolve) => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const agent = spawn(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, 'agents/demo-agent.ts', '--session', ref.sessionId, '--map', map], { cwd: root, env: { ...process.env, AGENTCLINIC_URL: base, NO_COLOR: '1' }, stdio: 'ignore' });
    const timer = setTimeout(() => agent.kill(), 240_000);
    agent.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const unwatched = (await (await fetch(`${base}/api/runs/${ref.sessionId}`)).json()) as RunLog;
  const same = (j: RunLog, id: string) => JSON.stringify({ log: j.log, debrief: j.debrief }).split(id).join('<session>');
  check('same seed, nobody watching: identical event log and debrief', exit === 0 && same(watchedRun, sid) === same(unwatched, ref.sessionId), `agent exit ${exit}; ${watchedRun.debrief?.percent}% watched vs ${unwatched.debrief?.percent}% unwatched`);
} finally {
  await browser.close();
  server.kill();
}
await new Promise((r) => setTimeout(r, 1500));
let leftovers = '';
try {
  leftovers = execSync(`ps -ax -o pid,command | grep -E "demo-agent.ts|--port ${PORT}" | grep -v grep || true`, { encoding: 'utf8' }).trim();
} catch {
  /* ps unavailable */
}
check('no processes left behind', !leftovers, leftovers);
check('no browser errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n✗ ${failed.length} of ${checks.length} checks failed` : `\n✓ all ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);

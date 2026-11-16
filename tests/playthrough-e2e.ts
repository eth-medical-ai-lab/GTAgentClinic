/**
 * One whole case played through the UI like a person (tests/human.ts), recorded on video: Orientation
 * Day, Daniel Okafor's ankle in Fast Track 1 (content/cases/ankle_sprain.ts).
 *
 *   1. the menu: Orientation Day, Start shift (offline characters: the harness's --llm offline)
 *   2. walk to Fast Track 1 (mouse to steer, W), hand rub at the bay, E on Daniel: the tablet;
 *      history by clicking suggested questions and by typing; a look at the ankle (drag-to-look)
 *   3. the exam tab: the Ottawa ankle rule elements and the distal neurovascular status (clicks)
 *   4. tuck the tablet away (right-drag), hand rub again leaving the bay, walk to a free
 *      workstation, E: AgentChart opens on Daniel's chart (the tucked tablet's patient); order
 *      ibuprofen, an ankle brace and ice/elevation by clicking; sign; log off (Esc)
 *   5. back to Daniel: counsel him (typed: no imaging by the Ottawa rules, brace and rehab, return
 *      precautions); speed the clock up until the nurse has given the ibuprofen; diagnosis and
 *      discharge from the bedside Plan tab through AgentChart (Diagnosis & Dispo), then watch
 *      the HUD until Daniel has left after the nurse handoff
 *   6. End shift → End now → the debrief: the score items expected, and no X-ray or MRI ordered
 *
 * No debug hook acts: no teleport at all, no use/press/pickUp/store.set. Reading only (positions,
 * the store's view to know when the nurse has given the dose). A step that can't be done through
 * the UI is a finding: it is logged and the run goes on as far as it can. Where the HUD shows no
 * [E] prompt although the crosshair is lit on the right thing (a tucked tablet; right after closing
 * a panel), that is logged as a finding and E is pressed on the lit crosshair, as a person would.
 *
 * Output (--out, default shots/playthrough): playthrough.webm (1280×720), steps.log (timestamped),
 * playthrough.md (steps, debrief, findings), playthrough.json, step-*.png.
 *
 *   npx tsx tests/playthrough-e2e.ts [--out=DIR] [--port-base=8000]
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';
import { Human, StepLog, fmtT, installReader, sleep } from './human';

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = opt('out') ?? 'shots/playthrough';
const PORT_BASE = Number(opt('port-base') ?? 8000);
const VIEW = { width: 1280, height: 720 };
mkdirSync(`${OUT}/video`, { recursive: true });

const log = new StepLog(`${OUT}/steps.log`);
interface StepRec {
  name: string;
  t0: number;
  t1: number;
  ok: boolean;
  detail: string;
}
const steps: StepRec[] = [];
const findings: string[] = [];
const finding = (text: string) => {
  findings.push(text);
  log.add('finding', text);
};
let shotN = 0;

/** a named step: timed, logged, and on failure a finding (the run goes on) */
async function step(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  const t0 = Date.now() - log.t0;
  log.add('note', `── ${name}`);
  try {
    const detail = (await fn()) ?? '';
    steps.push({ name, t0, t1: Date.now() - log.t0, ok: true, detail });
    log.add('check', `✓ ${name}${detail ? ` · ${detail}` : ''}`);
    return true;
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    steps.push({ name, t0, t1: Date.now() - log.t0, ok: false, detail: msg });
    finding(`${name}: ${msg}`);
    await onFail?.(name).catch(() => undefined);
    return false;
  }
}
let onFail: ((name: string) => Promise<void>) | null = null;

const h = await startHarness({ portBase: PORT_BASE, dev: true });
let videoPath: string | null = null;
let debrief: { score: string; rows: { mark: string; label: string; detail: string; pts: string }[]; timeline: string[]; verdicts: string; ic: string } | null = null;
try {
  const context = await h.browser.newContext({ viewport: VIEW, recordVideo: { dir: `${OUT}/video`, size: VIEW } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  let reloads = 0;
  page.on('load', () => {
    reloads++;
    if (reloads > 1) finding('the page reloaded mid-run (a file changed under the dev server?)');
  });
  await page.addInitScript('window.__name = (f) => f;');
  // no hot reload: other edits to the tree mid-run would rebuild the world under the test
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  const me = new Human(page, log, VIEW);
  const shot = async (name: string) => {
    const f = `${OUT}/step-${String(++shotN).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: f });
    log.add('note', `screenshot ${f}`);
  };
  onFail = async (name) => shot(`FAILED-${name.split('.')[0]}`);
  /**
   * The mouse must be free (not captured by the 3D view) to click a button. A person presses Esc: a
   * real browser always lets the pointer go on Esc; headless Chromium has no such browser UI, so
   * when the game itself didn't let go (it does in full screen: fullscreen.ts), that browser
   * behaviour is emulated with document.exitPointerLock() (logged).
   */
  const freeMouse = async () => {
    if (!(await page.evaluate(() => !!document.pointerLockElement))) return;
    await me.press('Escape', 'let go of the mouse');
    await sleep(150);
    if (await page.evaluate(() => !!document.pointerLockElement)) {
      log.add('setup', 'Esc did not release the mouse here (headless has no browser Esc-unlock): emulating the browser with document.exitPointerLock()');
      await page.evaluate(() => document.exitPointerLock());
      await sleep(100);
    }
  };
  const click = async (selector: string, what: string) => {
    await freeMouse();
    log.add('input', `click ${what}`);
    await page.locator(selector).first().click({ timeout: 8000 });
  };
  const type = async (selector: string, text: string, what: string) => {
    log.add('input', `type into ${what}: "${text}"`);
    await page.locator(selector).first().click({ timeout: 8000 });
    await page.keyboard.type(text, { delay: 12 });
  };
  /** the store's view, read only (what the HUD and panels are drawn from) */
  const view = () => page.evaluate(() => (window as unknown as { __ac: { store: { get(): { view: unknown } } } }).__ac.store.get().view) as Promise<{ t: number; board: { id: string; bed: string; name: string; dispo?: string; flowStatus: string }[]; npcs: { id: string; name: string; role: string; patientId?: string }[]; settings: { timeScale: number; paused: boolean } } | null>;
  const chart = (pid: string) => page.evaluate((id) => (window as unknown as { __ac: { store: { get(): { charts: Record<string, unknown> } } } }).__ac.store.get().charts[id] ?? null, pid) as Promise<{ orders: { code: string; name: string; status: string }[]; mar: { med: string; status: string }[]; disposition?: { decision: string } } | null>;
  const clock = () => page.evaluate(() => document.querySelector('.hud-time')?.textContent ?? '');
  const tablet = () => page.evaluate(() => document.querySelector('.tablet:not(.min)')?.getAttribute('aria-label') ?? null);
  const transcriptCount = () => page.evaluate(() => document.querySelectorAll('.tablet .transcript .bubble').length);
  const lastNpcLine = () => page.evaluate(() => [...document.querySelectorAll('.tablet .transcript .bubble.npc:not(.typing) .bubble-text')].pop()?.textContent ?? '');

  let pid = '';
  let npcId = '';
  let firstName = 'Daniel';

  // ── 1. the menu ──
  await step('1. Start the shift from the menu (Orientation Day, offline characters)', async () => {
    log.add('setup', `open ${h.url}/?debug=1 (the debug flag only adds read-only hooks)`);
    await page.goto(`${h.url}/?debug=1`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    const llm = (await page.textContent('.menu-llm b')) ?? '';
    log.add('see', `menu: ${llm}`);
    // (the title screen's online/offline card: an offline server says so, no LLM anywhere)
    if (!/^Offline · no LLM/.test(llm)) throw new Error(`the menu says "${llm}", not offline characters`);
    await click('.map-card:has-text("Orientation Day")', 'the "Orientation Day" card');
    await shot('menu');
    await click('button.start', '"Start shift →"');
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => finding('the loading screen never finished'));
    await sleep(800);
    await installReader(page);
    log.add('see', `full screen: ${await page.evaluate(() => !!document.fullscreenElement)}`);
    const v = await view();
    const row = v?.board.find((r) => r.bed === 'ft_1');
    if (!row) throw new Error('no patient in Fast Track 1 on the board');
    pid = row.id;
    const npc = v!.npcs.find((n) => n.patientId === pid && n.role === 'patient');
    if (!npc) throw new Error('no patient NPC for Fast Track 1');
    npcId = npc.id;
    firstName = npc.name.split(' ')[0];
    const pts = await page.evaluate(() => [...document.querySelectorAll('.hud-pt-name')].map((e) => e.textContent).join(' | '));
    await shot('shift-start');
    return `${await clock()} · My patients: ${pts}`;
  });

  /** where Daniel is, and a free spot to stand beside the stretcher (reading positions only) */
  const patientAt = async () => {
    const n = (await page.evaluate((id) => (window as unknown as { __acWorld: { npc(id: string): { x: number; z: number; head: number[]; toes: number[][] } | null } }).__acWorld.npc(id), npcId))!;
    return n;
  };
  const standNear = (x: number, z: number, rMin: number, rMax: number) =>
    page.evaluate(
      ([px, pz, a, b]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const R = (window as any).__acRead;
        const nav = R.nav;
        let best: { x: number; z: number; len: number } | null = null;
        for (let k = 0; k < 48; k++) {
          const ang = (k / 48) * Math.PI * 2;
          for (let r = a; r <= b; r += 0.1) {
            const x = px + Math.cos(ang) * r;
            const z = pz + Math.sin(ang) * r;
            if (!nav.isFreeAt(x, z)) continue;
            let solid = false;
            for (const c of R.built.colliders) {
              if (c.max.y <= 0.05 || c.min.y >= 1.8 || c.isEmpty()) continue;
              if (x > c.min.x - 0.34 && x < c.max.x + 0.34 && z > c.min.z - 0.34 && z < c.max.z + 0.34) {
                solid = true;
                break;
              }
            }
            if (solid) continue;
            const path = nav.findPath(R.controller.pos.x, R.controller.pos.y, x, z);
            if (!path) continue;
            let len = 0;
            let lx = R.controller.pos.x;
            let lz = R.controller.pos.y;
            for (const p of path) {
              len += Math.hypot(p.x - lx, p.y - lz);
              lx = p.x;
              lz = p.y;
            }
            if (!best || len < best.len) best = { x, z, len };
          }
        }
        return best;
      },
      [x, z, rMin, rMax] as [number, number, number, number],
    );

  /**
   * turn to someone/something and read the prompt; E only when it names what we want. With the tablet
   * tucked away there is no prompt text (a finding, logged once): then the highlighted crosshair and
   * the focus are what a person has to go on.
   */
  let notedHidden = false;
  const aimAndUse = async (point: [number, number, number], want: RegExp, what: string, key = 'KeyE') => {
    for (const dy of [0, 0.2, -0.25, 0.4]) {
      const aimed = await me.aimAt([point[0], point[1] + dy, point[2]]);
      await sleep(150);
      const p = await me.prompt();
      const f = await me.focus();
      const lit = await page.evaluate(() => !!document.querySelector('.wl-crosshair.focus'));
      log.add('see', `prompt: ${p ?? '(none)'}${aimed ? '' : ` · could not aim (mouse: ${await me.lookMode()})`}${!p && f ? ` · crosshair ${lit ? 'highlighted' : 'plain'} on ${f.label}` : ''}`);
      if (p && want.test(p)) {
        await me.press(key, `on "${p}"`);
        return p;
      }
      const docked = await page.evaluate(() => !!document.querySelector('.tablet-dock'));
      if (!p && f && want.test(f.label) && lit && docked) {
        if (!notedHidden) finding(`with the tablet tucked away (the dock tile at the screen edge), aiming at "${f.label}" highlights the crosshair but the HUD shows no [E] prompt: Hud.tsx renders it only when panel is null, and a tucked tablet keeps panel set`);
        notedHidden = true;
        await me.press(key, `the crosshair is lit on "${f.label}" (no prompt text)`);
        return f.label;
      }
      if (!p && f && want.test(f.label) && lit && !docked) {
        // nothing open, the crosshair lit on it, and still no words: glance away and back
        await me.turn(0.7, 0);
        await sleep(200);
        await me.aimAt([point[0], point[1] + dy, point[2]]);
        await sleep(200);
        const p2 = await me.prompt();
        log.add('see', `after glancing away and back: ${p2 ?? '(none)'}`);
        finding(`no [E] prompt for "${f.label}" with nothing open and the crosshair lit on it (the tablet opened on this same target had just been closed); ${p2 ? 'it came back after looking away and back' : 'still none after looking away and back'}`);
        if (p2 && want.test(p2)) {
          await me.press(key, `on "${p2}"`);
          return p2;
        }
        await me.press(key, `the crosshair is lit on "${f.label}" (no prompt text)`);
        return f.label;
      }
    }
    throw new Error(`the prompt never named ${what} (last: ${(await me.prompt()) ?? 'none'}; focus ${(await me.focus())?.label ?? 'none'})`);
  };

  /** the alcohol rub nearest a point: walk up, aim, E, wait for it to finish (WHO moments 1 and 4) */
  const handRub = async (nearX: number, nearZ: number, moment: string) => {
    const rub = await page.evaluate(
      ([x, z]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const R = (window as any).__acRead;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rs = R.hygiene.targets().filter((t: any) => t.key.startsWith('use:rub:') && (t.level ?? 0) === 0);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rs.sort((a: any, b: any) => Math.hypot(a.center.x - x, a.center.z - z) - Math.hypot(b.center.x - x, b.center.z - z));
        const r = rs[0];
        return r ? { key: r.key as string, c: [r.center.x, r.center.y, r.center.z] as [number, number, number] } : null;
      },
      [nearX, nearZ] as [number, number],
    );
    if (!rub) throw new Error('no hand-rub dispenser nearby');
    const spot = await standNear(rub.c[0], rub.c[2], 0.9, 1.4);
    if (!spot) throw new Error(`no free floor in front of ${rub.key}`);
    await me.walkTo(spot.x, spot.z, { name: `the hand-rub dispenser (${moment})`, arrive: 0.3 });
    await aimAndUse(rub.c, /Disinfect your hands/, 'the hand-rub dispenser');
    const done = await waitFor(
      () => page.evaluate(() => (window as unknown as { __acWorld: { hygiene(): { action: string | null } } }).__acWorld.hygiene().action),
      (a, seen) => seen && a === null,
      15000,
    );
    if (!done) throw new Error('the rub did not finish');
    return `${rub.key} (${moment})`;
  };

  /** poll fn until ok(value, sawNonNull) */
  async function waitFor<T>(fn: () => Promise<T>, ok: (v: T, seen: boolean) => boolean, ms: number): Promise<boolean> {
    const t0 = Date.now();
    let seen = false;
    while (Date.now() - t0 < ms) {
      const v = await fn();
      if (v !== null && v !== undefined) seen = true;
      if (ok(v, seen)) return true;
      await sleep(150);
    }
    return false;
  }

  /** walk up to Daniel and open the tablet with E */
  const toPatient = async (why: string) => {
    const n = await patientAt();
    const spot = await standNear(n.x, n.z, 1.0, 1.6);
    if (!spot) throw new Error('no free floor beside the stretcher');
    await me.walkTo(spot.x, spot.z, { name: `Daniel (${why})`, arrive: 0.3, run: true });
    const s = await me.st();
    log.add('see', `${(Math.hypot(n.x - s.x, n.z - s.z)).toFixed(2)} m from Daniel · ${s.room}`);
    await aimAndUse([n.x, n.head[1] - 0.45, n.z], new RegExp(`Talk to ${firstName}`), firstName);
    if (!(await waitFor(tablet, (t) => !!t, 3000))) throw new Error('E did not open the tablet');
  };

  /** say something on the Talk tab (typed, Enter) and wait for the reply */
  const say = async (text: string) => {
    const n0 = await transcriptCount();
    await type('.tablet .chat-input textarea', text, 'the chat box');
    await me.press('Enter', 'send');
    if (!(await waitFor(transcriptCount, (c) => c >= n0 + 2, 10000))) throw new Error(`no reply to "${text}"`);
    await replied();
    const reply = await lastNpcLine();
    log.add('see', `${firstName}: ${reply}`);
    return reply;
  };
  /** the reply is in and fully shown (it is revealed word by word, like speech) */
  const replied = () => waitFor(() => page.evaluate(() => !document.querySelector('.tablet .bubble.typing, .tablet .bubble-text.dictating')), (x) => x, 15000);
  const ask = async (chip: string) => {
    const n0 = await transcriptCount();
    await click(`.tablet .quick button.chip:has-text("${chip.slice(0, 40)}")`, `the suggested question "${chip}"`);
    if (!(await waitFor(transcriptCount, (c) => c >= n0 + 2, 10000))) throw new Error(`no reply to "${chip}"`);
    await replied();
    const reply = await lastNpcLine();
    log.add('see', `${firstName}: ${reply}`);
    return reply;
  };

  // ── 2. to the patient, history ──
  await step('2a. Walk to Fast Track 1 and clean hands at the bay (WHO moment 1)', async () => {
    const n = await patientAt();
    return handRub(n.x, n.z, 'before touching the patient');
  });
  await step('2b. Open the conversation with E', async () => {
    await toPatient('history');
    await shot('tablet-open');
    return (await tablet()) ?? '';
  });
  await step('2c. History: suggested questions (clicked) and typed questions', async () => {
    const replies: string[] = [];
    replies.push(await ask("Hi, I'm the resident doctor. What brings you in today?"));
    replies.push(await ask('When did this start, and what were you doing?'));
    replies.push(await say('How did the injury happen exactly? Did the ankle roll inward?'));
    replies.push(await say('Could you walk on it right afterwards, and can you bear weight now?'));
    replies.push(await say('Where exactly does it hurt? Can you point to it?'));
    replies.push(await say('Any numbness or tingling in your foot or toes?'));
    replies.push(await say('Any medical problems, medications, or allergies?'));
    await shot('history');
    return `${replies.length} answers, last: "${replies[replies.length - 1].slice(0, 80)}"`;
  });

  await step('2d. With the tablet up, look down at the ankle and back (drag on the 3D view)', async () => {
    const mode = await me.lookMode();
    if (mode !== 'drag') throw new Error(`with the tablet open the view should be drag-to-look, it is "${mode}"`);
    const n = await patientAt();
    const s0 = await me.st();
    // his feet (the toe joints, raised to the ankles)
    const toes = n.toes.length ? n.toes : [[n.x, 0.1, n.z]];
    const ankle: [number, number, number] = [toes.reduce((a, t) => a + t[0], 0) / toes.length, toes.reduce((a, t) => a + t[1], 0) / toes.length + 0.08, toes.reduce((a, t) => a + t[2], 0) / toes.length];
    const want = Math.atan2(ankle[1] - s0.cy, Math.hypot(ankle[0] - s0.cx, ankle[2] - s0.cz));
    await me.aimAt(ankle);
    await sleep(300);
    const s1 = await me.st();
    await shot('look-at-ankle');
    await me.aimAt([n.x, n.head[1] - 0.45, n.z]);
    const still = await tablet();
    if (!still) throw new Error('a drag closed or switched the tablet');
    if (Math.abs(s1.pitch - want) > 0.05) throw new Error(`the view did not get there (pitch ${s0.pitch.toFixed(2)} → ${s1.pitch.toFixed(2)}, wanted ${want.toFixed(2)})`);
    return `pitch ${s0.pitch.toFixed(2)} → ${s1.pitch.toFixed(2)} (his ankles) → back; the tablet stayed on ${still}`;
  });

  // ── 3. the exam ──
  const MANEUVERS = [
    'Ankle inspection',
    'Posterior edge/tip of lateral malleolus',
    'Posterior edge/tip of medial malleolus',
    'Base of 5th metatarsal',
    'Navicular bone',
    'Weight bearing (4 steps)',
    'Distal neurovascular status',
    'Anterior drawer test',
  ];
  await step('3. Exam: Ottawa ankle rule elements and neurovascular status (Examine tab)', async () => {
    await click('.tablet .sp-tabs button:has-text("Examine")', 'the "🩺 Examine" tab');
    await type('.tablet .exam-filter', 'ankle', 'the maneuver filter');
    const found: string[] = [];
    for (const m of MANEUVERS) {
      const btn = page.locator('.tablet .exam-btn', { hasText: m }).first();
      if (!(await btn.count())) throw new Error(`no exam button "${m}"`);
      log.add('input', `click the maneuver "${m}"`);
      await btn.click({ timeout: 8000 });
      const ok = await waitFor(() => btn.getAttribute('class'), (c) => /done/.test(c ?? ''), 10000);
      if (!ok) throw new Error(`"${m}" was not marked done`);
    }
    const lines = await page.evaluate(() => [...document.querySelectorAll('.tablet .exam-findings .finding')].map((f) => f.textContent ?? ''));
    for (const l of lines) log.add('see', `finding: ${l}`);
    found.push(...lines);
    await shot('exam');
    const ottawa = ['lateral malleolus', 'medial malleolus', '5th metatarsal', 'Navicular', 'Weight bearing'].filter((k) => found.some((f) => f.includes(k))).length;
    return `${found.length} findings (Ottawa elements ${ottawa}/5, neurovascular ${found.some((f) => /neurovascular/i.test(f)) ? 'yes' : 'no'})`;
  });

  // ── 4. the workstation ──
  await step('4a. Tuck the tablet away (right-drag down) and clean hands leaving the bay (WHO moment 4)', async () => {
    const box = await page.locator('.tablet').first().boundingBox();
    if (!box) throw new Error('no tablet on screen');
    log.add('input', 'right-drag the tablet down (put it away)');
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + 260, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    if (!(await waitFor(() => page.evaluate(() => !!document.querySelector('.tablet-dock')), (x) => x, 3000))) throw new Error('the tablet did not tuck away');
    const n = await patientAt();
    return handRub(n.x, n.z, 'after touching the patient');
  });

  let wsInfo = '';
  await step('4b. Walk to a free workstation and log in with E', async () => {
    const ws = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const R = (window as any).__acRead;
      const me = R.controller.pos;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all = R.built.interactables.filter((i: any) => i.target.kind === 'computer' && /^Log in to [A-Z]/.test(i.target.label) && !/clinic|exam room/i.test(i.target.label) && (i.level ?? 0) === 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return all.map((i: any) => ({ key: i.key, label: i.target.label, c: [i.center.x, i.center.y, i.center.z], d: Math.hypot(i.center.x - me.x, i.center.z - me.y) })).sort((a: { d: number }, b: { d: number }) => a.d - b.d);
    });
    if (!ws.length) throw new Error('no free workstation');
    const target = ws[0] as { key: string; label: string; c: [number, number, number] };
    wsInfo = target.label;
    const spot = await standNear(target.c[0], target.c[2], 1.2, 1.8);
    if (!spot) throw new Error(`no free floor in front of ${target.label}`);
    await me.walkTo(spot.x, spot.z, { name: target.label, arrive: 0.3, run: true });
    await me.aimAt(target.c);
    await sleep(200);
    await shot('workstation-aim');
    await aimAndUse(target.c, new RegExp(target.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), target.label);
    if (!(await waitFor(() => page.evaluate(() => !!document.querySelector('.ehr-root')), (x) => x, 15000))) throw new Error('AgentChart did not open');
    await waitFor(() => page.evaluate(() => (window as unknown as { __acWorld: { workstation(): { phase: string } } }).__acWorld.workstation().phase), (ph) => ph === 'open', 5000);
    await shot('agentchart');
    return `${target.label} → AgentChart`;
  });

  await step('4c. Order ibuprofen, an ankle brace and ice/elevation in AgentChart (clicks)', async () => {
    const banner = (await page.textContent('.ehr-banner .ehr-pt-name').catch(() => null)) ?? '';
    if (!/Okafor/i.test(banner)) {
      log.add('see', `chart open on: ${banner || 'the department list'}`);
      await click('.ehr-ptab:has-text("Okafor")', 'Okafor\'s tab');
      await page.waitForSelector('.ehr-banner .ehr-pt-name', { timeout: 8000 });
    } else log.add('see', `chart open on ${banner} (the patient from the tucked tablet)`);
    await click('button.ehr-neworder', '"+ New order"');
    const order = async (q: string, name: RegExp) => {
      await type('.ehr-oe-search', q, 'the order search');
      const res = page.locator('.ehr-oe-res', { hasText: name }).first();
      await res.waitFor({ timeout: 6000 });
      log.add('input', `click the result "${(await res.textContent())?.slice(0, 60)}"`);
      await res.click();
      await page.waitForSelector('.ehr-composer', { timeout: 6000 });
      const meta = await page.evaluate(() => [...document.querySelectorAll('.ehr-composer select')].map((s) => (s as HTMLSelectElement).value).join(' · '));
      if (meta) log.add('see', `defaults: ${meta}`);
      await click('.ehr-composer-foot .ehr-btn.primary', '"Add to pending"');
    };
    await order('ibuprofen', /Ibuprofen/);
    await order('brace', /Ankle brace/);
    await order('ice', /Ice, elevation/);
    const cart = await page.evaluate(() => [...document.querySelectorAll('.ehr-oe-cart-name')].map((e) => e.textContent?.trim() ?? ''));
    log.add('see', `pending: ${cart.join(' | ')}`);
    await shot('orders-pending');
    await click('.ehr-oe-cart-foot .ehr-btn.sign', '"Sign orders"');
    await waitFor(() => page.evaluate(() => document.querySelector('.ehr-status-msg')?.textContent ?? ''), (t) => /signed/.test(t ?? ''), 8000);
    const status = await page.evaluate(() => document.querySelector('.ehr-status-msg')?.textContent ?? '');
    await shot('orders-signed');
    if (!/3 orders signed/.test(status)) throw new Error(`after signing: "${status}"`);
    return `${cart.length} orders · ${status}`;
  });

  await step('4d. Log off (Esc) and stand up', async () => {
    await me.press('Escape', 'log off AgentChart');
    const ok = await waitFor(() => page.evaluate(() => (window as unknown as { __acWorld: { workstation(): { phase: string } } }).__acWorld.workstation().phase), (ph) => ph === 'idle', 8000);
    if (!ok) throw new Error('still at the workstation after Esc');
    return wsInfo;
  });

  // ── 5. back to Daniel: counsel, analgesia given, diagnosis and discharge ──
  await step('5a. Walk back to Daniel and counsel him (typed)', async () => {
    // the tablet is still tucked: talking to him again brings it back
    await toPatient('counselling');
    await click('.tablet .sp-tabs button:has-text("Talk")', 'the "💬 Talk" tab');
    const r1 = await say("Good news: your Ottawa ankle rules are negative, so you don't need an X-ray or an MRI. Nothing is broken; it's a sprain of the outer ligament.");
    const r2 = await say('Wear the brace, ice and elevate it, and start gentle range-of-motion exercises. Most people return to play in about 2 to 4 weeks.');
    const r3 = await say("Come back if the pain gets worse, if you get numbness, or if you cannot walk on it. Follow up if it's not improving in 1 to 2 weeks.");
    await shot('counselling');
    return `${firstName}: "${r1.slice(0, 50)}…" / "${r2.slice(0, 40)}…" / "${r3.slice(0, 40)}…"`;
  });

  await step('5b. Speed up the clock (HUD) until the nurse has given the ibuprofen', async () => {
    // close the tablet (the clock runs slow while it is up): Esc leaves the chat box, Esc closes it
    for (let i = 0; i < 2 && (await tablet()); i++) await me.press('Escape', 'close the tablet');
    const speed = async (x: string) => {
      log.add('input', `click the HUD speed "${x}"`);
      await page.locator('.hud-speed button').filter({ hasText: new RegExp(`^${x}$`) }).first().click({ timeout: 5000 });
    };
    await speed('24×');
    const t0 = await clock();
    let given = false;
    for (let i = 0; i < 160 && !given; i++) {
      const c = await chart(pid);
      const ib = c?.orders.find((o) => o.code === 'ibuprofen');
      given = !!c?.mar.some((m) => /ibuprofen/i.test(m.med) && /Given|Started/.test(m.status)) || ib?.status === 'Given';
      if (i % 10 === 0) log.add('see', `${await clock()} · ibuprofen ${ib?.status ?? '?'}`);
      if (!given) await sleep(500);
    }
    await speed('3×');
    if (!given) throw new Error('the ibuprofen was not given within the wait');
    return `${t0} → ${await clock()}: ibuprofen given`;
  });

  await step('5c. Diagnosis and discharge from the bedside Plan tab', async () => {
    await toPatient('disposition');
    await click('.tablet .sp-tabs button:has-text("Plan")', 'the Plan tab');
    await click('.tablet button:has-text("Open Diagnosis & Dispo")', '"Open Diagnosis & Dispo"');
    await page.waitForSelector('.ehr-dx-input input', { timeout: 8000 });
    const expectedName = (await view())?.board.find((row) => row.id === pid)?.name;
    const bannerName = await page.locator('.ehr-banner .ehr-pt-name').innerText();
    if (bannerName !== expectedName) throw new Error(`Opened ${bannerName}'s chart for the bedside patient ${expectedName}`);
    if (await page.locator('.ehr-oe').isVisible()) throw new Error('Order entry opened over Diagnosis & Dispo');
    await type('.ehr-dx-input input', 'Right lateral ankle sprain (ATFL), Ottawa negative', 'the diagnosis box');
    await click('.ehr-dx-input button.ehr-btn', '"Add"');
    await page.waitForSelector('.ehr-dxlist li', { timeout: 5000 });
    await click('label.ehr-dispo-opt:has-text("Discharge home")', 'the "Discharge home" option');
    await type('textarea.ehr-textarea', 'Ankle sprain. Brace, ice/elevation, ibuprofen 600 mg with food as needed. Early mobilization exercises; return to play in 2-4 weeks. Return if worse pain, numbness, unable to walk, or calf pain; follow up in 1-2 weeks if not improving.', 'the discharge instructions');
    await shot('dispo-form');
    await click('button.ehr-btn.sign:has-text("Submit disposition")', '"Submit disposition"');
    await click('.ehr-dialog .ehr-btn.sign:has-text("Confirm")', '"Confirm"');
    const status = page.locator('.ehr-decided [role="status"]');
    await status.waitFor({ timeout: 8000 });
    const progress = await status.innerText();
    await shot('dispo-entered');
    await me.press('Escape', 'close AgentChart');
    return progress;
  });

  await step('5d. Follow the home discharge until Daniel leaves the ED', async () => {
    await click('.hud-speed button:text-is("12×")', '12× to watch the discharge');
    const row = page.locator('.hud-pt').filter({ hasText: 'Okafor' });
    await row.getByText('Departed for home', { exact: true }).waitFor({ timeout: 120000 });
    await shot('discharged-home');
    return (await row.innerText()).replace(/\s+/g, ' ').trim();
  });

  // ── 6. end of shift, the debrief ──
  await step('6. End the shift and read the debrief', async () => {
    for (let i = 0; i < 2 && ((await tablet()) || (await page.locator('.ehr-root').count())); i++) await me.press('Escape', 'close what is open');
    await click('.hud-right button:has-text("End shift")', '"End shift"');
    await click('.hud-right button:has-text("End now")', '"End now"');
    await page.waitForSelector('.debrief', { timeout: 30000 });
    await sleep(800);
    // the ankle's card (open it if it isn't)
    const card = page.locator('.debrief .case', { hasText: 'Okafor' }).first();
    if (!(await card.locator('.case-body').count())) {
      log.add('input', 'click the ankle case card');
      await card.locator('.case-head').click();
    }
    await card.locator('.case-body').waitFor({ timeout: 5000 });
    debrief = await page.evaluate(() => {
      const root = [...document.querySelectorAll('.debrief .case')].find((c) => /Okafor/.test(c.textContent ?? ''))!;
      const rows = [...root.querySelectorAll('table.items tr')].map((tr) => {
        const td = tr.querySelectorAll('td');
        const label = td[1]?.childNodes[0]?.textContent?.trim() ?? '';
        return { mark: td[0]?.textContent?.trim() ?? '', label, detail: td[1]?.querySelector('.dim')?.textContent?.trim() ?? '', pts: td[2]?.textContent?.trim() ?? '' };
      });
      return {
        score: document.querySelector('.db-head .dim')?.textContent?.trim() ?? '',
        verdicts: ((root.querySelector('.case-verdicts') as HTMLElement | null)?.innerText ?? '').replace(/\s*\n+\s*/g, ' · ').trim(),
        rows,
        timeline: [...root.querySelectorAll('.timeline li')].map((l) => l.textContent?.trim() ?? ''),
        ic: ((document.querySelector('.db-ic') as HTMLElement | null)?.innerText ?? '').replace(/\s*\n+\s*/g, ' · ').slice(0, 500),
      };
    });
    await shot('debrief');
    await card.screenshot({ path: `${OUT}/step-${String(++shotN).padStart(2, '0')}-debrief-ankle-card.png` }).catch(() => undefined);
    const d = debrief!;
    for (const r of d.rows) log.add('see', `debrief ${r.mark} ${r.label} · ${r.pts}${r.detail ? ` · ${r.detail}` : ''}`);
    for (const t of d.timeline) log.add('see', `timeline ${t}`);
    // what we expect
    const want: [RegExp, string][] = [
      [/^Diagnosis/, 'diagnosis'],
      [/^Disposition/, 'disposition'],
      [/Ottawa/, 'Ottawa rules'],
      [/neurovascular/, 'neurovascular status'],
      [/^Analgesia/, 'analgesia given'],
      [/Functional support/, 'brace / ice'],
      [/no imaging needed/, 'counselling'],
    ];
    const missing = want.filter(([re]) => !d.rows.some((r) => re.test(r.label) && r.mark === '✓')).map(([, n]) => n);
    const hist = d.rows.find((r) => /^History/.test(r.label));
    if (hist) log.add('see', `history: ${hist.label} ${hist.pts}`);
    const imaging = [...d.rows.filter((r) => /Low-value/.test(r.label) && /X-ray|XR|MRI/i.test(r.label)).map((r) => r.label), ...d.timeline.filter((t) => /X-ray|XR |MRI/i.test(t))];
    if (imaging.length) finding(`imaging on the record: ${imaging.join(' | ')}`);
    if (missing.length) throw new Error(`score items not earned: ${missing.join(', ')} (${d.score})`);
    return `${d.score} · ${d.verdicts} · no X-ray/MRI: ${imaging.length === 0}`;
  });

  await sleep(1500);
  if (errors.length) log.add('note', `page errors: ${errors.slice(0, 5).join(' | ')}`);
  const video = page.video();
  await context.close();
  if (video) {
    const p = await video.path();
    videoPath = `${OUT}/playthrough.webm`;
    renameSync(p, videoPath);
    rmSync(`${OUT}/video`, { recursive: true, force: true });
    log.add('note', `video ${videoPath}`);
  }
  const total = Date.now() - log.t0;
  const md = [
    '# Playthrough — Orientation Day, the ankle in Fast Track 1 (real input, recorded)',
    '',
    `${new Date().toISOString()} · total ${fmtT(total)} (budget ~8 min) · video: ${videoPath ?? 'none'} · page errors: ${errors.length} · reloads: ${Math.max(0, reloads - 1)}`,
    '',
    '| step | start | end | result | detail |',
    '|---|---:|---:|---|---|',
    ...steps.map((s) => `| ${s.name} | ${fmtT(s.t0)} | ${fmtT(s.t1)} | ${s.ok ? 'done' : '**not done**'} | ${s.detail.replace(/\|/g, '\\|')} |`),
    '',
    '## Debrief (the ankle case)',
    '',
    debrief ? `${(debrief as { score: string }).score}` : '(no debrief)',
    '',
    ...(debrief ? ['| | item | points | detail |', '|---|---|---:|---|', ...(debrief as { rows: { mark: string; label: string; pts: string; detail: string }[] }).rows.map((r) => `| ${r.mark} | ${r.label} | ${r.pts} | ${r.detail.replace(/\|/g, '\\|')} |`), '', '**Timeline:** ' + (debrief as { timeline: string[] }).timeline.join(' · '), '', '**Infection control:** ' + (debrief as { ic: string }).ic] : []),
    '',
    '## Findings',
    '',
    ...(findings.length ? findings.map((f) => `- ${f}`) : ['- none']),
    '',
  ].join('\n');
  writeFileSync(`${OUT}/playthrough.md`, md);
  writeFileSync(`${OUT}/playthrough.json`, JSON.stringify({ total, steps, findings, debrief, errors, video: videoPath, log: log.steps }, null, 1));
  console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps done · ${findings.length} finding(s) · ${fmtT(total)} · ${OUT}/playthrough.md`);
  if (total > 8.5 * 60000) console.log('note: over the ~8 minute budget');
  process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
} catch (e) {
  log.add('error', `stopped: ${(e as Error).stack ?? e}`);
  process.exitCode = 1;
} finally {
  await h.close();
}

/**
 * The cafeteria's coffee and paying for it, on the real GPU (amenities.ts, cupStacks.ts, payment.ts):
 *
 *   - [E] at the self-serve machine: the hand takes the top paper cup off the stack (the hand at its rim,
 *     the stack one shorter), sets it on the drip tray under the spout, presses the button; then [E]
 *     again: a lid off the lid stack, pressed on, and the cup to hand. Nothing comes to hand unfetched
 *   - the coffee is owed for from the pour ($2.25: a chip says so), however often it is put down and
 *     picked up again; [E] at the till pays with a phone tap on the counter's terminal (the phone within
 *     3 cm of it at the beep), and the cashier thanks you
 *   - heading out of the cafeteria with it unpaid: the cashier calls after you and comes over (to about
 *     1.2 m) with his handheld terminal; [E] on him pays, and he walks back to the till. Far down the
 *     street, he stops at the cafeteria door and calls again instead
 *   - the workroom's mug off its rack (free), the vending machine's tap at its reader before the can drops
 *
 * First and third person; real E (and W, G, F) presses after teleports. Screenshots of each moment.
 *
 *   npx tsx tests/cafe-e2e.ts [outDir] [--only=fp,tp,chase,door,mug,vend] [--port-base=8200]
 */
import { mkdirSync } from 'node:fs';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/cafe';
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 8200);
mkdirSync(out, { recursive: true });

type Ev = Record<string, unknown> & { kind: string };
interface Pay {
  owed: { id: string; amount: number }[];
  due: string | null;
  chip: boolean;
  act: { t: number; at: string; side: string; approach: boolean; phone: boolean; approved: boolean; dist: number | null } | null;
  cashier: { state: string; x: number; z: number; walking: boolean; dist: number; home: number | null; line: string; holding: boolean; armOut: number } | null;
  events: Ev[];
}
interface Amen {
  action: string | null;
  machines: { id: string; state: string; fill: number | null; onTray: boolean; cups: number | null; lids: number | null; mugs: number | null; stand: [number, number] }[];
  drinks: { id: string; label: string; fill: number; held: string | null; lid: boolean; unpaid: boolean }[];
  held: { id: string; label: string; slot: string }[];
  events: Ev[];
  pay: Pay;
}

const CAF = 'coffee:caf_coffee';
const WR = 'coffee:wr_coffee';
/** in front of the cafeteria's machine (amenities.ts: the stand), facing it (north) */
const CAF_STAND = { x: 65.38, z: 1.15 };
/** at the till's counter, facing it */
const TILL = { x: 62.75, z: 3.0 };
/** third person: a camera at the coffee counter's east end, looking along it at the machine */
const COUNTER_CAM = [66.5, 1.72, 1.98];
const COUNTER_AT = [65.42, 1.05, 0.72];
/** …and one from its west end, beside the fridge: the drip tray in view past your arm */
const TRAY_CAM = [64.45, 1.7, 1.55];
const TRAY_AT = [65.32, 1.0, 0.7];

const h = await startHarness({ portBase, dev: true });
try {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // (the dev server's hot reload is cut off for this page: edits elsewhere mid-run would rebuild the world)
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  // (the start-of-shift messages and hints out of the screenshots; the chip and the bubbles stay)
  await page.addStyleTag({ content: '.hud .side-panel, .hud-feed, .toasts, .wl-hint { visibility: hidden !important; }' });
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  const amen = () => ev<Amen>('__acWorld.amenities()');
  const caf = (a: Amen) => a.machines.find((m) => m.id === CAF)!;
  const wr = (a: Amen) => a.machines.find((m) => m.id === WR)!;
  const cam = (m: 'first' | 'third') => ev(`__ac.store.set({ camera: '${m}' })`);
  const hold = (t: number | null) => ev(`__acWorld.amenity('hold', ${t})`);
  const fixedCam = (pos: number[] | null, at?: number[]) => ev(`__acWorld.cam(${pos ? JSON.stringify(pos) : 'null'}${at ? `, ${JSON.stringify(at)}` : ''})`);
  const shot = async (name: string) => {
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`📸 ${out}/${name}.png`);
  };
  const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number, step = 100): Promise<T> => {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) {
      await page.waitForTimeout(step);
      v = await get();
    }
    return v;
  };
  const focus = () => ev<{ key: string; label: string } | null>('__acWorld.focus()');
  /** E, once the prompt names what we mean (the aim is set up by a teleport) */
  const pressE = async (key: string | RegExp, what: string) => {
    const is = (k: string | undefined) => (typeof key === 'string' ? k === key : !!k && key.test(k));
    const f = await until(focus, (x) => is(x?.key), 3000);
    h.check(`the prompt offers ${what}`, is(f?.key), JSON.stringify(f));
    await page.keyboard.press('KeyE');
  };
  /** the till, or its terminal out on its arm: either pays */
  const TILL_KEY = /^use:pay:till(:terminal)?$/;
  const lastEvent = async (kind: string) => [...(await amen()).events].reverse().find((e) => e.kind === kind) as Ev | undefined;
  const payEvent = async (kind: string) => [...(await amen()).pay.events].reverse().find((e) => e.kind === kind) as Ev | undefined;
  const chipText = () => ev<string>(`document.querySelector('.wl-due.on')?.textContent ?? ''`);
  /** first person at the machine, looking at it (the prompt is the machine's) */
  const atMachine = async (yawDeg = 180, pitchDeg = -30) => {
    await cam('first');
    await ev(`__acWorld.teleport(${CAF_STAND.x}, ${CAF_STAND.z}, ${yawDeg}, ${pitchDeg})`);
    await page.waitForTimeout(900);
  };
  /** make a coffee and take it, all with E (first person): it ends in hand, owed */
  const coffee = async () => {
    await atMachine();
    await pressE(`use:${CAF}`, 'a coffee');
    await until(amen, (a) => caf(a).state === 'brewing', 6000);
    await until(amen, (a) => a.action === null, 3000);
    await ev(`__acWorld.amenity('brewNow')`);
    await until(amen, (a) => caf(a).state === 'ready', 3000);
    await atMachine();
    await pressE(`use:${CAF}`, 'to take the coffee');
    return until(amen, (a) => a.action === null && a.held.length > 0, 6000);
  };
  // (start each part with empty hands)
  const emptyHands = async () => {
    for (let i = 0; i < 3 && (await amen()).held.length; i++) {
      await page.keyboard.press('KeyG');
      await page.waitForTimeout(300);
    }
  };

  if (want('fp')) {
    // ── first person: a cup off the stack, under the spout, the button ──
    await atMachine();
    await page.waitForTimeout(2500);
    let a = await amen();
    const cups0 = caf(a).cups!;
    const lids0 = caf(a).lids!;
    const f0 = await focus();
    h.check('the machine says what a coffee costs', /Make a coffee · \$2\.25/.test(f0?.label ?? ''), JSON.stringify(f0));
    h.check('nothing in hand before', a.held.length === 0 && !a.drinks.length, JSON.stringify(a.held));
    await hold(0.72);
    await pressE(`use:${CAF}`, 'a coffee');
    await until(amen, (x) => x.events.some((e) => e.kind === 'grab'), 4000);
    await page.waitForTimeout(400);
    await shot('fp-1-cup-from-stack');
    const grab = await lastEvent('grab');
    a = await amen();
    h.check('first person: the hand at the top cup of the stack when it takes it (≤ 3 cm)', !!grab && grab.from === 'stack' && typeof grab.hand === 'number' && grab.hand <= 0.03, JSON.stringify(grab));
    h.check('…and the stack is one cup shorter', caf(a).cups === cups0 - 1 && grab?.before === cups0 && grab?.after === cups0 - 1, `${cups0} → ${caf(a).cups}`);
    h.check('the cup isn\'t in a hand of the item system (the hand carries it to the machine)', a.held.length === 0, JSON.stringify(a.held));
    await hold(2.0);
    await until(amen, (x) => x.events.some((e) => e.kind === 'place'), 4000);
    await page.waitForTimeout(400);
    await shot('fp-2-cup-under-spout');
    const place = await lastEvent('place');
    h.check('the cup on the drip tray, under the spout (axis within 1.5 cm)', !!place && (place.spout as number) <= 0.015 && (place.tray as number) <= 0.005, JSON.stringify(place));
    await hold(null);
    a = await until(amen, (x) => caf(x).state === 'brewing', 4000);
    const press = await lastEvent('press');
    h.check('the button pressed by the hand: it brews', caf(a).state === 'brewing' && !!press && (press.hand as number) <= 0.03, JSON.stringify(press));
    const d0 = a.drinks[0];
    h.check('poured: owed for (unpaid), and the chip says so', !!d0 && d0.unpaid && a.pay.owed.length === 1 && a.pay.chip && /Coffee \$2\.25 · pay at the till/.test(await chipText()), `${JSON.stringify(a.pay.owed)} "${await chipText()}"`);
    await ev(`__acWorld.amenity('brewNow')`);
    await until(amen, (x) => caf(x).state === 'ready', 3000);
    // ── the lid, then the cup to hand ──
    await atMachine();
    const ft = await focus();
    h.check('ready: the machine offers the coffee', /Take your coffee/.test(ft?.label ?? ''), JSON.stringify(ft));
    await hold(1.5);
    await pressE(`use:${CAF}`, 'to take the coffee');
    await until(amen, (x) => x.events.some((e) => e.kind === 'lidGrab'), 4000);
    await page.waitForTimeout(500);
    await shot('fp-3-lid-onto-cup');
    const lg = await lastEvent('lidGrab');
    a = await amen();
    h.check('the lid off the lid stack: the fingers at the top lid (≤ 3 cm), one lid fewer', !!lg && (lg.hand as number) <= 0.03 && caf(a).lids === lids0 - 1, `${JSON.stringify(lg)} lids ${lids0} → ${caf(a).lids}`);
    await hold(null);
    a = await until(amen, (x) => x.action === null && x.held.length === 1, 5000);
    const lid = await lastEvent('lid');
    const cup = a.drinks.find((d) => d.held);
    h.check('the lid pressed onto the cup, the coffee in hand', !!cup && cup.lid && !!lid && (lid.gap as number) <= 0.01 && cup.fill > 0.95, `${JSON.stringify(cup)} ${JSON.stringify(lid)}`);
    // ── put down and picked up again: still owed ──
    await ev(`__acWorld.teleport(${TILL.x - 2}, ${TILL.z + 0.6}, 0, -60)`);
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(400);
    a = await amen();
    h.check('put down (G)', a.held.length === 0, JSON.stringify(a.held));
    await ev(`__acWorld.pickUp('${cup!.id}')`);
    await page.waitForTimeout(400);
    a = await amen();
    h.check('picked up again, still owed for: putting it down skips nothing', a.held.length === 1 && a.drinks.find((d) => d.id === cup!.id)!.unpaid && a.pay.owed.length === 1, JSON.stringify(a.pay.owed));
    // ── pay at the till: E, the phone out of the free hand's pocket, a tap on the terminal ──
    await ev(`__acWorld.teleport(${TILL.x}, ${TILL.z}, 180, -24)`);
    await page.waitForTimeout(1200);
    const fp = await focus();
    h.check('the till offers to take the money', TILL_KEY.test(fp?.key ?? '') && /Pay \$2\.25 \(tap your phone\)/.test(fp?.label ?? ''), JSON.stringify(fp));
    // (the paying arm through the tap, held at moments of it: the sleeve's end never in view. It once
    // showed as a hole by the shoulder, the arm hung after a hand parked out of reach below the view)
    type FpArm = { vfov: number; aspect: number; R: { end: number[] } | null; L: { end: number[] } | null } | null;
    const seen: string[] = [];
    let drawn = 0;
    const sleeveEnds = async (t: number) => {
      await hold(t);
      await until(amen, (x) => (x.pay.act?.t ?? -1) >= t - 0.006, 4000, 20);
      await page.waitForTimeout(150);
      const g = await ev<FpArm>('__acWorld.hygiene().fpArm');
      if (!g) return;
      const ty = Math.tan((g.vfov / 2) * (Math.PI / 180));
      for (const [side, j] of [['R', g.R], ['L', g.L]] as const) {
        if (!j) continue;
        drawn++;
        const [x, y, z] = j.end;
        if (z > 0.05 && Math.abs(x / z) < ty * g.aspect && Math.abs(y / z) < ty) seen.push(`${side} at ${t} s: ${j.end.join(', ')}`);
      }
    };
    await hold(0.3);
    await pressE(TILL_KEY, 'to pay at the till');
    await until(amen, (x) => x.pay.act !== null, 4000);
    for (const t of [0.3, 0.7]) await sleeveEnds(t);
    await hold(1.5);
    await until(amen, (x) => x.pay.events.some((e) => e.kind === 'tap'), 6000);
    await page.waitForTimeout(500);
    await shot('fp-4-tap-at-till');
    const tap = await payEvent('tap');
    a = await amen();
    h.check('first person: the phone within 3 cm of the till\'s terminal at the beep', !!tap && tap.at === 'counter' && typeof tap.dist === 'number' && tap.dist <= 0.03 && tap.side === 'L', JSON.stringify(tap));
    for (const t of [1.5, 2.0, 2.35]) await sleeveEnds(t);
    h.check('first person: the paying arm\'s sleeve ends out of view all through the tap', drawn >= 3 && seen.length === 0, `${drawn} arms drawn at 5 moments${seen.length ? ' · in view: ' + seen.join(' | ') : ''}`);
    await hold(null);
    a = await until(amen, (x) => x.pay.act === null, 4000);
    const thanks = [...a.pay.events].reverse().find((e) => e.kind === 'line');
    h.check('paid: nothing owed, the cup paid for, the chip gone; the cashier thanks you', !a.pay.owed.length && !a.drinks.some((d) => d.unpaid) && !a.pay.chip && !(await chipText()) && thanks?.text === 'Thanks, have a good one!', JSON.stringify({ owed: a.pay.owed, thanks }));
    await emptyHands();
  }

  if (want('tp')) {
    // ── third person: the same, seen from beside the counter (E aimed in first person, then the camera) ──
    await emptyHands();
    await atMachine();
    await page.waitForTimeout(800);
    await hold(0.72);
    await pressE(`use:${CAF}`, 'a coffee');
    await cam('third');
    // (from the east end of the counter: the stacks, the right hand and the drip tray in view)
    await fixedCam(COUNTER_CAM, COUNTER_AT);
    await until(amen, (x) => x.events.some((e) => e.kind === 'grab' && e.tp === true), 5000);
    await page.waitForTimeout(600);
    await shot('tp-1-cup-from-stack');
    const grab = [...(await amen()).events].reverse().find((e) => e.kind === 'grab');
    h.check('third person: the hand at the top cup of the stack when it takes it (≤ 3 cm)', !!grab && grab.tp === true && (grab.hand as number) <= 0.03, JSON.stringify(grab));
    await hold(2.0);
    await fixedCam(TRAY_CAM, TRAY_AT);
    await page.waitForTimeout(900);
    await shot('tp-2-cup-under-spout');
    const place = await lastEvent('place');
    h.check('third person: the cup under the spout', !!place && (place.spout as number) <= 0.015, JSON.stringify(place));
    await hold(null);
    await until(amen, (x) => caf(x).state === 'brewing' && x.action === null, 4000);
    await ev(`__acWorld.amenity('brewNow')`);
    await until(amen, (x) => caf(x).state === 'ready', 3000);
    await fixedCam(null);
    await atMachine();
    await hold(1.5);
    await pressE(`use:${CAF}`, 'to take the coffee');
    await cam('third');
    await fixedCam(COUNTER_CAM, COUNTER_AT);
    await until(amen, (x) => x.events.some((e) => e.kind === 'lidGrab' && e.tp === true), 5000);
    await fixedCam(TRAY_CAM, TRAY_AT);
    await page.waitForTimeout(700);
    await shot('tp-3-lid-onto-cup');
    const lg = [...(await amen()).events].reverse().find((e) => e.kind === 'lidGrab');
    h.check('third person: the fingers at the top lid of the lid stack (≤ 3 cm)', !!lg && lg.tp === true && (lg.hand as number) <= 0.03, JSON.stringify(lg));
    await hold(null);
    let a = await until(amen, (x) => x.action === null && x.held.length === 1, 5000);
    const grip = await lastEvent('grip');
    h.check('third person: the hand round the cup on the tray as it takes it (≤ 3 cm), lid on', !!grip && (grip.hand as number) <= 0.03 && !!a.drinks.find((d) => d.held)?.lid, JSON.stringify(grip));
    await fixedCam(null);
    // the till: E aimed in first person, the tap seen from beside the counter
    await cam('first');
    await ev(`__acWorld.teleport(${TILL.x}, ${TILL.z}, 180, -24)`);
    await page.waitForTimeout(1200);
    await hold(1.5);
    await pressE(TILL_KEY, 'to pay at the till');
    await cam('third');
    // (the coffee is in the right hand, so the left one pays: seen from that side)
    await fixedCam([61.75, 1.72, 3.25], [62.9, 1.08, 2.3]);
    await until(amen, (x) => x.pay.events.filter((e) => e.kind === 'tap').length >= (want('fp') ? 2 : 1), 6000);
    await page.waitForTimeout(600);
    await shot('tp-4-tap-at-till');
    const tap = await payEvent('tap');
    h.check('third person: the phone within 3 cm of the till\'s terminal at the beep', !!tap && tap.tp === true && typeof tap.dist === 'number' && tap.dist <= 0.03, JSON.stringify(tap));
    await hold(null);
    a = await until(amen, (x) => x.pay.act === null, 4000);
    h.check('third person: paid', !a.pay.owed.length, JSON.stringify(a.pay.owed));
    await fixedCam(null);
    await emptyHands();
  }

  if (want('chase')) {
    // ── out of the door with it unpaid: the cashier calls, comes over with his terminal ──
    await emptyHands();
    let a = await coffee();
    h.check('a coffee in hand, owed', a.held.length === 1 && a.pay.owed.length === 1, JSON.stringify(a.pay.owed));
    await cam('first');
    // inside, heading for the door (W) and stopping short of it
    await ev(`__acWorld.teleport(58.3, 6.6, 0, -8)`);
    await page.waitForTimeout(700);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    a = await until(amen, (x) => x.pay.cashier?.state === 'going', 3000);
    const call = a.pay.events.find((e) => e.kind === 'line' && /two twenty-five/.test(String(e.text)));
    h.check('heading out unpaid: the cashier calls after you', !!call && a.pay.cashier?.state === 'going', JSON.stringify(call));
    h.check('…with his handheld terminal in hand', !!a.pay.cashier?.holding, JSON.stringify(a.pay.cashier));
    const me = await ev<{ x: number; z: number }>('__acWorld.state()');
    /** a camera beside the two of you (on the room's side), looking at the middle */
    const besides = (c: { x: number; z: number }, out: number, up: number) => {
      const mx = (me.x + c.x) / 2;
      const mz = (me.z + c.z) / 2;
      const dx = c.x - me.x;
      const dz = c.z - me.z;
      const d = Math.hypot(dx, dz) || 1;
      let px = -dz / d;
      let pz = dx / d;
      if (px * (61.5 - mx) + pz * (4.5 - mz) < 0) [px, pz] = [-px, -pz];
      return fixedCam([mx + px * out, up, mz + pz * out], [mx, 1.0, mz]);
    };
    // on his way across the room: first person, turned to see him; then from beside you
    a = await until(amen, (x) => (x.pay.cashier?.dist ?? 99) < 3.4, 15000);
    const c = a.pay.cashier!;
    await ev(`__acWorld.teleport(${me.x}, ${me.z}, ${((Math.atan2(c.x - me.x, c.z - me.z) * 180) / Math.PI).toFixed(1)}, -8)`);
    await page.waitForTimeout(250);
    await shot('fp-5-cashier-coming');
    await cam('third');
    await besides(c, 2.4, 1.8);
    await page.waitForTimeout(450);
    await shot('tp-5-cashier-coming');
    a = await until(amen, (x) => x.pay.cashier?.state === 'waiting', 15000);
    const reached = await payEvent('reached');
    h.check('he comes up to you (stops within about 1.2 m)', a.pay.cashier?.state === 'waiting' && !!reached && (reached.dist as number) <= 1.3, JSON.stringify(reached));
    await page.waitForTimeout(900);
    await besides(a.pay.cashier!, 1.9, 1.55);
    await page.waitForTimeout(300);
    await shot('tp-6-cashier-holds-out-terminal');
    await fixedCam(null);
    // E on him: the tap on the terminal he holds out
    await cam('first');
    const c2 = (await amen()).pay.cashier!;
    const me2 = await ev<{ x: number; z: number }>('__acWorld.state()');
    await ev(`__acWorld.teleport(${me2.x}, ${me2.z}, ${((Math.atan2(c2.x - me2.x, c2.z - me2.z) * 180) / Math.PI).toFixed(1)}, -18)`);
    await page.waitForTimeout(500);
    const fl = await focus();
    h.check('E on him pays', fl?.key === 'use:pay:caf_luis' && /Pay \$2\.25/.test(fl.label), JSON.stringify(fl));
    await hold(1.5);
    await pressE('use:pay:caf_luis', 'to pay the cashier');
    const t0 = (await amen()).pay.events.filter((e) => e.kind === 'tap').length;
    await until(amen, (x) => x.pay.events.filter((e) => e.kind === 'tap').length > t0, 8000);
    await page.waitForTimeout(500);
    await shot('fp-6-tap-on-cashier-terminal');
    await cam('third');
    await besides(c2, 1.9, 1.55);
    await page.waitForTimeout(450);
    await shot('tp-6-tap-on-cashier-terminal');
    const tap = await payEvent('tap');
    h.check('the phone within 3 cm of his terminal at the beep', !!tap && tap.at === 'handheld' && typeof tap.dist === 'number' && tap.dist <= 0.03, JSON.stringify(tap));
    await hold(null);
    await fixedCam(null);
    a = await until(amen, (x) => !x.pay.owed.length && x.pay.cashier?.state !== 'waiting', 5000);
    h.check('paid him: nothing owed, he thanks you', !a.pay.owed.length && a.pay.cashier?.line === 'Thanks, have a good one!', JSON.stringify(a.pay.cashier));
    a = await until(amen, (x) => x.pay.cashier?.state === 'home', 30000, 300);
    h.check('…and walks back to the till', a.pay.cashier?.state === 'home' && (a.pay.cashier.home ?? 9) < 0.45, JSON.stringify(a.pay.cashier));
    await cam('first');
    await emptyHands();
  }

  if (want('door')) {
    // ── far down the street: he stops at the cafeteria door and calls again; you still owe it ──
    await emptyHands();
    await coffee();
    await cam('first');
    await ev(`__acWorld.teleport(58.3, 6.6, 0, -8)`);
    await page.waitForTimeout(700);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1300);
    await page.keyboard.up('KeyW');
    await until(amen, (x) => x.pay.cashier?.state === 'going', 3000);
    // you carry on, far along the street
    await ev(`__acWorld.walkTo(51.0, 11.3)`);
    let a = await until(amen, (x) => x.pay.events.some((e) => e.kind === 'door'), 30000, 250);
    const again = [...a.pay.events].reverse().find((e) => e.kind === 'line');
    const pos = await ev<{ x: number; z: number }>('__acWorld.state()');
    h.check('far down the street: he stops at the cafeteria door and calls again', a.pay.events.some((e) => e.kind === 'door') && /still owe/.test(String(again?.text)) && Math.hypot((a.pay.cashier?.x ?? 0) - 57.8, (a.pay.cashier?.z ?? 0) - 8.25) < 0.8, JSON.stringify({ cashier: a.pay.cashier, again, you: pos }));
    await cam('third');
    await fixedCam([56.2, 2.2, 11.6], [57.6, 1.0, 8.6]);
    await page.waitForTimeout(400);
    await shot('tp-7-cashier-calls-at-door');
    await fixedCam(null);
    a = await until(amen, (x) => x.pay.cashier?.state === 'home', 30000, 300);
    h.check('…goes back to the till, and you still owe it (the chip stays)', a.pay.cashier?.state === 'home' && a.pay.owed.length === 1 && a.pay.chip, JSON.stringify({ cashier: a.pay.cashier, owed: a.pay.owed }));
    // back to pay it, at the till
    await cam('first');
    await ev(`__acWorld.teleport(${TILL.x}, ${TILL.z}, 180, -24)`);
    await page.waitForTimeout(1000);
    await pressE(TILL_KEY, 'to pay at the till');
    a = await until(amen, (x) => !x.pay.owed.length && x.pay.act === null, 8000);
    h.check('paid at the till after all', !a.pay.owed.length && !a.pay.chip, JSON.stringify(a.pay.owed));
    await emptyHands();
  }

  if (want('mug')) {
    // ── the workroom: a mug off the rack beside the machine; free ──
    await emptyHands();
    await cam('first');
    const a0 = await amen();
    const stand = wr(a0).stand;
    await ev(`__acWorld.teleport(${stand[0]}, ${stand[1]}, 90, -30)`);
    await page.waitForTimeout(2500);
    const mugs0 = wr(await amen()).mugs!;
    const fm = await focus();
    h.check('the staff machine: a coffee, free', fm?.key === `use:${WR}` && /staff machine/.test(fm.label), JSON.stringify(fm));
    await hold(0.68);
    await pressE(`use:${WR}`, 'a coffee (staff machine)');
    await until(amen, (x) => x.events.some((e) => e.kind === 'grab' && e.from === 'rack'), 4000);
    await page.waitForTimeout(400);
    await shot('fp-8-mug-from-rack');
    const grab = await lastEvent('grab');
    let a = await amen();
    h.check('the hand round a mug on the rack as it takes it (≤ 3 cm), one mug fewer', !!grab && grab.from === 'rack' && (grab.hand as number) <= 0.03 && wr(a).mugs === mugs0 - 1, `${JSON.stringify(grab)} ${mugs0} → ${wr(a).mugs}`);
    await hold(null);
    await until(amen, (x) => wr(x).state === 'brewing' && x.action === null, 5000);
    await ev(`__acWorld.amenity('brewNow')`);
    await until(amen, (x) => wr(x).state === 'ready', 3000);
    await ev(`__acWorld.teleport(${stand[0]}, ${stand[1]}, 90, -30)`);
    await page.waitForTimeout(500);
    await pressE(`use:${WR}`, 'to take the mug');
    a = await until(amen, (x) => x.action === null && x.held.length === 1, 4000);
    const mug = a.drinks.find((d) => d.held);
    h.check('a mug of coffee in hand, nothing owed (the staff machine is free)', !!mug && /mug of coffee/.test(mug.label) && !mug.unpaid && !a.pay.owed.length && !a.pay.chip, JSON.stringify({ mug, owed: a.pay.owed }));
    await emptyHands();
  }

  if (want('vend')) {
    // ── the vending machine: [F] what it is; [E] a drink, paid by a tap at its reader first ──
    await emptyHands();
    await cam('first');
    await ev(`__acWorld.teleport(1.52, 22.85, -90, -6)`);
    await page.waitForTimeout(2500);
    const fv = await focus();
    h.check('the vending machine: "Buy a drink · [F] Inspect"', fv?.key === 'use:vend' && fv.label === 'Buy a drink · [F] Inspect', JSON.stringify(fv));
    await page.keyboard.press('KeyF');
    const card = await until(() => ev<{ title: string } | null>('__ac.store.get().inspect'), (x) => !!x, 2000);
    h.check('F opens its card', card?.title === 'Vending machine', JSON.stringify(card));
    await page.keyboard.press('KeyF');
    await until(() => ev<unknown>('__ac.store.get().inspect'), (x) => !x, 2000);
    for (const mode of ['first', 'third'] as const) {
      await cam('first');
      await ev(`__acWorld.teleport(1.52, 22.85, -90, -6)`);
      await page.waitForTimeout(800);
      const taps = (await amen()).pay.events.filter((e) => e.kind === 'tap' && e.at === 'reader').length;
      await hold(1.5);
      await pressE('use:vend', 'a drink');
      if (mode === 'third') {
        await cam('third');
        await fixedCam([2.35, 1.75, 21.95], [1.15, 1.2, 22.72]);
      }
      let a = await until(amen, (x) => x.pay.events.filter((e) => e.kind === 'tap' && e.at === 'reader').length > taps, 7000);
      await page.waitForTimeout(500);
      await shot(`${mode === 'first' ? 'fp' : 'tp'}-9-tap-at-vending-reader`);
      const tap = [...a.pay.events].reverse().find((e) => e.kind === 'tap' && e.at === 'reader');
      h.check(`${mode} person: the phone within 3 cm of the vending machine's reader at the beep`, !!tap && tap.tp === (mode === 'third') && typeof tap.dist === 'number' && tap.dist <= 0.03, JSON.stringify(tap));
      h.check(`${mode} person: no can until it's paid`, !a.held.some((x) => /can of/.test(x.label)), JSON.stringify(a.held));
      await hold(null);
      a = await until(amen, (x) => x.held.some((i) => /can of/.test(i.label)) && x.action === null, 9000);
      h.check(`${mode} person: then the can drops and comes to hand`, a.held.some((i) => /can of/.test(i.label)), JSON.stringify(a.held));
      await fixedCam(null);
      await emptyHands();
    }
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

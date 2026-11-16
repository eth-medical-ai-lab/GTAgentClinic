/**
 * Floor 2 and the elevators on the real GPU: call a car, ride up with the doors shut and the
 * player held in the car, walk out onto the ward (HUD "Floor 2 · …"), the light curtain holding
 * the doors, Stair 1's fire door both ways, the ride back down, and frame rates on the ward.
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 *
 *   npx tsx tests/floors-e2e.ts [--port-base=6500]
 */
import { startHarness } from './harness';

const arg = process.argv.find((a) => a.startsWith('--port-base='));
const h = await startHarness({ portBase: arg ? Number(arg.split('=')[1]) : 6500, dev: true });
const { check } = h;

type Car = { id: string; y: number; level: number; door: number; phase: string; moving: boolean };
type F = { level: number; floorY: number; room: string | null; elevator: { cars: Car[] }; fireDoor: number | null };
const CAR_X: Record<string, number> = { A: 52.35, B: 54.65 };

try {
  const { page, errors } = await h.nightShift('', 9000);
  // the dev server hot-reloads when a source file changes mid-run: the world is rebuilt with you at the spawn
  const reloads: string[] = [];
  page.on('console', (m) => {
    if (/\[vite\] (hot updated|page reload)/.test(m.text())) reloads.push(m.text());
  });
  const f = () => page.evaluate('__acWorld.floors()') as Promise<F>;
  const st = () => page.evaluate('__acWorld.state()') as Promise<{ x: number; z: number; y: number }>;
  const hud = () => page.evaluate(`document.querySelector('.hud-sub')?.textContent ?? ''`) as Promise<string>;
  const carOf = (x: F, id: string) => x.elevator.cars.find((c) => c.id === id)!;
  const until = async (pred: (x: F) => boolean, ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const x = await f();
      if (pred(x)) return x;
      await page.waitForTimeout(100);
    }
    return null;
  };
  const walk = async (ms: number) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(ms);
    await page.keyboard.up('KeyW');
  };
  /** call a car to `level` from its lobby, step in and ride to the other floor */
  const ride = async (from: number, to: number) => {
    const Y = from * 3;
    await page.evaluate(`__acWorld.teleportY(53.5, 2.6, ${Y}, 180, -4)`);
    await page.waitForTimeout(600);
    await page.evaluate(`__acWorld.press('elev:east:call:${from}')`);
    const opened = await until((x) => x.elevator.cars.some((c) => c.level === from && c.phase === 'open' && !c.moving), 14000);
    check(`hall call on Floor ${from + 1}: a car comes and opens`, !!opened);
    if (!opened) return;
    const car = opened.elevator.cars.find((c) => c.level === from && c.phase === 'open')!;
    await page.evaluate(`__acWorld.teleportY(${CAR_X[car.id]}, -1.2, ${Y}, 0, -4)`);
    await page.waitForTimeout(500);
    await page.evaluate(`__acWorld.press('elev:east:car:${car.id}')`);
    const moving = await until((x) => carOf(x, car.id).moving, 8000);
    check(`car ${car.id}: the panel sends it to Floor ${to + 1}`, !!moving);
    check('doors shut before it moves', !!moving && carOf(moving, car.id).door === 0, `door ${moving ? carOf(moving, car.id).door : '?'}`);
    // push toward the doors mid-ride: you stay in the car, on its floor
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    const s = await st();
    const c = carOf(await f(), car.id);
    await page.keyboard.up('KeyW');
    check('held in the car mid-ride', s.z < -0.15 && Math.abs(s.y - c.y) < 0.15, `z ${s.z.toFixed(2)}, feet ${s.y.toFixed(2)} vs car ${c.y.toFixed(2)}`);
    const arrived = await until((x) => carOf(x, car.id).level === to && carOf(x, car.id).phase === 'open', 14000);
    check(`arrives at Floor ${to + 1} and opens`, !!arrived);
    const s2 = await st();
    check('you arrive with it', Math.abs(s2.y - to * 3) < 0.1, `feet at ${s2.y.toFixed(2)}`);
    return car.id;
  };

  // ── up by elevator ──
  const id = await ride(0, 1);
  await walk(1700);
  const out = await f();
  check('walk out onto Floor 2', out.level === 1 && out.room === 'f2_lobby', `level ${out.level}, room ${out.room}`);
  await page.waitForTimeout(1500);
  const label = (await hud()).trim();
  check('HUD: Floor 2 · Elevator lobby', label.includes('Floor 2') && label.includes('Elevator lobby'), label);

  // ── the light curtain: standing in the entrance keeps the doors open ──
  if (id) {
    await page.evaluate(`__acWorld.teleportY(${CAR_X[id]}, 0.0, 3, 180, -4)`);
    await page.evaluate(`__acWorld.press('elev:east:call:1')`);
    let minDoor = 1;
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(100);
      const c = carOf(await f(), id);
      if (i > 20) minDoor = Math.min(minDoor, c.door);
    }
    check('light curtain: doors stay open while you stand in them', minDoor > 0.5, `min door ${minDoor.toFixed(2)} over 7 s`);
    await page.evaluate('__acWorld.teleportY(53.5, 4.0, 3, 180, -4)');
    const shut = await until((x) => carOf(x, id).phase === 'closed', 12000);
    check('step clear: the doors close', !!shut);
  }

  // ── Stair 1's fire door, both ways ──
  await page.evaluate('__acWorld.teleportY(52.6, 4.57, 3, -90, -4)');
  await page.waitForTimeout(500);
  let swung = 0;
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(100);
    swung = Math.max(swung, (await f()).fireDoor ?? 0);
  }
  await page.keyboard.up('KeyW');
  const inCore = await f();
  check('lobby → Stair 1 through the fire door', inCore.room === 'stairs' && swung > 0.5, `room ${inCore.room}, door swung ${swung.toFixed(2)} rad`);
  await page.evaluate('__acWorld.teleportY(50.0, 4.57, 3, 90, -4)');
  await page.waitForTimeout(400);
  await walk(1800);
  const back = await f();
  check('Stair 1 → lobby (the door opens toward you)', back.room === 'f2_lobby', `room ${back.room}`);
  await page.waitForTimeout(3500);
  check('the fire door closes behind you', ((await f()).fireDoor ?? 1) < 0.05);
  // walking past it along the lobby (1 m in front, not at it) leaves it shut
  await page.evaluate('__acWorld.teleportY(52.0, 2.4, 3, 0, -4)');
  await page.waitForTimeout(400);
  let passing = 0;
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(100);
    passing = Math.max(passing, (await f()).fireDoor ?? 0);
  }
  await page.keyboard.up('KeyW');
  check('walking past the fire door leaves it shut', passing < 0.05, `door swung ${passing.toFixed(2)} rad`);

  // ── the ward: frame rates (High, 1600×900) ──
  const fps = () => page.evaluate(`new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(tick); })`) as Promise<number>;
  for (const [name, v] of Object.entries({ corridor: [52.2, 11.2, 90, -3], station: [60.5, 10.0, 0, -8], room205: [64.4, 13.8, 0, -6], lounge: [52.6, 13.9, -140, -6] })) {
    await page.evaluate(`__acWorld.teleportY(${v[0]}, ${v[1]}, 3, ${v[2]}, ${v[3]})`);
    await page.waitForTimeout(1500);
    console.log(`  fps ${name.padEnd(9)} ${Math.max(await fps(), await fps())}`);
  }

  // ── down again ──
  await ride(1, 0);
  await walk(1700);
  const down = await f();
  check('walk out on Floor 1', down.level === 0 && down.room === 'lobby', `level ${down.level}, room ${down.room}`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (reloads.length) console.log(`  note: ${reloads.length} hot reload(s) during the run (files edited meanwhile; rerun if a check failed): ${reloads[0].slice(0, 120)}`);
} finally {
  await h.close();
}
console.log(h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all floor checks passed');
process.exit(h.failed() ? 1 : 0);

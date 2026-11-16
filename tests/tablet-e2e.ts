/**
 * Putting the patient/staff tablet away and getting it back: a two-finger trackpad swipe down
 * (wheel deltaY < 0 with macOS natural scrolling) and a right-button drag tuck it into a tile at
 * the screen edge; the game plays normally meanwhile (WASD walks); a click on the tile or talking
 * to someone brings it back, with the typed draft intact.
 *
 *   npx tsx tests/tablet-e2e.ts [outDir]
 */
import { mkdirSync } from 'node:fs';
import { startHarness } from './harness';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/tablet';
mkdirSync(out, { recursive: true });
const h = await startHarness({ portBase: 5600 });
const { check } = h;
const errs: string[] = [];
try {
  const { page, errors } = await h.nightShift();
  errs.push(...errors);
  const tabletMin = () => page.evaluate('__ac.store.get().tabletMin') as Promise<boolean>;
  // talk to the nearest nurse: open her tablet panel the way E does
  const nurse = (await page.evaluate(`__ac.store.get().view.npcs.find((n) => n.role === 'nurse').id`)) as string;
  const openPanel = () => page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: '${nurse}', tab: 'talk' }, tabletMin: false })`);
  await openPanel();
  await page.waitForSelector('.tablet', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.fill('.tablet textarea, .tablet input[type="text"]', 'Can you get a full set of vitals');
  const head = await page.locator('.tablet .sp-head').boundingBox();
  if (!head) throw new Error('no tablet header');

  // 1. two-finger swipe down over the tablet
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -24);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(450);
  check('a two-finger swipe down tucks the tablet away', (await tabletMin()) && (await page.locator('.tablet-dock').isVisible()));
  await page.screenshot({ path: `${out}/tucked.png` });

  // 2. the game plays normally meanwhile: WASD walks
  await page.mouse.move(700, 500);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  const st = (await page.evaluate('__acWorld.state()')) as { speed: number };
  await page.keyboard.up('KeyW');
  check('with the tablet away you walk normally', st.speed > 1.5, `${st.speed.toFixed(2)} m/s`);

  // 3. click the tile: back, with the draft intact
  // Tucking restores look mode if it was active before opening the tablet.
  if (await page.evaluate('!!document.pointerLockElement')) {
    await page.mouse.click(700, 500, { button: 'right' });
    await page.waitForTimeout(150);
  }
  await page.click('.tablet-dock');
  await page.waitForTimeout(450);
  const draft = await page.inputValue('.tablet textarea, .tablet input[type="text"]');
  check('clicking the tile brings it back with the draft', !(await tabletMin()) && (await page.locator('.tablet').isVisible()) && draft.includes('full set of vitals'), `draft "${draft}"`);

  // 4. right-button drag down tucks it too; a short drag springs back
  const head2 = (await page.locator('.tablet .sp-head').boundingBox())!;
  await page.mouse.move(head2.x + 60, head2.y + 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(head2.x + 66, head2.y + 50, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);
  check('a short right-drag springs back', !(await tabletMin()));
  await page.mouse.move(head2.x + 60, head2.y + 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(head2.x + 90, head2.y + 220, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(450);
  check('a right-drag down tucks it away', await tabletMin());

  // 5. talking to someone (E) brings it back
  await openPanel();
  await page.waitForTimeout(400);
  check('talking to someone brings the tablet back', !(await tabletMin()) && (await page.locator('.tablet').isVisible()));
  await page.screenshot({ path: `${out}/back.png` });

  // The tips branch also adds tucking to the Tab patient list.
  await page.evaluate("__ac.store.set({ panel: { kind: 'tablet' }, tabletMin: false })");
  await page.waitForTimeout(450);
  const listHead = (await page.locator('.tablet .sp-head').boundingBox())!;
  await page.mouse.move(listHead.x + 60, listHead.y + 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(listHead.x + 90, listHead.y + 220, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(450);
  check('right-drag puts away the Tab patient list without opening settings',
    await page.evaluate('__ac.store.get().panel === null') as boolean);

} finally {
  await h.close();
}
check('no browser errors', errs.length === 0, errs.slice(0, 4).join(' | '));
console.log(`\n${h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all tablet checks passed'} · screenshots in ${out}/`);
process.exit(h.failed() ? 1 : 0);

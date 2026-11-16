/**
 * The in-game settings (Esc with nothing open: client/src/ui/SettingsPanel.tsx, App.tsx), in a
 * headless GPU browser:
 *   1. Esc with nothing open opens them, Esc again closes them; Esc still first closes what is open;
 *      key repeats (holding Esc) open nothing
 *   2. mouse sensitivity scales both look paths (pointer lock and drag-to-look), live; invert-Y flips
 *      the vertical; the setting is saved and survives a reload
 *   3. the browser taking the pointer lock back on Esc opens them once, never open-then-close with
 *      the same press's keydown; the world's own releases (V to top-down, a panel) open nothing
 *   4. holding Esc to leave full screen leaves nothing open
 * Pointer lock and full screen are faked (headless Chromium grants neither for real).
 *
 *   npx tsx tests/settings-e2e.ts [outDir]
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/settings';
mkdirSync(out, { recursive: true });

/** pointer lock and full screen the test switches by hand: __lock(true/false) as the browser would */
const FAKE = `(() => {
  const w = window;
  w.__pl = null;
  w.__full = false;
  w.__lockRequests = 0;
  w.__lockCalls = [];
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return w.__pl; } });
  Element.prototype.requestPointerLock = function () { w.__lockRequests++; w.__lockCalls.push({ active: navigator.userActivation.isActive, fullscreen: w.__full, world: !!document.querySelector('.wl-input') }); if ((w.__requireGesture && (!navigator.userActivation.isActive || w.__full)) || (w.__denyFirstLock && w.__lockRequests === 1)) return Promise.reject(new DOMException('Click required', 'NotAllowedError')); w.__pl = this; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (!w.__pl) return; w.__pl = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0); };
  w.__lock = (on) => { w.__pl = on ? document.querySelector('.world .wl-input') : null; document.dispatchEvent(new Event('pointerlockchange')); };
  Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get() { return w.__full ? document.documentElement : null; } });
  Element.prototype.requestFullscreen = function () { w.__full = true; setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 0); return Promise.resolve(); };
  Document.prototype.exitFullscreen = function () { w.__full = false; setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 0); return Promise.resolve(); };
})();`;

const panel = (page: Page) => page.evaluate('__ac.store.get().panel?.kind ?? null') as Promise<string | null>;
const yawPitch = (page: Page) => page.evaluate('(({ yaw, pitch }) => ({ yaw, pitch }))(__acWorld.state())') as Promise<{ yaw: number; pitch: number }>;
/** pointer-locked mouse movement (dx, dy px) through the controller's look path */
const lockedLook = async (page: Page, dx: number, dy: number) => {
  const a = await yawPitch(page);
  await page.evaluate(`window.dispatchEvent(new CustomEvent('ac-doctor-look', { detail: { dx: ${dx}, dy: ${dy} } }))`);
  const b = await yawPitch(page);
  return { yaw: a.yaw - b.yaw, pitch: a.pitch - b.pitch };
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const h = await startHarness({ portBase: 7880 });
const { check } = h;
try {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(FAKE);
  await page.addInitScript('window.__denyFirstLock = true');
  await page.goto(`${h.url}/?debug=1`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.uncheck('label:has-text("Full screen when the shift starts") input');
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.evaluate('__acWorld.teleport(8.4, 17.6, 90, 0)').catch(() => undefined);

  check('startup makes one capture attempt', await page.evaluate('window.__lockRequests === 1') as boolean);
  check('startup leaves the pointer visible until capture succeeds',
    await page.locator('.wl-input').evaluate(el => getComputedStyle(el).cursor !== 'none'));
  check('startup shows a corner hint instead of a settings popup',
    (await panel(page)) === null && await page.locator('.wl-control-hint').isVisible() &&
    (await page.locator('.wl-control-hint').innerText()).includes('Esc: settings and controls'));
  const initialLook = await yawPitch(page);
  await page.mouse.move(400, 450);
  await page.mouse.move(900, 450, { steps: 12 });
  check('uncaptured pointer movement does not produce screen-edge-limited turning', near(initialLook.yaw, (await yawPitch(page)).yaw));
  await page.mouse.click(400, 450);
  await page.waitForTimeout(150);
  check('clicking empty scenery captures the pointer', await page.evaluate('!!document.pointerLockElement') as boolean);
  const spin = await yawPitch(page);
  await page.evaluate(`(() => { for (let i = 0; i < 100; i++) document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1599, movementX: 100 })); })()`);
  check('captured movement allows more than three full turns at the screen edge', spin.yaw - (await yawPitch(page)).yaw > 6 * Math.PI);
  // Deliberately release through the game, not the browser Esc path.
  await page.mouse.click(400, 450, { button: 'right' });
  await page.waitForTimeout(150);

  // ── 1) open and close ──
  check('nothing is open at the start', (await panel(page)) === null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc with nothing open opens the settings', (await panel(page)) === 'settings' && (await page.isVisible('.settings-panel')));
  check('…with the sensitivity slider, invert-Y, full screen and the keys', (await page.isVisible('.settings-panel input[type=range]')) && (await page.isVisible('text=Invert vertical look')) && (await page.isVisible('.settings-panel >> text=Full screen')) && (await page.locator('.control-keys > div').count()) >= 10);
  await page.screenshot({ path: `${out}/settings-1600x900.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc again closes them', (await panel(page)) === null);
  await page.click('.hud button[aria-label="Settings"]');
  check('the HUD ⚙ button opens them', (await panel(page)) === 'settings');
  await page.click('.settings-panel button:has-text("Close")');
  check('…and Close closes them', (await panel(page)) === null);
  await page.evaluate(`__ac.store.set({ panel: { kind: 'board' } })`);
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('with a panel open, Esc closes that panel and opens nothing else', (await panel(page)) === null);
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true }))`);
  await page.waitForTimeout(150);
  check('an Esc key repeat (holding Esc) opens nothing', (await panel(page)) === null);

  // Cursor mode releases pointer lock deliberately; it must not trigger the Esc menu.
  await page.evaluate('__lock(true)');
  await page.mouse.click(400, 450, { button: 'right' });
  await page.waitForTimeout(150);
  check('right-click frees the cursor without opening settings',
    (await panel(page)) === null && await page.evaluate('__acWorld.state().cursorMode') as boolean);
  const still = await yawPitch(page);
  await page.waitForTimeout(5500);
  await page.mouse.move(420, 450, { steps: 3 });
  const later = await yawPitch(page);
  check('cursor mode persists beyond the old five-second timeout',
    await page.evaluate('__acWorld.state().cursorMode') as boolean && near(still.yaw, later.yaw));
  await page.mouse.click(420, 450, { button: 'right' });
  await page.waitForTimeout(150);
  check('right-click returns to looking with the scene cursor hidden',
    (await panel(page)) === null && !(await page.evaluate('__acWorld.state().cursorMode')) &&
    await page.locator('.wl-input').evaluate(el => getComputedStyle(el).cursor === 'none'));
  await page.evaluate('__lock(false)');
  await page.waitForTimeout(700);
  if ((await panel(page)) !== null) await page.keyboard.press('Escape');

  // ── 2) sensitivity on both look paths ──
  let d = await lockedLook(page, 100, 40);
  check('default: pointer-lock look at the built-in speed', near(d.yaw, 0.23) && near(d.pitch, 0.092), JSON.stringify(d));
  await page.keyboard.press('Escape');
  await page.locator('.settings-panel input[type=range]').fill('2');
  check('the slider shows the value', (await page.textContent('.settings-slider b'))?.trim() === '2.00×');
  check('…and saves it', (await page.evaluate(`localStorage.getItem('ac.look')`)) === JSON.stringify({ sensitivity: 2, invertY: false }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  d = await lockedLook(page, 100, 40);
  check('at 2×, pointer-lock look turns twice as far, applied live', near(d.yaw, 0.46) && near(d.pitch, 0.184), JSON.stringify(d));
  // drag-to-look (a tablet open): 100 px across the view
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const a = await yawPitch(page);
  await page.mouse.move(300, 450);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(300 + i * 10, 450);
  await page.mouse.up();
  const b = await yawPitch(page);
  check('at 2×, drag-to-look turns twice as far too', near(a.yaw - b.yaw, 100 * 0.0042 * 2), `${(a.yaw - b.yaw).toFixed(4)} rad`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.check('.settings-panel input[type=checkbox] >> nth=0');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  d = await lockedLook(page, 0, 40);
  check('invert-Y: moving the mouse forward looks down', near(d.pitch, -0.184), JSON.stringify(d));
  await page.keyboard.press('Escape');
  check('settings can be open immediately before reload', (await panel(page)) === 'settings');
  // Emulate a snapshot written by the old version, which saved the settings overlay.
  await page.addInitScript(() => {
    const raw = sessionStorage.getItem('ac.refreshWorld');
    if (raw) { const saved = JSON.parse(raw); saved.player.panel = { kind: 'settings' }; sessionStorage.setItem('ac.refreshWorld', JSON.stringify(saved)); }
  });
  await page.reload();
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  check('reload does not restore even an old saved settings popup', (await panel(page)) === null);
  check('the setting survives a reload', JSON.stringify(await page.evaluate('__ac.store.get().look')) === JSON.stringify({ sensitivity: 2, invertY: true }));
  d = await lockedLook(page, 100, 0);
  check('…and the world uses it again', near(d.yaw, 0.46), JSON.stringify(d));
  if ((await panel(page)) !== null) await page.evaluate('__ac.store.set({ panel: null })');

  // ── 3) the browser releasing the pointer lock ──
  await page.evaluate('__lock(true)');
  check('(the fake pointer lock reaches the controller)', await page.evaluate('__acWorld.state() && document.pointerLockElement?.classList.contains("wl-input")') as boolean);
  await page.evaluate('__lock(false)');
  await page.waitForTimeout(100);
  check('the browser taking the pointer lock back (Esc kept from the page) opens the settings', (await panel(page)) === 'settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('…and that press’s own keydown, right after, does not close them again', (await panel(page)) === 'settings');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('a later Esc closes them', (await panel(page)) === null);
  await page.waitForTimeout(700);
  await page.evaluate('__lock(true)');
  await page.keyboard.press('Escape'); // keydown first (Keyboard Lock in full screen), then the release
  await page.evaluate('__lock(false)');
  await page.waitForTimeout(100);
  check('keydown then release in one press: the settings open and stay open', (await panel(page)) === 'settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.evaluate(`__ac.store.set({ panel: { kind: 'locker' } })`);
  await page.waitForTimeout(100);
  await page.evaluate('__lock(true)');
  await page.keyboard.press('Escape');
  await page.evaluate('__lock(false)');
  await page.waitForTimeout(100);
  check('with the locker open (mouse locked), one Esc closes it and opens nothing', (await panel(page)) === null);
  await page.waitForTimeout(700);
  await page.evaluate('__lock(true)');
  await page.keyboard.press('KeyV');
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(200);
  check('the world’s own release (V to the top-down camera) opens nothing', (await panel(page)) === null && (await page.evaluate('__ac.store.get().camera')) === 'top');
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(700);

  // ── 4) holding Esc to leave full screen ──
  await page.evaluate('window.__full = true; document.dispatchEvent(new Event("fullscreenchange"))');
  await page.keyboard.down('Escape');
  await page.waitForTimeout(100);
  check('holding Esc in full screen: its first keydown opens the settings', (await panel(page)) === 'settings');
  await page.evaluate('document.exitFullscreen()'); // the browser, after the long press
  await page.waitForTimeout(150);
  await page.keyboard.up('Escape');
  check('…and leaving full screen with that hold closes them again', (await panel(page)) === null);
  await page.evaluate('window.__full = true; document.dispatchEvent(new Event("fullscreenchange"))');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.evaluate('document.exitFullscreen()');
  await page.waitForTimeout(150);
  check('a short Esc, then leaving full screen another way, keeps them open', (await panel(page)) === 'settings');
  await page.keyboard.press('Escape');

  // When the browser allows startup capture, no second click is needed.
  const accepted = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  await accepted.addInitScript(FAKE);
  await accepted.addInitScript('window.__requireGesture = true');
  await accepted.goto(`${h.url}/?debug=1`);
  await accepted.getByText('Night Shift', { exact: true }).click();
  await accepted.locator('button.start').click();
  await accepted.waitForSelector('.wl-input');
  await accepted.waitForFunction('document.querySelector(".wl-input")?.classList.contains("mouse-look")', undefined, { timeout: 60000 });
  await accepted.waitForFunction('!!document.pointerLockElement', undefined, { timeout: 60000 });
  check('Start captures during the click, before fullscreen and world creation',
    await accepted.evaluate('window.__lockCalls.length === 1 && window.__lockCalls[0].active && !window.__lockCalls[0].fullscreen && !window.__lockCalls[0].world') as boolean);
  check('allowed startup capture enters look-around mode without another click',
    (await panel(accepted)) === null && await accepted.locator('.wl-input').evaluate(el => getComputedStyle(el).cursor === 'none'));
  await accepted.waitForFunction('document.querySelector(".wl-control-hint")?.textContent === "Tab to use the mouse and open the tablet · Esc: settings and controls"');
  const entryLook = await yawPitch(accepted);
  await accepted.evaluate(`document.dispatchEvent(new MouseEvent('mousemove', { movementX: 10000 }))`);
  check('Start-click capture supports continuous turning without a scene click', entryLook.yaw - (await yawPitch(accepted)).yaw > 6 * Math.PI);
  await accepted.evaluate('window.__requireGesture = false'); // later requests may occur while already fullscreen
  await accepted.keyboard.press('Escape');
  await accepted.waitForTimeout(700);
  await accepted.keyboard.press('Escape');
  await accepted.waitForTimeout(150);
  check('closing settings with Esc restores the previous captured look',
    (await panel(accepted)) === null && await accepted.evaluate('!!document.pointerLockElement') as boolean);
  await accepted.keyboard.press('Escape');
  await accepted.waitForSelector('.settings-panel');
  await accepted.locator('.settings-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await accepted.waitForTimeout(150);
  check('the Close button also restores captured look', await accepted.evaluate('!!document.pointerLockElement') as boolean);
  await accepted.keyboard.press('Tab');
  await accepted.waitForTimeout(150);
  check('opening the tablet frees the captured mouse', await accepted.evaluate('!document.pointerLockElement') as boolean);
  await accepted.keyboard.press('Escape');
  await accepted.waitForTimeout(150);
  check('closing the tablet restores captured look',
    (await panel(accepted)) === null && await accepted.evaluate('!!document.pointerLockElement') as boolean);
  await accepted.mouse.click(400, 450, { button: 'right' });
  await accepted.waitForTimeout(1200);
  const captures = await accepted.evaluate('window.__lockRequests');
  check('startup capture does not grab the cursor back after right-click',
    await accepted.evaluate('!document.pointerLockElement') as boolean);
  await accepted.keyboard.press('Escape');
  await accepted.waitForTimeout(150);
  await accepted.keyboard.press('Escape');
  await accepted.waitForTimeout(1200);
  check('closing settings restores the free cursor when opened in that mode',
    (await panel(accepted)) === null && await accepted.evaluate(`!document.pointerLockElement && window.__lockRequests === ${captures} && __acWorld.state().cursorMode`) as boolean);
  await accepted.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
} catch (e) {
  check('settings e2e ran to the end', false, (e as Error).stack ?? String(e));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

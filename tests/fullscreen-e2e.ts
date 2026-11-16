/**
 * Full screen on Start shift (client/src/ui/fullscreen.ts), in a headless GPU browser:
 *   1. the Start click asks for full screen on the page (navigationUI: 'hide') and locks Escape;
 *      a fake Fullscreen API records it (headless Chromium refuses real full screen)
 *   2. in full screen a short Esc frees the mouse and closes the open panel; key repeats (holding
 *      Esc to leave) don't close anything else
 *   3. after a reload in full screen, the first click in the game goes full screen again
 *   4. the menu setting turns it off; the real, refused request never breaks the page
 *   5. menu, loading screen and tablet at common screen sizes (screenshots + overflow checks)
 *
 *   npx tsx tests/fullscreen-e2e.ts [outDir]
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/fullscreen';
mkdirSync(out, { recursive: true });

/** a faithful stand-in for the Fullscreen, Keyboard Lock and Pointer Lock reads the game uses */
const FAKE = `(() => {
  const w = window;
  w.__fs = { requests: [], locks: [], exits: 0, plExits: 0, on: false, pl: false };
  const change = () => setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 0);
  Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get() { return w.__fs.on ? document.documentElement : null; } });
  Element.prototype.requestFullscreen = function (opts) {
    w.__fs.requests.push({ tag: this.tagName, navigationUI: opts && opts.navigationUI });
    w.__fs.on = true; change(); return Promise.resolve();
  };
  Document.prototype.exitFullscreen = function () { w.__fs.exits++; w.__fs.on = false; change(); return Promise.resolve(); };
  Object.defineProperty(Navigator.prototype, 'keyboard', { configurable: true, get() { return { lock: (codes) => { w.__fs.locks.push(codes); return Promise.resolve(); }, unlock() {} }; } });
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return w.__fs.pl ? document.body : null; } });
  Document.prototype.exitPointerLock = function () { w.__fs.plExits++; w.__fs.pl = false; };
})();`;

type Fs = { requests: { tag: string; navigationUI?: string }[]; locks: string[][]; exits: number; plExits: number; on: boolean; pl: boolean };
const fs = (page: Page) => page.evaluate('window.__fs') as Promise<Fs>;

const h = await startHarness({ portBase: 7960 });
const { check } = h;
try {
  // ── 1–3 with the fake API ──
  {
    const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(FAKE);
    await page.goto(`${h.url}/?debug=1`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    check('the menu offers the setting, on by default', await page.isChecked('label:has-text("Full screen when the shift starts") input'));
    await page.click('text=Night Shift');
    await page.click('button.start');
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    let f = await fs(page);
    check('Start shift asks for full screen once, on the whole page, without navigation UI', f.requests.length === 1 && f.requests[0].tag === 'HTML' && f.requests[0].navigationUI === 'hide', JSON.stringify(f.requests));
    check('…then locks Escape (Keyboard Lock), so holding Esc leaves full screen', f.locks.length === 1 && JSON.stringify(f.locks[0]) === '["Escape"]', JSON.stringify(f.locks));
    check('the tab remembers it is in full screen (for a reload)', (await page.evaluate(`sessionStorage.getItem('ac.fullscreen.on')`)) === '1');
    await page.waitForTimeout(6000); // world warm-up

    // 2) Esc in full screen: frees the mouse, closes the panel; repeats do nothing more
    await page.evaluate(`__ac.store.set({ panel: { kind: 'board' } }); window.__fs.pl = true;`);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    f = await fs(page);
    check('a short Esc frees the mouse (pointer lock) in full screen', f.plExits === 1 && !f.pl, `exitPointerLock calls: ${f.plExits}`);
    check('…and closes the open panel', (await page.evaluate('__ac.store.get().panel')) === null);
    await page.evaluate(`__ac.store.set({ panel: { kind: 'board' } })`);
    await page.waitForTimeout(200);
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true }))`);
    await page.waitForTimeout(200);
    check('holding Esc (key repeats) does not close panels one after another', (await page.evaluate('__ac.store.get().panel?.kind')) === 'board');
    await page.keyboard.press('Escape');

    // 3) reload (the 🖥 quality button reloads the page): the first click in the game re-enters full screen
    await page.reload();
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    await page.waitForTimeout(6000);
    check('after a reload nothing is requested without a click', (await fs(page)).requests.length === 0);
    await page.mouse.click(800, 450);
    await page.waitForTimeout(300);
    f = await fs(page);
    check('the first click after a reload in full screen goes full screen again', f.requests.length === 1, `${f.requests.length} requests`);
    await page.mouse.click(820, 460);
    check('…once', (await fs(page)).requests.length === 1);

    // leaving full screen on purpose: a later reload stays windowed
    await page.evaluate('document.exitFullscreen()');
    await page.waitForTimeout(200);
    check('leaving full screen on purpose is remembered', (await page.evaluate(`sessionStorage.getItem('ac.fullscreen.on')`)) === null);
    await page.reload();
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.mouse.click(800, 450);
    await page.waitForTimeout(300);
    check('…and a reload after that stays in the window', (await fs(page)).requests.length === 0);
    check('no page errors (fake API)', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ── 4) setting off; and the real API, which headless Chromium refuses ──
  {
    const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.addInitScript(FAKE);
    await page.goto(`${h.url}/?debug=1`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    await page.uncheck('label:has-text("Full screen when the shift starts") input');
    check('the setting is saved (localStorage)', (await page.evaluate(`localStorage.getItem('ac.fullscreen')`)) === 'false');
    await page.click('text=Night Shift');
    await page.click('button.start');
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    check('with the setting off, Start shift does not ask for full screen', (await fs(page)).requests.length === 0);
    await page.close();
  }
  {
    // the harness's own path: the real requestFullscreen (headless Chromium grants it on an http origin, refuses it on others)
    const { page, errors } = await h.nightShift('', 4000);
    const st = (await page.evaluate(`({ full: !!document.fullscreenElement, w: innerWidth, h: innerHeight })`)) as { full: boolean; w: number; h: number };
    check('the real full-screen request in headless never breaks the shift or the test viewport', errors.length === 0 && (await page.isVisible('.hud-clock')) && st.w === 1600 && st.h === 900, `${st.full ? 'granted' : 'refused'}, viewport ${st.w}×${st.h}${errors.length ? ` · ${errors.join(' | ')}` : ''}`);
    await page.close();
  }
  {
    // and when the browser refuses (as about:blank, iframes or policies do), nothing breaks either
    const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(`Element.prototype.requestFullscreen = function () { window.__refused = (window.__refused || 0) + 1; return Promise.reject(new TypeError('not granted')); };`);
    await page.goto(`${h.url}/?debug=1`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    await page.click('text=Night Shift');
    await page.click('button.start');
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    await page.waitForTimeout(2000);
    check('a refused full-screen request is ignored: the shift starts, no page errors', (await page.evaluate('window.__refused')) === 1 && errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ── 5) common screen sizes: menu, loading screen, tablet ──
  for (const [w, hgt] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]] as const) {
    const page = await h.browser.newPage({ viewport: { width: w, height: hgt } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${h.url}/?debug=1`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/menu-${w}x${hgt}.png` });
    const menu = (await page.evaluate(`(() => { const m = document.querySelector('.menu'); return { overflowX: m.scrollWidth > m.clientWidth + 1, startVisible: !!document.querySelector('button.start') }; })()`)) as { overflowX: boolean; startVisible: boolean };
    check(`${w}×${hgt}: the menu fits the width`, !menu.overflowX && menu.startVisible);
    await page.click('text=Night Shift');
    await page.click('button.start');
    await page.waitForSelector('.loading-screen', { timeout: 60000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/loading-${w}x${hgt}.png` });
    const ls = (await page.evaluate(`(() => { const r = document.querySelector('.loading-screen')?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null; })()`)) as { w: number; h: number } | null;
    check(`${w}×${hgt}: the loading screen covers the screen`, !!ls && Math.abs(ls.w - w) <= 1 && Math.abs(ls.h - hgt) <= 1, JSON.stringify(ls));
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const nurse = (await page.evaluate(`__ac.store.get().view.npcs.find((n) => n.role === 'nurse').id`)) as string;
    await page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: '${nurse}', tab: 'talk' }, tabletMin: false })`);
    await page.waitForSelector('.tablet', { timeout: 5000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/tablet-${w}x${hgt}.png` });
    const t = (await page.evaluate(`(() => { const r = document.querySelector('.tablet').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; })()`)) as { x: number; y: number; r: number; b: number };
    check(`${w}×${hgt}: the tablet is fully on screen`, t.x >= 0 && t.y >= 0 && t.r <= w + 0.5 && t.b <= hgt + 0.5, JSON.stringify(t));
    const hint = (await page.evaluate(`(() => { const e = document.querySelector('.wl-hint'); if (!e || !e.textContent || getComputedStyle(e).opacity === '0') return null; const r = e.getBoundingClientRect(); return { x: r.x, r: r.right }; })()`)) as { x: number; r: number } | null;
    if (hint) check(`${w}×${hgt}: the walk hint stays clear of the tablet`, hint.x >= 0 && hint.r <= t.x + 0.5, JSON.stringify({ hint, tabletLeft: t.x }));
    check(`${w}×${hgt}: no page errors`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
} catch (e) {
  check('fullscreen e2e ran to the end', false, (e as Error).stack ?? String(e));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

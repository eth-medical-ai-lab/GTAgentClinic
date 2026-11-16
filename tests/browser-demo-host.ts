import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { preview } from 'vite';
import type { ChatLine } from '../shared/types';
import { demoReply, recordedParts } from '../client/src/demo/dialogue';

/** a recorded speaker's reply to a question after `before` (dialogue.ts), and the clips it plays: '/audio/<folder>/<hash>.mp3' */
export function demoAnswer(id: string, question: string, before: string[] = []) {
  const lines: ChatLine[] = before.map((text, i) => ({ id: String(i), t: 0, speaker: i % 2 ? 'npc' : 'player', name: '', text }));
  const text = demoReply(id, question, [...lines, { id: 'q', t: 0, speaker: 'player', name: '', text: question }]);
  const parts = recordedParts(id, text);
  if (!parts) throw new Error(`no recordings for ${id}'s reply to "${question}"`);
  return { text, clips: parts.map(p => p.url.slice('/res'.length)) };
}

/** every clip played the given number of times (the page's __demoRecordings: paths fetched and started) */
export async function clipsPlayed(page: Page, clips: string[], times?: number) {
  for (const clip of clips) {
    const count = `globalThis.__demoRecordings.filter(path => path.endsWith(${JSON.stringify(clip)})).length`;
    await page.waitForFunction(`${count} > 0`);
    if (times !== undefined && await page.evaluate(count) !== times) throw new Error(`${clip} played ${await page.evaluate(count)} times, not ${times}`);
  }
}

/** Serve the actual release build as static files under a project Pages path. */
export async function startDemoHost() {
  execFileSync('npm', ['run', 'build:demo'], { stdio: 'inherit' });
  const base = '/example-project/demo/';
  const host = await preview({
    configFile: false, appType: 'mpa', base,
    build: { outDir: path.resolve('dist/demo') },
    preview: { host: '127.0.0.1', port: 0 },
  });
  try {
    const addr = host.httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Missing static demo host port');
    const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
    return {
      url: `http://127.0.0.1:${addr.port}${base}`, browser,
      async close() {
        try { await browser.close(); } finally { await host.close(); }
      },
    };
  } catch (err) {
    await host.close();
    throw err;
  }
}

export async function checkStaticRequests(page: Page, url: string, errors: string[]) {
  await page.route('**/*', async route => {
    const req = route.request();
    if (/^https?:/.test(req.url()) && (!req.url().startsWith(url) || !['GET', 'HEAD'].includes(req.method()))) {
      errors.push(`Outside static demo: ${req.method()} ${req.url()}`);
      return route.abort();
    }
    await route.continue();
  });
  await page.routeWebSocket(/.*/, ws => {
    errors.push('Unexpected WebSocket: ' + ws.url());
    ws.close();
  });
  page.on('response', res => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`); });
}

/** Record what reaches Web Speech. Desktop supplies a fixed voice catalog to test casting on every OS. */
export async function watchDemoSpeech(page: Page, fixedVoices = false) {
  await page.addInitScript((useCatalog) => {
    const lines: { text: string; voice?: string }[] = [];
    Object.defineProperty(window, '__demoSpoken', { value: lines });
    const recordings = new WeakMap<ArrayBuffer, string>();
    const decoded = new WeakMap<AudioBuffer, string>();
    const played: string[] = [];
    Object.defineProperty(window, '__demoRecordings', { value: played });
    const bytes = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const data = await bytes.call(this);
      if (/\/audio\/(?:marcus|keller|becker)\//.test(this.url)) recordings.set(data, new URL(this.url).pathname);
      return data;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (...args) {
      const path = recordings.get(args[0]);
      const audio = await decode.apply(this, args);
      if (path) decoded.set(audio, path);
      return audio;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      const path = this.buffer && decoded.get(this.buffer);
      if (path) played.push(path);
    };
    const synth = window.speechSynthesis;
    const speak = synth.speak.bind(synth);
    if (useCatalog) {
      synth.getVoices = () => ['Samantha'].map(name => ({ name, voiceURI: name, lang: 'en-US', localService: true, default: name === 'Samantha' }));
      // The native setter accepts only voices owned by the OS. Record the fixture voice selected by the client.
      const chosen = new WeakMap<SpeechSynthesisUtterance, SpeechSynthesisVoice>();
      Object.defineProperty(SpeechSynthesisUtterance.prototype, 'voice', {
        get() { return chosen.get(this) ?? null; }, set(voice) { chosen.set(this, voice); },
      });
    }
    synth.speak = utterance => {
      if (utterance.volume > 0) lines.push({ text: utterance.text, voice: utterance.voice?.name });
      if (!useCatalog && synth.getVoices().length) speak(utterance);
      else {
        utterance.dispatchEvent(new Event('start'));
        // Leave enough time for the tablet to draw partial words, as a real engine does.
        setTimeout(() => utterance.dispatchEvent(new Event('end')), 1200);
      }
    };
  }, fixedVoices);
}

export async function checkTourDefaults(page: Page) {
  await page.waitForFunction(`globalThis.__acWorld?.body().mode === 'third' &&
    __ac.store.get().view?.settings.tts === true`, undefined, { timeout: 120000 });
}

export async function checkDemoTouch(browser: Browser, url: string, outDir: string, errors: string[]) {
  const page = await browser.newPage({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    page.on('pageerror', err => errors.push(err.message));
    await checkStaticRequests(page, url, errors);
    await watchDemoSpeech(page);
    await page.goto(url + '?debug=1&quality=low');
    const start = page.getByRole('button', { name: 'Enter the ED' });
    await start.waitFor();
    await page.screenshot({ path: path.join(outDir, 'menu-mobile.png') });
    await start.tap();
    await checkTourDefaults(page);
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 120000 });
    await page.screenshot({ path: path.join(outDir, 'entry-mobile.png') });
    if (await page.getByRole('button', { name: 'Settings', exact: true }).count())
      throw new Error('Desktop Settings is visible in the touch demo');
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.locator('.hud-right').evaluate(row => {
        const buttons = [...row.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.getBoundingClientRect());
        const clock = document.querySelector('.hud-clock')!.getBoundingClientRect();
        const fits = buttons.length > 0 && buttons.every(b => b.left >= 0 && b.right <= innerWidth && Math.abs(b.top - buttons[0].top) < 2) && buttons[0].left >= clock.right;
        return { fits, width: innerWidth, clock: clock.toJSON(), buttons: buttons.map(b => b.toJSON()) };
      });
      await page.screenshot({ path: path.join(outDir, `layout-mobile-${width}.png`) });
      if (!layout.fits) throw new Error(`Mobile icon row wraps, overlaps the clock or overflows at ${width}px: ${JSON.stringify(layout)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.touchscreen.tap(110, 435);
    await page.touchscreen.tap(110, 435);
    // Some touch browsers also emit a compatibility dblclick after the double-tap.
    await page.locator('.wl-input').dispatchEvent('dblclick', { button: 0, clientX: 110, clientY: 435 });
    if (await page.evaluate('__acWorld.state().cursorMode || !!document.pointerLockElement'))
      throw new Error('Touch double-tap enabled cursor mode or pointer lock');
    // A tap can validly open a nearby person's tablet. Close it before testing scene dragging.
    if (await page.evaluate('__ac.store.get().panel !== null')) {
      await page.keyboard.press('Escape');
      await page.locator('.tablet').waitFor({ state: 'hidden' });
    }

    const yaw = await page.evaluate('__acWorld.state().yaw') as number;
    const touch = await page.context().newCDPSession(page);
    try {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 110, y: 435 }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 435 }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await touch.detach(); }
    await page.waitForFunction(`Math.abs(__acWorld.state().yaw - ${yaw}) > 0.02`);
    await page.getByRole('button', { name: /Third-person/i }).tap();
    await page.locator('.wl-input.top-mode').waitFor();

    // The camera follows the player at screen centre. Tap an open patch west of them.
    const pos = await page.evaluate('__acWorld.state()') as { x: number; z: number };
    await page.touchscreen.tap(158, 422);
    await page.waitForFunction(`Math.hypot(__acWorld.state().x - ${pos.x}, __acWorld.state().z - ${pos.z}) > 0.55`);
    await page.waitForFunction('!__acWorld.state().moving');
    await page.screenshot({ path: path.join(outDir, 'walking-mobile.png') });
    const marcus = page.locator('.wl-tag').filter({ hasText: 'Marcus Hill' });
    const tag = await marcus.boundingBox();
    if (!tag) throw new Error('The ED tech is missing from the touch tour');
    await page.touchscreen.tap(tag.x + tag.width / 2, tag.y + tag.height + 9);
    await page.getByRole('button', { name: 'Where should I start?' }).tap();
    await page.locator('.tablet .bubble.npc').filter({ hasText: /nurses' station/ }).waitFor();
    await checkMarcusRecording(page);
    await page.screenshot({ path: path.join(outDir, 'chat-mobile.png') });
  } catch (err) {
    const state = await page.evaluate(`({ coarse: matchMedia('(pointer: coarse)').matches, touches: navigator.maxTouchPoints,
      screen: globalThis.__ac?.store.get().screen, camera: globalThis.__ac?.store.get().camera,
      input: document.querySelector('.wl-input')?.className, focus: globalThis.__acWorld?.focus(), panel: globalThis.__ac?.store.get().panel })`);
    await page.screenshot({ path: path.join(outDir, 'touch-failure.png') });
    throw new Error((err as Error).message + '\n' + JSON.stringify(state));
  } finally { await page.close(); }
}

export async function checkMarcusRecording(page: Page) {
  await clipsPlayed(page, demoAnswer('tech_marcus', 'Where should I start?').clips);
  if (await page.evaluate("globalThis.__demoSpoken.some(line => /nurses' station/i.test(line.text))"))
    throw new Error('Web Speech also read the recorded Marcus reply');
}

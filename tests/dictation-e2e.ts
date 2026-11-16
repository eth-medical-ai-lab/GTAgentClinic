/** Real chat UI with a controlled recognition engine; no microphone or speech service required. */
import { mkdirSync } from 'node:fs';
import { startHarness } from './harness';

const out = 'shots/dictation';
mkdirSync(out, { recursive: true });
const h = await startHarness({ portBase: 7540 });
const { check } = h;
try {
  const page = await h.browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(`
    window.__sent = [];
    window.SpeechRecognition = class {
      constructor() { window.__rec = this; }
      start() { if (window.__failStart) throw new Error('busy'); }
      stop() {}
      abort() { this.onend?.(); }
      result(text, final = false) {
        this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
      }
    };
  `);
  await page.goto(`${h.url}/?mock=1&debug=1&panel=npc:rn_aisha`);
  await page.waitForSelector('.chat-input textarea', { timeout: 60000 });
  await page.evaluate(`
    __ac.client.act = action => { if (action.type === 'talk') window.__sent.push(action.text); };
    // Speech tests hold the conversation in earshot; moving mock staff must not disable Send.
    const set = __ac.store.set;
    __ac.store.set = patch => {
      const p = typeof patch === 'function' ? patch(__ac.store.get()) : patch;
      set({ ...p, distances: { ...__ac.store.get().distances, ...p.distances, rn_aisha: 0 } });
    };
    __ac.store.set({});
  `);
  const input = page.locator('.chat-input textarea');
  const sent = () => page.evaluate('window.__sent') as Promise<string[]>;
  const start = async () => {
    await page.keyboard.down('Backquote');
    await page.waitForTimeout(50);
  };
  const release = () => page.keyboard.up('Backquote');
  const heard = (text: string, final = false) => page.evaluate(({ text, final }) => (window as any).__rec.result(text, final), { text, final });
  const end = () => page.evaluate('window.__rec.onend()');

  await input.fill('  Typed draft  ');
  await start(); await release(); await end();
  check('silent dictation preserves the exact typed draft without sending', await input.inputValue() === '  Typed draft  ' && (await sent()).length === 0);

  await input.fill('');
  await start(); await heard('When did pain star'); await release();
  await page.waitForTimeout(1200);
  check('release waits beyond 350 ms without sending interim words', (await sent()).length === 0);
  await heard('When did pain start?', true); await end();
  check('a delayed completed transcript sends once', JSON.stringify(await sent()) === JSON.stringify(['When did pain start?']));

  await input.fill('Review');
  await start(); await heard('this partial phrase'); await release();
  await page.waitForTimeout(5200);
  check('timeout retains the transcript and requires manual Send', await input.inputValue() === 'Review this partial phrase' && (await sent()).length === 1 && await page.getByRole('status').innerText() === 'Recognition timed out. Review the text, then press Send.');
  await page.screenshot({ path: `${out}/timeout.png` });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  check('manual Send submits the reviewed timeout draft', (await sent()).at(-1) === 'Review this partial phrase');

  await start(); await heard('Keep these words');
  await page.evaluate("window.__rec.onerror({ error: 'network' })"); await release();
  check('recognition errors retain words without sending', await input.inputValue() === 'Keep these words' && (await sent()).length === 2);

  await page.evaluate('window.__failStart = true');
  await start(); await release();
  await page.evaluate('window.__failStart = false');
  await start(); await heard(' after retry'); await release(); await end();
  check('a synchronous start failure permits a later recording', (await sent()).at(-1) === 'Keep these words after retry');

  await input.fill('');
  await start(); await heard('Cancelled words');
  await page.evaluate('__ac.store.set({ panel: null })'); await release(); await end();
  check('closing the chat cancels recognition without sending', (await sent()).length === 3);
  check('no browser errors', errors.length === 0, errors.join(' | '));
} finally {
  await h.close();
}
process.exit(h.failed() ? 1 : 0);

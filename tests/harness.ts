/**
 * Shared setup for the browser checks: a private game server on a random port (never the
 * player's 5317), a real-GPU headless Chromium, a check() logger, and a Night Shift start.
 * Everything started here is stopped by close(), so no process is left running.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

export interface Harness {
  port: number;
  url: string;
  browser: Browser;
  /** the server process this harness started (tsx; the game server is its child) */
  pid: number;
  /** the server's output so far */
  log(): string;
  check(name: string, ok: boolean, detail?: string): void;
  /** number of failed checks so far */
  failed(): number;
  /** a page with a Night Shift started (debug hooks on), after the renderer and avatars warm up */
  nightShift(query?: string, warmMs?: number): Promise<{ page: Page; errors: string[] }>;
  close(): Promise<void>;
}

/**
 * llm: the NPC brain (default offline, deterministic and free). 'claude-code' runs NPCs on the
 * developer's own Claude Code login: only for an explicit smoke test (tests/claude-code-e2e.ts).
 */
export async function startHarness(opts: { portBase: number; env?: NodeJS.ProcessEnv; dev?: boolean; llm?: 'offline' | 'claude-code' | 'api' | 'auto' }): Promise<Harness> {
  const port = opts.portBase + Math.floor(Math.random() * 40);
  // (fileURLToPath, not .pathname: on Windows that is "/C:/…", which Node resolves to "C:\C:\…")
  const args = [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), 'server/index.ts', '--port', String(port), '--llm', opts.llm ?? 'offline', '--tts', 'off'];
  if (opts.dev !== false) args.push('--dev');
  // node directly (not npx), so kill() reaches the server itself
  const server: ChildProcess = spawn(process.execPath, args, { env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
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
  // "chromium" channel = new headless mode on the real GPU (Metal on macOS), WebGPU on localhost
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  let failed = 0;
  const url = `http://127.0.0.1:${port}`;
  return {
    port,
    url,
    browser,
    pid: server.pid ?? 0,
    log: () => log,
    check(name, ok, detail = '') {
      if (!ok) failed++;
      console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
    },
    failed: () => failed,
    async nightShift(query = '', warmMs = 7000) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
      await page.goto(`${url}/?debug=1${query ? `&${query}` : ''}`);
      await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
      await page.click('text=Night Shift');
      await page.click('button.start');
      await page.waitForSelector('.hud-clock', { timeout: 60000 });
      await page.waitForTimeout(warmMs);
      return { page, errors };
    },
    async close() {
      await browser.close().catch(() => undefined);
      server.kill();
    },
  };
}

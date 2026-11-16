/**
 * --exit-when-idle: stop the server once no game tab has been connected, and no agent has called
 * the API, for a while (2 minutes by default; `--exit-when-idle=5m` for another time). The Mac
 * launcher uses it, so nothing keeps running in the background after you stop playing. Off unless
 * the flag is given.
 */

export const DEFAULT_IDLE_MS = 2 * 60 * 1000;

/** "--exit-when-idle" → 2 min; "--exit-when-idle=90s" | "=5m" | "=120" (seconds) → that; absent, "=0" or "=off" → null */
export function idleExitMs(argv: string[]): number | null {
  const a = argv.find((x) => x === '--exit-when-idle' || x.startsWith('--exit-when-idle='));
  if (!a) return null;
  if (a === '--exit-when-idle') return DEFAULT_IDLE_MS;
  const v = a.slice(a.indexOf('=') + 1).trim().toLowerCase();
  if (v === '' || v === 'on' || v === 'true') return DEFAULT_IDLE_MS;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|min|h)?$/.exec(v);
  if (!m) return v === 'off' || v === 'false' ? null : DEFAULT_IDLE_MS;
  const n = Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 }[m[2] ?? 's'] ?? 1000);
  return n > 0 ? Math.max(1000, Math.round(n)) : null;
}

export function fmtIdle(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`;
}

/** Counts open game tabs (WebSocket connections) and API activity; calls onIdle once when idle for idleMs. */
export class IdleExit {
  private open = 0;
  private last: number;
  private timer?: ReturnType<typeof setInterval>;
  private fired = false;
  private readonly now: () => number;

  constructor(private readonly o: { idleMs: number; onIdle: () => void; now?: () => number; checkEveryMs?: number }) {
    this.now = o.now ?? Date.now;
    this.last = this.now();
  }

  connected() {
    this.open++;
    this.last = this.now();
  }

  disconnected() {
    this.open = Math.max(0, this.open - 1);
    this.last = this.now();
  }

  /** an API request (an agent playing over REST/MCP keeps the server up) */
  activity() {
    this.last = this.now();
  }

  /** idle for so long, or 0 while a tab is open */
  idleFor(): number {
    return this.open > 0 ? 0 : this.now() - this.last;
  }

  check(): boolean {
    if (this.fired || this.idleFor() < this.o.idleMs) return false;
    this.fired = true;
    this.stop();
    this.o.onIdle();
    return true;
  }

  start(): this {
    this.timer ??= setInterval(() => this.check(), this.o.checkEveryMs ?? Math.min(5000, Math.max(250, this.o.idleMs / 4)));
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

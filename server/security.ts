/**
 * Request guard against cross-site abuse and DNS rebinding (see SECURITY.md).
 *
 * The server holds no secret itself, but it makes NPCs talk on the player's Claude login (or an
 * API key). Without a guard, any webpage the player visits could drive it: a text/plain POST to
 * http://127.0.0.1:5317/api/sessions needs no CORS preflight, WebSockets ignore CORS entirely,
 * and DNS rebinding can point evil.example at 127.0.0.1. The rules:
 *
 *  1. Host (every request and every upgrade) must be localhost / 127.0.0.1 / [::1], the bound
 *     --host, any IP literal when bound to all interfaces (LAN play; an IP literal cannot be
 *     DNS-rebound), or an --allow-host name.
 *  2. Origin (the API, WebSockets, any non-GET/HEAD request): absent → allowed (curl, Node agents,
 *     MCP) unless Sec-Fetch-Site marks a cross-site browser request; present → it must be this
 *     server's own origin (same host:port as Host) or an --allow-origin entry (CORS echoes it).
 *
 * The decisions are pure functions (unit-tested in tests/security.test.ts); createGuard() wires
 * them to node:http objects for server/index.ts.
 */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';

export interface AccessOptions {
  /** address the server listens on (--host / HOST) */
  bindHost: string;
  /** extra names accepted in Host/Origin (--allow-host, AGENTCLINIC_ALLOWED_HOSTS); ".example.com" also matches subdomains */
  allowHosts?: string[];
  /** other pages allowed to call the API cross-origin (--allow-origin, AGENTCLINIC_ALLOWED_ORIGINS), e.g. http://localhost:3000 */
  allowOrigins?: string[];
}

export interface AccessPolicy {
  /** exact host names: lowercase, IPv6 without brackets */
  hosts: Set<string>;
  /** ".example.com" entries: that domain and its subdomains */
  suffixes: string[];
  /** bound to all interfaces → accept any IP literal */
  anyIp: boolean;
  /** normalized origins (scheme://host[:port]) allowed cross-origin, with CORS */
  origins: Set<string>;
  /** the configured names, in Vite's `server.allowedHosts` syntax (for --dev) */
  extraHosts: string[];
}

export interface RequestFacts {
  host?: string;
  origin?: string;
  secFetchSite?: string;
}

export type Denied = { ok: false; reason: 'host' | 'origin' | 'fetch-site'; message: string; key: string };
export type Verdict = { ok: true; corsOrigin?: string } | Denied;

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
const ALL_INTERFACES = new Set(['', '0.0.0.0', '::']);
const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443' };

/** "a, b c" + "d" → ['a', 'b', 'c', 'd']: flags and env vars take comma/space-separated lists */
export function splitList(...values: (string | undefined)[]): string[] {
  return values.flatMap((v) => (v ?? '').split(/[\s,]+/)).filter(Boolean);
}

/** every value of a repeatable flag, in both `--name value` and `--name=value` form */
export function flagValues(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === name && i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]);
    else if (a.startsWith(name + '=')) out.push(a.slice(name.length + 1));
  });
  return out;
}

/** Host header → { hostname, port }, or null if malformed. Lowercases; strips IPv6 brackets and a trailing dot. */
export function parseHost(value: string | undefined): { hostname: string; port: string } | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  let hostname: string;
  let port = '';
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end < 0) return null;
    hostname = v.slice(1, end);
    const rest = v.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    port = rest.slice(1);
    if (isIP(hostname) !== 6) return null;
  } else {
    const m = /^([a-z0-9_.-]+)(?::(\d{1,5}))?$/.exec(v);
    if (!m) return null;
    hostname = m[1].replace(/\.$/, '');
    port = m[2] ?? '';
  }
  if (!hostname || (port && Number(port) > 65535)) return null;
  return { hostname, port };
}

/** "http://localhost:3000/" → "http://localhost:3000"; null for opaque ("null"), non-http(s) or malformed origins */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export function createAccessPolicy(opts: AccessOptions): AccessPolicy {
  const hosts = new Set(LOOPBACK);
  const suffixes: string[] = [];
  const extraHosts: string[] = [];
  const bind = opts.bindHost.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const anyIp = ALL_INTERFACES.has(bind);
  if (!anyIp) {
    hosts.add(bind);
    extraHosts.push(bind);
  }
  for (const raw of opts.allowHosts ?? []) {
    const entry = raw.trim().toLowerCase();
    if (/^\.[a-z0-9_.-]+$/.test(entry)) {
      suffixes.push(entry.replace(/\.$/, ''));
      extraHosts.push(entry.replace(/\.$/, ''));
      continue;
    }
    const h = parseHost(entry);
    if (!h) throw new Error(`Invalid --allow-host "${raw}" (expected a host name such as mymac.local, or .example.com for a whole domain)`);
    hosts.add(h.hostname);
    extraHosts.push(h.hostname);
  }
  const origins = new Set<string>();
  for (const raw of opts.allowOrigins ?? []) {
    const o = normalizeOrigin(raw);
    if (!o) throw new Error(`Invalid --allow-origin "${raw}" (expected an origin such as http://localhost:3000)`);
    origins.add(o);
  }
  return { hosts, suffixes, anyIp, origins, extraHosts };
}

export function hostAllowed(policy: AccessPolicy, hostname: string): boolean {
  if (policy.hosts.has(hostname)) return true;
  if (policy.anyIp && isIP(hostname)) return true;
  return policy.suffixes.some((s) => hostname === s.slice(1) || hostname.endsWith(s));
}

const clip = (s: string) => (s.length > 120 ? s.slice(0, 120) + '…' : s);

function deny(reason: Denied['reason'], subject: string, message: string): Denied {
  return { ok: false, reason, message, key: `${reason}|${clip(subject)}` };
}

/**
 * The whole decision. `origin: false` skips the Origin rules (plain page/asset GETs, so links
 * from other sites, such as "challenge a friend", still open the game); Host is always checked.
 */
export function checkAccess(policy: AccessPolicy, facts: RequestFacts, opts: { origin: boolean } = { origin: true }): Verdict {
  // 1) Host: DNS-rebinding protection. Browsers always send Host; only HTTP/1.0 tools omit it.
  let host: { hostname: string; port: string } | null = null;
  if (facts.host !== undefined) {
    host = parseHost(facts.host);
    if (!host) return deny('host', facts.host, `Forbidden: malformed Host header "${clip(facts.host)}".`);
    if (!hostAllowed(policy, host.hostname)) {
      return deny('host', facts.host, `Forbidden: Host "${clip(facts.host)}" is not allowed (DNS-rebinding protection). If you open AgentClinic under this name, restart the server with --allow-host ${host.hostname}.`);
    }
  }
  if (!opts.origin) return { ok: true };

  // 2) Origin: cross-site protection
  if (facts.origin === undefined) {
    // no Origin: curl / Node agents / MCP, or a same-origin GET. Browsers mark cross-site loads (<img>, <audio>, links).
    const site = facts.secFetchSite?.toLowerCase();
    if (site === 'cross-site' || site === 'same-site') return deny('fetch-site', site, `Forbidden: cross-site browser request (Sec-Fetch-Site: ${site}). Only the game's own page may use this server from a browser.`);
    return { ok: true };
  }
  const origin = normalizeOrigin(facts.origin);
  if (origin && policy.origins.has(origin)) return { ok: true, corsOrigin: origin };
  if (origin && host) {
    const scheme = new URL(origin).protocol;
    const o = parseHost(new URL(origin).host);
    if (o && o.hostname === host.hostname && (o.port || DEFAULT_PORT[scheme]) === (host.port || DEFAULT_PORT[scheme]) && hostAllowed(policy, o.hostname)) return { ok: true };
  }
  return deny(
    'origin',
    facts.origin,
    `Forbidden: cross-origin request from ${clip(facts.origin)}. Only the game's own page and non-browser clients (agents, MCP, curl) may use this server` +
      (origin ? `; to allow that page, restart the server with --allow-origin ${origin}.` : '.'),
  );
}

/** the API (same test as api() in server/index.ts) and anything that is not a plain GET/HEAD must pass the Origin rules */
export function needsOriginCheck(method: string | undefined, pathname: string): boolean {
  return pathname.split('/').filter(Boolean)[0] === 'api' || !(method === 'GET' || method === 'HEAD');
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function requestFacts(h: IncomingHttpHeaders): RequestFacts {
  return { host: first(h.host), origin: first(h.origin), secFetchSite: first(h['sec-fetch-site']) };
}

/** logs each distinct rejection once (a hostile page may retry forever); stops tracking after `max` distinct ones */
export function createRejectionLog(write: (line: string) => void = (line) => console.warn(line), max = 50) {
  const seen = new Set<string>();
  return (v: Denied, where: string) => {
    if (seen.has(v.key)) return;
    if (seen.size >= max) {
      if (!seen.has('*')) write('[security] many different blocked requests; not logging new ones');
      seen.add('*');
      return;
    }
    seen.add(v.key);
    write(`[security] blocked ${clip(where)}: ${v.message} (logged once)`);
  };
}

/** answer a refused WebSocket upgrade with a plain 403 and close the socket */
export function rejectUpgrade(socket: Duplex, message: string) {
  const body = message + '\n';
  socket.on('error', () => {});
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

const pathOf = (url: string | undefined) => (url ?? '/').split('?')[0];

/** the guard used by server/index.ts: call request() before routing and upgrade() before any WebSocket handling */
export function createGuard(opts: AccessOptions, log = createRejectionLog()) {
  const policy = createAccessPolicy(opts);
  return {
    policy,
    /** true → carry on; false → a 403 has been sent. Adds CORS headers for --allow-origin pages. */
    request(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
      const v = checkAccess(policy, requestFacts(req.headers), { origin: needsOriginCheck(req.method, pathname) });
      if (!v.ok) {
        log(v, `${req.method} ${pathname}`);
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: v.message }));
        return false;
      }
      if (v.corsOrigin) {
        res.setHeader('access-control-allow-origin', v.corsOrigin);
        res.setHeader('vary', 'Origin');
      }
      return true;
    },
    /** true → carry on; false → a 403 has been written and the socket closed */
    upgrade(req: IncomingMessage, socket: Duplex): boolean {
      const v = checkAccess(policy, requestFacts(req.headers));
      if (v.ok) return true;
      log(v, `WebSocket ${pathOf(req.url)}`);
      rejectUpgrade(socket, v.message);
      return false;
    },
  };
}

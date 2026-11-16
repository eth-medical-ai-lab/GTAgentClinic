import type { ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { checkAccess, createAccessPolicy, createGuard, createRejectionLog, flagValues, needsOriginCheck, parseHost, splitList, type Denied } from '../server/security';

const local = createAccessPolicy({ bindHost: '127.0.0.1' });
const lan = createAccessPolicy({ bindHost: '0.0.0.0', allowHosts: ['mymac.local', '.lab.example'] });

describe('parseHost', () => {
  it('parses names, IPv4, bracketed IPv6 and ports', () => {
    expect(parseHost('localhost:5317')).toEqual({ hostname: 'localhost', port: '5317' });
    expect(parseHost('127.0.0.1')).toEqual({ hostname: '127.0.0.1', port: '' });
    expect(parseHost('[::1]:5317')).toEqual({ hostname: '::1', port: '5317' });
    expect(parseHost('LocalHost.:80')).toEqual({ hostname: 'localhost', port: '80' });
  });
  it('returns null for malformed values instead of throwing', () => {
    for (const bad of [undefined, '', 'a b', '::1', '[::1', '[nope]:1', 'host:', 'host:99999', 'evil.example/x', 'user@host']) expect(parseHost(bad)).toBeNull();
  });
});

describe('Host header (DNS rebinding)', () => {
  it('accepts loopback names by default', () => {
    for (const host of ['localhost:5317', '127.0.0.1:5317', '[::1]:5317', 'localhost']) expect(checkAccess(local, { host }).ok).toBe(true);
  });
  it('rejects a rebinding domain even when Origin matches it', () => {
    const v = checkAccess(local, { host: 'evil.example:5397', origin: 'http://evil.example:5397' });
    expect(v).toMatchObject({ ok: false, reason: 'host' });
    expect((v as Denied).message).toContain('--allow-host evil.example');
  });
  it('is checked even for plain page loads (origin rules skipped)', () => {
    expect(checkAccess(local, { host: 'evil.example:5317' }, { origin: false }).ok).toBe(false);
    expect(checkAccess(local, { host: 'localhost:5317', origin: 'https://evil.example' }, { origin: false }).ok).toBe(true);
  });
  it('rejects malformed Host values; a missing Host (HTTP/1.0 tools, never browsers) passes', () => {
    expect(checkAccess(local, { host: 'a b' })).toMatchObject({ ok: false, reason: 'host' });
    expect(checkAccess(local, {}).ok).toBe(true);
  });
  it('loopback bind: LAN addresses are not accepted', () => {
    expect(checkAccess(local, { host: '192.168.1.23:5317' }).ok).toBe(false);
  });
  it('all-interfaces bind (LAN play): any IP literal and --allow-host names, still no other names', () => {
    for (const host of ['192.168.1.23:5317', '[fe80::1]:5317', '0.0.0.0:5317', 'localhost:5317', 'mymac.local:5317', 'lab.example', 'pc7.lab.example:5317']) expect(checkAccess(lan, { host }).ok).toBe(true);
    for (const host of ['evil.example:5317', 'badlab.example', 'mymac.local.evil.example']) expect(checkAccess(lan, { host }).ok).toBe(false);
  });
  it('accepts the bound host name', () => {
    const p = createAccessPolicy({ bindHost: 'devbox.lan' });
    expect(checkAccess(p, { host: 'devbox.lan:5317', origin: 'http://devbox.lan:5317' }).ok).toBe(true);
    expect(p.extraHosts).toEqual(['devbox.lan']);
  });
});

describe('Origin header (cross-site requests)', () => {
  it('allows requests without Origin: curl, Node agents, MCP', () => {
    expect(checkAccess(local, { host: '127.0.0.1:5317' })).toEqual({ ok: true });
  });
  it("allows the game's own page", () => {
    expect(checkAccess(local, { host: '127.0.0.1:5317', origin: 'http://127.0.0.1:5317' })).toEqual({ ok: true });
    expect(checkAccess(local, { host: 'localhost:5317', origin: 'http://localhost:5317' })).toEqual({ ok: true });
    expect(checkAccess(local, { host: '[::1]:5317', origin: 'http://[::1]:5317' })).toEqual({ ok: true });
    expect(checkAccess(local, { host: 'localhost:80', origin: 'http://localhost' })).toEqual({ ok: true }); // default port
  });
  it('rejects other sites, other local ports, opaque and malformed origins', () => {
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'http://localhost:5317.evil.example', 'null', 'file:///tmp/x.html', 'chrome-extension://abc', 'not a url', 'http://localhost:5317, https://evil.example'])
      expect(checkAccess(local, { host: 'localhost:5317', origin })).toMatchObject({ ok: false, reason: 'origin' });
    // same machine, different name: still a different origin
    expect(checkAccess(local, { host: '127.0.0.1:5317', origin: 'http://localhost:5317' }).ok).toBe(false);
  });
  it('--allow-origin admits a listed page and returns the origin for CORS', () => {
    const p = createAccessPolicy({ bindHost: '127.0.0.1', allowOrigins: ['http://localhost:3000/'] });
    expect(checkAccess(p, { host: '127.0.0.1:5317', origin: 'http://localhost:3000' })).toEqual({ ok: true, corsOrigin: 'http://localhost:3000' });
    expect(checkAccess(p, { host: '127.0.0.1:5317', origin: 'http://localhost:3001' }).ok).toBe(false);
    expect(checkAccess(p, { host: 'evil.example', origin: 'http://localhost:3000' }).ok).toBe(false); // Host still applies
  });
  it('without Origin, Sec-Fetch-Site still stops cross-site browser loads (<img>, <audio>, links)', () => {
    expect(checkAccess(local, { host: 'localhost:5317', secFetchSite: 'cross-site' })).toMatchObject({ ok: false, reason: 'fetch-site' });
    expect(checkAccess(local, { host: 'localhost:5317', secFetchSite: 'same-site' }).ok).toBe(false);
    expect(checkAccess(local, { host: 'localhost:5317', secFetchSite: 'same-origin' }).ok).toBe(true);
    expect(checkAccess(local, { host: 'localhost:5317', secFetchSite: 'none' }).ok).toBe(true);
  });
  it('bad --allow-host / --allow-origin values fail at startup', () => {
    expect(() => createAccessPolicy({ bindHost: '127.0.0.1', allowOrigins: ['localhost:3000'] })).toThrow(/--allow-origin/);
    expect(() => createAccessPolicy({ bindHost: '127.0.0.1', allowHosts: ['bad host'] })).toThrow(/--allow-host/);
  });
});

describe('which requests need the Origin rules', () => {
  it('API, WebSocket and non-GET requests do; page and asset GETs do not', () => {
    expect(needsOriginCheck('GET', '/api/health')).toBe(true);
    expect(needsOriginCheck('POST', '/api/sessions')).toBe(true);
    expect(needsOriginCheck('GET', '//api/sessions')).toBe(true); // same parsing as api()
    expect(needsOriginCheck('POST', '/')).toBe(true);
    expect(needsOriginCheck('OPTIONS', '/')).toBe(true);
    expect(needsOriginCheck('GET', '/')).toBe(false);
    expect(needsOriginCheck('HEAD', '/assets/index.js')).toBe(false);
    expect(needsOriginCheck('GET', '/apidocs')).toBe(false);
  });
});

describe('flags', () => {
  it('collects repeated and --x=… forms and splits comma/space lists', () => {
    const argv = ['--allow-host', 'a.local', '--port', '1', '--allow-host=b.local,c.local', '--allow-host', '--dev'];
    expect(splitList(...flagValues(argv, '--allow-host'), 'd.local e.local', undefined)).toEqual(['a.local', 'b.local', 'c.local', 'd.local', 'e.local']);
  });
});

describe('rejection log', () => {
  it('logs each distinct rejection once and stops after a cap', () => {
    const lines: string[] = [];
    const log = createRejectionLog((l) => lines.push(l), 2);
    const denied = (origin: string) => checkAccess(local, { host: 'localhost:5317', origin }) as Denied;
    log(denied('https://a.example'), 'POST /api/sessions');
    log(denied('https://a.example'), 'POST /api/sessions');
    log(denied('https://b.example'), 'WebSocket /ws');
    log(denied('https://c.example'), 'POST /api/sessions');
    log(denied('https://d.example'), 'POST /api/sessions');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\[security\] blocked POST \/api\/sessions: .*https:\/\/a\.example/);
    expect(lines[2]).toMatch(/not logging new ones/);
  });
});

describe('createGuard (node:http wiring)', () => {
  function fakeRes() {
    const r = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
      writeHead(code: number, h: Record<string, string> = {}) {
        r.status = code;
        Object.assign(r.headers, h);
        return r;
      },
      setHeader(k: string, v: string) {
        r.headers[k.toLowerCase()] = v;
      },
      end(b?: string) {
        r.body = b ?? '';
      },
    };
    return r;
  }
  const req = (method: string, headers: Record<string, string>) => ({ method, headers, url: '/' }) as never;

  it('answers a refused request with a JSON 403 and stops routing', () => {
    const logged: string[] = [];
    const g = createGuard({ bindHost: '127.0.0.1' }, createRejectionLog((l) => logged.push(l)));
    const res = fakeRes();
    expect(g.request(req('POST', { host: '127.0.0.1:5317', origin: 'https://evil.example' }), res as unknown as ServerResponse, '/api/sessions')).toBe(false);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/cross-origin request from https:\/\/evil\.example/);
    expect(logged).toHaveLength(1);
  });
  it('lets same-origin and no-Origin requests through without CORS headers', () => {
    const g = createGuard({ bindHost: '127.0.0.1' }, () => {});
    const res = fakeRes();
    expect(g.request(req('POST', { host: '127.0.0.1:5317', origin: 'http://127.0.0.1:5317' }), res as unknown as ServerResponse, '/api/sessions')).toBe(true);
    expect(g.request(req('GET', { host: '127.0.0.1:5317' }), res as unknown as ServerResponse, '/api/health')).toBe(true);
    expect(res.headers).toEqual({});
  });
  it('adds CORS headers only for --allow-origin pages', () => {
    const g = createGuard({ bindHost: '127.0.0.1', allowOrigins: ['http://localhost:3000'] }, () => {});
    const res = fakeRes();
    expect(g.request(req('POST', { host: '127.0.0.1:5317', origin: 'http://localhost:3000' }), res as unknown as ServerResponse, '/api/sessions')).toBe(true);
    expect(res.headers).toEqual({ 'access-control-allow-origin': 'http://localhost:3000', vary: 'Origin' });
  });
  it('refuses a WebSocket upgrade with an HTTP 403 and closes the socket', () => {
    let written = '';
    let destroyed = false;
    let onFinish: (() => void) | undefined;
    const socket = {
      on: () => socket,
      once: (ev: string, cb: () => void) => ((onFinish = ev === 'finish' ? cb : onFinish), socket),
      end: (s: string) => ((written = s), onFinish?.()),
      destroy: () => (destroyed = true),
    } as unknown as Duplex;
    const g = createGuard({ bindHost: '127.0.0.1' }, () => {});
    expect(g.upgrade({ headers: { host: '127.0.0.1:5317', origin: 'https://evil.example' }, url: '/ws' } as never, socket)).toBe(false);
    expect(written).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
    expect(written).toContain('cross-origin request from https://evil.example');
    expect(destroyed).toBe(true);
    expect(g.upgrade({ headers: { host: '127.0.0.1:5317' }, url: '/ws' } as never, socket)).toBe(true);
  });
});

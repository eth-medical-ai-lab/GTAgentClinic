/**
 * Z-fighting check: coplanar, overlapping faces in the procedural props and fixtures that
 * flicker as the view moves (two faces in one plane win the depth test by turns).
 *
 *   npx tsx tests/zfight.ts [--only=props.ts,details.ts] [--all] [--json=out.json] [--shots=outDir] [--spots=a,b] [--no-scan] [--port-base=7000]
 *
 * Boots a private dev server (tests/harness.ts; never the player's 5317), builds the hospital
 * unmerged in a headless page plus every prop kind on its own (tests/zfight-scan.ts), and prints
 * each pair of meshes with faces visible from the same side, within 0.5 mm of one plane and
 * overlapping by more than 1 cm², as file:line of the two builder calls. Tiers:
 * - zfight: ≤ 0.5 mm apart, different materials — flickers; fix it in the builder (move the
 *   decorative/inner part 2–4 mm toward the viewer, or shrink/lower it).
 * - near: 0.5–1.5 mm apart — flickers from ~25 m; worth 2 mm.
 * - same-material / glass: one material (or two see-through ones) in both faces: nothing to see.
 *   Counted; listed with --all.
 * Exits 1 when a zfight or near pair is found that is not in KEEP below (with --only, among pairs
 * that involve one of those files), or when the self-test (known flickers) fails.
 *
 * --shots=dir also saves first-person screenshots of the SPOTS below (Night Shift, HUD hidden);
 * --spots picks some of them; --no-scan skips the scan.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { startHarness } from './harness';
import type { ScanFinding, ScanFrame, ScanResult } from './zfight-scan';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** pairs that are known and accepted: [substring of the signature, reason] */
const KEEP: [string, string][] = [];

/** first-person views of fixed spots: x, z, yaw (deg; 0 = facing +z/south, 90 = east), pitch */
const SPOTS: Record<string, [number, number, number, number]> = {
  medSink: [32.35, 22.75, -90, -14], // meds room sink: glove box on its holder
  medDispenser: [33.0, 18.7, 0, 2], // header band over the cabinet
  regDesk: [6.7, 20.6, 90, -18], // waiting-room registration desk: transaction top
  plant: [8.55, 22.55, 45, -42], // soil in the pot
  cafCounter: [59.75, 3.0, 180, -18], // display: glass shelf, lids, LED strip
  cafFridge: [64.15, 2.3, 180, -4], // drinks fridge: door glass, back wall
  stalls: [69.1, 4.3, 70, 12], // toilet stalls: head rail into the end pilaster
  hubAed: [1.5, 9.2, -90, -6], // AED cabinet glass (hub west wall)
  extinguisher: [34.4, 13.4, 0, -14], // extinguisher cabinet glass
  slidingDoor: [3.0, 16.5, 180, -6], // waiting-room sliding door leaf in its frame
  coveBase: [68.1, 17.4, 0, -38], // cove base meeting the restroom block's wall from the clinic hall
  clinicTv: [49.7, 15.3, 180, 10], // TV screen in its bezel
};

const args = process.argv.slice(2);
const opt = (k: string) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a === undefined ? undefined : a.slice(a.indexOf('=') + 1);
};
const showAll = args.includes('--all');
/** --only=props.ts,details.ts: report pairs that involve one of these builder files */
const only = opt('only')?.split(',').filter(Boolean);

// ── source maps: Vite serves each module with an inline map; frames point into the served code ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(seg: string): number[] {
  const out: number[] = [];
  let v = 0;
  let shift = 0;
  for (const ch of seg) {
    const d = B64.indexOf(ch);
    v += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      out.push(v & 1 ? -(v >> 1) : v >> 1);
      v = 0;
      shift = 0;
    }
  }
  return out;
}
/** per generated line: [generated column, source line] (0-based), sorted */
function decodeMappings(mappings: string): [number, number][][] {
  let src = 0;
  let line = 0;
  let col = 0;
  return mappings.split(';').map((l) => {
    let gen = 0;
    const segs: [number, number][] = [];
    for (const s of l.split(',')) {
      if (!s) continue;
      const v = vlq(s);
      gen += v[0];
      if (v.length >= 4) {
        src += v[1];
        line += v[2];
        col += v[3];
        segs.push([gen, line]);
      }
    }
    void src;
    void col;
    return segs;
  });
}
const maps = new Map<string, [number, number][][] | null>();
async function loadMap(page: Page, url: string) {
  if (maps.has(url)) return;
  const code = (await page.evaluate(`fetch(${JSON.stringify(url)}).then((r) => r.text())`)) as string;
  const m = /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
  maps.set(url, m ? decodeMappings(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')).mappings) : null);
}
function sourceLine(f: ScanFrame): number | null {
  const lines = maps.get(f.url);
  const segs = lines?.[f.line - 1];
  if (!segs?.length) return null;
  let best: [number, number] | null = null;
  for (const s of segs) if (s[0] <= f.col - 1) best = s;
  return (best ?? segs[0])[1] + 1;
}
const fileOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/^\/@fs\//, '/').replace(ROOT + '/', '').replace(/^\/src\//, 'client/src/');
const site = (f: ScanFrame | undefined) => (f ? `${path.basename(fileOf(f.url))}:${sourceLine(f) ?? `?${f.line}`}` : '?');
const chain = (fr: ScanFrame[]) => fr.map((f) => `${site(f)} ${f.fn}`).join(' ← ');

// ── run ──
const kinds = [...readFileSync(path.join(ROOT, 'shared/layout.ts'), 'utf8').match(/export type PropKind =([\s\S]*?);/)![1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
const h = await startHarness({ portBase: Number(opt('port-base') ?? 7000), dev: true });
let bad = 0;
try {
  if (!args.includes('--no-scan')) {
    const page = await h.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => ((/^\[vite\]/.test(m.text()) && !/connect/.test(m.text())) || /^\[zfight\] no group/.test(m.text())) && console.log(`  ${m.text()}`));
    // a silent stand-in for Vite's HMR socket: edits elsewhere in the tree (other people, other
    // agents) must not reload the page halfway through the scan
    await page.routeWebSocket((u) => !u.pathname.startsWith('/ws'), () => undefined);
    await page.goto(`${h.url}/?debug=1`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    const mod = `/@fs${path.join(ROOT, 'tests/zfight-scan.ts')}`;
    // the detector on known cases first (the owner's two flickers as they were, …)
    const self = (await page.evaluate(`import(${JSON.stringify(mod)}).then((m) => m.selfTest())`)) as { name: string; ok: boolean; found: number }[];
    for (const t of self) h.check(`self-test: ${t.name}`, t.ok, `${t.found} pair(s)`);
    if (self.some((t) => !t.ok)) bad++;
    const res = (await page.evaluate(`import(${JSON.stringify(mod)}).then((m) => m.scan(${JSON.stringify({ kinds, all: showAll })}))`)) as ScanResult;
    for (const g of res.groups) for (const fr of [...g.example.a.frames, ...g.example.b.frames]) await loadMap(page, fr.url);
    if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
    console.log(`scan: ${JSON.stringify(res.stats)}`);
    if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(res, null, 1));

    // one entry per pair of builder calls (a prop used in eight bays is one fix), by source line
    interface Entry {
      sig: string;
      tier: string;
      count: number;
      passes: Set<string>;
      owners: Set<string>;
      ex: ScanFinding;
    }
    const kindOf = (owner: string) => owner.replace(/ @ .*$/, '').replace(/^\S+ \(([A-Za-z]+)\)$/, '$1').replace(/ \(default size\)$/, '');
    const entries = new Map<string, Entry>();
    for (const g of res.groups) {
      const f = g.example;
      const [a, b] = [site(f.a.frames[0]), site(f.b.frames[0])].sort();
      const sig = `${g.tier} ${a} × ${b} [${f.owner.split(' | ').map(kindOf).join(' | ')}]`;
      const e = entries.get(sig);
      if (!e) entries.set(sig, { sig, tier: g.tier, count: g.count, passes: new Set(g.passes), owners: new Set(g.owners), ex: f });
      else {
        e.count += g.count;
        g.passes.forEach((x) => e.passes.add(x));
        g.owners.forEach((x) => e.owners.add(x));
        if (f.area > e.ex.area) e.ex = f;
      }
    }
    const order = ['zfight', 'near', 'same-material', 'glass'];
    const sorted = [...entries.values()].sort((x, y) => order.indexOf(x.tier) - order.indexOf(y.tier) || x.sig.localeCompare(y.sig));
    const counts: Record<string, number> = {};
    const byFile: Record<string, number> = {};
    for (const e of sorted) {
      if (only && ![e.ex.a, e.ex.b].some((m) => only.includes(site(m.frames[0]).replace(/:.*$/, '')))) continue;
      counts[e.tier] = (counts[e.tier] ?? 0) + 1;
      const kept = KEEP.find(([k]) => e.sig.includes(k));
      const flagged = (e.tier === 'zfight' || e.tier === 'near') && !kept;
      if (flagged) {
        bad++;
        for (const fl of new Set([e.ex.a, e.ex.b].map((m) => site(m.frames[0]).replace(/:.*$/, '')))) byFile[fl] = (byFile[fl] ?? 0) + 1;
      }
      if (!flagged && !showAll && !kept) continue;
      const f = e.ex;
      console.log(`\n${flagged ? '✗' : kept ? '·' : ' '} ${e.tier}  ${e.count}× (${[...e.passes].join('+')})  ${(f.area * 1e4).toFixed(1)} cm²  gap ${(f.gap * 1000).toFixed(2)} mm  ${f.facing}  normal ${f.normal.join(',')}`);
      if (kept) console.log(`    kept: ${kept[1]}`);
      console.log(`    owner: ${[...e.owners].slice(0, 4).join('; ')}${e.owners.size > 4 ? ' …' : ''}`);
      console.log(`    at ${f.local.join(', ')} (owner frame)   world ${f.at.join(', ')}`);
      for (const [k, m] of [['a', f.a], ['b', f.b]] as const) console.log(`    ${k}: ${m.geo} · ${m.mat} · at ${m.pos.join(', ')}\n       ${chain(m.frames)}`);
    }
    console.log(`\npairs of builder calls by tier: ${order.map((t) => `${t} ${counts[t] ?? 0}`).join(', ')}${showAll ? '' : '  (--all lists same-material and glass)'}`);
    if (bad) console.log(`by file: ${Object.entries(byFile).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(bad ? `✗ ${bad} z-fighting pair(s) to fix` : '✓ no z-fighting pairs');
    await page.close();
  }

  const shots = opt('shots');
  if (shots) {
    mkdirSync(shots, { recursive: true });
    const pick = opt('spots')?.split(',') ?? Object.keys(SPOTS);
    for (const name of pick) {
      const s = SPOTS[name];
      if (!s) continue;
      const { page } = await h.nightShift(`wpos=${s.join(',')}`, 1000);
      // the loading screen stays up while shaders compile
      await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 120000 });
      await page.waitForTimeout(2500);
      await page.addStyleTag({ content: '.hud, .toasts, .wl-hint { visibility: hidden !important; }' });
      await page.waitForTimeout(300);
      const file = path.resolve(shots, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`📸 ${file}`);
      await page.close();
    }
  }
} finally {
  await h.close();
}
process.exit(bad ? 1 : 0);

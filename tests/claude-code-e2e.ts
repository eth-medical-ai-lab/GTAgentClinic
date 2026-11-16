/**
 * Live smoke test of the Claude Code NPC brain, on YOUR OWN Claude Code login (it spends a little of
 * your plan: at most 6 Claude Haiku requests). Not part of `npm test`; run it on purpose:
 *
 *   npx tsx tests/claude-code-e2e.ts [outDir]
 *
 * A private server with --llm claude-code on a random port, a Night Shift in a headless GPU browser,
 * up to 6 turns with the patient in Fast Track. Checks that replies come from the LLM and stay in
 * character, that the ◆ chip names "Claude Code · Haiku" from the start and counts tokens, that every
 * turn's usage is recorded, and that no `claude` process outlives the server. The usage ledger goes
 * to a temp file, not your data/usage.json.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UsageSummary, UsageTotals } from '../shared/types';
import { fmtTokens, fmtUSD, totalTokens } from '../shared/usage';
import { startHarness } from './harness';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/claude-code';
mkdirSync(out, { recursive: true });
const ledgerDir = mkdtempSync(path.join(tmpdir(), 'ac-cc-smoke-'));
process.env.AGENTCLINIC_USAGE_FILE = path.join(ledgerDir, 'usage.json'); // the server inherits it

const LINES = [
  "Hi, I'm one of the doctors here. What happened to your ankle?",
  'When did it happen, and could you walk on it right afterwards?',
  'Where exactly does it hurt? Can you point to the spot?',
  'Any numbness or tingling in your foot, and did you hurt anything else?',
  'Do you take any medicines regularly, and are you allergic to anything?',
  "Okay, I'll examine your ankle now and then decide whether you need an X-ray.",
];

/** processes below a pid (ps snapshot): the tsx launcher → the game server → its claude children */
function descendants(root: number): { pid: number; cmd: string }[] {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
  const out: { pid: number; cmd: string }[] = [];
  const walk = (p: number) => {
    for (const r of rows) if (r.ppid === p) (out.push({ pid: r.pid, cmd: r.cmd }), walk(r.pid));
  };
  walk(root);
  return out;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const h = await startHarness({ portBase: 7950, llm: 'claude-code' });
const { check } = h;
const claudePids = new Set<number>();
const turns: { said: string; reply: string; source?: string; ms: number; usage: UsageTotals }[] = [];
let model = '';
try {
  const llmLine = /\[llm\][^\n]*/.exec(h.log())?.[0] ?? '';
  check('the server runs NPCs on Claude Code (your login), with Haiku', /Claude Code/.test(llmLine) && /Haiku/i.test(llmLine), llmLine);
  const { page, errors } = await h.nightShift('', 6000);
  await page.evaluate(`__ac.client.settings({ paused: true })`); // only our turns call the model

  // the chip from the first second, at 0 tokens
  const chip0 = (await page.textContent('.usage-chip'))?.replace(/\s+/g, ' ').trim() ?? '';
  check('the ◆ chip shows from the start of the shift and names "Claude Code · Haiku"', /^◆ Claude Code · Haiku · 0 tok · \$0/.test(chip0), chip0);
  check('…and the separate status chip is folded into it', !(await page.isVisible('.llm-chip')));
  await page.screenshot({ path: `${out}/hud-start.png`, clip: { x: 640, y: 0, width: 960, height: 70 } });

  const sid = (await page.evaluate('__ac.store.get().view.sessionId')) as string;
  const npc = (await page.evaluate(`__ac.store.get().view.npcs.find((n) => n.role === 'patient' && n.talkable)?.id`)) as string;
  const name = (await page.evaluate(`__ac.store.get().view.npcs.find((n) => n.id === '${npc}')?.name`)) as string;
  check('a patient is there to talk to', !!npc, `${name} (${npc})`);
  await page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: '${npc}', tab: 'talk' } })`);

  const sessionUsage = async (): Promise<UsageTotals> => {
    const s = (await page.evaluate(`fetch('/api/usage').then((r) => r.json())`)) as UsageSummary;
    model = s.models.join(', ');
    return s.sessions.find((x) => x.id === sid)?.npc ?? ({ calls: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0, latencyMs: 0 } as UsageTotals);
  };
  let before = await sessionUsage();
  for (const said of LINES) {
    const t0 = Date.now();
    const r = (await page.evaluate(`__ac.client.act({ type: 'talk', npcId: '${npc}', text: ${JSON.stringify(said)} })`)) as { ok: boolean; text?: string; message?: string; data?: { source?: string } };
    const ms = Date.now() - t0;
    for (const p of descendants(h.pid)) if (/(^|\/)claude(\s|$)/.test(p.cmd.split(' ')[0]) || /\bclaude -p\b/.test(p.cmd)) claudePids.add(p.pid);
    const after = await sessionUsage();
    const d = Object.fromEntries(Object.keys(after).map((k) => [k, (after as unknown as Record<string, number>)[k] - (before as unknown as Record<string, number>)[k]])) as unknown as UsageTotals;
    before = after;
    turns.push({ said, reply: r.text ?? r.message ?? '', source: r.data?.source, ms, usage: d });
    if (!r.ok) break;
  }
  await page.waitForTimeout(1500); // the next state message carries the totals to the HUD

  check(`${turns.length} turns, every reply from the LLM`, turns.length === LINES.length && turns.every((t) => t.source === 'llm' && t.reply.trim().length > 0), turns.map((t) => t.source).join(','));
  const all = turns.map((t) => t.reply).join(' ');
  check('replies stay in character (first person, no assistant talk)', !/as an ai|language model|i'm claude|assistant/i.test(all) && /\b(I|my|me)\b/.test(all));
  check('…and about the case (the ankle)', /ankle|foot|twist|rolled|step|stairs|curb|basketball|walk/i.test(all));
  check('every turn recorded its own usage (one call, tokens and an API-equivalent cost)', turns.every((t) => t.usage.calls === 1 && totalTokens(t.usage) > 0 && t.usage.costUSD > 0));
  const chip = (await page.textContent('.usage-chip'))?.replace(/\s+/g, ' ').trim() ?? '';
  check('the ◆ chip now counts tokens: "Claude Code · Haiku · … tok · $… API-eq."', /^◆ Claude Code · Haiku · [\d.]+k? tok · \$[\d.]+ API-eq\.$/.test(chip), chip);
  await page.click('.usage-chip');
  await page.waitForSelector('.usage-pop', { timeout: 5000 });
  const pop = (await page.textContent('.usage-pop')) ?? '';
  check('the popover shows this shift: calls, tokens, cost, per NPC, and what each line means', /this shift/.test(pop) && /Calls/.test(pop) && pop.includes(name.split(' ')[0]) && /one small request on your own Claude Code login/.test(pop));
  const planShown = /Your Claude plan/.test(pop);
  console.log(`  (plan window in the popover: ${planShown ? 'yes, the CLI reported it' : 'no rate-limit reading from the CLI during this run'})`);
  await page.screenshot({ path: `${out}/hud-popover.png`, clip: { x: 560, y: 0, width: 1040, height: 700 } });
  check('no page errors', errors.length === 0, errors.join(' | '));
  check('claude processes ran under the server', claudePids.size > 0, [...claudePids].join(', '));
} catch (e) {
  check('smoke test ran to the end', false, (e as Error).stack ?? String(e));
} finally {
  await h.close();
}
// nothing of ours may outlive the server
await new Promise((r) => setTimeout(r, 2500));
const left = [...claudePids].filter(alive);
check('no claude process outlives the server', left.length === 0, left.length ? `still running: ${left.join(', ')}` : `${claudePids.size} stopped`);
for (const pid of left) process.kill(pid, 'SIGTERM'); // ours only, by pid
check('the server stopped', !alive(h.pid));
rmSync(ledgerDir, { recursive: true, force: true });

console.log(`\nmodel(s): ${model || '?'}`);
console.log('turn | latency | uncached in | cache read | cache write | output | total tok | API-eq. cost');
for (const [i, t] of turns.entries()) {
  const u = t.usage;
  console.log(`${i + 1} | ${(t.ms / 1000).toFixed(1)} s | ${u.inputTokens} | ${u.cacheReadTokens} | ${u.cacheWriteTokens} | ${u.outputTokens} | ${totalTokens(u)} | ${fmtUSD(u.costUSD)}`);
}
const sum = turns.reduce((a, t) => ({ tok: a.tok + totalTokens(t.usage), usd: a.usd + t.usage.costUSD }), { tok: 0, usd: 0 });
console.log(`total: ${fmtTokens(sum.tok)} tokens · ${fmtUSD(sum.usd)} API-equivalent over ${turns.length} turns`);
console.log('\nconversation:');
for (const t of turns) console.log(`  Doctor: ${t.said}\n  Patient: ${t.reply}`);
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

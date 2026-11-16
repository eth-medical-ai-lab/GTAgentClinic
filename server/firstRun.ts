/**
 * First-run choice in `npm start` (bin/agentclinic.mjs): who talks for the game's characters?
 *
 * Asked once, in a terminal, while no brain has been chosen: no --llm flag, no AGENTCLINIC_LLM, no
 * "llm" or "claudeCode" in agentclinic.local.json and no ANTHROPIC_API_KEY. The answer goes into the
 * git-ignored agentclinic.local.json, which the server reads. Never asked when not interactive (CI,
 * tests, the e2e harness, a server started directly): those keep the old behaviour exactly.
 *
 * Guarantees: this only runs `claude auth status` (installed? logged in? which plan?) through the
 * unmodified `claude` binary. The game never reads, copies or stores Claude credentials or tokens,
 * and signing in always happens in Claude Code's own flow (`claude`, then its login).
 */
import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { checkClaudeCode, type ClaudeAuth } from './llm/provider';
import { LOCAL_CONFIG_FILE, localConfigFile, writeLocalConfig, type LocalConfigFile } from './localConfig';

export type FirstRunSkip = 'not-interactive' | 'ci' | 'llm-flag' | 'llm-env' | 'local-config' | 'local-config-broken' | 'api-key';

export type FirstRunPlan =
  | { kind: 'skip'; reason: FirstRunSkip }
  /** installed and logged in: ask */
  | { kind: 'ask'; auth: ClaudeAuth }
  /** installed, not logged in: say how to log in, don't save (so it asks next time) */
  | { kind: 'log-in'; auth: ClaudeAuth }
  /** no `claude` on this machine: one line on how to get it */
  | { kind: 'install' };

export interface FirstRunInput {
  /** stdin and stdout are both terminals */
  interactive: boolean;
  /** --llm from the command line */
  llmFlag?: string;
  env: NodeJS.ProcessEnv;
  local: LocalConfigFile;
  /** `claude auth status` (checkClaudeCode); injected so tests never run the real CLI */
  check: () => Promise<ClaudeAuth>;
}

const isCi = (v: string | undefined) => !!v && !/^(0|false|no)$/i.test(v.trim());

/** Why not to ask (a brain is already chosen, or nobody can answer); null = ask. Never runs `claude`. */
export function firstRunSkip(i: Omit<FirstRunInput, 'check'>): FirstRunSkip | null {
  if (!i.interactive) return 'not-interactive';
  if (isCi(i.env.CI)) return 'ci';
  if (i.llmFlag) return 'llm-flag';
  if (i.env.AGENTCLINIC_LLM?.trim()) return 'llm-env';
  // a file we can't read may hold a choice: never ask over it (and never overwrite it)
  if (i.local.state === 'broken') return 'local-config-broken';
  if (i.local.state === 'ok') {
    // ("codex": true alone is no choice of brain: it only lets the title screen's Online use Codex
    // without asking, and auto startup never picks Codex, so the question still comes)
    const { llm, claudeCode } = i.local.data;
    if ((typeof llm === 'string' && llm.trim()) || typeof claudeCode === 'boolean') return 'local-config';
  }
  if (i.env.ANTHROPIC_API_KEY?.trim()) return 'api-key';
  return null;
}

export async function planFirstRun(i: FirstRunInput): Promise<FirstRunPlan> {
  const reason = firstRunSkip(i);
  if (reason) return { kind: 'skip', reason };
  const auth = await i.check();
  if (auth.loggedIn) return { kind: 'ask', auth };
  return auth.installed ? { kind: 'log-in', auth } : { kind: 'install' };
}

export type FirstRunAnswer = 'yes' | 'no' | 'key';

/** Enter alone = yes (the default, shown as [Y]) */
export function parseAnswer(line: string): FirstRunAnswer | null {
  const a = line.trim().toLowerCase();
  if (a === '' || a === 'y' || a === 'yes') return 'yes';
  if (a === 'n' || a === 'no') return 'no';
  if (a === 'k' || a === 'key' || a === 'api' || a === 'api key') return 'key';
  return null;
}

/** What an answer saves in agentclinic.local.json. The key answer saves nothing: keys never go in that file. */
export function answerConfig(a: FirstRunAnswer): { claudeCode?: true; llm: string } | null {
  if (a === 'yes') return { claudeCode: true, llm: 'claude-code' };
  if (a === 'no') return { llm: 'offline' };
  return null;
}

/** "Max plan", "Pro plan", "claude.ai login", "Console account" */
export function planLabel(auth: ClaudeAuth): string {
  const t = auth.subscriptionType?.trim();
  if (t) return `${t[0].toUpperCase()}${t.slice(1)} plan`;
  if (auth.authMethod === 'claude.ai') return 'claude.ai login';
  if (auth.authMethod && /console/i.test(auth.authMethod)) return 'Console account';
  return auth.authMethod ? `${auth.authMethod} login` : '';
}

/** a claude.ai plan (counts toward its usage limits) rather than a Console account billed per token */
const onPlan = (auth: ClaudeAuth) => !!auth.subscriptionType || auth.authMethod === 'claude.ai';

function modelName(env: NodeJS.ProcessEnv): string {
  const m = env.AGENTCLINIC_MODEL?.trim();
  return !m || m.toLowerCase() === 'haiku' ? 'Claude Haiku' : m;
}

/** The question, as printed (without colours). */
export function questionText(auth: ClaudeAuth, env: NodeJS.ProcessEnv = {}): string[] {
  const plan = planLabel(auth);
  return [
    `Claude Code is installed and logged in${plan ? ` (${plan})` : ''}.`,
    `Run the game's characters on your Claude Code login? They use ${modelName(env)};`,
    `each line is a small request that ${onPlan(auth) ? "counts toward your own plan's usage" : 'is billed to your own Console account'}, shown in game (◆ chip).`,
    '[Y]es / [n]o (offline scripted characters) / [k] I have an API key',
  ];
}

const CHANGE = `To change it: npm start -- --llm claude-code|api|offline for one run, or edit ${LOCAL_CONFIG_FILE} (delete it to be asked again).`;

export interface FirstRunOptions {
  /** the checkout (where agentclinic.local.json lives) */
  root: string;
  llmFlag?: string;
  env?: NodeJS.ProcessEnv;
  /** default: stdin and stdout are terminals */
  interactive?: boolean;
  input?: Readable;
  output?: Writable;
  check?: () => Promise<ClaudeAuth>;
  /** ANSI colours (default: when output is a terminal) */
  color?: boolean;
  platform?: NodeJS.Platform;
}

export interface FirstRunResult {
  plan: FirstRunPlan['kind'];
  skipped?: FirstRunSkip;
  answer?: FirstRunAnswer;
  /** where the answer was saved */
  saved?: string;
  /** --llm for this run, when the answer could not be saved */
  llm?: string;
  /** Ctrl+C at the question: stop npm start */
  aborted?: boolean;
  /**
   * npm start's hint under an offline "NPC brains" line: undefined = the usual one, null = none
   * (this run already explained), a string = this one instead
   */
  offlineHint?: string | null;
}

const isTty = (s: unknown) => !!(s as { isTTY?: boolean } | undefined)?.isTTY;

/**
 * Lines from the terminal, buffered (readline may emit several from one chunk before anyone asks).
 * next() gives null at the end of input or after Ctrl+C (then `aborted` is set).
 */
function lineReader(rl: Interface) {
  const queue: string[] = [];
  const waiting: ((l: string | null) => void)[] = [];
  let closed = false;
  const r = {
    aborted: false,
    next(prompt: string): Promise<string | null> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      rl.setPrompt(prompt);
      rl.prompt();
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
  rl.on('line', (l) => {
    const w = waiting.shift();
    if (w) w(l);
    else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w(null);
  });
  // in a terminal, Ctrl+C reaches readline as a key, not as a signal: cancel npm start
  rl.on('SIGINT', () => {
    r.aborted = true;
    rl.close();
  });
  return r;
}

export async function runFirstRun(o: FirstRunOptions): Promise<FirstRunResult> {
  const env = o.env ?? process.env;
  const input = o.input ?? process.stdin;
  const output = o.output ?? process.stdout;
  const interactive = o.interactive ?? (isTty(input) && isTty(output));
  const color = o.color ?? isTty(output);
  const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const [dim, bold, teal, green, yellow] = [paint('2'), paint('1'), paint('36'), paint('32'), paint('33')];
  const say = (s = '') => output.write(`${s}\n`);
  const local = localConfigFile(o.root);

  const plan = await planFirstRun({ interactive, llmFlag: o.llmFlag, env, local, check: o.check ?? checkClaudeCode });
  if (plan.kind === 'skip') {
    // offline because of an earlier answer: setting a key alone would not change that, so say what does
    const chosenOffline = plan.reason === 'local-config' && local.state === 'ok' && String(local.data.llm ?? '').trim().toLowerCase() === 'offline';
    return { plan: 'skip', skipped: plan.reason, ...(chosenOffline ? { offlineHint: `Offline characters, as you chose in ${LOCAL_CONFIG_FILE}. To change: npm start -- --llm claude-code (or api), or delete that file to be asked again.` } : {}) };
  }
  if (plan.kind === 'install') {
    say(`  ${yellow('◌')} Want the characters to run on your own Claude Code login? Install Claude Code (https://claude.com/claude-code), log in once, then npm start again.`);
    return { plan: 'install' };
  }
  if (plan.kind === 'log-in') {
    say(`  ${yellow('◌')} Claude Code is installed but not logged in, so the characters are offline for now.`);
    say(dim('    Run `claude` once and log in, then `npm start` again.'));
    say();
    return { plan: 'log-in', offlineHint: null };
  }

  const [l1, l2, l3, l4] = questionText(plan.auth, env);
  say(`  ${teal(bold(l1))}`);
  say(`  ${bold(l2)}`);
  say(`  ${l3}`);
  say(`  ${teal(l4)}`);
  const rl = createInterface({ input, output, terminal: isTty(input) && isTty(output) });
  const lines = lineReader(rl);
  let answer: FirstRunAnswer | null = null;
  try {
    for (let tries = 0; tries < 3 && !answer; tries++) {
      const line = await lines.next('  › ');
      if (line === null) break;
      answer = parseAnswer(line);
      if (!answer) say(dim('    Please type y (yes), n (no) or k (API key), then Enter.'));
    }
  } finally {
    rl.close();
  }
  if (lines.aborted) {
    say('');
    say(dim('  Cancelled: nothing saved.'));
    return { plan: 'ask', aborted: true };
  }

  if (!answer) {
    say(dim("  No answer, so offline characters this time. You'll be asked again next time."));
    say();
    return { plan: 'ask', offlineHint: null };
  }
  if (answer === 'key') {
    const win = (o.platform ?? process.platform) === 'win32';
    say(dim(`  Nothing saved: your key never goes into ${LOCAL_CONFIG_FILE}. Set it in the terminal you start the game from:`));
    say(`    ${win ? '$env:ANTHROPIC_API_KEY = "sk-ant-..."' : 'export ANTHROPIC_API_KEY="sk-ant-..."'}   ${dim('then: npm start')}`);
    say(dim('  or keep it in a git-ignored .env file (copy .env.example to .env and add the key), and start with:'));
    say('    node --env-file=.env bin/agentclinic.mjs');
    say(dim('  Offline characters until then. Details: docs/SETUP.md#your-own-api-key'));
    say();
    return { plan: 'ask', answer, offlineHint: null };
  }

  const patch = answerConfig(answer)!;
  let saved: string | undefined;
  try {
    saved = writeLocalConfig(patch, o.root);
  } catch (e) {
    say(`  ${yellow('!')} Couldn't save your answer (${(e as Error).message}), so it applies to this run only.`);
  }
  if (answer === 'yes') say(`  ${green('●')} ${saved ? `Saved in ${LOCAL_CONFIG_FILE}: ` : ''}the characters run on your Claude Code login (${modelName(env)}).`);
  else say(`  ${yellow('◌')} ${saved ? `Saved in ${LOCAL_CONFIG_FILE}: ` : ''}offline scripted characters.`);
  say(dim(`    ${CHANGE}`));
  say();
  return { plan: 'ask', answer, saved, ...(saved ? {} : { llm: patch.llm }), offlineHint: null };
}

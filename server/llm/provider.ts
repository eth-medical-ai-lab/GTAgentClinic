/**
 * LLM provider abstraction for NPC "brains".
 *
 *  anthropic-api — @anthropic-ai/sdk with the player's own ANTHROPIC_API_KEY (or an `ant auth
 *                  login` profile), billed to them. What `auto` picks when a key is set.
 *  offline       — deterministic keyword NPCs (no LLM); `auto` without a key, tests, fast RL.
 *  claude-code   — spawns the player's own Claude Code CLI headless on their existing login.
 *                  A personal, explicit opt-in only (--llm claude-code, AGENTCLINIC_LLM, or
 *                  "claudeCode": true in agentclinic.local.json); `auto` never picks it alone.
 *                  Anthropic does not allow third-party apps to offer claude.ai login or plan
 *                  rate limits to their users without approval (docs/SETUP.md#claude-code).
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LlmStatus, PlanUsage } from '../../shared/types';
import { LOCAL_CONFIG_FILE, readLocalConfig, type LocalConfig } from '../localConfig';
import type { TokenCounts } from './pricing';

/** What one chat() turn really consumed (all API requests of the turn, incl. cache traffic). */
export interface LlmCallUsage extends TokenCounts {
  codexPricedCalls?: number;
  codexUnpricedCalls?: number;
  openaiPricedCalls?: number;
  openaiUnpricedCalls?: number;
  model: string;
  costUSD: number;
  /** 'claude-code' = Claude Code's own list-price figure; 'price-table' = computed from the provider's price table */
  costSource: 'claude-code' | 'price-table' | 'unpriced';
  /** API requests made during the turn */
  requests: number;
  latencyMs: number;
}

/** An LLM failure that still burned tokens (e.g. a Claude Code turn that ended with is_error). */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly usage?: LlmCallUsage,
  ) {
    super(message);
  }
}

export interface ChatRequest {
  /** conversation key — lets providers keep a warm session per NPC conversation */
  key: string;
  system: string;
  schema: Record<string, unknown>;
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
  /** Rendered game viewport as a base64 JPEG (embodied doctor). */
  screenshot?: string;
  /** model for this call; default: the provider's NPC model */
  model?: string;
}

export function userContent(message: string, screenshot?: string) {
  if (!screenshot) return message;
  return [
    { type: 'text' as const, text: message },
    { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: screenshot } },
  ];
}

export interface ChatResult {
  json: Record<string, unknown> | null;
  text: string;
  latencyMs: number;
  usage?: LlmCallUsage;
  /** subscription window utilization, when the CLI reported it during this turn */
  plan?: PlanUsage;
}

export interface LlmProvider {
  readonly status: LlmStatus;
  /** 'subscription' → costs are API-equivalent estimates; 'api' → billed per token */
  readonly billing?: 'subscription' | 'api';
  chat(req: ChatRequest): Promise<ChatResult>;
  /** drop any warm state for a conversation (e.g. NPC left) */
  forget(keyPrefix: string): void;
  dispose(): void;
}

export const CLAUDE_MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' } as const;
export const HAIKU_MODEL = CLAUDE_MODELS.haiku;

/** Strip env vars that would make the child think it is a nested/child Claude Code session. */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k.startsWith('CLAUDE_CODE_')) continue;
    env[k] = v;
  }
  return env;
}

/** How to start the local `claude` CLI: spawn(cmd, [...pre, ...args]). */
export interface ClaudeCommand {
  cmd: string;
  pre: string[];
}

/**
 * macOS/Linux: `claude` from PATH (or AGENTCLINIC_CLAUDE_BIN).
 * Windows: the native installer puts claude.exe on PATH, which spawn() finds. An npm install puts
 * a claude.cmd shim there instead, and Node cannot spawn .cmd files without a shell (whose
 * quoting would mangle the long prompts we pass), so run the shim's target directly.
 */
export function claudeCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ClaudeCommand {
  const explicit = env.AGENTCLINIC_CLAUDE_BIN;
  if (platform !== 'win32') return { cmd: explicit || 'claude', pre: [] };
  if (explicit) return /\.(cmd|bat)$/i.test(explicit) ? (fromNpmShim(path.dirname(explicit)) ?? { cmd: explicit, pre: [] }) : { cmd: explicit, pre: [] };
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    const exe = path.join(dir, 'claude.exe');
    if (existsSync(exe)) return { cmd: exe, pre: [] };
    const shim = existsSync(path.join(dir, 'claude.cmd')) ? fromNpmShim(dir) : null;
    if (shim) return shim;
  }
  return { cmd: 'claude', pre: [] };
}

/** <npm prefix>/claude.cmd → the package's real bin: a native claude.exe today, a JS entry in older releases */
function fromNpmShim(dir: string): ClaudeCommand | null {
  const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
  try {
    const j = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const rel = typeof j.bin === 'string' ? j.bin : j.bin?.claude;
    if (typeof rel !== 'string') return null;
    const target = path.join(pkg, rel);
    return /\.[cm]?js$/i.test(target) ? { cmd: process.execPath, pre: [target] } : { cmd: target, pre: [] };
  } catch {
    return null; // not an npm install of Claude Code
  }
}

export interface ClaudeAuth {
  installed: boolean;
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  version?: string;
}

export function checkClaudeCode(): Promise<ClaudeAuth> {
  return new Promise((resolve) => {
    const c = claudeCommand();
    execFile(c.cmd, [...c.pre, 'auth', 'status'], { env: childEnv(), timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) {
        resolve({ installed: !(err as NodeJS.ErrnoException).code?.toString().includes('ENOENT') && (err as NodeJS.ErrnoException).code !== 'ENOENT', loggedIn: false });
        return;
      }
      try {
        const j = JSON.parse(stdout);
        resolve({ installed: true, loggedIn: !!j.loggedIn, authMethod: j.authMethod, subscriptionType: j.subscriptionType });
      } catch {
        resolve({ installed: true, loggedIn: /logged in/i.test(stdout) });
      }
    });
  });
}

/** NPC brain wanted: a --llm flag, else AGENTCLINIC_LLM, else "llm" in agentclinic.local.json, else auto. */
export function llmPreference(pref?: string, local: LocalConfig = readLocalConfig(), env: NodeJS.ProcessEnv = process.env): { want: string; via: string } {
  if (pref) return { want: pref.toLowerCase(), via: `--llm ${pref}` };
  if (env.AGENTCLINIC_LLM) return { want: env.AGENTCLINIC_LLM.toLowerCase(), via: `AGENTCLINIC_LLM=${env.AGENTCLINIC_LLM}` };
  if (local.llm) return { want: local.llm, via: `"llm": "${local.llm}" in ${LOCAL_CONFIG_FILE}` };
  return { want: 'auto', via: 'default' };
}

/**
 * Is the personal Claude Code opt-in on? Asking for claude-code as the NPC brain (flag, env or
 * local file) or "claudeCode": true in agentclinic.local.json. It also gates "Watch an AI doctor"
 * with Claude, which launches the same CLI (server/observe.ts).
 */
export function claudeCodeOptIn(pref?: string, local: LocalConfig = readLocalConfig(), env: NodeJS.ProcessEnv = process.env): { allowed: boolean; via?: string } {
  const p = llmPreference(pref, local, env);
  if (p.want === 'claude-code') return { allowed: true, via: p.via };
  if (local.claudeCode) return { allowed: true, via: `"claudeCode": true in ${LOCAL_CONFIG_FILE}` };
  return { allowed: false };
}

/**
 * The same standing choice for your Codex login as the default (the title screen asks no question):
 * asking for codex as the NPC brain (flag, env or local file) or "codex": true in agentclinic.local.json.
 */
export function codexOptIn(pref?: string, local: LocalConfig = readLocalConfig(), env: NodeJS.ProcessEnv = process.env): { allowed: boolean; via?: string } {
  const p = llmPreference(pref, local, env);
  if (p.want === 'codex') return { allowed: true, via: p.via };
  if (local.codex) return { allowed: true, via: `"codex": true in ${LOCAL_CONFIG_FILE}` };
  return { allowed: false };
}

/**
 * auto: the player's own ANTHROPIC_API_KEY if set, else offline NPCs. Claude Code only with the
 * opt-in (then, as before: API key → Claude Code login → offline; AGENTCLINIC_PREFER_CLAUDE_CODE
 * puts Claude Code ahead of the key).
 */
export async function detectProvider(pref?: string, local: LocalConfig = readLocalConfig()): Promise<LlmProvider | null> {
  const { want } = llmPreference(pref, local);
  if (want === 'offline') return null;
  if (want === 'codex') {
    const { CodexProvider } = await import('./codex');
    return new CodexProvider(process.env.AGENTCLINIC_CODEX_NPC_MODEL);
  }
  if (want === 'vllm') {
    const { VllmClient, VllmProvider } = await import('./vllm');
    const client = new VllmClient();
    return new VllmProvider(client, await client.model());
  }
  const optIn = claudeCodeOptIn(pref, local).allowed;
  const preferClaudeCode = optIn && !!process.env.AGENTCLINIC_PREFER_CLAUDE_CODE;
  if (want === 'api' || want === 'anthropic-api' || (want === 'auto' && process.env.ANTHROPIC_API_KEY && !preferClaudeCode)) {
    const { AnthropicApiProvider } = await import('./anthropicApi');
    return new AnthropicApiProvider();
  }
  if (want === 'claude-code' || (want === 'auto' && optIn)) {
    const auth = await checkClaudeCode();
    if (auth.loggedIn) {
      const { ClaudeCodeProvider } = await import('./claudeCode');
      return new ClaudeCodeProvider(auth);
    }
    console.warn(`[llm] Claude Code opt-in is on, but ${auth.installed ? '`claude` is not logged in (run `claude` once and log in)' : 'the `claude` CLI was not found'}. Using offline NPCs.`);
    return null;
  }
  if (want !== 'auto') console.warn(`[llm] Unknown NPC brain "${want}" (use auto, api, claude-code or offline). Using offline NPCs.`);
  return null;
}

export function offlineStatus(): LlmStatus {
  return { provider: 'offline', label: 'Offline NPCs (scripted, no LLM)', ok: true, detail: 'Set ANTHROPIC_API_KEY (your own key) for open-ended conversations. See docs/SETUP.md.' };
}

/** pull the first JSON object out of a model's text reply */
export function extractJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

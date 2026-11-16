/**
 * Online/offline from the title screen (GET/POST /api/llm-mode, index.ts).
 *
 * Offline = no LLM anywhere on the server. Online = LLM features allowed: patients and staff talk
 * through a default LLM (or none), and Codex or a local model can be picked per shift. A switch applies to new
 * shifts, AI doctor runs and duels only; ones already running keep what they started with.
 *
 * Online picks the default by itself (planOnline: Claude, else a local model, else Codex), or the
 * player picks one by name in the list (planPick), also while online. Claude Code and Codex spend
 * the player's own plan, so each asks first, once per server run.
 *
 * Most people meet this while still setting up, so every way "online" can fail says what to do:
 * no key and no Claude Code, Claude Code not logged in, a login without the player's yes,
 * Codex not signed in, no vLLM server answering.
 *
 * planOnline() and planPick() are the decision, pure (tests/llm-mode.test.ts); checkAvailability()
 * gathers the facts they need; startOnline() builds the provider they picked.
 */
import { createRequire } from 'node:module';
import { CODEX_NPC_MODEL, OPENAI_NPC_MODEL } from '../../shared/llm';
import { AnthropicApiProvider } from './anthropicApi';
import { ClaudeCodeProvider } from './claudeCode';
import { CodexProvider } from './codex';
import { checkClaudeCode, HAIKU_MODEL, type ClaudeAuth, type LlmProvider } from './provider';
import { anthropicModel, codexReady } from './selection';
import { openaiProvider, VllmClient, VllmProvider, vllmModelFor } from './vllm';

/** what this machine offers right now */
export interface LlmFacts {
  apiKey: boolean;
  openaiKey: boolean;
  claude: ClaudeAuth | null;
  /** the player's standing Claude Code choice (agentclinic.local.json, --llm claude-code) */
  optIn: boolean;
  /** AGENTCLINIC_PREFER_CLAUDE_CODE: with the yes, Claude Code goes ahead of the API key (as at startup, provider.ts) */
  preferClaudeCode: boolean;
  /** the same standing choice for Codex ("codex": true, or --llm codex): no question before it */
  codexOptIn: boolean;
  codex: { ready: boolean; why?: string };
  /**
   * ready: the server answers and serves a model (a shift can pick one). model: the one a default
   * runs (LOCAL_API_MODEL, else the only one served); unset, with modelWhy, when that isn't
   * settled (several served and none named, or the named one not served)
   */
  vllm: { ready: boolean; url: string; models: string[]; model?: string; why?: string; modelWhy?: string };
}

export type OnlineUse = 'api' | 'claude-code' | 'codex' | 'openai-api' | 'vllm' | 'none';
/** Editable IDs, not display labels. Omitted models retain the existing startup defaults. */
export function connectionModel(use: OnlineUse, model?: string): string | undefined {
  switch (use) {
    case 'api': return anthropicModel(model) ?? (process.env.AGENTCLINIC_MODEL?.startsWith('claude-') ? process.env.AGENTCLINIC_MODEL : HAIKU_MODEL);
    case 'claude-code': return model ?? process.env.AGENTCLINIC_MODEL ?? 'haiku';
    case 'codex': return model ?? process.env.AGENTCLINIC_CODEX_NPC_MODEL ?? CODEX_NPC_MODEL;
    case 'openai-api': return model ?? OPENAI_NPC_MODEL;
    default: return model;
  }
}
/** the logins Online asks about before using them: they spend the player's own plan */
export type ConsentUse = 'claude-code' | 'codex';

/** the player's yes, for this server run (never saved); a standing choice counts too (LlmFacts.optIn, codexOptIn) */
export interface Consent {
  claude: boolean;
  codex: boolean;
}

export type OnlinePlan =
  /** go online: `use` is the default for patients and staff ('none': scripted until a shift picks Codex or a local model) */
  | { ok: true; use: OnlineUse; label: string }
  /** a login that spends the player's own plan would be the default, and the player hasn't said yes: ask first */
  | { ok: false; consent: true; use: ConsentUse; label: string; error: string }
  | { ok: false; consent?: false; error: string };

export const API_LABEL = 'Anthropic API · your ANTHROPIC_API_KEY';
export const OPENAI_LABEL = 'OpenAI API · your OPENAI_API_KEY';
/** "Claude Code · your claude.ai login (Pro plan)": the same words in the options list and "Online would use …" */
export const claudeLabel = (a: ClaudeAuth | null) => `Claude Code · your ${a?.subscriptionType ? `claude.ai login (${a.subscriptionType[0].toUpperCase()}${a.subscriptionType.slice(1)} plan)` : 'login'}`;
export const CODEX_LABEL = 'Codex · your Codex login';
export const vllmLabel = (f: LlmFacts) => `Custom API · ${f.vllm.model ?? 'vLLM'}`;
export const NO_DEFAULT_LABEL = 'Online · no default LLM';
export const CLAUDE_NOT_INSTALLED = 'Claude Code is not installed: get it at claude.com/claude-code and log in, or set ANTHROPIC_API_KEY.';
export const CLAUDE_NOT_LOGGED_IN = 'Claude Code is installed but not logged in: run `claude` once in a terminal and log in.';
const CODEX_NOT_READY = 'Codex is not signed in: run `npx codex login` in the game folder.';
const API_KEY_MISSING = 'ANTHROPIC_API_KEY is not set: set it in the terminal before npm start.';
export const NO_DEFAULT_NEEDS = 'No connection is configured yet. Set up a login, API key or custom API first.';

export const NOTHING_ONLINE =
  'No LLM is set up on this computer yet, so the game stays offline. Either set ANTHROPIC_API_KEY before npm start, or install Claude Code and log in (run `claude` once). docs/SETUP.md has both.';

const claudeIn = (f: LlmFacts) => !!f.claude?.loggedIn;
const claudeWhy = (f: LlmFacts) => (!f.claude?.installed ? CLAUDE_NOT_INSTALLED : `${CLAUDE_NOT_LOGGED_IN} Then press Check again.`);

/**
 * The plan for one LLM by name (the startup choice, the title screen's picker, the auto order).
 * `asked`: the player named it at startup (--llm claude-code|codex), which is the yes.
 */
function planFor(use: OnlineUse, f: LlmFacts, consent: Consent, asked = false): OnlinePlan {
  switch (use) {
    case 'openai-api':
      return f.openaiKey ? { ok: true, use, label: OPENAI_LABEL } : { ok: false, error: 'OPENAI_API_KEY is not set: set it in the terminal and restart the game.' };
    case 'api':
      return f.apiKey ? { ok: true, use: 'api', label: API_LABEL } : { ok: false, error: API_KEY_MISSING };
    case 'claude-code':
      if (!claudeIn(f)) return { ok: false, error: claudeWhy(f) };
      return asked || f.optIn || consent.claude
        ? { ok: true, use: 'claude-code', label: claudeLabel(f.claude) }
        : { ok: false, consent: true, use: 'claude-code', label: claudeLabel(f.claude), error: 'Online would use your Claude Code login: say yes first.' };
    case 'codex':
      if (!f.codex.ready) return { ok: false, error: f.codex.why ?? CODEX_NOT_READY };
      return asked || f.codexOptIn || consent.codex
        ? { ok: true, use: 'codex', label: CODEX_LABEL }
        : { ok: false, consent: true, use: 'codex', label: CODEX_LABEL, error: 'Online would use your Codex login: say yes first.' };
    case 'vllm':
      if (!f.vllm.ready) return { ok: false, error: f.vllm.why ?? `No vLLM server answers at ${f.vllm.url}.` };
      return f.vllm.model ? { ok: true, use: 'vllm', label: vllmLabel(f) } : { ok: false, error: f.vllm.modelWhy ?? 'Select a model served by vLLM.' };
    case 'none':
      return f.apiKey || f.openaiKey || claudeIn(f) || f.codex.ready || f.vllm.ready ? { ok: true, use: 'none', label: NO_DEFAULT_LABEL } : { ok: false, error: NO_DEFAULT_NEEDS };
  }
}

/**
 * Without Claude: a local model first (on this computer, free, and much quicker per line than Codex,
 * which starts a `codex exec` for each), else Codex (asked first), else online with no default when
 * vLLM answers but its model isn't settled (a shift can still pick one), else null.
 */
export function planWithoutClaude(f: LlmFacts, consent: Consent): OnlinePlan | null {
  // (a local model whose model isn't settled can't be the default: Codex, rather than a failed switch)
  if (f.vllm.ready && f.vllm.model) return planFor('vllm', f, consent);
  if (f.codex.ready) return planFor('codex', f, consent);
  if (f.vllm.ready || f.openaiKey) return planFor('none', f, consent);
  return null;
}

/**
 * What going online would use. `pref` is the startup choice (--llm, AGENTCLINIC_LLM or "llm" in
 * agentclinic.local.json): an explicit source is honoured as asked; auto (or offline) takes your API
 * key, else your Claude Code login (asked first), else a local model, else your Codex login (asked
 * first), else online with no default when vLLM answers but its model isn't settled.
 */
export function planOnline(pref: string, f: LlmFacts, consent: Consent): OnlinePlan {
  switch (pref) {
    case 'api':
    case 'anthropic-api':
      return f.apiKey ? { ok: true, use: 'api', label: API_LABEL } : { ok: false, error: 'You started the game for the Claude API (--llm api), but ANTHROPIC_API_KEY is not set. Set it in the terminal before npm start.' };
    case 'claude-code':
    case 'codex':
    case 'vllm':
      return planFor(pref, f, consent, true);
  }
  const claudeOk = claudeIn(f) && (f.optIn || consent.claude);
  // (the same order as at startup: AGENTCLINIC_PREFER_CLAUDE_CODE with the yes puts the login ahead of the key)
  if (claudeOk && f.preferClaudeCode) return planFor('claude-code', f, consent);
  if (f.apiKey) return planFor('api', f, consent);
  // (logged in without the yes: ask; the question offers planWithoutClaude() instead)
  if (claudeIn(f)) return planFor('claude-code', f, consent);
  const without = planWithoutClaude(f, consent);
  if (without) return without;
  return { ok: false, error: f.claude?.installed ? claudeWhy(f) : NOTHING_ONLINE };
}

/** the title screen's picker: one LLM by name as the default, or 'none' (each shift picks Codex or a local model) */
export function planPick(use: OnlineUse, f: LlmFacts, consent: Consent): OnlinePlan {
  return planFor(use, f, consent);
}

export interface LlmOption {
  ready: boolean;
  /** Editable model ID, supplied with the menu's connection settings. */
  model?: string;
  /** what the picker sends to make it the default */
  use: OnlineUse;
  label?: string;
  hint?: string;
  needsConsent?: boolean;
  /** Claude Code on a claude.ai plan (use counts toward it; otherwise it bills its own API account) */
  plan?: boolean;
}

/** Each connection has its own availability; API key presence does not prove model access. */
export function llmOptions(f: LlmFacts, consent: Consent): Record<'claude' | 'api' | 'codex' | 'openai' | 'vllm' | 'none', LlmOption> {
  const claudeOk = claudeIn(f) && (f.optIn || consent.claude);
  const claude: LlmOption = !f.claude?.installed
    ? { ready: false, use: 'claude-code', hint: CLAUDE_NOT_INSTALLED }
    : !f.claude.loggedIn
      ? { ready: false, use: 'claude-code', hint: CLAUDE_NOT_LOGGED_IN }
      : { ready: true, use: 'claude-code', label: claudeLabel(f.claude), needsConsent: !claudeOk, plan: !!f.claude.subscriptionType };
  return {
    claude,
    api: { ready: f.apiKey, use: 'api', label: 'Key configured · ANTHROPIC_API_KEY', hint: 'Key missing: set ANTHROPIC_API_KEY, then restart.' },
    codex: f.codex.ready ? { ready: true, use: 'codex', label: CODEX_LABEL, needsConsent: !(f.codexOptIn || consent.codex) } : { ready: false, use: 'codex', hint: f.codex.why },
    openai: { ready: f.openaiKey, use: 'openai-api', label: 'Key configured · OPENAI_API_KEY', hint: 'Key missing: set OPENAI_API_KEY, then restart.' },
    vllm: f.vllm.ready && f.vllm.model ? { ready: true, use: 'vllm', label: f.vllm.model } : { ready: false, use: 'vllm', hint: f.vllm.ready ? f.vllm.modelWhy : f.vllm.why },
    none: f.apiKey || f.openaiKey || claudeIn(f) || f.codex.ready || f.vllm.ready ? { ready: true, use: 'none', label: 'Scripted NPCs, unless a shift picks a connection' } : { ready: false, use: 'none', hint: NO_DEFAULT_NEEDS },
  };
}

async function codexFacts(): Promise<LlmFacts['codex']> {
  try {
    createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
  } catch {
    if (!process.env.AGENTCLINIC_CODEX_BIN) return { ready: false, why: 'Codex is not installed: run npm install in the game folder.' };
  }
  try {
    await codexReady();
    return { ready: true };
  } catch (e) {
    return { ready: false, why: (e as Error).message };
  }
}

/** A menu choice lasts for this server run; otherwise use the environment defaults. */
export interface CustomApiConfig { baseUrl: string; model?: string }

export async function vllmFacts(config?: CustomApiConfig): Promise<LlmFacts['vllm']> {
  let url: string;
  try {
    url = new VllmClient(config?.baseUrl).baseUrl;
  } catch (e) {
    // (a malformed LOCAL_API_URL rules out the local model only, not the whole switch)
    const raw = config?.baseUrl ?? process.env.LOCAL_API_URL ?? '';
    return { ready: false, url: raw, models: [], why: `LOCAL_API_URL (${raw}) is not usable: ${(e as Error).message}` };
  }
  try {
    // (a quick look only: the menu waits for this)
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(1500), redirect: 'error', headers: process.env.LOCAL_API_KEY ? { authorization: `Bearer ${process.env.LOCAL_API_KEY}` } : {} });
    if (!res.ok) return { ready: false, url, models: [], why: `The API server at ${url} answered HTTP ${res.status}.` };
    const j = (await res.json()) as { data?: { id: string }[] };
    const models = j.data?.map((m) => m.id) ?? [];
    if (!models.length) return { ready: false, url, models, why: `The API server at ${url} serves no model.` };
    return { ready: true, url, models, ...vllmDefaultModel(models, url, config ? config.model : process.env.LOCAL_API_MODEL || undefined) };
  } catch {
    return { ready: false, url, models: [], why: `No custom API: nothing answers at ${url}. Check Custom API settings or LOCAL_API_URL.` };
  }
}

/** the model a local default would run (the same choice as startOnline's), or what to do about it */
function vllmDefaultModel(models: string[], url: string, named?: string): { model: string } | { modelWhy: string } {
  const served = `${models.slice(0, 4).join(', ')}${models.length > 4 ? ', …' : ''}`;
  try {
    return { model: vllmModelFor(models, named) };
  } catch {
    return {
      modelWhy: named
        ? `Selected model is "${named.slice(0, 80)}", but the API server at ${url} serves ${served}. Choose one in Custom API settings or set LOCAL_API_MODEL.`
        : `The API server at ${url} serves ${models.length} models (${served}). Choose one in Custom API settings or set LOCAL_API_MODEL.`,
    };
  }
}

export async function checkAvailability(optIn: boolean, codexOptIn = false, custom?: CustomApiConfig): Promise<LlmFacts> {
  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  const [claude, codex, vllm] = await Promise.all([checkClaudeCode().catch(() => null), codexFacts(), vllmFacts(custom)]);
  return { apiKey, openaiKey: !!process.env.OPENAI_API_KEY, claude, optIn, codexOptIn, preferClaudeCode: !!process.env.AGENTCLINIC_PREFER_CLAUDE_CODE, codex, vllm };
}

/** the provider for an ok plan (null: online without a default) */
export async function startOnline(use: OnlineUse, f: LlmFacts, model?: string): Promise<LlmProvider | null> {
  model = connectionModel(use, model);
  switch (use) {
    case 'openai-api':
      return openaiProvider(model);
    case 'api':
      return new AnthropicApiProvider(model);
    case 'claude-code':
      return new ClaudeCodeProvider(f.claude!, model);
    case 'codex':
      return new CodexProvider(model);
    case 'vllm': {
      // (the model the check settled on, so the label and the provider agree)
      const client = new VllmClient(f.vllm.url);
      return new VllmProvider(client, f.vllm.model ?? (await client.model()));
    }
    case 'none':
      return null;
  }
}

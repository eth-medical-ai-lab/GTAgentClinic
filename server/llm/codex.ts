import { Codex, type CodexOptions, type Usage } from '@openai/codex-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_NPC_MODEL } from '../../shared/llm';
import { codexCostUSD } from './codexPricing';
import { extractJson, type ChatRequest, type ChatResult, type LlmCallUsage, type LlmProvider } from './provider';

/**
 * The program and leading arguments that run Codex itself (not the SDK): the installed CLI through Node,
 * or AGENTCLINIC_CODEX_BIN. Windows cannot start a .js file, so Node runs such an override there
 * (scripts/codex-game.mjs follows the same rule).
 */
export function codexCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { cmd: string; pre: string[] } {
  const override = env.AGENTCLINIC_CODEX_BIN;
  if (override && !(platform === 'win32' && /\.[cm]?js$/i.test(override))) return { cmd: override, pre: [] };
  return { cmd: process.execPath, pre: [override || createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js')] };
}

/** No personal configuration, shell, browsing, plugins, skills, or project instructions. */
export function gameCodexOptions(instructions: string, mcpServers: Record<string, unknown> = {}, platform: NodeJS.Platform = process.platform): CodexOptions {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'CODEX_HOME', 'AGENTCLINIC_CODEX_BIN', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  // The launcher adds the isolation flags the SDK cannot pass. The SDK starts a program without a shell,
  // which on Windows rules out a script: there it starts Node, and Node loads the launcher first (--import).
  const launcher = new URL('../../scripts/codex-game.mjs', import.meta.url);
  if (platform === 'win32') Object.assign(env, { NODE_OPTIONS: `--import=${launcher.href}`, AGENTCLINIC_CODEX_PRELOAD: '1' });
  return {
    codexPathOverride: platform === 'win32' ? process.execPath : fileURLToPath(launcher), env,
    config: {
      model_provider: 'openai', developer_instructions: instructions,
      project_doc_max_bytes: 0, web_search: 'disabled',
      features: { shell_tool: false, unified_exec: false, apply_patch_freeform: false, js_repl: false, collab: false, multi_agent: false, skills: false, plugins: false, connectors: false, hooks: false, codex_hooks: false, plugin_hooks: false },
    },
    configOverrides: [`mcp_servers=${toml(mcpServers)}`],
  };
}

function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function codexUsage(model: string, usage: Usage | null, latencyMs: number): LlmCallUsage | undefined {
  if (!usage) return undefined;
  const cached = usage.cached_input_tokens ?? 0;
  const writes = usage.cache_write_input_tokens ?? 0;
  const tokens = { inputTokens: Math.max(0, usage.input_tokens - cached - writes), outputTokens: usage.output_tokens, cacheReadTokens: cached, cacheWriteTokens: writes };
  // Output already includes reasoning; input includes cache traffic. Count each token once.
  const estimate = codexCostUSD(model, tokens);
  return { model, ...tokens, requests: 1, latencyMs, costUSD: estimate ?? 0,
    costSource: estimate === undefined ? 'unpriced' : 'price-table',
    codexPricedCalls: estimate === undefined ? 0 : 1, codexUnpricedCalls: estimate === undefined ? 1 : 0 };
}

/** OpenAI strict output requires every property; optional fields become nullable. */
export function strictOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(schema);
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const object = node as Record<string, unknown>;
    if (object.type === 'object' && object.properties && typeof object.properties === 'object') {
      const props = object.properties as Record<string, unknown>;
      const required = Array.isArray(object.required) ? object.required : [];
      for (const [name, value] of Object.entries(props)) {
        visit(value);
        if (!required.includes(name)) props[name] = { anyOf: [value, { type: 'null' }] };
      }
      object.required = Object.keys(props);
      object.additionalProperties = false;
    } else Object.values(object).forEach(visit);
  };
  visit(copy);
  return copy;
}

export class CodexProvider implements LlmProvider {
  readonly status;
  private active = new Map<AbortController, string>();
  constructor(private model = CODEX_NPC_MODEL) {
    this.status = { provider: 'codex' as const, label: 'Codex SDK', model, ok: true, detail: 'Uses your saved Codex login. Dollar figures are estimated API-equivalent costs, not subscription charges or remaining allowance.' };
  }
  async chat(req: ChatRequest): Promise<ChatResult> {
    const abort = new AbortController();
    this.active.set(abort, req.key);
    const timer = setTimeout(() => abort.abort(), 90_000);
    const cwd = mkdtempSync(path.join(tmpdir(), 'agentclinic-codex-'));
    const t0 = Date.now();
    try {
      const sdk = new Codex(gameCodexOptions(req.system));
      const thread = sdk.startThread({ model: this.model, workingDirectory: cwd, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', webSearchMode: 'disabled', modelReasoningEffort: 'low' });
      // Fresh isolated turns use the simulation's bounded history, never another NPC's thread.
      const result = await thread.run(JSON.stringify({ history: req.history, message: req.message }), { outputSchema: strictOutputSchema(req.schema), signal: abort.signal });
      const latencyMs = Date.now() - t0;
      return { json: extractJson(result.finalResponse), text: result.finalResponse, latencyMs, usage: codexUsage(this.model, result.usage, latencyMs) };
    } finally {
      clearTimeout(timer);
      this.active.delete(abort);
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  forget(prefix: string) { for (const [abort, key] of this.active) if (key.startsWith(prefix)) abort.abort(); }
  dispose() { for (const abort of this.active.keys()) abort.abort(); }
}

import { modelName, OPENAI_NPC_MODEL, vllmUrl } from '../../shared/llm';
import { strictOutputSchema } from './codex';
import { codexCostUSD as openaiCostUSD } from './codexPricing';
import { extractJson, type ChatRequest, type ChatResult, type LlmCallUsage, type LlmProvider } from './provider';

export interface VllmMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: VllmToolCall[]; tool_call_id?: string }
export interface VllmToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface VllmResponse { model?: string; service_tier?: string | null; choices: { message: VllmMessage }[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } } }

export class VllmClient {
  readonly baseUrl: string;
  constructor(baseUrl = process.env.LOCAL_API_URL ?? 'http://127.0.0.1:8000/v1', private apiKey = process.env.LOCAL_API_KEY) { this.baseUrl = vllmUrl(baseUrl); }
  async request<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`API server returned HTTP ${res.status}. Check the server, model, and tool/structured-output support.`);
    return await res.json() as T;
  }
  async model(requested?: string): Promise<string> {
    const name = modelName(requested ?? process.env.LOCAL_API_MODEL);
    const response = await this.request<{ data: { id: string }[] }>('models');
    return vllmModelFor(response.data?.map((m) => m.id) ?? [], name);
  }
  complete(model: string, messages: VllmMessage[], extra: Record<string, unknown>, signal: AbortSignal) {
    return this.request<VllmResponse>('chat/completions', { model, messages, ...extra }, signal);
  }
}

/**
 * Which served model to run: the one asked for (a shift's pick, else LOCAL_API_MODEL), else
 * the only one served. The title screen's check uses it too (mode.ts vllmFacts), so it never offers a
 * local model as the default that then can't start.
 */
export function vllmModelFor(models: string[], name: string | undefined): string {
  if (name && models.includes(name)) return name;
  if (!name && models.length === 1) return models[0];
  throw new Error(name ? `The API server does not serve model "${name}".` : 'Select a model served by this API.');
}

export function vllmUsage(model: string, response: VllmResponse, latencyMs: number): LlmCallUsage | undefined {
  const u = response.usage;
  if (!u) return undefined;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return { model, inputTokens: Math.max(0, u.prompt_tokens - cached), outputTokens: u.completion_tokens, cacheReadTokens: cached, cacheWriteTokens: 0, costUSD: 0, costSource: 'unpriced', requests: 1, latencyMs };
}

/** OpenAI uses the same Standard API price table as Codex estimates, per request here. */
export function openaiUsage(model: string, response: VllmResponse, latencyMs: number): LlmCallUsage | undefined {
  const usage = vllmUsage(response.model ?? model, response, latencyMs);
  if (!usage) return undefined;
  usage.cacheWriteTokens = response.usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  usage.inputTokens = Math.max(0, usage.inputTokens - usage.cacheWriteTokens);
  // We request Standard. Never price a different returned tier at Standard rates.
  const estimate = !response.service_tier || response.service_tier === 'default' ? openaiCostUSD(usage.model, usage) : undefined;
  return { ...usage, costUSD: estimate ?? 0, costSource: estimate === undefined ? 'unpriced' : 'price-table',
    openaiPricedCalls: estimate === undefined ? 0 : 1, openaiUnpricedCalls: estimate === undefined ? 1 : 0 };
}

export class VllmProvider implements LlmProvider {
  readonly status;
  readonly billing;
  private active = new Map<AbortController, string>();
  constructor(private client: VllmClient, private model: string, source: 'vllm' | 'openai-api' = 'vllm') {
    this.billing = source === 'openai-api' ? 'api' as const : undefined;
    this.status = { provider: source, label: source === 'openai-api' ? 'OpenAI API' : 'Custom API (OpenAI-compatible)', model, ok: true, detail: source === 'openai-api' ? 'Billed to OPENAI_API_KEY. Costs are estimates at Standard API prices.' : 'Runs on your configured API server. Token counts exclude hardware and hosting costs.' };
  }
  async chat(req: ChatRequest): Promise<ChatResult> {
    const abort = new AbortController();
    this.active.set(abort, req.key);
    const start = Date.now();
    try {
      const result = await this.client.complete(this.model, [{ role: 'system', content: req.system }, ...req.history, { role: 'user', content: req.message }], { ...(this.status.provider === 'openai-api' ? { service_tier: 'default' } : {}), max_completion_tokens: 1024, response_format: { type: 'json_schema', json_schema: { name: 'npc_reply', strict: true, schema: strictOutputSchema(req.schema) } } }, abort.signal);
      const text = result.choices?.[0]?.message.content ?? '';
      const latencyMs = Date.now() - start;
      return { text, json: extractJson(text), latencyMs, usage: (this.status.provider === 'openai-api' ? openaiUsage : vllmUsage)(this.model, result, latencyMs) };
    } finally { this.active.delete(abort); }
  }
  forget(prefix: string) { for (const [abort, key] of this.active) if (key.startsWith(prefix)) abort.abort(); }
  dispose() { for (const abort of this.active.keys()) abort.abort(); }
}

/** Keep API keys tied to the selected connection, never to another provider's environment. */
export async function openaiProvider(model = OPENAI_NPC_MODEL): Promise<VllmProvider> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Set OPENAI_API_KEY in the server environment, then restart the game.');
  const client = new VllmClient('https://api.openai.com/v1', key);
  return new VllmProvider(client, await client.model(model), 'openai-api');
}

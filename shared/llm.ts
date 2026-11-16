/** Public, non-secret choices for one shift. Credentials stay on the server. */
export interface NpcSelection {
  source: 'default' | 'claude' | 'codex' | 'openai-api' | 'vllm' | 'offline';
  model?: string;
  claudeMode?: 'claude-code' | 'api';
  baseUrl?: string;
}

export const OPENAI_NPC_MODEL = 'gpt-6-luna';

export const CODEX_NPC_MODEL = 'gpt-6-luna';
export const CODEX_DOCTOR_MODEL = CODEX_NPC_MODEL;
export const CODEX_MODELS = [
  { id: CODEX_NPC_MODEL, label: 'Luna — fast' },
  { id: 'gpt-6.1-sol', label: 'Sol — balanced' },
  { id: 'gpt-6-astra', label: 'Astra — advanced' },
] as const;

export function modelName(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 160 || !/^[\w./:@+-]+$/.test(value)) throw new Error('Enter a model ID (up to 160 characters).');
  return value;
}

export function vllmUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Enter the server URL, for example http://127.0.0.1:8000/v1.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP or HTTPS URL without credentials, query parameters, or fragments.');
  return url.href.replace(/\/$/, '');
}

export function parseNpcSelection(value: unknown): NpcSelection {
  if (value === undefined) return { source: 'default' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NPC selection must be an object.');
  const o = value as Record<string, unknown>;
  if (!['default', 'claude', 'codex', 'openai-api', 'vllm', 'offline'].includes(String(o.source))) throw new Error('Unknown NPC source.');
  const source = o.source as NpcSelection['source'];
  if (source === 'default' || source === 'offline') return { source };
  const model = modelName(o.model);
  if (source === 'claude') {
    if (o.claudeMode !== undefined && o.claudeMode !== 'api' && o.claudeMode !== 'claude-code') throw new Error('Choose Claude Code or the Anthropic API.');
    return { source, model, claudeMode: o.claudeMode === 'api' ? 'api' : 'claude-code' };
  }
  if (source === 'openai-api') return { source, model: model ?? OPENAI_NPC_MODEL };
  return source === 'codex' ? { source, model: model ?? CODEX_NPC_MODEL } : { source, model, baseUrl: o.baseUrl === undefined ? undefined : vllmUrl(o.baseUrl) };
}

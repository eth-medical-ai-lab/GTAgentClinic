import { execFile } from 'node:child_process';
import { parseNpcSelection, type NpcSelection } from '../../shared/llm';
import { AnthropicApiProvider } from './anthropicApi';
import { ClaudeCodeProvider } from './claudeCode';
import { CodexProvider, codexCommand } from './codex';
import { checkClaudeCode, type LlmProvider } from './provider';
import { openaiProvider, VllmClient, VllmProvider } from './vllm';

export async function codexReady(): Promise<void> {
  const { cmd, pre } = codexCommand();
  await new Promise<void>((resolve, reject) => {
    try {
      execFile(cmd, [...pre, 'login', 'status'], { timeout: 10_000, windowsHide: true }, (error) => {
        // (a text code such as ENOENT: Codex never started. A number is its own answer: not signed in)
        if (error && typeof error.code === 'string') reject(cannotStartCodex(error));
        else if (error) reject(new Error('Codex is not signed in. Run `npx codex login` in this folder, then try again.'));
        else resolve();
      });
    } catch (e) {
      reject(cannotStartCodex(e as Error)); // (Windows refuses a .cmd or .bat file at once)
    }
  });
}

function cannotStartCodex(e: Error): Error {
  const bin = process.env.AGENTCLINIC_CODEX_BIN;
  if (!bin) return new Error(`Codex could not be started: ${e.message}`);
  return new Error(`AGENTCLINIC_CODEX_BIN (${bin.slice(0, 200)}) could not be started${process.platform === 'win32' ? ': on Windows it must be an .exe, or a .js or .mjs file' : ''}.`);
}

export function anthropicModel(model?: string): string | undefined {
  const aliases: Record<string, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
  return model ? aliases[model] ?? model : undefined;
}

/** Explicit menu choices authorize this shift only; never write personal configuration. */
export async function selectedProvider(value: unknown): Promise<LlmProvider | null | undefined> {
  const selection = parseNpcSelection(value);
  switch (selection.source) {
    case 'default': return undefined;
    case 'offline': return null;
    case 'codex': await codexReady(); return new CodexProvider(selection.model);
    case 'openai-api': return openaiProvider(selection.model);
    case 'vllm': {
      const client = new VllmClient(selection.baseUrl);
      return new VllmProvider(client, await client.model(selection.model));
    }
    case 'claude': {
      if (selection.claudeMode === 'api') {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY on the server to use the Claude API.');
        return new AnthropicApiProvider(anthropicModel(selection.model));
      }
      const auth = await checkClaudeCode();
      if (!auth.loggedIn) throw new Error('Claude Code is not signed in. Run `claude` and sign in, or select another source.');
      return new ClaudeCodeProvider(auth, selection.model);
    }
  }
}

/** the request comes from this computer (not another one on the network) */
export function isLocalAddress(address?: string): boolean {
  return address === '::1' || address === '::ffff:127.0.0.1' || !!address?.startsWith('127.');
}

export function requireLocalSelection(selection: NpcSelection, address?: string) {
  if (!isLocalAddress(address) && selection.source !== 'default' && selection.source !== 'offline') throw new Error('Only this computer can select a model source.');
}

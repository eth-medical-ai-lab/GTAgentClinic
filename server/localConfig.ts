/**
 * agentclinic.local.json: optional personal settings for one checkout. It is git-ignored and
 * never committed. The server reads it, so `npm start`, `npm run dev`, the MCP server and the
 * agents all see the same settings. The first `npm start` in a terminal writes the player's
 * answer to "who talks for the characters?" here (server/firstRun.ts).
 *
 *   {
 *     "claudeCode": true,   // your choice: NPCs (in auto mode) and "Watch an AI doctor" may run
 *                           // on YOUR Claude Code login. Off by default (see docs/SETUP.md#claude-code)
 *     "codex": true,        // the same for YOUR Codex login as the default on the title screen
 *                           // (Online asks no question). Off by default
 *     "llm": "auto"         // default NPC brain: auto | api | claude-code | offline
 *   }                       // (a --llm flag or AGENTCLINIC_LLM wins over this)
 *
 * Never put a key or token here: an API key belongs in the server's environment (SECURITY.md).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_CONFIG_FILE = 'agentclinic.local.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface LocalConfig {
  /** personal opt-in to the local Claude Code CLI (your claude.ai or Console login) */
  claudeCode?: boolean;
  /** personal opt-in to your Codex login as the default LLM (ChatGPT plan allowance or its API key) */
  codex?: boolean;
  /** default NPC brain when no --llm flag or AGENTCLINIC_LLM is given */
  llm?: string;
}

/** Missing file → {}. A broken file is ignored with one warning, so it can never turn the opt-in on by accident. */
export function readLocalConfig(root = ROOT): LocalConfig {
  const file = path.join(root, LOCAL_CONFIG_FILE);
  if (!existsSync(file)) return {};
  try {
    const j: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('expected a JSON object');
    const o = j as Record<string, unknown>;
    const out: LocalConfig = {};
    if (o.claudeCode === true) out.claudeCode = true;
    if (o.codex === true) out.codex = true;
    if (typeof o.llm === 'string' && o.llm.trim()) out.llm = o.llm.trim().toLowerCase();
    return out;
  } catch (e) {
    console.warn(`[config] ignoring ${LOCAL_CONFIG_FILE}: ${(e as Error).message}`);
    return {};
  }
}

/** The file as it is on disk: missing, a JSON object (`data`), or unreadable (`broken`, never overwritten). */
export type LocalConfigFile = { state: 'missing' } | { state: 'ok'; data: Record<string, unknown> } | { state: 'broken'; error: string };

export function localConfigFile(root = ROOT): LocalConfigFile {
  const file = path.join(root, LOCAL_CONFIG_FILE);
  if (!existsSync(file)) return { state: 'missing' };
  try {
    const j: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { state: 'broken', error: 'expected a JSON object' };
    return { state: 'ok', data: j as Record<string, unknown> };
  } catch (e) {
    return { state: 'broken', error: (e as Error).message };
  }
}

/**
 * Merge `patch` into agentclinic.local.json and write it atomically. Other keys (such as a "//" note)
 * are kept. Throws, without touching the file, when it exists but isn't a JSON object, so a
 * half-edited file is never lost. Returns the file's path.
 */
export function writeLocalConfig(patch: Record<string, unknown>, root = ROOT): string {
  const file = path.join(root, LOCAL_CONFIG_FILE);
  const cur = localConfigFile(root);
  if (cur.state === 'broken') throw new Error(`${LOCAL_CONFIG_FILE} is not valid JSON (${cur.error}); fix or delete it`);
  const next = { ...(cur.state === 'ok' ? cur.data : {}), ...patch };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, file);
  return file;
}

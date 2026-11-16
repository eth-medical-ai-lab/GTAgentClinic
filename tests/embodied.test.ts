import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decision } from '../agents/embodiedControls';
import { ClaudeCodeProvider } from '../server/llm/claudeCode';
import { validateObserve } from '../server/observe';

describe('embodied inputs', () => {
  it('rejects offscreen clicks, unbounded holds and non-game actions', () => {
    for (const action of [{ kind: 'click', x: 1280, y: 100 }, { kind: 'key', key: 'w', ms: 50000 }, { kind: 'order', code: 'cbc' }]) {
      expect(decision.safeParse({ intent: '', inputs: [action], observeAfter: false }).success).toBe(false);
    }
  });
  it('accepts looking now or acting without looking and bounds time across the whole plan', () => {
    const check = (inputs: unknown[], observeAfter: boolean) => decision.safeParse({ inputs, observeAfter, intent: '' }).success;
    expect(check([], true)).toBe(true);
    expect(check([], false)).toBe(false);
    expect(check([{ kind: 'key', key: 'w', ms: 4500 }], false)).toBe(true);
    expect(check([{ kind: 'key', key: 'w', ms: 4500 }, { kind: 'wait', ms: 4500 }], true)).toBe(false);
    expect(check(Array(5).fill({ kind: 'wait', ms: 0 }), true)).toBe(false);
  });
  it('keeps old launch requests clinical and rejects unknown modes', () => {
    const maps = ['night_shift'];
    expect(validateObserve({ agent: 'demo', controlMode: 'embodied' }, maps).ok).toBe(false);
    expect(validateObserve({ agent: 'demo' }, maps)).toMatchObject({ controlMode: 'clinical' });
    expect(validateObserve({ agent: 'claude', controlMode: 'embodied' }, maps)).toMatchObject({ controlMode: 'embodied', camera: 'third', maxTurns: 60 });
    expect(validateObserve({ agent: 'claude', controlMode: 'anything' }, maps).ok).toBe(false);
  });
  it.skipIf(process.platform === 'win32')('sends the viewport as an image block to a tool-free Claude Code process', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'embodied-protocol-'));
    const bin = path.join(dir, 'fake-claude');
    writeFileSync(bin, `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const { message } = JSON.parse(line);
  const args = process.argv.slice(2);
  const ok = message.content[1]?.source?.data === 'image-fixture' && message.content[1]?.type === 'image'
    && args.includes('--tools') && args[args.indexOf('--tools') + 1] === '' && args.includes('--strict-mcp-config');
  console.log(JSON.stringify({type:'result', structured_output:{ok}}));
});
`, { mode: 0o755 });
    vi.stubEnv('AGENTCLINIC_CLAUDE_BIN', bin);
    const p = new ClaudeCodeProvider({ installed: true, loggedIn: true });
    try {
      const r = await p.chat({ key: 'test', system: 'Test', history: [], message: 'Game viewport', screenshot: 'image-fixture', model: 'haiku', schema: { type: 'object' } });
      expect(r.json).toEqual({ ok: true });
    } finally {
      p.dispose();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

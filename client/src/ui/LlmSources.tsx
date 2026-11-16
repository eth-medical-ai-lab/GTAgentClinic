import { useState } from 'react';
import { OPENAI_NPC_MODEL, CODEX_NPC_MODEL, CODEX_MODELS, parseNpcSelection, type NpcSelection } from '../../../shared/llm';

export function savedNpcSelection(): NpcSelection {
  try { return parseNpcSelection(JSON.parse(localStorage.getItem('ac.npc.source') ?? '{"source":"default"}')); }
  catch { return { source: 'default' }; }
}

export async function checkNpc(selection: NpcSelection): Promise<string> {
  const response = await fetch('/api/llm-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selection) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Connection check failed.');
  return `${data.status.label}${data.status.model ? ` · ${data.status.model}` : ''}. Setup checked; the first reply checks generation and output support.`;
}

export function NpcSources({ value, onChange }: { value: NpcSelection; onChange(value: NpcSelection): void }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (next: NpcSelection) => {
    setStatus('');
    onChange(next);
    try { localStorage.setItem('ac.npc.source', JSON.stringify(next)); } catch { /* private mode */ }
  };
  return <section className="npc-sources">
    <h3>NPC connection for this shift</h3>
    <p className="dim">Patients, families, and staff. This choice applies to your next shift, including an AI doctor’s shift.</p>
    <label>NPC source
      <select aria-label="NPC source" value={value.source === 'claude' ? (value.claudeMode === 'api' ? 'anthropic-api' : 'claude-code') : value.source} onChange={(e) => {
        const choice = e.target.value;
        if (choice === 'claude-code' || choice === 'anthropic-api') { change({ source: 'claude', claudeMode: choice === 'anthropic-api' ? 'api' : 'claude-code', model: 'haiku' }); return; }
        if (choice === 'openai-api') { change({ source: 'openai-api', model: OPENAI_NPC_MODEL }); return; }
        const source = choice as NpcSelection['source'];
        change(source === 'codex' ? { source, model: CODEX_NPC_MODEL }  : source === 'vllm' ? { source, baseUrl: 'http://127.0.0.1:8000/v1' } : { source });
      }}>
        <option value="default">Use server default</option>
        <option value="claude-code">Claude Code login</option>
        <option value="anthropic-api">Anthropic API</option>
        <option value="codex">Codex login</option>
        <option value="openai-api">OpenAI API</option>
        <option value="vllm">Custom API (OpenAI-compatible)</option>
        <option value="offline">Scripted (no LLM)</option>
      </select>
    </label>
    {value.source === 'vllm' && <label>NPC server URL<input value={value.baseUrl ?? ''} placeholder="http://127.0.0.1:8000/v1" onChange={(e) => change({ ...value, baseUrl: e.target.value })} /></label>}
    {!['default', 'offline'].includes(value.source) && <label>NPC model
      <input aria-label="NPC model" list={value.source === 'codex' ? 'codex-models' : undefined} value={value.model ?? ''} placeholder={value.source === 'vllm' ? 'Automatic if the server has one model' : 'Model ID'} onChange={(e) => change({ ...value, model: e.target.value })} />
    </label>}
    <datalist id="codex-models">{CODEX_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
    {value.source === 'codex' && <p className="dim">Uses your saved Codex login. Run <code>npx codex login</code> once. A ChatGPT login uses your plan allowance. Dollar costs are estimated API equivalents, not subscription charges.</p>}
    {value.source === 'claude' && <p className="dim">{value.claudeMode === 'api' ? 'Uses ANTHROPIC_API_KEY. API requests are billed separately.' : 'Uses your Claude Code login. Starting a shift authorizes this selection.'}</p>}
    {value.source === 'openai-api' && <p className="dim">Uses OPENAI_API_KEY at https://api.openai.com/v1. API requests are billed separately. Costs are estimated at Standard API prices.</p>}
    {value.source === 'vllm' && <p className="dim">Use any compatible server URL, including its port and API path. If a key is required, set LOCAL_API_KEY in the server environment.</p>}
    <button className="btn small" disabled={busy} onClick={async () => {
      setBusy(true); setStatus('');
      try { setStatus(await checkNpc(value)); } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
    }}>{busy ? 'Checking…' : 'Check NPC connection'}</button>
    {status && <p role="status">{status}</p>}
  </section>;
}

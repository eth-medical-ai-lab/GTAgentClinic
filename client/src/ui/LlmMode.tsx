/** Title-screen connection picker. Editing is local; Apply changes the default for new runs. */
import { useEffect, useRef, useState } from 'react';
import { CODEX_MODELS } from '../../../shared/llm';
import type { LlmStatus } from '../../../shared/types';
import { store, useStore } from '../store';
import { MenuUsage } from './Usage';

type Use = 'api' | 'claude-code' | 'codex' | 'openai-api' | 'vllm' | 'none';
type ConsentUse = 'claude-code' | 'codex';
interface Option {
  ready: boolean;
  use: Use;
  model?: string;
  label?: string;
  hint?: string;
  needsConsent?: boolean;
  plan?: boolean;
}
type Options = Record<'claude' | 'api' | 'codex' | 'openai' | 'vllm' | 'none', Option>;
interface Draft { model: string; baseUrl?: string }
interface Ask extends Draft { use: ConsentUse; label: string; plan?: boolean }
interface LlmModeInfo {
  online: boolean;
  current: Use | null;
  switching: boolean;
  status: LlmStatus;
  canSwitch: boolean;
  options: Options | null;
  custom?: { baseUrl: string; model: string };
}

/** The server is offline (false until the server has said so). Existing runs keep their provider. */
export function useServerOffline(): boolean {
  return useStore((s) => s.online === false);
}

const OPTIONS: { key: keyof Options; name: string }[] = [
  { key: 'claude', name: 'Claude Code login' },
  { key: 'api', name: 'Anthropic API' },
  { key: 'codex', name: 'Codex login' },
  { key: 'openai', name: 'OpenAI API' },
  { key: 'vllm', name: 'Custom API (OpenAI-compatible)' },
  { key: 'none', name: 'No default' },
];
const HELP: Partial<Record<Use, string>> = {
  api: 'Uses ANTHROPIC_API_KEY. API requests are billed separately.',
  'openai-api': 'Uses OPENAI_API_KEY. API requests are billed separately. Costs are estimates at Standard API prices.',
  'claude-code': 'Uses your Claude Code login. Model access depends on your account.',
  codex: 'Uses your Codex login. A ChatGPT login uses your plan allowance; an API key login is billed to that key. Costs are estimated API equivalents.',
  vllm: 'Include the port and API path. If a key is needed, set LOCAL_API_KEY on the server. Leave the model empty only if the server serves one model.',
};

export function LlmModeCard() {
  const connected = useStore((s) => s.connected);
  const llm = useStore((s) => s.llm);
  const online = useStore((s) => s.online);
  const offline = online === false;
  const [info, setInfo] = useState<LlmModeInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<Use | 'offline' | null>(null);
  const [selected, setSelected] = useState<Use | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<Use, Draft>>>({});
  const [asking, setAsking] = useState<Ask | null>(null);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastConnection = useRef<{ use: Use; draft: Draft } | null>(null);
  useEffect(() => {
    if (settingsOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settingsOpen]);
  useEffect(() => {
    if (!info?.online || !info.current || !info.options) return;
    const option = Object.values(info.options).find((o) => o.use === info.current);
    if (option) lastConnection.current = { use: option.use, draft: option.use === 'vllm'
      ? { model: info.custom?.model ?? '', baseUrl: info.custom?.baseUrl ?? '' }
      : { model: option.model ?? '' } };
  }, [info]);
  const closeSettings = () => { if (!busy) { setSettingsOpen(false); setAsking(null); } };
  // A delayed availability response must not overwrite a later switch or another tab's update.
  const requestVersion = useRef(0);

  const load = async (refresh: boolean) => {
    const version = ++requestVersion.current;
    setChecking(true);
    try {
      const r = await fetch(`/api/llm-mode?options=1${refresh ? '&refresh=1' : ''}`);
      const data = r.ok ? await r.json() as LlmModeInfo : null;
      if (data && version === requestVersion.current) setInfo(data);
    } catch { /* reconnect will load the connection list again */ }
    finally { if (version === requestVersion.current) setChecking(false); }
  };
  useEffect(() => { if (connected) void load(false); }, [connected, online, llm]);

  const draftFor = (o: Option): Draft => drafts[o.use] ?? (o.use === 'vllm'
    ? { model: info?.custom?.model ?? '', baseUrl: info?.custom?.baseUrl ?? '' }
    : { model: o.model ?? '' });

  const go = async (want: boolean, use?: Use, draft?: Draft, consent?: ConsentUse) => {
    ++requestVersion.current;
    setChecking(false);
    setError('');
    setBusy(want ? use! : 'offline');
    try {
      const r = await fetch('/api/llm-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        online: want, use, consent, model: draft?.model.trim(), baseUrl: use === 'vllm' ? draft?.baseUrl?.trim() : undefined,
      }) });
      const j = await r.json() as LlmModeInfo & { error?: string; needsConsent?: boolean; ask?: Omit<Ask, 'model'> };
      if (r.ok) {
        setInfo(j);
        setSelected(null);
        setAsking(null);
        setSettingsOpen(false);
        // Drop only the applied draft. Other connections retain their unfinished edits.
        if (use) setDrafts((prev) => { const next = { ...prev }; delete next[use]; return next; });
        store.set({ online: j.online, llm: j.status });
      } else if (j.needsConsent && j.ask && draft) {
        setSelected(use!);
        setAsking({ ...j.ask, ...draft });
        setSettingsOpen(true);
      }
      else {
        setAsking(null);
        setSettingsOpen(true);
        setError(j.error ?? `The server said HTTP ${r.status}.`);
        void load(true);
      }
    } catch { setSettingsOpen(true); setError('Could not reach the server. Is the game still running?'); }
    finally { setBusy(null); }
  };
  const pick = (o: Option) => {
    setError('');
    setAsking(null);
    if (o.use === 'none') void go(true, 'none');
    else setSelected(o.use);
  };
  const apply = (o: Option, draft: Draft) => {
    if (o.needsConsent && (o.use === 'claude-code' || o.use === 'codex')) {
      setAsking({ ...draft, use: o.use, label: o.label ?? '', plan: o.plan });
    } else void go(true, o.use, draft);
  };
  const canSwitch = connected && !!info?.canSwitch;
  const tone = !connected || !llm || offline ? 'warn' : llm.ok ? 'ok' : 'bad';
  const title = !connected ? 'Connecting to server…' : !llm ? '…' : offline ? 'Offline · no LLM for new shifts' : info?.current === 'none' ? 'Online · no default LLM' : `Online · ${llm.label}`;

  const goOnline = () => {
    const previous = lastConnection.current;
    const option = info?.options && Object.values(info.options).find((o) => o.use === previous?.use);
    if (!previous || !option?.ready || option.needsConsent) {
      setSettingsOpen(true);
      return;
    }
    void go(true, previous.use, previous.draft);
  };
  const source = info?.options && OPTIONS.find(({ key }) => info.options![key].use === info.current)?.name;

  return <>
    <div className={`menu-llm llm-summary ${tone}`}>
      <div className="llm-mode-head">
        <strong>AI dialogue <small>(default for server)</small></strong>
        <div className="seg llm-toggle" role="group" aria-label="AI dialogue mode">
          <button className={offline ? 'on' : ''} aria-pressed={offline} disabled={!canSwitch || !!busy || !!info?.switching || offline} onClick={() => void go(false)}>Offline</button>
          <button className={online ? 'on' : ''} aria-pressed={!!online} disabled={!canSwitch || !!busy || !!info?.switching || !!online} onClick={goOnline}>Online</button>
        </div>
      </div>
      <div className="llm-mode-head">
        <span>{!connected ? 'Connecting to server…' : !info ? 'Checking connections…' : offline ? 'Scripted NPCs · no LLM'
          : info.current === 'none' ? 'No default · choose a connection for your shift' : `${source ?? llm?.label ?? ''}${llm?.model ? ` · ${llm.model}` : ''}`}</span>
        <button className="btn small" disabled={!connected || !!busy} onClick={() => setSettingsOpen(true)}>Change…</button>
      </div>
    </div>
    <dialog ref={dialog} className={`save-dialog menu-llm llm-mode llm-dialog ${tone}`} aria-labelledby="llm-dialog-title"
      onCancel={(e) => { e.preventDefault(); closeSettings(); }} onKeyDown={(e) => e.stopPropagation()}>
      <div className="slots-head">
        <h2 id="llm-dialog-title">AI connections</h2>
        <button className="btn small" disabled={!!busy} onClick={closeSettings}>Close</button>
      </div>
      <strong>{title}</strong>
    <span>{offline ? 'New shifts use scripted NPCs. Choose a connection below to go online.' : info?.current === 'none'
      ? 'NPCs stay scripted unless you select a connection for the shift.'
      : `${llm?.model ?? ''}${llm?.model ? ' · ' : ''}${llm?.detail ?? ''}`}</span>
    <span className="menu-llm-change">Changes apply to new shifts. Running shifts keep their connection.</span>
    {info?.options && <>
      <span className="menu-llm-change">Default connection</span>
      <ul className="llm-options" aria-label="Default connection">
        {OPTIONS.map(({ key, name }) => {
          const o = info.options![key];
          const isDefault = !offline && info.current === o.use;
          const open = selected === o.use;
          const draft = draftFor(o);
          const editable = canSwitch && !busy && !info.switching;
          return <li key={key} className={o.ready ? 'ok' : ''}>
            <span className="llm-mark" aria-hidden>{o.ready ? '✓' : '–'}</span>
            <b>{name}</b>
            <span className="llm-what" title={o.ready ? o.label : o.hint}>{isDefault ? 'Current default' : o.ready ? o.label ?? 'Ready' : o.hint}</span>
            {canSwitch && (isDefault && o.use === 'none' ? <span className="llm-tag">default</span> : <button
              className="btn small llm-use" disabled={!editable || o.use === 'none' && !o.ready}
              aria-label={`${isDefault ? 'Edit' : 'Use'} ${name}`} aria-expanded={o.use === 'none' ? undefined : open}
              aria-controls={o.use === 'none' ? undefined : `llm-settings-${o.use}`} onClick={() => pick(o)}
            >{isDefault ? 'Edit' : 'Use'}</button>)}
            {open && <form className="llm-settings" id={`llm-settings-${o.use}`} aria-label={`${name} settings`} onSubmit={(e) => { e.preventDefault(); if (!busy && !asking && (o.ready || o.use === 'vllm')) apply(o, draft); }}>
              {o.use === 'vllm' && <label className="llm-model">Server URL
                <input aria-label="Default custom API URL" type="url" autoFocus required value={draft.baseUrl ?? ''} placeholder="http://127.0.0.1:8000/v1" disabled={!!busy || !!asking}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [o.use]: { ...draft, baseUrl: e.target.value } }))} />
              </label>}
              <label className="llm-model">Model
                <input aria-label={`Default ${name} model`} autoFocus={o.use !== 'vllm'} list={o.use === 'codex' ? 'default-codex-models' : undefined}
                  value={draft.model} placeholder={o.use === 'vllm' ? 'Auto if the server has one model' : 'Server default'} disabled={!!busy || !!asking}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [o.use]: { ...draft, model: e.target.value } }))} />
              </label>
              <p className="dim">{HELP[o.use]}</p>
              {!o.ready && <p className="dim">{o.hint}</p>}
              {asking ? <div className="llm-consent" role="dialog" aria-label={`Use your ${asking.use === 'codex' ? 'Codex' : 'Claude Code'} login?`}>
                <b>Use your {asking.use === 'codex' ? 'Codex' : 'Claude Code'} login?</b>
                <span>Model: {asking.model || 'server default'}. {asking.use === 'codex'
                  ? 'A ChatGPT login uses your plan allowance. An API key login is billed to that key.'
                  : asking.plan ? 'This uses your Claude plan allowance.' : 'This is billed to the account Claude Code is logged in with.'} For you on this computer only. Do not host the game for others with this login. Consent lasts for this server run.</span>
                <div className="llm-consent-btns">
                  <button type="button" className="btn small primary" disabled={!!busy} onClick={() => void go(true, asking.use, asking, asking.use)}>{busy ? 'Switching…' : 'Use my login'}</button>
                  <button type="button" className="btn small" disabled={!!busy} onClick={() => setAsking(null)}>Not now</button>
                </div>
              </div> : <div className="llm-consent-btns">
                <button className="btn small primary" disabled={!!busy || !o.ready && o.use !== 'vllm' || o.use === 'vllm' && !draft.baseUrl?.trim()}>{busy === o.use ? 'Checking…' : offline ? 'Apply and go online' : 'Apply'}</button>
                <button type="button" className="btn small" disabled={!!busy} onClick={() => { setSelected(null); setError(''); }}>Cancel</button>
              </div>}
              <p className="dim">Settings last until the game server restarts. Setup checks do not send a chat request or prove model access.</p>
            </form>}
          </li>;
        })}
      </ul>
      <datalist id="default-codex-models">{CODEX_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
    </>}
    {canSwitch && <button className="btn small llm-recheck" disabled={checking || !!busy} onClick={() => void load(true)} title="Check logins, keys and the configured custom API again. Restart after changing environment variables.">{checking ? 'Checking…' : 'Check again'}</button>}
    {!info && connected && <span className="dim">Checking available connections…</span>}
    {online && <MenuUsage />}
    {error && <span className="llm-error" role="alert">{error}</span>}
    {info && !info.canSwitch && <span className="dim">Only the computer running the game can change connections.</span>}
    </dialog>
  </>;
}

/**
 * Main-menu card: launch an AI resident (POST /api/observe) and watch its shift in 3D.
 * Claude runs on the player's own Claude Code login, only with the personal opt-in (docs/SETUP.md#claude-code);
 * the scripted demo is free.
 */
import { useEffect, useState } from 'react';
import { client } from '../net';
import { store, useStore } from '../store';
import { enterGameFullscreen, leaveGameFullscreen } from './fullscreen';
import { CODEX_DOCTOR_MODEL, type NpcSelection } from '../../../shared/llm';
import './observer.css';

type Agent = 'claude' | 'demo' | 'codex' | 'vllm';
type Model = string;
interface Running {
  sessionId: string;
  controlMode?: 'clinical' | 'embodied';
  agent: Agent;
  model?: Model;
  mapId: string;
  state: string;
}

const MODELS: { id: Model; label: string; hint: string }[] = [
  { id: 'haiku', label: 'Haiku', hint: 'fastest, lightest on your plan' },
  { id: 'sonnet', label: 'Sonnet', hint: 'balanced (default)' },
  { id: 'opus', label: 'Opus', hint: 'most careful reasoning, uses the most of your plan' },
];

function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

function watch(sessionId: string, mode?: Running['controlMode']) {
  if (mode === 'embodied') {
    location.assign('/?embodied=' + encodeURIComponent(sessionId));
    return;
  }
  store.set({ camera: 'third' });
  client.watch(sessionId);
}

export function WatchAiCard({ defaultMap, npc }: { defaultMap?: string; npc?: NpcSelection }) {
  const maps = useStore((s) => s.maps);
  const connected = useStore((s) => s.connected);
  const [mapId, setMapId] = useState(() => load('ac.watch.map', defaultMap ?? 'night_shift'));
  const [clinicalAgent, setClinicalAgent] = useState<Agent>(() => load('ac.watch.agent', 'claude'));
  const [model, setModel] = useState<Model>(() => load('ac.watch.model', 'sonnet'));
  const [codexModel, setCodexModel] = useState(() => load('ac.watch.codexModel', CODEX_DOCTOR_MODEL));
  const [localModel, setLocalModel] = useState(() => load('ac.watch.localModel', ''));
  const [baseUrl, setBaseUrl] = useState(() => load('ac.watch.baseUrl', 'http://127.0.0.1:8000/v1'));
  const [consent, setConsent] = useState(false);
  const [controlMode, setControlMode] = useState<'clinical' | 'embodied'>('embodied');
  const [camera, setCamera] = useState<'third' | 'first'>('third');
  // an offline server (no LLM anywhere): only the scripted demo plays, in clinical actions
  const offline = useStore((s) => s.online === false);
  // (until the server says whether it is online, a fast click would ask an offline server for Claude)
  const llmKnown = useStore((s) => !!s.llm);
  const embodied = !offline && controlMode === 'embodied';
  // the mode the card shows (offline: always clinical), which is what gets sent
  const shownMode: 'clinical' | 'embodied' = embodied ? 'embodied' : 'clinical';
  const agent = offline ? 'demo' : embodied ? 'claude' : clinicalAgent;
  const shifts = maps.filter(m => m.kind !== 'practice' && (agent !== 'demo' || !m.kind));
  const practice = agent === 'demo' ? [] : maps.filter(m => m.kind === 'practice');
  const selectedMap = [...shifts, ...practice].some(m => m.id === mapId) ? mapId : shifts[0]?.id ?? 'night_shift';
  const [api, setApi] = useState(false);
  const [seed, setSeed] = useState('');
  const [turns, setTurns] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  // is the personal Claude Code opt-in on? (GET /api/observe; off by default)
  const [claude, setClaude] = useState<{ allowed: boolean; note?: string } | null>(null);

  // is an AI doctor already on shift? (at most one at a time)
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = (await (await fetch('/api/observe')).json()) as { running: boolean; embodiedApi?: boolean; current?: Running | null; claude?: { allowed: boolean; note?: string } };
        if (alive) setApi(!!j.embodiedApi);
        if (alive) setRunning(j.running && j.current ? j.current : null);
        // (the note too: going Online without the opt-in keeps allowed false but changes why)
        if (alive && j.claude) setClaude((c) => (c?.allowed === j.claude!.allowed && c?.note === j.claude!.note ? c : j.claude!));
      } catch {
        /* offline */
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected]);

  // without the opt-in, start on the free demo (once, when we learn it; the player can still pick Claude to read why)
  useEffect(() => {
    if (claude && !claude.allowed) setClinicalAgent((a) => a === 'claude' ? 'demo' : a);
  }, [claude]);

  const start = async () => {
    enterGameFullscreen(); // the click is the user gesture; back out below if the shift can't start
    setBusy(true);
    setError(null);
    save('ac.watch.map', selectedMap);
    if (!embodied) save('ac.watch.agent', clinicalAgent);
    save('ac.watch.model', model);
    save('ac.watch.codexModel', codexModel);
    save('ac.watch.localModel', localModel);
    save('ac.watch.baseUrl', baseUrl);
    try {
      const r = await fetch('/api/observe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapId: selectedMap, agent, controlMode: shownMode, ...(embodied ? { seed, maxTurns: turns, camera } : {}), model: agent === 'claude' ? model : agent === 'codex' ? codexModel : agent === 'vllm' ? localModel : undefined, baseUrl: agent === 'vllm' ? baseUrl : undefined, npc: agent === 'demo' && npc?.source === 'default' ? undefined : npc, claudeConsent: consent }) });
      const j = (await r.json()) as { sessionId?: string; error?: string };
      if (r.ok && j.sessionId) watch(j.sessionId, shownMode);
      else {
        leaveGameFullscreen();
        setError(j.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      leaveGameFullscreen();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await fetch('/api/observe', { method: 'DELETE' }).catch(() => undefined);
    setRunning(null);
  };

  const mapTitle = (id: string) => maps.find((m) => m.id === id)?.title ?? id;

  return (
    <section className="watch-ai">
      <h3>Watch an AI doctor</h3>
      <p>Watch the doctor navigate the ED and care for patients. Both modes receive a shift debrief.</p>
      {running ? (
        <div className="now">
          <span>
            On shift now: <b>{running.agent === 'demo' ? 'Scripted demo' : `${running.agent} ${running.model ?? ''}`}</b> · {running.controlMode === 'embodied' ? 'Embodied' : 'Clinical actions'} · {mapTitle(running.mapId)}
          </span>
          <button
            className="btn small primary"
            onClick={() => {
              enterGameFullscreen();
              watch(running.sessionId, running.controlMode);
            }}
          >
            Watch
          </button>
          <button className="btn small" onClick={() => void stop()}>
            Stop
          </button>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Controls">
            Controls
            <div className="seg">
              <button aria-pressed={!embodied} className={!embodied ? 'on' : ''} onClick={() => setControlMode('clinical')}>Clinical actions</button>
              <button aria-pressed={embodied} className={embodied ? 'on' : ''} disabled={offline} title={offline ? 'Embodied runs on Claude: needs an online server' : undefined} onClick={() => setControlMode('embodied')}>Embodied</button>
            </div>
          </div>
          <p>{embodied ? 'Watch the same screen the model sees as it walks with WASD, speaks at the bedside and uses the EHR on screen.' : 'The doctor reads a text observation and selects clinical actions. Follow it on the floor as a medical student.'}</p>
          <label>
            Shift
            <select aria-label="Shift" value={selectedMap} onChange={(e) => setMapId(e.target.value)}>
              <optgroup label="Shifts">{shifts.map(m => <option key={m.id} value={m.id}>{m.title} ({m.difficulty})</option>)}</optgroup>
              {practice.length > 0 && <optgroup label="Single case practice">{practice.map(m => <option key={m.id} value={m.id}>{m.title} ({m.difficulty})</option>)}</optgroup>}
            </select>
          </label>
          {!embodied && <div role="group" aria-label="AI doctor">
            AI doctor
            <div className="seg">
              <button className={agent === 'claude' ? 'on' : ''} disabled={offline} title={offline ? 'Needs an online server' : undefined} onClick={() => setClinicalAgent('claude')}>
                Claude
              </button>
              <button className={agent === 'demo' ? 'on' : ''} onClick={() => setClinicalAgent('demo')}>
                Scripted demo
              </button>
              <button className={agent === 'codex' ? 'on' : ''} disabled={offline} title={offline ? 'Needs an online server' : undefined} onClick={() => setClinicalAgent('codex')}>Codex SDK</button>
              <button className={agent === 'vllm' ? 'on' : ''} disabled={offline} title={offline ? 'Needs an online server' : undefined} onClick={() => setClinicalAgent('vllm')}>Local (vLLM)</button>
            </div>
          </div>}
          {agent === 'claude' && <div role="group" aria-label="Model">
            {embodied ? 'Claude model' : 'Model'}
            <div className="seg">
              {MODELS.map((m) => (
                <button key={m.id} className={agent === 'claude' && model === m.id ? 'on' : ''} disabled={agent !== 'claude'} title={m.hint} onClick={() => setModel(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>}
          {agent === 'codex' && <label>Physician model<input list="codex-models" value={codexModel} onChange={(e) => setCodexModel(e.target.value)} /></label>}
          {agent === 'vllm' && <>
            <label>Physician vLLM URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
            <label>Physician model<input value={localModel} placeholder="Automatic if the server has one model" onChange={(e) => setLocalModel(e.target.value)} /></label>
          </>}
          {agent === 'claude' && !(embodied && api) && !claude?.allowed && <label className="row"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Use my Claude Code login for this physician.</label>}
          {embodied && <div role="group" aria-label="Starting camera">
            Starting camera
            <div className="seg">
              <button aria-pressed={camera === 'third'} className={camera === 'third' ? 'on' : ''} onClick={() => setCamera('third')}>Over-the-shoulder</button>
              <button aria-pressed={camera === 'first'} className={camera === 'first' ? 'on' : ''} onClick={() => setCamera('first')}>First-person</button>
            </div>
          </div>}
          {embodied && <div className="embodied-config">
            <label>Case seed<input type="number" min="0" max="2147483648" placeholder="Random" value={seed} onChange={e => setSeed(e.target.value)} /></label>
            <label>Turn limit<input type="number" min="5" max="400" value={turns} onChange={e => setTurns(Number(e.target.value))} /></label>
          </div>}
          {offline && <div className="watch-offline" role="status">⚠ This server is offline (no LLM), so only the scripted demo can play, on its own fixed shift. Switch to Online (top right) for Claude, Codex or a local model.</div>}
          {/* (offline: the warning above says it all; the demo's note about NPC choices doesn't apply) */}
          {!offline && <div className="note">
            {embodied && api ? 'Uses your configured Anthropic API. The doctor decides when to request a screenshot.' : embodied && (claude?.allowed || consent) ? 'Uses your Claude Code login. The doctor decides when to request a screenshot.' : agent === 'codex' ? 'Uses the Codex SDK and your Codex login. Sol is the balanced default. Run npx codex login once. NPCs use the separate selection above.' : agent === 'vllm' ? 'Uses the selected vLLM model with hospital tools. Enable tool calling on your vLLM server. NPCs use the separate selection above.' : agent === 'claude' && claude && !claude.allowed && !consent
              ? claude.note
              : agent === 'claude'
              ? 'Claude plays on your own Claude Code login (your personal opt-in; plan usage, or your API key if ANTHROPIC_API_KEY is set); it needs `claude` installed and logged in. A shift takes 10–30 minutes of real time; the HUD shows its token use.'
              : 'A scripted reference walkthrough. NPCs stay offline with the server-default selection; an explicit NPC choice uses that source.'}
          </div>}
          <button className="btn primary" disabled={!connected || !llmKnown || busy || (embodied && !api && !claude?.allowed && !consent)} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Watch the AI doctor →'}
          </button>
        </>
      )}
      {error && <div className="err">{error}</div>}
    </section>
  );
}

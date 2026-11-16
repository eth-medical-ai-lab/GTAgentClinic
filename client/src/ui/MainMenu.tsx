import { useEffect, useState } from 'react';
import type { CameraMode, UnitSystem } from '../../../shared/types';
import { client } from '../net';
import { store, useStore } from '../store';
import { autoFullscreen, enterGameFullscreen, leaveGameFullscreen, setAutoFullscreen } from './fullscreen';
import { LlmModeCard, useServerOffline } from './LlmMode';
import { WatchAiCard } from './WatchAi';
import { NpcSources, savedNpcSelection, checkNpc } from './LlmSources';
import { PracticePicker } from './PracticePicker';
import { Wordmark } from './Wordmark';
import { ecgPath } from './ecgWave';
import { QUALITIES, preferredQuality, saveQuality } from '../world/render/quality';
import { beginStartupLook, cancelStartupLook } from '../startupLook';

/** the menu's monitor trace: three smooth beats across the top (ecgWave.ts) */
const MENU_ECG = ecgPath(3, 400, 70, 56);

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

export function MainMenu() {
  const continuing = useStore(s => s.continuing);
  const maps = useStore((s) => s.maps);
  const connected = useStore((s) => s.connected);
  const ttsMode = useStore((s) => s.tts);
  const ttsNote = useStore((s) => s.ttsNote);
  const [fullscreen, setFullscreen] = useState(autoFullscreen);
  const [name, setName] = useState(() => load('ac.name', 'Dr. Resident'));
  const [mapId, setMapId] = useState(() => load('ac.map', 'orientation'));
  const [camera, setCamera] = useState<CameraMode>(() => load('ac.camera', 'first'));
  const [quality, setQuality] = useState(preferredQuality);
  const [units, setUnits] = useState<UnitSystem>(() => load('ac.units', 'US'));
  const [tts, setTts] = useState(() => load('ac.tts', false));
  const [seed, setSeed] = useState('');
  const [savedNpc, setNpc] = useState(savedNpcSelection);
  // an offline server has no LLM anywhere: the saved NPC choice waits (kept) until it is online again
  const offline = useServerOffline();
  const npc = offline ? { source: 'default' as const } : savedNpc;
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const cases = maps.filter(m => m.kind === 'practice');
  const current = maps.find(m => m.id === mapId);
  const sel = current ?? (mapId === 'practice' ? undefined : maps[0]);


  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('map')) setMapId(p.get('map')!);
    if (p.get('seed')) setSeed(p.get('seed')!);
  }, []);

  const start = async () => {
    if (!sel) return;
    setStarting(true);
    setStartError('');
    if (camera !== 'top') beginStartupLook();
    else cancelStartupLook();
    enterGameFullscreen(); // preserve the click gesture before an asynchronous connection check
    try {
      if (npc.source !== 'default') await checkNpc(npc);
      save('ac.name', name);
      save('ac.map', sel.id);
      save('ac.camera', camera);
      save('ac.units', units);
      save('ac.tts', tts);
      store.set({ camera });
      client.start(sel.id, name.trim() || 'Resident', { units, tts }, seed ? Number(seed) : undefined, npc, continuing);
    } catch (error) { cancelStartupLook(); leaveGameFullscreen(); setStartError((error as Error).message); }
    finally { setStarting(false); }
  };

  return (
    <div className="menu">
      <svg className="menu-ecg" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden>
        <path d={MENU_ECG} pathLength={2400} />
      </svg>
      <div className="menu-inner">
        <header className="menu-head">
          <div className="menu-logo">
            <div>
              <h1 className="menu-title">
                <Wordmark className="menu-wordmark" pulse={false} />
              </h1>
              <p>A 3D embodied hospital environment for AI and human agents</p>
              <p className="menu-disclaimer"><strong>Experimental version:</strong> Clinical cases have not yet been validated by clinical experts. Case content and scoring may contain errors.</p>
            </div>
          </div>
          {/* online/offline: what it means, the switch, and what each LLM still needs (LlmMode.tsx) */}
          <div className="menu-connection"><LlmModeCard /></div>
        </header>

        <div className="menu-grid">
          <section className="menu-maps">
            <div className="slots-head"><h2>Choose a shift</h2>
              <button className="btn" disabled={!connected} onClick={() => client.openSlots('load')}>Load game</button>
            </div>
            {continuing && <button className="btn small" onClick={() => store.set({ continuing: false })}>Start a new rotation instead</button>}
            {cases.length > 0 && <button className={`map-card practice-card ${current?.kind === 'practice' ? 'on' : ''}`}
              aria-haspopup="dialog" onClick={() => setPickerOpen(true)}>
              <div className="map-top"><span className="dim">One patient · {cases.length} cases</span></div>
              <h3>Single case practice</h3>
              <p>{current?.kind === 'practice' ? current.title : 'Choose a case…'}</p>
            </button>}
            {pickerOpen && <PracticePicker cases={cases} selected={current?.id} onClose={() => setPickerOpen(false)}
              onChoose={id => { setMapId(id); setPickerOpen(false); }} />}
            {maps.filter(m => m.kind !== 'practice').map((m) => (
              <button key={m.id} className={`map-card ${sel?.id === m.id ? 'on' : ''}`} onClick={() => setMapId(m.id)}>
                <div className="map-top">
                  <span className={`diff ${m.difficulty}`}>{m.difficulty}</span>
                  <span className="dim">
                    {m.shiftStart} · {Math.round(m.durationMin / 60)} h · {m.patients} patients
                  </span>
                </div>
                <h3>{m.title}</h3>
                <p>{m.description}</p>
                {sel?.id === m.id && (
                  <ul>
                    {m.learningGoals.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                )}
              </button>
            ))}

          </section>

          <section className="menu-settings">
            <h2>You</h2>
            <label>
              Name on your badge
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </label>
            <label>
              Camera
              <div className="seg">
                {(['first', 'third', 'top'] as CameraMode[]).map((c) => (
                  <button key={c} className={camera === c ? 'on' : ''} onClick={() => setCamera(c)}>
                    {c === 'first' ? 'First-person' : c === 'third' ? 'Over-the-shoulder' : 'Top-down'}
                  </button>
                ))}
              </div>
            </label>
            <label>
              Graphics quality{quality === null && <span className="dim">Automatic until you select a level</span>}
              <div className="seg" role="group" aria-label="Graphics quality">
                {QUALITIES.map((q) => (
                  <button key={q} className={quality === q ? 'on' : ''} aria-label={q[0].toUpperCase() + q.slice(1)} aria-pressed={quality === q} onClick={() => {
                    saveQuality(q);
                    setQuality(q);
                    const url = new URL(location.href);
                    if (url.searchParams.has('quality')) {
                      url.searchParams.set('quality', q);
                      history.replaceState(history.state, '', url);
                    }
                  }}>
                    {q[0].toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </label>
            <label>
              Lab units
              <div className="seg">
                {(['US', 'SI'] as UnitSystem[]).map((u) => (
                  <button key={u} className={units === u ? 'on' : ''} onClick={() => setUnits(u)}>
                    {u === 'US' ? 'US conventional' : 'SI (mmol/L, µmol/L)'}
                  </button>
                ))}
              </div>
            </label>
            <label className="row" title={ttsNote}>
              <input type="checkbox" checked={tts} onChange={(e) => setTts(e.target.checked)} /> Read NPC lines aloud{' '}
              {ttsMode === 'browser' ? '(your browser’s voices)' : ttsMode === 'off' ? '(voices are off on this server: --tts off)' : '(neural voices; browser voice while the model loads)'}
            </label>
            {ttsNote && <div className="menu-hint dim">{ttsNote}</div>}
            <label className="row" title="Holding Esc leaves full screen; a short Esc still closes panels and frees the mouse (Chrome, Edge). Other browsers leave full screen on Esc.">
              <input
                type="checkbox"
                checked={fullscreen}
                onChange={(e) => {
                  setFullscreen(e.target.checked);
                  setAutoFullscreen(e.target.checked);
                }}
              />{' '}
              Full screen when the shift starts (hold Esc to leave)
            </label>
            <label>
              Seed <span className="dim">(optional — same seed = same shift)</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="random" />
            </label>
            {offline ? (
              <section className="npc-sources">
                <h3>NPC dialogue</h3>
                <p className="dim">Scripted replies (no LLM). Switch to Online above to choose an NPC source.</p>
              </section>
            ) : (
              <NpcSources value={npc} onChange={setNpc} />
            )}
            {startError && <p className="err" role="alert">{startError}</p>}
            <button className="btn primary start" disabled={!connected || !sel || starting} onClick={() => void start()}>
              {starting ? 'Checking connection…' : continuing ? 'Start next shift →' : 'New game →'}
            </button>
            <WatchAiCard defaultMap={sel?.id} npc={npc} />
            <div className="menu-agents dim">
              <b>AI doctors welcome.</b> The same shift is available to agents over HTTP (<code>POST /api/sessions</code>) and MCP (<code>npm run mcp</code>); open <code>/?spectate=&lt;sessionId&gt;</code> to watch one play in 3D, or run <code>npm run agent:claude -- --pace 1.5</code>.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

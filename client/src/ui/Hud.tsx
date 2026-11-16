import { useEffect, useState } from 'react';
import { LAYOUTS } from '../../../shared/layout';
import { locationLabel } from '../../../shared/floors';
import { clockAt, dischargeStatus, lengthOfStay, type PageView } from '../../../shared/types';
import { client } from '../net';
import { QUALITIES, activeQuality, preferredQuality, saveQuality, type Quality } from '../world/render/quality';
import { store, useStore } from '../store';
import { AmbientButton } from './AmbientButton';
import { RotationHud } from './RotationHud';
import { UsageChip } from './Usage';
import { browserDemo, touchTour } from '../demo/mode';

const SPEEDS = [1, 3, 6, 12, 24];

export function Hud() {
  const view = useStore((s) => s.view);
  const prompt = useStore((s) => s.prompt);
  const panel = useStore((s) => s.panel);
  const tabletMin = useStore((s) => s.tabletMin);
  const goal = useStore(s => s.rotation.goal);
  const solo = useStore(s => s.solo);
  const camera = useStore((s) => s.camera);
  const cameraLabel = camera === 'first' ? 'First-person' : camera === 'third' ? 'Third-person' : 'Top-down';
  const toasts = useStore((s) => s.toasts);
  const ttsNote = useStore((s) => s.ttsNote);
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!view) return null;
  const clock = clockAt(view.clockStart, view.t);
  const progress = Math.min(1, view.t / (view.durationMin * 60));
  const st = view.settings;
  // "Floor 2 · Nurses' station" upstairs (shared/floors.ts), the room's own label downstairs
  const room = locationLabel(LAYOUTS[view.layoutId], view.player.location);
  const unread = view.pages.filter((p) => !p.read);
  const llm = view.llm;
  const allDispo = view.board.length > 0 && view.board.every((r) => r.dispo || r.flowStatus === 'Departed');
  // watching an AI doctor: its clock and its shift — no time controls or End shift here (the feed panel has Stop)
  const observing = view.driver?.kind === 'agent';
  // escalated to the attending: she is walking over (the chip goes once she is at the bedside)
  const coming = view.escalations?.findLast((e) => e.status === 'en_route');

  return (
    <div className="hud">
      {coming && (
        <div className="esc-chip" role="status" title={`Escalated at ${clockAt(view.clockStart, coming.t)}${coming.reason ? `: ${coming.reason}` : ''}`}>
          <span className="esc-dot" />
          🆘 {coming.attendingName.startsWith('Dr.') ? `Dr. ${coming.attendingName.split(' ').slice(-1)[0]}` : coming.attendingName} → {coming.bedLabel} · on her way
        </div>
      )}
      {/* top-left: clock & time controls */}
      <div className="hud-clock panel">
        <div className="hud-clock-row">
          <span className="hud-time mono">{clock}</span>
          <div className="hud-map">
            <div className="hud-map-title">{view.mapTitle}</div>
            {!browserDemo && <div className="hud-progress">
              <div style={{ width: `${progress * 100}%` }} />
            </div>}
          </div>
        </div>
        {!browserDemo && <div className="hud-speed" style={observing ? { display: 'none' } : undefined}>
          <button className={`btn small ${st.paused ? 'primary' : ''}`} title="Pause (P)" onClick={() => client.settings({ paused: !st.paused })}>
            {st.paused ? '▶ Resume' : '⏸'}
          </button>
          {SPEEDS.map((x) => (
            <button key={x} className={`btn small ${!st.paused && st.timeScale === x ? 'primary' : ''}`} onClick={() => client.settings({ timeScale: x, paused: false })}>
              {x}×
            </button>
          ))}
          <button className="btn small" title="Skip ahead 10 game minutes" onClick={() => client.act({ type: 'wait', minutes: 10 })}>
            +10 min
          </button>
        </div>}
        {solo && !observing && view.rosterCapacity && <div className="hud-intake">
          <span>{view.rosterCapacity.occupied}/{view.rosterCapacity.beds} occupied · {view.rosterCapacity.approaching} arriving</span>
          <button className="btn small" disabled={!view.rosterCapacity.canAdd}
            title={view.rosterCapacity.canAdd ? 'Place the next patient on a free stretcher immediately' : 'No free stretcher or remaining patient'}
            onClick={() => client.act({ type: 'add_roster_patient' })}>+ Patient</button>
        </div>}
        {solo && goal?.map === view.mapId && <div className="rotation-goal">Practice goal · {goal.label}</div>}
        <div className="hud-sub dim">
          📍 {observing ? 'AI resident: ' : ''}{room}
          {st.focusSlowdown && view.player.focus ? ' · clock slowed while focused' : ''}
          {/* (first person never draws the mask: it sits below the view; this says you wear one) */}
          {view.player.masked && !observing && (
            <span className="hud-mask" title="A surgical mask on. M takes it off (into the bin); a fresh one next time.">
              {' '}· 😷 Mask on · <kbd>M</kbd> off
            </span>
          )}
          {view.player.gloved && !observing && (
            <span className="hud-mask" title="Non-sterile gloves on. G takes them off inside out (into the bin); a fresh pair next time, and clean your hands after.">
              {' '}· 🧤 Gloves on · <kbd>G</kbd> off
            </span>
          )}
        </div>
      </div>

      {/* top-right: status + settings */}
      <div className="hud-right panel">
        {/* the Claude Code brain is named on its usage chip ("◆ Claude Code · Haiku · …"), shown from the start */}
        {!browserDemo && !(llm.provider === 'claude-code' && view.usage?.provider === 'claude-code') && (
          <span className={`llm-chip ${llm.ok ? (llm.provider === 'offline' ? 'warn' : 'ok') : 'bad'}`} title={[llm.model, llm.detail].filter(Boolean).join(' · ')}>
            {llm.provider === 'offline' ? '◌ Offline NPCs' : `● ${llm.label}`}
          </span>
        )}
        {!browserDemo && <UsageChip usage={view.usage} modelLabel={llm.model} llm={llm} />}
        <button className="btn small" title="Camera (V)" aria-label={`Camera: ${cameraLabel}`} onClick={() => store.set({ camera: camera === 'first' ? 'third' : camera === 'third' ? 'top' : 'first' })}>
          🎥 <span className="btn-label">{cameraLabel}</span>
        </button>
        {!browserDemo && <button className="btn small" title="Units" onClick={() => client.settings({ units: st.units === 'US' ? 'SI' : 'US' })}>
          {st.units}
        </button>}
        {!browserDemo && <GraphicsButton />}
        {solo && !observing && <button className="btn small" onClick={() => client.openSlots('save')}>Save game</button>}
        <button className="btn small" title={ttsNote ? `Voice (your browser's voices). ${ttsNote}` : 'Voice'} onClick={() => client.settings({ tts: !st.tts })}>
          {st.tts ? '🔊' : '🔇'}
        </button>
        <AmbientButton />
        <button className="btn small" onClick={() => store.set({ panel: { kind: 'tablet' } })} title="Your tablet: patients and their charts (Tab)" aria-label="Tablet">
          ▭ <span className="btn-label">Tablet</span>
        </button>
        <button className="btn small" onClick={() => store.set({ panel: { kind: 'help' } })} title="Help (H)" aria-label="Help">
          ?
        </button>
        {!(browserDemo && touchTour()) && <button className="btn small hud-settings" onClick={() => store.set({ panel: { kind: 'settings' } })} title="Settings: mouse sensitivity, the keys (Esc)" aria-label="Settings">
          ⚙
        </button>}
        {browserDemo ? (
          <button className="btn small" onClick={() => client.leaveSolo()} title="Leave demo" aria-label="Leave demo">
            <span className="btn-icon" aria-hidden="true">✕</span>
            <span className="btn-label">Leave demo</span>
          </button>
        ) : observing ? null : confirmEnd ? (
          <>
            <button className="btn small danger" onClick={() => client.act({ type: 'end_shift' })}>
              End now
            </button>
            <button className="btn small" onClick={() => setConfirmEnd(false)}>
              Keep working
            </button>
          </>
        ) : (
          <button className={`btn small ${allDispo ? 'primary' : ''}`} onClick={() => setConfirmEnd(true)}>
            {allDispo ? '✓ End shift' : 'End shift'}
          </button>
        )}
      </div>

      {/* left: compact patient list; it stays beside the tablet (Tab), which frees the mouse to click it */}
      {!browserDemo && (!panel || panel.kind === 'npc' || panel.kind === 'monitor' || panel.kind === 'phone' || panel.kind === 'tablet') ? (
        <div className="hud-patients panel">
          <div className="hud-section-title">My patients</div>
          {view.board.length === 0 && <div className="dim small-pad">No patients yet.</div>}
          {view.board.map((r) => {
            const los = Math.round(lengthOfStay(r, view.t) / 60);
            return (
              <div key={r.id} className={`hud-pt ${r.flowStatus === 'Departed' ? 'departed' : ''} ${r.critical ? 'critical' : ''}`} title={r.alerts.join('\n')}>
                <span className={`esi esi-${r.esi}`} title={`Triage ESI ${r.esi} (1 = most critical, 5 = least urgent)`}>{r.esi}</span>
                <div className="hud-pt-main">
                  <div className="hud-pt-name">
                    {r.bedLabel} · {r.name.split(',')[0]} <span className="dim">{r.age}{r.sex}</span>
                  </div>
                  <div className="hud-pt-cc dim">
                    {r.discharge ? dischargeStatus(r.discharge) : <>{r.chiefComplaint} · {los} min{r.dispo ? ` · ${r.dispo.replace('_', ' ')}` : ''}</>}
                  </div>
                </div>
                <div className="hud-pt-flags">
                  {r.newResults > 0 && <span className="flag new" title="New results">{r.newResults}</span>}
                  {r.pendingLabs > 0 && <span className="flag lab" title="Labs pending">🧪</span>}
                  {r.pendingImaging > 0 && <span className="flag img" title="Imaging pending">📷</span>}
                  {r.critical && <span className="flag crit" title="Critical page">!</span>}
                </div>
              </div>
            );
          })}
          {solo && !observing && <RotationHud view={view} />}
        </div>
      ) : null}

      {/* right: pages */}
      {(!panel || panel.kind === 'monitor') && unread.length > 0 && !observing && (
        <div className="hud-pages">
          {unread.slice(-5).map((p) => (
            <PageCard key={p.id} p={p} clockStart={view.clockStart} />
          ))}
        </div>
      )}

      {/* center prompt */}
      {/* (a tablet tucked away is out of the way: you walk and aim as usual, so the prompt shows) */}
      {prompt && (!panel || (tabletMin && panel.kind === 'npc')) && <div className="hud-prompt">{prompt}</div>}

      {/* toasts */}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
      {st.paused && !panel && <div className="paused-banner">PAUSED — press P to resume</div>}
    </div>
  );
}

/** Graphics quality: cycles low → medium → high → ultra; the world restarts (the shift resumes). */
function GraphicsButton() {
  const q = activeQuality() ?? preferredQuality() ?? 'high';
  const label: Record<Quality, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
  return (
    <button
      className="btn small"
      title="Graphics quality (Low = no post-processing, for integrated GPUs; Ultra = native resolution). Reloads the 3D view; your shift continues."
      onClick={() => {
        const next = QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length];
        saveQuality(next);
        location.reload();
      }}
    >
      🖥 {label[q]}
    </button>
  );
}

function PageCard({ p, clockStart }: { p: PageView; clockStart: string }) {
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setFresh(false), 1500);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className={`page-card ${p.priority} ${fresh ? 'fresh' : ''}`} onClick={() => client.act({ type: 'ack_page', pageId: p.id })} title="Click to acknowledge">
      <div className="page-head">
        <span>📟 {p.from}</span>
        <span className="mono dim">{clockAt(clockStart, p.t)}</span>
      </div>
      <div className="page-text">{p.text}</div>
    </div>
  );
}

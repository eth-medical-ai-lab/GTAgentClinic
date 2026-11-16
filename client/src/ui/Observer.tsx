/**
 * Observe mode: the right-side "AI resident" panel. A live, timestamped teaching transcript
 * of the agent's shift — its think-aloud reasoning, actions, notable results and pages
 * (server/sim/aiDoctor.ts) — plus follow/free camera, watch pace, Stop, and at the end the
 * score, the AI's reflection, the full debrief and the run log.
 *
 * It can be minimized to a chip at the screen edge (— button, R, a two-finger swipe down or a
 * right-drag, like the patient tablet) that shows what the AI doctor is doing and how many lines
 * came in meanwhile, or widened for reading (⤢, Shift+R). Remembered per browser (obPanel.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { LAYOUTS } from '../../../shared/layout';
import { clockAt, DISPO_LABELS, type Debrief, type NarrationEntry, type NarrationKind, type NpcView, type PlayerView } from '../../../shared/types';
import { store, useStore } from '../store';
import { minimizeObPanel, restoreObPanel, toggleObPanelMax, toggleObPanelMin, useObPanel } from './obPanel';
import { useDockPull, useTuck } from './tuck';
import './observer.css';

interface LaunchStatus {
  sessionId: string;
  state: 'running' | 'finished' | 'stopped' | 'failed';
  error?: string;
}

const PACES = [
  { label: 'Slow', sec: 3 },
  { label: 'Normal', sec: 1.5 },
  { label: 'Fast', sec: 0.5 },
  { label: 'Max', sec: 0 },
];

const ICON: Record<NarrationKind, string> = { thought: '💭', action: '→', result: '↳', event: '', system: '⚙', reflection: '🏁' };
const REASONING = new Set<NarrationKind>(['thought', 'reflection', 'system']);

export function ObserverPanel() {
  const view = useStore((s) => s.view);
  const feed = useStore((s) => s.feed);
  const follow = useStore((s) => s.follow);
  const debrief = useStore((s) => s.debrief);
  const [filter, setFilter] = useState<'all' | 'reasoning'>('all');
  const [launch, setLaunch] = useState<LaunchStatus | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [pinned, setPinned] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const sessionId = view?.sessionId;
  const managed = !!view?.driver?.observe;
  const size = useObPanel();
  const min = size === 'min';
  const { ref: panelRef, off, tucking, handlers } = useTuck<HTMLElement>({ minimized: min, onTuck: minimizeObPanel });
  // lines that came in while minimized (the chip's count and dot)
  const lastId = feed.length ? feed[feed.length - 1].id : 0;
  const seenId = useRef(lastId);
  useEffect(() => {
    if (!min) seenId.current = lastId;
  }, [min, lastId]);

  // R minimizes / brings it back, Shift+R widens it for reading (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'r' && e.key !== 'R') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (min) restoreObPanel();
        toggleObPanelMax();
      } else toggleObPanelMin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [min]);

  // the rest of the HUD (toasts, the watcher's tablet) makes room for the panel at its current size
  useEffect(() => {
    document.documentElement.dataset.obPanel = size;
    return () => {
      delete document.documentElement.dataset.obPanel;
    };
  }, [size]);

  // a menu-launched agent: is its process still running? (Stop button, failures)
  useEffect(() => {
    if (!managed || !sessionId) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = (await (await fetch('/api/observe')).json()) as { current?: LaunchStatus | null };
        if (alive && j.current?.sessionId === sessionId) setLaunch(j.current);
      } catch {
        /* server restarting */
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [managed, sessionId]);

  // keep the newest line in view unless the reader scrolled back
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [feed.length, filter, pinned, debrief, size]);

  if (!view?.driver) return null;
  const driver = view.driver;
  const doc = view.npcs.find((n) => n.id === 'ai_doctor');
  const room = LAYOUTS[view.layoutId]?.rooms.find((r) => r.id === view.player.location)?.label ?? view.player.location;
  const running = managed && launch?.state === 'running' && !view.ended;
  const reflections = feed.filter((e) => e.kind === 'reflection');
  const shown = filter === 'all' ? feed : feed.filter((e) => REASONING.has(e.kind));
  const isClaude = /claude/i.test(driver.label ?? '') || !!driver.model;

  const setPace = async (sec: number) => {
    await fetch(`/api/sessions/${view.sessionId}/pace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds: sec }) }).catch(() => undefined);
  };
  const stop = async () => {
    setConfirmStop(false);
    try {
      await fetch('/api/observe', { method: 'DELETE' });
    } catch {
      store.toast('Could not reach the server to stop the AI doctor.', 'bad');
    }
  };

  const gesture = off ? { transform: `translate(${off.x}px, ${off.y}px)`, transition: 'transform 0.06s linear' } : undefined;
  const unread = min ? feed.filter((e) => e.id > seenId.current && e.kind !== 'system').length : 0;

  return (
    <>
    {min && <ObDock view={view} doc={doc} feed={feed} debrief={debrief} unread={unread} />}
    <aside
      ref={panelRef}
      className={`ob-panel panel${size === 'max' ? ' max' : ''}${min ? ' min' : ''}${tucking ? ' tucking' : ''}`}
      style={gesture}
      aria-label="AI resident feed"
      aria-hidden={min}
      {...handlers}
    >
      <header className="ob-head">
        <div className="ob-title">
          <span className={`ob-dot ${view.ended ? 'off' : 'live'}`} />
          <div className="ob-title-text">
            <div className="ob-name">AI resident · {driver.label ?? 'agent'}</div>
            <div className="ob-sub dim">
              {view.mapTitle} · {isClaude ? 'your Claude Code login (subscription usage)' : 'scripted, no LLM (free)'}
            </div>
          </div>
          <div className="ob-winbtns">
            <button className="ob-winbtn" onClick={toggleObPanelMax} title={size === 'max' ? 'Normal width (Shift+R)' : 'Wider, for reading (Shift+R)'} aria-label={size === 'max' ? 'Normal width' : 'Maximize the transcript'}>
              {size === 'max' ? '⤡' : '⤢'}
            </button>
            <button className="ob-winbtn" onClick={minimizeObPanel} title="Minimize to a chip (R) · or swipe down with two fingers, or right-drag" aria-label="Minimize the transcript">
              —
            </button>
          </div>
        </div>
        <div className="ob-now">
          <span className="mono">{clockAt(view.clockStart, view.t)}</span> 📍 {room}
          {doc?.activity && <div className="ob-activity">{doc.activity}</div>}
        </div>
        <div className="ob-controls">
          <div className="seg small" role="group" aria-label="How you move">
            <button className={follow ? 'on' : ''} onClick={() => store.set({ follow: true })} title="Walk behind the AI doctor automatically (T). Any WASD input lets you go your own way.">
              🚶 Tag along (T)
            </button>
            <button className={!follow ? 'on' : ''} onClick={() => store.set({ follow: false })} title="Walk around on your own (WASD, Shift or double-tap W to run, Space to jump, V switches the view)">
              🧭 Walk freely
            </button>
          </div>
          {!view.ended && (
            <div className="seg small" role="group" aria-label="Pace" title="Real-time pause between the AI doctor's actions">
              {PACES.map((p) => (
                <button key={p.label} className={Math.abs((driver.paceSec ?? 0) - p.sec) < 0.01 ? 'on' : ''} onClick={() => void setPace(p.sec)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {running &&
            (confirmStop ? (
              <>
                <button className="btn small danger" onClick={() => void stop()}>
                  Stop & end shift
                </button>
                <button className="btn small" onClick={() => setConfirmStop(false)}>
                  Keep watching
                </button>
              </>
            ) : (
              <button className="btn small" onClick={() => setConfirmStop(true)} title="Stop the AI doctor and end its shift">
                ■ Stop
              </button>
            ))}
        </div>
        <div className="ob-hint dim">
          {follow ? 'Tagging along behind the AI doctor: WASD goes your own way.' : 'You walk the floor as a med student: WASD, Shift to run, V view, T tag along.'} E talks to anyone, off the record (the AI never hears it). Tab: the tablet, patients and their charts, read-only. R hides this panel.
        </div>
        {launch?.state === 'failed' && <div className="ob-error">The AI doctor stopped: {launch.error ?? 'unknown error'}</div>}
      </header>

      {(view.ended || debrief) && <EndCard view={view} reflections={reflections} writing={managed && launch?.state === 'running'} />}

      <div className="ob-filter">
        <span className="dim">Transcript</span>
        <div className="seg small">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            Everything
          </button>
          <button className={filter === 'reasoning' ? 'on' : ''} onClick={() => setFilter('reasoning')}>
            Reasoning only
          </button>
        </div>
      </div>
      <div
        className="ob-feed"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollTop + el.clientHeight >= el.scrollHeight - 40);
        }}
      >
        {shown.length === 0 && <div className="dim ob-empty">Waiting for the AI resident to start thinking…</div>}
        {shown.map((e, i) => (
          <FeedItem key={e.id} e={e} view={view} sameTime={i > 0 && shown[i - 1].t === e.t} />
        ))}
      </div>
      {!pinned && (
        <button
          className="btn small ob-latest"
          onClick={() => {
            setPinned(true);
            const el = listRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          ↓ Latest
        </button>
      )}
    </aside>
    </>
  );
}

/**
 * The minimized transcript: a chip at the screen edge with what the AI doctor is doing now and how
 * many lines came in since (with a dot). Click it, swipe up on it with two fingers, or press R.
 */
function ObDock({ view, doc, feed, debrief, unread }: { view: PlayerView; doc?: NpcView; feed: NarrationEntry[]; debrief: Debrief | null; unread: number }) {
  const pull = useDockPull(restoreObPanel);
  const lastAction = feed.findLast((e) => e.kind === 'action');
  const now = view.ended
    ? debrief
      ? `Shift over: ${debrief.percent}% (${debrief.grade}). Open for the debrief`
      : 'Shift over: scoring…'
    : doc?.activity ?? (lastAction ? lastAction.text.replace(/^→\s*/, '') : 'Starting the shift');
  return (
    <button className={`ob-dock${unread ? ' unread' : ''}`} onClick={restoreObPanel} onWheel={pull} title="Show the AI resident's transcript (R, or swipe up)" aria-label={`Show the AI resident's transcript${unread ? `: ${unread} new` : ''}`}>
      <span className={`ob-dot ${view.ended ? 'off' : 'live'}`} />
      <span className="ob-dock-text">
        <b>AI resident{view.driver?.label ? ` · ${view.driver.label}` : ''}</b>
        <span className="ob-dock-now">{now}</span>
      </span>
      {unread > 0 && <span className="ob-dock-n">{unread > 99 ? '99+' : unread} new</span>}
      {unread > 0 && <span className="ob-dock-dot" />}
    </button>
  );
}

function FeedItem({ e, view, sameTime }: { e: NarrationEntry; view: PlayerView; sameTime: boolean }) {
  const row = e.patientId ? view.board.find((r) => r.id === e.patientId) : undefined;
  const text = e.kind === 'action' || e.kind === 'result' ? e.text.replace(/^(→|↳)\s*/, '') : e.text;
  return (
    <div className={`ob-item k-${e.kind}${e.tone ? ` t-${e.tone}` : ''}`}>
      <span className={`ob-time mono${sameTime ? ' same' : ''}`}>{clockAt(view.clockStart, e.t)}</span>
      <span className="ob-icon">{ICON[e.kind]}</span>
      <div className="ob-text">
        {row && <span className={`ob-bed esi-${row.esi}`}>{row.bedLabel}</span>}
        {text}
      </div>
    </div>
  );
}

function EndCard({ view, reflections, writing }: { view: PlayerView; reflections: NarrationEntry[]; writing: boolean }) {
  const d = useStore((s) => s.debrief);
  const managed = !!view.driver?.observe;
  return (
    <section className="ob-end">
      {d ? (
        <>
          <div className="ob-end-head">
            <div className={`grade small g-${d.grade}`}>{d.grade}</div>
            <div>
              <b>Shift over: {d.percent}%</b>
              <div className="dim">
                {d.score} / {d.maxScore} points · resources ${d.costUSD.toLocaleString()}
              </div>
            </div>
            <button className="btn small primary" onClick={() => store.set({ screen: 'debrief' })}>
              Full debrief →
            </button>
          </div>
          <ul className="ob-cases">
            {d.cases.map((c) => (
              <li key={c.patientId}>
                <span className="ob-case-bed">{c.bedLabel}</span> {c.name}: <span className={`v ${c.dxVerdict}`}>dx {c.dxVerdict}</span> <span className={`v ${c.dispoCorrect ? 'correct' : c.dispoCorrect === false ? 'incorrect' : 'none'}`}>{c.disposition ? DISPO_LABELS[c.disposition] : 'no dispo'}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="dim">Scoring the shift…</div>
      )}
      <div className="ob-reflection">
        <b>The AI resident’s reflection</b>
        {reflections.length ? reflections.map((r) => <p key={r.id}>{r.text}</p>) : <p className="dim">{writing ? 'Writing its reflection on the debrief…' : 'No reflection was sent.'}</p>}
      </div>
      <div className="ob-links">
        <a href={`/api/runs/${view.sessionId}`} target="_blank" rel="noreferrer">
          Run log (JSON)
        </a>
        {managed && (
          <a href={`/api/runs/${view.sessionId}/agent-log`} target="_blank" rel="noreferrer">
            Agent console log
          </a>
        )}
      </div>
    </section>
  );
}

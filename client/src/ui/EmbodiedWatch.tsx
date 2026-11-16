import { useEffect, useState } from 'react';
import type { ObserveStatus } from '../../../server/observe';
import type { Debrief } from '../../../shared/types';
import type { EmbodiedEvent, Input, ObservationLog } from '../../../shared/embodied';
import './observer.css';

function describe(input: Input) {
  switch (input.kind) {
    case 'key': return input.key.toUpperCase() + (input.ms ? ' for ' + input.ms / 1000 + ' s' : '');
    case 'wait': return 'Wait ' + input.ms / 1000 + ' s';
    case 'look': return 'Turn (' + input.dx + ', ' + input.dy + ')';
    case 'click': return 'Click (' + input.x + ', ' + input.y + ')';
    case 'scroll': return 'Scroll ' + input.dy;
    default: return input.kind + ' “' + input.text + '”';
  }
}

function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function EmbodiedWatch({ id }: { id: string }) {
  const [status, setStatus] = useState<ObserveStatus>();
  const [mode, setMode] = useState<'live' | 'ai'>('live');
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<ObservationLog>();
  const [error, setError] = useState('');
  const [stopError, setStopError] = useState('');
  const [score, setScore] = useState<Debrief>();
  const [savedPlayer, setSavedPlayer] = useState('');
  const [streamRetry, setStreamRetry] = useState(0);
  const run = '/api/runs/' + encodeURIComponent(id);
  const observe = '/api/observe/' + encodeURIComponent(id);
  const shots = run + '/observations';
  useEffect(() => {
    const abort = new AbortController();
    const opts = { signal: abort.signal, cache: 'no-store' as const };
    let timer: number;
    let eventsLoaded = -1;
    const refresh = async () => {
      try {
        const response = await fetch('/api/observe', opts);
        if (!response.ok) throw Error();
        const { current } = await response.json() as { current: ObserveStatus | null };
        const own = current?.sessionId === id ? current : undefined;
        setStatus(own);
        if (!own || own.state !== 'running') {
          const r = await fetch(run, opts);
          if (r.ok) {
            const record = await r.json();
            setScore(record.debrief);
            setSavedPlayer(record.player);
            setLog(record.observations);
            setError('');
            return;
          }
          if (!own) { setError('This shift is unavailable.'); return; }
        } else if (logOpen && eventsLoaded !== (own.eventCount ?? 0)) {
          const r = await fetch(shots, opts);
          if (r.ok) {
            const data: ObservationLog = await r.json();
            eventsLoaded = data.events.length;
            setLog(data);
          }
        }
        setError('');
      } catch {
        if (!abort.signal.aborted) setError('Connection interrupted. Reconnecting…');
      }
      if (!abort.signal.aborted) timer = window.setTimeout(refresh, 400);
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [id, run, shots, logOpen]);

  const stop = async () => {
    try {
      const r = await fetch('/api/observe?session=' + encodeURIComponent(id), { method: 'DELETE' });
      if (!r.ok) setStopError((await r.json()).error);
    } catch { setStopError('Could not stop the shift.'); }
  };
  const running = status?.state === 'running';
  const savedLast = !status && log?.events.findLast(e => e.kind === 'observation');
  const last = status?.lastObservation ?? (savedLast ? { number: savedLast.observation, at: savedLast.at } : undefined);
  const plan = status?.decision;
  const number = last?.number ?? log?.count ?? 0;
  const source = mode === 'ai' ? (number ? shots + '/' + number + '.jpg' : '')
    : running ? observe + '/live?retry=' + streamRetry : status ? observe + '/frame' : '';
  const start = status?.startedAt ?? log?.startedAt ?? 0;
  const entry = (e: EmbodiedEvent) => {
    if (e.kind === 'observation') return <a href={shots + '/' + e.observation + '.jpg'} target="_blank" rel="noreferrer">Screenshot {e.observation}</a>;
    if (e.kind === 'decision') return e.intent + (e.observeAfter ? ' · then observe' : ' · continue without a new image');
    if (e.kind === 'input') return describe(e.input) + ' · ' + e.result;
    return 'Invalid input · ' + e.result;
  };
  return <main className="embodied-watch">
    <header><div><b>Embodied doctor</b> · {status?.model ?? (savedPlayer || 'Connecting…')} {status && <>· {status.mapId} · seed {status.seed}</>}</div>
      <div role="group" aria-label="Spectator view" className="seg">
        <button className={mode === 'live' ? 'on' : ''} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live view</button>
        <button className={mode === 'ai' ? 'on' : ''} aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}>What the AI saw</button>
      </div>
      <div>{running && <button className="btn small" onClick={() => void stop()}>Stop shift</button>} <a className="btn small" href="/">Main menu</a></div>
    </header>
    <div className="embodied-view">{source
      ? <img key={mode} src={source} alt={mode === 'live' ? "The doctor's current game screen" : 'Observation ' + number}
          onError={running && mode === 'live' ? e => { e.currentTarget.hidden = true; } : undefined}
          onLoad={e => { e.currentTarget.hidden = false; }} />
      : <p>{score ? 'Shift ended' : mode === 'ai' ? 'Waiting for the first observation…' : 'Opening the game browser…'}</p>}
      {running && mode === 'live' && <button className="stream-retry btn small" onClick={() => setStreamRetry(n => n + 1)}>Reconnect live view</button>}
    </div>
    <footer>
      <div className="embodied-caption">
        <div aria-live="polite">{error || stopError || status?.error || plan?.intent || (score ? 'Shift ended' : 'Waiting for the doctor’s first input…')}
          {mode === 'ai' && number > 0 && <div>Observation {number}{last && ' · captured at ' + elapsed(last.at - start)}
            {plan && ' · ' + (plan.inputs.map(describe).join(' → ') || 'Observe now')}</div>}
        </div>
        <button className="btn small" aria-expanded={logOpen} onClick={() => setLogOpen(v => !v)}>Observation log ({number})</button>
      </div>
      {logOpen && <div className="embodied-log"><a href={shots} target="_blank" rel="noreferrer">Open JSON log</a>
        <ol>{log?.events.map((e, i) => <li key={i}><time>{elapsed(e.at - start)}</time> · Turn {e.turn} · {entry(e)}</li>)}</ol>
      </div>}
      {score && <div><b>Debrief · {score.score}/{score.maxScore} ({score.grade})</b> · <a href={run} target="_blank" rel="noreferrer">Full run record</a> · <a href={run + '/agent-log'} target="_blank" rel="noreferrer">Input log</a></div>}
    </footer>
  </main>;
}

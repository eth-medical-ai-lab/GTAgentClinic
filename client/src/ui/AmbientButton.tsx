import { useEffect, useState } from 'react';
import { AMBIENT_LEVELS, setAmbientLevel, useAmbientLevel, type AmbientLevel } from '../audio/settings';
import { recentSounds } from '../audio/soundscape';

const LABEL: Record<AmbientLevel, string> = { off: 'Off', low: 'Low', medium: 'Med', high: 'High' };

const openAtStart = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sounds');

/**
 * HUD control for the hospital soundscape: cycles Off → Low → Med → High (saved in this browser).
 * Right-click (or ?sounds=1) shows what's playing: the last 30 s of sounds, newest first, with how
 * far away each one is, so an odd noise can be named.
 */
export function AmbientButton() {
  const level = useAmbientLevel();
  const [open, setOpen] = useState(openAtStart);
  return (
    <>
      <button
        className="btn small"
        aria-label={`Ambient sound: ${LABEL[level]}`}
        title={
          'Ambient sound: monitors and alarms, room tone, phones, footsteps, doors, the station radio, sirens outside. ' +
          "Overhead pages and the waiting-room TV also need voices on (🔊). Click to cycle Off / Low / Med / High. Right-click: what's playing."
        }
        onClick={() => setAmbientLevel(AMBIENT_LEVELS[(AMBIENT_LEVELS.indexOf(level) + 1) % AMBIENT_LEVELS.length])}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        🎚 <span className="btn-label">{LABEL[level]}</span>
      </button>
      {open && <WhatsPlaying off={level === 'off'} onClose={() => setOpen(false)} />}
    </>
  );
}

function WhatsPlaying({ off, onClose }: { off: boolean; onClose: () => void }) {
  const [list, setList] = useState(() => recentSounds());
  useEffect(() => {
    const iv = setInterval(() => setList(recentSounds()), 500);
    return () => clearInterval(iv);
  }, []);
  // one row per sound: repeats (a monitor beeping) fold into the newest, with a count
  const rows: { what: string; key: string; ago: number; dist: number; loop: boolean; n: number }[] = [];
  for (const s of list) {
    const r = rows.find((x) => x.what === s.what);
    if (r) {
      r.n++;
      r.dist = Math.min(r.dist, s.dist);
    } else rows.push({ ...s, n: 1 });
  }
  return (
    <div className="panel sound-list" role="dialog" aria-label="What's playing">
      <div className="sound-list-head">
        <b>What's playing</b> <span className="muted">last 30 s, newest first</span>
        <button className="btn small ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="muted">{off ? 'Ambient sound is off.' : 'Nothing in the last 30 s.'}</div>
      ) : (
        <ul>
          {rows.slice(0, 12).map((r) => (
            <li key={r.what} title={r.key}>
              <span className="sound-what">
                {r.what}
                {r.n > 1 ? ` ×${r.n}` : ''}
                {r.loop ? ' (loop)' : ''}
              </span>
              <span className="muted">
                {r.dist < 1e6 ? `${r.dist < 10 ? r.dist.toFixed(1) : Math.round(r.dist)} m` : ''} · {r.ago < 1 ? 'now' : `${Math.round(r.ago)} s ago`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

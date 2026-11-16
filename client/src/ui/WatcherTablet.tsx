/**
 * Observe mode: the watcher's tablet. The med student watching an AI doctor talks to anyone on the
 * floor (patients, family, nurses, the attending, other staff, people waiting), off the record: the
 * AI doctor never hears it and nothing said here changes the shift (server/npc/watcher.ts). It is
 * the same hand-held tablet as the player's: walk with it open, swipe down with two fingers or
 * right-drag to tuck it away. A second tab shows, read-only, what the AI doctor itself said to them.
 */
import { useEffect, useRef, useState } from 'react';
import type { NpcView } from '../../../shared/types';
import { clockAt } from '../../../shared/types';
import { client } from '../net';
import { store, useStore } from '../store';
import { ChatInput, Transcript } from './Chat';
import { useDockPull, useTuck } from './tuck';
import { useWatcherThread, watcherId, watcherSaid } from './watcher';

/** beyond this distance (m) you can't talk to someone (as on the player's tablet) */
const EARSHOT_M = 4.2;
const INTRO = "Hi, I'm a medical student with the doctor's team. The doctor will be with you shortly.";

const QUICK: Record<string, string[]> = {
  patient: [INTRO, 'How are you feeling right now?', 'What brought you in tonight?', 'Has anyone explained what happens next?'],
  family: [INTRO, 'How have they been lately, compared with their normal?', 'What worries you most right now?'],
  nurse: ["Hi, I'm the med student shadowing the AI resident tonight.", "What's going on with your patients?", 'What should I watch for on a night like this?'],
  tech: ["Hi, I'm the med student shadowing tonight.", 'What are you running right now?'],
  attending: ["Hi, I'm the med student shadowing the AI resident.", 'What is the resident doing well so far?', 'Which patient worries you most tonight, and why?'],
};
const QUICK_OTHER = ["Hi, I'm a medical student shadowing tonight.", "How's your night going?"];
const ROLE_COLOR: Record<string, string> = { patient: '#9cc3d5', family: '#b48ead', nurse: '#3a8fb7', tech: '#8f3b5a', attending: '#e6e6e6' };

export function WatcherTablet({ npcId }: { npcId: string }) {
  const view = useStore((s) => s.view);
  const dist = useStore((s) => s.distances[npcId]);
  const minimized = useStore((s) => s.tabletMin);
  const thread = useWatcherThread(view?.sessionId, npcId);
  const [tab, setTab] = useState<'you' | 'ai'>('you');
  const { ref, off, tucking, handlers } = useTuck<HTMLDivElement>({ minimized, onTuck: () => store.set({ tabletMin: true }) });
  const dockPull = useDockPull(() => store.set({ tabletMin: false }));
  const sessionId = view?.sessionId;

  // a thread from before a reload (the server keeps it for this tab's watcher id)
  useEffect(() => {
    if (sessionId) client.send({ type: 'watcher_thread', watcherId: watcherId(), npcId });
    setTab('you');
  }, [sessionId, npcId]);

  // replies that came in while the tablet was tucked away
  const lines = thread?.lines.length ?? 0;
  const seen = useRef(0);
  useEffect(() => {
    if (!minimized) seen.current = lines;
  }, [minimized, lines]);

  const npc = view?.npcs.find((n) => n.id === npcId);
  if (!view || !npc) return null;
  const ai = view.conversations.find((c) => c.key === npc.id);
  const row = npc.patientId ? view.board.find((r) => r.id === npc.patientId) : undefined;
  const far = dist !== undefined && dist > EARSHOT_M;
  const first = npc.name.replace(/^Dr\. /, '').split(' ')[0];
  const initials = npc.name.replace('Dr. ', '').split(' ').map((w) => w[0]).slice(0, 2).join('');
  const color = ROLE_COLOR[npc.role] ?? '#888';
  const unread = minimized && lines > seen.current && thread?.lines[lines - 1]?.speaker === 'npc';
  const restore = () => store.set({ tabletMin: false });
  const gesture = off ? { transform: `perspective(1600px) translate(${off.x}px, ${off.y}px) rotateY(-7deg) rotateX(3deg) rotateZ(0.5deg)`, transition: 'transform 0.06s linear' } : undefined;

  const send = (text: string) => {
    watcherSaid(view.sessionId, npcId, npc.name, text);
    client.send({ type: 'watcher_talk', watcherId: watcherId(), npcId, text });
    setTab('you');
  };

  return (
    <>
      {minimized && (
        <button className={`tablet-dock wt-dock${unread ? ' unread' : ''}`} onClick={restore} onWheel={dockPull} title="Bring the tablet back (click or swipe up)">
          <span className="avatar" style={{ background: color }}>
            {initials}
          </span>
          <span className="td-text">
            <b>{npc.name}</b>
            <span className="dim">{unread ? 'New reply' : far ? `${Math.round(dist!)} m away` : 'Off the record'}</span>
          </span>
          {unread && <span className="td-dot" />}
        </button>
      )}
      <div ref={ref} className={`tablet watcher-tablet${minimized ? ' min' : ''}${tucking ? ' tucking' : ''}`} style={gesture} role="dialog" aria-label={`${npc.name}, off the record`} aria-hidden={minimized} {...handlers}>
        <div className="tablet-cam" />
        <div className="tablet-screen">
          <div className="tablet-status">
            <span className="mono">{clockAt(view.clockStart, view.t)}</span>
            <span>Med student · off the record</span>
            <span>Wi‑Fi · 86%</span>
          </div>
          <button className="close-x" onClick={() => store.set({ panel: null })} title="Close (Esc)">
            ×
          </button>
          <div className="sp-head">
            <div className="avatar" style={{ background: color }}>
              {initials}
            </div>
            <div>
              <h3>{npc.name}</h3>
              <div className="dim">
                {npc.title}
                {row && (
                  <>
                    {' '}
                    · <span className={`esi esi-${row.esi}`}>{row.esi}</span> {row.age}
                    {row.sex} · {row.chiefComplaint}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="wt-note" role="note">
            🎓 <b>Off the record.</b> You're a med student here: the AI doctor never hears this, and nothing you say changes the shift.
          </div>
          {ai && ai.lines.length > 0 && (
            <div className="seg small wt-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'you'} className={tab === 'you' ? 'on' : ''} onClick={() => setTab('you')}>
                💬 You and {first}
              </button>
              <button role="tab" aria-selected={tab === 'ai'} className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>
                🩺 AI doctor and {first} ({ai.lines.filter((l) => l.speaker !== 'system').length})
              </button>
            </div>
          )}
          {far && <div className="tablet-far">📍 {npc.name} is {Math.round(dist!)} m away. Walk closer to talk.</div>}
          {tab === 'ai' && ai ? (
            <div className="talk wt-ai">
              <div className="dim wt-ai-note">What the AI doctor and {first} said (read-only):</div>
              {/* in the session the AI doctor's lines are the player's ("You"): here "You" is the student */}
              <Transcript lines={ai.lines.map((l) => (l.speaker === 'player' ? { ...l, speaker: 'npc' as const, name: 'AI doctor' } : l))} typing={ai.typing} />
            </div>
          ) : (
            <WatcherTalk npc={npc} lines={thread?.lines ?? []} typing={!!thread?.typing} error={thread?.error} far={far} onSend={send} />
          )}
          <div className="tablet-hint">Walk with it open (WASD) · click someone else to talk to them · swipe down with two fingers or right-drag to put it away</div>
        </div>
        <div className="tablet-home" />
      </div>
    </>
  );
}

function WatcherTalk(p: { npc: NpcView; lines: NonNullable<ReturnType<typeof useWatcherThread>>['lines']; typing: boolean; error?: string; far: boolean; onSend: (text: string) => void }) {
  const quick = QUICK[p.npc.role] ?? QUICK_OTHER;
  const first = p.npc.name.split(' ')[0];
  const empty = p.lines.length === 0;
  const off = p.far || p.typing;
  return (
    <div className="talk">
      <Transcript lines={p.lines} typing={p.typing} placeholder={`Say hello to ${first}. They know you're a student with the doctor's team.`} />
      {p.error && <div className="wt-error">{p.error}</div>}
      <div className="quick">
        {quick.slice(0, empty ? 3 : quick.length).map((q) => (
          <button key={q} className="chip" onClick={() => p.onSend(q)} disabled={off}>
            {q}
          </button>
        ))}
      </div>
      <ChatInput onSend={p.onSend} disabled={off} placeholder={p.far ? `Too far away: walk back to ${first}` : `Talk to ${first}… (off the record, Enter to send)`} />
    </div>
  );
}

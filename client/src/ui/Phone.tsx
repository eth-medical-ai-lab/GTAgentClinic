import { useMemo, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { client } from '../net';
import { store, useStore } from '../store';
import { ChatInput, Transcript } from './Chat';

export function Phone(props: { initialContact?: string }) {
  const view = useStore((s) => s.view);
  const [active, setActive] = useState<string | null>(props.initialContact ?? null);
  const [q, setQ] = useState('');
  const contacts = view?.contacts ?? [];
  const groups = useMemo(() => {
    const f = (c: Contact) => !q || `${c.name} ${c.role} ${c.org}`.toLowerCase().includes(q.toLowerCase());
    // the attending's line (server/sim/escalation.ts ATTENDING_LINE) heads the list once a patient was escalated by phone
    const attending = contacts.filter((c) => c.id === 'attending').filter(f);
    return [
      ...(attending.length ? [{ title: 'Your attending', items: attending }] : []),
      { title: 'Consultants & admitting teams', items: contacts.filter((c) => c.kind === 'internal' && ['cards', 'surg', 'hosp', 'icu', 'ortho', 'obgyn'].includes(c.id)).filter(f) },
      { title: 'Hospital services', items: contacts.filter((c) => c.kind === 'internal' && c.id !== 'attending' && !['cards', 'surg', 'hosp', 'icu', 'ortho', 'obgyn'].includes(c.id)).filter(f) },
      { title: 'Outside lines (GP offices, family, insurers)', items: contacts.filter((c) => c.kind === 'external').filter(f) },
    ];
  }, [contacts, q]);
  if (!view) return null;
  const contact = contacts.find((c) => c.id === active);
  const conv = view.conversations.find((c) => c.key === `phone:${active}`);
  const inCall = conv && conv.lines.length > 0 && conv.lines[conv.lines.length - 1].text !== 'Call ended.';
  const patientName = (pid?: string) => view.board.find((r) => r.id === pid)?.name;

  const dial = (id: string) => {
    setActive(id);
    client.act({ type: 'call', contactId: id, text: '__dial__' });
  };

  return (
    <div className="side-panel panel phone">
      <button className="close-x" onClick={() => store.set({ panel: null })}>
        ×
      </button>
      <div className="sp-head">
        <div className="avatar" style={{ background: 'var(--ac-accent)' }}>☎</div>
        <div>
          <h3>{contact ? contact.name : 'Hospital phone'}</h3>
          <div className="dim">{contact ? `${contact.role} · ${contact.phone}` : 'Directory · dial a consultant, service or outside line'}</div>
        </div>
      </div>
      {!contact && (
        <div className="phone-dir">
          <input className="exam-filter" placeholder="Search directory…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {groups.map((g) => (
            <div key={g.title}>
              <div className="hud-section-title">{g.title}</div>
              {g.items.length === 0 && <div className="dim small-pad">—</div>}
              {g.items.map((c) => (
                <button key={c.id} className="contact" onClick={() => dial(c.id)}>
                  <div>
                    <b>{c.name}</b>
                    <div className="dim">
                      {c.role}
                      {c.patientId ? ` · re: ${patientName(c.patientId) ?? c.patientId}` : ''}
                    </div>
                  </div>
                  <span className="mono dim">{c.phone}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {contact && (
        <div className="talk">
          <Transcript lines={conv?.lines ?? []} typing={!!conv?.typing} placeholder="Ringing…" />
          {inCall ? (
            <>
              <ChatInput onSend={(t) => client.act({ type: 'call', contactId: contact.id, text: t })} disabled={!!conv?.typing} placeholder={`Speak to ${contact.name}…`} />
              <div className="phone-actions">
                <button
                  className="btn danger"
                  onClick={() => {
                    client.act({ type: 'hangup', contactId: contact.id });
                    setActive(null);
                  }}
                >
                  Hang up
                </button>
              </div>
            </>
          ) : (
            <div className="phone-actions">
              <button className="btn primary" onClick={() => dial(contact.id)}>
                Call again
              </button>
              <button className="btn" onClick={() => setActive(null)}>
                Directory
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

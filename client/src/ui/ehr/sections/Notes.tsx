import { useEffect, useRef, useState } from 'react';
import { classNames } from '../util';
import { browserDemo } from '../../../demo/mode';
import type { SectionProps } from './common';

export function Notes(p: SectionProps & { noteId?: string }) {
  const { chart, fmt } = p;
  const notes = [...chart.notes].sort((a, b) => b.t - a.t);
  const [sel, setSel] = useState<string | undefined>(p.noteId ?? notes[0]?.id);
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('ED Provider Note');
  const [text, setText] = useState('');
  const markedFor = useRef<string | null>(null);
  const note = notes.find((n) => n.id === sel);

  useEffect(() => {
    if (note?.unread && !locallyRead.has(note.id)) {
      setLocallyRead((s) => new Set(s).add(note.id));
      if (markedFor.current !== note.id) {
        markedFor.current = note.id;
        void p.act({ type: 'mark_read', patientId: chart.id });
      }
    }
  }, [note?.id]);

  const save = async () => {
    if (!text.trim()) return;
    const r = await p.act({ type: 'note', patientId: chart.id, title: title.trim() || 'ED Provider Note', text: text.trim() }, 'Note signed.');
    if (r.ok) {
      setComposing(false);
      setText('');
    }
  };

  const template = () =>
    setText(
      `HPI:\n\nPMH / meds / allergies reviewed:\n\nExam:\n\nED course:\n\nAssessment / differential:\n\nPlan / disposition:\n`,
    );

  return (
    <div className="ehr-split">
      <div className="ehr-split-list">
        {!browserDemo && <button className="ehr-btn primary block" onClick={() => setComposing(true)}>
          + New note
        </button>}
        {notes.length === 0 && <div className="ehr-empty">No notes.</div>}
        {notes.map((n) => (
          <button
            key={n.id}
            className={classNames('ehr-noteitem', n.id === note?.id && !composing && 'on', n.unread && !locallyRead.has(n.id) && 'unread')}
            onClick={() => {
              setComposing(false);
              setSel(n.id);
            }}
          >
            <span className={`ehr-note-type t-${n.type.replace(/\s+/g, '-').toLowerCase()}`}>{n.type}</span>
            <span className="ehr-noteitem-title">{n.title}</span>
            <span className="ehr-dim ehr-small">
              {fmt(n.t)} · {n.author}
            </span>
          </button>
        ))}
      </div>
      <div className="ehr-split-main">
        {composing ? (
          <div className="ehr-card">
            <div className="ehr-card-h">
              New note
              <button className="ehr-link" onClick={template}>
                Insert template
              </button>
            </div>
            <label className="ehr-field">
              <span>Title</span>
              <input className="ehr-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <textarea className="ehr-input ehr-textarea tall" value={text} onChange={(e) => setText(e.target.value)} placeholder="Document your assessment and plan…" />
            <div className="ehr-dialog-actions">
              <button className="ehr-btn" onClick={() => setComposing(false)}>
                Discard
              </button>
              <button className="ehr-btn sign" disabled={!text.trim()} onClick={save}>
                Sign note
              </button>
            </div>
          </div>
        ) : note ? (
          <div className="ehr-card ehr-note">
            <div className="ehr-note-head">
              <span className={`ehr-note-type t-${note.type.replace(/\s+/g, '-').toLowerCase()}`}>{note.type}</span>
              <div>
                <div className="ehr-note-title">{note.title}</div>
                <div className="ehr-dim">
                  {note.author} · {fmt(note.t)}
                </div>
              </div>
            </div>
            <div className="ehr-pre ehr-note-text">{note.text}</div>
          </div>
        ) : (
          <div className="ehr-empty big">Select a note.</div>
        )}
      </div>
    </div>
  );
}

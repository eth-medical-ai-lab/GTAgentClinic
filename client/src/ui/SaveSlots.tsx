import { useEffect, useRef, useState } from 'react';
import { SLOT_COUNT, level } from '../../../shared/saveGame';
import { client } from '../net';
import { store, useStore } from '../store';

export function SaveSlots() {
  const mode = useStore(s => s.slotDialog);
  const slots = useStore(s => s.slots);
  const busy = useStore(s => s.slotBusy);
  const problem = useStore(s => s.slotError);
  const online = useStore(s => s.connected);
  const rotation = useStore(s => s.rotation);
  const view = useStore(s => s.view);
  const screen = useStore(s => s.screen);
  const [selected, select] = useState<number | null>(null);
  const [name, setName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const node = dialog.current;
    return () => node?.close();
  }, []);
  const info = selected ? slots?.[selected - 1] : null;
  const saving = mode === 'save';

  return <dialog ref={dialog} className="save-dialog" aria-labelledby="slots-title"
    onCancel={e => { e.preventDefault(); if (!busy) store.set({ slotDialog: null }); }}
    onKeyDown={e => e.stopPropagation()}>
    <div className="slots-head">
      <h2 id="slots-title">{saving ? 'Save game' : 'Load game'}</h2>
      <button className="btn small" disabled={busy && !!slots} onClick={() => store.set({ slotDialog: null })}>Close</button>
    </div>
    {saving && <p className="dim">{view?.mapTitle} · Level {level(rotation.xp)} · {rotation.xp} XP</p>}
    <div className="slots-list">{Array.from({ length: SLOT_COUNT }, (_, i) => {
      const item = slots?.[i];
      return <button key={i} className={'slot-row' + (selected === i + 1 ? ' chosen' : '')}
        aria-pressed={selected === i + 1} disabled={busy || !slots || (!item && !saving)}
        onClick={() => { select(i + 1); setName(item?.name ?? view?.mapTitle ?? ''); }}>
        <span className="slot-number">{i + 1}</span>
        <span><b>{item?.name ?? (slots ? 'Empty slot' : 'Loading…')}</b>
          {item && <small>{item.map} · Lv. {item.level} · {item.ended ? 'Debrief' : item.clock} · {new Date(item.date).toLocaleString()}</small>}</span>
      </button>;
    })}</div>
    {saving && selected && <label className="slot-name">Save name<input autoComplete="off" maxLength={60}
      value={name} placeholder={view?.mapTitle} onChange={e => setName(e.target.value)} /></label>}
    {problem && <p role="alert">{problem}</p>}
    <div className="slots-foot">
      {saving && screen === 'game' && <button className="btn" disabled={busy} onClick={() => {
        if (window.confirm('Return to the main menu? Only progress written to a slot will be kept.')) client.leaveSolo();
      }}>Main menu</button>}
      {saving && slots?.some(Boolean) && <button className="btn" disabled={busy} onClick={() => client.openSlots('load')}>Load a slot</button>}
      <button className="btn primary" disabled={!online || !selected || busy || !slots} onClick={() => {
        if (selected) saving ? client.saveSlot(selected, name, info ?? null) : client.loadSlot(selected);
      }}>{busy && slots ? 'Working…' : saving ? (info ? 'Replace slot ' + selected : 'Save game') : 'Load game'}</button>
    </div>
  </dialog>;
}

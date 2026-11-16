import { RADIO_PIN } from '../../../shared/nightRadio';
import { store, useStore } from '../store';

const notes: Record<string, string> = {
  'Surgeon’s vest': 'Issued when you reached rotation level 2.',
  [RADIO_PIN]: 'Mei’s keepsake from the last hospital radio broadcast.',
  'Tiny brass key': 'A thank-you for returning lost belongings.',
};

export function LockerPanel() {
  const items = useStore(s => s.rotation.items);
  return <aside className="panel locker-panel" role="dialog" aria-labelledby="locker-title">
    <header>
      <h2 id="locker-title">My locker</h2>
      <button className="btn small" autoFocus onClick={() => store.set({ panel: null })}>Close</button>
    </header>
    <p className="locker-location"><b>Locker 13</b> · Ward 2 East</p>
    <p>Take the east elevators to Floor 2. Follow the signs to the staff lounge and look for the door marked <b>13 · Resident</b>.</p>
    {items.length ? <ul aria-label="Collected items">{items.map(item => <li key={item}>
      <b>{item}</b>{notes[item] && <small>{notes[item]}</small>}
    </li>)}</ul> : <p className="locker-empty">Your locker is empty. Reach level 2 to hang up your surgeon’s vest.</p>}
  </aside>;
}

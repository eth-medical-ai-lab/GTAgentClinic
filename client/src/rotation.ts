import { collectRadioClue, nextRadioClue, RADIO_PIN } from '../../shared/nightRadio';
import type { Action, ActionResult } from '../../shared/types';
import { bedsideTasks, earnBedsideXP, level, newRotation, type BedsideTask, type PlayerSave, type Rotation } from '../../shared/saveGame';
import type { WorldApi } from './world';
import { store, type Panel } from './store';

/** Settings are a temporary overlay, not part of a resumed shift; 'pocus' is the withdrawn bedside scanner's panel in older saves. */
export const restoredPanel = (panel?: Panel | null) => panel?.kind === 'settings' || (panel?.kind as string) === 'pocus' ? null : panel ?? null;

let volatileOwner: string | undefined;
export function saveOwner() {
  if (volatileOwner) return volatileOwner;
  try {
    const saved = localStorage.getItem('ac.saveLibrary');
    if (saved) return volatileOwner = saved;
  } catch { /* continue with a tab-local library */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  volatileOwner = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  try { localStorage.setItem('ac.saveLibrary', volatileOwner); } catch { /* private storage */ }
  return volatileOwner;
}

let capture: Pick<WorldApi, 'snapshot' | 'readyForSave'> | undefined;
export function bindWorldCapture(world?: typeof capture) { capture = world; }

export async function finishHandAction() {
  const world = capture;
  while (world && world === capture && !world.readyForSave()) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
export function playerSave(): PlayerSave {
  const s = store.get();
  return { rotation: s.rotation, camera: s.camera, panel: restoredPanel(s.panel), tabletMin: s.tabletMin, world: capture?.snapshot() ?? s.loadedWorld };
}

export function rememberRotation(rotation: Rotation, sessionId = store.get().view?.sessionId) {
  store.set({ rotation });
  if (sessionId) {
    try { sessionStorage.setItem('ac.activeRotation', JSON.stringify({ sessionId, rotation })); } catch { /* storage unavailable */ }
  }
}

export function reconnectRotation(sessionId: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem('ac.activeRotation') ?? 'null');
    if (saved?.sessionId === sessionId) {
      const last = JSON.parse(sessionStorage.getItem('ac.refreshWorld') ?? 'null');
      store.set({ solo: true, rotation: saved.rotation, ...(last?.id === sessionId && !capture
        ? { loadedWorld: last.player.world, camera: last.player.camera, panel: restoredPanel(last.player.panel), tabletMin: last.player.tabletMin } : {}) });
    }
  } catch { /* older run */ }
}

export function newCareer(continueRotation: boolean) {
  store.set({ solo: true, rotation: continueRotation ? store.get().rotation : newRotation(), loadedWorld: null, slotDialog: null, lastSave: null });
}

export function recordBedsideAction(action: Action, result: ActionResult) {
  const { solo, screen, view, rotation } = store.get();
  if (!result.ok || !solo || !view || screen !== 'game' || view.driver?.kind === 'agent') return;

  let id: string | undefined;
  let task: BedsideTask;
  switch (action.type) {
    case 'talk':
      // Only an authored history detail actually disclosed by the patient or family counts.
      id = (result.data as { historyPatient?: string } | undefined)?.historyPatient;
      task = 'history';
      break;
    case 'examine':
      id = action.patientId;
      task = 'exam';
      break;
    case 'give_item':
      id = view.items?.find(item => item.id === action.itemId)?.patientId;
      task = 'belonging';
      break;
    default: return;
  }
  if (!id) return;
  const next = earnBedsideXP(rotation, id, task);
  if (next === rotation) return;
  rememberRotation(next);
  const reward = bedsideTasks[task];
  store.toast(`+${reward.xp} XP · ${reward.label}`, 'good');
  if (level(next.xp) > level(rotation.xp)) {
    const unlock = next.items.find(item => !rotation.items.includes(item));
    store.toast(`Level ${level(next.xp)}${unlock ? ' · Unlocked ' + unlock : ''}`, 'good');
  }
}

export function soloRadioClue() {
  const s = store.get();
  if (s.solo && s.screen === 'game' && s.view && !s.view.ended && s.view.driver?.kind !== 'agent') {
    return nextRadioClue(s.rotation);
  }
}

export function nightSouvenir(npc: string, result: ActionResult) {
  if ((result.data as { radioClue?: string } | undefined)?.radioClue !== npc || soloRadioClue()?.npc !== npc) return;
  const next = collectRadioClue(store.get().rotation, npc);
  rememberRotation(next);
  if (next.items.includes(RADIO_PIN)) store.toast(`Added to your locker · ${RADIO_PIN}`, 'good');
}

export function returnedBelonging(id: string) {
  const s = store.get();
  if (!s.solo || !s.view) return;
  const clue = 'returned/' + id;
  if (s.rotation.clues.includes(clue)) return;
  rememberRotation({ ...s.rotation, clues: [...s.rotation.clues, clue] });
}

export function lostAndFound(npc: string, text: string) {
  const r = store.get().rotation;
  if (!store.get().solo || npc !== 'hk_ines' || !/lost|found|missing/i.test(text)) return;
  if (r.items.includes('Tiny brass key') || r.clues.filter(c => c.startsWith('returned/')).length < 2) return;
  rememberRotation({ ...r, items: [...r.items, 'Tiny brass key'] });
  store.toast('Inés opens a matchbox. Inside is a tiny brass key tagged “Lost & Found, 1978.” “You’ve earned the spare.”', 'good');
}

window.addEventListener('pagehide', () => {
  const s = store.get();
  if (s.solo && s.screen === 'game' && s.view && capture) {
    try { sessionStorage.setItem('ac.refreshWorld', JSON.stringify({ id: s.view.sessionId, player: playerSave() })); } catch { /* manual slots remain on disk */ }
  }
});

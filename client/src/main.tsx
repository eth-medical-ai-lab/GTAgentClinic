import './resCache'; // first import: versions /res URLs before any model, texture or sound is requested
import { createRoot } from 'react-dom/client';
import { EmbodiedWatch } from './ui/EmbodiedWatch';
import { App } from './App';
import { mockCharts, mockView } from './dev/mock';
import { client } from './net';
import { store, type Panel } from './store';
import { initFullscreen } from './ui/fullscreen';
import { browserDemo } from './demo/mode';
import './styles.css';

const params = new URLSearchParams(location.search);

const embodied = browserDemo ? null : params.get('embodied');
if (browserDemo) {
  document.title = 'GTAgentClinic · Browser demo';
  client.connect();
} else if (params.has('mock')) {
  // UI development without a server: ?mock=1[&panel=ehr|board|npc:<id>|phone][&camera=first|third|top]
  const panelParam = params.get('panel');
  let panel: Panel | null = null;
  if (panelParam === 'ehr') panel = { kind: 'ehr', patientId: params.get('patient') ?? 'p_brunner', section: params.get('section') ?? undefined };
  else if (panelParam === 'board') panel = { kind: 'board' };
  else if (panelParam === 'phone') panel = { kind: 'phone' };
  else if (panelParam?.startsWith('npc:')) panel = { kind: 'npc', npcId: panelParam.slice(4), tab: 'talk' };
  const camera = (params.get('camera') as 'first' | 'third' | 'top') ?? 'first';
  store.set({ mock: true, view: mockView(), charts: mockCharts(), screen: 'game', panel, camera, connected: true });
} else if (!embodied) {
  // ?spectate=<sessionId> attaches this tab to an existing session (e.g. an AI agent's shift)
  if (sessionStorage.getItem('ac.driverToken')) store.set({ camera: params.get('doctorCamera') === 'first' ? 'first' : 'third' });
  const spectate = params.get('spectate');
  if (spectate) sessionStorage.setItem('ac.sessionId', spectate);
  client.connect();
  // full screen from Start shift; Esc handling while in it; back in after a reload (ui/fullscreen.ts)
  initFullscreen(() => store.get().screen === 'game');
}

// test/automation hook (?debug=1): lets e2e scripts drive the UI without pointer-lock gymnastics
if (params.has('debug')) (window as unknown as Record<string, unknown>).__ac = { store, client };

createRoot(document.getElementById('root')!).render(embodied ? <EmbodiedWatch id={embodied} /> : <App />);

import { client } from '../net';
import { resUrl } from '../resCache';
import { store, useStore } from '../store';
import { Wordmark } from '../ui/Wordmark';
import { touchTour } from './mode';
import './demo.css';

const INSTALL = 'https://github.com/eth-medical-ai-lab/GTAgentClinic/blob/main/docs/SETUP.md';

export function DemoMenu() {
  const ready = useStore(s => s.connected);
  const enter = () => {
    store.set({ camera: 'third' });
    client.start('browser_demo', 'Resident');
  };
  return (
    <main className="demo-menu" style={{ backgroundImage: `url("${resUrl('/res/loading/crew.webp')}")` }}>
      <div className="demo-intro">
        <h1><Wordmark pulse={false} /></h1>
        <h2>Emergency department tour</h2>
        <p>Walk the floor and meet the team. Start with Marcus at the nurses’ station, then visit a patient to hear their story.</p>
        <button className="demo-enter" disabled={!ready} onClick={enter}>Enter the ED <span aria-hidden="true">→</span></button>
        <p className="demo-details">This browser demo uses scripted conversations. For full clinical shifts and live AI dialogue, <a href={INSTALL}>get the local game</a>.</p>
      </div>
    </main>
  );
}

export function DemoHelp({ onClose }: { onClose(): void }) {
  return (
    <section className="help-panel panel demo-help" role="dialog" aria-label="Tour controls">
      <button className="close-x" onClick={onClose} aria-label="Close controls">×</button>
      <h2>Tour controls</h2>
      {touchTour() ? <p>Drag the scene to look around. Tap the floor to walk or tap a person to approach and talk. Tap the camera button for a top-down view.</p> :
        <p>Click the scene to look around. Walk with <kbd>W A S D</kbd>, face a person or object and press <kbd>E</kbd> to interact. Press <kbd>Esc</kbd> to close a panel or release the mouse.</p>}
      <p>Try a suggested question or type your own. Open the tablet to read the patients’ charts. At the nurses’ station, use the phone to call a colleague.</p>
      <p><a href={INSTALL}>Get the full game with live AI dialogue</a></p>
    </section>
  );
}

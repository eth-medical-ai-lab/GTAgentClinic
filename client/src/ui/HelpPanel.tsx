import { PTT_KEY_LABEL } from './Chat';

export function HelpPanel(props: { onClose: () => void }) {
  return (
    <div className="help-panel panel">
      <button className="close-x" onClick={props.onClose}>
        ×
      </button>
      <h2>How to work a shift</h2>
      <div className="help-grid">
        <section>
          <h3>Move & look</h3>
          <ul>
            <li><kbd>W A S D</kbd> walk · <kbd>Shift</kbd>+<kbd>W</kbd> or double-tap and hold <kbd>W</kbd> to run · <kbd>Space</kbd> jump</li>
            <li>Move the mouse/touchpad to look around (first/third person); right-click the view (or <kbd>Esc</kbd>, or open the tablet with <kbd>Tab</kbd>) to free the cursor for panels and buttons at the screen edges — right-click again, click the view, or start walking (<kbd>W A S D</kbd>) to return to looking around; scroll to zoom the over-the-shoulder camera (it stays under the ceiling); the top-down camera opens the rooms from above</li>
            <li><kbd>V</kbd> camera: first-person → over-the-shoulder → top-down</li>
            <li>Top-down: click the floor to walk; click people/objects to use them</li>
            <li>Watching an AI doctor: <kbd>T</kbd> tag along behind it; any WASD goes your own way · <kbd>E</kbd> talk to anyone, off the record (it never hears you) · <kbd>Tab</kbd> the tablet: patients and their charts, read-only · <kbd>R</kbd> hide or show its transcript, <kbd>Shift</kbd>+<kbd>R</kbd> wider</li>
          </ul>
        </section>
        <section>
          <h3>Interact</h3>
          <ul>
            <li><kbd>E</kbd> talk to the person / use the object you're facing</li>
            <li>Things lying around: <kbd>E</kbd> picks one up, into your right hand, then your left (a tray needs both). With your hands full, put something down first. <kbd>F</kbd> inspects what you last picked up; <kbd>G</kbd> puts it down on the surface you look at, or at your feet</li>
            <li>Off duty for a minute: <kbd>E</kbd> at the cafeteria or workroom coffee machine makes a coffee; <kbd>E</kbd> on a free café chair sits you down to drink it; bins and the waiting room's vending machine work too. None of it is scored</li>
            <li>Clean hands: <kbd>E</kbd> on a hand-rub dispenser (outside and inside every bay and patient room, at every sink) for an alcohol rub; <kbd>E</kbd> on a sink's soap dispenser washes with soap and water. Before and after each patient you examine: the debrief lists it (WHO moments 1 and 4), unscored</li>
            <li>Masks: <kbd>E</kbd> on a mask box (the walk-in entrance, the ambulance entrance, the nurses' station, outside a room on droplet precautions) puts one on; <kbd>M</kbd> takes it off into the bin, a fresh one next time</li>
            <li>Speak instead of typing: hold <kbd>{PTT_KEY_LABEL}</kbd> (the key under <kbd>Esc</kbd>) or hold 🎤 while you talk; letting go sends. A quick tap on 🎤 sends when you pause.</li>
            <li>Workstations → <b>AgentChart</b> EHR (orders, results, notes, ECGs, disposition)</li>
            <li>Phones (station, workroom) → consultants, lab, radiology, GP offices, family, insurers</li>
            <li>Bedside ultrasound: at the bedside, pick a view under <i>Examine → Bedside ultrasound</i>; the read appears with the other findings</li>
            <li><b>🆘 Escalate</b> (top of a patient's tablet) calls your attending: <i>Come to the bedside now</i> (she walks over) or <i>Call to discuss</i> (phone), with an optional one-line reason</li>
            <li><kbd>Tab</kbd> your tablet, and the mouse for the buttons on screen, such as the camera (tap a patient for the chart; the tracking board is on the workstations) · <kbd>P</kbd> pause · <kbd>Esc</kbd> close; with nothing open, <kbd>Esc</kbd> opens the settings (mouse sensitivity, full screen, the keys) · hold <kbd>Esc</kbd> to leave full screen (a menu setting)</li>
            <li>An alarming bedside monitor: open it to pause its alarm sound for 2 minutes (red alarms come back if not fixed) · 🎚 sets the ambient sound</li>
          </ul>
        </section>
        <section>
          <h3>Clinical workflow</h3>
          <ol>
            <li>Sickest first — check ESI on the board and your pages.</li>
            <li>History: talk naturally (type or 🎤). Patients only know their symptoms; family and GP offices know things the patient doesn't.</li>
            <li>Examine: pick maneuvers in the Examine tab.</li>
            <li>Order in AgentChart, or give verbal orders to nurses ("Tom, give 324 mg of aspirin for Bed 2").</li>
            <li>Read results as they post; sign ECGs; watch trends.</li>
            <li>Call the accepting team, set diagnoses and disposition.</li>
          </ol>
        </section>
        <section>
          <h3>Watch out</h3>
          <ul>
            <li>Staff are busy and can make mistakes — check vitals for completeness, timing of cultures vs antibiotics, and patient identity.</li>
            <li>Tests cost money and time; low-value tests cost points.</li>
            <li>The debrief scores diagnosis, disposition, critical actions, timing, history, safety catches and stewardship.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

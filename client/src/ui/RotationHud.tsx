import { radioLead } from '../../../shared/nightRadio';
import { bedsideTasks, level, type BedsideTask } from '../../../shared/saveGame';
import type { PatientBoardRow, PlayerView } from '../../../shared/types';
import { store, useStore } from '../store';

export function RotationHud({ view }: { view: PlayerView }) {
  const rotation = useStore(s => s.rotation);
  const panel = useStore(s => s.panel);
  const available = view.board.filter(p => !p.dispo && p.departedAt === undefined);
  function tasksFor(patient: PatientBoardRow): BedsideTask[] {
    const tasks: BedsideTask[] = ['history', 'exam'];
    if (view.items?.some(item => item.patientId === patient.id)) tasks.push('belonging');
    return tasks;
  }
  const npc = panel?.kind === 'npc' ? view.npcs.find(n => n.id === panel.npcId) : undefined;
  const patient = available.find(p => p.id === npc?.patientId)
    ?? available.find(p => p.bed === view.player.location)
    ?? available.find(p => tasksFor(p).some(task => !rotation.bedside?.[p.id]?.includes(task)))
    ?? available[0];
  const tasks = patient ? tasksFor(patient) : [];
  const earned = patient ? rotation.bedside?.[patient.id] ?? [] : [];
  const next = tasks.find(task => !earned.includes(task));
  const lead = radioLead(rotation, view.npcs);
  const rank = level(rotation.xp);
  return <section className="rotation-hud" aria-label="Rotation progress">
    <div className="rotation-rank"><b>Rotation · Level {rank}</b><span className="mono">{rotation.xp} XP</span></div>
    <progress max={100} value={rotation.xp % 100} aria-label={`Progress to level ${rank + 1}`} />
    {patient && <div className="rotation-objective">
      <small>{patient.bedLabel} · {patient.name.split(',')[0]}</small>
      <div>{next ? bedsideTasks[next].label : '✓ Bedside goals complete'} {next && <b>+{bedsideTasks[next].xp} XP</b>}</div>
    </div>}
    <button className="btn small locker-shortcut" onClick={() => store.set({ panel: { kind: 'locker' } })}>
      My locker{rotation.items.length > 0 && <span> · {rotation.items.length}</span>}
    </button>
    {lead && <p><b>Hospital radio</b> · {lead}</p>}
    <details>
      <summary>Bedside goals</summary>
      {patient && <ul>{tasks.map(task => <li key={task}>
        <span>{earned.includes(task) ? '✓' : '○'} {bedsideTasks[task].label}</span>
        <span>{earned.includes(task) ? 'Earned' : '+' + bedsideTasks[task].xp + ' XP'}</span>
      </li>)}</ul>}
      <p>Each bedside goal pays once per patient in this rotation.</p>
    </details>
  </section>;
}

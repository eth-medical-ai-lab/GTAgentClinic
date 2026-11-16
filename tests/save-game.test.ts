import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { earnBedsideXP, finishRotation, newRotation, type PlayerSave } from '../shared/saveGame';
import { NpcBrain } from '../server/npc/brain';
import { SaveSlots } from '../server/saveSlots';
import { debrief } from '../server/sim/scoring';
import { GameSession } from '../server/sim/session';
import { ShiftJournal } from '../server/sim/shiftJournal';
import { buildChart } from '../server/sim/views';

const owner = '9935d964-2327-4aa4-85d8-c89e7967ebde';
function solo() {
  return new ShiftJournal(new GameSession({ scenarioId: 'night_shift', playerName: 'Student', mode: 'realtime', seed: 77, brain: new NpcBrain(null) }), owner);
}

describe('manual shift saves', () => {
  it('reconstructs a pending lab, dialogue and the same debrief without a second provider call', async () => {
    const original = solo();
    const patient = original.session.presentPatients()[0];
    await original.act({ type: 'talk', npcId: 'pt_' + patient.id, text: 'What happened?' });
    await original.act({ type: 'order', patientId: patient.id, code: 'cbc' });
    original.tick(0.101);
    original.focus('ehr');
    original.settings({ timeScale: 3 });
    original.tick(0.104);
    expect(patient.orders.some(o => o.code === 'cbc')).toBe(true);
    expect(original.session.conversations.size).toBeGreaterThan(0);
    const restored = solo();
    const provider = vi.spyOn(restored.session.brain, 'reply');
    await restored.restore(JSON.parse(JSON.stringify(original.history)));
    expect(provider).not.toHaveBeenCalled();
    const other = restored.session.patients.get(patient.id)!;
    expect(buildChart(restored.session, other)).toEqual(buildChart(original.session, patient));
    expect(restored.session.conversations).toEqual(original.session.conversations);
    for (const j of [original, restored]) {
      await j.act({ type: 'wait', minutes: 120 });
      await j.act({ type: 'end_shift' });
    }
    expect(patient.orders.find(o => o.code === 'cbc')?.status).toBe('Resulted');
    expect(restored.session.log).toEqual(original.session.log);
    expect(debrief(restored.session)).toEqual(debrief(original.session));
  });

  it('reopens five independent files and detects stale overwrites', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'clinic-slots-'));
    try {
      const saves = new SaveSlots(dir);
      const j = solo();
      const player: PlayerSave = { rotation: newRotation(), camera: 'first', world: null };
      const data = { history: j.history, player, actions: [] };
      const meta = { map: 'Night Shift', clock: '22:00', ended: false };
      const first = saves.write(owner, 1, null, 'Before rounds', data, meta);
      await j.act({ type: 'wait', minutes: 20 });
      player.rotation.xp = 100;
      saves.write(owner, 2, null, '', data, meta);
      const afterRestart = new SaveSlots(dir);
      expect(afterRestart.list(owner)).toHaveLength(5);
      expect(afterRestart.read(owner, 1)?.player.rotation.xp).toBe(0);
      expect(afterRestart.read(owner, 2)?.history.entries).toHaveLength(1);
      expect(() => saves.write(owner, 1, null, 'Lost update', data, meta)).toThrow('changed');
      expect(saves.write(owner, 1, first.revision, 'After rounds', data, meta).name).toBe('After rounds');
      expect(() => saves.read(owner, 6)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('awards live goals once per patient and carries unlocks through a save and debrief', () => {
    const oldSave = { ...newRotation(), xp: 85 };
    const earned = earnBedsideXP(oldSave, 'p_one', 'history');
    expect(earned.xp).toBe(100);
    expect(earned.items).toEqual(['Surgeon’s vest']);
    const loaded = JSON.parse(JSON.stringify(earned));
    expect(earnBedsideXP(loaded, 'p_one', 'history')).toBe(loaded);
    const anotherPatient = earnBedsideXP(loaded, 'p_two', 'history');
    expect(anotherPatient.xp).toBe(115);
    expect(earnBedsideXP(anotherPatient, 'p_one', 'exam').xp).toBe(125);
    expect(finishRotation(earned, debrief(solo().session))).toEqual(earned);
    expect(oldSave.xp).toBe(85);
  });

  it('awards completed cases and personal improvements once on each independent rotation', () => {
    const d = debrief(solo().session);
    d.cases[0].disposition = 'discharge';
    d.cases[0].score = 60;
    d.cases[0].maxScore = 100;
    const fresh = newRotation();
    const earned = finishRotation(fresh, d);
    expect(earned.xp).toBe(110);
    expect(earned.items).toEqual(['Surgeon’s vest']);
    expect(finishRotation(earned, d)).toEqual(earned);
    expect(fresh.xp).toBe(0);
  });
});

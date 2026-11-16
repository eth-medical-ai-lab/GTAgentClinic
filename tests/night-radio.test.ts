import { describe, expect, it } from 'vitest';
import { collectRadioClue, nextRadioClue, RADIO_PIN, radioLead, recoverRadioClues } from '../shared/nightRadio';
import { newRotation } from '../shared/saveGame';
import { NpcBrain } from '../server/npc/brain';
import { GameSession } from '../server/sim/session';
import { ShiftJournal } from '../server/sim/shiftJournal';
import { buildView } from '../server/sim/views';

describe('the hospital radio story', () => {
  it('keeps the lead accurate while Dave is away from his post and after he returns', () => {
    const s = new GameSession({ scenarioId: 'night_shift', mode: 'realtime', seed: 3, playerName: 'Resident', brain: new NpcBrain(null) });
    const shifts = s.ambient.plan!.people.get('sec_dave')!.segs;
    const rotation = collectRadioClue(newRotation(), 'caf_luis');
    const leadAt = (t: number) => {
      s.t = t;
      return radioLead(rotation, buildView(s, s.brain.status).npcs);
    };
    expect(leadAt(0)).toContain('glass doors');
    expect(leadAt(shifts.find(seg => seg.look === 'amb_dog')!.t0)).toContain('dog carrier');
    expect(leadAt(shifts.find(seg => seg.room === 'hub')!.t0)).toContain('wheelchair');
    expect(leadAt(shifts.at(-1)!.t0)).toContain('glass doors');
  });

  it.each(['night_shift', 'orientation'])('keeps the three conversations and a single pin on %s', async scenarioId => {
    const make = () => new ShiftJournal(new GameSession({ scenarioId, mode: 'realtime', seed: 12, playerName: 'Resident', brain: new NpcBrain(null) }), 'player');
    const journal = make();
    let rotation = newRotation();
    expect(collectRadioClue(rotation, 'caf_rn_mei')).toBe(rotation);
    for (const npcId of ['caf_luis', 'sec_dave', 'caf_rn_mei']) {
      const step = nextRadioClue(rotation)!;
      expect(step.npc).toBe(npcId);
      expect(step.words.test(step.prompt)).toBe(true);
      const result = await journal.act({ type: 'talk', npcId, text: step.prompt, topic: 'night-radio' });
      expect(result.data).toMatchObject({ radioClue: npcId, offRecord: true });
      expect(result.text).toBe(step.reply);
      rotation = collectRadioClue(rotation, npcId);
    }
    expect(rotation.items).toEqual([RADIO_PIN]);
    expect(collectRadioClue(rotation, 'caf_rn_mei')).toBe(rotation);
    const restored = make();
    await restored.restore(JSON.parse(JSON.stringify(journal.history)));
    expect(restored.digest()).toBe(journal.digest());
    const conversations = buildView(restored.session, restored.session.brain.status).conversations;
    expect(recoverRadioClues(newRotation(), conversations).items).toEqual([RADIO_PIN]);
  });

  it('credits a previous save with the original three questions, even while the clock was paused', async () => {
    const s = new GameSession({ scenarioId: 'orientation', mode: 'realtime', seed: 12, playerName: 'Resident', brain: new NpcBrain(null) });
    for (const [npcId, text] of [['caf_luis', 'What music did the radio play?'], ['sec_dave', 'Who took the song requests?'], ['caf_rn_mei', 'The night frequency is clear.']]) {
      expect((await s.act({ type: 'talk', npcId, text })).ok).toBe(true);
    }
    const conversations = buildView(s, s.brain.status).conversations.reverse();
    expect(recoverRadioClues({ ...newRotation(), radioStoryVersion: undefined }, conversations).items).toEqual([RADIO_PIN]);
    expect(recoverRadioClues(newRotation(), conversations).items).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { ORDERS } from '../shared/catalog';
import { NpcBrain } from '../server/npc/brain';
import { GameSession, M } from '../server/sim/session';
import { offlineReply } from '../server/npc/offline';
import type { NpcSpec } from '../server/npc/prompts';

const nurse: NpcSpec = {
  key: 'nurse', kind: 'staff', name: 'Nurse', system: '', schema: {},
  factIds: [], counselIds: [], actionIds: ['verbal_order', 'stop_med', 'vitals_now', 'cultures_first'],
};
const context = { firstTurn: false, defaultBed: 'bed_2' };

describe('offline nurse orders', () => {
  it.each([
    ['Give aspirin for Bed 2.', 'aspirin'],
    ['Aspirin for Bed 2.', 'aspirin'],
    ['324 mg of aspirin.', 'aspirin'],
    ['Tom, 324 of aspirin for Bed 2.', 'aspirin'],
    ['Get a 12-lead ECG for Bed 2.', 'ecg12'],
    ['12-lead ECG for Bed 2.', 'ecg12'],
    ['Get an ECG.', 'ecg12'],
    ['Get a right-sided ECG.', 'ecg_right'],
  ])('takes the order "%s"', (text, code) => {
    expect(offlineReply(nurse, text, context).actions).toEqual([
      { id: 'verbal_order', code, patient: 'bed_2' },
    ]);
  });

  it.each([
    'Has aspirin been given?',
    'The patient is allergic to aspirin.',
    'What is the status of aspirin?',
    'Aspirin',
  ])('does not order from a mention alone: "%s"', (text) => {
    expect(offlineReply(nurse, text, context).actions).toEqual([]);
  });

  it('does not place an order while stopping a medication', () => {
    const reply = offlineReply({ ...nurse, actionIds: ['stop_med', 'verbal_order'] }, 'Stop aspirin for Bed 2.', context);
    expect(reply.actions).toEqual([{ id: 'stop_med' }]);
  });

  it('does not order when the staff member cannot take verbal orders', () => {
    expect(offlineReply({ ...nurse, actionIds: [] }, 'Give aspirin for Bed 2.', context).actions).toEqual([]);
  });
});

const supported = Object.values(ORDERS).filter(o => ['med', 'lab', 'nursing', 'ecg', 'supply'].includes(o.category));

describe('offline catalog coverage', () => {
  it.each(supported)('resolves the code and full name of $code without additional orders', order => {
    for (const key of [order.code, order.name]) {
      const route = order.med?.routes[0].split(' ')[0] ?? '';
      const reply = offlineReply(nurse, `Order ${key} ${route} for Bed 2.`, context);
      expect(reply.actions, `${key}: ${reply.say}`).toEqual([
        { id: order.code === 'vitals_now' ? 'vitals_now' : 'verbal_order',
          ...(order.code === 'vitals_now' ? {} : { code: order.code }), patient: 'bed_2' },
      ]);
    }
  });

  it.each(Object.values(ORDERS).filter(o => !supported.includes(o)))('directs unsupported $code to the EHR', order => {
    const reply = offlineReply(nurse, `Order ${order.name} for Bed 2.`, context);
    expect(reply.actions).toEqual([]);
    expect(reply.say).toMatch(/EHR/);
  });
});

describe('offline order disambiguation', () => {
  it.each([
    ['Recheck glucose.', 'glu_poc'], ['Check glucose.', 'glu_poc'], ['Get a glucose test.', 'glu_poc'],
    ['Measure blood sugar.', 'glu_poc'], ['Give oral glucose.', 'oral_glucose'],
    ['Order ceftriaxone IM.', 'ceftriaxone_im'], ['Give IM ceftriaxone.', 'ceftriaxone_im'],
    ['Give ceftriaxone intravenously.', 'ceftriaxone'], ['Give ceftriaxone I.M.', 'ceftriaxone_im'],
    ['Give paracetamol IV.', 'apap_iv'], ['Give acetaminophen IV.', 'apap_iv'], ['Give oral acetaminophen.', 'apap_po'],
    ['Give metoprolol PO.', 'metoprolol_po'], ['Give IV metoprolol.', 'metoprolol_iv'],
    ['Order oxygen via non-rebreather mask.', 'oxygen_nrb'],
    ['Start oxygen via nasal cannula.', 'o2_nc'], ['Start high-flow oxygen.', 'oxygen_nrb'],
    ['Order piperacillin–tazobactam.', 'pip_tazo'], ['Order PT/INR.', 'coags'],
    ['Order u&e.', 'bmp'], ['Order t&s.', 'type_screen'],
    ['Order lactated Ringer’s.', 'lr_bolus'], ['Get right-sided ECG.', 'ecg_right'],
    ['Order q15 vitals.', 'vitals_q15'],
  ])('resolves "%s"', (text, code) => {
    expect(offlineReply(nurse, text, context).actions).toEqual([{ id: 'verbal_order', code, patient: 'bed_2' }]);
  });

  it.each([
    'Get glucose.', 'Give paracetamol.', 'Give ceftriaxone.', 'Give acetaminophen.', 'Give metoprolol.', 'Give fluids.',
    'Check glucose and aspirin.', 'Give aspirin and magnesium.', 'Give an antibiotic.', 'Order aspirin or clopidogrel.', 'Order aspirin and an unknown treatment.', "Don't give aspirin for Bed 2.", 'Order aspirin and fluids.', 'Order oxygen via nasal cannula and NRB.',
    'Order oxygen via an unknown device.', 'Order oxygen via mask.', 'Order oxygen by simple mask.', 'Order high-flow oxygen via nasal cannula.', 'Order oxygen via Venturi mask.', 'Order an unknown treatment.', 'Give PO aspirin and IV ceftriaxone.',
  ])('clarifies "%s" before entering any order', text => {
    const reply = offlineReply(nurse, text, context);
    expect(reply.actions).toEqual([]);
    expect(reply.say).toMatch(/which|specify|clarify|separate/i);
  });

  it.each(['Give ondansetron ODT.', 'Give oral metronidazole.', 'Give haloperidol IM.', 'Give aspirin rectally.', 'Give aspirin per rectum.', 'Give metronidazole per os.', 'Give aspirin injection.', 'Give aspirin topically.', 'Give aspirin by inhalation.', 'Give aspirin enterally.', 'Give aspirin via NG tube.', 'Give aspirin via an unknown route.'])('requires the EHR for "%s"', text => {
    const reply = offlineReply(nurse, text, context);
    expect(reply.actions).toEqual([]);
    expect(reply.say).toMatch(/EHR.*route/);
  });

  it('preserves IV access requested alongside an explicit oxygen device', () => {
    expect(offlineReply(nurse, 'Order IV access and oxygen via nasal cannula.', context).actions.map(a => a.code)).toEqual(['iv_access', 'o2_nc']);
  });

  it('can resolve several independent orders together', () => {
    expect(offlineReply(nurse, 'Order CBC and BMP and an ECG.', context).actions.map(a => a.code)).toEqual(['cbc', 'bmp', 'ecg12']);
  });

  it.each(['Has aspirin been given for bed 2?', 'What is the status of aspirin for Bed 2?', 'Please check whether aspirin was given.'])('does not treat a status question as an order: %s', text => {
    expect(offlineReply(nurse, text, context).actions).toEqual([]);
  });
});

const locations = {
  firstTurn: false, defaultBed: 'bed_2', beds: [
    { bed: 'bed_2', label: 'Bed 2', lastName: 'Jones' },
    { bed: 'hall_1', label: 'Hall 1', lastName: 'Smith' },
    { bed: 'ft_2', label: 'Fast Track 2', lastName: 'Smith' },
    { bed: 'resus', label: 'Resus 3', lastName: 'Brown' },
  ],
};
describe('offline patient selection', () => {
  it.each([['Hall 1', 'hall_1'], ['Fast-Track 2', 'ft_2'], ['Resus 3', 'resus'], ['Room 2', 'bed_2'], ['Brown', 'resus']])('resolves known %s', (label, bed) => {
    expect(offlineReply(nurse, `Order CBC for ${label}.`, locations).actions).toEqual([{ id: 'verbal_order', code: 'cbc', patient: bed }]);
  });
  it.each(['Hall 9', 'Smith', 'Bed 2 and Hall 1', 'Brown in Bed 2', 'Bed two', 'Resus', 'Bed 2 and Resus', 'Smithson', 'patient Evans', 'Mr Evans'])('clarifies %s without using the default patient', label => {
    const reply = offlineReply(nurse, `Order CBC for ${label}.`, locations);
    expect(reply.actions).toEqual([]);
    expect(reply.say).toMatch(/which patient/i);
  });
});

describe('offline nurse orders in the simulation', () => {
  it.each([['Check glucose for Fast Track 1.', 'glu_poc'], ['Give IM ceftriaxone for Fast Track 1.', 'ceftriaxone_im']])('applies only the intended order: %s', async (text, code) => {
    const session = new GameSession({ scenarioId: 'orientation', seed: 9, playerName: 'Test', mode: 'step', brain: new NpcBrain(null) });
    const patient = [...session.patients.values()].find(p => p.bed === 'ft_1')!;
    await session.act({ type: 'move', to: session.staff.get('rn_aisha')!.location });
    expect((await session.act({ type: 'talk', npcId: 'rn_aisha', text })).ok).toBe(true);
    expect(patient.orders.map(o => o.code)).toEqual([code]);
    if (code === 'ceftriaxone_im') expect(patient.orders[0].params?.route).toBe('IM');
    session.advance(60 * M);
    if (code === 'glu_poc') {
      expect(patient.labs.some(l => l.analyte === 'glu_poc')).toBe(true);
      expect(patient.mar.some(m => /glucose/i.test(m.med))).toBe(false);
    } else {
      expect(patient.mar.filter(m => /ceftriaxone/i.test(m.med))).toHaveLength(1);
      expect(patient.mar.find(m => /ceftriaxone/i.test(m.med))?.route).toBe('IM');
    }
  });
});

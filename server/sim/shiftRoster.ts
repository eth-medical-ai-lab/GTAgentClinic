import { CASES, SCENARIOS } from '../../content/scenarios';
import type { CaseDef, ScenarioDef } from '../../content/types';
import type { MapSummary } from '../../shared/types';
import { HALL_BEDS } from '../../shared/layout';
import { hashSeed, Rng } from './rng';

// Use the chart complaint at the front desk. Internal case IDs and teaching titles can give away the diagnosis.
export const practiceId = (caseId: string) => 'practice_' + hashSeed('practice', caseId).toString(36);
const cases = Object.values(CASES).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const practice = new Map(cases.map(c => [practiceId(c.id), c]));
if (practice.size !== cases.length) throw new Error('Practice map ID collision');

/** A tester can look up a known diagnosis or case ID from the practice picker. */
export function findPracticeCases(input: string) {
  const query = input.trim().toLowerCase();
  if (!query) return [];
  // Keep short diagnostic abbreviations usable without listing every word containing those letters.
  const matches = (value: string) => query.length < 3 ? value.toLowerCase() === query : value.toLowerCase().includes(query);
  return cases.filter(c => matches(c.id) || [c.truth.diagnosis.label, ...c.truth.diagnosis.accept].some(matches))
    .map(c => ({ mapId: practiceId(c.id), diagnosis: c.truth.diagnosis.label }));
}

const difficulty = ['easy', 'medium', 'hard'] as const;
const daytime = SCENARIOS.orientation;
const rosterContacts = daytime.internalContacts;
// Scripted-shift staff chatter mentions their original patients and rooms.
const intakeBarks: Record<string, string[]> = {
  rn_rosa: ['Which beds will be ready for the next arrivals?', 'Let me know when transport is on the way.'],
  rn_tom: ['Can someone grab the ECG cart?', 'Does anyone have a spare lead set?'],
  rn_aisha: ['I can draw those labs on my next round.', 'Let me know who needs a handoff.'],
  tech_marcus: ['Clean stretcher ready.', 'The ECG cart is plugged in.'],
  att_shaw: ['Come find me if you need a second pair of eyes.', 'Who on the board needs you first?'],
};
const rosterStaff = daytime.staff.map(s => intakeBarks[s.id] ? { ...s, barks: intakeBarks[s.id] } : s);
const roomPool = daytime.staff.flatMap(st => (st.assigned ?? [])
  .filter(bed => /^bed_\d+$/.test(bed))
  .map(bed => ({ bed, nurseId: st.id })));

const surgeRooms = [...roomPool, { bed: 'resus', nurseId: 'rn_tom' },
  ...['resus_1', 'resus_2'].map(bed => ({ bed, nurseId: 'rn_resus' })),
  ...['ft_1', 'ft_2'].map(bed => ({ bed, nurseId: 'rn_fast' }))];
const surgeHall = HALL_BEDS.map((bed, i) => ({ bed, nurseId: i < 3 ? 'rn_hall' : 'rn_fast' }));
const surgePool = [...surgeRooms, ...surgeHall];
const openingHall = 3;
const surgeStaff = [...rosterStaff, ...[
  ['rn_resus', 'Alex', 'Resuscitation RN', 'rn_tom', 'resus_2'],
  ['rn_fast', 'Jo', 'Fast-track RN', 'rn_aisha', 'ft_2'],
  ['rn_hall', 'Robin', 'Hallway RN', 'rn_rosa', 'hall_2'],
].map(([id, name, title, template, room]) => ({
  ...rosterStaff.find(s => s.id === template)!, id, name, title, home: { room, spot: 'bedside' },
  persona: { personality: 'An experienced ED nurse. Give a concise bedside handoff.', voice: 'Calm, concise.', rules: rosterStaff.find(s => s.id === 'rn_tom')!.persona!.rules },
  barks: ['I’ll check the next patient on my assignment.'],
}))].map(st => ({ ...st, assigned: surgePool.some(r => r.nurseId === st.id) ? surgePool.filter(r => r.nurseId === st.id).map(r => r.bed) : st.assigned }));

const common = { shiftStart: daytime.shiftStart, layoutId: daytime.layoutId, learningGoals: [] };
function practiceSummary(id: string, c: CaseDef): MapSummary {
  return {
    ...common, id, kind: 'practice', title: c.presentation.chiefComplaint, subtitle: 'Individual practice',
    difficulty: difficulty[c.difficulty - 1], patients: 1, durationMin: 240, specialty: c.specialty,
    description: `${c.patient.age}-year-old patient · ${c.presentation.arrivalMode} · ESI ${c.presentation.esi}`,
  };
}

function mixedSummary(id: string, count: number): MapSummary {
  const marathon = id === 'mixed_roster';
  return {
    ...common, layoutId: marathon ? 'ed_surge' : common.layoutId, id, kind: 'mixed', difficulty: 'hard', patients: count,
    title: marathon ? 'Full Roster' : 'Mixed Shift',
    subtitle: marathon ? `${count} patients · crowded ED` : `${count} patients · six treatment bays`,
    description: marathon
      ? 'Start with all 11 ED treatment spaces and three hallway stretchers occupied. More patients arrive through the public and ambulance entrances.'
      : 'Two patients are already roomed. More arrive throughout the shift, from routine complaints to emergencies.',
    durationMin: marathon ? count * 60 : 480,
  };
}

export const mapSummaries: MapSummary[] = [
  ...Object.values(SCENARIOS).map(s => ({
    id: s.id, title: s.title, subtitle: s.subtitle, difficulty: s.difficulty, description: s.description,
    patients: s.patients.length, shiftStart: s.shiftStart, durationMin: s.durationMin, layoutId: s.layoutId, learningGoals: s.learningGoals,
  })),
  mixedSummary('mixed_shift', Math.min(12, cases.length)), mixedSummary('mixed_roster', cases.length),
  ...Array.from(practice, ([id, c]) => practiceSummary(id, c)).sort((a, b) => a.title.localeCompare(b.title)),
];
export const mapIds = mapSummaries.map(m => m.id);
const maps = new Map(mapSummaries.map(m => [m.id, m]));

function shuffle<T>(items: T[], rng: Rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A short shift draws from all difficulties; neither order nor room reveals the difficulty. */
function drawCases(count: number, rng: Rng): CaseDef[] {
  const deck = shuffle([...cases], rng);
  if (count >= deck.length) return deck;
  const tiers = [1, 2, 3].map(level => deck.filter(c => c.difficulty === level));
  const picks: CaseDef[] = [];
  while (picks.length < count) {
    for (const tier of tiers) {
      const next = tier.pop();
      if (next) picks.push(next);
      if (picks.length === count) break;
    }
  }
  return shuffle(picks, rng);
}

export function resolveScenario(id: string, seed: number, savedRoster?: ScenarioDef['patients']): ScenarioDef | undefined {
  const map = maps.get(id);
  if (!map) return;
  if (!map.kind) return SCENARIOS[id];
  const rng = new Rng(hashSeed(seed, id, 'intake'));
  // Earlier saves used only six bays. Preserve their original intake, layout and replay.
  const surge = id === 'mixed_roster' && (!savedRoster || savedRoster.some(p => HALL_BEDS.some(bed => bed === p.bed)));
  const bedPool = surge ? [...surgePool] : shuffle([...roomPool], rng);
  const opening = surge ? surgeRooms.length + openingHall : 2;
  let arriveAtMin = 0;
  const one = practice.get(id);
  const deck = savedRoster ? [] : one ? [one] : drawCases(map.patients, rng);
  if (surge && !savedRoster) {
    // Choose from the seeded deck. Resus gets the sickest arrivals, the hall stable adults.
    for (let i = 0; i < opening; i++) {
      const bed = bedPool[i].bed;
      const withFamily = bed === 'bed_2' || bed === 'bed_5';
      const j = deck.findIndex((c, j) => {
        if (j < i) return false;
        const hasVisitor = !!c.family && c.family.arrivesAtMin === undefined;
        if (withFamily) return hasVisitor;
        if (i < 5 && hasVisitor) return false;
        if (bed.startsWith('resus')) return c.presentation.esi <= 2;
        if (bed.startsWith('hall_') || bed.startsWith('ft_')) return c.presentation.esi >= 3 && !c.family && !c.precautions;
        return true;
      });
      if (j >= 0) [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  const patients = savedRoster ?? deck.map((c, i) => {
    if (i >= opening) arriveAtMin += rng.int(4, 9);
    return { caseId: c.id, ...bedPool[i % bedPool.length], arriveAtMin };
  });
  const intro = one ? 'Your patient is ready. Open the tracking board for the assigned bay.'
    : surge ? 'All treatment rooms are occupied. Three patients are on hallway stretchers. The tracking board lists each patient and assigned nurse.'
    : `${patients.length} patients on this roster. Six bays are staffed. Check the board for new arrivals and free beds by completing dispositions.`;
  return {
    id, title: map.title, subtitle: map.subtitle, description: map.description, difficulty: map.difficulty,
    ...common, durationMin: id === 'mixed_roster' ? patients.length * 60 : map.durationMin, defaultTimeScale: 6,
    layoutId: surge ? 'ed_surge' : common.layoutId, staff: surge ? surgeStaff : rosterStaff, internalContacts: rosterContacts, bedPool, patients, events: [], errors: [],
    intro: [{ from: 'Charge RN', text: intro }],
  };
}

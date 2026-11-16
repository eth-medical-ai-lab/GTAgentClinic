import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { libraryCase } from '../content/library';
import { CASES } from '../content/scenarios';
import type { Rule } from '../content/types';
import { ANALYTES, EXAM_BY_ID, ORDERS } from '../shared/catalog';
import { NpcBrain } from '../server/npc/brain';
import { caseDebrief } from '../server/sim/scoring';
import { GameSession } from '../server/sim/session';
import { practiceId, resolveScenario } from '../server/sim/shiftRoster';

// A misspelled code in content still typechecks, but makes an investigation or a scoring
// checkpoint unreachable. Walk the same rule tree used for both handoffs and debriefs.
function* leaves(rule: Rule): Generator<Rule> {
  switch (rule.type) {
    case 'any': case 'all':
      for (const child of rule.rules) yield* leaves(child);
      break;
    case 'before': yield* leaves(rule.first); yield* leaves(rule.then); break;
    case 'if': yield* leaves(rule.cond); yield* leaves(rule.then); break;
    case 'not': yield* leaves(rule.rule); break;
    default: yield rule;
  }
}

const cases = Object.values(CASES);
const orderables = Object.values(ORDERS);
const testable = new Set(orderables.flatMap(o => o.analytes ?? []));
const drugTags = new Set(orderables.flatMap(o => o.med?.tags ?? []));

describe('playable case bank', () => {
  it('credits collateral from a witness, a bottle and a verified pharmacy call in three separate encounters', async () => {
    const start = (id: string) => {
      const s = new GameSession({ scenarioId: practiceId(id), seed: 5, brain: new NpcBrain(null), mode: 'step', playerName: 'Resident' });
      return { s, p: s.presentPatients()[0] };
    };
    const witness = start('transient_global_amnesia');
    await witness.s.act({ type: 'move', to: witness.p.bed });
    const interview = await witness.s.act({ type: 'talk', npcId: witness.p.c.family!.npcId, text: 'When was he last well? What happened at onset?' });
    expect(interview.text).toContain('what day it was');
    expect(caseDebrief(witness.s, witness.p).items.find(i => i.label.includes('onset with the witness'))?.ok).toBe(true);

    const bottle = start('thiazide_hyponatremia');
    await bottle.s.act({ type: 'move', to: bottle.p.bed });
    const label = await bottle.s.act({ type: 'inspect', itemId: 'recent_prescription' });
    expect(label.text).toContain('Hydrochlorothiazide');
    expect(caseDebrief(bottle.s, bottle.p).items.find(i => i.label.includes('dispensed drug'))?.ok).toBe(true);

    const { s, p } = start('breakthrough_seizure_refill');
    const phone = (text: string) => s.act({ type: 'call', contactId: 'rx_counter', text });
    await s.act({ type: 'move', to: 'station' });
    const unverified = await phone('What dose was dispensed?');
    expect(unverified.text).not.toContain('levetiracetam');
    expect(p.revealed.has('verified_regimen')).toBe(false);
    const { firstName, lastName, dob } = p.c.patient;
    expect((await phone(`${firstName} ${lastName}, born ${dob}. Can you verify the regimen and refill?`)).text).toContain('levetiracetam');
    expect(caseDebrief(s, p).items.find(i => i.label.includes('with the pharmacy'))?.ok).toBe(true);
  });
  it('tracks the origin of every encounter, separately from its teaching references', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(cases.map(c => c.patient.mrn)).size).toBe(cases.length);
    for (const { id, provenance: p } of cases) {
      expect(existsSync(new URL('../' + p.file, import.meta.url)), id + ': source record').toBe(true);
      expect(p.method.trim(), id).toBeTruthy();
      if (p.kind === 'legacy') continue;
      expect(p.author.kind, id).not.toBe('unknown');
      if (p.author.kind === 'ai') expect(p.author.model.trim(), id).toBeTruthy();
      if (p.kind === 'adapted') {
        expect(p.recordId, id).toBeTruthy();
        expect(p.source.license, id).toBeTruthy();
        if (p.file.startsWith('content/library/')) expect(libraryCase(p.recordId)?.source, id).toEqual(p.source);
      }
    }
  });

  it('makes authored clues and scored actions accessible in the game', () => {
    for (const c of cases) {
      const assert = (ok: unknown, key: string) => expect(ok, c.id + ': ' + key).toBeTruthy();
      const people = [c.persona, ...(c.family ? [c.family.persona] : []), ...(c.phoneContacts ?? []).map(x => x.persona)];
      const facts = new Set(people.flatMap(p => p.facts.map(f => f.id)));
      const counsel = new Set(people.flatMap(p => p.counseling?.map(x => x.id) ?? []));
      const scenario = resolveScenario(practiceId(c.id), 0)!;
      const contacts = new Set([...scenario.internalContacts, ...(c.phoneContacts ?? [])].map(x => x.contact.id));
      assert(facts.size && Object.keys(c.exam).length && c.scoring.critical.length, 'missing history, exam or decisions');
      for (const id of Object.keys(c.exam)) assert(EXAM_BY_ID[id], id);
      for (const id of Object.keys(c.labs)) assert(ANALYTES[id] && testable.has(id), id);
      for (const id of Object.keys(c.imaging)) assert(ORDERS[id]?.category === 'imaging', id);
      for (const consult of c.consults) assert(contacts.has(consult.contactId), consult.contactId);
      const rules = [...c.scoring.critical, ...c.scoring.harms].map(x => x.rule);
      for (const consult of c.consults) if (consult.guard) rules.push(consult.guard);
      for (const step of rules) for (const rule of leaves(step)) {
        if ('codes' in rule) for (const code of rule.codes ?? []) assert(ORDERS[code], code);
        if (rule.type === 'given') for (const tag of rule.tags ?? []) assert(drugTags.has(tag), tag);
        if (rule.type === 'exam') for (const id of rule.maneuvers) assert(EXAM_BY_ID[id], id);
        if (rule.type === 'counseled') for (const id of rule.ids) assert(counsel.has(id), id);
        if (rule.type === 'fact') for (const id of rule.factIds) assert(facts.has(id), id);
        if (rule.type === 'called') for (const id of rule.contactIds) assert(contacts.has(id), id);
        if (rule.type === 'consult') assert(c.consults.some(x => x.contactId === rule.contactId), rule.contactId);
      }
    }
  });
});

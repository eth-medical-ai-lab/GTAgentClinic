import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { DEMO_VOICES, clipName, demoQuestions, demoReply, recordedParts, scriptSentences, sentences } from '../client/src/demo/dialogue';
import { TOUR_START } from '../client/src/demo/charts';
import { DemoTransport } from '../client/src/demo/transport';
import type { ChatLine, NpcView, PlayerView, ServerMsg } from '../shared/types';

/** a conversation with one person: what they say back, with their memory of it */
function talkTo(id: string) {
  const lines: ChatLine[] = [];
  return (text: string) => {
    lines.push({ id: String(lines.length), t: 0, speaker: 'player', name: 'You', text });
    const reply = demoReply(id, text, lines);
    lines.push({ id: String(lines.length), t: 0, speaker: 'npc', name: id, text: reply });
    return reply;
  };
}

describe('browser demo', () => {
  it.each(Object.entries(DEMO_VOICES))('ships every sentence %s can say, recorded in the assigned voice, and nothing else', (id, folder) => {
    const files = readdirSync(new URL(`../client/public/res/audio/${folder}/`, import.meta.url)).filter(f => f.endsWith('.mp3')).sort();
    expect(files).toEqual([...new Set([...scriptSentences(id)].map(clipName))].sort());
  });

  it('splits lines into the sentences that are recorded', () => {
    expect(sentences("Mr. Keller's pressure is 96. Temperature 38.9! ...Okay. Dr. Shaw?")).toEqual(["Mr. Keller's pressure is 96.", 'Temperature 38.9!', '...Okay.', 'Dr. Shaw?']);
  });

  it('answers the history questions a clinician asks, as the full game’s Mr. Keller would', () => {
    const keller = (q: string) => demoReply('pt_p_keller', q, []);
    expect(keller('Any allergies?')).toMatch(/No allergies/);
    expect(keller('What medications do you take?')).toMatch(/Metformin.*lisinopril.*quit it/);
    expect(keller('When did the pain start?')).toMatch(/quarter to ten/);
    expect(keller('Where does it hurt?')).toMatch(/middle of my chest.*left arm.*jaw/);
    expect(keller('Does it get worse when you breathe in?')).toMatch(/doesn't change/);
    expect(keller('Is it a tearing pain going to your back?')).toMatch(/Not going through to my back/);
    expect(keller('Any family history of heart disease?')).toMatch(/fifty-eight/);
    expect(keller('Did you take anything for it?')).toMatch(/Took nothing/);
    expect(keller('Do you smoke?')).toMatch(/pack a day/);
  });

  it('answers greetings, introductions, thanks, kind words and goodbyes as such, not with a story', () => {
    expect(demoReply('fam_linda', 'Thanks, see you later', [])).toMatch(/come back/);
    expect(demoReply('tech_marcus', 'Hi, nice to meet you', [])).toMatch(/^Marcus\. Nice to meet you/);
    expect(demoReply('cards', 'thanks for the call', [])).toMatch(/Call me if anything changes/);
    expect(demoReply('pt_p_keller', "Don't worry, we'll take good care of you.", [])).toMatch(/Appreciate that/);
    expect(demoReply('fam_linda', 'What is your name?', [])).toMatch(/^Linda Keller/);
    // a greeting with a question gets the answer
    expect(demoReply('pt_p_keller', 'Hi, any allergies?', [])).toMatch(/No allergies/);
  });

  it('keeps the afternoon pill to be asked for: never suggested or volunteered, told when asked', () => {
    const keller = { id: 'pt_p_keller' } as NpcView;
    const ask = talkTo('pt_p_keller');
    const replies = Array.from({ length: 40 }, () => ask('Hmm, okay.'));
    expect(replies.some(r => /sildenafil|blue pill/i.test(r))).toBe(false);
    expect(demoQuestions(keller).some(q => /pill|viagra/i.test(q))).toBe(false);
    expect(ask('Any other medications, even ones you take occasionally?')).toMatch(/Sildenafil/);
    expect(demoReply('fam_linda', 'Does he take Viagra?', [])).toMatch(/I don't think so/);
  });

  it('remembers what was said: repeats in short, moves on when asked, deflects in character', () => {
    const ask = talkTo('pt_p_keller');
    const first = ask('What brought you in tonight?');
    expect(ask('What brought you in tonight?')).toBe('Like I said, Doc. An elephant on my chest.');
    expect(ask('Anything else?')).toMatch(/quarter to ten/); // the next thing he has not said yet
    const a = ask('What is the capital of France?');
    const b = ask('Tell me about quantum physics.');
    expect(a).not.toMatch(/not sure I follow|don't understand/i);
    expect(a.split('.')[0]).not.toBe(b.split('.')[0]); // a different deflection each time
    expect([a, b].every(r => !r.includes(first))).toBe(true); // and something new, not the opening again
  });

  it('suggests what has not been answered yet', () => {
    const marcus = { id: 'tech_marcus' } as NpcView;
    const lines: ChatLine[] = [{ id: '1', t: 0, speaker: 'npc', name: 'Marcus', text: demoReply('tech_marcus', 'Where should I start?', []) }];
    expect(demoQuestions(marcus)[0]).toBe('Where should I start?');
    expect(demoQuestions(marcus, lines)).not.toContain('Where should I start?');
  });

  it('voices every reply of a recorded speaker from recordings, deflections included', () => {
    for (const id of Object.keys(DEMO_VOICES)) {
      const ask = talkTo(id);
      for (const q of ['Hello', 'Thanks', 'What is the capital of France?', 'Anything else?', 'Is that right?', 'Bye', 'Nice to meet you', 'Sorry to hear that'])
        expect(recordedParts(id, ask(q)), `${id}: ${q}`).not.toBeNull();
    }
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function enter() {
    let view!: PlayerView;
    const messages: ServerMsg[] = [];
    const demo = new DemoTransport(msg => {
      if (msg.type === 'state') view = msg.view;
      messages.push(msg);
    });
    const start = () => demo.send({ type: 'start', mapId: 'browser_demo', playerName: 'Resident' });
    demo.connect();
    start();
    return { demo, messages, start, state: () => view };
  }

  it('gives every visible speaker distinct, scripted answers to their chips', () => {
    const { state } = enter();
    for (const npc of state().npcs.filter(n => n.visible && n.talkable)) {
      const prompts = demoQuestions(npc);
      expect(prompts.length, npc.id).toBeGreaterThan(1);
      const replies = prompts.map(q => demoReply(npc.id, q, []));
      expect(new Set(replies).size, npc.id).toBe(prompts.length);
      expect(replies.every(reply => !/not sure I follow|don't understand/i.test(reply)), npc.id).toBe(true);
    }
  });

  it('starts each visit with browser speech enabled and supports muting until re-entry', () => {
    const { demo, messages, state, start } = enter();
    expect(state().settings.tts).toBe(true);
    demo.send({ type: 'settings', settings: { tts: false } });
    expect(state().settings.tts).toBe(false);
    demo.send({ type: 'settings', settings: { tts: true } });
    demo.send({ type: 'action', action: { type: 'talk', npcId: 'tech_marcus', text: 'Hello' } });
    const line = messages.find(m => m.type === 'event' && m.event.kind === 'speech');
    expect(line).toMatchObject({ type: 'event', event: { kind: 'speech', npcId: 'tech_marcus', voice: { id: 'am_eric' }, lineId: state().conversations[0].lines.at(-1)?.id } });
    expect(line).not.toHaveProperty('event.voice.clips');
    demo.send({ type: 'settings', settings: { tts: false } });
    demo.send({ type: 'leave_solo' });
    start();
    expect(state().settings.tts).toBe(true);
  });

  it('shows authored exam findings and records a plan for the examined patient', () => {
    const { demo, state, messages } = enter();
    const patientId = 'p_okafor';
    demo.send({ type: 'action', action: { type: 'examine', patientId, maneuver: 'msk_lat_malleolus' } });
    expect(state().examFindings[patientId][0].text).toContain('anterior talofibular ligament');
    demo.send({ type: 'action', action: { type: 'set_diagnoses', patientId, diagnoses: ['Ankle injury'] } });
    demo.send({ type: 'action', action: { type: 'disposition', patientId, decision: 'discharge', diagnoses: ['Ankle injury'], instructions: 'Follow up.' } });
    demo.send({ type: 'chart', patientId });
    expect(messages.at(-1)).toMatchObject({ type: 'chart', chart: { id: patientId, diagnoses: ['Ankle injury'], disposition: { decision: 'discharge', instructions: 'Follow up.' } } });
    expect(state().board.find(r => r.id === patientId)?.dispo).toBe('discharge');
  });

  it('retains Keller’s signed ECG after reopening his chart and rejects a second signature', () => {
    const { demo, messages, state } = enter();
    const sign = (interpretation: string) => demo.send({ type: 'action', action: { type: 'sign_ecg', ecgId: 'ecg1', interpretation } });
    sign('  ');
    expect(messages.at(-1)).toMatchObject({ type: 'actionResult', result: { ok: false } });
    sign('Reviewed tracing');
    expect(messages.at(-1)).toMatchObject({ type: 'actionResult', result: { ok: true } });
    sign('Replacement');
    expect(messages.at(-1)).toMatchObject({ type: 'actionResult', result: { ok: false } });
    demo.send({ type: 'chart', patientId: 'p_keller' });
    expect(messages.at(-1)).toMatchObject({ type: 'chart', chart: { ecgs: [{ physicianRead: 'Reviewed tracing', signedAt: state().t }] } });
  });

  it('opens at 22:20 with charts that end there: Keller’s ECG three minutes old and unsigned, nothing ordered by you', () => {
    const { state, messages } = enter();
    expect(state().t).toBe(TOUR_START);
    const charts = messages.filter(m => m.type === 'chart').map(m => m.type === 'chart' ? m.chart : null).filter(c => !!c);
    expect(charts.map(c => c.id).sort()).toEqual(['p_brunner', 'p_keller', 'p_okafor']);
    for (const c of charts) {
      const times = [c.arrivedAt, ...c.vitals.map(v => v.t), ...c.notes.map(n => n.t), ...c.ecgs.map(e => e.acquiredAt), ...c.mar.map(m => m.t),
        ...c.orders.flatMap(o => [o.placedAt, o.collectedAt, o.completedAt, o.resultedAt]), ...c.labs.filter(l => !l.historical).map(l => l.resultedAt)];
      expect(Math.max(...times.filter((t): t is number => t !== undefined)), c.id).toBeLessThanOrEqual(TOUR_START);
      expect(c.orders.filter(o => o.placedBy === 'You'), c.id).toEqual([]);
    }
    const keller = charts.find(c => c.id === 'p_keller')!;
    expect(keller.ecgs[0].signedAt).toBeUndefined();
    expect(TOUR_START - keller.ecgs[0].acquiredAt).toBeLessThan(10 * 60);
    expect(keller.vitals.at(-1)).toMatchObject({ hr: 52, sbp: 96, dbp: 60 }); // as Tom says, and the monitor shows
    expect(state().monitors.bed_2).toMatchObject({ hr: 52, sbp: 96, dbp: 60 });
  });

  it('pages you about the ECG, and the page can be acknowledged', () => {
    const { demo, state, messages } = enter();
    expect(state().pages).toMatchObject([{ id: 'pg_ecg', read: false, patientId: 'p_keller' }]);
    demo.send({ type: 'action', reqId: 'r1', action: { type: 'ack_page', pageId: 'pg_ecg' } });
    expect(messages.at(-1)).toMatchObject({ type: 'actionResult', result: { ok: true } });
    expect(state().pages[0].read).toBe(true);
  });

  it('records diagnoses and dispositions by the rules of a shift (GameSession)', () => {
    const { demo, state, messages } = enter();
    const act = (action: Record<string, unknown>) => {
      demo.send({ type: 'action', action: action as never });
      return messages.at(-1);
    };
    act({ type: 'set_diagnoses', patientId: 'p_keller', diagnoses: [' STEMI ', 'STEMI', '', ...Array.from({ length: 12 }, (_, i) => `dx ${i}`)] });
    demo.send({ type: 'chart', patientId: 'p_keller' });
    const chart = messages.at(-1);
    expect(chart?.type === 'chart' && chart.chart.diagnoses).toEqual(['STEMI', 'STEMI', ...Array.from({ length: 8 }, (_, i) => `dx ${i}`)]);
    expect(act({ type: 'disposition', patientId: 'p_keller', decision: 'admit_icu', diagnoses: [] })).toMatchObject({ result: { ok: true } });
    expect(act({ type: 'disposition', patientId: 'p_keller', decision: 'cath_lab', diagnoses: ['Inferior STEMI'] })).toMatchObject({ result: { ok: true } });
    expect(act({ type: 'disposition', patientId: 'p_keller', decision: 'discharge', diagnoses: [] })).toMatchObject({ result: { ok: false } });
    expect(state().board.find(r => r.id === 'p_keller')?.dispo).toBe('cath_lab');
  });

  it('keeps bedside and phone threads separate, stops the clock on leaving, and starts fresh', () => {
    const { demo, state, messages, start } = enter();
    const initial = state();
    expect(messages[0]).toMatchObject({ type: 'welcome', tts: 'browser' });
    demo.send({ type: 'action', action: { type: 'talk', npcId: 'pt_p_keller', text: 'Where does it hurt?' } });
    demo.send({ type: 'action', action: { type: 'call', contactId: 'lab', text: '__dial__' } });
    demo.send({ type: 'action', action: { type: 'hangup', contactId: 'lab' } });
    expect(state().conversations.find(c => c.key === 'pt_p_keller')?.lines.at(-1)?.text).toContain('jaw');
    expect(state().conversations.find(c => c.key === 'phone:lab')?.lines.map(line => line.speaker)).toEqual(['npc', 'system']);
    expect(messages.filter(m => m.type === 'event' && m.event.kind === 'speech')).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(state().t).toBe(initial.t + 2);
    demo.send({ type: 'leave_solo' });
    const count = messages.length;
    vi.advanceTimersByTime(3000);
    expect(messages.length).toBe(count);
    start();
    expect(state().sessionId).not.toBe(initial.sessionId);
    expect(state().conversations).toEqual([]);
    expect(state().t).toBe(initial.t);
    vi.advanceTimersByTime(1000);
    expect(state().t).toBe(initial.t + 1);
  });
});

/**
 * Who is speaking, and with which authored voice? Resolves a speech event to the `voice` cast in
 * content (StaffDef / FamilyDef / PhoneContactDef / case patient). Nothing is inferred from names:
 * patients without a casting fall back on their chart sex and age; anyone else uncast gets a
 * fixed default and a one-time warning (tests require casting for all shipped content).
 */
import { CHAT_VOICES } from '../../content/smalltalk';
import type { PhoneContactDef } from '../../content/types';
import type { GameEvent } from '../../shared/types';
import { UNCAST_VOICE, ageSpeed, clampSpeed, defaultPatientVoice, isKokoroVoice, type KokoroVoiceId, type TtsVoice } from '../../shared/voices';
import type { GameSession } from '../sim/session';

export type SpeechEvent = Extract<GameEvent, { kind: 'speech' }>;

export interface Cast {
  id: KokoroVoiceId;
  speed: number;
  /** phone line (the client applies a telephone band-pass) */
  phone: boolean;
}

const warned = new Set<string>();

function uncast(who: string): Cast {
  if (!warned.has(who)) {
    warned.add(who);
    console.warn(`[tts] no voice cast for ${who} — add \`voice: { id: ... }\` in content/ (using ${UNCAST_VOICE.id})`);
  }
  return { ...UNCAST_VOICE, phone: false };
}

function authored(v: TtsVoice | undefined, fallbackSpeed: number, phone = false): Cast | null {
  if (!v || !isKokoroVoice(v.id)) return null;
  return { id: v.id, speed: clampSpeed(v.speed ?? fallbackSpeed), phone };
}

export function phoneContact(s: GameSession, contactId: string): PhoneContactDef | undefined {
  return s.scenario.internalContacts.find((c) => c.contact.id === contactId) ?? s.playerContacts.get(contactId);
}

export function castVoice(s: GameSession, e: SpeechEvent): Cast {
  if (e.contactId) {
    const pc = phoneContact(s, e.contactId);
    if (!pc) return { ...uncast(`contact ${e.contactId}`), phone: true };
    // the scripted opening may be someone else (an answering service) than the person who then talks
    const v = pc.openingVoice && e.text === pc.persona.opening ? pc.openingVoice : pc.voice;
    return authored(v, 1, true) ?? { ...uncast(`contact ${e.contactId}`), phone: true };
  }
  const npcId = e.npcId ?? '';
  if (npcId.startsWith('pt_')) {
    const p = s.patients.get(npcId.slice(3));
    if (p) {
      const pt = p.c.patient;
      return authored(pt.voice, ageSpeed(pt.age)) ?? { ...defaultPatientVoice(pt.sex, pt.age), phone: false };
    }
  }
  for (const p of s.patients.values()) {
    const fam = p.c.family;
    if (fam?.npcId === npcId) return authored(fam.voice, fam.appearance.age === 'old' ? 0.95 : 1) ?? uncast(`family ${npcId}`);
  }
  const st = s.staff.get(npcId);
  if (st) return authored(st.def.voice, st.def.appearance.age === 'old' ? 0.95 : 1) ?? uncast(`staff ${npcId}`);
  // the waiting-room crowd (content/ambient.ts; those who only ever speak when you chat: content/smalltalk.ts)
  const amb = s.ambient?.voiceOf(npcId) ?? CHAT_VOICES[npcId];
  if (amb) return authored(amb, 1) ?? uncast(`crowd ${npcId}`);
  return uncast(`npc ${npcId || '?'}`);
}

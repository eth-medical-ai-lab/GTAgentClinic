import type { ConversationView, NpcView } from './types';
import type { Rotation } from './saveGame';

export const RADIO_PIN = 'Night frequency pin';
// Some saved transcripts contain Luis's original directions.
const originalLuisReply = 'Oh, you caught me humming. Three notes before every dedication on the old hospital radio. Dave, the guard by the waiting-room doors, took the requests. Ask him who made the last one.';

// The NPC ids also identify clues in existing rotation saves.
const trail = [
  {
    npc: 'caf_luis',
    prompt: 'What’s that tune you’re humming?',
    words: /\b(radio|music|song|tune|humming|jingle|broadcast|melody|shift|hello|hi|hey)\b/i,
    reply: 'Oh, you caught me humming. Three notes before every dedication on the old hospital radio. Dave Morrison took the requests. Head down to the ED waiting room and go past the chairs. He’s usually by the glass doors to the parking lot, in a black uniform and cap. Ask him who made the last request.',
    lead: 'Find Dave Morrison in the ED waiting room. Go past the chairs to the glass doors facing the parking lot. Look for his black cap.',
  },
  {
    npc: 'sec_dave',
    prompt: 'Luis said you took requests. Who made the last one?',
    words: /\b(luis|radio|requests?|songs?|broadcast|dedications?|last one|music|tune)\b/i,
    reply: 'Mei called in for the last waltz. Her dad was up on the ward and he loved that record. She’s on break in the cafeteria. Ask her about the waltz sometime.',
    lead: 'Dave remembers a waltz. Mei, the nurse on break in the cafeteria, requested it for her dad.',
  },
  {
    npc: 'caf_rn_mei',
    prompt: 'Dave told me about the waltz. Did your dad get to hear it?',
    words: /\b(dave|waltz|radio|broadcast|frequency|pin|dedication|requests?|songs?)\b/i,
    reply: 'He did. Tapped the whole thing out on the bed rail. I kept a spare enamel pin from that last broadcast. Here, the Night frequency pin is yours.',
  },
] as const;

export function radioClue(npc: string) {
  return trail.find(step => step.npc === npc);
}

export function nextRadioClue(rotation: Rotation) {
  if (!rotation.items.includes(RADIO_PIN)) return trail.find(step => !rotation.clues.includes(step.npc));
}

export function radioLead(rotation: Rotation, npcs: readonly NpcView[]) {
  const next = nextRadioClue(rotation);
  if (next?.npc === 'sec_dave') {
    const dave = npcs.find(n => n.id === next.npc);
    if (dave?.location === 'hub') return 'Dave stepped into the main corridor for a wheelchair. He’ll return to the ED waiting room.';
    if (dave?.ambient?.urgent) return 'Dave is helping someone near the parking-lot doors in the ED waiting room. Look for his black cap.';
    if (dave?.ambient?.look === 'amb_dog') return 'Dave stepped over to the visitor with the dog carrier among the ED waiting-room chairs.';
    return trail[0].lead;
  }
  if (next?.npc === 'caf_rn_mei') return trail[1].lead;
}

export function collectRadioClue(rotation: Rotation, npc: string): Rotation {
  const next = nextRadioClue(rotation);
  if (!next || next.npc !== npc) return rotation;
  return { ...rotation, clues: [...rotation.clues, npc],
    items: npc === 'caf_rn_mei' ? [...rotation.items, RADIO_PIN] : rotation.items };
}

// Recover acknowledged conversations on reconnect, including attempts made with the old toast-only quest.
export function recoverRadioClues(rotation: Rotation, conversations: ConversationView[]) {
  if (rotation.items.includes(RADIO_PIN)) return rotation;
  const turns = conversations.flatMap(conv => {
    const step = radioClue(conv.npcId ?? '');
    if (!step) return [];
    return conv.lines.flatMap((line, i) => {
      if (line.speaker !== 'npc') return [];
      const question = conv.lines[i - 1];
      const legacyTopic = !rotation.radioStoryVersion && question?.speaker === 'player'
        && /radio|music|songs?|requests?|frequency|waltz|broadcast/i.test(question.text)
        && step.words.test(question.text);
      const originalReply = step.npc === 'caf_luis' && line.text === originalLuisReply;
      return line.text === step.reply || originalReply || legacyTopic
        ? [{ npc: step.npc, t: line.t, seq: Number(line.id.replace(/^st/, '')) }] : [];
    });
  }).sort((a, b) => a.t - b.t || a.seq - b.seq);
  const restored = turns.reduce((r, turn) => collectRadioClue(r, turn.npc), rotation);
  return restored.radioStoryVersion ? restored : { ...restored, radioStoryVersion: 1 as const };
}

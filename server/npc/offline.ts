/**
 * Offline NPC replies (no LLM): keyword retrieval over persona facts + simple intent
 * rules. Deterministic — useful for tests, CI and very fast RL rollouts.
 */
import { ORDERS } from '../../shared/catalog';
import type { OrderDef } from '../../shared/types';
import type { NpcSpec } from './prompts';
import type { NpcReply } from './brain';

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/\b(?:i\.[vm]|p\.[or]|s\.[cql])\.?/g, route => route.replaceAll('.', '')).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
}

const GREETING = /\b(hi|hello|hey|good (morning|evening|afternoon)|my name is|i'm dr|i am dr|i'm the|what brings|what happened|how can i help|how are you|tell me what)\b/;

export interface OfflineCtx {
  firstTurn: boolean;
  /** for phone contacts requiring identifiers */
  identifiersOk?: boolean;
  /** for consultants: does the server-side guard currently allow acceptance, per bed */
  acceptable?: Record<string, boolean>;
  /** for consultants: diagnosis keywords per bed */
  dxKeywords?: Record<string, string[]>;
  /** default patient (bed) for staff actions */
  defaultBed?: string;
  beds?: { bed: string; label?: string; lastName: string }[];
}

export function offlineReply(spec: NpcSpec, text: string, ctx: OfflineCtx): NpcReply {
  const t = norm(text);
  const reply: NpcReply = { say: '', emotion: 'neutral', revealed: [], counseled: [], actions: [] };
  const persona = spec.persona;

  // counseling detection
  for (const c of persona?.counseling ?? []) if (c.keywords.some((k) => t.includes(k.toLowerCase()))) reply.counseled.push(c.id);

  if (spec.kind === 'staff') return staffReply(spec, t, ctx, reply);

  if (spec.kind === 'phone' && spec.actionIds.includes('accept')) return consultantReply(spec, t, ctx, reply);

  if (spec.kind === 'phone' && ctx.identifiersOk === false && persona?.facts.length) {
    if (ctx.firstTurn) reply.say = persona.opening + ' ';
    reply.say += 'Before I can share anything I need the patient\'s full name and date of birth.';
    return reply;
  }

  if (!persona) {
    reply.say = 'Sorry, could you repeat that?';
    return reply;
  }

  // facts by keyword score
  const scored = persona.facts
    .map((f) => ({ f, s: f.keywords.reduce((a, k) => a + (t.includes(k.toLowerCase()) ? (k.length > 5 ? 2 : 1) : 0), 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const parts: string[] = [];
  if ((ctx.firstTurn || GREETING.test(t)) && (!scored.length || ctx.firstTurn)) parts.push(persona.opening);
  for (const x of scored.slice(0, 2)) {
    parts.push(x.f.text);
    reply.revealed.push(x.f.id);
  }
  // actions
  for (const a of persona.actions ?? []) {
    if (a.id === 'step_out' && /\b(step out|leave us|privacy|private|moment alone|wait outside|give us a minute)\b/.test(t)) {
      reply.actions.push({ id: 'step_out' });
      parts.push("Sure — I'll be in the waiting room.");
    }
    if (a.id === 'consent' && /\b(surgery|operation|cath|catheter|procedure|stent|consent|agree)\b/.test(t)) reply.actions.push({ id: 'consent' });
    if (a.id === 'fax_records' && ctx.identifiersOk && /\b(fax|send|records|culture|copy)\b/.test(t)) {
      reply.actions.push({ id: 'fax_records' });
      parts.push("I'll fax the culture report and med list over now.");
    }
    if (a.id === 'deny_auth' && /\b(mri|authori[sz]|approve|pre-?auth)\b/.test(t)) {
      reply.actions.push({ id: 'deny_auth' });
      parts.push('That request does not meet our medical-necessity criteria. Your reference number is PA-4417-882.');
    }
  }
  if (!parts.length) parts.push(persona.fallback);
  reply.say = parts.join(' ');
  return reply;
}

function findBed(t: string, ctx: OfflineCtx): string | undefined {
  const named = (ctx.beds ?? []).filter(b => t.includes(norm(b.lastName)));
  const locations = [...t.matchAll(/\b(bed|room|hall|resus|fast ?track|ft)\s*(\d+)\b/g)];
  // An explicit but incomplete location must not fall back to the nearby patient.
  const locationWords = [...t.matchAll(/\b(bed|room|hall|resus|fast ?track|ft)\b/g)];
  if (locationWords.some(word => !locations.some(location => location.index === word.index))) return undefined;
  const beds = new Set(named.map(b => b.bed));
  for (const location of locations) {
    const kind = location[1] === 'room' ? 'bed' : /^(fast|ft)/.test(location[1]) ? 'fast track' : location[1];
    const label = `${kind} ${location[2]}`;
    const known = ctx.beds?.find(b => norm(b.label ?? b.bed).trim() === label || norm(b.bed).trim() === label);
    if (ctx.beds && !known) return undefined;
    beds.add(known?.bed ?? `${kind === 'fast track' ? 'ft' : kind}_${location[2]}`);
  }
  for (const b of ctx.beds ?? []) if (b.label && t.includes(norm(b.label))) beds.add(b.bed);
  if (beds.size) return beds.size === 1 ? [...beds][0] : undefined;
  // Preserve indications in full catalog names, but do not treat an unknown
  // explicit recipient ("for Evans", "patient Smithson") as the current patient.
  const remaining = Object.values(ORDERS).reduce((text, order) => text.replace(norm(order.name), ' '), t);
  if (/\b(for|patient|mr|mrs|ms)\b/.test(remaining)) return undefined;
  return ctx.defaultBed;
}

const NURSE_CATEGORIES = new Set(['med', 'lab', 'nursing', 'ecg', 'supply']);
const ROUTES: [string, RegExp][] = [
  ['IV', /\b(iv|intravenous|intravenously)\b/],
  ['IM', /\b(im|intramuscular|intramuscularly)\b/],
  ['PO', /\b(po|oral|orally|by mouth|per os)\b/],
  ['SL', /\b(sl|sublingual|sublingually)\b/],
  ['SC', /\b(sc|sq|subcutaneous|subcutaneously)\b/],
  ['ODT', /\b(odt|orodispersible)\b/],
  ['PR', /\b(pr|rectal|rectally|per rectum|suppository)\b/],
  ['IN', /\b(intranasal|nasal spray)\b/],
  ['inhaled', /\b(inhaled|inhalation|nebulized|nebulised|nebulizer|nebuliser)\b/],
  ['topical', /\b(topical|topically|transdermal|patch)\b/],
  ['enteral', /\b(enteral|enterally|ng|peg|feeding tube|nasogastric|gastrostomy)\b/],
  ['intrathecal', /\b(intrathecal|epidural)\b/],
  ['intraosseous', /\b(io|intraosseous)\b/],
  ['intra-articular', /\b(intra articular|intraarticular|into (the )?joint)\b/],
];

type OrderMatch = { order: OrderDef; start: number; end: number };

/** Whole phrases, with contained generic matches removed before resolving alternatives. */
function resolveOrders(t: string): { orders: OrderDef[]; clarification?: string } {
  const matches: OrderMatch[] = [];
  const testing = /\b(check|recheck|test|measure|draw|send|level|levels|fingerstick|blood sugar)\b/.test(t);
  const treating = /\b(give|administer|treat|replacement)\b/.test(t);
  for (const order of Object.values(ORDERS)) {
    const keys = [order.code, order.name, ...(order.synonyms ?? []), order.med?.generic ?? ''];
    if (order.code === 'glu_poc') keys.push('glucose', 'blood sugar');
    for (const key of new Set(keys.map(k => norm(k).trim()).filter(Boolean))) {
      let from = 0;
      let start: number;
      while ((start = t.indexOf(` ${key} `, from)) !== -1) {
        // Short catalog codes are valid, but a dose unit is not an order for magnesium.
        if (key !== 'mg' || !/\d\s*$/.test(t.slice(0, start))) matches.push({ order, start, end: start + key.length + 2 });
        from = start + key.length + 1;
      }
    }
  }
  let candidates = matches.filter(m => !matches.some(other =>
    other.start <= m.start && other.end >= m.end && (other.start < m.start || other.end > m.end)));
  // Do not accept the recognized half of a compound request while ignoring the rest.
  const separators = [...t.matchAll(/\b(and|then|plus)\b/g)]
    .filter(m => !candidates.some(c => c.start < m.index! && c.end > m.index! + m[0].length));
  let clauseStart = 0;
  for (const separator of [...separators, { index: t.length, 0: '' }]) {
    if (!candidates.some(c => c.start >= clauseStart && c.start < separator.index!)) {
      return { orders: [], clarification: 'Please specify each test or treatment; I could not resolve the whole request.' };
    }
    clauseStart = separator.index! + separator[0].length;
  }
  // A test request must never become glucose treatment (or vice versa).
  if (testing !== treating) {
    const selected = candidates.filter(m => m.order.category !== (testing ? 'med' : 'lab'));
    if (candidates.some(m => !selected.includes(m) && !selected.some(other => other.start === m.start && other.end === m.end))) {
      return { orders: [], clarification: 'Please clarify which items are tests and which are treatments.' };
    }
    candidates = selected;
  }
  const routes = ROUTES.filter(([, pattern]) => pattern.test(t)).map(([route]) => route);
  if (candidates.some(m => m.order.med) && routes.length > 1) {
    return { orders: [], clarification: 'Please give each medication and route as a separate order.' };
  }
  const route = routes[0];
  if (!route && candidates.some(m => m.order.med) && /\b(via|by|route|injection|inject)\b/.test(t)) {
    return { orders: [], clarification: 'Please use the EHR to specify that route; I cannot resolve it in a verbal order.' };
  }
  if (!route) {
    candidates = candidates.flatMap(m => {
      if (!m.order.med || /\b(drip|infusion)\b/.test(t.slice(m.start, m.end))) return [m];
      return Object.values(ORDERS).filter(o => o.med?.generic === m.order.med!.generic).map(order => ({ ...m, order }));
    });
  }
  if (route && candidates.some(m => m.order.med)) {
    const meds = candidates.filter(m => m.order.med);
    // Aliases such as paracetamol may occur on only one catalog entry. Resolve the
    // requested route across that drug's variants, not just the matching alias.
    const supported = meds.flatMap(m => Object.values(ORDERS)
      .filter(o => o.med?.generic === m.order.med!.generic && o.med.routes[0].toUpperCase().startsWith(route.toUpperCase()))
      .map(order => ({ ...m, order })));
    if (!supported.length || meds.some(m => !supported.some(s => s.order.med!.generic === m.order.med!.generic))) {
      return { orders: [], clarification: `Please use the EHR to specify the ${route} route; I cannot enter that route in a verbal order.` };
    }
    candidates = [...candidates.filter(m => !m.order.med), ...supported];
    // An IV route does not also request IV access.
    candidates = candidates.filter(m => m.order.code !== 'iv_access' || /\b(access|line|peripheral|large bore)\b/.test(t));
  }
  const oxygen = candidates.some(m => m.order.code === 'o2_nc' || m.order.code === 'oxygen_nrb');
  if (oxygen) {
    const nrb = /\b(nrb|nonrebreather|non rebreather|reservoir mask|high flow|100 oxygen)\b/.test(t);
    const nasal = /\b(nasal cannula|nasal prongs)\b/.test(t);
    if (nrb && nasal) return { orders: [], clarification: 'Which oxygen device should I use: nasal cannula or nonrebreather mask?' };
    if (/\b(venturi|cpap|bipap|simple mask|hfnc|tent|hood|tracheostomy)\b/.test(t) || (/\bmask\b/.test(t) && !nrb) ||
      (/\b(via|by|through|using)\b/.test(t) && !nrb && !nasal)) {
      return { orders: [], clarification: 'Please clarify the oxygen device or enter it in the EHR.' };
    }
    if (nrb || nasal) {
      candidates = candidates.filter(m => !['o2_nc', 'oxygen_nrb'].includes(m.order.code) &&
        (m.order.code !== 'iv_access' || /\b(iv|access|line|peripheral|large bore)\b/.test(t)));
      candidates.push({ order: ORDERS[nrb ? 'oxygen_nrb' : 'o2_nc'], start: -1, end: -1 });
    }
  }
  for (const match of candidates) {
    if (candidates.some(other => other.order.code !== match.order.code &&
      other.start < match.end && other.end > match.start)) {
      return { orders: [], clarification: 'Which exact test, medication, route or device do you want? Please specify the order.' };
    }
  }
  const orders = [...new Map(candidates.map(m => [m.order.code, m.order])).values()];
  if (orders.some(o => !NURSE_CATEGORIES.has(o.category))) {
    return { orders: [], clarification: 'Please enter that investigation or procedure in the EHR.' };
  }
  if (!orders.length) return { orders: [], clarification: 'Which exact test or treatment do you want? Please specify it or use the EHR.' };
  if (orders.length > 4) return { orders: [], clarification: 'Please give no more than four orders at a time.' };
  return { orders };
}

function staffReply(spec: NpcSpec, t: string, ctx: OfflineCtx, reply: NpcReply): NpcReply {
  const bed = findBed(t, ctx);
  const said: string[] = [];
  if (spec.actionIds.includes('stop_med') && /\b(stop|wait|hold on|wrong|which patient|that s not|isn t his|not his|dob|wristband|identification)\b/.test(t)) {
    reply.actions.push({ id: 'stop_med' });
    said.push('Wait — let me double-check the wristband... oh no. You\'re right, I\'m stopping.');
  }
  if (reply.actions.some(a => a.id === 'stop_med')) {
    reply.say = said.join(' ');
    return reply;
  }
  // A medication mention or a status question is not an order.
  if (/\b(status|already|been given|was given|whether|allergic|allergy)\b/.test(t) || /^\s*(has|have|did|what|when|why|how)\b/.test(t)) {
    reply.say = 'Please check the EHR for the current orders and administration record.';
    return reply;
  }
  if (/\b(not|don t|do not|either|or|unless|instead)\b/.test(t)) {
    reply.say = 'Please clarify one definite order at a time, or use the EHR.';
    return reply;
  }
  const orderCue = /\b(give|start|hang|draw|get|order|send|run|do|put|place|bolus|push|administer|check|recheck|test|measure|can you|could you|please|let s|lets|need|want|for (bed|room|hall|resus|fast track) \d|\d+\s*(mg|mcg|g|ml|l|u|units|of))\b/.test(t);
  const culturesFirst = spec.actionIds.includes('cultures_first') && /\b(culture)/.test(t) && /\b(first|before)\b/.test(t);
  const vitals = spec.actionIds.includes('vitals_now') && /\b(temp|temperature|vitals)\b/.test(t);
  if (orderCue || culturesFirst || vitals) {
    if (!bed) {
      reply.say = 'Which patient — one name or an occupied bed label?';
      return reply;
    }
    if (spec.actionIds.includes('verbal_order') && orderCue) {
      const resolved = resolveOrders(t);
      if (resolved.clarification) {
        reply.say = resolved.clarification;
        return reply;
      }
      for (const order of resolved.orders) {
        if (order.code === 'bcx' && culturesFirst) continue;
        if (order.code === 'vitals_now' && vitals) continue;
        reply.actions.push({ id: 'verbal_order', code: order.code, patient: bed });
        said.push(`${order.name} for ${bed.replace('_', ' ')} — got it.`);
      }
    }
    if (culturesFirst) {
      reply.actions.push({ id: 'cultures_first', patient: bed });
      said.push('Okay — cultures first, then the antibiotic.');
    }
    if (vitals && !reply.actions.some(a => a.code?.startsWith('vitals_'))) {
      reply.actions.push({ id: 'vitals_now', patient: bed });
      said.push("I'll grab a full set with a temp now.");
    }
  }
  reply.say = said.length ? said.join(' ') : spec.kind === 'staff' && /\b(how|what|status|update)\b/.test(t) ? 'Busy night, Doc. Check the board — I\'ll page you if anything changes.' : 'Sure, Doc. What do you need?';
  return reply;
}

function consultantReply(spec: NpcSpec, t: string, ctx: OfflineCtx, reply: NpcReply): NpcReply {
  const bed = findBed(t, ctx);
  if (!bed) {
    reply.say = `${spec.persona?.opening ?? ''} Which patient — name or bed?`.trim();
    return reply;
  }
  const kws = ctx.dxKeywords?.[bed] ?? [];
  const mentions = kws.some((k) => t.includes(k.toLowerCase()));
  if (ctx.acceptable?.[bed] && mentions) {
    reply.actions.push({ id: 'accept', patient: bed });
    reply.say = 'Okay, that sounds right — I\'ll accept. We\'re on our way.';
  } else if (ctx.acceptable?.[bed] === false) {
    reply.say = 'I need a bit more before I take this — what are the key findings, and is the workup done?';
  } else {
    reply.actions.push({ id: 'decline', patient: bed });
    reply.say = 'Doesn\'t sound like one for us yet. Give me the one-liner with your key findings.';
  }
  return reply;
}

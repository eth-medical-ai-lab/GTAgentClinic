/**
 * Casting: which realistic avatar (Microsoft Rocketbox, MIT — see /res/chars) plays which NPC.
 *
 * A cast is a body (`id`: the outfit) and, optionally, another avatar's head (`head`: face, hair,
 * lashes; avatars.ts swaps it in). Scrub colors, garment hues, skin and hair are recolored at load
 * time. A character's identity is its face, so the rules (tests/casting.test.ts enumerates every
 * character of every map and checks them):
 *  - the player (the watcher in observe mode) and the AI resident wear models nobody else wears
 *  - every staff member's face is theirs alone on a map
 *  - patients, families, visitors and the crowd have their own faces where the library allows; a
 *    face is reused only between two people who are never in the same room at the same time, and
 *    then with strongly different skin, hair and garment colors
 * Nurses share the scrubs bodies (a uniform), never a face.
 *
 * Unknown NPCs get a deterministic pick from a pool that fits their role, sex, age and outfit, so
 * new content renders without touching this file; the test then asks for an authored entry.
 */
import type { Appearance, NpcRole } from '../../../shared/types';

export interface AvatarCast {
  /** GLB name in /res/chars (without .glb): the body and outfit */
  id: string;
  /** wear this avatar's head instead (face, hair, eyelashes, glasses); its skin tone carries to the body */
  head?: string;
  /** recolor white garments (nurses' whites → scrubs) */
  scrubs?: string;
  /** recolor a garment hue range (e.g. an olive tunic → scrub blue) */
  hue?: { from: [number, number]; to: string };
  /** grey the hair (0..1) */
  grey?: number;
  /** shift the skin tone toward this color (keeps the texture's shading and detail) */
  skin?: string;
  /** recolor the hair toward this color */
  hair?: string;
}

const NAVY = '#2b4a72';
const CEIL = '#5d8fbf';
const TEAL = '#2f7f86';
const WINE = '#6a2b44';
/** a patient gown's blue, for shirts and tops in bed */
const GOWN = '#9cc3d5';

// garment hue ranges (degrees) of the bodies recolored below; skin (4–46°) is never in one
const GREEN_SCRUBS: [number, number] = [120, 190]; // Medical_Male_04
const BLUE: [number, number] = [190, 235]; // shirts and denim
const ROYAL: [number, number] = [200, 255]; // a blue blouse, a blue hoodie
const PINK: [number, number] = [320, 359];
const PURPLE: [number, number] = [255, 330];
const MAGENTA: [number, number] = [300, 345];
const OLIVE_GREEN: [number, number] = [60, 160];

/**
 * Listed models whose face is another listed model's (upstream reuses heads): casting treats them as
 * that face. Male_Adult_14 is the AI resident's face without the moustache, so it is never cast.
 */
export const FACE_OF: Record<string, string> = {
  Medical_Female_03: 'Female_Adult_09',
  Medical_Male_05: 'Medical_Male_04',
  Male_Adult_14: 'Medical_Male_03',
};

/** whose face a cast shows */
export const faceOf = (c: AvatarCast): string => FACE_OF[c.head ?? c.id] ?? c.head ?? c.id;

/** the GLB files a cast loads */
export const modelsOf = (c: AvatarCast): string[] => (c.head && c.head !== c.id ? [c.id, c.head] : [c.id]);

/** models (and so faces) nobody else ever wears: the player / watcher, and the AI resident */
export const EXCLUSIVE: Record<string, string> = { player: 'Medical_Male_01', ai_doctor: 'Medical_Male_03' };

/** bodies whose hood covers the hair (whatever head they wear) */
export const HOODED = new Set(['Male_Adult_18']);

/**
 * Heads modeled only for wear under their own outfit's headgear: Male_Adult_18's head is a face with
 * no back or top (his hood covers them), so on another body the back of his head is see-through.
 * They are never swapped onto another body (avatars.ts ignores such a swap; tests/casting.test.ts
 * and tests/heads-e2e.ts check every cast).
 */
export const HEAD_NEEDS_OWN_BODY = new Set(['Male_Adult_18']);

/** authored casting for the shipped scenarios (NPC id → avatar) */
export const CAST: Record<string, AvatarCast> = {
  // the resident (first person; in observe mode the watcher, a med student): white coat over ceil
  player: { id: 'Medical_Male_01', scrubs: CEIL },
  // the AI resident you can watch (observe mode): coat, shirt and tie, stethoscope, a moustache
  ai_doctor: { id: 'Medical_Male_03' },

  // ── staff: nurses wear the scrubs bodies (Medical_Female_01's whites, Medical_Male_04's greens) with their own faces ──
  rn_rosa: { id: 'Medical_Female_01', head: 'Female_Adult_02', scrubs: NAVY, skin: '#c68e63', hair: '#2a1b14' }, // charge RN, 20 years in
  rn_tom: { id: 'Medical_Male_04', head: 'Medical_Male_02', hue: { from: GREEN_SCRUBS, to: NAVY }, hair: '#7a5a3a' }, // a paramedic's face: he was one
  rn_aisha: { id: 'Medical_Female_01', head: 'Medical_Female_02', scrubs: CEIL, skin: '#a7714f', hair: '#1a1a1a' }, // dark hair, pulled back
  rn_lena: { id: 'Medical_Female_01', head: 'Female_Adult_01', scrubs: TEAL }, // triage: blonde ponytail
  tech_marcus: { id: 'Medical_Male_04', head: 'Business_Male_05', hue: { from: GREEN_SCRUBS, to: '#6d2e46' } },
  att_shaw: { id: 'Medical_Female_02', head: 'Business_Female_01' }, // the physician's coat, her own face
  clerk_paul: { id: 'Male_Adult_08', hue: { from: BLUE, to: '#44546a' } }, // slate uniform shirt
  sec_dave: { id: 'Security_Male_01', skin: '#b07a55' },
  // environmental services: a sage tunic and trousers (the scrubs body), not street clothes
  hk_ines: { id: 'Medical_Female_01', head: 'Female_Adult_17', scrubs: '#5c7a5a', skin: '#c99872', hair: '#3a2a1e' },
  amb_float_rn: { id: 'Medical_Female_01', head: 'Female_Adult_09', scrubs: '#2f6f9f', hair: '#4a3324' }, // Jo, the stand-in triage nurse
  // east wing: the cafeteria (24/7) and the outpatient clinic (Orientation Day only: closed at night)
  caf_luis: { id: 'Male_Adult_07' }, // rust shirt under a grey jacket
  caf_rn_mei: { id: 'Medical_Female_01', scrubs: WINE },
  cl_carmen: { id: 'Female_Adult_15', head: 'Female_Adult_07', hue: { from: ROYAL, to: '#2f5f6f' }, hair: '#3b2416' },
  cl_rn_hannah: { id: 'Medical_Female_01', head: 'Female_Adult_15', scrubs: '#4f63a6', hair: '#8a4a2a' }, // auburn

  // ── visitors: vis_* wait all shift; the cafeteria visitor never leaves the cafeteria ──
  vis_1: { id: 'Female_Adult_08', hair: '#8a5a2b' },
  // Okafor's face (he never leaves Fast Track 1), darker, silver-haired, in a suit
  vis_2: { id: 'Business_Male_05', head: 'Male_Adult_12', grey: 0.8, skin: '#432a1b', hue: { from: PURPLE, to: '#4a6a8a' } },
  vis_3: { id: 'Sports_Male_03' }, // straight from his five-a-side match
  // vis_1's face, darker and black-haired, in another outfit (never in the waiting room)
  caf_visitor: { id: 'Female_Adult_05', head: 'Female_Adult_08', hue: { from: PINK, to: '#3f5f7f' }, skin: '#8f5c3e', hair: '#17110d' },

  // ── patients (in their beds; tops recolored to gown blue where the body allows) ──
  pt_p_okafor: { id: 'Male_Adult_12' },
  pt_p_keller: { id: 'Male_Adult_05', grey: 0.7 }, // the beard
  pt_p_kellner: { id: 'Business_Male_07', scrubs: GOWN, grey: 0.8 },
  pt_p_brunner: { id: 'Female_Adult_02', head: 'Business_Female_02', scrubs: GOWN, hair: '#d2d2d2' }, // white hair, the glasses
  pt_p_thompson: { id: 'Female_Adult_01', head: 'Female_Adult_04', hue: { from: PINK, to: GOWN }, hair: '#6b4a2f' },
  // ── families (at the bedside, or out in the waiting room for a while) ──
  fam_linda: { id: 'Female_Adult_07', hue: { from: MAGENTA, to: '#7a4e7e' }, hair: '#b8b0a0' }, // grey-blonde
  fam_jake: { id: 'Male_Adult_04' },
  fam_sabine: { id: 'Female_Adult_15', hair: '#7a5230' },

  // ── the waiting-room crowd (content/ambient.ts) ──
  amb_wrist: { id: 'Male_Adult_10', hair: '#141110' },
  amb_cut: { id: 'Female_Adult_14', hair: '#3a2417' },
  amb_cut_partner: { id: 'Business_Male_04' },
  amb_walker: { id: 'Male_Adult_13', hair: '#dcdcdc' }, // white-haired; called first, gone within ~20 minutes
  amb_daughter: { id: 'Business_Female_03', hair: '#5a3d28' }, // leaves with him
  amb_earbuds: { id: 'Female_Adult_12', hair: '#151213' },
  // Keller's face (he never leaves bed 2; the beard reads as stubble), darker, dark brown hair, in
  // Luis's jacket (Luis stays in the cafeteria)
  amb_impatient: { id: 'Male_Adult_07', head: 'Male_Adult_05', skin: '#7a5038', hair: '#4a3a2e' },
  // Brunner's face (she never leaves bed 4), darker and black-haired, in a burgundy jacket
  amb_dog: { id: 'Business_Female_02', skin: '#8a5a3c', hair: '#2a1d16' },
  amb_sleeper: { id: 'Male_Adult_18' }, // hood up, asleep with his head down
  amb_knee: { id: 'Male_Adult_16' },
  // behind a mask; Okafor's denim (he stays in Fast Track 1): a recolor would streak the faded jeans too
  amb_cough: { id: 'Male_Adult_12', head: 'Medical_Male_04', hair: '#6a3a22' },
  amb_migraine: { id: 'Female_Adult_05', hue: { from: PINK, to: '#3b3f4a' }, hair: '#241914' },
  amb_thumb: { id: 'Male_Adult_09', skin: '#b98260', hair: '#1c1612' }, // navy tee (an olive recolor streaked his jeans)
  amb_faint: { id: 'Business_Male_01' }, // came from a dinner, in a suit
  amb_faint_friend: { id: 'Female_Adult_04', skin: '#7d5136', hair: '#1d1512' },
  amb_vomit: { id: 'Female_Adult_13' }, // her fair hair is painted on: it keeps its color
  // the walker's face (arrives after he has gone through), darker, steel-grey hair, a slate shirt
  amb_back: { id: 'Male_Adult_05', head: 'Male_Adult_13', hue: { from: OLIVE_GREEN, to: '#3e4a57' }, skin: '#8a5a3c', hair: '#5e5e5e' },
  amb_rash: { id: 'Female_Adult_03', hue: { from: PURPLE, to: '#2d5a4a' }, hair: '#120f0e' },
  amb_eye: { id: 'Male_Adult_17', hue: { from: ROYAL, to: '#5e4b3c' } },
  // Night Shift only, arriving after the earbuds girl has gone through: her face, darker, auburn, a wine shirt
  amb_burn: { id: 'Female_Adult_01', head: 'Female_Adult_12', hue: { from: PINK, to: '#7b3a3a' }, skin: '#7d5136', hair: '#7a4426' },

  // ── floor 2, Ward 2 East (client-side: client/src/world/ward.ts) — its nurses' faces are theirs alone;
  //    its patients never leave their rooms, so they wear faces from downstairs, strongly recolored ──
  ward_ana: { id: 'Medical_Female_01', head: 'Sports_Female_02', scrubs: '#2f6b5f' }, // the night charge nurse
  ward_theo: { id: 'Medical_Male_04', head: 'Business_Male_03', hue: { from: GREEN_SCRUBS, to: '#2f6b5f' } },
  ward_pt_201: { id: 'Medical_Female_01', head: 'Female_Adult_14', scrubs: GOWN, skin: '#8a5a3c', hair: '#e2e2e2' }, // Elena Costa's face
  // the walker's face a third time: the darkest skin of the three, grey between his white and the back pain's steel
  ward_pt_202: { id: 'Male_Adult_08', head: 'Male_Adult_13', hue: { from: BLUE, to: GOWN }, skin: '#4a2e1e', hair: '#969696' },
  ward_pt_204: { id: 'Business_Male_07', head: 'Business_Male_01', scrubs: GOWN, skin: '#8a5a3c', hair: '#5a3d28' }, // Ryan Doyle's face
  ward_pt_205: { id: 'Female_Adult_02', head: 'Business_Female_03', scrubs: GOWN, skin: '#7d5136', hair: '#e8e8e8' }, // the daughter's face
};

/**
 * Fallbacks for NPCs without an authored entry: plausible, deterministic, never the player's or the
 * AI resident's models. They may share a face with someone on the map — tests/casting.test.ts
 * flags that, and an authored entry above fixes it.
 */
const POOLS: Record<string, AvatarCast[]> = {
  nurseF: [
    { id: 'Medical_Female_01', head: 'Female_Adult_13', scrubs: CEIL },
    { id: 'Medical_Female_01', head: 'Female_Adult_05', scrubs: WINE },
    { id: 'Medical_Female_01', head: 'Female_Adult_08', scrubs: TEAL },
  ],
  // the surgical cap and mask stay on: a face nobody can mistake for another
  nurseM: [{ id: 'Medical_Male_04', hue: { from: GREEN_SCRUBS, to: TEAL } }, { id: 'Medical_Male_05' }],
  doctorF: [{ id: 'Medical_Female_02', head: 'Business_Female_03' }, { id: 'Medical_Female_02', head: 'Female_Adult_14' }],
  // no other male coat body exists (the player's and the AI's are theirs): ED doctors in scrubs
  doctorM: [{ id: 'Medical_Male_04', head: 'Business_Male_04' }, { id: 'Medical_Male_04', head: 'Male_Adult_16' }],
  emsF: [{ id: 'Medical_Female_03', head: 'Female_Adult_13' }],
  emsM: [{ id: 'Medical_Male_02', head: 'Business_Male_01' }, { id: 'Medical_Male_02', head: 'Male_Adult_16' }],
  adultF: ['Female_Adult_03', 'Female_Adult_04', 'Female_Adult_05', 'Female_Adult_08', 'Female_Adult_12', 'Female_Adult_13', 'Female_Adult_14', 'Female_Adult_15'].map((id) => ({ id })),
  adultM: ['Male_Adult_04', 'Male_Adult_07', 'Male_Adult_09', 'Male_Adult_10', 'Male_Adult_16', 'Male_Adult_17', 'Business_Male_01', 'Sports_Male_03'].map((id) => ({ id })),
  oldF: ['Business_Female_02', 'Business_Female_03', 'Female_Adult_14'].map((id) => ({ id, grey: 0.8 })),
  oldM: ['Male_Adult_05', 'Male_Adult_13', 'Business_Male_07', 'Business_Male_04'].map((id) => ({ id, grey: 0.8 })),
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Pick an avatar: the authored casting above first (it is what the uniqueness rules are checked
 * against), then an avatar the content sets explicitly (appearance.avatar), then a stable pick from a
 * pool matching role/outfit. `sex` comes from content when the server provides it; otherwise long
 * hairstyles hint female for the pool only.
 *
 * Project rule: characters wear no religious symbols or garments — avatars with them are not
 * converted (scripts/assets/rocketbox.mjs) and tests/casting.test.ts enforces it.
 */
export function castFor(id: string, role: NpcRole | 'player', a: Appearance, sex?: 'm' | 'f'): AvatarCast {
  if (CAST[id]) return CAST[id];
  const explicit = (a as Appearance & { avatar?: AvatarCast | string }).avatar;
  if (explicit) return typeof explicit === 'string' ? { id: explicit } : explicit;
  const f = sex ? sex === 'f' : a.hairStyle === 'long' || a.hairStyle === 'bun' || a.hairStyle === 'ponytail';
  const old = a.age === 'old';
  let pool: AvatarCast[];
  if (role === 'ems' || a.outfit === 'ems') pool = f ? POOLS.emsF : POOLS.emsM;
  else if (role === 'nurse' || role === 'tech' || a.outfit === 'scrubs') pool = f ? POOLS.nurseF : POOLS.nurseM;
  else if (role === 'attending' || role === 'resident' || role === 'consultant' || a.outfit === 'coat') pool = f ? POOLS.doctorF : POOLS.doctorM;
  else if (old) pool = POOLS[f ? 'oldF' : 'oldM'];
  else pool = f ? POOLS.adultF : POOLS.adultM;
  const pick = pool[hash(id) % pool.length];
  const aged = old && pick.grey === undefined ? { ...pick, grey: 0.75 } : pick;
  return role === 'patient' ? { ...aged, skin: a.skin, hair: a.hair } : aged;
}

/**
 * The body whose arms the player sees in first person (fpArms.ts): a scrubs body of the player's sex,
 * for its short sleeves (bare below the elbows, as for any hand hygiene; the player's own coat has
 * long ones), in the player's scrub color.
 */
export function firstPersonArms(player: AvatarCast = CAST.player): AvatarCast {
  const color = player.scrubs ?? CEIL;
  return /Female/.test(player.id) ? { id: 'Medical_Female_01', scrubs: color } : { id: 'Medical_Male_04', hue: { from: GREEN_SCRUBS, to: color } };
}

/** every avatar file the authored casting references, bodies and heads (for preloading) */
export function castAvatarIds(): string[] {
  return [...new Set(Object.values(CAST).flatMap(modelsOf))];
}

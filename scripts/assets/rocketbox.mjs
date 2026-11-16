/**
 * Shared config for the Rocketbox character pipeline (Microsoft Rocketbox Avatar Library,
 * MIT license, https://github.com/microsoft/Microsoft-Rocketbox).
 *
 * AVATARS: every avatar the game can use → its folder in the Rocketbox repo.
 * ANIMS: clip name in the game → Rocketbox animation file (in-place "static" or root-motion "xy").
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// GTAgentClinic's download cache (the server moves a pre-v0.2 ~/.cache/agentclinic here; see server/tts/index.ts)
export const CACHE = process.env.ROCKETBOX_CACHE ?? path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'GTAgentClinic', 'rocketbox');
export const OUT = path.join(ROOT, 'client', 'public', 'res', 'chars');
export const RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets';

/**
 * Project rule: no religious symbols or garments on characters. Rocketbox avatars that wear them
 * (e.g. Female_Adult_06, _10, _16, Male_Adult_15, _19, _21) are deliberately not listed;
 * tests/casting.test.ts checks this list and the converted files. Every avatar added was checked
 * texture by texture (pendants, prints, badges, tattoos) and rendered before it was listed.
 *
 * Faces: a character's face is its head model (casting.ts can put any head on any body), so a model
 * only adds a face if nobody else has it. Upstream reuses some heads across folders; these were
 * left out as duplicates of a listed face: Female_Adult_11 (= Medical_Female_01), Male_Adult_03
 * (= Security_Male_01), Male_Adult_06 (= Medical_Male_02), Gardener_Male_01 (= Male_Adult_05),
 * Business_Female_04 (= Medical_Female_02) and Male_Adult_20 (close to Medical_Male_01, the player).
 * Listed models whose face is another's are marked; casting.ts FACE_OF maps them.
 */
export const AVATARS = {
  // clinical staff (scrub colors are applied at runtime by recoloring the white garments)
  Medical_Female_01: 'Avatars/Professions/Medical_Female_01', // nurse in whites
  Medical_Female_02: 'Avatars/Professions/Medical_Female_02', // physician, white coat + stethoscope
  Medical_Female_03: 'Avatars/Professions/Medical_Female_03', // paramedic jacket (face = Female_Adult_09)
  Medical_Male_01: 'Avatars/Professions/Medical_Male_01', // nurse/physician in whites (the player)
  Medical_Male_02: 'Avatars/Professions/Medical_Male_02', // paramedic jacket
  Medical_Male_03: 'Avatars/Professions/Medical_Male_03', // physician: coat, tie, stethoscope (the AI resident; face ≈ Male_Adult_14)
  Medical_Male_04: 'Avatars/Professions/Medical_Male_04', // green scrubs, cap, mask
  Medical_Male_05: 'Avatars/Professions/Medical_Male_05', // lead apron, cap, mask (face = Medical_Male_04)
  Security_Male_01: 'Avatars/Professions/Security_Male_01',
  // patients, families, visitors, non-clinical staff
  Male_Adult_04: 'Avatars/Adults/Male_Adult_04',
  Male_Adult_05: 'Avatars/Adults/Male_Adult_05',
  Male_Adult_07: 'Avatars/Adults/Male_Adult_07',
  Male_Adult_08: 'Avatars/Adults/Male_Adult_08',
  Male_Adult_09: 'Avatars/Adults/Male_Adult_09',
  Male_Adult_10: 'Avatars/Adults/Male_Adult_10',
  Male_Adult_12: 'Avatars/Adults/Male_Adult_12',
  Male_Adult_13: 'Avatars/Adults/Male_Adult_13',
  Male_Adult_14: 'Avatars/Adults/Male_Adult_14',
  Male_Adult_16: 'Avatars/Adults/Male_Adult_16',
  Male_Adult_17: 'Avatars/Adults/Male_Adult_17', // his cap belongs to the body: as a head, short hair
  Male_Adult_18: 'Avatars/Adults/Male_Adult_18', // the hood belongs to the body: as a head, shaved
  Female_Adult_01: 'Avatars/Adults/Female_Adult_01',
  Female_Adult_02: 'Avatars/Adults/Female_Adult_02',
  Female_Adult_03: 'Avatars/Adults/Female_Adult_03',
  Female_Adult_04: 'Avatars/Adults/Female_Adult_04',
  Female_Adult_05: 'Avatars/Adults/Female_Adult_05',
  Female_Adult_07: 'Avatars/Adults/Female_Adult_07',
  Female_Adult_08: 'Avatars/Adults/Female_Adult_08',
  Female_Adult_09: 'Avatars/Adults/Female_Adult_09',
  Female_Adult_12: 'Avatars/Adults/Female_Adult_12',
  Female_Adult_13: 'Avatars/Adults/Female_Adult_13',
  Female_Adult_14: 'Avatars/Adults/Female_Adult_14',
  Female_Adult_15: 'Avatars/Adults/Female_Adult_15',
  Female_Adult_17: 'Avatars/Adults/Female_Adult_17',
  // professions with faces the adults lack (older, Black, bald); their outfits are city clothes
  Business_Female_01: 'Avatars/Professions/Business_Female_01',
  Business_Female_02: 'Avatars/Professions/Business_Female_02', // older, with glasses
  Business_Female_03: 'Avatars/Professions/Business_Female_03',
  Business_Male_01: 'Avatars/Professions/Business_Male_01',
  Business_Male_03: 'Avatars/Professions/Business_Male_03',
  Business_Male_04: 'Avatars/Professions/Business_Male_04',
  Business_Male_05: 'Avatars/Professions/Business_Male_05',
  Business_Male_07: 'Avatars/Professions/Business_Male_07',
  Sports_Male_03: 'Avatars/Professions/Sports_Male_03',
  Sports_Female_02: 'Avatars/Professions/Sports_Female_02',
};

const S = 'Animations/all_animations_max_motextr_static';
const XY = 'Animations/all_animations_max_motextr_xy';
const XYZ = 'Animations/all_animations_max_motextr_xyz';
/** only the arms, spine and head are kept: layered over sitting, standing or walking (avatars.ts) */
const UPPER = { upper: true };
/**
 * [game clip name, file, options?] — m_ clips play on male avatars, f_ on female ones.
 * Clips named *_upper are upper-body layers (converted with { upper: true }); { trim: s } keeps
 * only the first s seconds of a long take.
 */
export const ANIMS = [
  ['m_idle', `${S}/m_idle_neutral_01`],
  ['f_idle', `${S}/f_idle_neutral_01`],
  ['m_idle_breathe', `${S}/m_idle_breathe_01`],
  ['f_idle_breathe', `${S}/f_idle_breathe_01`],
  ['m_idle_nervous', `${S}/m_idle_nervous_01`],
  ['f_idle_nervous', `${S}/f_idle_nervous_01`],
  ['m_idle_cough', `${S}/m_idle_cough_01`],
  ['f_idle_cough', `${S}/f_idle_cough_01`],
  ['m_talk', `${S}/m_gestic_talk_neutral_01`],
  ['f_talk', `${S}/f_gestic_talk_neutral_01`],
  ['m_talk_nervous', `${S}/m_gestic_talk_nervous_01`],
  ['f_talk_nervous', `${S}/f_gestic_talk_nervous_01`],
  ['m_talk_sad', `${S}/m_gestic_talk_sad_01`],
  ['f_talk_sad', `${S}/f_gestic_talk_sad_01`],
  ['m_listen', `${S}/m_gestic_listen_neutral_01`],
  ['f_listen', `${S}/f_gestic_listen_neutral_01`],
  ['m_sit', `${S}/m_sit_chair_idle_neutral_01`],
  ['f_sit', `${S}/f_sit_chair_idle_neutral_01`],
  ['m_sit_nervous', `${S}/m_sit_chair_idle_nervous_01`],
  ['f_sit_nervous', `${S}/f_sit_chair_idle_waiting_01`],
  ['m_sit_desk', `${S}/m_sit_table_idle_neutral_01`],
  ['f_sit_desk', `${S}/f_sit_table_idle_neutral_01`],
  ['m_documents', `${S}/m_documents_idle`],
  ['f_documents', `${S}/f_documents_idle`],
  ['m_walk', `${XY}/m_walk_neutral_01`],
  ['f_walk', `${XY}/f_walk_neutral_01`],
  ['m_walk_slow', `${XY}/m_walk_slow_01`],
  ['f_walk_slow', `${XY}/f_walk_slow_01`],
  ['m_walk_fast', `${XY}/m_walk_fast_01`],
  ['f_walk_fast', `${XY}/f_walk_fast_01`],
  // runs at three paces, so every speed plays a mocap cycle near its natural cadence
  // (a jog sped up to sprint speed reads as frantic "flying"); chosen by speed in avatars.ts
  ['m_run_slow', `${XY}/m_run_slow_01`],
  ['f_run_slow', `${XY}/f_run_slow_01`],
  ['m_run', `${XY}/m_run_neutral_01`],
  ['f_run', `${XY}/f_run_neutral_01`],
  ['m_run_fast', `${XY}/m_run_fast_01`],
  ['f_run_fast', `${XY}/f_run_fast_01`],
  // ── the waiting-room crowd (server/sim/ambient.ts): phones, small talk, a faint and its responders ──
  ['m_phone_text_upper', `${S}/m_cell_phone_textmessage`, UPPER],
  ['f_phone_text_upper', `${S}/f_cell_phone_textmessage`, UPPER],
  ['m_phone_call_upper', `${S}/m_cell_phone_talk_01`, UPPER],
  ['f_phone_call_upper', `${XYZ}/f_cell_phone_talk_01`, UPPER],
  ['m_film_upper', `${S}/m_take_picture`, UPPER],
  ['f_film_upper', `${S}/f_take_picture`, UPPER],
  ['m_drink_upper', `${S}/m_drink_drinking`, UPPER],
  ['f_drink_upper', `${S}/f_drink_drinking`, UPPER],
  ['m_laugh_upper', `${S}/m_gestic_laugh_low`, UPPER],
  ['f_laugh_upper', `${S}/f_gestic_laugh_low`, UPPER],
  ['m_carry_upper', `${S}/m_hold_bag_idle`, UPPER],
  ['f_carry_upper', `${S}/f_hold_bag_idle_01`, UPPER],
  ['m_push_upper', `${S}/m_trolley_idle`, UPPER],
  ['f_push_upper', `${S}/f_trolley_idle`, UPPER],
  ['m_crouch', `${S}/m_crouch_idle`],
  ['f_crouch', `${S}/f_crouch_idle`],
  ['m_crouch_talk', `${S}/m_crouch_gestic`],
  ['f_crouch_talk', `${S}/f_crouch_gestic`],
  ['m_crouch_in', `${XY}/m_crouch_in`],
  ['f_crouch_in', `${S}/f_crouch_in`],
  ['m_sit_cough', `${S}/m_sit_chair_idle_cough`],
  ['f_sit_cough', `${S}/f_sit_chair_idle_cough`],
  ['m_sit_yawn', `${S}/m_sit_chair_idle_yawn`],
  ['f_sit_yawn', `${S}/f_sit_chair_idle_yawn`],
  ['m_sit_look', `${S}/m_sit_chair_idle_look_around`],
  ['f_sit_look', `${S}/f_sit_chair_idle_look_around`],
  ['m_sit_face', `${S}/m_sit_chair_idle_touch_face`],
  ['f_sit_face', `${S}/f_sit_chair_idle_touch_face`],
  ['m_sit_wait', `${S}/m_sit_chair_idle_waiting_02`],
  ['f_sit_wait', `${S}/f_sit_chair_idle_waiting_02`],
  ['m_sit_breathe', `${S}/m_sit_chair_breathe_01`],
  ['f_sit_breathe', `${S}/f_sit_chair_breathe_01`],
  ['m_idle_look', `${S}/m_idle_look_around_01`],
  ['f_idle_look', `${S}/f_idle_look_around_01`],
  // unsteady on his feet before he faints (the first seconds of a sway, played slowly)
  ['m_unsteady', `${S}/m_idle_drunk_01`, { trim: 8 }],
  ['f_unsteady', `${S}/f_idle_drunk_01`, { trim: 8 }],
];

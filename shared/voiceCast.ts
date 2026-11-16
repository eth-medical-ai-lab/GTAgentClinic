// Authored voices for people who appear in both local shifts and the public ED tour.
import type { TtsVoice } from './voices';

export const VOICE_CAST = {
  tech_marcus: { id: 'am_eric', speed: 1.03 },
  rn_rosa: { id: 'af_bella', speed: 1.04 },
  rn_tom: { id: 'am_echo', speed: 1.06 },
  rn_aisha: { id: 'af_sarah', speed: 1 },
  att_shaw: { id: 'af_heart', speed: 0.97 },
  clerk_paul: { id: 'bm_daniel', speed: 1 },
  vis_1: { id: 'af_jessica', speed: 1.05 },
  caf_luis: { id: 'bm_fable', speed: 1 },
  pt_p_keller: { id: 'am_fenrir', speed: 0.96 },
  fam_linda: { id: 'af_alloy', speed: 1.03 },
  pt_p_brunner: { id: 'bf_emma', speed: 0.86 },
  pt_p_okafor: { id: 'am_puck', speed: 1.04 },
  cards: { id: 'bf_isabella', speed: 1.1 },
  lab: { id: 'am_onyx', speed: 1.04 },
  gp_whitfield: { id: 'af_aoede', speed: 1 }, // the after-hours answering service
} satisfies Record<string, Required<TtsVoice>>;

import { dischargeExit, dischargePickup, PUSH_GAP, spotFor, type LayoutDef } from '../../shared/layout';
import type { NpcView } from '../../shared/types';

/** Keep the bedside handoff and the trip to the public entrance on the nurse task's clock. */
export function applyDischargePresentation(npc: NpcView, bed: string, layout: LayoutDef, now: number): void {
  const d = npc.discharge;
  if (!d || d.phase === 'paperwork' || d.phase === 'departed') return;
  const bedside = dischargePickup(layout, bed);
  if (!bedside) return;
  const passenger = npc.role === 'patient';
  const wheelchair = d.mobility === 'wheelchair';
  const patientNpc = `pt_${d.patientId}`;

  if (d.phase === 'leaving') {
    const outside = dischargeExit(layout);
    npc.location = 'exterior';
    npc.spot = 'exit';
    npc.talkable = false;
    npc.posture = passenger && wheelchair ? 'sit' : 'stand';
    if (passenger) {
      delete npc.bedPosition;
      delete npc.scan;
      npc.ambient = wheelchair
        ? { crowd: false, at: outside, props: ['wheelchair'], pushedBy: d.nurseId }
        : { crowd: false, at: outside };
    } else npc.ambient = { crowd: false, at: outside, act: 'push', look: patientNpc };
    return;
  }

  const loading = d.phase === 'handoff' && d.until !== undefined && now >= d.until - 20;
  const rot = spotFor(layout, bed, 'bed')?.rot ?? 0;
  const chair = { x: bedside.x, z: bedside.z, rot };
  if (!passenger) {
    // A nurse brings the empty chair to the transfer spot before the rider takes it.
    const handles = { x: chair.x - PUSH_GAP * Math.sin(rot), z: chair.z - PUSH_GAP * Math.cos(rot), rot };
    npc.posture = 'stand';
    if (wheelchair && (loading || d.phase === 'awaiting_nurse')) {
      npc.ambient = { crowd: false, at: handles, act: 'push', props: loading ? [] : ['wheelchair'], look: loading ? patientNpc : undefined };
    } else {
      npc.ambient = {
        crowd: false, at: wheelchair ? handles : { ...handles, rot: rot - Math.PI / 2 },
        act: 'clipboard', props: wheelchair ? ['wheelchair', 'clipboard'] : ['clipboard'], look: patientNpc,
      };
    }
  } else if (loading) {
    delete npc.bedPosition;
    npc.posture = wheelchair ? 'sit' : 'stand';
    npc.ambient = { crowd: false, at: chair, props: wheelchair ? ['wheelchair'] : [], look: d.nurseId };
  } else if (d.phase === 'handoff') {
    npc.ambient = { crowd: false, look: d.nurseId };
  }
}

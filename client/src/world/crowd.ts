/**
 * The waiting-room crowd in the 3D world (server/sim/ambient.ts sends it as NpcView.ambient):
 * dresses each person with their props (accessories.ts) and passes their act to the avatar, and
 * turns the crowd's cues into sound through the soundscape (audio/soundscape.ts): a small dog
 * yapping in its carrier, coughs, the overhead rapid-response page, the soft thud of a faint,
 * music leaking from earbuds, a wheelchair rolling. Recordings: res/audio/crowd (CREDITS.txt).
 */
import * as THREE from 'three';
import { PUSH_GAP } from '../../../shared/layout';
export { PUSH_GAP } from '../../../shared/layout';
import type { AmbientProp, NpcView } from '../../../shared/types';
import { overheadPage, playSound, type SoundHandle } from '../audio/soundscape';
import { buildProp, disposeProps, WALKER_GRIPS, WALKER_WHEEL, type PropMesh } from './accessories';
import { AvatarCharacter } from './avatars';
import type { Character } from './characters';
import { feetOnPlates, gripHandles, holdAnkles, readClipboard, steadyArm } from './contact';
import { holdPose, poseLaptop, poseNewspaper, turnPhase } from './reading';

/** The chair sits 2 cm behind the rider's own origin. */
const CHAIR_Z = -0.02;
/** acts done with a phone in the hand */
const PHONE_ACTS = new Set(['phone_text', 'phone_call', 'film']);
/** a rollator's centre this far in front of its user: grips 0.34 m ahead at the hips, front wheels 0.58 m */
const WALKER_AHEAD = 0.36;

type Pose = { x: number; z: number; rot: number };

const CROWD_AUDIO = '/res/audio/crowd/';
const COUGHS = { m: ['cough-m-1', 'cough-m-2', 'cough-m-3', 'cough-m-4'], f: ['cough-f-1'] };
const BARKS = ['dog-bark-1', 'dog-bark-2', 'dog-bark-3'];

interface Dressed {
  props: Map<AmbientProp, PropMesh>;
  key: string;
  /** shadow casting switched off (crowd avatars) */
  unshadowed?: boolean;
  cueT?: number;
  act?: string;
  earbuds?: SoundHandle;
  wobbleUntil: number;
  rolling: boolean;
  /** reading.ts: how much the hands hold the paper / type (eased 0..1), and which */
  hold?: number;
  holdWhat?: 'read' | 'type';
  ch?: Character;
  /** who they look at (the one they hold, steady or push), where they are going, and who pushes them */
  look?: string;
  at?: Pose;
  pushedBy?: string;
  /** The nurse has parked the empty wheelchair beside the bed to read the paperwork. */
  parkedForHandoff?: boolean;
  /** contact.ts: how much the hands are where they hold (eased 0..1), and whose legs they hold */
  contactW: number;
  legsOf?: AvatarCharacter;
  /** a wheelchair taken from where it was parked: its pose then, and how far it has come round (0..1) */
  chairFrom?: Pose & { t: number };
  lastNow?: number;
  lastMoving?: boolean;
  /** how far the holding hands are from where they hold (contact.ts, last frame; m), and for how long they have missed */
  gap?: number;
  missT?: number;
  /** a rollator: the side it is parked on while seated, and where its front wheels were last frame */
  walkerSide?: number;
  walkerAt?: { x: number; z: number };
  /** calling a name off a clipboard: how long she has been reading it (s), and how far she looks up from it (0..1) */
  readT?: number;
  lookUp?: number;
}

/** ?crowd=0 hides the crowd (A/B for performance work); the staff it borrows still move */
export const crowdOff = typeof location !== 'undefined' && new URLSearchParams(location.search).get('crowd') === '0';

export class Crowd {
  private people = new Map<string, Dressed>();
  private n = 0;
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  /**
   * The corridor's parked wheelchair (wheelchair.ts): taken when someone first wheels one (it vanishes
   * there and their prop starts from its pose), given back once nobody has one. null: it isn't parked
   * near them (you sit in it, or it was moved): theirs is another one.
   */
  borrowChair?: (near: { x: number; z: number }) => Pose | null;
  returnChair?: () => void;
  private chairOut = false;
  private chairBackAt = 0;

  /** props, act and cues for one NPC this view (call for every NPC with v.ambient) */
  sync(v: NpcView, ch: Character, at: { x: number; z: number; rot?: number }, approaching: boolean): void {
    const av = ch instanceof AvatarCharacter ? ch : null;
    let a = v.ambient;
    let d = this.people.get(v.id);
    if (!a) {
      if (d) this.drop(v.id, ch);
      if (av) av.act = undefined;
      return;
    }
    if (!d) this.people.set(v.id, (d = { props: new Map(), key: '', wobbleUntil: 0, rolling: false, contactW: 0 }));
    const handoff = v.discharge?.phase === 'handoff' && a.act === 'clipboard' && a.props?.includes('wheelchair');
    d.parkedForHandoff = handoff && !approaching;
    if (handoff && approaching) a = { ...a, act: 'push', props: ['wheelchair'], look: undefined };
    d.ch = ch;
    d.look = a.look;
    d.at = { x: at.x, z: at.z, rot: at.rot ?? 0 };
    d.pushedBy = a.pushedBy;
    if (av && a.crowd && !d.unshadowed && av.ready) {
      // the waiting room has no shadow-casting light (only the bays' exam lights and the sun do), and a
      // skinned avatar (never frustum-culled) would otherwise be drawn into every one of their maps
      av.root.traverse((o) => (o.castShadow = false));
      d.unshadowed = true;
    }
    if (av) {
      // a faint hits the floor: a soft thud where he goes down
      if (d.act === 'buckle' && a.act === 'floor') playSound('thud', { at: { x: at.x, y: 0.15, z: at.z }, gain: 0.45, range: 25 });
      av.act = a.act;
      av.legsUp = !!a.legsUp;
      // in a wheelchair the feet rest on its footrests, not the floor
      av.footRest = a.props?.includes('wheelchair') ? 0.13 : 0.025;
    }
    d.act = a.act;
    // props: worn or carried; the walker is also "pushed" while walking. Texting, a call or filming
    // always has a phone in the hand (never the gesture round an empty hand)
    const want = PHONE_ACTS.has(a.act ?? '') && !a.props?.includes('phone') ? [...(a.props ?? []), 'phone' as AmbientProp] : (a.props ?? []);
    const key = want.join(',');
    if (key !== d.key && av) {
      for (const [kind, p] of d.props) {
        if (want.includes(kind)) continue;
        av.detach(p.obj);
        d.props.delete(kind);
        if (kind === 'wheelchair') this.chairLeft();
      }
      for (const kind of want) {
        if (d.props.has(kind)) continue;
        const p = buildProp(kind);
        if (!p) continue;
        av.attach(p.obj, p.mount);
        d.props.set(kind, p);
        // the first wheelchair out is the corridor's parked one (it comes from somewhere real)
        if (kind === 'wheelchair' && !this.chairOut) {
          const from = this.borrowChair?.({ x: ch.root.position.x, z: ch.root.position.z }) ?? null;
          if (from) {
            this.chairOut = true;
            d.chairFrom = { ...from, t: 0 };
          }
        }
        if (kind === 'wheelchair') this.chairBackAt = 0;
      }
      d.key = key;
    }
    // music leaking from earbuds: only audible a step away
    if (want.includes('earbuds') && !d.earbuds) d.earbuds = playSound('earbuds', { npc: v.id, loop: true, gain: 0.32, range: 3 });
    if (!want.includes('earbuds') && d.earbuds) {
      d.earbuds.stop(0.5);
      d.earbuds = undefined;
    }
    // one-shot cues (each once: `t` dedupes)
    if (a.cue && a.cue.t !== d.cueT) {
      d.cueT = a.cue.t;
      this.cue(v, ch, d, a.cue.kind, a.cue.text);
    }
  }

  private cue(v: NpcView, ch: Character, d: Dressed, kind: string, text?: string) {
    const female = ch instanceof AvatarCharacter && /Female/.test(ch.cast.id);
    if (kind === 'cough') {
      const list = female ? COUGHS.f : COUGHS.m;
      const masked = v.ambient?.props?.includes('mask');
      playSound({ url: `${CROWD_AUDIO}${list[this.n++ % list.length]}.mp3` }, { npc: v.id, gain: masked ? 0.5 : 0.7, range: 22, rate: 0.96 + (this.n % 5) * 0.02 });
    } else if (kind === 'dog_bark') {
      const carrier = d.props.get('carrier')?.obj;
      const p = carrier ? carrier.getWorldPosition(this.v) : ch.root.getWorldPosition(this.v);
      playSound({ url: `${CROWD_AUDIO}${BARKS[this.n++ % BARKS.length]}.mp3` }, { at: { x: p.x, y: 0.25, z: p.z }, gain: 0.85, range: 35 });
      d.wobbleUntil = performance.now() + 900;
    } else if (kind === 'overhead' && text) overheadPage(text, { priority: 'stat', repeat: 2 });
  }

  /** per frame: floor props follow the posture, the carrier shivers when the dog yaps, chairs roll, hands hold */
  frame(id: string, ch: Character, moving: boolean, now: number): void {
    // the borrowed wheelchair goes back where it was parked once nobody has one (after a moment: it may change hands)
    if (this.chairBackAt && now > this.chairBackAt) {
      this.chairBackAt = 0;
      if (this.chairOut && ![...this.people.values()].some((p) => p.props.has('wheelchair'))) {
        this.chairOut = false;
        this.returnChair?.();
      }
    }
    const d = this.people.get(id);
    if (!d) return;
    const dt = Math.min(0.1, Math.max(0, (now - (d.lastNow ?? now)) / 1000));
    d.lastNow = now;
    this.contact(d, ch, moving, dt);
    if (!d.props.size) return;
    const seated = ch.posture === 'sit';
    const walker = d.props.get('walker')?.obj;
    if (walker) {
      // walking or standing: in front at the hips' reach, his hands on its grips (contact). Seated: parked
      // beside the chair, in front of the free seat next to his (else to one side in front), not across his knees
      if (seated) d.walkerSide ??= this.parkSide(d, ch);
      else d.walkerSide = undefined;
      const side = d.walkerSide ?? 0;
      const tx = seated ? (side ? side * 0.75 : 0.45) : 0;
      const tz = seated ? (side ? 0.5 : 0.62) : WALKER_AHEAD;
      const k = Math.min(1, dt * 3);
      walker.position.set(walker.position.x + (tx - walker.position.x) * k, 0, walker.position.z + (tz - walker.position.z) * k);
      // the front wheels roll with the ground they cover (turning on the spot swings it round too)
      walker.updateWorldMatrix(true, false);
      const at = walker.localToWorld(this.v.set(0, 0, WALKER_WHEEL.z));
      if (d.walkerAt) {
        const fwd = this.v2.set(0, 0, 1).transformDirection(walker.matrixWorld);
        const run = (at.x - d.walkerAt.x) * fwd.x + (at.z - d.walkerAt.z) * fwd.z;
        if (Math.abs(run) < 0.5) for (const w of walker.children) if (w.name === 'wheel') w.rotation.x += run / WALKER_WHEEL.r;
      }
      d.walkerAt = { x: at.x, z: at.z };
    }
    const carrier = d.props.get('carrier')?.obj;
    if (carrier) {
      // beside her chair on the floor; carried at her side when she walks
      if (moving) carrier.position.set(-0.3, 0.5 + Math.sin(now / 160) * 0.015, 0.06);
      else carrier.position.set(seated ? -0.2 : -0.38, 0, seated ? 0.5 : 0.05);
      carrier.rotation.set(0, seated ? 0.25 : Math.PI / 2, now < d.wobbleUntil ? Math.sin(now / 38) * 0.045 : 0);
    }
    const chair = d.props.get('wheelchair')?.obj;
    if (chair) {
      // in front of whoever pushes it (handles at their hands); under whoever is wheeled in it; else
      // parked where they are going to sit, still while they step to it, turn and lower themselves in
      const yaw = ch.root.rotation.y;
      const want = this.chairPose(d, ch, seated);
      if (d.chairFrom) {
        // taken from where it was parked: turned out and brought round in front over ~1.2 s
        d.chairFrom.t = Math.min(1, d.chairFrom.t + dt / 1.2);
        const e = d.chairFrom.t * d.chairFrom.t * (3 - 2 * d.chairFrom.t);
        let dr = want.rot - d.chairFrom.rot;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        want.x = d.chairFrom.x + (want.x - d.chairFrom.x) * e;
        want.z = d.chairFrom.z + (want.z - d.chairFrom.z) * e;
        want.rot = d.chairFrom.rot + dr * e;
        if (d.chairFrom.t >= 1) d.chairFrom = undefined;
      }
      // world → the person's frame
      const dx = want.x - ch.root.position.x;
      const dz = want.z - ch.root.position.z;
      chair.position.set(dx * Math.cos(yaw) - dz * Math.sin(yaw), 0, dx * Math.sin(yaw) + dz * Math.cos(yaw));
      chair.rotation.set(0, want.rot - yaw, 0);
      const rolls = moving && (d.act === 'push' || !!d.pushedBy);
      if (rolls && !d.rolling) playSound('cart', { npc: id, gain: 0.4, range: 18 });
      d.rolling = rolls;
    }
    // a broadsheet held open (a page turned now and then), a laptop typed on (reading.ts)
    const paper = d.props.get('newspaper')?.obj;
    const laptop = d.props.get('laptop')?.obj;
    if (paper || laptop) this.reading(id, ch, d, seated && !moving, now, paper, laptop);
  }

  /** seated with a rollator: the side (+1 his left, −1 his right) whose neighbouring seat nobody sits in, else 0 */
  private parkSide(d: Dressed, ch: Character): number {
    const yaw = ch.root.rotation.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const taken = (side: number) =>
      [...this.people.values()].some((p) => {
        if (p === d || !p.ch) return false;
        const dx = p.ch.root.position.x - ch.root.position.x;
        const dz = p.ch.root.position.z - ch.root.position.z;
        return Math.abs(dx * c - dz * s - side * 0.75) < 0.45 && Math.abs(dx * s + dz * c) < 0.7;
      });
    return !taken(1) ? 1 : !taken(-1) ? -1 : 0;
  }

  /** a wheelchair prop went away: if nobody has one a moment later, the borrowed chair goes back */
  private chairLeft() {
    if (this.chairOut) this.chairBackAt = performance.now() + 1500;
  }

  /** where a wheelchair prop should be (world x, z and the way it faces) */
  private chairPose(d: Dressed, ch: Character, seated: boolean): Pose {
    const x = ch.root.position.x;
    const z = ch.root.position.z;
    const yaw = ch.root.rotation.y;
    const along = (px: number, pz: number, rot: number, k: number): Pose => ({ x: px + Math.sin(rot) * k, z: pz + Math.cos(rot) * k, rot });
    if (d.parkedForHandoff && d.at) return along(d.at.x, d.at.z, d.at.rot, PUSH_GAP + CHAIR_Z);
    if (d.act === 'push') return along(x, z, yaw, PUSH_GAP + CHAIR_Z);
    if (d.pushedBy || (seated && !d.at)) return along(x, z, yaw, CHAIR_Z);
    const at = d.at ?? { x, z, rot: yaw };
    return along(at.x, at.z, at.rot, CHAIR_Z);
  }

  /**
   * Hands where they hold (contact.ts): a friend's on the ankles of the man whose legs she raises
   * (they only rise while she holds them), a nurse's on his arm, a pusher's on the handles. The hold
   * eases in once they are there (and still), and out when they let go or walk off.
   */
  private contact(d: Dressed, ch: Character, moving: boolean, dt: number) {
    const av = ch instanceof AvatarCharacter ? ch : null;
    if (!av || d.props.has('newspaper') || d.props.has('laptop')) return;
    const board = d.props.get('clipboard')?.obj;
    const other = d.look ? this.people.get(d.look) : undefined;
    const them = other?.ch instanceof AvatarCharacter ? other.ch : null;
    const dist = them ? Math.hypot(them.root.position.x - ch.root.position.x, them.root.position.z - ch.root.position.z) : Infinity;
    let want = 0;
    let pose: ((a: AvatarCharacter) => void) | undefined;
    if (d.act === 'hold_legs' && them) {
      // squatting past his heels (~1.35 m from his hips), still
      want = !moving && dist < 1.8 && them.posture === 'lie' ? 1 : 0;
      d.legsOf = them;
      pose = (a) => {
        d.gap = holdAnkles(a, them, d.contactW);
      };
    } else if (d.act === 'steady' && them) {
      // close enough to reach his arm, neither of them walking
      const walking = !!other && (other.lastMoving ?? false);
      want = !moving && !walking && dist < 0.95 ? 1 : 0;
      pose = (a) => void steadyArm(a, them, d.contactW);
    } else if (d.props.has('walker') && ch.posture !== 'sit') {
      // a rollator: both hands on its grips, walking or standing
      const walker = d.props.get('walker')!.obj;
      want = 1;
      pose = (a) => void gripHandles(a, walker, d.contactW, WALKER_GRIPS);
    } else if (ch.posture === 'sit' && d.props.has('wheelchair')) {
      // in the wheelchair: feet on its footplates
      const chair = d.props.get('wheelchair')!.obj;
      want = 1;
      pose = (a) => void feetOnPlates(a, chair, d.contactW);
    } else if (d.act === 'push') {
      const chair = d.props.get('wheelchair')?.obj ?? other?.props.get('wheelchair')?.obj;
      if (chair) {
        chair.updateWorldMatrix(true, false);
        const cx = chair.matrixWorld.elements[12];
        const cz = chair.matrixWorld.elements[14];
        // its handles within reach (they are ~0.3 m in front of you when you push)
        want = Math.hypot(cx - ch.root.position.x, cz - ch.root.position.z) < PUSH_GAP + 0.25 ? 1 : 0;
        pose = (a) => void gripHandles(a, chair, d.contactW);
      }
    } else if (board && ch.posture === 'stand' && (d.act === 'clipboard' || d.contactW > 0)) {
      // calling the next name: standing still, the clipboard up to read; she looks up at the room as she
      // calls (and every few seconds: ~3 s on the list, ~2 s on the room). Lowered as she walks off
      want = d.act === 'clipboard' && !moving ? 1 : 0;
      d.readT = moving ? 0 : (d.readT ?? 0) + dt;
      const up = av.speaking > 0.02 || d.readT % 5.5 > 3.3 ? 1 : 0;
      d.lookUp = (d.lookUp ?? 0) + Math.max(-dt * 2.5, Math.min(dt * 2.5, up - (d.lookUp ?? 0)));
      pose = (a) => readClipboard(a, board, d.contactW, d.lookUp ?? 0);
    }
    // (the clipboard back on its mount at her side once the hold has eased out: readClipboard with w 0)
    if (board && !(d.contactW > 0 && pose)) readClipboard(av, board, 0, 0);
    d.contactW += Math.max(-dt / 0.35, Math.min(dt / 0.45, want - d.contactW));
    if (d.contactW < 0.003) d.contactW = 0;
    av.postPose = d.contactW > 0 && pose ? pose : undefined;
    // the legs rise with her hands as they take hold (the hands follow the ankles up), and come down
    // before she lets go. Hands that still miss the ankles a moment after they should have them (out of
    // reach) let them down again: legs never stay up on nothing
    if (d.legsOf) {
      // (the wrist aims a palm's length short of the heel: within 12 cm of that, the hand cradles it)
      const miss = (d.gap ?? Infinity) > 0.12 && d.contactW > 0.95;
      d.missT = miss ? (d.missT ?? 0) + dt : 0;
      d.legsOf.legHold = d.missT < 1.6 ? Math.max(0, Math.min(1, (d.contactW - 0.4) / 0.6)) : Math.max(0, d.legsOf.legHold - dt / 1.2);
      if (d.act !== 'hold_legs' && d.contactW === 0) d.legsOf = undefined;
    }
    d.lastMoving = moving;
  }

  private reading(id: string, ch: Character, d: Dressed, still: boolean, now: number, paper?: THREE.Object3D, laptop?: THREE.Object3D) {
    const k = ch.height / 1.75;
    let seed = 7;
    for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
    const read = still && d.act === 'read' && !!paper;
    const type = still && d.act === 'laptop' && !!laptop;
    const av = ch instanceof AvatarCharacter ? ch : null;
    // (on the lap: on the thighs themselves, from the hip and knee joints: reading.ts onLap)
    if (paper) poseNewspaper(paper, read ? 'read' : still ? 'lap' : 'carry', k, read ? turnPhase(seed, now) : 0, av ?? undefined);
    if (laptop) poseLaptop(laptop, type ? 'type' : still ? 'lap' : 'carry', k, av ?? undefined);
    if (!av) return;
    if (read || type) d.holdWhat = read ? 'read' : 'type';
    d.hold = (d.hold ?? 0) + ((read || type ? 1 : 0) - (d.hold ?? 0)) * 0.12;
    const obj = d.holdWhat === 'read' ? paper : laptop;
    av.postPose = d.hold > 0.01 && obj ? (a) => holdPose(a, obj, d.holdWhat!, d.hold ?? 0, performance.now() / 1000, seed) : undefined;
  }

  private drop(id: string, ch: Character) {
    const d = this.people.get(id);
    if (!d) return;
    const av = ch instanceof AvatarCharacter ? ch : null;
    for (const p of d.props.values()) av ? av.detach(p.obj) : p.obj.removeFromParent();
    if (av) av.postPose = undefined;
    if (d.legsOf) d.legsOf.legHold = 0;
    d.earbuds?.stop(0.3);
    this.people.delete(id);
    if (d.props.has('wheelchair')) this.chairLeft();
  }

  /** someone left the world (removed from the scene) */
  remove(id: string, ch: Character) {
    this.drop(id, ch);
  }

  dispose() {
    for (const d of this.people.values()) d.earbuds?.stop(0);
    this.people.clear();
    disposeProps();
  }
}

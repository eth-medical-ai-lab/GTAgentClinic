/**
 * Paying for things, off the record like everything in amenities.ts (no game time, no score, never in
 * the clinical log, and nothing the server's simulation sees):
 *
 *   - a coffee from the cafeteria's self-serve machine is $2.25, owed from the moment it pours. A chip
 *     on the screen says so until it's paid; putting the cup down and picking it up again, drinking it
 *     or binning it changes nothing
 *   - [E] at the till (or on the cashier) pays: you turn to the counter's card terminal, the free hand
 *     takes your phone out of your pocket and holds its back to the terminal (a beep, "Approved" on
 *     its screen), then puts it away, and the cashier thanks you. With both hands full: put something
 *     down first (G)
 *   - heading out of the cafeteria with a coffee still owed, the cashier calls after you and comes over
 *     with his handheld terminal, round the tables and people (the world's own NPC walking); [E] on him
 *     pays the same way, a tap on the terminal he holds out, and he walks back to the till. Already
 *     far down the corridor: he stops at the cafeteria door, calls again, and goes back (you still owe)
 *   - the vending machine takes a tap at its reader before it drops a can (amenities.ts asks)
 *
 * The cashier's walk is an errand from here: World walks him to our destination meanwhile and keeps the
 * server's place for him, and he walks back to it after. Why not the server's ambient system: the coffee
 * and what's owed exist only in this client, the ambient plan is fixed at the session's start on its own
 * seed and runs in game time (it stops with the clock), and an action would put a café chore into the
 * action space the agents share. The client walks every NPC anyway (steering.ts: round tables and
 * people); the server only names where they should be. His lines go out as an aside (server/index.ts
 * only voices them, for this player; nothing in the session changes).
 */
import * as THREE from 'three';
import type { LayoutDef, PropDef } from '../../../shared/layout';
import type { CameraMode } from '../../../shared/types';
import * as SND from '../audio/amenities';
import { buildProp, PHONE } from './accessories';
import type { AvatarCharacter } from './avatars';
import type { Character } from './characters';
import { lerpAngle, type PlayerController } from './controls';
import { armBones, reachArm, type ArmBones, type HandSide, type PlayerHands } from './hands';
import { blend, FINGERS, Hands, palmQuat, ramp, restPose, smooth, UP, type Frame, type HandPose } from './handPoses';
import type { ItemSystem } from './itemSystem';
import { canvasTexture, G, lambert, makeCanvas, own } from './materials';
import { hashString, leftHanded } from './phone';

/** a cafeteria coffee (the menu board says so too) and a can from the vending machine */
export const COFFEE_PRICE = 2.25;
export const CAN_PRICE = 1.75;
export const CASHIER = 'caf_luis';
const money = (x: number) => `$${x.toFixed(2)}`;

/** World's NPCs, as the cashier's errand needs them */
export interface NpcErrands {
  /** where an NPC is (null: not in the world, or not visible) */
  get(id: string): { x: number; z: number; yaw: number; walking: boolean; ch: Character } | null;
  /** walk it to (x, z), facing `rot` once there, at `pace` m/s: our errand until home() */
  go(id: string, x: number, z: number, rot: number, pace?: number): boolean;
  /** turn it where it stands */
  face(id: string, yaw: number): void;
  /** the errand is over: it walks back to where the server has it */
  home(id: string): void;
  /** where the server has it (the cashier: his till) */
  homeOf(id: string): { x: number; z: number; rot: number } | null;
}

export interface PaymentDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: PlayerController;
  layout: LayoutDef;
  items: ItemSystem;
  hands: PlayerHands;
  avatar(): AvatarCharacter | null;
  cameraMode(): CameraMode;
  hint(text: string, ms?: number): void;
  sound(name: string, render: (sr: number) => Float32Array, at: THREE.Vector3, gain: number, range: number): void;
  /** the world's overlay (the chip saying what you owe) */
  container?: HTMLElement;
  npcs?: NpcErrands;
  /** a line said by an NPC (bubble, and voiced when voices are on) */
  say?(id: string, text: string): void;
  /** a walk for the player on its storey's nav grid (null: no way) */
  path?(x: number, z: number): THREE.Vector2[] | null;
  /** what you owed is paid (amenities.ts: the cups' inspect text) */
  onSettled?(): void;
}

// ───────────────────────────── card terminals ─────────────────────────────

type Shows = { kind: 'idle' } | { kind: 'due'; amount: number } | { kind: 'approved'; amount: number };
type TerminalKind = 'counter' | 'handheld' | 'reader';

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700, align: CanvasTextAlign = 'center') {
  let s = Math.round(size);
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 7) ctx.font = `${weight} ${--s}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** the contactless mark: three arcs fanning to the right (a generic "tap here", no one's logo) */
function waves(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.13);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x - s * 0.5, y, s * (0.35 + i * 0.28), -0.75, 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A terminal's face: the screen above, and (the counter and handheld ones) a keypad below. One canvas
 * per terminal, redrawn when what it shows changes.
 */
class TerminalFace {
  readonly tex: THREE.CanvasTexture;
  readonly mat: THREE.MeshStandardMaterial;
  private ctx: CanvasRenderingContext2D;
  private key = '';
  /** the screen's middle on the face (0..1 from the top) */
  readonly screenY: number;

  constructor(
    readonly kind: TerminalKind,
    readonly w: number,
    readonly h: number,
  ) {
    const px = kind === 'reader' ? [128, 160] : [128, 272];
    const { canvas, ctx } = makeCanvas(px[0], px[1]);
    this.ctx = ctx;
    this.tex = canvasTexture(canvas);
    this.mat = own(new THREE.MeshStandardMaterial({ map: this.tex, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 0.85, roughness: 0.28 }));
    this.screenY = kind === 'reader' ? 0.3 : 0.27;
    this.show({ kind: 'idle' });
  }

  show(s: Shows) {
    const key = JSON.stringify(s);
    if (key === this.key) return;
    this.key = key;
    const ctx = this.ctx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    // the casing around the glass (it reads as the body's colour), then the screen
    ctx.fillStyle = '#202326';
    ctx.fillRect(0, 0, W, H);
    const reader = this.kind === 'reader';
    const sx = 10;
    const sy = reader ? 10 : 14;
    const sw = W - 20;
    const sh = reader ? 76 : 120;
    ctx.fillStyle = s.kind === 'approved' ? '#0f3d24' : '#0e2433';
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 6);
    ctx.fill();
    const cx = W / 2;
    ctx.fillStyle = '#e8f3f7';
    if (s.kind === 'idle') {
      ctx.fillStyle = '#7fa3b3';
      fitText(ctx, reader ? 'Card or phone' : 'Welcome', cx, sy + sh * 0.42, sw - 12, reader ? 15 : 17, 600);
      waves(ctx, cx + 4, sy + sh * 0.74, reader ? 12 : 15, '#5f8798');
    } else if (s.kind === 'due') {
      ctx.fillStyle = '#9cc3d3';
      fitText(ctx, reader ? 'PAY' : 'TOTAL', cx, sy + sh * 0.17, sw - 12, 12, 700);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, money(s.amount), cx, sy + sh * 0.42, sw - 12, reader ? 22 : 27, 800);
      waves(ctx, cx - 18, sy + sh * 0.76, reader ? 10 : 13, '#8fd3ff');
      ctx.fillStyle = '#cfe7f1';
      fitText(ctx, 'Tap', cx + 14, sy + sh * 0.76, 40, reader ? 12 : 14, 700);
    } else {
      // approved: a green tick
      ctx.strokeStyle = '#58e08a';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const ty = sy + sh * 0.33;
      ctx.beginPath();
      ctx.moveTo(cx - 14, ty);
      ctx.lineTo(cx - 4, ty + 10);
      ctx.lineTo(cx + 15, ty - 10);
      ctx.stroke();
      ctx.fillStyle = '#e9fff1';
      fitText(ctx, 'Approved', cx, sy + sh * 0.66, sw - 10, reader ? 15 : 18, 800);
      ctx.fillStyle = '#9fe0b6';
      fitText(ctx, money(s.amount), cx, sy + sh * 0.86, sw - 10, 12, 600);
    }
    if (!reader) {
      // the keypad: digits, then cancel / clear / enter (generic red, yellow, green)
      const kx = 16;
      const ky = sy + sh + 14;
      const kw = (W - 2 * kx - 16) / 3;
      const kh = 20;
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++) {
          const x = kx + c * (kw + 8);
          const y = ky + r * (kh + 7);
          ctx.fillStyle = '#3a3f44';
          ctx.beginPath();
          ctx.roundRect(x, y, kw, kh, 4);
          ctx.fill();
          ctx.fillStyle = '#d6dde2';
          const label = r < 3 ? String(r * 3 + c + 1) : ['*', '0', '#'][c];
          fitText(ctx, label, x + kw / 2, y + kh / 2 + 1, kw, 12, 700);
        }
      const fy = ky + 4 * (kh + 7) + 2;
      ['#b8322b', '#d9a51e', '#2f9e44'].forEach((col, c) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(kx + c * (kw + 8), fy, kw, 16, 4);
        ctx.fill();
      });
    } else {
      ctx.fillStyle = '#9aa7ad';
      fitText(ctx, 'COINS · CARD · PHONE', cx, sy + sh + 30, W - 16, 10, 700);
      waves(ctx, cx + 2, sy + sh + 58, 14, '#cfd8dc');
    }
    this.tex.needsUpdate = true;
  }
}

/**
 * A card terminal. Its frame: the face's middle, x to its right, y up the face, z out of it. The tap
 * point is the screen's middle; a phone held to it within a few centimetres pays.
 */
class Terminal {
  readonly obj = new THREE.Group();
  readonly face: TerminalFace;
  /** the screen's middle in the terminal's frame */
  readonly tapLocal: THREE.Vector3;
  /** when an "Approved" goes back to idle (s, Payment's clock) */
  approvedUntil = -1;

  constructor(readonly kind: TerminalKind) {
    const dark = lambert('#26292c', { roughness: 0.45 });
    const W = kind === 'reader' ? 0.072 : 0.078;
    const H = kind === 'reader' ? 0.092 : 0.168;
    const D = kind === 'reader' ? 0.018 : 0.024;
    const body = new THREE.Mesh(G.rbox(W, H, D, 0.008), dark);
    body.position.z = -D / 2;
    this.obj.add(body);
    if (kind === 'handheld') {
      // the printer's bulge on the back, at the bottom
      const back = new THREE.Mesh(G.rbox(W - 0.004, 0.07, 0.02, 0.008), dark);
      back.position.set(0, -H / 2 + 0.04, -D - 0.006);
      this.obj.add(back);
    }
    this.face = new TerminalFace(kind, W - 0.008, H - 0.008);
    const glassFace = new THREE.Mesh(G.plane(W - 0.008, H - 0.008), this.face.mat);
    glassFace.position.z = 0.0006;
    this.obj.add(glassFace);
    for (const c of this.obj.children) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
    this.tapLocal = new THREE.Vector3(0, (H - 0.008) * (0.5 - this.face.screenY), 0.0007);
  }

  /** the tap point, the face's normal and its up, world */
  pose(): { p: THREE.Vector3; n: THREE.Vector3; up: THREE.Vector3 } {
    const o = this.obj;
    o.updateWorldMatrix(true, false);
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    return { p: o.localToWorld(this.tapLocal.clone()), n: new THREE.Vector3(0, 0, 1).applyQuaternion(q), up: new THREE.Vector3(0, 1, 0).applyQuaternion(q) };
  }
}

/** a prop's local point in world space (x along its width, y up, z toward its front) */
function onProp(p: PropDef, lx: number, y: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
  const r = p.rot ?? 0;
  return out.set(p.x + lx * Math.cos(r) + lz * Math.sin(r), y, p.z - lx * Math.sin(r) + lz * Math.cos(r));
}

// ───────────────────────────── the phone's screen ─────────────────────────────

/** what the phone shows while you pay: a card in a wallet, then a tick (no one's brand) */
class WalletScreen {
  readonly mat: THREE.MeshStandardMaterial;
  private tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private state = '';

  constructor() {
    const { canvas, ctx } = makeCanvas(160, 345);
    this.ctx = ctx;
    this.tex = canvasTexture(canvas);
    this.mat = own(new THREE.MeshStandardMaterial({ map: this.tex, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 1.0, roughness: 0.16 }));
    this.show('hold', COFFEE_PRICE);
  }

  show(state: 'hold' | 'done', amount: number) {
    const key = `${state}|${amount}`;
    if (key === this.state) return;
    this.state = key;
    const ctx = this.ctx;
    const W = 160;
    const H = 345;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, W, H);
    // a payment card, tilted a little: a teal gradient, a chip, the last digits
    const g = ctx.createLinearGradient(14, 40, 146, 130);
    g.addColorStop(0, '#2a9d8f');
    g.addColorStop(1, '#1d3557');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(14, 44, 132, 84, 9);
    ctx.fill();
    ctx.fillStyle = '#e9c46a';
    ctx.beginPath();
    ctx.roundRect(28, 70, 22, 17, 3);
    ctx.fill();
    ctx.fillStyle = '#eaf4f4';
    fitText(ctx, '•••• 4821', 120, 112, 90, 12, 600, 'right');
    if (state === 'hold') {
      ctx.fillStyle = '#e8eef2';
      fitText(ctx, 'Hold near reader', W / 2, 172, W - 20, 15, 700);
      waves(ctx, W / 2 + 6, 226, 22, '#8fd3ff');
    } else {
      ctx.fillStyle = '#2fbf71';
      ctx.beginPath();
      ctx.arc(W / 2, 205, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(W / 2 - 13, 205);
      ctx.lineTo(W / 2 - 3, 215);
      ctx.lineTo(W / 2 + 14, 195);
      ctx.stroke();
      ctx.fillStyle = '#e8eef2';
      fitText(ctx, `Paid ${money(amount)}`, W / 2, 262, W - 20, 16, 700);
    }
    this.tex.needsUpdate = true;
  }

  /** a glass-sized plane on a phone's screen (its frame: accessories.ts PHONE) */
  plane(): THREE.Mesh {
    const m = new THREE.Mesh(G.plane(PHONE.dispW, PHONE.dispH), this.mat);
    m.position.z = PHONE.screenZ + 0.0004;
    m.castShadow = false;
    m.name = 'wallet';
    return m;
  }
}

// ───────────────────────────── a tap ─────────────────────────────

/**
 * A tap's timeline (s): the hand to the pocket, the phone out, up to 8 cm off the terminal, in to the
 * tap, held there (the beep at `beep`), back out, into the pocket, the hand back.
 */
const TAP = { pocket: 0.4, pre: 0.95, tap: 1.18, beep: 1.32, hold: 1.5, out: 1.75, away: 2.2, end: 2.6 };
/** the phone's antenna: its back, this far up from the middle (m), held this far off the terminal */
const ANTENNA = 0.035;
const GAP = 0.012;
/** how far the phone's top is tipped toward the terminal at the tap (rad) */
const TIP = 0.5;
/**
 * First person: the phone in the hand (the hand's frame, m): its back on the palm, the screen out of
 * it, the long side 40° from the fingers toward the thumb (the left hand's thumb is −Z).
 */
const FP_PHONE: Record<HandSide, THREE.Matrix4> = (() => {
  const make = (s: number) => {
    const a = (40 * Math.PI) / 180;
    const y = new THREE.Vector3(Math.cos(a), 0, s * Math.sin(a));
    const z = new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(y, z);
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(0.07, 0.019, s * 0.004);
  };
  return { R: make(1), L: make(-1) };
})();

interface TapAct {
  t: number;
  side: HandSide;
  term: Terminal;
  amount: number;
  /** walking up to it first (the player's path) */
  approach: THREE.Vector2[] | null;
  approachT: number;
  /** the body's turn toward the terminal (3P facing / FP view), from → to over dur */
  turn: { t: number; dur: number; f0: number; f1: number; y0: number; y1: number; p0: number; p1: number | null } | null;
  phoneOut: boolean;
  approved: boolean;
  /** how far the phone's antenna was from the terminal's tap point at the beep (m) */
  dist: number | null;
  onApproved: () => void;
  /** the cashier is there for it (his thanks) */
  cashier: boolean;
  /** at the cashier's handheld: he has stopped in front of you and holds it out (until then you wait) */
  ready: boolean;
}

// ───────────────────────────── the cashier ─────────────────────────────

type CashierState = 'home' | 'going' | 'waiting' | 'toDoor' | 'doorWait' | 'thanks' | 'returning';

const LINES = {
  call: "Doctor! That coffee's two twenty-five!",
  again: "Doctor! You still owe me for that coffee!",
  tap: 'Just tap here, Doc.',
  thanks: 'Thanks, have a good one!',
};

export class Payment {
  private hands: Hands;
  private wallet = new WalletScreen();
  /** what you owe: one entry per coffee */
  private owed: { id: string; what: string; amount: number }[] = [];
  private act: TapAct | null = null;
  private time = 0;
  private holdT: number | null = null;
  readonly till: Terminal | null = null;
  private tillBox: THREE.Box3 | null = null;
  private termBox: THREE.Box3 | null = null;
  readonly handheld: Terminal;
  private dock: THREE.Vector3 | null = null;
  readonly reader: Terminal | null = null;
  private cafe: { x0: number; x1: number; z0: number; z1: number } | null = null;
  private door: THREE.Vector3 | null = null;
  /** inside the cafeteria, by the door (where the cashier stops to call down the corridor) */
  private doorSpot: THREE.Vector3 | null = null;
  private chip: HTMLDivElement | null = null;
  /** the player's phone: in a hand bone (third person), or in the scene (first person) */
  private phoneTp: { root: THREE.Object3D; inner: THREE.Object3D; side: HandSide; rel: THREE.Matrix4 } | null = null;
  private phoneFp: THREE.Object3D;
  /** the third-person phone is fitted to the hand (phone.ts closes the fingers on it) */
  private fitted = true;
  /**
   * The cashier's errand: what he's doing and since when (s), where you were when he last set off after
   * you, whether heading out would bring him after you; his arm with the handheld (carried, held out)
   */
  private cashier: { state: CashierState; t: number; at: THREE.Vector2; retarget: number; armed: boolean; lastLine: string; hold: number; present: number; holdFn: ((a: AvatarCharacter, dt: number) => void) | null; arm: ArmBones | null; ch: Character | null } = { state: 'home', t: 0, at: new THREE.Vector2(), retarget: 0, armed: true, lastLine: '', hold: 0, present: 0, holdFn: null, arm: null, ch: null };
  /** the player's speed over the last moments (heading for the door?) */
  private prev = new THREE.Vector2(NaN, NaN);
  private vel = new THREE.Vector2();
  /** tests: the last few things that happened, with measurements */
  readonly events: Record<string, unknown>[] = [];
  /** tests: the paying hand's last target (third person), its shoulder, how far apart (m) */
  private lastTarget: Record<string, unknown> | null = null;

  constructor(private d: PaymentDeps) {
    this.hands = new Hands(d.scene, d.camera, d.hands, () => this.tp());
    const L = d.layout;
    const tillProp = L.props.find((p) => p.kind === 'till');
    if (tillProp) {
      // the customer's terminal: out over the counter's front on a swivel arm (the tray slide keeps you
      // 25 cm off the counter), tipped back toward you, so it's within an arm's reach from where you stand
      const t = new Terminal('counter');
      const y0 = tillProp.y ?? 0.92;
      const rot = tillProp.rot ?? 0;
      t.obj.position.copy(onProp(tillProp, 0.17, y0 + 0.19, 0.75));
      t.obj.rotation.set(-0.8, rot, 0, 'YXZ');
      const dark = lambert('#2a2d30', { roughness: 0.4, metalness: 0.4 });
      const base = new THREE.Mesh(G.cyl(0.042, 0.047, 0.012, 20), lambert('#1b1d1f', { roughness: 0.5 }));
      base.position.copy(onProp(tillProp, 0.17, y0 + 0.006, 0.48));
      const post = new THREE.Mesh(G.cyl(0.011, 0.013, 0.14, 12), dark);
      post.position.copy(onProp(tillProp, 0.17, y0 + 0.08, 0.48));
      const arm = new THREE.Mesh(G.rbox(0.024, 0.018, 0.26, 0.006), dark);
      arm.position.copy(onProp(tillProp, 0.17, y0 + 0.15, 0.61));
      arm.rotation.y = rot;
      // the cradle the terminal sits in, at the arm's end
      const cradle = new THREE.Mesh(G.rbox(0.05, 0.03, 0.03, 0.008), dark);
      cradle.position.copy(onProp(tillProp, 0.17, y0 + 0.155, 0.735));
      cradle.rotation.y = rot;
      d.scene.add(t.obj, base, post, arm, cradle);
      (this as { till: Terminal | null }).till = t;
      this.extras.push(t.obj, base, post, arm, cradle);
      for (const o of [base, post, arm, cradle]) o.castShadow = true;
      // aimed at, the till itself (its inspect card steps aside meanwhile: amenities.shadows) and the
      // terminal out on its arm
      this.tillBox = new THREE.Box3().setFromCenterAndSize(onProp(tillProp, -0.08, y0 + 0.26, -0.02), new THREE.Vector3(0.74, 0.58, 0.54));
      this.termBox = new THREE.Box3().setFromCenterAndSize(t.obj.position.clone().add(new THREE.Vector3(0, -0.03, 0)), new THREE.Vector3(0.16, 0.2, 0.16));
      // the cashier's handheld, in its charging cradle on his side of the counter
      this.dock = onProp(tillProp, 0.36, y0 + 0.09, -0.16);
      const cradle2 = new THREE.Mesh(G.rbox(0.09, 0.035, 0.075, 0.01), lambert('#1b1d1f', { roughness: 0.5 }));
      cradle2.position.copy(onProp(tillProp, 0.36, y0 + 0.0175, -0.15));
      cradle2.rotation.y = rot;
      cradle2.castShadow = true;
      d.scene.add(cradle2);
      this.extras.push(cradle2);
    }
    // (in its cradle; with no till on this map, nowhere)
    this.handheld = new Terminal('handheld');
    this.parkHandheld();
    this.extras.push(this.handheld.obj);
    const vend = L.props.find((p) => p.kind === 'vending');
    if (vend) {
      // at the top of the keypad panel, above the selection buttons (at shoulder height, within reach)
      const r = new Terminal('reader');
      r.obj.position.copy(onProp(vend, 0.33, 1.335, 0.438));
      r.obj.rotation.y = vend.rot ?? 0;
      d.scene.add(r.obj);
      (this as { reader: Terminal | null }).reader = r;
      this.extras.push(r.obj);
    }
    const room = L.rooms.find((r) => r.id === 'cafeteria');
    if (room) {
      this.cafe = { x0: room.rect.x, x1: room.rect.x + room.rect.w, z0: room.rect.z, z1: room.rect.z + room.rect.d };
      const dr = room.doors[0];
      if (dr) {
        const { x, z, w, d: dd } = room.rect;
        const mid = dr.offset + dr.width / 2;
        const at = dr.side === 's' ? [x + mid, z + dd] : dr.side === 'n' ? [x + mid, z] : dr.side === 'e' ? [x + w, z + mid] : [x, z + mid];
        const inward = dr.side === 's' ? [0, -1] : dr.side === 'n' ? [0, 1] : dr.side === 'e' ? [-1, 0] : [1, 0];
        this.door = new THREE.Vector3(at[0], 0, at[1]);
        this.doorSpot = new THREE.Vector3(at[0] + inward[0] * 0.75, 0, at[1] + inward[1] * 0.75);
      }
    }
    // the phone you see in first person (a hand of fpHands holds it)
    const fp = buildProp('phone', { mount: 'handR' });
    this.phoneFp = fp?.obj.getObjectByName('phone') ?? new THREE.Group();
    this.phoneFp.removeFromParent();
    this.phoneFp.matrixAutoUpdate = false;
    this.phoneFp.add(this.wallet.plane());
    this.phoneFp.visible = false;
    d.scene.add(this.phoneFp);
    this.extras.push(this.phoneFp);
    if (d.container) {
      this.chip = document.createElement('div');
      this.chip.className = 'wl-due';
      d.container.appendChild(this.chip);
    }
  }

  private extras: THREE.Object3D[] = [];

  private tp(): boolean {
    return this.d.cameraMode() !== 'first' && !!this.d.avatar()?.ready;
  }

  // ───────────────────────────── what you owe ─────────────────────────────

  /** a coffee poured at the cafeteria's machine (amenities.ts): owed until paid */
  charge(id: string, what = 'Coffee', amount = COFFEE_PRICE) {
    if (this.owed.some((o) => o.id === id)) return;
    this.owed.push({ id, what, amount });
    this.cashier.armed = true;
  }

  bills() { return this.owed.map(bill => ({ ...bill })); }

  owes(id: string): boolean {
    return this.owed.some((o) => o.id === id);
  }

  get total(): number {
    return this.owed.reduce((a, o) => a + o.amount, 0);
  }

  /** "Coffee $2.25 · pay at the till" */
  dueText(): string | null {
    if (!this.owed.length) return null;
    const n = this.owed.length;
    return `${n === 1 ? this.owed[0].what : `${n} coffees`} ${money(this.total)} · pay at the till`;
  }

  get busy(): boolean {
    return !!this.act;
  }

  // ───────────────────────────── targets ─────────────────────────────

  /** the till offers to take the money while you owe some (and the cashier isn't off after you) */
  targets(): { key: string; target: { kind: 'use'; id: string; label: string }; box: THREE.Box3; center: THREE.Vector3 }[] {
    if (!this.owed.length || !this.till || !this.tillBox || !this.termBox || this.away()) return [];
    const target = { kind: 'use' as const, id: 'pay:till', label: `Pay ${money(this.total)} (tap your phone)` };
    return [
      { key: 'use:pay:till', target, box: this.tillBox, center: this.tillBox.getCenter(new THREE.Vector3()) },
      { key: 'use:pay:till:terminal', target, box: this.termBox, center: this.termBox.getCenter(new THREE.Vector3()) },
    ];
  }

  /** E on the cashier pays, while you owe (World: in place of talking to him) */
  npcTarget(id: string): { kind: 'use'; id: string; label: string } | null {
    if (id !== CASHIER || !this.owed.length) return null;
    return { kind: 'use', id: `pay:${CASHIER}`, label: `Pay ${money(this.total)} (tap your phone)` };
  }

  /** the cashier is out from behind his counter (on his way to you, or back) */
  private away(): boolean {
    return this.cashier.state !== 'home';
  }

  /** E on 'pay:till' or 'pay:caf_luis' */
  interact(id: string) {
    if (!this.owed.length) return;
    const onLuis = id === `pay:${CASHIER}` && this.away() && this.cashier.state !== 'returning';
    const term = onLuis ? this.handheld : this.till;
    if (!term) return;
    const amount = this.total;
    this.start(term, amount, () => this.settle(term, amount), !!this.cashierHere(term));
  }

  /** where to stand at the vending machine to pay with this hand (null: no reader on this map) */
  readerStand(side: HandSide): THREE.Vector2 | null {
    return this.reader ? this.standFor(this.reader, side) : null;
  }

  /** the vending machine's reader: a tap for a can; `then` once it's approved */
  payVending(then: () => void): boolean {
    if (!this.reader) {
      then();
      return true;
    }
    return this.start(this.reader, CAN_PRICE, then, false);
  }

  /** is the cashier there to see it (at his till, or holding out his terminal)? */
  private cashierHere(term: Terminal): boolean {
    const n = this.d.npcs?.get(CASHIER);
    if (!n) return false;
    if (term === this.handheld) return true;
    const home = this.d.npcs?.homeOf(CASHIER);
    return !!home && Math.hypot(n.x - home.x, n.z - home.z) < 1.2;
  }

  private settle(term: Terminal, amount: number) {
    this.owed = [];
    this.events.push({ kind: 'paid', at: term.kind, amount, t: +this.time.toFixed(2) });
    const c = this.cashier;
    if (this.cashierHere(term)) {
      this.line(LINES.thanks);
      if (c.state !== 'home') {
        c.state = 'thanks';
        c.t = 0;
      }
    }
    this.d.onSettled?.();
  }

  // ───────────────────────────── a tap ─────────────────────────────

  /** start paying at a terminal: false (and a hint) when no hand is free */
  private start(term: Terminal, amount: number, onApproved: () => void, cashier: boolean): boolean {
    if (this.act) return false;
    const items = this.d.items;
    const free: HandSide | null = !items.hands.R ? 'R' : !items.hands.L ? 'L' : null;
    if (!free) {
      this.d.hint('Hands full: put something down to pay (G)', 2800);
      return false;
    }
    const a: TapAct = { t: 0, side: free, term, amount, approach: null, approachT: 0, turn: null, phoneOut: false, approved: false, dist: null, onApproved, cashier, ready: term !== this.handheld };
    this.act = a;
    term.face.show({ kind: 'due', amount });
    this.wallet.show('hold', amount);
    // (at the cashier: once he's stopped in front of you with his terminal out: tapFrame)
    if (a.ready && !this.stepUp(a)) {
      this.act = null;
      return false;
    }
    return true;
  }

  /** a step closer first if it's out of reach (the player's path), else straight into the turn to it */
  private stepUp(a: TapAct): boolean {
    const stand = this.standFor(a.term, a.side);
    const ctl = this.d.controller;
    // (a short step up is a step too: an arm's reach is all there is)
    if (stand && Math.hypot(ctl.pos.x - stand.x, ctl.pos.y - stand.y) > 0.12) {
      const path = this.d.path ? this.d.path(stand.x, stand.y) : [stand.clone()];
      if (!path || !path.length) {
        this.d.hint("Can't reach the card terminal from here", 1800);
        return false;
      }
      ctl.path = path;
      ctl.pathRun = false;
      a.approach = path;
      return true;
    }
    this.beginTurn(a);
    return true;
  }

  /**
   * Where to stand to reach a terminal with this hand (null: where you are will do): in front of it, a
   * little to the side so it's in front of that hand's shoulder; at the cashier, a comfortable arm's
   * length from what he holds out.
   */
  private standFor(term: Terminal, side: HandSide): THREE.Vector2 | null {
    const ctl = this.d.controller;
    if (term === this.handheld) {
      const c = this.d.npcs?.get(CASHIER);
      if (!c) return null;
      const dx = ctl.pos.x - c.x;
      const dz = ctl.pos.y - c.z;
      const dd = Math.hypot(dx, dz) || 1;
      if (dd < 1.05) return null;
      return new THREE.Vector2(c.x + (dx / dd) * 0.88, c.z + (dz / dd) * 0.88);
    }
    const { p, n } = term.pose();
    const out = n.clone().setY(0).normalize();
    // facing it (−out), your right is (−fz, 0, fx) of that: the body's middle goes to the other side
    const right = new THREE.Vector3(out.z, 0, -out.x);
    // (the till's: you stand up against the tray slide; the vending reader: right up to the machine)
    const d = term === this.till ? 0.4 : 0.34;
    const s = side === 'R' ? -0.17 : 0.17;
    return new THREE.Vector2(p.x + out.x * d + right.x * s, p.z + out.z * d + right.z * s);
  }

  /** turn to it: the body in third person, the view in first person (if it's out of view) */
  private beginTurn(a: TapAct) {
    const ctl = this.d.controller;
    const { p } = a.term.pose();
    const bearing = Math.atan2(p.x - ctl.pos.x, p.z - ctl.pos.y);
    // the body ends a little turned away from the reaching hand's side, so the hand comes up in front
    const f1 = bearing + (a.side === 'L' ? -0.2 : 0.2);
    const first = this.d.cameraMode() === 'first';
    const f0 = first ? ctl.yaw + Math.PI : ctl.facing;
    const y1 = bearing - Math.PI;
    const want = Math.atan2(p.y - (ctl.y + 1.65), Math.hypot(p.x - ctl.pos.x, p.z - ctl.pos.y));
    const off = Math.abs(Math.atan2(Math.sin(f1 - f0), Math.cos(f1 - f0)));
    const dur = off < 0.03 ? 0 : 0.12 + (off / Math.PI) * 0.5;
    a.turn = { t: 0, dur, f0, f1, y0: ctl.yaw, y1: first && off > 0.35 ? y1 : ctl.yaw, p0: ctl.pitch, p1: first && Math.abs(want - ctl.pitch) > 0.3 ? Math.max(-0.7, Math.min(0.4, want)) : null };
  }

  private turnFrame(a: TapAct, dt: number) {
    const tn = a.turn;
    if (!tn) return;
    const ctl = this.d.controller;
    tn.t += dt;
    const k = tn.dur > 0 ? smooth(tn.t / tn.dur) : 1;
    if (this.d.cameraMode() === 'first') {
      ctl.yaw = lerpAngle(tn.y0, tn.y1, k);
      if (tn.p1 !== null) ctl.pitch = tn.p0 + (tn.p1 - tn.p0) * k;
    } else ctl.facing = lerpAngle(tn.f0, tn.f1, k);
  }

  /**
   * The phone's world pose (its frame: accessories.ts) held to the terminal: its back to the screen,
   * its top (where the antenna is) `off` metres out from the tap point, and tipped toward it by TIP,
   * as people hold it: the hand has the lower half, so the free top of the back meets the reader and the
   * hand stays clear of it.
   */
  private phoneAt(term: Terminal, off: number, s: number): THREE.Matrix4 {
    const { p, n, up } = term.pose();
    const nn = n.clone().normalize();
    const u = up.clone().addScaledVector(nn, -up.dot(nn)).normalize();
    const y = u.clone().multiplyScalar(Math.cos(TIP)).addScaledVector(nn, -Math.sin(TIP));
    const z = nn.clone().multiplyScalar(Math.cos(TIP)).addScaledVector(u, Math.sin(TIP));
    const x = new THREE.Vector3().crossVectors(y, z);
    const o = p.clone().addScaledVector(nn, off).addScaledVector(y, -ANTENNA * s);
    return new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(s, s, s)).setPosition(o);
  }

  /** the hand pose that holds the phone at world pose P (rel: the phone in the hand's frame) */
  private handFor(P: THREE.Matrix4, rel: THREE.Matrix4, fingers = FINGERS.phone): HandPose {
    const H = P.clone().multiply(rel.clone().invert());
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    H.decompose(p, q, new THREE.Vector3());
    return { p, q, fingers, w: 1 };
  }

  /**
   * The phone in the hand's frame. Third person: as the avatar's fitted grip holds it (phone.ts), in the
   * hand bone's own units, so a phone pose at its real size gives back the bone's pose; first person:
   * FP_PHONE.
   */
  private relFor(side: HandSide, F: Frame): THREE.Matrix4 {
    if (F.tp && this.phoneTp) return this.phoneTp.rel;
    return FP_PHONE[side];
  }

  /** the hand at the pocket of the white coat (the phone goes in and out there) */
  private pocket(side: HandSide, F: Frame): HandPose {
    const sg = side === 'R' ? 1 : -1;
    if (!F.tp) {
      // (first person: hanging below the shoulder, out of view and within reach: the arm doesn't stretch
      // after it)
      const r = restPose(F, side);
      return { ...r, p: F.sh[side].clone().addScaledVector(UP, -0.46).addScaledVector(F.f, 0.12), fingers: FINGERS.phone };
    }
    const k = F.s;
    const p = F.c.clone().addScaledVector(F.r, sg * 0.21 * k).addScaledVector(UP, -0.36 * k).addScaledVector(F.f, -0.18 * k);
    const q = palmQuat(side, new THREE.Vector3(0, -1, 0).addScaledVector(F.f, 0.25), F.r.clone().multiplyScalar(-sg));
    return { p, q, fingers: FINGERS.phone, w: 1, pole: F.sh[side].clone().addScaledVector(UP, -0.5).addScaledVector(F.f, -0.3).addScaledVector(F.r, sg * 0.3) };
  }

  /** the paying hand at this moment */
  private tapPose(a: TapAct, F: Frame): HandPose {
    const side = a.side;
    const rest = restPose(F, side);
    const pocket = this.pocket(side, F);
    const t = a.t;
    if (t < TAP.pocket) return blend(rest, pocket, ramp(t, 0, TAP.pocket));
    const rel = this.relFor(side, F);
    const s = F.tp ? this.d.hands.scale : 1;
    const pre = this.handFor(this.phoneAt(a.term, 0.085, s), rel);
    const on = this.handFor(this.phoneAt(a.term, GAP, s), rel);
    const sg = side === 'R' ? 1 : -1;
    pre.pole = on.pole = F.sh[side].clone().addScaledVector(UP, -0.5).addScaledVector(F.r, sg * 0.4).addScaledVector(F.f, -0.1);
    if (t < TAP.pre) return blend(pocket, pre, ramp(t, TAP.pocket, TAP.pre));
    if (t < TAP.tap) return blend(pre, on, ramp(t, TAP.pre, TAP.tap));
    if (t < TAP.hold) return on;
    if (t < TAP.out) return blend(on, pre, ramp(t, TAP.hold, TAP.out));
    if (t < TAP.away) return blend(pre, pocket, ramp(t, TAP.out, TAP.away));
    return blend(pocket, { ...rest, w: 0 }, ramp(t, TAP.away, TAP.end));
  }

  private phoneOut(a: TapAct) {
    a.phoneOut = true;
    const av = this.d.avatar();
    // third person: into the avatar's hand (phone.ts fits it to this hand and closes the fingers on it)
    if (av?.ready && !this.phoneTp) {
      const want: HandSide = a.side;
      // (an avatar that holds its phone left-handed gets it in the left hand when asked for the right)
      // (then it isn't fitted to the hand by phone.ts: our own grip closes the fingers instead)
      const swap = want === 'R' && leftHanded(hashString(JSON.stringify(av.cast)));
      const prop = buildProp('phone', { mount: want === 'R' ? 'handR' : 'handL' });
      if (prop) {
        if (swap) prop.obj.name = 'prop:phone-held';
        this.fitted = !swap;
        av.attach(prop.obj, want === 'R' ? 'handR' : 'handL');
        const inner = prop.obj.getObjectByName('phone')!;
        inner.add(this.wallet.plane());
        av.root.updateMatrixWorld(true);
        // the phone in the hand bone's frame (bone units, scale and all): for a phone pose P in the
        // world, the bone goes to P · rel⁻¹
        const bone = prop.obj.parent!;
        const rel = bone.matrixWorld.clone().invert().multiply(inner.matrixWorld);
        this.phoneTp = { root: prop.obj, inner, side: bone.name.includes('_L_') ? 'L' : 'R', rel };
      }
    }
    this.d.sound('pocket', SND.towel, this.d.camera.position.clone().setY(this.d.controller.y + 0.95), 0.12, 4);
  }

  private phoneAway() {
    const av = this.d.avatar();
    if (this.phoneTp) {
      if (av) av.detach(this.phoneTp.root);
      else this.phoneTp.root.removeFromParent();
      this.phoneTp = null;
    }
    this.phoneFp.visible = false;
  }

  private tapFrame(a: TapAct, dt: number) {
    const ctl = this.d.controller;
    if (!a.ready) {
      // the cashier on his way to you: wait for him (walking off calls it off; so does his going back)
      const c = this.cashier;
      const me = this.d.npcs?.get(CASHIER);
      if (ctl.steering || !me || c.state === 'home' || c.state === 'returning') return this.cancel(a, false);
      if (c.state !== 'waiting' || me.walking || c.hold < 0.85) return;
      a.ready = true;
      if (!this.stepUp(a)) this.cancel(a, false);
      return;
    }
    if (a.approach) {
      a.approachT += dt;
      if (ctl.steering || (ctl.path && ctl.path !== a.approach) || a.approachT > 8) return this.cancel(a, false);
      if (ctl.path) return;
      a.approach = null;
      this.beginTurn(a);
    }
    // walking off: before the beep nothing is paid; after it, the phone goes straight back
    if (ctl.steering && a.t > 0.05) return this.cancel(a, a.approved);
    if (this.holdT !== null) a.t = Math.min(a.t + dt, this.holdT);
    else a.t += dt;
    this.turnFrame(a, dt);
    if (a.t >= TAP.pocket && !a.phoneOut) this.phoneOut(a);
    if (a.t >= TAP.away && a.phoneOut) {
      a.phoneOut = false;
      this.phoneAway();
    }
    if (a.t >= TAP.end) {
      this.act = null;
      this.hands.hide();
    }
  }

  /** stop paying: the phone back in the pocket, the hand down (`keep`: it was approved, so it counts) */
  private cancel(a: TapAct, keep: boolean) {
    this.phoneAway();
    this.hands.hide();
    if (!keep) a.term.face.show({ kind: 'idle' });
    this.act = null;
  }

  /** the beep: where the phone's antenna is against the terminal's tap point (after the hands are posed) */
  private checkTap(a: TapAct) {
    if (a.approved || a.t < TAP.beep) return;
    const at = this.antenna();
    const { p } = a.term.pose();
    a.dist = at ? at.distanceTo(p) : null;
    a.approved = true;
    a.term.face.show({ kind: 'approved', amount: a.amount });
    a.term.approvedUntil = this.time + 3.5;
    this.wallet.show('done', a.amount);
    this.d.sound('payBeep', SND.payBeep, p, 0.55, 8);
    this.events.push({ kind: 'tap', at: a.term.kind, dist: a.dist === null ? null : +a.dist.toFixed(4), side: a.side, tp: this.tp(), t: +this.time.toFixed(2) });
    a.onApproved();
  }

  /** the phone's antenna (on its back, near the top), world: where it actually is now */
  private antenna(): THREE.Vector3 | null {
    const o = this.tp() ? this.phoneTp?.inner : this.phoneFp;
    if (!o || !o.visible) return null;
    o.updateWorldMatrix(true, false);
    return o.localToWorld(new THREE.Vector3(0, ANTENNA, 0));
  }

  // ───────────────────────────── per frame ─────────────────────────────

  /** before hands.apply: the tap (third person: the arm), the cashier */
  update(dt: number) {
    this.time += dt;
    const a = this.act;
    if (a) this.tapFrame(a, dt);
    const b = this.act;
    if (b && b.ready && !b.approach && this.tp()) {
      const F = this.hands.frame();
      if (F) {
        const h = this.tapPose(b, F);
        // over a counter: lean in a little (hands.ts), as the coffee's reach does
        const reach = h.p.clone().sub(F.sh[b.side]).setY(0).length();
        if (h.w > 0.2) (this.d.hands as PlayerHands & { lean?(angle: number): void }).lean?.(Math.min(0.2, Math.max(0, reach - 0.3) * 0.9) * h.w);
        // (the fitted grip closes the fingers on the phone itself: phone.ts)
        if (this.phoneTp && this.fitted) this.d.hands.reach(b.side, { target: h.p, quat: h.q, pole: h.pole, weight: h.w });
        else this.hands.pose(b.side, h, F);
        this.lastTarget = { wrist: h.p.toArray().map((x) => +x.toFixed(3)), shoulder: F.sh[b.side].toArray().map((x) => +x.toFixed(3)), dist: +h.p.distanceTo(F.sh[b.side]).toFixed(3) };
      }
    }
    this.cashierFrame(dt);
    for (const t of [this.till, this.handheld, this.reader]) if (t && t.approvedUntil > 0 && this.time > t.approvedUntil) {
      t.approvedUntil = -1;
      t.face.show({ kind: 'idle' });
    }
    // the till shows what you owe as you come up to it (the cashier has rung it up)
    if (this.till && !this.act && this.till.approvedUntil < 0) {
      const p = this.till.obj.position;
      const near = this.owed.length > 0 && Math.hypot(this.d.controller.pos.x - p.x, this.d.controller.pos.y - p.z) < 3;
      this.till.face.show(near ? { kind: 'due', amount: this.total } : { kind: 'idle' });
    }
    if (this.handheld.approvedUntil < 0 && (this.cashier.state === 'going' || this.cashier.state === 'waiting')) this.handheld.face.show({ kind: 'due', amount: this.total || COFFEE_PRICE });
  }

  /** after the arms are posed and the camera placed: first-person hand and phone, the beep, the chip */
  afterPose(_dt: number) {
    const a = this.act;
    if (a && a.ready && !a.approach) {
      if (!this.tp()) {
        const F = this.hands.frame()!;
        const h = this.tapPose(a, F);
        this.hands.pose(a.side, h, F);
        // the phone in that hand, as drawn
        const q = new THREE.Quaternion();
        const p = new THREE.Vector3();
        this.phoneFp.visible = a.phoneOut;
        if (a.phoneOut && this.hands.fp.quat(a.side, q)) {
          this.hands.fp.local(a.side, 0, 0, 0, p);
          const H = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
          this.phoneFp.matrix.copy(H.multiply(this.relFor(a.side, F)));
          this.phoneFp.matrixWorldNeedsUpdate = true;
          this.phoneFp.updateMatrixWorld(true);
        }
      } else {
        this.hands.hide();
        this.phoneFp.visible = false;
      }
      this.checkTap(a);
    } else this.hands.hide();
    this.cashierPose(_dt);
    this.updateChip();
  }

  private updateChip() {
    if (!this.chip) return;
    const text = this.dueText();
    this.chip.textContent = text ?? '';
    this.chip.classList.toggle('on', !!text);
  }

  // ───────────────────────────── the cashier ─────────────────────────────

  private inCafe(x: number, z: number): boolean {
    const c = this.cafe;
    return !!c && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && this.d.controller.y < 1.5;
  }

  private line(text: string) {
    this.cashier.lastLine = text;
    this.events.push({ kind: 'line', text, t: +this.time.toFixed(2) });
    this.d.say?.(CASHIER, text);
  }

  private cashierFrame(dt: number) {
    const c = this.cashier;
    const ctl = this.d.controller;
    const npcs = this.d.npcs;
    // the player's velocity (smoothed): heading for the door?
    if (Number.isFinite(this.prev.x) && dt > 0) {
      const vx = (ctl.pos.x - this.prev.x) / dt;
      const vz = (ctl.pos.y - this.prev.y) / dt;
      const k = Math.min(1, dt * 6);
      this.vel.x += (vx - this.vel.x) * k;
      this.vel.y += (vz - this.vel.y) * k;
    }
    this.prev.set(ctl.pos.x, ctl.pos.y);
    const me = npcs?.get(CASHIER) ?? null;
    if (!npcs || !me || !this.door || !this.doorSpot) {
      // (no cashier on this map, or he isn't on: nobody to come after you)
      if (c.state !== 'home') this.endErrand();
      return;
    }
    // (tests: a tap held still holds him still too, his terminal out)
    if (this.holdT === null || !this.act) c.t += dt;
    const px = ctl.pos.x;
    const pz = ctl.pos.y;
    const inside = this.inCafe(px, pz);
    const toDoor = Math.hypot(this.door.x - px, this.door.z - pz);
    const dist = Math.hypot(me.x - px, me.z - pz);
    // far down the corridor: outside, and this far from the door (he won't chase you through the hospital)
    const far = !inside && toDoor > 4;
    if (inside && c.state === 'home') c.armed = true;
    switch (c.state) {
      case 'home': {
        if (!this.owed.length || !c.armed || this.act) return;
        // heading out: by the door and walking toward it, or out of the door already
        const dx = this.door.x - px;
        const dz = this.door.z - pz;
        const toward = (this.vel.x * dx + this.vel.y * dz) / Math.max(0.01, toDoor);
        const leaving = (inside && toDoor < 2.4 && toward > 0.5) || (!inside && toDoor < 9);
        if (!leaving) return;
        c.armed = false;
        this.line(LINES.call);
        this.takeHandheld(me.ch);
        if (far) this.goDoor();
        else this.follow(me, true);
        return;
      }
      case 'going': {
        if (far) return this.goDoor();
        if (!me.walking && dist < 1.3) {
          c.state = 'waiting';
          c.t = 0;
          this.events.push({ kind: 'reached', dist: +dist.toFixed(3), t: +this.time.toFixed(2) });
          return;
        }
        // keep after you (a fresh destination when you've moved on, a few times a second at most)
        c.retarget -= dt;
        if (c.retarget <= 0 && (Math.hypot(c.at.x - px, c.at.y - pz) > 0.45 || (!me.walking && dist >= 1.3))) this.follow(me, false);
        return;
      }
      case 'waiting': {
        // turned to you, the terminal held out
        npcs.face(CASHIER, lerpAngle(me.yaw, Math.atan2(px - me.x, pz - me.z), Math.min(1, dt * 5)));
        if (c.t > 0.6 && c.t < 0.7 && this.cashier.lastLine === LINES.call) this.line(LINES.tap);
        if (this.act?.term === this.handheld) return;
        if (far) return this.goDoor();
        if (dist > 1.9) {
          c.state = 'going';
          this.follow(me, false);
        }
        return;
      }
      case 'toDoor': {
        if (!me.walking && Math.hypot(me.x - this.doorSpot.x, me.z - this.doorSpot.z) < 0.6) {
          c.state = 'doorWait';
          c.t = 0;
          this.line(LINES.again);
          this.events.push({ kind: 'door', t: +this.time.toFixed(2) });
        } else if (!me.walking && c.t > 1) this.goDoor();
        return;
      }
      case 'doorWait': {
        npcs.face(CASHIER, lerpAngle(me.yaw, Math.atan2(px - me.x, pz - me.z), Math.min(1, dt * 4)));
        // you came back: he comes to you after all; else back to the till
        if (inside && dist < 6 && this.owed.length) {
          c.state = 'going';
          this.follow(me, false);
        } else if (c.t > 5 || !this.owed.length) this.goHome();
        return;
      }
      case 'thanks': {
        if (c.t > 1.4) this.goHome();
        return;
      }
      case 'returning': {
        const home = npcs.homeOf(CASHIER);
        if (!me.walking && (!home || Math.hypot(me.x - home.x, me.z - home.z) < 0.4)) {
          this.parkHandheld();
          c.state = 'home';
          c.t = 0;
          this.events.push({ kind: 'home', t: +this.time.toFixed(2) });
        }
        // you owe it still and turned back toward him: he'll catch you next time you head out
        return;
      }
    }
  }

  /** over to you: to a spot ~0.95 m short of you on his side, facing you */
  private follow(me: { x: number; z: number }, first: boolean) {
    const c = this.cashier;
    const ctl = this.d.controller;
    const px = ctl.pos.x;
    const pz = ctl.pos.y;
    const dx = me.x - px;
    const dz = me.z - pz;
    const d = Math.hypot(dx, dz) || 1;
    const x = px + (dx / d) * 0.95;
    const z = pz + (dz / d) * 0.95;
    this.d.npcs!.go(CASHIER, x, z, Math.atan2(px - x, pz - z), 1.55);
    c.at.set(px, pz);
    c.retarget = 0.5;
    if (first || c.state !== 'going') {
      c.state = 'going';
      c.t = 0;
      this.events.push({ kind: 'chase', t: +this.time.toFixed(2) });
    }
  }

  private goDoor() {
    const c = this.cashier;
    const s = this.doorSpot!;
    const ctl = this.d.controller;
    this.d.npcs!.go(CASHIER, s.x, s.z, Math.atan2(ctl.pos.x - s.x, ctl.pos.y - s.z), 1.55);
    c.state = 'toDoor';
    c.t = 0;
  }

  private goHome() {
    const c = this.cashier;
    this.d.npcs?.home(CASHIER);
    c.state = 'returning';
    c.t = 0;
  }

  private endErrand() {
    const c = this.cashier;
    if (c.state !== 'home') this.d.npcs?.home(CASHIER);
    this.parkHandheld();
    c.state = 'home';
  }

  /** the handheld from its dock into his right hand */
  private takeHandheld(ch: Character) {
    const av = ch as AvatarCharacter;
    const c = this.cashier;
    c.ch = ch;
    if (typeof av.attach !== 'function') return;
    const t = this.handheld;
    t.obj.removeFromParent();
    // in the hand's frame (X along the fingers, Y out of the palm, Z the thumb): face out of the palm,
    // its top toward the wrist, so held out palm up it faces up and reads the right way for you
    const holder = new THREE.Group();
    holder.name = 'prop:terminal';
    t.obj.position.set(0.085, 0.031, 0.004);
    t.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
    t.obj.scale.setScalar(1);
    holder.add(t.obj);
    av.attach(holder, 'handR');
    c.arm = armBones(av.root, 'R');
  }

  /** back in its dock behind the counter (or out of the way, with no till on this map) */
  private parkHandheld() {
    const t = this.handheld;
    const holder = t.obj.parent;
    const c = this.cashier;
    if (holder && holder.name === 'prop:terminal') {
      const av = c.ch as AvatarCharacter | null;
      if (av && typeof av.detach === 'function') av.detach(holder);
      else holder.removeFromParent();
      holder.remove(t.obj);
    }
    const ch = c.ch as AvatarCharacter | null;
    if (ch && c.holdFn && ch.postPose === c.holdFn) ch.postPose = undefined;
    c.holdFn = null;
    c.hold = 0;
    c.present = 0;
    if (!this.dock) {
      t.obj.removeFromParent();
      return;
    }
    if (t.obj.parent !== this.d.scene) this.d.scene.add(t.obj);
    t.obj.position.copy(this.dock);
    t.obj.rotation.set(-0.35, (this.d.layout.props.find((p) => p.kind === 'till')?.rot ?? 0) + Math.PI, 0, 'YXZ');
    t.obj.scale.setScalar(1);
  }

  /**
   * The cashier's arm: held out palm up toward you while he waits for the tap (two-bone IK after his
   * animation, AvatarCharacter.postPose), eased in and out.
   */
  /**
   * The cashier's right arm with the handheld: carried in front of him on his way over (and back), held
   * out to you, palm up, while he waits for the tap. Eased between, and out once it's back in its cradle.
   */
  private cashierPose(dt: number) {
    const c = this.cashier;
    const ch = c.ch as AvatarCharacter | null;
    if (!ch || typeof ch.attach !== 'function') return;
    const present = c.state === 'waiting' || (c.state === 'thanks' && c.t < 0.5);
    // (nearly back at the till: the arm comes down to put it in its cradle)
    const me = this.d.npcs?.get(CASHIER);
    const home = this.d.npcs?.homeOf(CASHIER);
    const docking = c.state === 'returning' && !!me && !!home && Math.hypot(me.x - home.x, me.z - home.z) < 0.9;
    const carrying = this.handheld.obj.parent?.name === 'prop:terminal' && !docking;
    const want = present ? 1 : carrying ? 0.8 : 0;
    if (want && !c.holdFn) {
      c.holdFn = (av: AvatarCharacter, adt: number) => this.holdOut(av, adt);
      ch.postPose = c.holdFn;
    }
    const step = dt * 2.2;
    c.hold = Math.max(0, Math.min(1, c.hold + Math.max(-step, Math.min(step, want - c.hold))));
    c.present = Math.max(0, Math.min(1, c.present + (present ? 1 : -1) * dt * 2.4));
    if (!want && c.hold <= 0 && c.holdFn && ch.postPose === c.holdFn) {
      ch.postPose = undefined;
      c.holdFn = null;
    }
  }

  private holdOut(av: AvatarCharacter, _dt: number) {
    const c = this.cashier;
    const arm = (c.arm ??= armBones(av.root, 'R'));
    if (!arm || c.hold <= 0.001) return;
    const k = av.height / 1.75;
    const yaw = av.root.rotation.y;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const o = av.root.position;
    const p = smooth(c.present);
    // carried: at the waist, a little out in front, its screen turned up toward him; held out: further
    // out toward you, palm up, the screen up and tipped your way
    const carry = o.clone().addScaledVector(UP, 0.98 * k).addScaledVector(f, 0.2 * k).addScaledVector(r, 0.15 * k);
    const out = o.clone().addScaledVector(UP, 1.06 * k).addScaledVector(f, 0.32 * k).addScaledVector(r, 0.1 * k);
    const target = carry.lerp(out, p);
    const qCarry = palmQuat('R', f.clone().addScaledVector(r, -0.35).addScaledVector(UP, 0.1), UP.clone().addScaledVector(f, -0.3).addScaledVector(r, -0.4));
    const qOut = palmQuat('R', f.clone().addScaledVector(UP, -0.12).addScaledVector(r, -0.15), UP.clone().addScaledVector(f, 0.35));
    const quat = qCarry.slerp(qOut, p);
    const S = arm.upper.getWorldPosition(new THREE.Vector3());
    const pole = S.addScaledVector(UP, -0.5).addScaledVector(r, 0.35).addScaledVector(f, -0.15);
    reachArm(arm, target, pole, smooth(c.hold), quat);
  }

  // ───────────────────────────── tests ─────────────────────────────

  debugState() {
    const a = this.act;
    const me = this.d.npcs?.get(CASHIER) ?? null;
    const home = this.d.npcs?.homeOf(CASHIER) ?? null;
    const ctl = this.d.controller;
    return {
      owed: this.owed.map((o) => ({ ...o })),
      due: this.dueText(),
      chip: !!this.chip?.classList.contains('on'),
      act: a ? { t: +a.t.toFixed(2), at: a.term.kind, side: a.side, approach: !!a.approach, phone: a.phoneOut, approved: a.approved, dist: a.dist } : null,
      cashier: me ? { state: this.cashier.state, x: +me.x.toFixed(2), z: +me.z.toFixed(2), walking: me.walking, dist: +Math.hypot(me.x - ctl.pos.x, me.z - ctl.pos.y).toFixed(2), home: home ? +Math.hypot(me.x - home.x, me.z - home.z).toFixed(2) : null, line: this.cashier.lastLine, holding: this.handheld.obj.parent?.name === 'prop:terminal', armOut: +this.cashier.hold.toFixed(2), posed: !!this.cashier.holdFn && (this.cashier.ch as AvatarCharacter | null)?.postPose === this.cashier.holdFn, hand: this.cashier.arm ? this.cashier.arm.hand.getWorldPosition(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3)) : null } : null,
      terminals: { till: this.till?.face.kind ? this.tillShown() : null },
      target: this.lastTarget,
      events: this.events.slice(-30),
    };
  }

  private tillShown() {
    return this.till ? (this.till.approvedUntil > 0 ? 'approved' : 'idle/due') : null;
  }

  /** tests: hold the tap's clock at t s (null runs on) */
  hold(t: number | null) {
    this.holdT = t;
  }

  /** tests: where things are (world): the terminals' tap points, the phone's antenna */
  where() {
    const r3 = (v: THREE.Vector3 | null | undefined) => (v ? v.toArray().map((x) => +x.toFixed(3)) : null);
    return { till: r3(this.till?.pose().p), handheld: r3(this.handheld.pose().p), reader: r3(this.reader?.pose().p), antenna: r3(this.act ? this.antenna() : null) };
  }

  dispose() {
    this.phoneAway();
    this.endErrand();
    for (const o of this.extras) o.removeFromParent();
    this.hands.dispose();
    this.chip?.remove();
  }
}

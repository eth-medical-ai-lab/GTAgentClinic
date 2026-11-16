/**
 * GTAgentClinic — three.js world. Implements WorldApi (see ./index.ts).
 * Physically based rendering on WebGPU (WebGL 2 fallback) with clustered lighting, GTAO,
 * bloom and temporal AA (render/), photo-scanned materials, realistic animated avatars,
 * live monitors/tracking board, three camera modes.
 */
import * as THREE from 'three';
import { startupLook } from '../startupLook';
import { browserDemo, touchTour } from '../demo/mode';
import type { LayoutDef } from '../../../shared/layout';
import { dischargePickup, PUSH_GAP, roomAt, spotFor } from '../../../shared/layout';
import type { Appearance, CameraMode, NpcView, PlayerView } from '../../../shared/types';
import { clockAt } from '../../../shared/types';
import { buildWorld, type Interactable } from './builder';
import { castAvatarIds, castFor, faceOf } from './casting';
import { ItemSystem } from './itemSystem';
import { drawClock } from './details';
import { createCharacter, headAnchor, type Character } from './characters';
import { AvatarCharacter, preloadAvatars } from './avatars';
import { PlayerHands } from './hands';
import { Amenities } from './amenities';
import type { NpcErrands } from './payment';
import { HandHygiene } from './hygiene';
import { Wheelchair } from './wheelchair';
import { Workstations } from './workstation';
import { Crowd, crowdOff } from './crowd';
import { dischargeOverlap, dischargePose, fitTransportHeadings, STRETCHER_PUSH_GAP } from './dischargeRoute';
import { openDoorLeaves } from './doorLeaves';
import { PlayerController, lerpAngle } from './controls';
import type { InteractTarget, WorldApi, WorldCallbacks } from './index';
import { LabelLayer } from './labels';
import { G, disposeCaches, lambert } from './materials';
import { buildLighting, type LightRig } from './render/lighting';
import { createGfx, preferredQuality, type Gfx } from './render/renderer';
import { speechLevel, speechMouth, updateSpatialAudio } from '../ui/speech';
import { mouthAt, visemeTimeline } from '../ui/visemes';
import { createSoundscape } from '../audio/soundscape';
import { NavGrid, type Disc, type Route } from './pathfinding';
import { NpcSteering } from './steering';
import { setPhoneNight } from './accessories';
import { Curtains } from './curtains';
import { Cabinets } from './cabinets';
import { buildRoomSwingDoor, RESTROOM_DOOR_ROOMS, type SwingDoor } from './swingDoors';
import { PlayerGestures } from './gesture';
import { BedsideCare, NpcCare, stanceFor, type CarePatient } from './care';
import { bedDebug, disposeRigs, holdBed, inBedReport, rigAt, stepRigs } from './bedRig';
import { stairRects } from './stairs';
import { createFloors } from './floors';
import { createVisualAudit } from './visualAudit';
import { BedsideMonitor, TrackingBoardScreen, computerScreen, smallScreen, tvScreen, whiteboardScreen } from './screens';
import { transportStretcher } from './props';
import { gripHandles } from './contact';
import { ImagingLife } from './imagingLife';

const ESI_HEX = ['#b3261e', '#b3261e', '#e8590c', '#e0a10b', '#2f9e44', '#1c7ed6'];
const INTERACT_RANGE = 2.6;
const MODES: CameraMode[] = ['first', 'third', 'top'];

const PLAYER_LOOK: Appearance = {
  skin: '#d9a47f',
  hair: '#3b2a20',
  hairStyle: 'short',
  outfit: 'coat',
  outfitColor: '#f7f7f7',
  pantsColor: '#1f3b5c',
  height: 1.78,
  build: 'average',
  age: 'adult',
  accessories: ['stethoscope', 'badge'],
};

interface NpcState {
  v: NpcView;
  ch: Character;
  pos: THREE.Vector2;
  yaw: number;
  path: THREE.Vector2[] | null;
  destKey: string;
  dest: { x: number; z: number; rot: number };
  surfaceY?: number;
  seatY?: number;
  lastBark?: number;
  wanderAt: number;
  wandering: boolean;
  /** animation time not yet applied (off-screen or far NPCs animate at a few Hz) */
  animAcc?: number;
  /** a crowd member who has left the view: finishes the walk out, then goes once nobody sees it */
  leavingAt?: number;
  /** when this NPC last got a speech bubble (crowd labels are skipped while they have none) */
  sayAt?: number;
  /** a patient on a bed's edge: since when (ms), the step stool under their feet (bed frame), when it was last measured */
  sitSince?: number;
  stepAt?: { x: number; z: number; top: number } | null;
  stepT?: number;
  /** Time on the clinical clock sets the distance along a walk-in, nurse approach or trip to the exit. */
  timedWalk?: {
    patientId: string; since: number; route: Route; s: number; lastT: number; startYaw: number; speed: number;
    parked: Disc[]; startFraction: number;
  };
  exitWarning?: string;
}

/** waiting-room acts that keep someone's eyes on what they're doing, not on a passing doctor */
const BUSY = new Set(['phone_text', 'phone_call', 'sleep', 'film', 'drink', 'floor', 'read', 'laptop']);

/** ?nocull=1 turns visibility culling off (A/B for performance work) */
const noCull = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nocull');

/** dev aid: ?talktest=<npcId> makes that NPC "speak" (synthetic voice level) to check lip-sync/gestures */
const talkTest = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('talktest') : null;
/** what ?talktest=<npc id> mouths, over and over (lips shut, rounded and wide all come up in it) */
const TALK_TEST_LINE = 'Good evening, doctor. It burns when I pass water, and I feel so weak.';

export function createWorld(container: HTMLElement, layout: LayoutDef, cb: WorldCallbacks): WorldApi {
  let startingLook = startupLook();
  // ── scene / camera; the GPU renderer starts asynchronously (WebGPU adapter + pipeline) ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1420');
  const camera = new THREE.PerspectiveCamera(72, (container.clientWidth || 1) / (container.clientHeight || 1), 0.05, 260);
  // input lives on a wrapper element so controls work before the renderer's canvas exists
  const canvas = document.createElement('div');
  canvas.className = 'wl-input';
  canvas.style.cssText = 'position:absolute;inset:0;outline:none;';
  canvas.tabIndex = 0;
  container.appendChild(canvas);
  let gfx: Gfx | null = null;
  let rig: LightRig | null = null;
  let disposed = false;

  // ── loading screen ──
  // Start-up runs: GPU renderer init → textures, skies, characters (all via three's default loading
  // manager) → the first rendered frames, where the GPU compiles its pipelines (the old "black screen").
  // Hooked before buildWorld so every load of this world is counted; restored on dispose.
  const lm = THREE.DefaultLoadingManager;
  const prevLm = { onStart: lm.onStart, onProgress: lm.onProgress, onLoad: lm.onLoad };
  const boot = { t0: performance.now(), changed: performance.now(), busy: false, loaded: 0, total: 0, frames: 0, shown: -1, stage: '', done: false };
  lm.onStart = (url, loaded, total) => {
    prevLm.onStart?.(url, loaded, total);
    Object.assign(boot, { busy: true, loaded, total, changed: performance.now() });
  };
  lm.onProgress = (url, loaded, total) => {
    prevLm.onProgress?.(url, loaded, total);
    Object.assign(boot, { loaded, total, changed: performance.now() });
  };
  lm.onLoad = () => {
    prevLm.onLoad?.();
    Object.assign(boot, { busy: false, changed: performance.now() });
  };
  /** called once per animation frame; `rendered` = the GPU drew this frame */
  function bootTick(now: number, rendered: boolean) {
    if (boot.done) return;
    // idle = nothing pending and nothing new for a moment (avatar models start after their index loads)
    const idle = !boot.busy && now - boot.changed > 600;
    const assets = idle ? 1 : boot.total > 0 ? boot.loaded / boot.total : 0;
    if (rendered && idle) boot.frames++;
    const FRAMES = 5; // the first frames after loading compile shaders and can each stall
    const stage = !gfx ? 'Starting the graphics engine' : !idle ? 'Loading the hospital' : 'Preparing the shaders';
    const p = !gfx ? 0.04 + 0.22 * assets : 0.3 + 0.6 * assets + 0.1 * Math.min(1, boot.frames / FRAMES);
    const progress = Math.max(boot.shown, Math.min(1, p));
    boot.done = boot.frames >= FRAMES || (now - boot.t0 > 45_000 && (!browserDemo || rendered));
    if (boot.done || stage !== boot.stage || progress - boot.shown >= 0.01) {
      boot.stage = stage;
      boot.shown = progress;
      cb.onLoading?.({ stage: boot.done ? 'Ready' : stage, progress: boot.done ? 1 : progress, done: boot.done });
    }
  }

  // ── building ──
  // Tour characters request their own models on arrival. Avoid downloading the full game's cast.
  preloadAvatars(browserDemo ? [] : castAvatarIds());
  const built = buildWorld(layout);
  scene.add(built.root);
  // the restrooms' doors: shut until E on them (swingDoors.ts); before the nav grid, so routes see them shut
  const swingDoors: SwingDoor[] = RESTROOM_DOOR_ROOMS.map((id) => buildRoomSwingDoor(id, built.tall, layout, built, built.low)).filter((d): d is SwingDoor => !!d);
  // stairs and landings: the player walks them (ground height), NPCs path around them
  // stairs and landings: the player walks them (standHeight), NPCs path around them
  const stairBoxes = stairRects(layout).map((rc) => new THREE.Box3(new THREE.Vector3(rc.x, 0, rc.z), new THREE.Vector3(rc.x + rc.w, layout.wallHeight, rc.z + rc.d)));
  // storeys (floors.ts): Floor 2, the elevators and the ward. The ground floor's nav grid sees only the
  // closed elevator entrances; the rest joins the colliders after it (solid only on its own storey: controls.ts)
  // the player's hand going out to a button or a curtain's edge (gesture.ts): turn to it first, the
  // hand on its side, the body held facing it until the hand is back
  const gestures = new PlayerGestures({
    scene,
    camera,
    controller: () => controller,
    mode: () => mode,
    avatarRoot: () => avatar.root,
    busy: () => {
      const b = { R: false, L: false };
      for (const i of items.heldItems()) {
        const s = items.slotOf(i);
        if (s === 'both') b.R = b.L = true;
        else if (s) b[s] = true;
      }
      return b;
    },
  });
  const floors = createFloors(scene, layout, built, {
    labels: () => labels,
    controller: () => controller,
    gestures: () => gestures,
    camera,
    mode: () => mode,
    container,
    hint: (text, ms = 4000) => {
      hint.textContent = text;
      hintUntil = performance.now() + ms;
    },
  });
  // bay curtains (curtains.ts): solid where drawn; whoever goes through pulls them open and closed.
  // NPC routes use the doorway end of a bay's front (the rest is a wall to the nav grid)
  const curtains = new Curtains(built.curtains, { scene, camera, player: () => controller, gestures, mode: () => mode, npcs: () => npcs.values(), npc: (id) => npcs.get(id), tall: built.tall, audit: new URLSearchParams(location.search).has('debug') });
  const nav = new NavGrid([...built.colliders, ...stairBoxes, ...floors.groundBlockers, ...curtains.navBlockers], { minX: -1, maxX: layout.width + 1, minZ: -1, maxZ: layout.depth + 9 });
  floors.attach();
  curtains.attach(built);
  // NPC walking (steering.ts): routes round furniture by footprint and round people, smooth turns, people avoid people
  const steer = new NpcSteering(nav, built.navFootprints);
  steer.onSit = (st) => applyFinalPosture(st as NpcState);
  steer.gate = curtains.gate;
  steer.gateFace = curtains.gateFace;
  const groundHeight = (x: number, z: number, y = 0) => floors.groundAt(x, z, y);
  /** ceiling height above (x, z): a room's own (a double-height stair core) or the wall height; none outdoors */
  function ceilingAt(x: number, z: number): number {
    const up = floors.ceilingAt(x, z);
    if (up !== null) return up;
    const r = roomAt(layout, x, z);
    if (!r) return x >= 0 && x <= layout.width && z >= 0 && z <= layout.depth ? layout.wallHeight : Infinity;
    return r.kind === 'exterior' ? Infinity : (r.ceilingHeight ?? layout.wallHeight);
  }

  // screens
  const monitors = new Map<string, BedsideMonitor>();
  const board = new TrackingBoardScreen();
  const pcMat = computerScreen();
  const tvMat = tvScreen();
  const wbMat = whiteboardScreen();
  const smallMat = smallScreen();
  const roomLabels = new Map([...layout.rooms, ...layout.treatmentSpaces ?? []].map(r => [r.id, r.label]));
  for (const s of built.screens) {
    switch (s.kind) {
      case 'monitor': {
        const bay = s.prop.bay ?? s.prop.room;
        let m = monitors.get(bay);
        if (!m) {
          m = new BedsideMonitor(roomLabels.get(bay) ?? bay);
          monitors.set(bay, m);
        }
        s.mesh.material = m.material;
        s.mesh.userData.bay = bay;
        break;
      }
      case 'board':
        s.mesh.material = board.material;
        break;
      case 'computer':
        s.mesh.material = pcMat;
        break;
      case 'tv':
        s.mesh.material = tvMat;
        break;
      case 'whiteboard':
        s.mesh.material = wbMat;
        break;
      case 'small':
        s.mesh.material = smallMat;
        break;
    }
  }
  for (const s of built.screens) {
    const m = s.mesh.material as THREE.MeshBasicMaterial;
    if (m.isMeshBasicMaterial && !m.userData.boosted) {
      m.color.setScalar(s.kind === 'whiteboard' ? 1 : 1.55);
      m.userData.boosted = true;
    }
  }
  const monitorPos = new Map<string, THREE.Vector3>();
  for (const s of built.screens) if (s.kind === 'monitor') monitorPos.set(s.mesh.userData.bay, s.mesh.getWorldPosition(new THREE.Vector3()));

  // ── overlays ──
  const labels = new LabelLayer(container);
  const crosshair = document.createElement('div');
  crosshair.className = 'wl-crosshair';
  container.appendChild(crosshair);
  const hint = document.createElement('div');
  hint.className = 'wl-hint';
  container.appendChild(hint);
  const controlHint = document.createElement('div');
  controlHint.className = 'wl-control-hint';
  container.appendChild(controlHint);
  let hintUntil = performance.now() + 9000;
  let startupInputReady = false;

  // focus ring
  // the "E uses this" ring on the floor: the brand's warm red (styles.css --ac-accent)
  const ring = new THREE.Mesh(G.torus(0.42, 0.03, 6, 32), lambert('#d94a38', { emissive: '#d94a38', emissiveIntensity: 0.8, tag: 'ring' }));
  ring.name = 'interaction-focus-ring';
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  // ── player ──
  // (dev aid, tests: ?playerAvatar=Medical_Female_02 dresses the player in another body: a mask's fit on her face)
  const playerAlt = new URLSearchParams(location.search).get('playerAvatar');
  const playerSpec = playerAlt ? { id: 'player_alt', role: 'player' as const, appearance: { ...PLAYER_LOOK, avatar: playerAlt } as Appearance } : { id: 'player', role: 'player' as const, appearance: PLAYER_LOOK };
  const avatar = createCharacter(playerSpec);
  scene.add(avatar.root);
  let mode: CameraMode = 'first';
  let inputEnabled = true;
  let pendingInteract: string | null = null;
  let followId: string | null = null;

  const trolleys = new Map<string, ReturnType<typeof transportStretcher>>();
  const controller = new PlayerController(canvas, camera, built.colliders, built.cameraBlockers, built.bounds, {
    onCycleCamera: () => {
      const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      api.setCameraMode(next);
      cb.onCameraChange(next);
    },
    onInteractKey: () => interactFocused(true),
    onPointerRelease: () => cb.onPointerRelease?.(),
    onInspectKey: () => {
      // F on a workstation on wheels or the med cabinet: what it is (E logs in now)
      const sub = !items.held && !items.isInspecting() && focus?.target.kind === 'computer' ? ws.inspectSubject(focus.target.propId) : null;
      if (sub) items.inspectSubject(sub);
      // F on the wheelchair: what it is (E sits you in it)
      else if (!items.held && !items.isInspecting() && focus?.target.kind === 'use' && focus.target.id === 'wc:sit') items.inspectSubject('wheelchair');
      // F on the vending machine: what it is (E buys a drink)
      else if (!items.held && !items.isInspecting() && focus?.target.kind === 'use' && focus.target.id === 'vend') items.inspectSubject('vending');
      // F on a hand-rub dispenser, a sink, a mask box: its card (E uses it)
      else if (!items.held && !items.isInspecting() && focus?.target.kind === 'use' && hygiene.inspectSubject(focus.key)) items.inspectSubject(hygiene.inspectSubject(focus.key)!);
      // F on a cupboard, a drawer, a fridge: its card (E opens it)
      else if (!items.held && !items.isInspecting() && focus?.target.kind === 'use' && cabinets.inspect(focus.target.id)) return;
      // F on a thing lying around (a patient's handbag): a look at it there, and it goes back
      else if (!items.held && !items.isInspecting() && focus?.target.kind === 'item' && items.lookAt(focus.target.itemId)) return;
      else items.inspectKey();
    },
    // G puts down what you picked up last: on the surface you look at (top-down: under the mouse), or at your feet
    // (nothing in your hands: G takes gloves off, or drops a used pair in a bin beside you: hygiene.ts)
    onDropKey: () => {
      if (!items.held && hygiene.dropKey()) return;
      items.dropKey(mode === 'top' ? (controller.aimNdc() ?? undefined) : undefined);
    },
    onClick: (ndc, walkToTarget = false) => {
      if (ndc && mode !== 'top' && !walkToTarget) {
        const f = pick(ndc);
        if (f && (controller.walkOnly || f.target.kind === 'npc') && f.dist <= (f.target.kind === 'item' ? 2.1 : INTERACT_RANGE) && !(f.target.kind === 'use' && f.target.id === 'stand')) {
          interactWith(f.target);
          return true;
        }
        if (controller.walkOnly && focus?.target.kind === 'npc') interactFocused(false);
        return controller.walkOnly;
      }
      if (!ndc) {
        interactFocused(false);
        return true;
      }
      const f = pick(ndc);
      if (f) {
        interactOrWalk(f);
        return;
      }
      // floor click → walk there (on the floor of the storey you're on)
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floors.floorY), new THREE.Vector3());
      if (hit) {
        pendingInteract = null;
        walkPlayerTo(hit.x, hit.z);
      }
    },
    onCursorModeChange: (cursorMode) => {
      crosshair.classList.toggle('cursor-mode', cursorMode);
      if (cursorMode) {
        hint.textContent = 'Mouse free for panels · right-click or walk (WASD) to look around again';
        hintUntil = performance.now() + 4500;
      } else if (hint.textContent?.startsWith('Mouse free for panels')) {
        hintUntil = 0;
      }
    },
  });
  // ── things to pick up / inspect (decor clutter, patients' belongings, equipment) ──
  // held things sit in the avatar's palms with an arm pose to match (hands.ts)
  const hands = new PlayerHands(() => (avatar instanceof AvatarCharacter ? avatar : null));
  const items = new ItemSystem({
    scene,
    camera,
    controller,
    built,
    layout,
    container,
    input: canvas,
    hands,
    handWorld: (out) => avatar.handWorld?.(out) ?? null,
    cameraMode: () => mode,
    onInspect: (info) => cb.onInspect?.(info),
    hint: (text, ms = 4000) => {
      hint.textContent = text;
      hintUntil = performance.now() + ms;
    },
  });
  // The cafeteria's cashier coming after you for a coffee you didn't pay for (payment.ts): a short errand
  // of this client's own, off the record. While it lasts his destination is ours; the server's place for
  // him is kept up to date meanwhile (syncNpcs), and he walks back to it when it's over.
  const errands = new Map<string, { home: { x: number; z: number; rot: number } }>();
  const npcErrands: NpcErrands = {
    get: (id) => {
      const st = npcs.get(id);
      return st && st.v.visible && floors.viewLevel === 0 ? { x: st.pos.x, z: st.pos.y, yaw: st.yaw, walking: !!st.path, ch: st.ch } : null;
    },
    go: (id, x, z, rot, pace = 1.3) => {
      const st = npcs.get(id);
      if (!st) return false;
      if (!errands.has(id)) errands.set(id, { home: { ...st.dest } });
      // (someone at a desk steps out of the chair first: the charge nurse fetching a key, cabinets.ts)
      const fromSeat = st.ch.posture === 'sit' && !st.path ? seatNear(st.pos.x, st.pos.y) : undefined;
      st.dest = { x, z, rot };
      st.wandering = false;
      st.ch.setPosture('stand');
      // (steering.ts: round tables and people, a newer destination taken up while still walking)
      steer.walk(st, st.dest, { pace, face: rot, radius: 0.25, fromSeat });
      st.path = [new THREE.Vector2(x, z)];
      return true;
    },
    face: (id, yaw) => {
      const st = npcs.get(id);
      if (st && !st.path) st.yaw = yaw;
    },
    home: (id) => {
      const st = npcs.get(id);
      const e = errands.get(id);
      errands.delete(id);
      if (!st || !e) return;
      st.dest = e.home;
      walkTo(st, st.dest);
    },
    homeOf: (id) => errands.get(id)?.home ?? npcs.get(id)?.dest ?? null,
  };
  // coffee, café chairs, sofas, bins, the vending machine, hand rub (client-only, never scored)
  const amenities = new Amenities({
    scene,
    camera,
    controller,
    layout,
    items,
    hands,
    avatar: () => (avatar instanceof AvatarCharacter ? avatar : null),
    cameraMode: () => mode,
    hint: (text, ms = 4000) => {
      hint.textContent = text;
      hintUntil = performance.now() + ms;
    },
    // someone there, or on the way to sit there (steering.ts seats them at the seat nearest their spot);
    // these NPCs are all on the ground floor (the ward's people upstairs keep to their rounds: ward.ts)
    occupied: (x, z, r, level = 0) =>
      level === 0 &&
      [...npcs.values()].some((st) => {
        if (!st.v.visible) return false;
        if (Math.hypot(st.pos.x - x, st.pos.y - z) < r) return true;
        if (!st.path || st.v.posture !== 'sit') return false;
        const s = seatNear(st.dest.x, st.dest.z) ?? st.dest;
        return Math.hypot(s.x - x, s.z - z) < r;
      }),
    colliders: built.colliders,
    // walking up to a sofa, a coffee machine or a till: round things, on your storey's nav grid
    path: (x, z) => playerNav().findPath(controller.pos.x, controller.pos.y, x, z),
    // paying (payment.ts): what you owe on screen, the cashier coming after you, his lines (voiced as an aside)
    container,
    npcs: npcErrands,
    say: (id, text) => {
      if (!cb.onAside?.(id, text)) api.say(id, text);
    },
  });
  // hand rub, hand washing and masks at the dispensers and sinks shared/hygiene.ts places (hygiene.ts):
  // each one finished goes to the server ('hygiene' action) for the debrief's infection-control section
  const hygiene = new HandHygiene({
    scene,
    camera,
    controller,
    layout,
    items,
    hands,
    avatar: () => (avatar instanceof AvatarCharacter ? avatar : null),
    cameraMode: () => mode,
    hint: (text, ms = 4000) => {
      hint.textContent = text;
      hintUntil = performance.now() + ms;
    },
    room: () => lastRoom,
    record: (kind, at) => cb.onHygiene?.(kind, at),
    nurses: () => [...npcs.values()].filter((st) => st.v.visible && st.v.role === 'nurse').map((st) => ({ id: st.v.id, name: st.v.name, x: st.pos.x, z: st.pos.y })),
    say: (id, text) => api.say(id, text),
    seated: () => amenities.isSeated(),
    standUp: () => amenities.interact('stand'),
    busy: () => amenities.busy,
    colliders: built.colliders,
    root: built.root,
    face: () => faceOf(castFor(playerSpec.id, 'player', playerSpec.appearance)),
  });
  // M: the mask off and into the bin, wherever you are (not while typing)
  const onMaskKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !inputEnabled) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    hygiene.maskKey();
  };
  window.addEventListener('keydown', onMaskKey);
  // every computer, the carts and the med cabinet: sit down (or step up), badge in, zoom into AgentChart (workstation.ts)
  let inputMode: 'full' | 'walk' | 'none' = 'full';
  const ws = new Workstations({
    layout,
    built,
    camera,
    controller,
    avatar,
    container,
    nav,
    wows: built.details.wows,
    mode: () => mode,
    ceilingAt,
    clock: () => (lastView ? clockAt(lastView.clockStart, lastView.t) : '--:--'),
    // who's there (not walking past): a seated NPC at a workstation is using it
    people: (x, z, r) =>
      [...npcs.values()]
        .filter((st) => st.v.visible && !st.path && Math.hypot(st.pos.x - x, st.pos.y - z) < r)
        .sort((a, b) => Math.hypot(a.pos.x - x, a.pos.y - z) - Math.hypot(b.pos.x - x, b.pos.y - z))
        .map((st) => ({ id: st.v.id, name: st.v.name, title: st.v.title, seated: st.ch.posture === 'sit' })),
    say: (id, text) => api.say(id, text),
    holdInput: (on) => {
      if (!on) return api.setInputMode(inputMode);
      inputEnabled = false;
      pendingInteract = null;
      controller.setEnabled(false);
      crosshair.style.visibility = 'hidden';
    },
    onBegin: (phase, t) => cb.onWorkstation?.(phase, t) !== false,
    onOpen: (t) => cb.onInteract(t),
  });
  // the corridor wheelchair: sit in it and push yourself around (wheelchair.ts; client-only, off the record)
  const wheelchair = new Wheelchair({
    scene,
    controller,
    built,
    items,
    hands,
    avatar: () => (avatar instanceof AvatarCharacter ? avatar : null),
    cameraMode: () => mode,
    hint: (text, ms = 4000) => {
      hint.textContent = text;
      hintUntil = performance.now() + ms;
    },
    groundAt: (x, z, y) => floors.groundAt(x, z, y),
    floorY: () => floors.floorY,
    npcs: () => (floors.viewLevel === 0 ? npcs.values() : []),
  });
  // every cupboard, wardrobe, drawer and cart opens; the controlled drugs need the nurse in charge's key
  // and the crash carts carry a seal (cabinets.ts; client-only, off the record)
  const cabinets = new Cabinets({
    onOpenLocker: cb.onOpenLocker,
    scene,
    built,
    layout,
    controller,
    gestures,
    items,
    mode: () => mode,
    hint: (text, ms = 4000) => {
      hint.textContent = text;
      hintUntil = performance.now() + ms;
    },
    level: () => floors.viewLevel,
    room: () => lastRoom,
    free: (x, z) => (floors.navFor() ?? nav).isFreeAt(x, z),
    path: (x, z) => playerNav().findPath(controller.pos.x, controller.pos.y, x, z),
    // the ED's charge nurse keeps the key downstairs (Ward 2 East's nurse in charge upstairs: floors.ts)
    keyholders: [
      {
        level: 0,
        id: 'rn_rosa',
        name: 'Rosa',
        role: 'the charge nurse',
        npcs: npcErrands,
        busy: () => {
          const st = npcs.get('rn_rosa');
          return !st || !st.v.visible ? 'away' : (st.v.activity ?? (st.path && !errands.has('rn_rosa') ? 'on her way somewhere' : null));
        },
      },
      ...floors.keyholders(),
    ],
    say: (id, text) => {
      if (!cb.onAside?.(id, text)) api.say(id, text);
    },
    bodies: (x, z, level) => (level === 0 ? [...npcs.values()].filter((st) => st.v.visible && Math.hypot(st.pos.x - x, st.pos.y - z) < 2.5).map((st) => ({ x: st.pos.x, z: st.pos.y })) : floors.wardPeople()),
    avatarRoot: () => avatar.root,
    // (down on your haunches for a low drawer: the avatar's crouch, and in first person the view)
    avatar: () => (avatar instanceof AvatarCharacter ? avatar : null),
    camera,
  });
  // at a patient's bed (care.ts): turned to them across the bed, a hand on the rail, leaning in, looking
  // at their face; an exam's hand to the region examined. The AI doctor's body at a bedside likewise
  const careBox = new THREE.Box3();
  const care = new BedsideCare({
    scene,
    layout,
    controller: () => controller,
    mode: () => mode,
    avatar: () => (avatar instanceof AvatarCharacter ? avatar : null),
    hands,
    patient: (id) => carePatient(id),
    level: () => floors.viewLevel,
    path: (x, z) => playerNav().findPath(controller.pos.x, controller.pos.y, x, z),
    // room to stand: no wall or furniture within a body's width (at your storey), nobody else where the body will be
    clear: (x, z, except, body) => {
      const y0 = floors.floorY + 0.05;
      for (const b of built.colliders) {
        if (b.max.y <= y0 || b.min.y >= y0 + 1.8) continue;
        careBox.copy(b).expandByVector(new THREE.Vector3(0.29, 0, 0.29));
        if (x > careBox.min.x && x < careBox.max.x && z > careBox.min.z && z < careBox.max.z) return false;
      }
      const bx = body?.x ?? x;
      const bz = body?.z ?? z;
      if (floors.viewLevel === 0) for (const st of npcs.values()) if (st.v.id !== except && st.v.visible && Math.hypot(st.pos.x - bx, st.pos.y - bz) < 0.48) return false;
      for (const p of floors.wardPeople()) if (p.id !== except && Math.hypot(p.x - bx, p.z - bz) < 0.48) return false;
      return true;
    },
    gesturing: () => gestures.active,
    busy: () => gestures.busyHands(),
    curtainBoxes: () => curtains.list.map((c) => c.collider),
  });
  const npcCare = new NpcCare(care.beds, scene);
  /** NPCs who take the bedside pose at a patient (the AI doctor; tests add others) */
  const careNpcs = new Set(['ai_doctor']);
  const careStep = new THREE.Vector3();
  /** a lying patient for the bedside pose: the ED's NPCs (ground floor), the ward's patients (floors.ts) */
  function carePatient(id: string): CarePatient | null {
    const st = npcs.get(id);
    if (!st) {
      const w = floors.wardPatients().find((p) => p.id === id);
      return w ? { ...w, lying: w.ch.posture === 'lie' } : null;
    }
    const here = !st.path && st.v.visible;
    return { id, patientId: st.v.patientId, ch: st.ch, x: st.pos.x, z: st.pos.y, yaw: st.yaw, lying: st.ch.posture === 'lie' && here, sitting: st.ch.posture === 'sit' && st.ch.seatKind === 'bed' && here, level: 0 };
  }

  controller.groundAt = groundHeight;
  controller.ceilingAt = ceilingAt;
  const spawn = { ...layout.playerSpawn };
  // dev aid for screenshots: ?wpos=x,z,yawDeg[,pitchDeg]
  const wpos = new URLSearchParams(location.search).get('wpos');
  let devPitch: number | null = null;
  if (wpos) {
    const [x, z, deg, pitch] = wpos.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) Object.assign(spawn, { x, z, rot: ((deg || 0) * Math.PI) / 180 });
    if (Number.isFinite(pitch)) devPitch = (pitch * Math.PI) / 180;
  }
  controller.pos.set(spawn.x, spawn.z);
  controller.yaw = (spawn.rot ?? 0) - Math.PI;
  controller.facing = spawn.rot ?? 0;
  if (devPitch !== null) controller.pitch = devPitch;

  // ── NPCs ──
  const npcs = new Map<string, NpcState>();
  // the waiting-room crowd: props, acts and their sounds (crowd.ts, server/sim/ambient.ts)
  const crowd = new Crowd();
  // the corridor wheelchair is the one a guard wheels to someone who fainted (crowd.ts)
  crowd.borrowChair = (near) => wheelchair.lend(true, near);
  crowd.returnChair = () => void wheelchair.lend(false);
  // ambient sound (audio/soundscape.ts): monitors, room tone, phones, steps, doors, PA, sirens…
  const sound = createSoundscape(layout, {
    occluders: built.occluders,
    eachNpc: (fn) => {
      for (const st of npcs.values()) fn(st.v, st.pos.x, st.pos.y, st.ch.posture === 'lie' ? 0.85 : st.ch.posture === 'sit' ? 1.15 : st.ch.height * 0.92, !!st.path);
    },
  });
  // the CT suite and the X-ray room at work (imagingLife.ts): radiographers, couch, tube, lights, screens, sounds
  const imaging = new ImagingLife({
    scene,
    rig: built.imaging,
    layout,
    nav,
    labels: () => labels,
    camera,
    container,
    occluders: built.occluders,
    npcs: () => npcs.values(),
    level: () => floors.viewLevel,
    player: () => ({ x: controller.pos.x, z: controller.pos.y }),
    cutaway: () => !!cutaway,
  });
  let lastView: PlayerView | null = null;
  let lastEmsT = -1e9;
  let gameT = 0;
  let viewReceivedAt = 0;
  let isNight: boolean | null = null;

  function setNight(night: boolean) {
    if (night === isNight) return;
    isNight = night;
    rig?.setNight(night);
    floors.setNight(night);
    // phone screens in the waiting room glow brighter in the dark
    setPhoneNight(night);
  }

  function surfaceAt(x: number, z: number): number | undefined {
    for (const s of built.surfaces) if (x >= s.box.min.x - 0.05 && x <= s.box.max.x + 0.05 && z >= s.box.min.z - 0.05 && z <= s.box.max.z + 0.05) return s.y;
    return undefined;
  }
  function seatNear(x: number, z: number) {
    let best: (typeof built.seats)[number] | undefined;
    let bd = 0.75;
    for (const s of built.seats) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  function destinationFor(v: NpcView, dupIndex: number) {
    // the waiting-room crowd (and staff it borrows) are placed exactly
    if (v.ambient?.at) return { ...v.ambient.at };
    // the AI doctor at a bedside (observe mode): across the bed at the patient's chest, turned to them (care.ts)
    // (a patient sitting on the edge of the bed: the spot itself, the pose turns it to them)
    if ((v.id === 'ai_doctor' || v.bedsidePatientId) && /^(bedside|bedside_l|foot|head)$/.test(v.spot) && ![...npcs.values()].some((o) => o.v.role === 'patient' && o.v.location === v.location && o.v.posture === 'sit')) {
      const bs = spotFor(layout, v.location, v.spot);
      const at = bs ? stanceFor(care.beds, v.location, bs.x, bs.z) : null;
      if (at) return { x: at.x, z: at.z, rot: at.facing };
    }
    const sp = spotFor(layout, v.location, v.spot) ?? { x: layout.playerSpawn.x, z: layout.playerSpawn.z, rot: 0 };
    const rot = sp.rot ?? 0;
    let x = sp.x;
    let z = sp.z;
    if (dupIndex > 0) {
      // spread duplicates sideways relative to facing
      const side = dupIndex % 2 ? 1 : -1;
      const k = Math.ceil(dupIndex / 2) * 0.65 * side;
      x += Math.cos(rot) * k;
      z -= Math.sin(rot) * k;
    }
    return { x, z, rot };
  }

  function applyFinalPosture(st: NpcState) {
    const v = st.v;
    // (at the end of an errand of ours, e.g. a key brought to a cupboard, they stand: the server's posture is for its own spot)
    const p = v.posture === 'walk' || errands.has(v.id) ? 'stand' : v.posture;
    const amb = v.ambient;
    if (p === 'lie' && (amb?.act === 'floor' || amb?.act === 'come_round')) {
      // fainted in the waiting room: on the floor itself
      st.surfaceY = 0;
      st.pos.set(st.dest.x, st.dest.z);
      st.yaw = st.dest.rot;
      st.ch.setPosture('lie', 0);
    } else if (p === 'sit' && amb?.props?.includes('wheelchair')) {
      // in a wheelchair (accessories.ts: seat top at 0.5 m)
      st.pos.set(st.dest.x, st.dest.z);
      st.yaw = st.dest.rot;
      st.ch.seatKind = 'chair';
      st.ch.setPosture('sit', undefined, 0.5);
    } else if (p === 'lie') {
      st.surfaceY = surfaceAt(st.dest.x, st.dest.z) ?? 0.64;
      st.pos.set(st.dest.x, st.dest.z);
      st.yaw = st.dest.rot;
      st.ch.setPosture('lie', st.surfaceY);
    } else if (p === 'sit') {
      const seat = seatNear(st.dest.x, st.dest.z);
      const surf = seat ? undefined : surfaceAt(st.dest.x, st.dest.z);
      if (surf !== undefined) {
        // sit on the side edge of the bed/stretcher, legs dangling: on its seat, toward the foot of the
        // backrest's crease (bedRig.ts), so the backrest can be up behind them
        const yaw = st.dest.rot + Math.PI / 2;
        st.pos.set(st.dest.x + Math.sin(yaw) * 0.18 + Math.sin(st.dest.rot) * 0.3, st.dest.z + Math.cos(yaw) * 0.18 + Math.cos(st.dest.rot) * 0.3);
        st.yaw = yaw;
        st.ch.seatKind = 'bed';
        st.ch.setPosture('sit', undefined, surf + 0.01);
      } else if (seat) {
        st.pos.set(seat.x, seat.z);
        st.yaw = seat.rot;
        st.ch.seatKind = seat.kind;
        st.ch.setPosture('sit', undefined, seat.y);
      } else {
        st.pos.set(st.dest.x, st.dest.z);
        st.yaw = st.dest.rot;
        st.ch.setPosture('sit', undefined, 0.47);
      }
    } else {
      st.yaw = st.dest.rot;
      st.ch.setPosture('stand');
    }
  }

  /**
   * A patient in (or on the edge of) their bed or stretcher: its backrest to the angle the server's bed
   * position asks (bedRig.ts moves it there), and a body lying in it on it as it moves (avatars.ts).
   * Beds nobody asks for settle flat.
   */
  function inBed(st: NpcState) {
    const bp = st.v.bedPosition;
    const sitting = !st.path && st.ch.posture === 'sit' && st.ch.seatKind === 'bed';
    const on = !st.path && (st.ch.posture === 'lie' || sitting);
    const rig = on && bp ? rigAt(scene, st.dest.x, 0, st.dest.z, st.dest.rot) : null;
    rig?.want(bp!.headDeg, sitting);
    const av = st.ch as AvatarCharacter;
    if ('bed' in av) av.bed = rig && st.ch.posture === 'lie' ? { rig, pos: bp } : null;
    // on the edge with the feet off the floor: a step stool under them (measured every 2 s while they sit, moved
    // only when the feet have: the pose takes a moment to settle after the model is in)
    const now = performance.now();
    st.sitSince = sitting ? (st.sitSince ?? now) : undefined;
    if (!sitting || !rig) st.stepAt = undefined;
    else if (now - st.sitSince! > 1500 && now - (st.stepT ?? 0) > 2000 && av.ready && typeof av.toesWorld === 'function') {
      st.stepT = now;
      const toes = av.toesWorld();
      if (toes.length === 2) {
        const p = rig.toBed(new THREE.Vector3((toes[0][0] + toes[1][0]) / 2, Math.min(toes[0][1], toes[1][1]), (toes[0][2] + toes[1][2]) / 2));
        // under the soles (the toe joints sit ~2.5 cm over them), its middle a little back under the feet
        const at = { x: p.x - Math.sign(p.x) * 0.05, z: p.z, top: p.y - 0.025 };
        const was = st.stepAt;
        if (!was || Math.abs(was.top - at.top) > 0.01 || Math.hypot(was.x - at.x, was.z - at.z) > 0.03) st.stepAt = at;
      }
    }
    rig?.footStep(st.stepAt ?? null);
  }

  /** walk st to dest (planned next frame by steering.ts); sits down at the end if its posture there is seated */
  function walkTo(st: NpcState, dest: { x: number; z: number; rot: number }, wander = false) {
    const amb = st.v.ambient;
    const wheel = !!amb?.props?.includes('wheelchair');
    // (a parked wheelchair is a seat too: stepped to, turned round, backed into; one being pushed carries you)
    const seat = !wander && st.v.posture === 'sit' ? (wheel ? (amb?.pushedBy ? undefined : { x: dest.x, z: dest.z, rot: dest.rot }) : seatNear(dest.x, dest.z)) : undefined;
    const fromSeat = st.ch.posture === 'sit' && !wheel ? seatNear(st.pos.x, st.pos.y) : undefined;
    const pace = amb?.pace ?? (st.v.appearance.age === 'old' ? 0.95 : st.v.role === 'ems' ? 1.6 : 1.3);
    steer.walk(st, dest, { pace, seat, fromSeat, face: wander || st.v.posture === 'lie' ? undefined : dest.rot, timed: !!amb?.at, radius: wheel && (amb?.pushedBy || amb?.act === 'push') ? 0.4 : 0.25 });
    st.path = [new THREE.Vector2(dest.x, dest.z)];
  }

  function removeNpc(id: string, st: NpcState) {
    steer.remove(id);
    crowd.remove(id, st.ch);
    scene.remove(st.ch.root);
    st.ch.dispose?.();
    labels.remove(id);
    npcs.delete(id);
  }

  function startTimedWalk(st: NpcState, start: { x: number; z: number }, dest: NpcState['dest'], destKey: string, startYaw: number, startFraction = 0) {
    const stretcher = st.v.walkIn?.mobility === 'stretcher';
    const assisted = st.v.discharge?.mobility === 'wheelchair' || st.v.walkIn?.mobility === 'wheelchair';
    // The interactive corridor wheelchair can be parked anywhere. Ordinary steerers give its
    // frame and footrests room, and a patient heading for the exit needs the same clearance.
    const parked = wheelchair.obstacles();
    const travelsThroughEntrance = !!st.v.walkIn || st.v.discharge?.phase === 'leaving';
    let overlap: string | undefined;
    const checked = (r: Route | null) => {
      if (!travelsThroughEntrance || !r) return r;
      const issue = dischargeOverlap(steer.nav, r, assisted, startYaw, parked, 0, stretcher);
      if (!issue) return r;
      overlap = issue;
      if (st.v.walkIn && (stretcher || assisted) && fitTransportHeadings(steer.nav, r, startYaw, dest.rot, parked, stretcher)
        && !dischargeOverlap(steer.nav, r, assisted, startYaw, parked, 0, stretcher)) return r;
      return null;
    };
    let route: Route | null = null;
    const widths = stretcher ? [0.72, 0.85, 0.6, 0.5, 0.43] : assisted ? [0.45, 0.4] : [0.3];
    for (const clearance of widths) {
      route = checked(steer.nav.route(start.x, start.z, dest.x, dest.z, { clearance, people: parked }));
      if (route) break;
    }
    if (!route) {
      const points = nav.findPath(start.x, start.z, dest.x, dest.z);
      if (points?.length) route = checked(steer.nav.fallbackRoute(points, start.x, start.z));
    }
    if (!route) {
      const warning = `No clear route for ${st.v.id}: ${overlap ?? 'destination unreachable'}`;
      if (st.exitWarning !== warning) console.warn(warning);
      st.exitWarning = warning;
      return;
    }
    st.exitWarning = undefined;
    steer.cancel(st.v.id);
    st.destKey = destKey;
    st.dest = dest;
    const d = (st.v.walkIn ?? st.v.discharge)!;
    st.timedWalk = { patientId: d.patientId, since: d.since, route, s: 0, lastT: -Infinity, startYaw, speed: 0, parked, startFraction };
    st.path = [new THREE.Vector2(dest.x, dest.z)];
    st.ch.seatKind = 'chair';
    st.ch.setPosture(st.v.posture, st.v.walkIn?.mobility === 'stretcher' ? 0.63 : undefined, 0.5);
  }

  function syncNpcs(view: PlayerView) {
    const seen = new Set<string>();
    const dupCount = new Map<string, number>();
    for (const v of view.npcs) {
      if (crowdOff && v.ambient?.crowd) continue;
      if (v.role === 'patient' && v.discharge?.phase === 'departed') continue;
      seen.add(v.id);
      const dk = `${v.location}|${v.spot}`;
      const dupIndex = v.ambient?.at ? 0 : (dupCount.get(dk) ?? 0);
      if (!v.ambient?.at) dupCount.set(dk, dupIndex + 1);
      const destKey = v.ambient?.at ? `at|${v.ambient.at.x.toFixed(2)},${v.ambient.at.z.toFixed(2)}` : `${dk}|${dupIndex}`;
      let st = npcs.get(v.id);
      if (st) st.leavingAt = undefined;
      const dest = destinationFor(v, dupIndex);
      const exiting = v.role === 'patient' && v.discharge?.phase === 'leaving';
      const approaching = v.id === v.discharge?.nurseId && v.discharge?.phase === 'awaiting_nurse' && !!v.discharge.from;
      const progress = v.walkIn ?? v.discharge;
      const timed = exiting || approaching || !!v.walkIn;
      const hereAtDispatch = approaching && st && !st.timedWalk && view.t - v.discharge!.since < 2
        ? { x: st.pos.x, z: st.pos.y } : undefined;
      const bed = v.walkIn?.bed ?? (timed ? view.board.find(row => row.id === progress?.patientId)?.bed : undefined);
      const start = v.walkIn?.from ?? (approaching ? hereAtDispatch ?? v.discharge!.from : bed && dischargePickup(layout, bed));
      if (!st) {
        const patient = v.role === 'patient' ? view.board.find(row => row.id === v.patientId) : undefined;
        const sex = patient?.sex ?? (v.role === 'patient' ? v.walkIn?.sex : undefined);
        const ch = createCharacter({ id: v.id, role: v.role, appearance: v.appearance, sex: sex === 'F' ? 'f' : sex === 'M' ? 'm' : undefined });
        scene.add(ch.root);
        const spawn = start || dest;
        st = { v, ch, pos: new THREE.Vector2(spawn.x, spawn.z), yaw: dest.rot, path: null, destKey, dest, wanderAt: performance.now() + 2000 + Math.random() * 4000, wandering: false };
        npcs.set(v.id, st);
        if (!timed) applyFinalPosture(st);
      } else {
        if (st.timedWalk && (!timed || st.timedWalk.patientId !== progress?.patientId || st.timedWalk.since !== progress.since)) {
          // The clock can jump over the last steps to the bedside (wait, step mode or reconnect).
          st.pos.set(st.dest.x, st.dest.z);
          st.yaw = st.dest.rot;
          st.path = null;
          st.timedWalk = undefined;
        }
        const justRoomed = !!st.v.walkIn && !v.walkIn && !!v.bedPosition;
        const postureChanged = st.v.posture !== v.posture;
        st.v = v;
        const errand = errands.get(v.id);
        if (justRoomed) {
          // The timed walk ends beside this mattress. Settle into the same person's bed pose.
          st.destKey = destKey;
          st.dest = dest;
          st.path = null;
          applyFinalPosture(st);
        } else if (errand) {
          // on an errand of ours (the cashier after you): where the server has it, for the walk back
          errand.home = dest;
          st.destKey = destKey;
        } else if (st.destKey !== destKey && !timed) {
          // wheeled off before they were in the wheelchair (held up on the way to it): in it first, where it is parked
          if (v.ambient?.pushedBy && v.posture === 'sit' && st.ch.posture !== 'sit') {
            steer.cancel(v.id);
            st.pos.set(st.dest.x, st.dest.z);
            st.yaw = st.dest.rot;
            st.ch.seatKind = 'chair';
            st.ch.setPosture('sit', undefined, 0.5);
          }
          st.destKey = destKey;
          st.dest = dest;
          st.wandering = false;
          // out of the seat it is in (read before standing up), round furniture and people (steering.ts)
          walkTo(st, dest);
          // wheeled in a wheelchair: stays seated while it moves
          if (!v.ambient?.pushedBy) st.ch.setPosture('stand');
        } else if (postureChanged && !st.path) applyFinalPosture(st);
      }
      if (timed && !st.timedWalk) {
        // The same starting point and clinical time work when a watcher joins halfway through the trip.
        if (start) startTimedWalk(st, start, dest, destKey, v.walkIn?.from.rot ?? ((bed && spotFor(layout, bed, 'bed')?.rot) || 0));
      }
      st.ch.emotion = v.emotion;
      st.ch.root.visible = v.visible;
      crowd.sync(v, st.ch, dest, !!st.path);
      const esiRow = v.patientId && v.role === 'patient' ? view.board.find((r) => r.id === v.patientId) : undefined;
      labels.ensure(v.id, v.name, v.title, esiRow ? ESI_HEX[esiRow.esi] : null, v.activity);
      if (v.bark && v.bark.t !== st.lastBark) {
        if (st.lastBark !== undefined || view.t - v.bark.t < 90) labels.say(v.id, v.bark.text);
        st.lastBark = v.bark.t;
      }
      if (v.role === 'ems' && v.visible) lastEmsT = view.t;
    }
    const onTrolley = new Set(view.npcs.filter(n => n.walkIn?.mobility === 'stretcher').map(n => n.walkIn!.patientId));
    for (const [id, cart] of trolleys) if (!onTrolley.has(id)) {
      cart.rig.dispose(); cart.group.removeFromParent(); trolleys.delete(id);
    }
    for (const [id, st] of npcs) {
      if (!seen.has(id)) {
        // a crowd member who left (through a door, to the back): walks on and goes once unseen (stepNpcs)
        if (st.v.ambient?.crowd && !crowdOff) {
          st.leavingAt ??= performance.now();
          continue;
        }
        removeNpc(id, st);
      }
    }
  }

  // ── interaction ──
  const raycaster = new THREE.Raycaster();
  const tmpV = new THREE.Vector3();
  const tmpBox = new THREE.Box3();
  let focus: { key: string; target: InteractTarget; center: THREE.Vector3 } | null = null;

  function npcBox(st: NpcState, out: THREE.Box3) {
    const p = st.ch.posture;
    const x = st.pos.x;
    const z = st.pos.y;
    if (p === 'lie' && !st.path) {
      const s = st.surfaceY ?? 0.64;
      const along = Math.abs(Math.cos(st.yaw)) > 0.5;
      out.min.set(x - (along ? 0.5 : 1.0), 0.2, z - (along ? 1.0 : 0.5));
      out.max.set(x + (along ? 0.5 : 1.0), s + 0.45, z + (along ? 1.0 : 0.5));
    } else if (p === 'sit' && !st.path) {
      out.min.set(x - 0.4, 0, z - 0.4);
      out.max.set(x + 0.4, st.ch.height * 0.78, z + 0.4);
    } else {
      out.min.set(x - 0.33, 0, z - 0.33);
      out.max.set(x + 0.33, st.ch.height, z + 0.33);
    }
    return out;
  }

  function labelFor(v: NpcView) {
    return v.role === 'patient' ? `Talk to ${v.name} (${v.title})` : `Talk to ${v.name}${v.title ? ` (${v.title})` : ''}`;
  }

  /** pick the interactable under the given NDC (null = none) */
  function pick(ndc: THREE.Vector2): { key: string; target: InteractTarget; center: THREE.Vector3; dist: number } | null {
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    type Hit = { key: string; target: InteractTarget; center: THREE.Vector3; t: number; d: number; box: THREE.Box3 };
    let best: Hit | null = null;
    let nearestNpc: Hit | null = null;
    const hits: Hit[] = [];
    const consider = (key: string, target: InteractTarget, box: THREE.Box3, bias = 0) => {
      const hit = ray.intersectBox(box, tmpV);
      if (!hit) return;
      // people and small objects win over the big equipment they stand next to / lie on
      const d = hit.distanceTo(ray.origin);
      const t = d + bias;
      const h: Hit = { key, target, center: box.getCenter(new THREE.Vector3()), t, d, box };
      hits.push(h);
      if (target.kind === 'npc' && (!nearestNpc || d < (nearestNpc as Hit).d)) nearestNpc = h;
      if (!best || t < best.t) best = h;
    };
    // (only what is on your storey: floors.ts)
    const ground = floors.viewLevel === 0;
    for (const st of npcs.values()) {
      if (!ground || !st.v.talkable || !st.v.visible) continue;
      // the cafeteria's cashier, while you owe him for a coffee: E pays (payment.ts). A patient while you
      // hold their belonging: E gives it back (itemSystem.ts)
      const pay = amenities.npcTarget(st.v.id) ?? items.giveTarget(st.v);
      if (pay) consider(`use:${pay.id}`, pay, npcBox(st, tmpBox));
      else consider(`npc:${st.v.id}`, { kind: 'npc', npcId: st.v.id, label: labelFor(st.v) }, npcBox(st, tmpBox));
    }
    // (while you owe for a coffee, the till is for paying: its inspect card steps aside, payment.ts)
    for (const it of built.interactables) if (floors.pickable(it) && !amenities.shadows(it.key)) consider(it.key, it.target, it.box, it.target.kind === 'inspect' ? 0.45 : 0);
    if (ground) for (const it of items.targets()) consider(`item:${it.id}`, { kind: 'item', itemId: it.id, label: items.targetLabel(it) }, it.box, -0.05);
    for (const a of amenities.targets()) if (floors.pickable(a)) consider(a.key, a.target, a.box);
    for (const a of hygiene.targets()) if (floors.pickable(a)) consider(a.key, a.target, a.box);
    // (the wheelchair offers itself only on your storey)
    for (const a of wheelchair.targets()) consider(a.key, a.target, a.box);
    // aiming at someone talks to them, even past a fixture beside them (Inés and her wet-floor sign 0.7 m
    // away: aimed at her legs, the sign won and E inspected it); a fixture clearly in front (> 1.2 m nearer) still wins
    const npcHit = nearestNpc as Hit | null;
    if (npcHit && best && (best as Hit).target.kind === 'inspect' && npcHit.d - (best as Hit).d < 1.2) best = npcHit;
    // something inside or overlapping a bigger box (a mug on a workstation's desk, the till on the serving
    // counter, a basin beside a washroom's toilet): the ray reaches the smaller one through the bigger one,
    // so the smaller one wins when the crosshair is on it (and the bigger one everywhere else)
    // (inside a person's box, only a thing lying there wins: a handbag beside a patient on their bed)
    if (best) {
      const outer = best as Hit;
      const person = outer.target.kind === 'npc';
      const vol = (bx: THREE.Box3) => (bx.max.x - bx.min.x) * (bx.max.y - bx.min.y) * (bx.max.z - bx.min.z);
      let inner: Hit | null = null;
      for (const h of hits) {
        if (h === outer || h.target.kind === 'npc' || (person && h.target.kind !== 'item') || vol(h.box) > vol(outer.box) * 0.6) continue;
        if (!outer.box.containsPoint(h.center) && !(outer.box.intersectsBox(h.box) && h.d - outer.d < 0.6)) continue;
        if (!inner || vol(h.box) < vol((inner as Hit).box)) inner = h;
      }
      if (inner) best = inner;
    }
    if (!best) return null;
    const b = best as { key: string; target: InteractTarget; center: THREE.Vector3; t: number; d: number };
    if (mode !== 'top') {
      // walls in between? (against the real hit distance: with the inspect bias added, the wall a clock,
      // an AED or a whiteboard hangs on counted as in between and none of them could be inspected)
      for (const o of built.occluders) {
        const hit = ray.intersectBox(o, tmpV);
        if (hit && hit.distanceTo(ray.origin) < b.d - 0.05) return null;
      }
    }
    const dist = Math.hypot(b.center.x - controller.pos.x, b.center.z - controller.pos.y);
    return { key: b.key, target: b.target, center: b.center, dist };
  }

  function nearestFallback(): { key: string; target: InteractTarget; center: THREE.Vector3; dist: number } | null {
    // generous assist in first/third person: nearest talkable NPC in front within 1.8 m
    const fx = -Math.sin(controller.yaw);
    const fz = -Math.cos(controller.yaw);
    let best: { key: string; target: InteractTarget; center: THREE.Vector3; dist: number } | null = null;
    for (const st of npcs.values()) {
      if (!st.v.talkable || !st.v.visible || floors.viewLevel !== 0) continue;
      const dx = st.pos.x - controller.pos.x;
      const dz = st.pos.y - controller.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > 1.8 || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.75) continue;
      // (the cashier you owe: E pays him; a patient whose belonging you hold: E gives it back)
      const pay = amenities.npcTarget(st.v.id) ?? items.giveTarget(st.v);
      if (!best || d < best.dist) best = { key: pay ? `use:${pay.id}` : `npc:${st.v.id}`, target: pay ?? { kind: 'npc', npcId: st.v.id, label: labelFor(st.v) }, center: new THREE.Vector3(st.pos.x, 0, st.pos.y), dist: d };
    }
    return best;
  }

  function updateFocus() {
    let f: ReturnType<typeof pick> = null;
    // the wheelchair's "get out" is still E, but it gets no on-screen prompt (wheelchair.ts)
    let quietFocus = false;
    // spectators (follow-cam) don't interact: no focus ring under the followed doctor
    if (inputEnabled && !followId) {
      const ndc = controller.aimNdc();
      if (ndc) f = pick(ndc);
      if (mode !== 'top') {
        if (f && f.dist > INTERACT_RANGE) f = null;
        // (in an elevator car its panel is the prompt: floors.ts)
        // (a curtain within reach: its prompt without aiming at it, curtains.ts)
        if (!f) f = nearestFallback() ?? floors.fallback() ?? curtains.fallback();
      }
      // nothing in sight: E stands you up from a café chair (putting things down is G only)
      if (!f) {
        const cafe = amenities.idleTarget();
        const chair = cafe ? null : wheelchair.idleTarget();
        const idle = cafe ?? chair;
        if (idle) f = { ...idle, center: new THREE.Vector3(controller.pos.x, 0, controller.pos.y), dist: 0 };
        quietFocus = !!chair;
      }
    }
    const key = f?.key ?? null;
    if (key !== (focus?.key ?? null)) {
      focus = f ? { key: f.key, target: f.target, center: f.center } : null;
      cb.onFocusTarget(focus && !quietFocus ? focus.target : null);
    } else if (f && focus) {
      focus.center = f.center;
      // same thing, new words (a coffee machine counting down)
      if (f.target.label !== focus.target.label) {
        focus.target = f.target;
        if (!quietFocus) cb.onFocusTarget(f.target);
      }
    }
    crosshair.classList.toggle('focus', !!focus);
    if (focus) {
      ring.visible = focus.target.kind !== 'item' && !(focus.target.kind === 'use' && (focus.target.id === 'place' || focus.target.id === 'stand' || focus.target.id.startsWith('elev:') || focus.target.id.startsWith('curtain:')));
      ring.position.set(focus.center.x, floors.floorY + 0.03, focus.center.z);
      const s = 1 + Math.sin(performance.now() / 220) * 0.06;
      ring.scale.set(s, s, s);
    } else ring.visible = false;
  }

  function playerNav() {
    // Reserve a little extra room for corners cut by the grid's path smoothing.
    return (floors.navFor() ?? nav).withPeople(controller.people, 0.45);
  }

  function walkPlayerTo(x: number, z: number, toTarget = false) {
    // (each storey has its own nav grid: floors.ts)
    const nv = playerNav();
    const path = nv.findPath(controller.pos.x, controller.pos.y, x, z);
    if (!path) return;
    // findPath appends the exact click after its nearest free cell. Stop at the cell for
    // an occupied destination, retaining the normal approach to fixed geometry elsewhere.
    if (!nv.isFreeAt(x, z) && (toTarget || roomAt(layout, x, z)?.id === 'waiting' ||
      (floors.navFor() ?? nav).isFreeAt(x, z))) path.pop();
    controller.path = path.length ? path : null;
  }

  /**
   * A patient's belonging back to them: near enough, the hand that holds it goes to the bed beside
   * them and leaves it there (gesture.ts turns the body first; the server hears give_item when it is
   * let go). Further off, you walk up to the bed first (once: then the hand reaches from there).
   */
  let giveWalked: string | null = null;
  let giveSettle = 0;
  function giveBelonging(instId: string) {
    const spot = items.bedSpot(instId);
    if (!spot) return;
    if (Math.hypot(spot.pos.x - controller.pos.x, spot.pos.z - controller.pos.y) > 0.85 && giveWalked !== instId) {
      giveWalked = instId;
      giveSettle = 0;
      pendingInteract = `use:give:${instId}`;
      // beside the bed, level with where it will lie
      walkPlayerTo(spot.stand.x, spot.stand.y, true);
      return;
    }
    // just walked up: the feet settle first (a reach begun while still steering in is cut as walking off,
    // and the bag dropped onto the bed with no hand)
    if (giveWalked === instId && (controller.moving || controller.steering)) {
      if (!giveSettle) giveSettle = performance.now() + 1200;
      if (performance.now() < giveSettle) {
        pendingInteract = `use:give:${instId}`;
        return;
      }
    }
    giveWalked = null;
    const go = items.handOverStart(instId, () => gestures.fpTouch());
    if (!go) return;
    gestures.start(
      go.at,
      () => {
        const caseId = items.handOver(instId);
        if (caseId) cb.onGiveItem?.(caseId);
      },
      // (the hand stays on the handle a moment as it is set down)
      { arm: go.arm, grip: 'pull', hold: 0.6 },
    );
  }

  /** objects and equipment are handled in the world; everything else opens a panel */
  function interactWith(t: InteractTarget) {
    // a patient's belonging back to them (itemSystem.ts)
    if (t.kind === 'use' && t.id.startsWith('give:')) {
      giveBelonging(t.id.slice(5));
      return;
    }
    // a ward patient (no tablet up there): to the bedside, turned to them (care.ts)
    if (t.kind === 'use' && t.id.startsWith('ward:')) {
      care.visit(t.id.slice(5));
      return;
    }
    // elevator call buttons and car panels (floors.ts), bay curtains (curtains.ts): the hand goes to it
    // (cupboards, drawers and carts: the hand to the handle, cabinets.ts)
    if (t.kind === 'use' && (floors.use(t.id) || curtains.use(t.id) || cabinets.use(t.id) || swingDoors.some((d) => d.use(t.id)))) return;
    // the wheelchair: sitting in it, getting out, and what you can't do from it (wheelchair.ts)
    if (wheelchair.refuses(t) || (t.kind === 'use' && wheelchair.interact(t.id))) return;
    if (t.kind === 'item') items.interact(t.itemId);
    else if (t.kind === 'inspect') items.inspectSubject(t.subject);
    else if (t.kind === 'use') {
      if (!hygiene.interact(t.id)) amenities.interact(t.id);
    }
    else if (t.kind !== 'computer' || !ws.begin(t)) cb.onInteract(t);
  }

  function interactOrWalk(f: { key: string; target: InteractTarget; center: THREE.Vector3; dist: number }) {
    if (f.dist <= (f.target.kind === 'item' ? 2.1 : INTERACT_RANGE)) {
      pendingInteract = null;
      interactWith(f.target);
      return;
    }
    pendingInteract = f.key;
    // walk up the shortest way to a free spot within reach of it: a thing on a counter is reached from the
    // counter's front. Aiming for its centre (inside the counter) took the nearest free cell, which could be
    // round the back of the station, 12 m away
    const nv = playerNav();
    let bestPath: THREE.Vector2[] | null = null;
    let bestLen = Infinity;
    // (up to 1.55 m out: across a counter, its inner edge is in reach from the front)
    for (const r of [0.55, 0.8, 1.05, 1.3, 1.55])
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = f.center.x + Math.cos(a) * r;
        const z = f.center.z + Math.sin(a) * r;
        if (!nv.isFreeAt(x, z)) continue;
        const p = nv.findPath(controller.pos.x, controller.pos.y, x, z);
        if (!p) continue;
        let len = 0;
        let px = controller.pos.x;
        let pz = controller.pos.y;
        for (const q of p) {
          len += Math.hypot(q.x - px, q.y - pz);
          px = q.x;
          pz = q.y;
        }
        if (len < bestLen) {
          bestLen = len;
          bestPath = p;
        }
      }
    if (bestPath) {
      controller.path = bestPath.length ? bestPath : null;
      return;
    }
    walkPlayerTo(f.center.x, f.center.z, true);
  }

  function interactFocused(fromKey: boolean) {
    if (!inputEnabled || !focus) return;
    // standing up is E only: a click to look around must not get you out of your chair
    if (!fromKey && focus.target.kind === 'use' && focus.target.id === 'stand') return;
    const dist = Math.hypot(focus.center.x - controller.pos.x, focus.center.z - controller.pos.y);
    interactOrWalk({ ...focus, dist });
  }

  function resolvePending() {
    if (!pendingInteract || controller.path) return;
    const key = pendingInteract;
    pendingInteract = null;
    let target: InteractTarget | null = null;
    let center: THREE.Vector3 | null = null;
    if (key.startsWith('npc:')) {
      const st = npcs.get(key.slice(4));
      if (st) {
        target = { kind: 'npc', npcId: st.v.id, label: labelFor(st.v) };
        center = new THREE.Vector3(st.pos.x, 0, st.pos.y);
      }
    } else if (key.startsWith('item:')) {
      const it = items.items.get(key.slice(5));
      if (it) {
        target = { kind: 'item', itemId: it.id, label: it.label };
        center = it.box.getCenter(new THREE.Vector3());
      }
    } else if (key.startsWith('use:give:')) {
      // (walked up to the bed to give a patient their belonging)
      for (const st of npcs.values()) {
        const g = items.giveTarget(st.v);
        if (g?.id !== key.slice(4)) continue;
        target = g;
        center = items.bedSpot(key.slice(9))?.pos ?? new THREE.Vector3(st.pos.x, 0, st.pos.y);
      }
    } else if (key.startsWith('use:')) {
      const a = amenities.find(key) ?? wheelchair.find(key) ?? hygiene.find(key);
      if (a) {
        target = a.target;
        center = a.center;
      }
    } else {
      const it = built.interactables.find((i: Interactable) => i.key === key);
      if (it) {
        target = it.target;
        center = it.center;
      }
    }
    if (target && center && Math.hypot(center.x - controller.pos.x, center.z - controller.pos.y) <= INTERACT_RANGE + 0.6) interactWith(target);
  }

  // ── location reporting ──
  let lastRoom = '';
  let roomCheckAt = 0;
  function reportRoom(now: number) {
    if (now < roomCheckAt) return;
    roomCheckAt = now + 250;
    // the room on your storey ("Floor 2 · Nurses' station"), or the elevator lobby of a car you're in
    const id = floors.roomAt(controller.pos.x, controller.pos.y);
    if (id !== lastRoom) {
      lastRoom = id;
      cb.onLocationChange(id);
    }
  }

  // ── mode switching ──
  /** tests (?debug=1): a camera fixed in the world, looking at a point (screenshots of the third-person body) */
  let debugCam: { pos: THREE.Vector3; at: THREE.Vector3 } | null = null;

  /** dollhouse view: top-down, or a third-person camera zoomed out above the ceiling (not outdoors) */
  let cutaway: boolean | null = null;
  function updateCutaway() {
    const p = camera.position;
    const cut = ws.cutaway() ?? (mode === 'top' || (mode === 'third' && p.y > ceilingAt(p.x, p.z) - 0.08));
    if (cut === cutaway) return;
    cutaway = cut;
    built.tall.visible = !cut;
    built.low.visible = cut;
    // each storey's own dollhouse (floors.ts): yours cut open, the ones above you hidden
    floors.setCutaway(cut);
  }

  function applyMode() {
    const top = mode === 'top';
    cutaway = null;
    updateCutaway();
    avatar.root.visible = mode !== 'first';
    camera.fov = mode === 'first' ? 72 : mode === 'third' ? 64 : 34;
    camera.updateProjectionMatrix();
    crosshair.style.display = top ? 'none' : 'block';
    crosshair.classList.toggle('cursor-mode', controller.cursorMode);
    if (browserDemo && touchTour()) hint.textContent = top ? 'Tap the floor to walk · tap someone to talk' : 'Drag to look · tap the floor to walk · tap someone to talk';
    else hint.textContent = top
      ? 'WASD or click the floor to walk · click people/objects to interact · scroll to zoom · V to switch camera'
      : 'Click to look around · right-click for panels · WASD to move (Shift/double-tap W = run, Space = jump) · E to interact · V camera';
    hintUntil = performance.now() + 8000;
  }
  applyMode();

  // ── resize ──
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    gfx?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  // ── main loop ──
  let raf = 0;
  let last = performance.now();
  let monitorAcc = 0;
  let labelFrame = 0;
  const anchor = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const occlusionCache = new Map<string, boolean>();

  // ── visibility culling: NPCs outside the view aren't drawn and animate at a few Hz; far ones at 10 Hz ──
  const viewFrustum = new THREE.Frustum();
  const viewPV = new THREE.Matrix4();
  const npcSphere = new THREE.Sphere(new THREE.Vector3(), 2.0); // generous: lying, seated and reaching poses
  function updateViewFrustum() {
    camera.updateMatrixWorld();
    viewPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewPV, camera.coordinateSystem, camera.reversedDepth);
  }

  const exitPoint = { x: 0, z: 0, tx: 0, tz: 1 };
  function stepNpcs(dt: number, t: number) {
    const now = performance.now();
    updateViewFrustum();
    // who is where (people avoid people), and the routes asked for since the last frame
    // (in the wheelchair you're a bigger body; parked, it's something to walk round)
    const parked = wheelchair.obstacles();
    const edPlayer = floors.viewLevel === 0 ? wheelchair.steerPlayer() ?? { x: controller.pos.x, z: controller.pos.y } : null;
    const obstacles = [...parked];
    for (const { group } of trolleys.values()) {
      for (const offset of [-0.68, 0, 0.68]) obstacles.push({
        x: group.position.x + offset * Math.sin(group.rotation.y),
        z: group.position.z + offset * Math.cos(group.rotation.y), r: 0.43,
      });
    }
    steer.update(dt, npcs.values(), edPlayer, obstacles);
    if (floors.viewLevel === 0) {
      steer.playerObstacles(controller.people);
    } else {
      controller.people.length = 0;
      for (const p of floors.wardPeople()) {
        if (p.posture === 'lie') continue; // the bed already blocks this space
        controller.people.push({ x: p.x, z: p.z, r: 0.25 });
        if (p.posture === 'sit') {
          controller.people.push({ x: p.x + 0.55 * Math.sin(p.yaw), z: p.z + 0.55 * Math.cos(p.yaw), r: 0.28 });
        }
      }
    }
    for (const st of npcs.values()) {
      let moving = false;
      let speed = 0;
      const amb = st.v.ambient;
      // pushing a wheelchair: stay behind whoever sits in it (they lead along their own path)
      const chair = st.v.escortOf ? npcs.get(st.v.escortOf) : amb?.act === 'push' && amb.look ? npcs.get(amb.look) : undefined;
      const progress = st.v.walkIn ?? st.v.discharge;
      if (st.timedWalk && progress?.until !== undefined) {
        const { since, until } = progress;
        const origin = st.v.discharge?.travelStart ?? since;
        let e = st.timedWalk;
        // Extrapolate only between adjacent live snapshots. Pauses and step sessions use server time.
        const v = lastView!;
        const rate = v.mode === 'realtime' && !v.settings.paused
          ? v.settings.timeScale * (v.player.focus && v.settings.focusSlowdown ? 0.35 : 1)
          : 0;
        const at = gameT + rate * Math.min(0.25, (now - viewReceivedAt) / 1000);
        // Arrive just before the phase ends, leaving time to turn at the bedside or clear the doors.
        const phaseDuration = Math.max(1, (until - origin) * 0.94);
        const fraction = Math.max(0, Math.min(1, (at - origin) / phaseDuration));
        const rider = st.v.walkIn?.mobility === 'wheelchair' || (st.v.role === 'patient' && st.v.discharge?.mobility === 'wheelchair');
        // A player can move and repark the corridor chair after departure. Replan only if
        // its new position actually obstructs the remaining journey.
        if (st.v.role === 'patient' && (parked.length !== e.parked.length || parked.some((p, i) => Math.hypot(p.x - e.parked[i].x, p.z - e.parked[i].z) > 0.01))) {
          e.parked = parked;
          if (st.exitWarning || dischargeOverlap(steer.nav, e.route, rider, e.startYaw, parked, e.s, st.v.walkIn?.mobility === 'stretcher')) {
            startTimedWalk(st, { x: st.pos.x, z: st.pos.y }, st.dest, st.destKey, st.yaw, fraction);
            e = st.timedWalk!;
          }
        }
        const remainingFraction = Math.max(0.0001, 1 - e.startFraction);
        const duration = phaseDuration * remainingFraction;
        const goal = st.exitWarning ? e.s : e.route.length * Math.max(0, (fraction - e.startFraction) / remainingFraction);
        const last = e.s;
        const strideSpeed = e.route.length * rate / duration;
        const pace = Math.max(1.35, strideSpeed * 1.4);
        const jump = !rate || at - e.lastT > Math.max(4, rate);
        const gate = jump ? Infinity : curtains.gate(st.v.id, e.route, last, pace);
        if (jump) e.s = goal;
        else if (goal > last) e.s = Math.min(goal, last + dt * Math.min(pace, gate));
        e.lastT = at;
        const point = exitPoint;
        const trolley = st.v.walkIn?.mobility === 'stretcher';
        dischargePose(e.route, e.s, rider || trolley, e.startYaw, point, trolley ? STRETCHER_PUSH_GAP : PUSH_GAP);
        st.pos.set(point.x, point.z);
        st.yaw = Math.atan2(point.tx, point.tz);
        // An authoritative snapshot can revise the interpolated position slightly. Keep the stride
        // in cadence through those corrections instead of crossfading to idle on every packet.
        moving = !st.exitWarning && rate > 0 && gate > 0.05 && e.s < e.route.length;
        speed = moving ? Math.min(1.8, strideSpeed, gate) : 0;
        e.speed = speed;
        if (e.s >= e.route.length) {
          st.path = null;
          if (!st.v.walkIn?.mobility || st.v.walkIn.mobility === 'walking') st.yaw = st.dest.rot;
        }
      } else if (chair && (st.v.escortOf || chair.v.ambient?.pushedBy === st.v.id)) {
        const fx = Math.sin(chair.yaw);
        const fz = Math.cos(chair.yaw);
        const gap = chair.v.walkIn?.mobility === 'stretcher' ? STRETCHER_PUSH_GAP : PUSH_GAP;
        const tx = chair.pos.x - fx * gap;
        const tz = chair.pos.y - fz * gap;
        moving = chair.timedWalk ? chair.timedWalk.speed > 0 : !!chair.path || Math.hypot(tx - st.pos.x, tz - st.pos.y) > 0.05;
        speed = moving ? (chair.timedWalk?.speed ?? chair.v.ambient?.pace ?? 1.1) : 0;
        // The escort and rider must also remain together after a clock skip or a late join.
        const follow = chair.timedWalk ? 1 : Math.min(1, dt * 8);
        st.pos.set(st.pos.x + (tx - st.pos.x) * follow, st.pos.y + (tz - st.pos.y) * follow);
        st.yaw = lerpAngle(st.yaw, chair.yaw, follow);
        st.path = null;
        steer.cancel(st.v.id);
      } else if (st.path) {
        // steering.ts: eased speed, rounded corners, turn rate capped, people avoided; turns to face the spot, backs into a seat
        const w = steer.step(st, dt);
        moving = w.moving;
        speed = w.speed;
        if (w.arrived) {
          st.path = null;
          if (st.wandering) {
            st.wandering = false;
            st.ch.setPosture('stand');
          } else applyFinalPosture(st);
        }
      } else if (st.v.posture === 'walk' && st.v.visible && now > st.wanderAt) {
        // idle wander near the assigned spot
        st.wanderAt = now + 4000 + Math.random() * 6000;
        const ang = Math.random() * Math.PI * 2;
        const r = 0.8 + Math.random() * 1.8;
        const tx = st.dest.x + Math.cos(ang) * r;
        const tz = st.dest.z + Math.sin(ang) * r;
        if (steer.nav.cellFree(tx, tz, false)) {
          walkTo(st, { x: tx, z: tz, rot: st.yaw }, true);
          st.wandering = true;
        }
      }
      // look at the player when close and idle (or at whoever the crowd's script says)
      const dxp = controller.pos.x - st.pos.x;
      const dzp = controller.pos.y - st.pos.y;
      const dp = Math.hypot(dxp, dzp);
      const seen = amb?.look ? npcs.get(amb.look) : undefined;
      if (seen && !moving && seen !== st) {
        let rel = Math.atan2(seen.pos.x - st.pos.x, seen.pos.y - st.pos.y) - st.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        // standing people turn to face it; seated ones only turn their heads
        // (not while still walking or turning to the spot: steering.ts turns them; capped at 4 rad/s like it)
        const turnThreshold = st.v.discharge?.phase === 'handoff' && amb?.act === 'clipboard' ? 0.05 : 0.9;
        if (!st.path && st.ch.posture === 'stand' && Math.abs(rel) > turnThreshold && amb?.act !== 'crouch' && amb?.act !== 'crouch_talk') st.yaw += Math.max(-4 * dt, Math.min(4 * dt, rel * Math.min(1, dt * 2.5)));
        st.ch.lookYaw = Math.max(-1.2, Math.min(1.2, rel));
        st.ch.lookAtPoint?.(seen.ch.head.getWorldPosition(tmpV));
      } else if (!moving && dp < 3.5 && !(amb?.act && ((amb.crowd && BUSY.has(amb.act)) || amb.act === 'clipboard'))) {
        // (not the busy: the crowd on their phones, papers and laptops; a nurse calling a name off her
        // clipboard, eyes on it and on the room, never turned round to you: contact.ts readClipboard)
        let rel = Math.atan2(dxp, dzp) - st.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        st.ch.lookYaw = Math.abs(rel) < 1.6 ? rel : 0;
        // the eyes on yours: the camera in first person, else your avatar's head
        st.ch.lookAtPoint?.(Math.abs(rel) < 1.6 ? (mode === 'first' ? camera.position : avatar.head.getWorldPosition(tmpV)) : null);
      } else {
        st.ch.lookYaw = 0;
        st.ch.lookAtPoint?.(null);
      }
      // the AI doctor at a bedside: turned to the patient, a hand on the rail, looking at them (care.ts).
      // Arrived = its route done, or stopped near the end of it (people at a bedside can keep a route open)
      const shiftNurse = !!layout.treatmentSpaces && st.v.role === 'nurse';
      if (careNpcs.has(st.v.id) || shiftNurse) {
        const settled = !st.path || (!moving && Math.hypot(st.pos.x - st.dest.x, st.pos.y - st.dest.z) < 0.9);
        let pt: CarePatient | null = null;
        let pd = 2.6;
        if (settled)
          for (const o of npcs.values()) {
            if (shiftNurse && (!st.v.bedsidePatientId || o.v.patientId !== st.v.bedsidePatientId)) continue;
            if (o === st || o.v.role !== 'patient' || o.path || !(o.ch.posture === 'lie' || (o.ch.posture === 'sit' && o.ch.seatKind === 'bed'))) continue;
            const d = Math.hypot(o.pos.x - st.pos.x, o.pos.y - st.pos.y);
            if (d < pd) {
              pd = d;
              pt = carePatient(o.v.id);
            }
          }
        if (npcCare.step(st, pt, dt, settled)) {
          st.ch.lookYaw = 0;
          st.ch.lookAtPoint?.(null);
          // posed at the end of a walk the steering kept open: it's there, the steering lets go of it (else it turns it back)
          if (st.path) {
            steer.cancel(st.v.id);
            st.path = null;
          }
        }
      }
      st.ch.root.position.set(st.pos.x, 0, st.pos.y);
      st.ch.root.rotation.y = st.yaw;
      // a patient on their bed: its backrest where the server's bed position has it, the body on it
      if (st.v.role === 'patient') inBed(st);
      const trip = st.v.walkIn;
      if (trip?.mobility === 'stretcher') {
        let cart = trolleys.get(trip.patientId);
        if (!cart) {
          cart = transportStretcher('ems_cart_' + trip.patientId);
          trolleys.set(trip.patientId, cart);
          scene.add(cart.group);
        }
        const folded = cart.group.getObjectByName('bedStack');
        if (folded) folded.visible = trip.stage === 'return';
        cart.group.position.set(st.pos.x, 0, st.pos.y);
        cart.group.rotation.y = st.yaw + Math.PI;
        cart.group.updateMatrixWorld(true);
        if (trip.stage === 'return') {
          st.ch.root.position.x -= STRETCHER_PUSH_GAP * Math.sin(st.yaw);
          st.ch.root.position.z -= STRETCHER_PUSH_GAP * Math.cos(st.yaw);
        } else {
          st.ch.root.rotation.y = cart.group.rotation.y;
          if (st.ch instanceof AvatarCharacter) st.ch.bed = { rig: cart.rig, pos: { headDeg: 0, reason: 'EMS transport' } };
        }
      } else if (trip?.stage === 'return' && trip.mobility === 'wheelchair') {
        st.ch.root.position.x -= PUSH_GAP * Math.sin(st.yaw);
        st.ch.root.position.z -= PUSH_GAP * Math.cos(st.yaw);
      }
      // on the CT couch: carried up and through the gantry with it; at the chest stand: turned for the lateral (imagingLife.ts)
      const onScanner = st.v.role === 'patient' ? imaging.carry(st) : null;
      if (onScanner) {
        st.ch.root.position.x += onScanner.x;
        st.ch.root.position.y += onScanner.y;
        st.ch.root.position.z += onScanner.z;
        st.ch.root.rotation.y += onScanner.yaw;
      }
      // quiet talk (a murmur): mouth and hands move, no audio
      const murmur = amb?.murmurUntil !== undefined && gameT < amb.murmurUntil ? 0.16 + 0.14 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.9)) : 0;
      st.ch.speaking = talkTest === st.v.id ? 0.25 + 0.25 * Math.sin(t * 11) * Math.sin(t * 3.7) : Math.max(speechLevel(st.v.id), murmur);
      // the mouth shapes of the words themselves, where the voice knows them (?talktest: a line on a loop)
      st.ch.mouth = talkTest === st.v.id ? mouthAt(visemeTimeline(TALK_TEST_LINE), (t % 3.6) / 3.6) : speechMouth(st.v.id);
      npcSphere.center.set(st.pos.x, 0.9, st.pos.y);
      // (from upstairs the ground floor's people are under the slab: not drawn, animated slowly)
      const inView = (noCull || viewFrustum.intersectsSphere(npcSphere)) && !floors.hideNpc(st.pos.x, st.pos.y);
      st.ch.root.visible = st.v.visible && inView;
      // a crowd member who left: gone once they are out of sight (or long gone)
      if (st.leavingAt !== undefined && ((!inView && !st.path) || now - st.leavingAt > (inView ? 60000 : 20000))) {
        removeNpc(st.v.id, st);
        continue;
      }
      // skinning and mixers are the cost: off-screen NPCs catch up 4×/s, distant ones 10×/s; a seated
      // crowd member quietly waiting a few metres off, 20×/s; an emergency in progress always full rate
      const idleCrowd = amb?.crowd && !moving && !st.ch.speaking && dp > 6;
      const every = amb?.urgent ? 0 : !inView ? 0.25 : dp > 26 && !st.ch.speaking ? 0.1 : idleCrowd ? 0.05 : 0;
      const acc = (st.animAcc ?? 0) + dt;
      // wheeled in a chair: seated, no walking clip
      const carried = (!!amb?.pushedBy && st.ch.posture === 'sit') || (!!trip && st.ch.posture === 'lie');
      if (acc >= every) {
        st.ch.update(Math.min(acc, 0.5), t, moving && !carried, carried ? 0 : speed);
        st.animAcc = 0;
      } else st.animAcc = acc;
      if (amb) crowd.frame(st.v.id, st.ch, moving, now);
      const pushTrip = st.v.escortOf ? chair?.v.walkIn : trip?.stage === 'return' ? trip : undefined;
      if (pushTrip?.mobility === 'stretcher' && st.ch instanceof AvatarCharacter && st.ch.root.visible) {
        const cart = trolleys.get(pushTrip.patientId);
        if (cart) gripHandles(st.ch, cart.grips, 1, { x: 0.26, y: 0.92, z: -1.047 });
      }
    }
  }

  // ── first-person head bob from the hidden avatar's own mocap head: bounces in step with the feet ──
  const hb = { y: 0, x: 0, init: false };
  const headPos = new THREE.Vector3();
  function updateHeadBob(dt: number) {
    if (mode !== 'first' || !(avatar as { ready?: boolean }).ready) {
      controller.headBob = null;
      hb.init = false;
      return;
    }
    avatar.head.getWorldPosition(headPos);
    const hy = headPos.y - controller.y;
    const hx = (headPos.x - controller.pos.x) * Math.cos(controller.yaw) - (headPos.z - controller.pos.y) * Math.sin(controller.yaw);
    if (!hb.init) {
      hb.y = hy;
      hb.x = hx;
      hb.init = true;
    }
    // high-pass: take away the slow part (posture, lean into the run), keep the gait oscillation
    const a = Math.min(1, dt * 2.5);
    hb.y += (hy - hb.y) * a;
    hb.x += (hx - hb.x) * a;
    // fades in with speed, so standing still doesn't sway; damped a little (full head motion is a lot on a screen)
    const w = Math.min(1, controller.speed / 1.4);
    controller.headBob = { y: (hy - hb.y) * 0.75 * w, x: (hx - hb.x) * 0.6 * w };
  }

  // ── tag along (observe mode): the med student walks after the followed NPC ──
  let followAt = 0;
  function tagAlong(now: number, dt: number) {
    const st = followId ? npcs.get(followId) : undefined;
    if (!st) return;
    if (controller.steering) {
      // the watcher took the wheel: stop following
      followId = null;
      controller.path = null;
      controller.pathRun = false;
      cb.onFollowEnd?.();
      return;
    }
    const dx = controller.pos.x - st.pos.x;
    const dz = controller.pos.y - st.pos.y;
    const d = Math.hypot(dx, dz);
    // standing next to the doctor: turn smoothly to watch (third person; first person keeps your mouse look)
    if (!controller.path && d < 3.2 && mode !== 'first') controller.facing = lerpAngle(controller.facing, Math.atan2(-dx, -dz), Math.min(1, dt * 4));
    if (now < followAt) return;
    followAt = now + 450;
    if (d < 2.3) {
      controller.path = null;
      return;
    }
    // aim 1.6 m short of the target, on our side of it; jog to catch up when far behind
    const k = d > 0.01 ? 1.6 / d : 0;
    const gx = st.pos.x + dx * k;
    const gz = st.pos.y + dz * k;
    const path = nav.findPath(controller.pos.x, controller.pos.y, gx, gz) ?? nav.findPath(controller.pos.x, controller.pos.y, st.pos.x, st.pos.y);
    if (path && path.length) controller.path = path;
    controller.pathRun = d > 7;
  }

  // ── spatial audio: listener at the player's head, voices at NPC heads, walls muffle ──
  let audioAt = 0;
  let distAt = 0;
  const audioRay = new THREE.Ray();
  const fwd = new THREE.Vector3();
  function spatialAudio(now: number) {
    if (now >= distAt && cb.onNpcDistances) {
      distAt = now + 250;
      const d: Record<string, number> = {};
      for (const st of npcs.values()) d[st.v.id] = Math.round(Math.hypot(st.pos.x - controller.pos.x, st.pos.y - controller.pos.y) * 10) / 10;
      cb.onNpcDistances(d);
    }
    if (now < audioAt) return;
    audioAt = now + 33;
    camera.getWorldDirection(fwd);
    if (mode === 'top') fwd.set(0, 0, -1);
    const lx = controller.pos.x;
    const lz = controller.pos.y;
    const ly = controller.y + 1.62;
    const pose = { x: lx, y: ly, z: lz, fx: fwd.x, fy: mode === 'top' ? 0 : fwd.y, fz: fwd.z };
    sound.frame(now, pose, controller);
    updateSpatialAudio(pose, (key) => {
      const st = npcs.get(key);
      if (!st) return null;
      const y = st.ch.posture === 'lie' ? 0.85 : st.ch.posture === 'sit' ? 1.15 : st.ch.height * 0.92;
      const dx = st.pos.x - lx;
      const dy = y - ly;
      const dz = st.pos.y - lz;
      const d = Math.hypot(dx, dy, dz);
      let occluded = false;
      if (d > 0.6) {
        audioRay.origin.set(lx, ly, lz);
        audioRay.direction.set(dx / d, dy / d, dz / d);
        for (const o of built.occluders) {
          const hit = audioRay.intersectBox(o, tmpV);
          if (hit && hit.distanceTo(audioRay.origin) < d - 0.3) {
            occluded = true;
            break;
          }
        }
      }
      return { x: st.pos.x, y, z: st.pos.y, occluded };
    });
  }

  function placeLabels() {
    labelFrame++;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const camPos = camera.position;
    const nowMs = performance.now();
    for (const st of npcs.values()) {
      const id = st.v.id;
      // the waiting-room crowd has no name tags: nothing to place unless someone just spoke
      const quietCrowd = st.v.ambient?.crowd && !(nowMs - (st.sayAt ?? -1e9) < 9000);
      // (upstairs: no name tags for the people downstairs)
      if (!st.v.visible || quietCrowd || floors.viewLevel !== 0) {
        labels.place(id, 0, 0, false, false);
        continue;
      }
      headAnchor(st.ch, anchor);
      const dist = anchor.distanceTo(camPos);
      proj.copy(anchor).project(camera);
      const onScreen = proj.z < 1 && proj.x > -1.2 && proj.x < 1.2 && proj.y > -1.2 && proj.y < 1.3;
      if (!onScreen) {
        labels.place(id, 0, 0, false, false);
        continue;
      }
      // occlusion by walls (not in cutaway views), refreshed every 4th frame
      let occluded = false;
      if (!cutaway) {
        if (labelFrame % 4 === 0 || !occlusionCache.has(id)) {
          raycaster.set(camPos, anchor.clone().sub(camPos).normalize());
          occluded = false;
          for (const o of built.occluders) {
            const hit = raycaster.ray.intersectBox(o, tmpV);
            if (hit && hit.distanceTo(camPos) < dist - 0.2) {
              occluded = true;
              break;
            }
          }
          occlusionCache.set(id, occluded);
        } else occluded = occlusionCache.get(id)!;
      }
      const sx = ((proj.x + 1) / 2) * w;
      const sy = ((1 - proj.y) / 2) * h;
      const maxTag = mode === 'top' ? 60 : 10.5;
      const showTag = !occluded && st.v.talkable && !(st.v.offRecord && st.v.role === 'visitor') && dist < maxTag;
      const showBubble = !occluded && dist < (mode === 'top' ? 80 : 16);
      const scale = mode === 'top' ? 0.85 : Math.max(0.72, Math.min(1.08, 1.25 - dist / 14));
      labels.place(id, sx, sy, showTag, showBubble, scale);
    }
  }

  function tickScreens(dt: number) {
    monitorAcc += dt;
    if (monitorAcc < 1 / 12) return;
    const step = monitorAcc;
    monitorAcc = 0;
    const blink = Math.floor(performance.now() / 450) % 2 === 0;
    for (const [bay, m] of monitors) {
      const p = monitorPos.get(bay);
      const near = !p || Math.hypot(p.x - controller.pos.x, p.z - controller.pos.y) < 16 || mode === 'top';
      if (near) m.tick(step, blink);
    }
    // ambulance light bar
    const flashing = gameT - lastEmsT < 120;
    const phase = Math.floor(performance.now() / 160) % 4;
    for (const lb of built.lightBars) {
      const mat = lb.material as THREE.MeshLambertMaterial;
      const isRed = mat.color.r > mat.color.b;
      mat.emissiveIntensity = flashing ? ((isRed ? phase < 2 : phase >= 2) ? 2.2 : 0.05) : 0.12;
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const realDt = Math.min(0.5, (now - last) / 1000);
    const dt = Math.min(0.05, realDt);
    last = now;
    const t = now / 1000;
    // bay curtains: the cloth, the colliders the player is about to meet, a route through one held while the hand opens it
    curtains.update(dt);
    controller.update(dt);
    // your hand going out to a button or a curtain (the turn to it first; walking off lets go), the bedside
    gestures.update(dt);
    // doors swinging, drawers sliding, the controlled-drug key on its way (cabinets.ts)
    cabinets.update(dt);
    for (const d of swingDoors) d.update(dt, controller.pos.x, controller.pos.y);
    care.update(dt);
    // beds' backrests along their moves (bedRig.ts; the patients on them follow when they are posed)
    stepRigs(scene, dt);
    // storeys: elevators, the stair door, the ward; then the ride's motion / your hand on a button
    floors.update(dt, t);
    floors.camera(t);
    // (tests: a fixed camera on the third-person body; before the curtains decide what the camera is inside)
    if (debugCam) {
      camera.position.copy(debugCam.pos);
      camera.lookAt(debugCam.at);
    }
    curtains.camera();
    gestures.camera();
    care.camera(camera, dt);
    if (followId) tagAlong(now, dt);
    updateCutaway();
    // steering yourself calls off a walk-to-and-use (so walking past a computer you once clicked never uses it)
    if (controller.steering) pendingInteract = null;
    resolvePending();
    // the wheelchair: where it is, you in it (it moved you in controller.update), its colliders and sound
    wheelchair.frame(dt);
    // avatar (seated in the wheelchair: carried, no walking clip); at the bedside it stands up against the bed (care.ts)
    care.offset(careStep);
    avatar.root.position.set(controller.pos.x + careStep.x, controller.y, controller.pos.y + careStep.z);
    avatar.airborne = controller.grounded ? 0 : 1;
    // the body stays turned to what the hand is on, or to the patient at the bedside, whatever the
    // camera or the tag-along rule did meanwhile (gesture.ts, care.ts; first person: the unseen body)
    const held = gestures.facing ?? care.facing;
    if (held !== null) controller.facing = held;
    avatar.root.rotation.y = controller.facing;
    // (a hand wash's step or walk over to the towels or the bin walks too: hygiene.ts moves you there)
    avatar.update(dt, t, (controller.moving || hygiene.stepping) && !wheelchair.holdsPose, wheelchair.holdsPose ? 0 : hygiene.stepping ? hygiene.stepSpeed : Math.min(controller.speed, 6));
    wheelchair.afterAvatar(dt);
    updateHeadBob(dt);
    // the CT couch, the X-ray tube, the radiographers…, before the patients they carry are placed (imagingLife.ts)
    imaging.update(dt, t);
    stepNpcs(dt, t);
    items.update();
    // at the bedside: lean, look, the hand on the rail and an exam's hand (asked of hands.apply)
    care.apply(dt);
    amenities.update(dt);
    // hand rub, washing, masks: the arms' reach and the fingers (asked of hands.apply)
    hygiene.update(dt);
    hands.apply(dt);
    amenities.afterPose(dt);
    // …then the first-person hands, the water, foam, towel and mask where the hands and camera are now
    hygiene.afterPose(dt);
    gestures.afterPose();
    curtains.afterPose();
    // the nurse's hand turning the controlled-drug key (after her animation)
    cabinets.afterPose();
    ws.frame(dt);
    spatialAudio(now);
    updateFocus();
    tickScreens(realDt);
    reportRoom(now);
    if (gfx) {
      rig?.update();
      rig?.cull(camera, floors.levelOn);
      gfx.render();
    }
    bootTick(now, !!gfx);
    if (startupInputReady) controller.captureOnStart();
    placeLabels();
    // hint fades after first lock/click or timeout
    if (controller.isLocked() && mode !== 'top') hintUntil = Math.min(hintUntil, now + 1500);
    hint.style.opacity = now < hintUntil && inputEnabled ? '1' : '0';
    const needsCapture = mode !== 'top' && !controller.walkOnly && !controller.isLocked();
    // while looking around the game holds the mouse: say how to get it back (Tab: the tablet frees it, App.tsx)
    const controls = browserDemo && touchTour() ? '' : needsCapture
      ? 'Click empty scenery to look around · or drag to look · Esc: settings and controls'
      : controller.isLocked()
        ? 'Tab to use the mouse and open the tablet · Esc: settings and controls'
        : 'Esc: settings and controls';
    if (controlHint.textContent !== controls) controlHint.textContent = controls;
    controlHint.hidden = !inputEnabled || !controls;
  }
  frame();
  void createGfx(container, scene, camera, preferredQuality())
    .then((g) => {
      if (disposed) {
        g.dispose();
        return;
      }
      gfx = g;
      const el = g.renderer.domElement;
      el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
      container.insertBefore(el, canvas);
      rig = buildLighting(g.renderer, scene, built, { shadows: g.shadows, fewLights: g.quality === 'low', gi: g.quality === 'high' || g.quality === 'ultra', building: { width: layout.width, depth: layout.depth, height: layout.wallHeight } });
      const night = isNight ?? true;
      isNight = null;
      setNight(night);
      console.info(`[world] renderer ${g.backend} · quality ${g.quality}`);
    })
    .catch((e) => {
      console.error('[world] renderer failed to start', e);
      if (browserDemo && !disposed) {
        boot.done = true;
        cb.onLoading?.({ stage: '', progress: 0, done: false, error: 'The 3D tour needs WebGL 2 or WebGPU. Try enabling graphics acceleration in your browser.' });
      }
    });
  // test/automation hook (?debug=1): put the player somewhere without walking
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__acWorld = {
      listItems: () => [...items.items.values()].map((i) => ({ id: i.id, kind: i.kind, label: i.label, caseItemId: i.caseItemId, x: i.root.position.x, y: i.root.position.y, z: i.root.position.z })),
      pickUp: (id: string) => items.interact(id),
      inspectSubject: (subject: string) => items.inspectSubject(subject),
      /** what's in your hands, the coffee machines, drinks, the chair you sit on (amenities.ts) */
      amenities: () => amenities.debugState(),
      /** use an amenity by id: 'coffee:caf_coffee', 'sit:caf_chair_3', 'bin:hub_trash', 'vend', 'rub:ex1_rub', 'stand' */
      use: (id: string) => wheelchair.interact(id) || hygiene.interact(id) || amenities.interact(id),
      /** hygiene.ts: what you're doing (rub, wash, maskOn/Off), the mask, the isolation stands */
      hygiene: () => hygiene.debugState(),
      /** hygiene.ts debugOp: 'hold' (an act at t s), 'precautions' ({ bed_4: 'droplet' }), 'targets', 'fixtures' */
      hygieneOp: (op: string, arg?: unknown) => hygiene.debugOp(op, arg),
      sipNow: () => amenities.sipNow(),
      /** the wheelchair (wheelchair.ts): pose, speed, wheels, strokes; the rider in the chair's frame (m) */
      wheelchair: () => wheelchair.debug(),
      dischargeRouteAudit(id: string) {
        const st = npcs.get(id);
        const walk = st?.timedWalk;
        if (!st || !walk) return st?.exitWarning ?? `No exit route for ${id}`;
        // Independently check the room's rendered leaves, so deleting their collider cannot
        // silently delete them from both the planner and its clearance test.
        const bed = lastView?.board.find(row => row.id === st.v.patientId)?.bed;
        const room = layout.rooms.find(r => r.id === bed);
        if (room) for (const door of room.doors) for (const leaf of openDoorLeaves(room, door)) {
          if (!nav.colliders.some(box => box.equals(leaf))) return `${room.label} has a rendered door leaf missing from navigation`;
        }
        return dischargeOverlap(steer.nav, walk.route, st.v.discharge?.mobility === 'wheelchair' || st.v.walkIn?.mobility === 'wheelchair', walk.startYaw, wheelchair.obstacles(), 0, st.v.walkIn?.mobility === 'stretcher') ?? null;
      },
      /** the rider's skinned surface against the seat, backrest, footplates and side frame (m; < 0 = into it) */
      wheelchairClearance: (detail = false) => wheelchair.clearance(detail),
      /** put the wheelchair (with you, if you're in it) at x, z facing headingDeg (0 = +z) */
      wheelchairTo: (x: number, z: number, headingDeg = 0, y?: number) => wheelchair.moveTo(x, z, headingDeg, y),
      /** what the wheelchair would bump into near (x, z): colliders as [minX, minZ, maxX, maxZ] */
      collidersNear: (x: number, z: number, r = 1) => wheelchair.collidersNear(x, z, r),
      /** amenities.ts debugOp: 'fill' (0..1), 'pose' (lip, rim, hips, feet…), 'markers', 'hold' (a sip at t s), 'targets', 'cam' (a framed shot) */
      amenity: (op: string, arg?: unknown) => amenities.debugOp(op, arg),
      putDown: () => items.putDownAimed(),
      /** turn the camera without turning the body (third person: yaw = facing looks at the avatar's front) */
      look(yawDeg: number, pitchDeg = -8, dist?: number) {
        controller.resetLookTracking();
        controller.yaw = (yawDeg * Math.PI) / 180;
        controller.pitch = (pitchDeg * Math.PI) / 180;
        if (dist) controller.thirdDist = dist;
      },
      focus: () => (focus ? { key: focus.key, label: focus.target.label } : null),
      teleport(x: number, z: number, yawDeg = 0, pitchDeg?: number) {
        controller.resetLookTracking();
        controller.path = null;
        controller.pos.set(x, z);
        controller.yaw = (yawDeg * Math.PI) / 180 - Math.PI;
        controller.facing = (yawDeg * Math.PI) / 180;
        if (pitchDeg !== undefined) controller.pitch = (pitchDeg * Math.PI) / 180;
      },
      /** movement + camera state for tests (speed m/s, height above the floor, cutaway view, avatar clip) */
      state: () => ({
        x: controller.pos.x,
        z: controller.pos.y,
        y: controller.y,
        grounded: controller.grounded,
        speed: controller.speed,
        moving: controller.moving,
        camY: camera.position.y,
        yaw: controller.yaw,
        pitch: controller.pitch,
        facing: controller.facing,
        cutaway: !!cutaway,
        follow: followId,
        cursorMode: controller.cursorMode,
        clip: (avatar as { clip?: string }).clip ?? null,
        toes: (avatar as { toesWorld?: () => [number, number, number][] }).toesWorld?.() ?? [],
        bob: controller.headBob,
      }),
      /** the player's body for tests: facing, feet, shoulder/elbow/wrist joints (world m) */
      body() {
        const r = avatar.root;
        r.updateMatrixWorld(true);
        const at = (re: RegExp) => {
          let hit: THREE.Object3D | undefined;
          r.traverse((o) => {
            if (!hit && re.test(o.name)) hit = o;
          });
          return hit ? (hit.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number]) : null;
        };
        return { x: controller.pos.x, z: controller.pos.y, y: controller.y, facing: controller.facing, rootYaw: r.rotation.y, yaw: controller.yaw, mode, moving: controller.moving, LS: at(/_L_UpperArm$/), RS: at(/_R_UpperArm$/), LE: at(/_L_Forearm$/), RE: at(/_R_Forearm$/), LH: at(/_L_Hand$/), RH: at(/_R_Hand$/), head: at(/_Head$/) };
      },
      /** an NPC's pose for tests: where it is, how it sits, where its toes and pelvis are (m) */
      npc(id: string) {
        const st = npcs.get(id);
        if (!st) return null;
        const pel = st.ch.root.getObjectByName('Bip01_Pelvis')?.getWorldPosition(new THREE.Vector3());
        const hd = st.ch.head.getWorldPosition(new THREE.Vector3()); // close-ups of faces (casting checks)
        return { x: st.pos.x, z: st.pos.y, yaw: st.yaw, posture: st.ch.posture, visible: st.v.visible, drawn: st.ch.root.visible, walking: !!st.path, seatKind: st.ch.seatKind, location: st.v.location, spot: st.v.spot, clip: (st.ch as { clip?: string }).clip ?? null, toes: (st.ch as { toesWorld?: () => [number, number, number][] }).toesWorld?.() ?? [], pelvis: pel ? [pel.x, pel.y, pel.z] : null, head: [hd.x, hd.y, hd.z], height: st.ch.height, step: st.stepAt ?? null };
      },
      npcIds: () => [...npcs.keys()],
      /** the CT suite and the X-ray room (imagingLife.ts): each one's study and step, couch, tube, lights, radiographers */
      imaging: () => imaging.debug(),
      /**
       * visual QA (visualAudit.ts, docs/VISUAL_QA.md): audit({ x, z, r }) measures bodies and loose items
       * near (x, z): support under each body segment and item, skin inside static geometry, pushers' hands
       * on the handles; bones('player' | npc id) gives the key joints in world space
       */
      ...(() => {
        const qa = createVisualAudit({
          scene,
          staticRoots: () => [built.root, ...Array.from(trolleys.values(), c => c.group), ...scene.children.filter((o) => o.name === 'floors')],
          player: () => ({ ch: avatar, x: controller.pos.x, z: controller.pos.y, y: controller.y, moving: controller.moving, airborne: !controller.grounded, visible: avatar.root.visible }),
          npcs: () => npcs.values(),
          items: () => ({ all: items.items.values(), held: items.heldItems() }),
          props: () => layout.props,
        });
        return { audit: qa.run, bones: qa.bones, propOf: qa.prop };
      })(),
      /** bay curtains (curtains.ts): curtains(), curtain(id, 'open' | 'closed' | 'rule'), curtainAudit(), curtainMode(), curtainHands() */
      ...curtains.debugApi(),
      /** click-to-walk to (x, z) on the floor, as a top-down click does */
      walkTo: (x: number, z: number) => walkPlayerTo(x, z),
      /** NPC walking (steering.ts): per-frame steering cost, planning cost, walkers; `reset` starts a fresh window */
      navStats: (reset = false) => {
        const s = steer.stats();
        if (reset) steer.resetStats();
        return { ...s, sharp: steer.nav.stats.sharp, corners: steer.nav.stats.corners, fallback: steer.nav.stats.fallback };
      },
      /** the route an NPC walks now (every 3rd sample), for plots */
      navRoute: (id: string) => {
        const r = steer.routeOf(id);
        if (!r) return null;
        const pts: [number, number][] = [];
        for (let i = 0; i < r.n; i += 3) pts.push([r.px[i], r.pz[i]]);
        return { length: r.length, head: r.head, tail: r.tail, pts, corners: r.corners, radii: r.radii, fallback: !!r.fallback };
      },
      /** furniture footprints NPCs walk round, and everyone as an obstacle right now */
      navFootprints: () => built.navFootprints,
      /** walks that found no NPC route (who, from, to, why: start / goal / path) */
      navMisses: () => steer.misses,
      /** send an NPC walking (stress tests): standing at the end, facing yawDeg */
      walkNpc: (id: string, x: number, z: number, yawDeg = 0) => {
        const st = npcs.get(id);
        if (!st) return floors.ward?.errands.go(id, x, z, yawDeg * Math.PI / 180) ?? false;
        st.ch.setPosture('stand');
        walkTo(st, { x, z, rot: (yawDeg * Math.PI) / 180 }, true);
        return true;
      },
      /** lay an NPC on the bed or stretcher at (x, z), head the bed's way (tests: a patient on a resus stretcher; client-side, stays until the server moves it) */
      layNpc: (id: string, x: number, z: number, rotDeg = 0) => {
        const st = npcs.get(id);
        if (!st) return false;
        steer.cancel(id);
        st.path = null;
        st.dest = { x, z, rot: (rotDeg * Math.PI) / 180 };
        st.pos.set(x, z);
        st.yaw = st.dest.rot;
        st.surfaceY = surfaceAt(x, z) ?? 0.64;
        st.ch.setPosture('lie', st.surfaceY);
        return true;
      },
      /** send a seated NPC to sit somewhere else (tests: a seat someone takes); it stays until the server moves it */
      sitNpc: (id: string, x: number, z: number, yawDeg = 0) => {
        const st = npcs.get(id);
        if (!st || st.v.posture !== 'sit') return false;
        st.dest = { x, z, rot: (yawDeg * Math.PI) / 180 };
        walkTo(st, st.dest);
        st.ch.setPosture('stand');
        return true;
      },
      /** the workstation login: phase, LED, sign-in screen, seated, camera, the monitor's screen quad (workstation.ts) */
      workstation: (opts?: { slow?: number; use?: string }) => ws.debug(opts),
      /** storeys (floors.ts): your storey and room, the elevators' cars and calls, the ward's people, the stair door */
      floors: () => floors.debug(),
      /** the last frame's draw calls and triangles (performance work) */
      renderStats: () => {
        const r = gfx?.renderer.info.render as { drawCalls?: number; calls?: number; triangles?: number } | undefined;
        return r ? { calls: r.drawCalls ?? r.calls ?? 0, triangles: r.triangles ?? 0 } : null;
      },
      /** press an elevator button: 'elev:east:call:0' (hall, Floor 1), 'elev:east:car:A' (car A's panel) */
      press: (id: string) => floors.use(id),
      /** E on a curtain: 'curtain:bed_2' (curtains.ts; within reach or not) */
      useCurtain: (id: string) => curtains.use(id),
      /** cupboards, drawers, carts (cabinets.ts): cabinets() the state; useCabinet(key) is E on one; cabinetOp('audit' | 'snap' | 'reseal' | 'grab', arg) */
      cabinets: () => cabinets.debug(),
      useCabinet: (key: string) => cabinets.use(key),
      inspectCabinet: (key: string) => cabinets.inspect(key),
      cabinetOp: (op: string, arg?: unknown) => cabinets.debugOp(op, arg),
      /** the player's hand on a button or a curtain (gesture.ts): arm, turning, facing at the press (degrees) */
      gesture: () => gestures.debug(),
      /** the bedside (care.ts): open the tablet for an NPC (null closes it), go to see a ward patient, an exam, the pose, skin clearances */
      careTablet: (id: string | null) => care.setTablet(id),
      careVisit: (id: string) => care.visit(id),
      /** the ward's patients (ids for careVisit) */
      wardPatients: () => floors.wardPatients().map((p) => ({ id: p.id, x: p.x, z: p.z, level: p.level })),
      careExam: (maneuver: string) => care.exam(maneuver),
      care: () => care.debug(),
      careClearance: () => care.clearance(),
      /** where the bedside pose aims on a patient in bed: the gaze's face, the chest, exams' points (care.ts) */
      careTargets: (id: string) => care.targets(id),
      /** the beds (bedRig.ts): each one's backrest now and where it is going (degrees); bedHold: keep one at an angle (null lets go) */
      beds: () => bedDebug(scene),
      bedHold: (id: string, deg: number | null, snap = false) => holdBed(scene, id, deg, snap),
      /** a patient in bed (bedRig.ts inBedReport): the trunk against the backrest, the hips at its crease, the skin clear of the bed, the blanket over it */
      inBed: (id: string) => {
        const ch = npcs.get(id)?.ch ?? floors.wardPatients().find((p) => p.id === id)?.ch;
        const av = ch as AvatarCharacter | undefined;
        if (!av?.bed || !('blanketDump' in av)) return null;
        return { ...inBedReport(av.root, av.bed.rig, av.blanketDump(), care.targets(id)), server: npcs.get(id)?.v.bedPosition ?? av.bed.pos ?? null, posture: av.posture, fit: av.bedFit };
      },
      /** the AI doctor's bedside pose (observe mode); careNpc(id) lets another NPC take it (tests: the same code path without an agent) */
      npcCare: (id = 'ai_doctor') => npcCare.debug(id),
      careNpc: (id: string) => careNpcs.add(id).size,
      npcExam: (id: string, maneuver: string) => npcCare.exam(id, maneuver),
      /** put an NPC standing at (x, z) facing yawDeg, its walk done there (tests; client-side, until the server moves it) */
      standNpc: (id: string, x: number, z: number, yawDeg = 0) => {
        const st = npcs.get(id);
        if (!st) return false;
        steer.cancel(id);
        st.path = null;
        st.dest = { x, z, rot: (yawDeg * Math.PI) / 180 };
        st.pos.set(x, z);
        st.yaw = st.dest.rot;
        st.ch.setPosture('stand');
        return true;
      },
      /** a fixed camera at [x, y, z] looking at [x, y, z] (null: the normal camera); third-person body stays drawn */
      cam: (pos: [number, number, number] | null, at?: [number, number, number]) => {
        debugCam = pos && at ? { pos: new THREE.Vector3(...pos), at: new THREE.Vector3(...at) } : null;
      },
      /** teleport onto a storey: feet at y (0 = ground floor, 3 = Floor 2) */
      teleportY(x: number, z: number, y: number, yawDeg = 0, pitchDeg?: number) {
        controller.resetLookTracking();
        controller.path = null;
        controller.pos.set(x, z);
        controller.y = y;
        controller.yaw = (yawDeg * Math.PI) / 180 - Math.PI;
        controller.facing = (yawDeg * Math.PI) / 180;
        if (pitchDeg !== undefined) controller.pitch = (pitchDeg * Math.PI) / 180;
      },
    };
  }
  let debugTimer: ReturnType<typeof setInterval> | undefined;
  if (new URLSearchParams(location.search).has('wdebug')) {
    setTimeout(() => {
      const i = gfx?.renderer.info;
      console.info(`[world] backend=${gfx?.backend} quality=${gfx?.quality} draw calls=${i?.render.drawCalls ?? i?.render.calls} triangles=${i?.render.triangles} npcs=${npcs.size} focus=${focus?.key ?? 'none'} pos=${controller.pos.x.toFixed(2)},${controller.pos.y.toFixed(2)} room=${lastRoom}`);
    }, 4000);
    debugTimer = setInterval(() => console.info(`[world] focus=${focus?.key ?? 'none'} pos=${controller.pos.x.toFixed(2)},${controller.pos.y.toFixed(2)} room=${lastRoom} path=${controller.path?.length ?? 0}`), 1500);
  }

  const api: WorldApi = {
    // Take a manual checkpoint after a hand action commits (e.g. a cup leaves the
    // vending machine or used gloves are binned). Brewing and clinical timers can run across saves.
    setLockerContents: items => cabinets.setLockerContents(items),
    readyForSave: () => !amenities.handAction && !hygiene.handAction && !gestures.active,
    snapshot() {
      const people = Array.from(npcs.values(), n => {
        const to = n.path?.at(-1);
        return {
          id: n.v.id, x: n.pos.x, z: n.pos.y, yaw: n.yaw, destKey: n.destKey, wandering: n.wandering,
          wanderIn: n.wanderAt - performance.now(), walkingTo: to ? { x: to.x, z: to.y } : undefined
        };
      });
      return {
        x: controller.pos.x, y: controller.y, z: controller.pos.y, facing: controller.facing,
        npcs: people, ward: floors.ward?.snapshot(),
        yaw: controller.yaw, pitch: controller.pitch, zoom: controller.zoom, usedGloves: hygiene.usedGloves, items: items.snapshot(), cabinets: cabinets.snapshot(),
        amenities: amenities.snapshot(), wheelchair: wheelchair.snapshot(), lift: floors.lift?.snapshot(), curtains: curtains.snapshot()
      };
    },
    restore(saved) {
      hygiene.usedGloves = saved.usedGloves;
      controller.zoom = saved.zoom;
      if (saved.lift) floors.lift?.restore(saved.lift);
      lastRoom = lastView?.player.location ?? '';
      roomCheckAt = 0;
      controller.pos.set(saved.x, saved.z);
      controller.y = saved.y;
      controller.yaw = saved.yaw;
      controller.pitch = saved.pitch;
      controller.facing = saved.facing;
      const objects = amenities.restore(saved.amenities);
      cabinets.restore(saved.cabinets, objects);
      items.restore(saved.items, objects);
      amenities.restoreSeat(saved.amenities.seated);
      wheelchair.restore(saved.wheelchair);
      curtains.restoreSave(saved.curtains);
      if (saved.ward) floors.ward?.restore(saved.ward);
      for (const row of saved.npcs) {
        const n = npcs.get(row.id);
        if (!n || n.timedWalk) continue; // discharge routes follow the restored clinical clock
        n.pos.set(row.x, row.z);
        n.yaw = row.yaw;
        n.wanderAt = performance.now() + row.wanderIn;
        const same = row.destKey === n.destKey;
        n.wandering = same && row.wandering;
        const to = same ? row.walkingTo : n.dest;
        if (to) {
          n.ch.setPosture('stand');
          walkTo(n, { ...to, rot: n.dest.rot }, n.wandering);
        }
      }
    },
    update(view: PlayerView) {
      lastView = view;
      items.sync(view.items);
      const hhmm = clockAt(view.clockStart, view.t);
      for (const c of built.details.clocks) drawClock(c, hhmm);
      floors.setClock(hhmm);
      // rooms with opening hours (outpatient clinic) are dark when closed
      rig?.setClock(Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5)) / 60);
      gameT = view.t;
      viewReceivedAt = performance.now();
      syncNpcs(view);
      curtains.view(view);
      hygiene.view(view);
      // an exam: the hand to the region examined (yours, or the AI doctor's when watching one)
      care.view(view);
      npcCare.view(view, 'ai_doctor', (pid) => view.npcs.find((n) => n.patientId === pid && n.role === 'patient')?.id ?? null);
      for (const [bay, m] of monitors) m.set(view.monitors?.[bay]);
      board.update(view.board, view.t, view.clockStart);
      const [hh] = clockAt(view.clockStart, view.t).split(':').map(Number);
      setNight(hh >= 20 || hh < 7);
      sound.view(view);
      imaging.view(view);
    },
    setCameraMode(m: CameraMode) {
      if (m === mode) return;
      mode = m;
      controller.setMode(m);
      applyMode();
    },
    setInputEnabled(enabled: boolean) {
      api.setInputMode(enabled ? 'full' : 'none');
    },
    endInspect() {
      if (items.isInspecting()) items.close();
    },
    setLook(look) {
      controller.setLook(look);
    },
    playerPosition() {
      return { x: controller.pos.x, z: controller.pos.y, room: lastRoom };
    },
    setCare(npcId: string | null) {
      // the tablet open for a patient in bed: you turn to them at the bedside (care.ts)
      care.setTablet(npcId);
    },
    setFollow(id: string | null) {
      followId = id;
      followAt = 0;
      controller.pathRun = false;
      if (id) {
        hint.textContent = 'Tagging along · WASD to walk off on your own (Shift or double-tap W to run, Space to jump)';
        hintUntil = performance.now() + 6000;
      } else controller.path = null;
    },
    setInputMode(m) {
      // a workstation login holds the input until you have stood up again (then this mode applies)
      inputMode = m;
      if (ws.holdsInput(m)) return;
      const enabled = m !== 'none';
      inputEnabled = enabled;
      controller.setInputMode(m);
      if (boot.done && startingLook) {
        controller.adoptStartupCapture(startingLook.finish(m === 'full' && controller.mode !== 'top'));
        startingLook = undefined;
      }
      if (boot.done && !(browserDemo && touchTour())) startupInputReady = true;
      if (!enabled) pendingInteract = null;
      crosshair.style.visibility = enabled ? 'visible' : 'hidden';
      if (m === 'walk') {
        hint.textContent = browserDemo && touchTour() ? 'Close the tablet to keep exploring' : 'Tablet open: click the scene, then WASD to walk · drag to look · click someone (or E) to talk to them';
        hintUntil = performance.now() + 7000;
      } else applyMode();
    },
    workstation: ws,
    say(npcId: string, text: string) {
      labels.say(npcId, text);
      const st = npcs.get(npcId);
      if (st) st.sayAt = performance.now();
    },
    dispose() {
      startingLook?.cancel();
      cancelAnimationFrame(raf);
      ro.disconnect();
      controller.dispose();
      labels.dispose();
      crosshair.remove();
      hint.remove();
      controlHint.remove();
      if (debugTimer) clearInterval(debugTimer);
      disposed = true;
      Object.assign(lm, prevLm); // loading-screen hooks
      imaging.dispose();
      sound.dispose();
      for (const st of npcs.values()) st.ch.dispose?.();
      crowd.dispose();
      avatar.dispose?.();
      rig?.dispose();
      amenities.dispose();
      hygiene.dispose();
      window.removeEventListener('keydown', onMaskKey);
      wheelchair.dispose();
      cabinets.dispose();
      ws.dispose();
      floors.dispose();
      curtains.dispose();
      gestures.dispose();
      care.dispose();
      npcCare.dispose();
      disposeRigs(scene);
      hands.dispose();
      items.dispose();
      // all geometries/materials/textures were created through the caches in ./materials
      disposeCaches();
      gfx?.dispose();
      canvas.remove();
      void lastView;
    },
  };
  return api;
}

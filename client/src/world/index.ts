import type { WorldSave } from '../../../shared/saveGame';
/**
 * 3D world contract. The React app only talks to the world through this interface,
 * so the renderer can be swapped (e.g. WebGPU, Godot export) without touching UI code.
 */
import type { LayoutDef } from '../../../shared/layout';
import type { CameraMode, HygieneKind, PlayerView } from '../../../shared/types';

export type InteractTarget =
  | { kind: 'npc'; npcId: string; label: string }
  /** a workstation (workstation.ts): bedside = the bay whose patient it opens on, section = AgentChart section */
  | { kind: 'computer'; propId: string; label: string; bedside?: string; section?: string }
  | { kind: 'phone'; propId: string; label: string }
  | { kind: 'board'; label: string }
  | { kind: 'monitor'; bay: string; label: string }
  /** a small object you can pick up / inspect (decor or a patient's belongings) */
  | { kind: 'item'; itemId: string; label: string }
  /** equipment you can look at in place (crash cart, wheelchair…) — subject keys FIXTURE_INFO */
  | { kind: 'inspect'; subject: string; label: string }
  /** something you use in the world (amenities.ts: coffee, a café chair, a bin, the vending machine, hand rub; or putting down what you hold) */
  | { kind: 'use'; id: string; label: string };

export interface WorldCallbacks {
  /** player pressed E (or clicked) on a target */
  onInteract(target: InteractTarget): void;
  onOpenLocker?(): void;
  /** the room the player stands in changed (room id from the layout) */
  onLocationChange(roomId: string): void;
  /** nearest/aimed interactable changed — drives the "[E] Talk to …" prompt (null = none) */
  onFocusTarget(target: InteractTarget | null): void;
  /** camera mode changed from inside the world (V key) */
  onCameraChange(mode: CameraMode): void;
  /** distances (m) from the player to each NPC, a few times per second (earshot, tablet UI) */
  onNpcDistances?(d: Record<string, number>): void;
  /** an object/equipment is being inspected (null = closed); belongings carry a caseItemId */
  onInspect?(info: { title: string; desc: string; caseItemId?: string; closeUp: boolean } | null): void;
  /** the browser took the pointer lock back (Esc, focus lost), not the world releasing it for a panel */
  onPointerRelease?(): void;
  /** tag-along ended from inside the world (the watcher started steering) */
  onFollowEnd?(): void;
  /** hand hygiene or a mask, done (hygiene.ts): the app records it on the server ('hygiene' action, 0 min) */
  onHygiene?(kind: HygieneKind, at: string): void;
  /** a patient's belonging handed back to them (itemSystem.ts): the app tells the server ('give_item' action) */
  onGiveItem?(itemId: string): void;
  /**
   * a staff member says something because of what you do in the world, off the record (the cafeteria's
   * cashier asking for the coffee: payment.ts). The app has the server voice it for this player only;
   * false = it couldn't (the world shows the speech bubble itself)
   */
  onAside?(npcId: string, text: string): boolean;
  /** start-up progress for the loading screen; the last call has done = true (first clean frames are on screen) */
  onLoading?(s: LoadingState): void;
  /**
   * a workstation login: 'check' = may the player log in now (false refuses); 'begin' = it starts
   * (the player sits down). AgentChart itself opens through onInteract when the zoom reaches the monitor.
   */
  onWorkstation?(phase: 'check' | 'begin', target: Extract<InteractTarget, { kind: 'computer' }>): boolean | void;
}

export type WorkstationPhase = 'idle' | 'enter' | 'handoff' | 'open' | 'exit';

/** what the AgentChart UI needs from a workstation login (ui/EhrTransition.tsx) */
export interface WorkstationUi {
  /** enter = sitting down and signing in; handoff = the zoom reached the monitor; open = the UI has it; exit = signing out */
  phase(): WorkstationPhase;
  /** the signed-in monitor's screen corners in client px: top-left, top-right, bottom-right, bottom-left */
  screenQuad(): [number, number][] | null;
  /** how long the UI takes to grow out of (in) or shrink into (out) the monitor; 0 = at once */
  morphMs(dir: 'in' | 'out'): number;
  /** the UI covers the monitor (open), has shrunk back into it (closed), or went away at once (abort) */
  ui(state: 'open' | 'closed' | 'abort'): void;
}

/** What the world is doing before the first clean frame: progress 0–1 and a short step name. */
export interface LoadingState {
  stage: string;
  progress: number;
  done: boolean;
  error?: string;
}

export interface WorldApi {
  readyForSave(): boolean;
  setLockerContents(items: readonly string[]): void;
  snapshot(): WorldSave;
  restore(state: WorldSave): void;
  /** push the latest server view (NPC positions/postures, monitors, tracking board, clock) */
  update(view: PlayerView): void;
  setCameraMode(mode: CameraMode): void;
  /** disable movement/look (and release pointer lock) while a UI panel is open */
  setInputEnabled(enabled: boolean): void;
  /**
   * full = normal play; walk = a hand-held panel (tablet) is open: WASD + drag-to-look, mouse stays
   * free; none = a full-screen panel (EHR, board) has the input
   */
  setInputMode(mode: 'full' | 'walk' | 'none'): void;
  /**
   * Observe mode "tag along": the player (a med student) walks after an NPC, e.g. 'ai_doctor',
   * with the normal camera. Any WASD input ends it (onFollowEnd). null = off.
   */
  setFollow(npcId: string | null): void;
  /**
   * The patient/staff tablet is open for this NPC (null: closed): at a patient's bed the doctor turns
   * to them, a hand on the rail (world/care.ts)
   */
  setCare?(npcId: string | null): void;
  /** close the object close-up / equipment description (Esc) */
  endInspect(): void;
  /** mouse look: sensitivity multiplier (1 = built-in speed) and inverted vertical axis (ui/lookSettings.ts) */
  setLook(look: { sensitivity: number; invertY: boolean }): void;
  /** where the player stands (meters) and the room id */
  playerPosition(): { x: number; z: number; room: string };
  /** speech bubble above an NPC for a few seconds */
  say(npcId: string, text: string): void;
  /** the workstation login, for the AgentChart UI's zoom in and out of the monitor */
  workstation?: WorkstationUi;
  dispose(): void;
}

export type CreateWorld = (container: HTMLElement, layout: LayoutDef, cb: WorldCallbacks) => WorldApi;

export { createWorld } from './World';

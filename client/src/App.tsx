import { useEffect, useRef, useState } from 'react';
import { LAYOUTS } from '../../shared/layout';
import { client } from './net';
import { isObserving, store, useStore, type Panel } from './store';
import { bindWorldCapture } from './rotation';
import { SaveSlots } from './ui/SaveSlots';
import { Debrief } from './ui/Debrief';
import { Ehr, TrackingBoard } from './ui/ehr/Ehr';
import { LockerPanel } from './ui/LockerPanel';
import { Hud } from './ui/Hud';
import { MainMenu } from './ui/MainMenu';
import { MonitorPanel } from './ui/MonitorPanel';
import { NpcPanel } from './ui/NpcPanel';
import { TabletHome } from './ui/TabletHome';
import { Phone } from './ui/Phone';
import { HelpPanel } from './ui/HelpPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { isFullscreen } from './ui/fullscreen';
import { createWorld, type InteractTarget, type LoadingState, type WorldApi } from './world';
import { LoadingScreen } from './ui/LoadingScreen';
import { InspectCard } from './ui/InspectCard';
import { ObserverPanel } from './ui/Observer';
import { watcherPanelFor, watcherPrompt } from './ui/watcher';
import { WatcherTablet } from './ui/WatcherTablet';
import { DISPENSER_NOTE, EhrTransition, workstationEvent, workstationPanel } from './ui/EhrTransition';
import { DemoMenu, DemoHelp } from './demo/DemoMenu';
import { browserDemo } from './demo/mode';
import { cancelStartupLook } from './startupLook';

export function App() {
  const screen = useStore((s) => s.screen);
  const dialog = useStore(s => s.slotDialog);
  const session = useStore(s => s.view?.sessionId);
  useEffect(() => { if (screen !== 'game') cancelStartupLook(); }, [screen]);
  if (browserDemo) return screen === 'menu' ? <DemoMenu /> : <GameScreen key={session} />;
  return <>
    {screen === 'menu' ? <MainMenu /> : screen === 'debrief' ? <Debrief /> : <GameScreen key={session} />}
    {dialog && <SaveSlots key={dialog} />}
  </>;
}

function panelForTarget(t: InteractTarget): Panel | null {
  switch (t.kind) {
    case 'npc':
      return { kind: 'npc', npcId: t.npcId, tab: 'talk' };
    case 'computer':
      // after the sit-down and badge login (world/workstation.ts): the board, the patient, or the MAR at the med cabinet
      return workstationPanel(t);
    case 'phone':
      return { kind: 'phone' };
    case 'board':
      return { kind: 'board' };
    case 'monitor':
      return { kind: 'monitor', bay: t.bay };
    default:
      // objects and equipment are handled inside the 3D world (pick up / inspect)
      return null;
  }
}

function focusFor(p: Panel | null): 'chat' | 'ehr' | 'phone' | null {
  if (!p) return null;
  if (p.kind === 'npc') return 'chat';
  if (p.kind === 'ehr' || p.kind === 'board' || p.kind === 'tablet') return 'ehr';
  if (p.kind === 'phone') return 'phone';
  return null;
}

/**
 * One Esc press can reach the page twice: as a keydown, and as the browser handing back the pointer
 * lock (which some browsers do instead of passing the key on). Within this window of each other
 * they are the same press, and only the first acts.
 */
const SAME_PRESS_MS = 600;

function GameScreen() {
  const view = useStore((s) => s.view);
  const panel = useStore((s) => s.panel);
  const charts = useStore((s) => s.charts);
  const camera = useStore((s) => s.camera);
  const speech = useStore((s) => s.speech);
  // watching an AI doctor's shift: follow-cam on its avatar, a feed panel, no actions from this tab
  const observing = useStore((s) => s.view?.driver?.kind === 'agent');
  const follow = useStore((s) => s.follow);
  const tabletMin = useStore((s) => s.tabletMin);
  const slotsOpen = useStore(s => !!s.slotDialog);
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<WorldApi | null>(null);
  const following = useRef(false);
  const layoutId = view?.layoutId;
  const lockerItems = useStore(s => s.rotation.items);
  const look = useStore((s) => s.look);
  // the last Esc keydown, the last settings opened by a pointer-lock release, the settings opened by
  // the Esc still held down (performance.now() ms; 0 = none)
  const esc = useRef({ key: 0, release: 0, heldOpened: 0 });
  const [boot, setBoot] = useState<LoadingState>({ stage: 'Starting the graphics engine', progress: 0.04, done: false });

  // create the world once per layout
  useEffect(() => {
    if (!containerRef.current || !layoutId) return;
    const layout = LAYOUTS[layoutId];
    setBoot({ stage: 'Starting the graphics engine', progress: 0.04, done: false });
    const saved = store.get().loadedWorld;
    let restoring = !!saved;
    let ready = false;
    const world = createWorld(containerRef.current, layout, {
      onLoading: state => { ready = state.done; if (state.error) cancelStartupLook(); setBoot(state); },
      onOpenLocker: store.get().solo && !isObserving()
        ? () => store.set({ panel: { kind: 'locker' } }) : undefined,
      onInteract: (t) => {
        // watching an AI doctor: talk to anyone off the record, read the board and charts, never act (ui/watcher.ts)
        const p = isObserving() ? watcherPanelFor(t) : panelForTarget(t);
        if (p) store.set({ panel: p, tabletMin: false });
      },
      onInspect: (info) => store.set({ inspect: info }),
      onLocationChange: (roomId) => {
        // a spectator walking (or the follow-cam moving) must never move the agent
        if (restoring || isObserving()) return;
        if (store.get().view?.player.location !== roomId) void client.act({ type: 'move', to: roomId });
      },
      onFocusTarget: (t) => store.set({ prompt: t ? (isObserving() ? watcherPrompt(t) : `[E] ${t.label}`) : null }),
      onCameraChange: (mode) => store.set({ camera: mode }),
      // the browser took the mouse back: on Esc (when it keeps the key from the page) that opens the
      // settings, as the keydown would have; leaving the window doesn't
      onPointerRelease: () => {
        const s = store.get();
        const now = performance.now();
        if (!ready || now - esc.current.key < SAME_PRESS_MS) return; // the keydown already acted on this press
        if (s.panel || s.inspect || s.slotDialog || document.hidden || !document.hasFocus()) return;
        esc.current.release = now;
        store.set({ panel: { kind: 'settings' } });
      },
      // sitting down at a computer: allowed wherever E on it would open AgentChart (ui/EhrTransition.tsx)
      onWorkstation: (phase, t) => workstationEvent(phase, t, !isObserving() || watcherPanelFor(t) !== null),
      onNpcDistances: (d) => store.set({ distances: d }),
      onFollowEnd: () => {
        following.current = false;
        store.set({ follow: false });
      },
      // a rub, a wash, a mask on or off: on the record (unscored; a spectator's own never touches the agent's shift)
      onHygiene: (kind, at) => {
        if (!isObserving()) void client.act({ type: 'hygiene', kind, at });
      },
      // a belonging handed back to its owner: on the record, and the patient says thank you
      onGiveItem: (itemId) => {
        if (!isObserving()) void client.act({ type: 'give_item', itemId });
      },
      // the cafeteria's cashier asking for (or thanking you for) a coffee: voiced by the server, for you only
      onAside: (npcId, text) => client.aside(npcId, text),
    });
    worldRef.current = world;
    following.current = false;
    world.setCameraMode(store.get().camera);
    const v = store.get().view;
    if (v) world.update(v);
    if (saved) world.restore(saved);
    restoring = false;
    bindWorldCapture(world);
    return () => {
      bindWorldCapture();
      world.dispose();
      worldRef.current = null;
    };
  }, [layoutId]);

  useEffect(() => {
    worldRef.current?.setLockerContents(lockerItems);
  }, [layoutId, lockerItems]);

  useEffect(() => {
    worldRef.current?.setLook(look);
  }, [layoutId, look]);

  // observe mode: the watcher is a med student on the floor. They walk freely (third person to start)
  // and can tag along behind the AI resident (T); steering with WASD ends tagging along.
  useEffect(() => {
    if (observing && store.get().camera !== 'third') store.set({ camera: 'third' });
  }, [observing]);
  useEffect(() => {
    const want = observing && follow;
    if (!worldRef.current || want === following.current) return;
    following.current = want;
    worldRef.current.setFollow(want ? 'ai_doctor' : null);
  }, [observing, follow, layoutId]);

  useEffect(() => {
    if (view) worldRef.current?.update(view);
  }, [view]);

  useEffect(() => {
    worldRef.current?.setCameraMode(camera);
  }, [camera]);

  useEffect(() => {
    // the patient/staff panel is a hand-held tablet: you can keep walking with it open, or tuck it
    // away at the screen edge and play normally
    const tucked = panel?.kind === 'npc' && tabletMin;
    const exploring = panel === null || tucked || panel.kind === 'locker';
    worldRef.current?.setInputMode(!boot.done || slotsOpen ? 'none' : exploring ? 'full' : panel.kind === 'npc' || panel.kind === 'tablet' ? 'walk' : 'none');
    // talking to or examining a patient in bed: the doctor turns to them at the bedside (world/care.ts)
    worldRef.current?.setCare?.(panel?.kind === 'npc' ? panel.npcId : null);
    client.focus(tucked ? null : focusFor(panel));
    if (panel?.kind !== 'npc' && tabletMin) store.set({ tabletMin: false });
  }, [slotsOpen, panel, tabletMin, boot.done]);

  useEffect(() => {
    const world = worldRef.current;
    if (panel?.kind !== 'locker' || !world) return;
    // Opening from the HUD also anchors the collection where you stopped to look at it.
    const start = world.playerPosition();
    const timer = window.setInterval(() => {
      const position = world.playerPosition();
      if (Math.hypot(position.x - start.x, position.z - start.z) >= 1.5 && store.get().panel === panel) {
        store.set({ panel: null });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [panel, layoutId]);

  // speech bubbles
  const lastSpeech = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const [key, s] of Object.entries(speech)) {
      if (lastSpeech.current[key] !== s.at) {
        lastSpeech.current[key] = s.at;
        if (!key.startsWith('phone:')) worldRef.current?.say(key, s.text);
      }
    }
  }, [speech]);

  // global keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (store.get().slotDialog) return;
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape') {
        // holding Esc leaves full screen (ui/fullscreen.ts): its key repeats must not close one thing after another
        if (e.repeat) return;
        const now = performance.now();
        esc.current.key = now;
        esc.current.heldOpened = 0;
        if (now - esc.current.release < SAME_PRESS_MS) {
          // the browser's pointer-lock release already opened the settings for this press
          e.preventDefault();
          return;
        }
        if (store.get().inspect) {
          e.preventDefault();
          worldRef.current?.endInspect();
          return;
        }
        if (store.get().panel) {
          e.preventDefault();
          store.set({ panel: null });
          return;
        }
        // nothing open: the settings (mouse sensitivity, the keys), which free the mouse
        if (typing) return;
        e.preventDefault();
        esc.current.heldOpened = now;
        store.set({ panel: { kind: 'settings' } });
        return;
      }
      if (typing) return;
      if (e.key === 'Tab') {
        // the tablet at your side (AgentChart Mobile): a conversation's tablet tucks away or comes back,
        // else the patient list, from which a patient's full chart opens. (Tab put the department's
        // tracking board full screen anywhere; that is on the workstations and the wall now.)
        e.preventDefault();
        const s = store.get();
        if (s.panel?.kind === 'npc') store.set({ tabletMin: !s.tabletMin });
        else store.set({ panel: s.panel?.kind === 'tablet' ? null : { kind: 'tablet' } });
      } else if ((e.key === 't' || e.key === 'T') && isObserving()) {
        store.set((s) => ({ follow: !s.follow }));
      } else if (e.key === 'p' || e.key === 'P') {
        const v = store.get().view;
        if (v) client.settings({ paused: !v.settings.paused });
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'F1') {
        e.preventDefault();
        store.set((s) => ({ panel: s.panel?.kind === 'help' ? null : { kind: 'help' } }));
      }
    };
    // holding Esc to leave full screen opens the settings with its first keydown: leaving closes them again
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') esc.current.heldOpened = 0;
    };
    const onBlur = () => (esc.current.heldOpened = 0);
    const onFullscreen = () => {
      if (isFullscreen() || !esc.current.heldOpened) return;
      esc.current.heldOpened = 0;
      if (store.get().panel?.kind === 'settings') store.set({ panel: null });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
    };
  }, []);

  // keep charts fresh for whatever patient the open panel concerns
  useEffect(() => {
    if (!view) return;
    if (panel?.kind === 'ehr' || panel?.kind === 'board') {
      for (const row of view.board) if (!charts[row.id]) client.requestChart(row.id);
    }
  }, [panel, view?.board.length]);

  if (!view) return <LoadingScreen state={{ stage: 'Connecting to the hospital', progress: 0.02, done: false }} title="Starting your shift" />;
  const units = view.settings.units;

  return (
    <div className={`game${browserDemo ? ' demo-game' : ''}${observing ? ' observing' : ''}`}>
      <div className="world" ref={containerRef} />
      <Hud />
      <InspectCard />
      {panel?.kind === 'locker' && <LockerPanel />}
      {observing && <ObserverPanel />}
      {panel?.kind === 'npc' && (observing ? <WatcherTablet npcId={panel.npcId} /> : <NpcPanel npcId={panel.npcId} initialTab={panel.tab} />)}
      {panel?.kind === 'tablet' && <TabletHome />}
      {panel?.kind === 'phone' && <Phone initialContact={panel.contactId} />}
      {panel?.kind === 'monitor' && <MonitorPanel bay={panel.bay} />}
      {panel?.kind === 'help' && (browserDemo ? <DemoHelp onClose={() => store.set({ panel: null })} /> : <HelpPanel onClose={() => store.set({ panel: null })} />)}
      {panel?.kind === 'settings' && <SettingsPanel />}
      {panel?.kind === 'board' && (
        <TrackingBoard
          view={view}
          units={units}
          onOpenChart={(pid) => store.set({ panel: { kind: 'ehr', patientId: pid } })}
          onClose={() => store.set({ panel: null })}
          onAction={(a) => client.act(a)}
        />
      )}
      {/* from a workstation, AgentChart grows out of its monitor and shrinks back into it */}
      <EhrTransition world={worldRef.current}>
        {panel?.kind === 'ehr' && (
          <Ehr
            view={view}
            charts={charts}
            units={units}
            initialPatientId={panel.patientId}
            initialSection={panel.section}
            onAction={(a) => client.act(a)}
            onRequestChart={(pid) => client.requestChart(pid)}
            onClose={() => store.set({ panel: null })}
            notice={!browserDemo && panel.section === 'mar' ? DISPENSER_NOTE : undefined}
          />
        )}
      </EhrTransition>
      <LoadingScreen state={boot} title={view.mapTitle} />
    </div>
  );
}

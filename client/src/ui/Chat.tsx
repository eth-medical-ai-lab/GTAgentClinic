import { useEffect, useRef, useState } from 'react';
import type { ChatLine } from '../../../shared/types';
import { browserDemo, touchTour } from '../demo/mode';
import { dictationSupported, startDictation, type Dictation } from './speech';
import { captionForLine, revealed, transcriptKey } from './captions';
import { useStore } from '../store';

// ── push-to-talk ──
// The key under Esc, as in voice-chat apps: ` (US), § (Swiss/German Mac), ^ (German PC). macOS reports
// that key as IntlBackslash on ISO keyboards, so both codes count. Only a bare press (no modifiers).
const PTT_CODES = new Set(['Backquote', 'IntlBackslash']);
export const PTT_KEY_LABEL = '§ / `';
/** a press of the mic button shorter than this is a tap: hands-free, sends at the first pause */
const TAP_MS = 350;
/** hands-free: send once nothing new was heard for this long */
const PAUSE_MS = 1500;
/** hands-free: give up if nothing at all is heard */
const IDLE_MS = 8000;

type Mode = 'hold' | 'tap';
type PttTarget = { visible(): boolean; press(): void; release(): void };
/** mounted chat inputs, newest last: the newest visible one gets the key */
const pttTargets: PttTarget[] = [];
let pttHeld: PttTarget | null = null;
let pttInstalled = false;
function installPtt() {
  if (pttInstalled || typeof window === 'undefined') return;
  pttInstalled = true;
  // capture phase: runs before the focused textarea, so the key never types a character
  window.addEventListener(
    'keydown',
    (e) => {
      if (!PTT_CODES.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const t = pttHeld ?? [...pttTargets].reverse().find((x) => x.visible());
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || pttHeld) return;
      pttHeld = t;
      t.press();
    },
    true,
  );
  const up = () => {
    const t = pttHeld;
    pttHeld = null;
    t?.release();
  };
  window.addEventListener(
    'keyup',
    (e) => {
      if (!PTT_CODES.has(e.code) || !pttHeld) return;
      e.preventDefault();
      e.stopPropagation();
      up();
    },
    true,
  );
  // the key can come up while another window has focus
  window.addEventListener('blur', up);
}

// ── live transcription ──
// An NPC's line appears in the tablet as it is said: in step with the voice (the speech bubble's
// caption, ui/captions.ts), a little behind it like a dictation device, at reading pace with voices off.
const DICTATION_LAG_MS = 450;
/** a line that arrives before its speech event waits this long for the caption, then shows in full */
const CAPTION_WAIT_MS = 700;
/** when each line was first shown in a transcript (wall clock) */
const firstSeen = new Map<string, number>();

function shownText(l: ChatLine, sessionId: string | undefined, now: number, mountedAt: number): { text: string; live: boolean } {
  if (l.speaker !== 'npc' || !sessionId) return { text: l.text, live: false };
  const lineKey = transcriptKey(sessionId, l.id);
  let seen = firstSeen.get(lineKey);
  if (seen === undefined) {
    seen = now;
    firstSeen.set(lineKey, now);
    if (firstSeen.size > 800) firstSeen.delete(firstSeen.keys().next().value!);
  }
  const cap = captionForLine(lineKey);
  if (!cap) {
    // a brand-new line whose speech event is a beat behind: hold it briefly; older lines show in full
    const fresh = seen > mountedAt + 50 && now - seen < CAPTION_WAIT_MS;
    return fresh ? { text: '', live: true } : { text: l.text, live: false };
  }
  const n = revealed(cap, now, DICTATION_LAG_MS);
  return { text: l.text.slice(0, n), live: n < l.text.length };
}

export function Transcript({ lines, typing, placeholder }: { lines: ChatLine[]; typing: boolean; placeholder?: string }) {
  const sessionId = useStore(s => s.view?.sessionId);
  const ref = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(performance.now());
  const [, setTick] = useState(0);
  const now = performance.now();
  const shown = lines.map((l) => shownText(l, sessionId, now, mountedAt.current));
  const live = shown.some((s) => s.live);
  // while a line is being transcribed: redraw ~20×/s and keep the newest words in view
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      const el = ref.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
    return () => window.clearInterval(id);
  }, [live]);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length, typing]);
  return (
    <div className="transcript" ref={ref}>
      {lines.length === 0 && <div className="dim transcript-empty">{placeholder}</div>}
      {lines.map((l, i) => {
        const s = shown[i];
        if (s.live && !s.text) {
          // the reply has arrived but nothing has been said yet: the usual "typing" dots
          return (
            <div key={l.id} className="bubble npc typing">
              <span />
              <span />
              <span />
            </div>
          );
        }
        return (
          <div key={l.id} className={`bubble ${l.speaker}`}>
            {l.speaker === 'npc' && (
              <div className="bubble-name">
                {l.name}
                {s.live && <span className="dictating-note"> · transcribing…</span>}
              </div>
            )}
            <div className={`bubble-text${s.live ? ' dictating' : ''}`}>{s.text}</div>
          </div>
        );
      })}
      {typing && (
        <div className="bubble npc typing">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}

/**
 * Text box + Send + microphone. Voice: hold the mic button or the push-to-talk key while you speak;
 * releasing sends. A short tap on the mic is hands-free: it sends at your first pause. Either way the
 * microphone is off before the reply is spoken, so the NPC's voice never lands in your next message.
 */
export function ChatInput({ onSend, disabled, placeholder }: { onSend: (text: string) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const [mode, setModeState] = useState<Mode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dict = useRef<Dictation | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const pressAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  // latest props/state for callbacks that outlive a render (recognizer events, the global key handler)
  const live = useRef({ onSend, disabled, text });
  live.current = { onSend, disabled, text };
  // Dictated lines and model speech share the visible conversation's busy and distance checks.
  useEffect(() => {
    const speak = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (event.defaultPrevented || live.current.disabled || !rootRef.current?.offsetParent || typeof text !== 'string' || !text.trim()) return;
      event.preventDefault();
      live.current.onSend(text.trim());
    };
    window.addEventListener('ac-doctor-speak', speak);
    return () => window.removeEventListener('ac-doctor-speak', speak);
  }, []);
  const setMode = (m: Mode | null) => {
    modeRef.current = m;
    setModeState(m);
  };
  const clearTimer = () => window.clearTimeout(timer.current);
  const release = () => {
    clearTimer();
    dict.current?.stop(); // → the final transcript arrives in onText(…, true) and is sent
  };
  const cancel = () => {
    clearTimer();
    dict.current?.cancel();
  };
  const arm = (ms: number) => {
    clearTimer();
    timer.current = window.setTimeout(release, ms);
  };
  const begin = (m: Mode) => {
    if (dict.current) return;
    setNote(null);
    setMode(m);
    const typed = live.current.text.trim();
    const base = typed ? `${typed} ` : '';
    let ended = false;
    const recording = startDictation(
      (t, final) => {
        // A silent recording must not submit (or trim) an existing typed draft.
        if (!t.trim()) return;
        const full = (base + t).trim();
        if (!final) {
          if (full) setText(full);
          if (modeRef.current === 'tap') arm(PAUSE_MS); // each new word restarts the pause timer
          return;
        }
        if (full && !live.current.disabled) {
          live.current.onSend(full);
          setText('');
        } else setText(full); // the NPC is still answering: keep it for Send
      },
      (error) => {
        ended = true;
        clearTimer();
        dict.current = null;
        setMode(null);
        if (error === 'not-allowed' || error === 'service-not-allowed') setNote('Microphone blocked: allow it in the browser’s site settings.');
        else if (error === 'audio-capture') setNote('No microphone found.');
        else if (error === 'network') setNote('Dictation needs a connection (the browser does the recognition).');
        else if (error === 'timeout') setNote('Recognition timed out. Review the text, then press Send.');
        else if (error === 'no-speech') setNote('No speech heard. Your draft is unchanged.');
        else if (error) setNote('Dictation stopped. Review the text, then press Send.');
      },
    );
    // Permission/start failures can finish synchronously, before startDictation returns.
    dict.current = ended ? null : recording;
    if (!ended && m === 'tap') arm(IDLE_MS);
  };
  const ptt = useRef({ begin, release, mode: () => modeRef.current });
  ptt.current = { begin, release, mode: () => modeRef.current };

  useEffect(() => {
    // Keep suggested questions visible on a phone until the visitor chooses to type.
    if (!browserDemo || !touchTour()) inputRef.current?.focus();
    if (browserDemo || !dictationSupported()) return;
    installPtt();
    const target: PttTarget = {
      visible: () => !!rootRef.current && rootRef.current.offsetParent !== null,
      press: () => {
        // pressing the key during hands-free dictation just sends now
        if (ptt.current.mode() === 'tap') ptt.current.release();
        else ptt.current.begin('hold');
      },
      release: () => {
        if (ptt.current.mode() === 'hold') ptt.current.release();
      },
    };
    pttTargets.push(target);
    return () => {
      pttTargets.splice(pttTargets.indexOf(target), 1);
      if (pttHeld === target) pttHeld = null;
      window.clearTimeout(timer.current);
      dict.current?.cancel();
    };
  }, []);

  const submit = () => {
    const t = text.trim();
    if (dict.current) cancel(); // Send ends dictation: what's in the box is the message
    if (!t || disabled) return;
    onSend(t);
    setText('');
    setNote(null);
  };
  const micTitle = mode
    ? mode === 'hold'
      ? 'Listening: release to send'
      : 'Listening: sends when you pause (click to send now)'
    : `Hold to talk, release to send (or hold ${PTT_KEY_LABEL}, the key under Esc). Tap for hands-free.`;
  return (
    <>
    {note && <div className="dim" role="status">{note}</div>}
    <div className="chat-input" ref={rootRef}>
      <textarea
        ref={inputRef}
        rows={2}
        value={text}
        placeholder={mode ? (mode === 'hold' ? 'Listening… release to send' : 'Listening… pause to send') : (note ?? placeholder)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // If the player held E when opening the conversation, swallow its auto-repeat on an empty box
          if (e.repeat && e.code === 'KeyE' && !text) {
            e.preventDefault();
            return;
          }
          // Escape leaves the box and goes on to the game's handler, which closes the tablet: one press, not two
          if (e.key === 'Escape') {
            (e.target as HTMLTextAreaElement).blur();
            return;
          }
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="chat-buttons">
        {!browserDemo && dictationSupported() && (
          <button
            className={`btn mic ${mode ? 'listening' : ''}`}
            title={micTitle}
            aria-label={micTitle}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault(); // keep the caret in the text box
              if (dict.current) {
                if (modeRef.current === 'tap') release(); // a second tap sends now
                return;
              }
              pressAt.current = performance.now();
              e.currentTarget.setPointerCapture(e.pointerId);
              begin('hold');
            }}
            onPointerUp={() => {
              if (modeRef.current !== 'hold') return;
              if (performance.now() - pressAt.current < TAP_MS) {
                setMode('tap'); // a tap: keep listening until the first pause
                arm(IDLE_MS);
              } else release();
            }}
            onPointerCancel={() => modeRef.current === 'hold' && release()}
            onKeyDown={(e) => {
              // keyboard users: Enter/Space on the focused button toggles hands-free
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (dict.current) release();
              else begin('tap');
            }}
          >
            {mode ? '■' : '🎤'}
          </button>
        )}
        <button className="btn primary" onClick={submit} disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
    </div>
    </>
  );
}

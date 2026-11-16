/**
 * Card for whatever the doctor is looking at: an object held up to the camera (drag to rotate)
 * or a piece of equipment. A patient's belongings are read through the server's `inspect` action
 * — what you find there counts as history, exactly as if you'd asked.
 */
import { useEffect, useState } from 'react';
import { client } from '../net';
import { useStore } from '../store';

export function InspectCard() {
  const info = useStore((s) => s.inspect);
  const [found, setFound] = useState<{ id: string; text: string; ok?: boolean } | null>(null);
  useEffect(() => {
    if (!info?.caseItemId || found?.id === info.caseItemId) return;
    let live = true;
    const id = info.caseItemId;
    void client.act({ type: 'inspect', itemId: id }).then((r) => {
      if (live) setFound({ id, ok: r.ok, text: r.ok ? (r.text ?? '').replace(/^[^:]+:\s*/, '') : (r.message ?? 'You can\'t make anything out.') });
    });
    return () => {
      live = false;
    };
  }, [info?.caseItemId]);
  if (!info) return null;
  const text = info.caseItemId ? (found?.id === info.caseItemId ? found.text : 'Looking through it…') : info.desc;
  return (
    <div className={`inspect-card ${info.closeUp ? 'close-up' : ''}`}>
      <div className="inspect-title">
        {info.caseItemId && <span className="inspect-tag">Belongings</span>}
        {info.title.charAt(0).toUpperCase() + info.title.slice(1)}
      </div>
      <div className="inspect-text">{text}</div>
      {info.caseItemId && found?.id === info.caseItemId && found.ok && <div className="inspect-note">Noted in the history.</div>}
      <div className="inspect-keys">
        {info.closeUp ? (
          <>
            <kbd>drag</kbd> rotate · <kbd>F</kbd> back to hand · <kbd>G</kbd> put down · <kbd>Esc</kbd> close
          </>
        ) : (
          <>
            <kbd>Esc</kbd> close · or just walk on
          </>
        )}
      </div>
    </div>
  );
}

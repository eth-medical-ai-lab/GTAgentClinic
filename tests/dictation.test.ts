import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDictation } from '../client/src/ui/speech';

class Recognition {
  static current: Recognition;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { Recognition.current = this; }
  result(text: string, final = false) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
  }
}

describe('push-to-talk release after merging speech and demo changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('keeps interim words when the browser ends with an empty result', () => {
    const text = vi.fn(), end = vi.fn();
    const dictation = startDictation(text, end), rec = Recognition.current;
    rec.result('When did the pain start?');
    dictation.stop();
    rec.onresult?.({ resultIndex: 0, results: [] });
    rec.onend?.();
    vi.runAllTimers();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([['When did the pain start?', true]]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('times out after five seconds without sending, and ignores later results from NPC speech', () => {
    const text = vi.fn(), end = vi.fn();
    const dictation = startDictation(text, end), rec = Recognition.current;
    rec.result('Any allergies?');
    dictation.stop();
    vi.advanceTimersByTime(4999);
    expect(end).not.toHaveBeenCalled();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([]);
    vi.advanceTimersByTime(1);
    rec.result('The NPC answers now', true);
    rec.onend?.();
    expect(rec.abort).toHaveBeenCalledOnce();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([]);
    expect(text).toHaveBeenLastCalledWith('Any allergies?', false);
    expect(end).toHaveBeenCalledWith('timeout');
    expect(text).not.toHaveBeenCalledWith('The NPC answers now', expect.anything());
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('uses the final recognition result when it arrives after release', () => {
    const text = vi.fn();
    const dictation = startDictation(text, vi.fn()), rec = Recognition.current;
    rec.result('pain star');
    dictation.stop();
    vi.advanceTimersByTime(1200);
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([]);
    rec.result('pain started yesterday', true);
    rec.onend?.();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([['pain started yesterday', true]]);
  });

  it('does not restart the timeout when release is repeated', () => {
    const end = vi.fn();
    const dictation = startDictation(vi.fn(), end);
    dictation.stop();
    vi.advanceTimersByTime(4000);
    dictation.stop();
    vi.advanceTimersByTime(1000);
    expect(Recognition.current.stop).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith('timeout');
  });

  it.each(['no-speech', 'not-allowed', 'audio-capture', 'network', 'aborted'])('does not send after %s', error => {
    const text = vi.fn(), end = vi.fn();
    const dictation = startDictation(text, end), rec = Recognition.current;
    rec.result('Partial draft');
    dictation.stop();
    rec.onerror?.({ error });
    rec.onend?.();
    vi.runAllTimers();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([]);
    expect(text).toHaveBeenLastCalledWith('Partial draft', false);
    expect(end).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('completes a silent recording with no recognized words', () => {
    const text = vi.fn(), end = vi.fn();
    const dictation = startDictation(text, end);
    dictation.stop();
    Recognition.current.onend?.();
    vi.runAllTimers();
    expect(text).toHaveBeenCalledExactlyOnceWith('', true);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('clears its guard if stop completes synchronously', () => {
    const text = vi.fn(), end = vi.fn();
    const dictation = startDictation(text, end), rec = Recognition.current;
    rec.stop.mockImplementation(() => rec.onend?.());
    dictation.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('discards cancelled dictation, including a pending release timer', () => {
    const text = vi.fn(), end = vi.fn();
    const dictation = startDictation(text, end), rec = Recognition.current;
    rec.result('Unsent draft');
    dictation.stop();
    dictation.cancel();
    rec.onend?.();
    vi.runAllTimers();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([]);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

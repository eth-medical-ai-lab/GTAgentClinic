import { afterEach, expect, it, vi } from 'vitest';
import { beginStartupLook, startupLook } from '../client/src/startupLook';

function env() {
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    hidden: false,
    hasFocus: (): boolean => true,
    exitPointerLock: vi.fn(() => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); }),
    documentElement: { requestPointerLock: vi.fn(() => Promise.resolve()) },
  });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  const grant = () => { doc.pointerLockElement = doc.documentElement; doc.dispatchEvent(new Event('pointerlockchange')); };
  return { doc, win, grant };
}

afterEach(() => { startupLook()?.finish(false); vi.unstubAllGlobals(); });

it('requests synchronously and hands the same lock to the loaded world', () => {
  const { doc, grant } = env();
  beginStartupLook();
  expect(doc.documentElement.requestPointerLock).toHaveBeenCalledTimes(1);
  grant();
  expect(startupLook()!.finish(true)).toBe(doc.documentElement);
  expect(doc.exitPointerLock).not.toHaveBeenCalled();
  expect(startupLook()).toBeUndefined();
});

it.each(['Escape', 'blur', 'right-click', 'release', 'failure'] as const)('does not hand over or retry after %s during loading', (reason) => {
  const { doc, win, grant } = env();
  beginStartupLook();
  grant();
  if (reason === 'Escape') win.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
  if (reason === 'blur') win.dispatchEvent(new Event('blur'));
  if (reason === 'right-click') win.dispatchEvent(Object.assign(new Event('mousedown'), { button: 2 }));
  if (reason === 'release') doc.exitPointerLock();
  if (reason === 'failure') startupLook()!.cancel();
  expect(startupLook()!.finish(true)).toBeNull();
  expect(doc.pointerLockElement).toBeNull();
  expect(doc.documentElement.requestPointerLock).toHaveBeenCalledTimes(1);
});

it('releases a delayed grant after cancellation', async () => {
  const { doc, grant } = env();
  let resolve!: () => void;
  doc.documentElement.requestPointerLock.mockReturnValue(new Promise<void>(r => { resolve = r; }));
  beginStartupLook();
  startupLook()!.finish(false);
  grant();
  resolve();
  await Promise.resolve();
  expect(doc.pointerLockElement).toBeNull();
});

it.each(['panel', 'hidden', 'unfocused'] as const)('does not capture over a %s state at handover', reason => {
  const { doc, grant } = env();
  beginStartupLook(); grant();
  if (reason === 'hidden') doc.hidden = true;
  if (reason === 'unfocused') doc.hasFocus = () => false;
  expect(startupLook()!.finish(reason !== 'panel')).toBeNull();
  expect(doc.pointerLockElement).toBeNull();
});

it('keeps denial as a click fallback instead of retrying after loading', async () => {
  const { doc } = env();
  doc.documentElement.requestPointerLock.mockRejectedValue(new Error('Denied'));
  beginStartupLook();
  await Promise.resolve();
  expect(startupLook()!.finish(true)).toBeNull();
  expect(doc.documentElement.requestPointerLock).toHaveBeenCalledTimes(1);
});

import type { Page } from 'playwright';
import { viewport } from './embodiedControls';

/** Stream Chromium's compositor, including HTML overlays. Acknowledge only after IPC accepts the
 * frame so a slow spectator path cannot queue an unbounded series of screenshots. */
export async function startLiveView(page: Page, publish: (jpeg: string) => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  // Chromium otherwise subtracts the browser toolbar height from the screencast.
  await cdp.send('Browser.setContentsSize', { windowId, ...viewport });
  let last = -Infinity;
  let busy = false;
  let stopped = false;
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try {
      if (!stopped && !busy && performance.now() - last >= 1000 / 30) {
        last = performance.now();
        busy = true;
        try { await publish(data); } finally { busy = false; }
      }
    } finally {
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080 });
  return async () => {
    stopped = true;
    await cdp.detach().catch(() => {});
  };
}

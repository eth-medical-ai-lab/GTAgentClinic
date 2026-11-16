import type { Page } from 'playwright';
import type { Input } from '../shared/embodied';
export { viewport, decision, type Decision, type Input } from '../shared/embodied';

export async function applyInput(page: Page, a: Input): Promise<string> {
  switch (a.kind) {
    case 'key':
      await page.keyboard.down(a.key);
      try { await page.waitForTimeout(a.ms); } finally { await page.keyboard.up(a.key); }
      break;
    case 'look':
      await page.evaluate(({ dx, dy }) => window.dispatchEvent(new CustomEvent('ac-doctor-look', { detail: { dx, dy } })), a);
      break;
    case 'click':
      await page.mouse.click(a.x, a.y);
      break;
    case 'scroll':
      await page.mouse.move(a.x, a.y);
      await page.mouse.wheel(0, a.dy);
      break;
    case 'type':
      await page.keyboard.insertText(a.text);
      break;
    case 'speak': {
      const delivered = await page.evaluate(text => !window.dispatchEvent(new CustomEvent('ac-doctor-speak', { detail: text, cancelable: true })), a.text);
      return delivered ? 'Spoke.' : 'No available conversation. Approach someone and interact with E, or connect a call.';
    }
    case 'wait':
      await page.waitForTimeout(a.ms);
  }
  return 'Input sent.';
}

export async function playInputs(page: Page, inputs: Input[], record: (input: Input, result: string) => void) {
  for (const input of inputs) {
    if (!await page.locator('.game').count()) return false; // shift can end during inference or a long hold
    const result = await applyInput(page, input);
    record(input, result);
    if (input.kind === 'speak' && result !== 'Spoke.') break;
    await page.waitForTimeout(150); // let a panel react before the next click or key
  }
  return true;
}

export const systemPrompt = `You are the resident playing a simulated emergency department shift. Triage, assess, treat and disposition patients, then end your shift through the HUD. Use only the visible game screen. Give a short public intent and up to four ordered inputs per turn. You choose when to observe: observeAfter=true requests a fresh screenshot for the NEXT decision, after these inputs finish. With false the next turn receives text results only. Use empty inputs and true to look now. You get one initial image. Plan short sequences in familiar areas; request a new image when you need visual feedback. Key holds and waits together may total at most 8000 ms per decision.
The screenshot is 1280x720. Coordinates start at its top left. Hold w/a/s/d for 0–8000 ms to walk. Look with relative mouse pixels (positive dx right, positive dy down; 680 pixels turns about 90 degrees). Aim the crosshair at a person or workstation and press e. Tab opens the tablet and patient list, Escape closes panels, h opens help. Click visible UI controls, scroll at coordinates, or type into a focused chart field. Speak sends your line directly in the current conversation or phone call. NPC responses appear on screen. The shift clock runs while you decide.`;

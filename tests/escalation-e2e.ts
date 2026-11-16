/**
 * Escalate to the attending in the real 3D client: the 🆘 Escalate button on a patient's tablet,
 * "Come to the bedside now", the HUD chip while Dr. Shaw walks over, her arrival at the bedside
 * (opener said aloud, talkable there), and the debrief's escalation list. Boots a private server on
 * a random port and stops it (and the browser) at the end.
 *
 *   npx tsx tests/escalation-e2e.ts [outDir]
 */
import { mkdirSync } from 'node:fs';
import type { EscalationView } from '../shared/types';
import { startHarness } from './harness';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/escalation';
mkdirSync(out, { recursive: true });
const h = await startHarness({ portBase: 6300, dev: true });
const { check } = h;
let errs: string[] = [];
try {
  const { page, errors } = await h.nightShift();
  errs = errors; // the live list: errors from later in the run count too
  const escalations = () => page.evaluate('__ac.store.get().view.escalations ?? []') as Promise<EscalationView[]>;

  // the Fast Track 1 patient; stand inside the door looking at the bed (yaw 0 = +z, 90 = +x).
  // Only once the world has finished loading (it places the player at spawn when it is ready), and checked.
  const pid = (await page.evaluate(`__ac.store.get().view.npcs.find((n) => n.role === 'patient' && n.location === 'ft_1').id`)) as string;
  check('Fast Track 1 has a patient', !!pid, pid);
  await page.waitForSelector('.loading-screen.done', { state: 'attached', timeout: 90000 }).catch(() => undefined);
  const standInFastTrack = async () => {
    for (let i = 0; i < 10; i++) {
      await page.evaluate('__acWorld.teleport(16.9, 16.9, 20, -12)');
      await page.waitForTimeout(700);
      const st = (await page.evaluate('__acWorld.state()')) as { x: number; z: number };
      if (Math.hypot(st.x - 16.9, st.z - 16.9) < 0.5) return true;
    }
    return false;
  };
  check('the player stands in Fast Track 1', await standInFastTrack());

  // open the patient's tablet, the way E does
  await page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: '${pid}', tab: 'talk' }, tabletMin: false })`);
  await page.waitForSelector('.tablet .esc-btn', { timeout: 5000 });
  check('the patient tablet has a 🆘 Escalate button', (await page.locator('.tablet .esc-btn').innerText()).includes('Escalate'));
  await page.click('.tablet .esc-btn');
  await page.waitForSelector('.esc-panel', { timeout: 3000 });
  const choices = await page.locator('.esc-panel .esc-actions button').allInnerTexts();
  check('two choices: bedside now / call to discuss', choices.some((t) => t.includes('Come to the bedside now')) && choices.some((t) => t.includes('Call to discuss')), choices.join(' | '));
  await page.fill('.esc-reason', 'Ready for discharge? Please check my plan');
  await page.screenshot({ path: `${out}/1-escalate-panel.png` });

  await page.click('.esc-panel button:has-text("Come to the bedside now")');
  await page.waitForSelector('.esc-chip', { timeout: 5000 });
  const chip = await page.locator('.esc-chip').innerText();
  check('HUD chip while she is on her way', /Dr\. Shaw → Fast Track 1 · on her way/.test(chip), chip.trim());
  const page1 = (await page.evaluate(`__ac.store.get().view.pages.at(-1)`)) as { from: string; text: string };
  check('she pages "On my way"', page1.text === 'On my way to Fast Track 1.', `${page1.from}: ${page1.text}`);
  // put the tablet away (the clock runs at full speed again) and watch her come
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/2-on-her-way.png` });

  // she arrives: wait in real time, skip ahead with "+10 min" if it takes too long
  let arrived = false;
  for (let i = 0; i < 60 && !arrived; i++) {
    await page.waitForTimeout(500);
    arrived = (await escalations()).some((e) => e.status === 'at_bedside');
  }
  if (!arrived) {
    await page.click('button:has-text("+10 min")');
    for (let i = 0; i < 20 && !arrived; i++) {
      await page.waitForTimeout(500);
      arrived = (await escalations()).some((e) => e.status === 'at_bedside');
    }
  }
  check('Dr. Shaw arrives at the bedside', arrived);
  await page.waitForSelector('.esc-chip', { state: 'detached', timeout: 5000 }).catch(() => undefined);
  check('the chip goes once she is there', (await page.locator('.esc-chip').count()) === 0);
  const shaw = (await page.evaluate(`__ac.store.get().view.npcs.find((n) => n.id === 'att_shaw')`)) as { location: string; bark?: { text: string }; talkable: boolean; activity?: string };
  check('she is in Fast Track 1 and talkable', shaw.location === 'ft_1' && shaw.talkable, `${shaw.location} · ${shaw.activity}`);
  check('she says her opener aloud', /^What's going on with Mr\. \w+\?$/.test(shaw.bark?.text ?? ''), shaw.bark?.text);
  // let the 3D walk finish (the client animates the walk at walking pace), then the picture;
  // Fast Track 1's free bedside spot is x 18.8, z 19.6 (a nurse there too is spread 0.65 m along z)
  const near = (at: { x: number; z: number } | null) => !!at && Math.abs(at.x - 18.8) < 0.6 && Math.abs(at.z - 19.6) < 1.3;
  for (let i = 0; i < 30; i++) {
    if (near((await page.evaluate(`__acWorld.npc('att_shaw')`)) as { x: number; z: number } | null)) break;
    await page.waitForTimeout(500);
  }
  const pos = (await page.evaluate(`__acWorld.npc('att_shaw')`)) as { x: number; z: number } | null;
  check('her avatar stands at the bedside in 3D', near(pos), pos ? `${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}` : 'not rendered');
  await page.screenshot({ path: `${out}/3-at-the-bedside.png` });

  // talkable there: her tablet opens on her opener, and she answers (within earshot)
  await standInFastTrack();
  await page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: 'att_shaw', tab: 'talk' }, tabletMin: false })`);
  await page.waitForTimeout(600);
  const dist = (await page.evaluate(`__ac.store.get().distances['att_shaw']`)) as number | undefined;
  check('within earshot of her', dist !== undefined && dist < 4.2, `${dist} m`);
  await page.waitForSelector('.tablet .bubble.npc', { timeout: 5000 });
  const firstLine = await page.locator('.tablet .bubble.npc .bubble-text').first().innerText();
  check('her transcript starts with the opener', /^What's going on with Mr\. \w+\?$/.test(firstLine), firstLine);
  await page.fill('.tablet textarea, .tablet input[type="text"]', 'Ankle injury, Ottawa rules negative, brace and crutches, home with follow-up. Agree?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(`document.querySelectorAll('.tablet .bubble.npc').length >= 2`, undefined, { timeout: 15000 }).catch(() => undefined);
  check('she answers at the bedside', (await page.locator('.tablet .bubble.npc').count()) >= 2);
  await page.screenshot({ path: `${out}/4-talking-at-the-bedside.png` });

  // the debrief lists the escalation
  await page.keyboard.press('Escape');
  await page.click('.hud-right button:has-text("End shift")');
  await page.click('.hud-right button:has-text("End now")');
  await page.waitForSelector('.db-esc', { timeout: 20000 });
  const row = await page.locator('.db-esc .esc-row').first().innerText();
  check('debrief lists the escalation with vitals and stability', /Fast Track 1/.test(row) && /to the bedside/.test(row) && /HR \d+ · BP \d+\/\d+/.test(row) && /stable/i.test(row), row.replace(/\s+/g, ' ').slice(0, 160));
  await page.locator('.db-esc').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/5-debrief.png` });
} finally {
  await h.close();
}
check('no browser errors', errs.length === 0, errs.slice(0, 4).join(' | '));
console.log(`\n${h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all escalation checks passed'} · screenshots in ${out}/`);
process.exit(h.failed() ? 1 : 0);

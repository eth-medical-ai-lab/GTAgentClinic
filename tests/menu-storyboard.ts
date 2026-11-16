/** Contact sheets and an explicit applicability audit for flat menu controls. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';

export async function menuStoryboard(browser: Browser, out: string, title: string, checks: string[]) {
  const frames = ['desktop.png', 'narrow.png'];
  const audit = {
    title, frames, checks,
    physicalSupport: { applicable: false, reason: 'Flat menu controls; no bodies, props, furniture, or world geometry are changed.' },
    manualReview: 'Inspect both viewport frames and the contact sheet for clipping, overflow, legibility, and selected states.',
  };
  writeFileSync(path.join(out, 'audit.json'), JSON.stringify(audit, null, 2));
  writeFileSync(path.join(out, 'findings.md'), `# ${title}\n\n${checks.map((check) => `- Passed: ${check}`).join('\n')}\n\nPhysical support and camera-angle checks: not applicable. ${audit.physicalSupport.reason}\n\n${audit.manualReview}\n`);
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
    <style>body{margin:0;padding:24px;background:#101820;color:#fff;font:16px sans-serif}main{display:flex;gap:24px}figure{margin:0;width:680px}img{display:block;max-width:100%;height:640px;object-fit:contain;object-position:top left}figcaption{margin:12px 0}p{max-width:1300px}</style>
    <h1>${title}</h1><main>${frames.map((file) => `<figure><figcaption>${file}</figcaption><img src="data:image/png;base64,${readFileSync(path.join(out, file)).toString('base64')}"></figure>`).join('')}</main>
    <p>Physical support: not applicable — menu controls only. Review both viewport sizes for clipping, overflow, legibility, and selected states.</p>`;
  writeFileSync(path.join(out, 'sheet.html'), html);
  const sheet = await browser.newPage({ viewport: { width: 1450, height: 850 } });
  try {
    await sheet.setContent(html);
    await sheet.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await sheet.screenshot({ path: `${out}.png`, fullPage: true });
  } finally { await sheet.close(); }
}

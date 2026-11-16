import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Version of the static game assets (client/public/res: models, animations, textures, audio). It's
 * a short hash of every file's path, size and date, and the client adds it to /res URLs
 * (client/src/resCache.ts). Changing an asset changes the URLs, so browsers fetch the new file
 * instead of reusing an old cached copy.
 */
function resVersion(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'client/public/res');
  const h = createHash('sha1');
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(`${path.relative(root, p)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
    }
  };
  walk(root);
  return h.digest('hex').slice(0, 10);
}

export default defineConfig(({ mode }) => ({
  root: 'client',
  base: mode === 'demo' ? './' : '/',
  plugins: [
    react(),
    mode === 'demo' && {
      name: 'demo-license',
      generateBundle() {
        // Apache-2.0 §4: a redistribution carries the licence and the NOTICE file
        this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8') });
        this.emitFile({ type: 'asset', fileName: 'NOTICE.txt', source: readFileSync(new URL('./NOTICE', import.meta.url), 'utf8') });
      },
    },
  ],
  define: { __RES_VERSION__: JSON.stringify(resVersion()) },
  build: {
    outDir: mode === 'demo' ? '../dist/demo' : '../dist/client',
    license: mode === 'demo' && { fileName: 'dependency-licenses.txt' },
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
  },
  server: { fs: { allow: ['..'] } },
}));

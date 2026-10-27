import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/*
 * Writes dist/sw.js (the service worker, scripts/sw.js) with the build's files to precache: everything
 * the game needs to start offline, and the default board's sound effects (~400 kB, both formats: the
 * worker can't tell which one the browser will ask for). Music and the other boards' sounds (most of the
 * build) aren't on the list; the worker caches each one the first time it plays. SHELL_FILES are public/
 * files the install screen and the first frame use.
 */
const PRECACHE = /\.(js|css|wasm|woff2)$/;
const PRECACHE_SOURCE = /^src\/boards\/lanka\/sounds\/(?!music-)[^/]+\.(ogg|mp3)$/;
const SHELL_FILES = ['/manifest.webmanifest', '/favicon.svg', '/brand/logo.svg', '/brand/icon-192.png', '/brand/icon-512.png'];

export function pwa(): Plugin {
  return {
    name: 'tuktuk-pwa',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.entries(bundle)
        .filter(([f, out]) =>
          PRECACHE.test(f) || (out.type === 'asset' && out.originalFileNames.some((src) => PRECACHE_SOURCE.test(src))))
        .map(([f]) => `/${f}`)
        .sort();
      // The hashed names change with their contents, so they identify the build
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(files))
        .replace('__SHELL_FILES__', JSON.stringify(SHELL_FILES));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

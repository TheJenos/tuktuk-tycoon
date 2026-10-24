import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Only these drei helpers may be used anywhere: the others fetch from CDNs (Environment presets, useDetectGPU),
 * spawn workers or load fonts at runtime (Text, Text3D), which Discord's CSP blocks.
 */
const ALLOWED = new Set(['CameraControls', 'RoundedBox', 'Instances', 'Instance', 'useCursor', 'PerformanceMonitor']);

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('drei allowlist', () => {
  it('imports only allowed drei helpers, by name, from the package root', () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of files(SRC)) {
      if (file.endsWith('drei-allowlist.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      const where = relative(SRC, file);
      const re = /import\s+(type\s+)?(\{[^}]*\}|[^;{}'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
      for (const m of text.matchAll(re)) {
        const [, , clause = '', from = ''] = m;
        if (!from.startsWith('@react-three/drei')) continue;
        checked++;
        if (from !== '@react-three/drei') problems.push(`${where}: deep import ${from}`);
        const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
        if (!named) {
          problems.push(`${where}: import ${clause.trim()} (only named imports)`);
          continue;
        }
        for (const spec of (named[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
          const name = spec.replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '';
          if (!ALLOWED.has(name)) problems.push(`${where}: ${name}`);
        }
      }
      if (/import\(\s*['"]@react-three\/drei/.test(text)) problems.push(`${where}: dynamic drei import`);
      if (/require\(\s*['"]@react-three\/drei/.test(text)) problems.push(`${where}: require of drei`);
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});

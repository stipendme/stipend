// Adds explicit .js / index.js extensions to relative imports in the vendored Codama output (NodeNext ESM).
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
function walk(d) { return readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; }); }
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (m, pre, q, spec) => {
    if (/\.(js|json)$/.test(spec)) return m;
    const abs = resolve(dirname(file), spec);
    if (existsSync(abs) && statSync(abs).isDirectory()) return `${pre}${q}${spec}/index.js${q}`;
    return `${pre}${q}${spec}.js${q}`;
  });
  if (out !== src) writeFileSync(file, out);
}

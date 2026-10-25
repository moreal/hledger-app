import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/pages');
const base = process.env.VITE_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base))
  throw new Error('VITE_BASE_PATH must be an absolute directory path.');
for (const command of ['api:codegen', 'i18n:compile', 'build:web', 'build:storybook']) {
  const result = spawnSync('yarn', [command], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_BASE_PATH: base },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Only compiled assets are published: no ledger, credentials, cache or scraped previews.
await cp(resolve(root, 'apps/web/dist'), output, { recursive: true });
const html = await readFile(resolve(output, 'index.html'), 'utf8');
await mkdir(resolve(output, 'gallery'), { recursive: true });
await writeFile(resolve(output, 'gallery/index.html'), html);
await writeFile(resolve(output, '.nojekyll'), '');
console.log(`Pages output: ${output} (base ${base})`);

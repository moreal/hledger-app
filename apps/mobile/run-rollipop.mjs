import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// SWC checks cache ownership. A fresh private directory also works on hosts
// where a shared ancestor of the default user cache fails that check.
const privateCache = process.env.SWC_NATIVE_BINDING_CACHE
  ? undefined
  : mkdtempSync(path.join(realpathSync(tmpdir()), 'hledger-rollipop-swc-'));
const cli = path.join(path.dirname(require.resolve('rollipop/package.json')), 'bin/index.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SWC_NATIVE_BINDING_CACHE: process.env.SWC_NATIVE_BINDING_CACHE ?? privateCache,
  },
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
const cleanup = () => {
  if (privateCache) rmSync(privateCache, { recursive: true, force: true });
};
child.on('error', (error) => {
  cleanup();
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  cleanup();
  process.exitCode = code ?? (signal ? 1 : 0);
});

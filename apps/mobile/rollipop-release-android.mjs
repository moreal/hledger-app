// React Native Gradle CLI adapter. Set react.cliFile to this file and
// react.bundleCommand to "bundle" in the generated Android app/build.gradle.
// Gradle keeps its normal Hermes compilation, asset merging and release flags.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const incoming = process.argv.slice(2);
if (incoming.shift() !== 'bundle') throw new Error('Expected the Gradle bundle command');
const supported = new Set(['--platform', '--bundle-output', '--sourcemap-output', '--assets-dest']);
const ignored = new Set(['--entry-file', '--config', '--dev', '--minify']);
const forwarded = [];
for (let i = 0; i < incoming.length; i++) {
  const flag = incoming[i];
  if (supported.has(flag)) {
    if (!incoming[i + 1]) throw new Error(`Missing value for ${flag}`);
    const value = incoming[++i];
    forwarded.push(flag, flag === '--platform' ? value : path.resolve(value));
  } else if (ignored.has(flag)) {
    if (!incoming[i + 1]) throw new Error(`Missing value for ${flag}`);
    i++;
  } else if (flag !== '--reset-cache' && flag !== '--verbose') {
    throw new Error(`Unsupported Gradle bundle argument: ${flag}`);
  }
}
const cwd = fileURLToPath(new URL('.', import.meta.url));
const child = spawn(process.execPath, [fileURLToPath(new URL('./run-rollipop.mjs', import.meta.url)),
  'bundle', ...forwarded, '--dev', 'false', '--minify', 'true'], { cwd, stdio: 'inherit', env: process.env });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

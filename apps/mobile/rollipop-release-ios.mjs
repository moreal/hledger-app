// Xcode Release bundling adapter. After Expo prebuild, set in ios/.xcode.env.local:
// export CLI_PATH="$PROJECT_ROOT/rollipop-release-ios.mjs"
// export BUNDLE_COMMAND=bundle
// React Native's normal build phase still compiles Hermes and embeds assets.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const input = process.argv.slice(2);
if (input.shift() !== 'bundle') throw new Error('Expected the Xcode bundle command');
const args = [];
for (let index = 0; index < input.length; index++) {
  const flag = input[index];
  // These are Metro configuration plumbing, supplied by react-native-xcode.sh.
  if (['--config-cmd', '--load-config', '--asset-catalog-dest'].includes(flag)) { index++; continue; }
  if (flag === '--dev' || flag === '--minify') { index++; continue; }
  args.push(flag);
}
if (!args.includes('--bundle-output') || !args.includes('--assets-dest')) {
  throw new Error('Xcode must supply bundle-output and assets-dest');
}
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('./run-rollipop.mjs', import.meta.url)),
  'bundle', ...args, '--dev', 'false', '--minify', 'true',
], { stdio: 'inherit', cwd: fileURLToPath(new URL('.', import.meta.url)), env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

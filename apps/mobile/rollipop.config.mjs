import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'rollipop';
import { expoAssetInteropRule, expoGoManifestPlugin } from './rollipop-expo.mjs';

const require = createRequire(import.meta.url);
const { expo } = require('./app.json');
const sdkVersion = `${require('expo/package.json').version.split('.')[0]}.0.0`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  entry: 'index.ts',
  // No TypeScript path aliases are used. Keep checking with the existing tsc
  // configuration; Rolldown cannot resolve Expo's multi-extends configuration.
  tsconfig: false,
  transform: { babel: { rules: [expoAssetInteropRule] } },
  plugins: [expoGoManifestPlugin(expo, sdkVersion)],
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOptions, configureAndroid, verifyHermes, stageSource, canonicalPath, validateStagedSource } from './mobile-release.mjs';
const base = ['--platform', 'ios', '--work-dir', '/tmp/native-stage', '--output-dir', '/tmp/native-artifacts'];
test('fresh staged source regenerates missing GraphQL before client-backed regression tests', { skip: process.env.HLEDGER_RELEASE_INTEGRATION !== '1' }, () => {
  const stage = mkdtempSync(path.join(os.tmpdir(), 'mobile-fresh-regression-'));
  const root = path.resolve(import.meta.dirname, '..');
  try {
    stageSource(root, stage);
    rmSync(path.join(stage, 'packages/api-contract/generated'), { recursive: true, force: true });
    assert.ok(!existsSync(path.join(stage, 'packages/api-contract/generated/client/graphql.ts')));
    symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
    const env = { ...process.env, CI: '1' }; delete env.NODE_TEST_CONTEXT;
    validateStagedSource(stage, env);
    assert.ok(existsSync(path.join(stage, 'packages/api-contract/generated/client/graphql.ts')));
  } finally { rmSync(stage, { recursive: true, force: true }); }
});
test('CLI validates platforms, absolute paths, target and unknown arguments', () => {
  assert.equal(parseOptions(base).iosTarget, 'simulator');
  assert.equal(parseOptions([...base, '--prepare-only', '--reuse-node-modules']).reuseNodeModules, true);
  for (const args of [[], [...base, '--ios-target', 'phone'], [...base, '--work-dir', 'relative'], [...base, '--wat'], [...base, '--platform'], [...base, '--android-architectures', '../bad']]) assert.throws(() => parseOptions(args));
});
test('generated Android integration uses staged adapter and removes release debug certificate only', () => {
  const source = 'react {\ncliFile = new File("expo")\nbundleCommand = "export:embed"\nentryFile = file("old")\n}\nandroid { signingConfigs { debug {} } buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig signingConfigs.debug\n minifyEnabled true } } }';
  const result = configureAndroid(source);
  assert.match(result, /cliFile = file\('\.\.\/\.\.\/rollipop-release-android.mjs'\)/);
  assert.match(result, /entryFile = file\('\.\.\/\.\.\/index.ts'\)/);
  assert.ok(!result.includes('export:embed'));
  assert.ok(!result.includes('new File("expo")'));
  assert.match(result, /debug \{ signingConfig signingConfigs.debug/);
  assert.match(result, /release \{ signingConfig = null/);
  assert.throws(() => configureAndroid('invalid'));
});
test('packaged Hermes check rejects JavaScript and records version/hash', () => {
  assert.throws(() => verifyHermes(Buffer.from('console.log("hello")')));
  const buffer = Buffer.alloc(16); Buffer.from('c61fbc03c103191f', 'hex').copy(buffer); buffer.writeUInt32LE(99, 8);
  assert.equal(verifyHermes(buffer).version, 99);
  assert.equal(verifyHermes(buffer).sha256.length, 64);
});
test('staging includes source and excludes native output, dependencies and caches', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mobile-release-test-'));
  try {
    const root = path.join(tmp, 'source'); mkdirSync(path.join(root, 'apps/mobile/android'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules')); writeFileSync(path.join(root, 'node_modules/secret'), 'dependency');
    writeFileSync(path.join(root, 'apps/mobile/android/stale'), 'generated'); writeFileSync(path.join(root, 'apps/mobile/App.tsx'), 'source');
    mkdirSync(path.join(root, 'apps/mobile/plugins'));
    for (const file of ['plugins/with-loopback-network-security.cjs', 'plugins/with-loopback-network-security.test.cjs', 'book-validation.ts', 'book-validation.test.ts']) writeFileSync(path.join(root, 'apps/mobile', file), 'regression source');
    mkdirSync(path.join(root, '.hledger-app')); writeFileSync(path.join(root, '.hledger-app/token'), 'secret');
    mkdirSync(path.join(root, 'packages/api-contract/generated'), { recursive: true }); writeFileSync(path.join(root, 'packages/api-contract/generated/stale.ts'), 'stale codegen');
    writeFileSync(path.join(root, 'apps/mobile/.env.local'), 'TOKEN=secret');
    writeFileSync(path.join(tmp, 'outside-secret'), 'secret');
    symlinkSync(path.join(tmp, 'outside-secret'), path.join(root, 'apps/mobile/linked-secret'));
    const dest = path.join(tmp, 'stage'); stageSource(root, dest);
    assert.ok(existsSync(path.join(dest, 'apps/mobile/App.tsx')));
    for (const file of ['plugins/with-loopback-network-security.cjs', 'plugins/with-loopback-network-security.test.cjs', 'book-validation.ts', 'book-validation.test.ts']) assert.ok(existsSync(path.join(dest, 'apps/mobile', file)));
    assert.ok(!existsSync(path.join(dest, 'apps/mobile/linked-secret')));
    assert.ok(!existsSync(path.join(dest, '.hledger-app/token')));
    assert.ok(!existsSync(path.join(dest, 'packages/api-contract/generated')));
    assert.ok(!existsSync(path.join(dest, 'apps/mobile/.env.local')));
    symlinkSync(root, path.join(tmp, 'alias'));
    assert.equal(canonicalPath(path.join(tmp, 'alias/new/stage')), path.join(canonicalPath(root), 'new/stage'));
    assert.ok(!existsSync(path.join(dest, 'node_modules'))); assert.ok(!existsSync(path.join(dest, 'apps/mobile/android')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

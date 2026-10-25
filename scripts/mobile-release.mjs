#!/usr/bin/env node
// Generate native projects only inside a fresh staging directory.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function parseOptions(args) {
  const options = { iosTarget: 'simulator' };
  const values = { '--platform': 'platform', '--ios-target': 'iosTarget', '--work-dir': 'workDir', '--output-dir': 'outputDir', '--android-architectures': 'architectures' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prepare-only') options.prepareOnly = true;
    else if (args[i] === '--reuse-node-modules') options.reuseNodeModules = true;
    else if (values[args[i]]) {
      const key = values[args[i]];
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
      options[key] = args[++i];
    } else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!['ios', 'android'].includes(options.platform)) throw new Error('--platform must be ios or android');
  if (!['simulator', 'device'].includes(options.iosTarget)) throw new Error('--ios-target must be simulator or device');
  for (const key of ['workDir', 'outputDir']) {
    if (!options[key] || !path.isAbsolute(options[key])) throw new Error(`${key} must be an absolute path`);
    options[key] = path.resolve(options[key]);
  }
  if (options.architectures && !/^(arm64-v8a|armeabi-v7a|x86|x86_64)(,(arm64-v8a|armeabi-v7a|x86|x86_64))*$/.test(options.architectures)) throw new Error('Invalid Android architectures');
  return options;
}

export function configureAndroid(source) {
  if (!/react\s*\{/.test(source)) throw new Error('Generated Gradle react block missing');
  let result = source.replace(/^\s*(?:entryFile|cliFile|bundleCommand)\s*=.*$/gm, '').replace(/react\s*\{/, `react {\n    entryFile = file('../../index.ts')\n    cliFile = file('../../rollipop-release-android.mjs')\n    bundleCommand = 'bundle'`);
  // Expo templates bind the debug certificate in release. Distribution signing is external.
  result = result.replace(/(release\s*\{[\s\S]*?)(signingConfig\s+signingConfigs\.debug)/g, '$1signingConfig = null');
  if (/release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug/.test(result)) throw new Error('Release debug signing remains');
  return result;
}

export function verifyHermes(buffer) {
  const magic = Buffer.from('c61fbc03c103191f', 'hex');
  if (!buffer.subarray(0, 8).equals(magic)) throw new Error('Packaged bundle is not Hermes bytecode');
  return { version: buffer.readUInt32LE(8), bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}
const sourceRoots = new Set(['package.json', 'yarn.lock', '.yarnrc.yml', 'tsconfig.json', 'apps', 'packages']);
const excluded = new Set(['.hledger-app', '.aws', '.codex', '.agents','node_modules', 'ios', 'android', '.git', '.expo', '.rollipop', '.yarn', 'dist', 'build', '.gradle', 'Pods']);
export function stageSource(root, destination) {
  cpSync(root, destination, { recursive: true, filter: source => {
    if (source === root) return true;
    if (lstatSync(source).isSymbolicLink()) return false;
    const parts = path.relative(root, source).split(path.sep);
    return sourceRoots.has(parts[0]) && !(parts[0] === 'apps' && parts[1] === 'web' && parts.some(part => ['public', '.storybook'].includes(part))) && !parts.some(part => excluded.has(part) || part.startsWith('.env'));
  } });
}
export function canonicalPath(value) {
  const resolved = path.resolve(value);
  if (existsSync(resolved)) return realpathSync(resolved);
  return path.join(canonicalPath(path.dirname(resolved)), path.basename(resolved));
}
const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
function run(command, args, cwd, env = process.env, capture = false) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout;
}
export function main(options) {
  options = { ...options, workDir: canonicalPath(options.workDir), outputDir: canonicalPath(options.outputDir) };
  const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  const contains = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  if (contains(root, options.workDir) || contains(options.workDir, root)) throw new Error('Work directory must be outside the source checkout');
  if (contains(options.workDir, options.outputDir) || contains(options.outputDir, options.workDir)) throw new Error('Work and output directories must be separate');
  if (existsSync(options.workDir)) throw new Error('Work directory must not already exist');
  if (existsSync(options.outputDir) && readdirSync(options.outputDir).length) throw new Error('Output directory must be empty');
  stageSource(root, options.workDir);
  const stage = options.workDir;
  const mobile = path.join(stage, 'apps/mobile');
  const env = { ...process.env, CI: '1' };
  if (options.reuseNodeModules) symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
  else run('corepack', ['yarn', 'install', '--immutable'], stage, env);
  // Validate the staged source with its installed dependencies before native generation.
  run(process.execPath, ['--test', 'apps/mobile/plugins/with-loopback-network-security.test.cjs'], stage, env);
  run(process.execPath, ['--import', 'tsx', '--test', 'apps/mobile/book-validation.test.ts'], stage, env);
  run(process.execPath, [path.join(stage, 'node_modules/@graphql-codegen/cli/cjs/bin.js'), '--config', 'packages/api-contract/codegen.ts'], stage, env);
  // Native identifiers are explicit so Expo prebuild never prompts in CI.
  const configPath = path.join(mobile, 'app.json');
  const config = JSON.parse(readFileSync(configPath));
  config.expo.ios = { ...config.expo.ios, bundleIdentifier: config.expo.ios?.bundleIdentifier ?? 'com.hledger.app' };
  config.expo.android = { ...config.expo.android, package: config.expo.android?.package ?? 'com.hledger.app' };
  config.expo.jsEngine = 'hermes';
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  run(process.execPath, [path.join(stage, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', options.platform, '--no-install'], mobile, env);
  if (options.platform === 'android') {
    const wrapper = readFileSync(path.join(mobile, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8');
    if (!/gradle-9\.4\.1-bin\.zip/.test(wrapper)) throw new Error('Expected pinned Gradle 9.4.1 wrapper');
    const gradle = path.join(mobile, 'android/app/build.gradle');
    writeFileSync(gradle, configureAndroid(readFileSync(gradle, 'utf8')));
  } else {
    writeFileSync(path.join(mobile, 'ios/.xcode.env.local'), `export NODE_BINARY=${shellQuote(process.execPath)}\nexport CLI_PATH="$PROJECT_ROOT/rollipop-release-ios.mjs"\nexport BUNDLE_COMMAND=bundle\n`);
  }
  mkdirSync(options.outputDir, { recursive: true });
  const versions = { node: process.version, packageManager: JSON.parse(readFileSync(path.join(stage, 'package.json'))).packageManager };
  for (const name of ['expo', 'react-native', 'rollipop']) versions[name] = JSON.parse(readFileSync(path.join(stage, 'node_modules', name, 'package.json'))).version;
  const manifest = { versions, platform: options.platform, iosTarget: options.platform === 'ios' ? options.iosTarget : undefined, bundler: 'rollipop', signing: 'unsigned', preparedOnly: !!options.prepareOnly, dependencyMode: options.reuseNodeModules ? 'reused-node-modules' : 'immutable-install' };
  if (!options.prepareOnly) {
    let artifact, bundle;
    if (options.platform === 'android') {
      run('./gradlew', [':app:assembleRelease', ...(options.architectures ? [`-PreactNativeArchitectures=${options.architectures}`] : [])], path.join(mobile, 'android'), env);
      const outputs = path.join(mobile, 'android/app/build/outputs/apk/release');
      const apks = readdirSync(outputs).filter(name => name.endsWith('.apk'));
      if (apks.length !== 1) throw new Error('Expected exactly one release APK');
      artifact = path.join(outputs, apks[0]);
      bundle = run('unzip', ['-p', artifact, 'assets/index.android.bundle'], mobile, env, true);
    } else {
      const ios = path.join(mobile, 'ios');
      run('pod', ['install'], ios, env);
      const workspace = readdirSync(ios).find(name => name.endsWith('.xcworkspace'));
      if (!workspace) throw new Error('Generated Xcode workspace missing');
      const scheme = workspace.replace('.xcworkspace', '');
      const sdk = options.iosTarget === 'device' ? 'iphoneos' : 'iphonesimulator';
      const derived = path.join(stage, 'derived-data');
      run('xcodebuild', ['-workspace', path.join(ios, workspace), '-scheme', scheme, '-configuration', 'Release', '-sdk', sdk, '-destination', options.iosTarget === 'device' ? 'generic/platform=iOS' : 'generic/platform=iOS Simulator', '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO', 'build'], mobile, env);
      artifact = path.join(derived, `Build/Products/Release-${sdk}/${scheme}.app`);
      bundle = readFileSync(path.join(artifact, 'main.jsbundle'));
    }
    manifest.hermes = verifyHermes(bundle);
    manifest.artifact = path.basename(artifact);
    cpSync(artifact, path.join(options.outputDir, manifest.artifact), { recursive: true });
  }
  writeFileSync(path.join(options.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(parseOptions(process.argv.slice(2))); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

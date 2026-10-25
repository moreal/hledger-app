import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import { transformSync } from '@babel/core';
import {
  createExpoGoManifest,
  expoAssetInteropRule,
  expoGoManifestPlugin,
} from './rollipop-expo.mjs';

test('Expo manifest middleware answers before React Native landing middleware', async () => {
  let handler;
  expoGoManifestPlugin({ slug: 'gallery' }, '58.0.0').configureServer({
    serverBaseUrl: 'http://127.0.0.1:8082',
    middlewares: {
      use(fn) {
        handler = fn;
      },
    },
  });
  const headers = {};
  let body;
  await handler(
    {
      url: '/',
      headers: {
        'expo-platform': 'ios',
        'expo-expect-signature': 'sig, keyid="expo-root", alg="rsa-v1_5-sha256"',
      },
    },
    {
      setHeader(name, value) {
        headers[name] = value;
      },
      end(value) {
        body = value;
      },
    },
    () => assert.fail('manifest must not reach the React Native landing handler'),
  );
  assert.equal(headers['content-type'], 'application/expo+json');
  assert.equal(JSON.parse(body).extra.expoGo.developer.tool, 'rollipop');
});

test('custom or malformed signature requests are rejected rather than downgraded', async () => {
  let handler;
  expoGoManifestPlugin({ slug: 'gallery' }, '58.0.0').configureServer({
    serverBaseUrl: 'http://127.0.0.1:8082',
    middlewares: {
      use(fn) {
        handler = fn;
      },
    },
  });
  for (const signature of [
    'sig, keyid="custom"',
    'sig, keyid="expo-go"',
    'malformed',
    'sig, keyid="expo-root", alg=12',
  ]) {
    const response = { setHeader() {}, end() {} };
    await handler(
      { url: '/', headers: { 'expo-platform': 'ios', 'expo-expect-signature': signature } },
      response,
      () => assert.fail('unexpected next'),
    );
    assert.equal(response.statusCode, 406);
  }
});

test('Expo Go launch assets stay on the Rollipop loopback server for each native platform', () => {
  for (const platform of ['ios', 'android']) {
    const manifest = createExpoGoManifest({
      platform,
      origin: 'http://127.0.0.1:8082',
      expoConfig: { name: 'Gallery', slug: 'gallery' },
      sdkVersion: '58.0.0',
    });
    assert.equal(manifest.runtimeVersion, 'exposdk:58.0.0');
    const launch = new URL(manifest.launchAsset.url);
    assert.equal(launch.origin, 'http://127.0.0.1:8082');
    assert.equal(launch.pathname, '/index.bundle');
    assert.equal(launch.searchParams.get('platform'), platform);
    assert.equal(manifest.extra.expoClient.hostUri, '127.0.0.1:8082');
    assert.equal(manifest.extra.expoGo.developer.tool, 'rollipop');
  }
});

test('Expo manifest rejects unsupported platforms and non-loopback hosts', () => {
  const options = { expoConfig: { slug: 'gallery' }, sdkVersion: '58.0.0' };
  assert.throws(() =>
    createExpoGoManifest({ ...options, platform: 'web', origin: 'http://127.0.0.1:8082' }),
  );
  assert.throws(() =>
    createExpoGoManifest({ ...options, platform: 'ios', origin: 'https://unexpected.example' }),
  );
});

test('Expo asset interop registers the real native setter and retains the generic fallback', () => {
  const filename = new URL('../../node_modules/expo-asset/build/Asset.fx.js', import.meta.url)
    .pathname;
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = transformSync(source, {
    ...expoAssetInteropRule.options,
    filename,
    babelrc: false,
    configFile: false,
  });
  for (const native of [true, false]) {
    let registered;
    const setter = (transformer) => {
      registered = transformer;
    };
    const resolver = () => {};
    if (native) resolver.setCustomSourceTransformer = setter;
    const module = {
      __esModule: true,
      default: resolver,
      ...(!native ? { setCustomSourceTransformer: setter } : {}),
    };
    vm.runInNewContext(code, {
      require: (name) =>
        name === './resolveAssetSource'
          ? module
          : name === './PlatformUtils'
            ? { IS_ENV_WITH_LOCAL_ASSETS: true }
            : { Asset: {}, ANDROID_EMBEDDED_URL_BASE_RESOURCE: 'asset:/' },
    });
    assert.equal(typeof registered, 'function');
    const expected = { uri: 'native-default' };
    assert.equal(registered({ asset: {}, defaultAsset: () => expected }), expected);
  }
});

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseDictionary } from 'structured-headers';

const require = createRequire(import.meta.url);

// Metro treats the absent named fallback as an undefined module property.
// Preserve that interop for this one Expo module; the native setter is still real.
export const expoAssetInteropRule = {
  filter: { id: /\/expo-asset\/build\/Asset\.fx\.js$/ },
  options: { plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')] },
};

export function createExpoGoManifest({ platform, origin, expoConfig, sdkVersion }) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Expected native Expo platform');
  const base = new URL(origin);
  if (
    base.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password
  )
    throw new Error('Expo Go development server must use HTTP loopback');
  const launch = new URL('/index.bundle', base);
  launch.search = new URLSearchParams({ platform, dev: 'true', minify: 'false' }).toString();
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: `exposdk:${sdkVersion}`,
    launchAsset: { key: 'bundle', contentType: 'application/javascript', url: launch.href },
    assets: [],
    metadata: {},
    extra: {
      eas: {},
      expoClient: { ...expoConfig, sdkVersion, hostUri: base.host },
      expoGo: {
        debuggerHost: base.host,
        developer: { tool: 'rollipop' },
        packagerOpts: { dev: true },
        mainModuleName: 'index',
      },
      scopeKey: `@anonymous/${expoConfig.slug}-rollipop-local`,
    },
  };
}

// Expo Go needs an update manifest before requesting a React Native bundle.
// Only the launch envelope is supplied here; Rollipop owns bundle/assets/HMR.
export function expoGoManifestPlugin(expoConfig, sdkVersion) {
  return {
    name: 'hledger:expo-go-manifest',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url, server.serverBaseUrl).pathname !== '/') return next();
        const platform = request.headers['expo-platform'];
        if (!['ios', 'android'].includes(platform)) {
          response.statusCode = 400;
          return response.end('Use Expo Go for iOS or Android');
        }
        if (request.headers['expo-expect-signature']) {
          let anonymousExpoRoot = false;
          try {
            const expected = parseDictionary(request.headers['expo-expect-signature']);
            // Same anonymous-development case as Expo CLI getCodeSigningInfoAsync:
            // expo-root without an EAS project returns null (no signing identity).
            const algorithm = expected.get('alg');
            anonymousExpoRoot =
              expected.get('keyid')?.[0] === 'expo-root' &&
              (!algorithm || typeof algorithm[0] === 'string') &&
              !expoConfig.extra?.eas?.projectId &&
              !expoConfig.updates?.codeSigningCertificate;
          } catch {
            /* Invalid signature expectations remain an error. */
          }
          if (!anonymousExpoRoot) {
            response.statusCode = 406;
            return response.end('This local adapter cannot satisfy the requested signing identity');
          }
        }
        const manifest = createExpoGoManifest({
          platform,
          origin: server.serverBaseUrl,
          expoConfig,
          sdkVersion,
        });
        console.info(`[rollipop-expo] ${platform} manifest -> ${manifest.launchAsset.url}`);
        response.setHeader('content-type', 'application/expo+json');
        response.setHeader('expo-protocol-version', '0');
        response.setHeader('expo-sfv-version', '0');
        response.setHeader('cache-control', 'private, max-age=0');
        response.end(JSON.stringify(manifest));
      });
    },
  };
}

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileModsAsync } = require('expo/config-plugins');
const { XMLParser } = require('fast-xml-parser');

// Catch missing release manifest wiring, broad HTTP allowances and weakened TLS trust.
test('Expo generates an idempotent loopback-only Android HTTP policy', async () => {
  const pluginPath = path.join(__dirname, 'with-loopback-network-security.cjs');
  assert.ok(existsSync(pluginPath), 'loopback policy plugin must exist');
  const withPolicy = require(pluginPath);
  const root = mkdtempSync(path.join(os.tmpdir(), 'hledger-network-policy-'));
  const main = path.join(root, 'android/app/src/main');
  mkdirSync(main, { recursive: true });
  writeFileSync(
    path.join(main, 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.hledger.app"><application android:label="Hledger" android:usesCleartextTraffic="true" /></manifest>',
  );
  const parser = new XMLParser({ ignoreAttributes: false });
  try {
    for (let run = 0; run < 2; run++) {
      await compileModsAsync(withPolicy({ name: 'Hledger', slug: 'hledger' }), {
        projectRoot: root,
        platforms: ['android'],
      });
      const manifest = parser.parse(readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8'));
      assert.equal(
        manifest.manifest.application['@_android:networkSecurityConfig'],
        '@xml/network_security_config',
      );
      assert.equal(
        String(manifest.manifest.application['@_android:usesCleartextTraffic']),
        'false',
      );
      const policy = parser.parse(
        readFileSync(path.join(main, 'res/xml/network_security_config.xml'), 'utf8'),
      )['network-security-config'];
      assert.equal(String(policy['base-config']['@_cleartextTrafficPermitted']), 'false');
      assert.deepEqual(Object.keys(policy['base-config']), ['@_cleartextTrafficPermitted']);
      const domainConfig = policy['domain-config'];
      assert.equal(String(domainConfig['@_cleartextTrafficPermitted']), 'true');
      assert.deepEqual(
        domainConfig.domain.map((domain) => [
          domain['#text'],
          String(domain['@_includeSubdomains']),
        ]),
        [
          ['localhost', 'false'],
          ['127.0.0.1', 'false'],
        ],
      );
      // Only platform TLS trust is inherited: no custom certificates/debug overrides.
      assert.deepEqual(Object.keys(policy).sort(), ['base-config', 'domain-config']);
      assert.deepEqual(Object.keys(domainConfig).sort(), ['@_cleartextTrafficPermitted', 'domain']);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

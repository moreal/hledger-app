import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assetFingerprint,
  isPublicDomainLicense,
  createAutomaticLogoCatalog,
  matchCandidates,
  parseCandidateResults,
  refreshAutomaticLogos,
} from './automatic-logos.ts';
import type { Asset } from '../../packages/domain/src/asset-catalog.ts';
const asset: Asset = {
  id: 'nasdaq:NASDAQ:AAPL',
  symbol: 'AAPL',
  name: 'Apple Inc. - Common Stock',
  exchange: 'NASDAQ',
  kind: 'STOCK',
  isin: null,
  source: 'nasdaq',
  sourceUrl: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
  asOf: '2026-10-22',
  iconText: 'AA',
  iconUrl: null,
};
const candidate = {
  entity: 'Q312',
  exchange: 'Q82059',
  ticker: 'AAPL',
  logo: 'Apple logo.svg',
  labels: ['Apple Inc.'],
};
test('requires exact ticker/exchange plus normalized issuer identity; ambiguity stays visible', () => {
  assert.equal(matchCandidates(asset, [candidate]).length, 1);
  assert.equal(matchCandidates({ ...asset, name: 'Different Issuer' }, [candidate]).length, 0);
  assert.equal(matchCandidates({ ...asset, exchange: 'NYSE' }, [candidate]).length, 0);
  assert.equal(matchCandidates(asset, [candidate, { ...candidate, entity: 'Q999' }]).length, 2);
});
test('rejects arbitrary candidate URLs', () => {
  assert.throws(() =>
    parseCandidateResults({
      results: {
        bindings: [
          {
            entity: { value: 'http://www.wikidata.org/entity/Q312' },
            exchange: { value: 'http://www.wikidata.org/entity/Q82059' },
            ticker: { value: 'AAPL' },
            label: { value: 'Apple' },
            logo: { value: 'https://evil.example/logo.png' },
          },
        ],
      },
    }),
  );
});
test('serving reads only validated disk cache, fingerprints protect renamed issuers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logos-'));
  const path = join(dir, 'cache.json');
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      counts: {
        processed: 1,
        matched: 1,
        missing: 0,
        ambiguous: 0,
        failed: 0,
        total: 1,
        bounded: false,
      },
      records: [
        {
          fingerprint: assetFingerprint(asset),
          entity: 'Q312',
          imageUrl: 'https://upload.wikimedia.org/test/logo.png',
          sourcePage: 'https://commons.wikimedia.org/wiki/File:Logo.svg',
          license: 'Public domain',
          artist: 'Apple',
        },
      ],
    }),
  );
  const loaded = await createAutomaticLogoCatalog({ snapshotPath: path }).load();
  assert.equal(loaded.status.status, 'READY');
  assert.ok(loaded.get(asset));
  assert.equal(loaded.get({ ...asset, name: 'Different issuer' }), null);
  await writeFile(path, '{}');
  assert.equal(
    (await createAutomaticLogoCatalog({ snapshotPath: path }).load()).status.status,
    'UNAVAILABLE',
  );
});
test('failed refresh preserves last good file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logos-'));
  const catalog = join(dir, 'catalog.json');
  const output = join(dir, 'cache.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      providers: [{ provider: 'nasdaq', updatedAt: new Date().toISOString(), assets: [asset] }],
    }),
  );
  await writeFile(output, 'last good');
  await assert.rejects(
    refreshAutomaticLogos({
      catalogPath: catalog,
      output,
      fetcher: async () => {
        throw new Error('offline');
      },
    }),
  );
  assert.equal(await readFile(output, 'utf8'), 'last good');
});
test('refresh resolves verified candidate through Commons and writes attribution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logos-'));
  const catalog = join(dir, 'catalog.json');
  const output = join(dir, 'cache.json');
  const input = join(dir, 'candidates.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      providers: [{ provider: 'nasdaq', updatedAt: new Date().toISOString(), assets: [asset] }],
    }),
  );
  await writeFile(
    input,
    JSON.stringify({
      results: {
        bindings: [
          {
            entity: { value: 'http://www.wikidata.org/entity/Q312' },
            exchange: { value: 'http://www.wikidata.org/entity/Q82059' },
            ticker: { value: 'AAPL' },
            label: { value: 'Apple Inc.' },
            logo: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Apple%20logo.svg' },
          },
        ],
      },
    }),
  );
  let calls = 0;
  const waits: number[] = [];
  const counts = await refreshAutomaticLogos({
    catalogPath: catalog,
    output,
    input,
    wait: async (ms) => {
      waits.push(ms);
    },
    fetcher: async (url) => {
      calls++;
      if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '2' } });
      assert.ok(String(url).startsWith('https://commons.wikimedia.org/w/api.php?'));
      return new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                title: 'File:Apple logo.svg',
                imageinfo: [
                  {
                    mime: 'image/svg+xml',
                    thumburl: 'https://upload.wikimedia.org/thumb/Apple.svg/96px-Apple.svg.png',
                    extmetadata: {
                      LicenseShortName: { value: 'Public domain' },
                      Artist: { value: '<b>Apple</b>' },
                    },
                  },
                ],
              },
            ],
          },
        }),
      );
    },
  });
  assert.equal(counts.matched, 1);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  const saved = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(saved.records[0].artist, 'Apple');
  assert.equal(
    (await createAutomaticLogoCatalog({ snapshotPath: output }).load()).get(asset),
    saved.records[0].imageUrl,
  );
});

test('license policy excludes attribution-bearing licenses', () => {
  assert.equal(isPublicDomainLicense('Public domain'), true);
  assert.equal(isPublicDomainLicense('PD-textlogo'), true);
  assert.equal(isPublicDomainLicense('CC BY-SA 4.0'), false);
  assert.equal(isPublicDomainLicense('Public domain; CC BY'), false);
});
test('Wikidata some-value logo claims are not candidates', () => {
  assert.deepEqual(
    parseCandidateResults({
      results: { bindings: [{ logo: { value: 'http://www.wikidata.org/.well-known/genid/123' } }] },
    }),
    [],
  );
});
test('rate limit beyond maximum wait preserves cache and identifies provider', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logos-'));
  const catalog = join(dir, 'catalog.json');
  const output = join(dir, 'cache.json');
  await writeFile(
    catalog,
    JSON.stringify({
      version: 1,
      providers: [{ provider: 'nasdaq', updatedAt: new Date().toISOString(), assets: [asset] }],
    }),
  );
  await writeFile(output, 'last good');
  let calls = 0;
  await assert.rejects(
    refreshAutomaticLogos({
      catalogPath: catalog,
      output,
      fetcher: async () => {
        calls++;
        return new Response('', { status: 429, headers: { 'Retry-After': '61' } });
      },
      wait: async () => {
        assert.fail('Must not retry before server permits');
      },
    }),
    /query.wikidata.org HTTP 429/,
  );
  assert.equal(calls, 1);
  assert.equal(await readFile(output, 'utf8'), 'last good');
});

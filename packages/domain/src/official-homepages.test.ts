import test from 'node:test';
import assert from 'node:assert/strict';
import { officialHomepages, getOfficialHomepage } from './official-homepages';
test('official corrections require the exact market, issuer and code and retain evidence', () => {
  assert.equal(new Set(officialHomepages.map(r => `${r.exchange}:${r.symbol}`)).size, officialHomepages.length);
  for (const entry of officialHomepages) {
    assert.ok(entry.url.startsWith('https://'));
    assert.ok(entry.evidenceUrls.length > 0 && entry.evidenceUrls.every(url => url.startsWith('https://')));
    const asset = { source: 'kind', symbol: entry.symbol, exchange: entry.exchange, name: entry.name, kind: 'STOCK' as const };
    assert.equal(getOfficialHomepage(asset), entry);
    assert.equal(getOfficialHomepage({ ...asset, name: '다른 회사' }), null);
    assert.equal(getOfficialHomepage({ ...asset, exchange: 'NASDAQ' }), null);
    assert.equal(getOfficialHomepage({ ...asset, source: 'untrusted' }), null);
  }
});

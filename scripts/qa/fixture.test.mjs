import test from 'node:test';
import assert from 'node:assert/strict';
import { runPath, seedJournal, PORTS } from './fixture.mjs';

test('run names cannot escape the dedicated fake fixture root', () => {
  for (const value of ['', '../real', '/tmp/real', 'a/b', '.', 'a b'])
    assert.throws(() => runPath(value));
  assert.equal(runPath('native-full-001'), '/private/tmp/hledger-qa-full-fixture/native-full-001');
  assert.deepEqual(Object.values(PORTS).sort(), [4200, 4201, 4204]);
});
test('synthetic seed covers pagination, declared parents and historical zero', () => {
  const journal = seedJournal();
  assert.match(journal, /^account 자산$/m);
  assert.match(journal, /^account 자산:예금$/m);
  assert.equal((journal.match(/QA 가상 거래/g) ?? []).length, 65);
  assert.equal((journal.match(/^P .* "QA/gm) ?? []).length, 65);
  assert.ok((journal.match(/^account /gm) ?? []).length > 60);
  assert.match(journal, /2026-10-20 \* \(QA001\) QA 가상 거래 001  ; qa: native/);
  assert.match(
    journal,
    /2026-10-01 \* QA005 historical nonzero\n    assets:qa-zero:history  10 KRW/,
  );
  assert.match(journal, /2026-10-02 \* QA005 historical zero\n    assets:qa-zero:history  -10 KRW/);
});

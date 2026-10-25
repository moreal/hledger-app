import test from 'node:test';
import assert from 'node:assert/strict';
import { ExplicitBookLookup } from './book-lookup';
test('explicit lookup runs once and hide/off/on cannot replay a canceled request', async () => {
  const lookup = new ExplicitBookLookup(); let calls = 0; const accepted: string[] = [];
  let resolve!: (value: string) => void;
  const request = lookup.start(() => { calls++; return new Promise<string>(done => { resolve = done; }); }, value => accepted.push(value), () => assert.fail('unexpected failure'));
  lookup.cancel(); // Hidden or disabled.
  lookup.cancel(); // Reenabled cleanup cannot issue another read.
  resolve('stale metadata'); await request;
  assert.equal(calls,1); assert.equal(accepted.length,0);
  await lookup.start(async () => { calls++; return 'new explicit result'; }, value => accepted.push(value), () => assert.fail('unexpected failure'));
  assert.equal(calls,2); assert.deepEqual(accepted,['new explicit result']);
  lookup.cancel(); assert.deepEqual(accepted,['new explicit result']);
});
test('late success or failure cannot overwrite a more recent explicit lookup', async () => {
  const lookup = new ExplicitBookLookup(); const events: string[] = []; let reject!: (error: Error) => void;
  const older = lookup.start(() => new Promise<string>((_done,fail) => { reject = fail; }), value => events.push(value), () => events.push('old failure'));
  await lookup.start(async () => 'latest', value => events.push(value), () => events.push('new failure'));
  reject(new Error('late')); await older; assert.deepEqual(events,['latest']);
});

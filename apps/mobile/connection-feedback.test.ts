import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerTransportError } from '../../packages/client';
import { failedConnectionMessage } from './connection-feedback';

test('failed candidate connection explains that the authenticated active connection remains', () => {
  const message = failedConnectionMessage(
    new LedgerTransportError('secret-token', 'network'),
    true,
  );
  assert.match(message, /서버에 연결하지 못했습니다/);
  assert.match(message, /이전에 인증한 연결을 계속 사용합니다/);
  assert.doesNotMatch(message, /secret-token|write outcome/);
});

test('failed first connection stays unauthenticated and never reflects internal error text', () => {
  for (const cause of [
    new Error('Bearer secret-token'),
    new TypeError('Invalid URL'),
    new LedgerTransportError('secret-token', 'http', 401),
  ]) {
    const message = failedConnectionMessage(cause, false);
    assert.match(message, /인증된 연결이 없습니다/);
    assert.doesNotMatch(message, /secret-token|Bearer|Invalid URL/);
  }
});

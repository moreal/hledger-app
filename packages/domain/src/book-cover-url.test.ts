import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBookCoverUrl } from './book-cover-url.ts';

test('accepts canonical Aladin cover500 product images', () => {
  const url = 'https://image.aladin.co.kr/product/34000/12/cover500/8936434594_2.jpg';
  assert.equal(normalizeBookCoverUrl(url), url);
});

test('rejects Aladin images outside the canonical public cover route', () => {
  for (const url of [
    'http://image.aladin.co.kr/product/34000/12/cover500/k892932541.jpg',
    'https://image.aladin.co.kr.evil.test/product/34000/12/cover500/k892932541.jpg',
    'https://user@image.aladin.co.kr/product/34000/12/cover500/k892932541.jpg',
    'https://image.aladin.co.kr:8443/product/34000/12/cover500/k892932541.jpg',
    'https://image.aladin.co.kr/product/34000/12/cover200/k892932541.jpg',
    'https://image.aladin.co.kr/product/34000/12/cover500/k892932541.svg',
    'https://image.aladin.co.kr/product/34000/12/cover500/k892932541.jpg?redirect=1',
    'https://image.aladin.co.kr/product/34000/12/cover500/k892932541.jpg#fragment',
    'https://image.aladin.co.kr/product/other/12/cover500/k892932541.jpg',
  ]) assert.equal(normalizeBookCoverUrl(url), null, url);
});

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

test('accepts only canonical positive Open Library cover IDs', () => {
 const url='https://covers.openlibrary.org/b/id/123-L.jpg?default=false';
 assert.equal(normalizeBookCoverUrl(url),url);
 for(const invalid of ['0','-1','01','1.5','9007199254740992']) assert.equal(normalizeBookCoverUrl(`https://covers.openlibrary.org/b/id/${invalid}-L.jpg?default=false`),null);
 for(const invalid of [url.replace('https:','http:'),url.replace('.org/','.org.evil/'),url+'&extra=1',url+'#x',url.replace('?default=false',''),url.replace('/123-','/%31%32%33-')]) assert.equal(normalizeBookCoverUrl(invalid),null);
});

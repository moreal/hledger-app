import test from 'node:test';
import assert from 'node:assert/strict';
import { isPngDataUrl } from './icon-url.ts';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
const uri = (data: string) => `data:image/png;base64,${data}`;

test('recognizes bounded PNG data URLs without Node decoding APIs', () => {
  assert.equal(isPngDataUrl(uri(png)), true);
  assert.equal(isPngDataUrl('https://example.com/icon.png'), false);
});

test('rejects incorrect MIME types, malformed base64, signature and IHDR', () => {
  for (const value of [
    null,
    {},
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PGgxPg==',
    `data:image/png;charset=utf-8;base64,${png}`,
    uri(png + '\n'),
    uri(png.slice(0, -1)),
    uri(png + '='),
    uri('!!!!'),
    uri(png.replace('II=', 'IJ=')),
    uri(Buffer.from('<svg>not a png</svg>').toString('base64')),
  ]) {
    assert.equal(isPngDataUrl(value), false, String(value));
  }
  for (const offset of [0, 11, 12, 19, 24, 25, 26, 27, 28]) {
    const bytes = Buffer.from(png, 'base64');
    bytes[offset] = offset === 19 ? 0 : 255;
    assert.equal(isPngDataUrl(uri(bytes.toString('base64'))), false, `byte ${offset}`);
  }
});

test('bounds decoded bytes even at a base64 padding boundary', () => {
  const bytes = Buffer.alloc(256 * 1024 + 1);
  Buffer.from(png, 'base64').copy(bytes);
  assert.equal(isPngDataUrl(uri(bytes.subarray(0, 256 * 1024).toString('base64'))), true);
  assert.equal(isPngDataUrl(uri(bytes.toString('base64'))), false);
});

test('rejects PNG headers with excessive image dimensions', () => {
  for (const offset of [16, 20]) {
    const bytes = Buffer.from(png, 'base64');
    bytes.writeUInt32BE(4096, offset);
    assert.equal(isPngDataUrl(uri(bytes.toString('base64'))), true);
    bytes.writeUInt32BE(4097, offset);
    assert.equal(isPngDataUrl(uri(bytes.toString('base64'))), false);
    bytes.writeUInt32BE(0x7fffffff, offset);
    assert.equal(isPngDataUrl(uri(bytes.toString('base64'))), false);
  }
});

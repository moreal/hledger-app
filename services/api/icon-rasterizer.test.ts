import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizeIcon } from './icon-rasterizer.js';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#ff0000"/></svg>';
function ico(payload: Buffer, width = 32, height = 16) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width;
  header[7] = height;
  header.writeUInt32LE(payload.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, payload]);
}
test('SVG becomes transparent padded PNG preserving color and aspect', async () => {
  const result = await normalizeIcon(Buffer.from(svg), 'image/svg+xml');
  assert.equal(result.format, 'svg');
  const metadata = await sharp(result.png).metadata();
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  const { data, info } = await sharp(result.png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0);
  assert.deepEqual(
    [...data.subarray((64 * info.width + 64) * 4, (64 * info.width + 64) * 4 + 4)],
    [255, 0, 0, 255],
  );
});
test('ICO PNG payload and raster MIME sniffing', async () => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await normalizeIcon(ico(png), 'image/x-icon')).format, 'ico');
  assert.equal((await normalizeIcon(png, 'application/octet-stream')).format, 'png');
});
test('rejects active or externally referencing SVG', async () => {
  for (const content of [
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + svg,
    svg.replace('<rect', '<script/><rect'),
    svg.replace('<rect', '<image href="https://example.com/a"/><rect'),
    svg.replace('<rect', '<rect style="fill:url(file:///tmp/a)"/><rect'),
  ])
    await assert.rejects(normalizeIcon(Buffer.from(content), 'image/svg+xml'));
});
test('rejects oversized dimensions, bytes, corrupt ICO and inconsistent ICO dimensions', async () => {
  await assert.rejects(normalizeIcon(Buffer.from(svg.replace('32', '5000')), 'image/svg+xml'));
  await assert.rejects(normalizeIcon(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png'));
  await assert.rejects(normalizeIcon(ico(Buffer.from('bad')), 'image/x-icon'));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await assert.rejects(normalizeIcon(ico(png, 16, 16), 'image/x-icon'));
  await assert.rejects(normalizeIcon(ico(png).subarray(0, 30), 'image/x-icon'));
});
test('decodes legacy 32-bit ICO bitmap pixels and rejects truncated mask', async () => {
  const dib = Buffer.alloc(48);
  dib.writeUInt32LE(40);
  dib.writeInt32LE(1, 4);
  dib.writeInt32LE(2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.set([0, 0, 255, 255], 40);
  const normalized = await normalizeIcon(ico(dib, 1, 1), 'image/vnd.microsoft.icon');
  assert.equal(normalized.format, 'ico');
  const data = await sharp(normalized.png).raw().toBuffer();
  assert.deepEqual([...data.subarray(0, 4)], [255, 0, 0, 255]);
  await assert.rejects(normalizeIcon(ico(dib.subarray(0, 47), 1, 1), 'image/x-icon'));
});
test('SVG local gradient paint is supported but nested declarations and entity tricks fail', async () => {
  const gradient =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="a"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path fill="url(#a)" d="M0 0H16V16H0Z"/></svg>';
  assert.equal((await normalizeIcon(Buffer.from(gradient), 'image/svg+xml')).format, 'svg');
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(&#104;ttps://example.com/a)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><animate/></svg>',
  ])
    await assert.rejects(normalizeIcon(Buffer.from(bad), 'image/svg+xml'));
});

test('rejects entity-obfuscated and namespace-bearing external SVG resources', async () => {
  for (const attribute of [
    'fill="u&#114;l(file:///etc/passwd)"',
    'fill="&#117;rl(https://example.com/a)"',
    'fill="&#x75;&#114;&#x6c;(file:///etc/passwd)"',
    'xlink:href="https://example.com/a"',
    'xml:base="https://example.com/" fill="url(#paint)"',
  ]) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect ${attribute} width="16" height="16"/></svg>`;
    await assert.rejects(normalizeIcon(Buffer.from(source), 'image/svg+xml'));
  }
});

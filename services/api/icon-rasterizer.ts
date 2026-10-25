import sharp from 'sharp';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
type IconFormat = 'png' | 'jpeg' | 'webp' | 'ico' | 'svg';
const safeTags = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'title',
  'desc',
]);

function validateSvg(bytes: Buffer): void {
  if (bytes.length > 128 * 1024) throw new Error('SVG exceeds size limit');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!|<\?(?!xml\s)/i.test(source) || XMLValidator.validate(source) !== true)
    throw new Error('Unsafe or malformed SVG');
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    ignoreDeclaration: true,
  }).parse(source);
  let nodes = 0;
  function inspect(value: unknown, depth: number): void {
    if (depth > 32 || ++nodes > 4096) throw new Error('SVG complexity exceeds limit');
    if (Array.isArray(value)) {
      for (const child of value) inspect(child, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('@_')) {
        const name = key.slice(2);
        const text = String(child);
        // The renderer decodes XML character references independently. Reject them
        // in attributes so validation and rendering cannot disagree about URLs.
        if (text.includes('&'))
          throw new Error('SVG attribute character references are unsupported');
        if (
          /^on/i.test(name) ||
          /href|src/i.test(name) ||
          name === 'style' ||
          name === 'xml:base' ||
          /[\\]|@import|expression\s*\(/i.test(text)
        )
          throw new Error('Unsafe SVG attribute');
        // Only local paint-server references are accepted, never remote/file resources.
        if (/url\s*\(/i.test(text) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(text))
          throw new Error('External SVG reference');
      } else if (key === '#text') {
        continue;
      } else {
        if (!safeTags.has(key)) throw new Error('Unsupported SVG element');
        inspect(child, depth + 1);
      }
    }
  }
  if (!parsed || typeof parsed !== 'object' || !('svg' in parsed))
    throw new Error('Missing SVG root');
  inspect(parsed, 0);
}

function decodeIco(bytes: Buffer): {
  input: Buffer;
  width: number;
  height: number;
  raw?: { width: number; height: number; channels: 4 };
} {
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1)
    throw new Error('Malformed ICO');
  const count = bytes.readUInt16LE(4);
  if (count < 1 || count > 64 || bytes.length < 6 + count * 16)
    throw new Error('Invalid ICO directory');
  const entries = [];
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    const size = bytes.readUInt32LE(offset + 8);
    const start = bytes.readUInt32LE(offset + 12);
    if (size < 8 || start < 6 + count * 16 || start > bytes.length - size)
      throw new Error('ICO payload outside bounds');
    entries.push({ width, height, input: bytes.subarray(start, start + size) });
  }
  const entry = entries.sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  if (entry.input.subarray(0, 8).equals(PNG_SIGNATURE)) return entry;
  const dib = entry.input;
  if (
    dib.length < 40 ||
    dib.readUInt32LE(0) !== 40 ||
    dib.readInt32LE(4) !== entry.width ||
    dib.readInt32LE(8) !== entry.height * 2 ||
    dib.readUInt16LE(12) !== 1 ||
    dib.readUInt32LE(16) !== 0
  )
    throw new Error('Unsupported ICO bitmap');
  const bits = dib.readUInt16LE(14);
  if (bits !== 24 && bits !== 32) throw new Error('Unsupported ICO color depth');
  const stride = Math.ceil((entry.width * bits) / 32) * 4;
  const maskStride = Math.ceil(entry.width / 32) * 4;
  const maskStart = 40 + stride * entry.height;
  if (dib.length < maskStart + maskStride * entry.height) throw new Error('Truncated ICO bitmap');
  const pixels = Buffer.alloc(entry.width * entry.height * 4);
  let hasAlpha = false;
  if (bits === 32)
    for (let y = 0; y < entry.height; y++)
      for (let x = 0; x < entry.width; x++) if (dib[40 + y * stride + x * 4 + 3]) hasAlpha = true;
  for (let y = 0; y < entry.height; y++)
    for (let x = 0; x < entry.width; x++) {
      const row = entry.height - 1 - y;
      const from = 40 + row * stride + x * (bits / 8);
      const to = (y * entry.width + x) * 4;
      pixels[to] = dib[from + 2]!;
      pixels[to + 1] = dib[from + 1]!;
      pixels[to + 2] = dib[from]!;
      const masked = (dib[maskStart + row * maskStride + (x >> 3)]! & (128 >> (x % 8))) !== 0;
      pixels[to + 3] = masked ? 0 : bits === 32 && hasAlpha ? dib[from + 3]! : 255;
    }
  return {
    ...entry,
    input: pixels,
    raw: { width: entry.width, height: entry.height, channels: 4 },
  };
}

/** Decode untrusted favicon bytes into a bounded, metadata-free transparent PNG. */
export async function normalizeIcon(
  bytes: Buffer,
  mime: string,
): Promise<{ png: Buffer; format: IconFormat }> {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Icon exceeds size limit');
  const ico = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x00010000;
  const svg =
    /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(
      bytes.toString('utf8', 0, Math.min(bytes.length, 1024)),
    ) || mime.split(';')[0]?.trim().toLowerCase() === 'image/svg+xml';
  if (svg) validateSvg(bytes);
  const decoded = ico ? decodeIco(bytes) : undefined;
  const image = sharp(decoded?.input ?? bytes, {
    limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
    failOn: 'warning',
    ...(decoded?.raw ? { raw: decoded.raw } : {}),
  }).timeout({ seconds: 3 });
  const meta = await image.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width > MAX_DIMENSION ||
    meta.height > MAX_DIMENSION ||
    (meta.pages ?? 1) > 1
  )
    throw new Error('Icon dimensions or frame count exceed limit');
  if (decoded && (meta.width !== decoded.width || meta.height !== decoded.height))
    throw new Error('ICO dimensions disagree');
  const format = ico ? 'ico' : meta.format;
  if (
    format !== 'png' &&
    format !== 'jpeg' &&
    format !== 'webp' &&
    format !== 'ico' &&
    format !== 'svg'
  )
    throw new Error('Unsupported icon format');
  if (format === 'svg' && !svg) throw new Error('Unvalidated SVG');
  const png = await image
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return { png, format };
}

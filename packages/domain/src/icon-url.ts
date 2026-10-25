const PNG_DATA_PREFIX = 'data:image/png;base64,';
const MAX_PNG_BYTES = 256 * 1024;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Accept bounded PNG snapshots without relying on Node APIs in browser/native clients. */
export function isPngDataUrl(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    !value.startsWith(PNG_DATA_PREFIX) ||
    value.length > PNG_DATA_PREFIX.length + 4 * Math.ceil(MAX_PNG_BYTES / 3)
  )
    return false;
  const encoded = value.slice(PNG_DATA_PREFIX.length);
  if (encoded.length < 44 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if ((encoded.length / 4) * 3 - padding > MAX_PNG_BYTES) return false;
  // Require canonical padding, including zero unused bits in the final sextet.
  if (
    padding &&
    (BASE64.indexOf(encoded[encoded.length - padding - 1]!) & (padding === 2 ? 15 : 3)) !== 0
  )
    return false;
  const bytes: number[] = [];
  for (let offset = 0; offset < 44; offset += 4) {
    const bits =
      (BASE64.indexOf(encoded[offset]!) << 18) |
      (BASE64.indexOf(encoded[offset + 1]!) << 12) |
      (BASE64.indexOf(encoded[offset + 2]!) << 6) |
      BASE64.indexOf(encoded[offset + 3]!);
    bytes.push((bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  const dimension = (offset: number) =>
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 256 +
    bytes[offset + 3]!;
  const width = dimension(16),
    height = dimension(20);
  const depths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return (
    width > 0 &&
    width <= 4096 &&
    height > 0 &&
    height <= 4096 &&
    Boolean(depths[bytes[25]!]?.includes(bytes[24]!)) &&
    bytes[26] === 0 &&
    bytes[27] === 0 &&
    (bytes[28] === 0 || bytes[28] === 1)
  );
}

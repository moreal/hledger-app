/** Public image hosts accepted for saved covers; no arbitrary remote URLs. */
export function normalizeBookCoverUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (['www.nl.go.kr', 'nl.go.kr'].includes(url.hostname)) { url.hash = ''; return url.href; }
    if (url.hostname === 'image.yes24.com' && /^\/goods\/\d+\/xl$/.test(url.pathname) && !url.search && !url.hash) return url.href;
    if (url.hostname === 'image.aladin.co.kr' && /^\/product\/\d+\/\d+\/cover500\/[a-zA-Z0-9_-]+\.jpg$/.test(url.pathname) && !url.search && !url.hash) return url.href;
    if (url.hostname !== 'covers.openlibrary.org' || !/^\/b\/isbn\/(?:\d{13})-L\.jpg$/.test(url.pathname) || url.search !== '?default=false' || url.hash) return null;
    return url.href;
  } catch { return null; }
}

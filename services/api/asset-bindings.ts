import { isPngDataUrl } from '../../packages/domain/src/icon-url.ts';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Asset, AssetBinding } from '../../packages/domain/src/asset-catalog.ts';

export type { AssetBinding } from '../../packages/domain/src/asset-catalog.ts';
export interface AssetBindingStore {
  list(commodities?: readonly string[]): Promise<AssetBinding[]>;
  set(commodity: string, asset: Asset | null): Promise<AssetBinding | null>;
}
export class AssetBindingError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'METADATA_UNAVAILABLE', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AssetBindingError';
  }
}
interface BindingFile { version: 1; ledgerId: string; bindings: AssetBinding[] }
const queues = new Map<string, Promise<unknown>>();
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableString = (value: unknown) => value === null || nonblank(value);
function validCommodity(value: unknown): value is string {
  return typeof value === 'string' && nonblank(value) && Array.from(value).length <= 32 && !/[\p{Cc}\p{Cs}]/u.test(value);
}
function safeHttps(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
function validAsset(value: unknown): value is Asset {
  return plainObject(value) && nonblank(value.id) && nonblank(value.symbol) && nonblank(value.name) &&
    nullableString(value.exchange) && ['CURRENCY', 'STOCK', 'CRYPTO'].includes(String(value.kind)) &&
    nullableString(value.isin) && nonblank(value.source) && safeHttps(value.sourceUrl) && nullableString(value.asOf) &&
    nonblank(value.iconText) && (value.iconUrl === null || safeHttps(value.iconUrl) || isPngDataUrl(value.iconUrl));
}
function unavailable(cause: unknown): AssetBindingError {
  return cause instanceof AssetBindingError ? cause : new AssetBindingError('METADATA_UNAVAILABLE', 'Asset bindings could not be read or saved', { cause });
}

/** Only the configured ledger namespace may read or change this metadata file. Journal files are never opened. */
export function createAssetBindingStore(options: { path: string; ledgerId: string }): AssetBindingStore {
  if (!nonblank(options.path) || !nonblank(options.ledgerId)) throw new AssetBindingError('INVALID_INPUT', 'A metadata path and ledger ID are required');
  const path = resolve(options.path);
  const ledgerId = options.ledgerId;
  const directory = dirname(path);

  async function load(): Promise<BindingFile> {
    try {
      // Refuse unexpected files instead of following a metadata symlink or replacing linked data.
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1) throw new Error('Metadata must be a regular, unlinked file');
      const file: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!plainObject(file) || file.version !== 1 || file.ledgerId !== ledgerId || !Array.isArray(file.bindings)) throw new Error('Invalid metadata version or ledger namespace');
      const seen = new Set<string>();
      for (const binding of file.bindings) {
        if (!plainObject(binding) || !validCommodity(binding.commodity) || !validAsset(binding.asset) ||
          typeof binding.updatedAt !== 'string' || !Number.isFinite(Date.parse(binding.updatedAt)) || seen.has(binding.commodity)) throw new Error('Invalid saved asset binding');
        seen.add(binding.commodity);
      }
      return file as unknown as BindingFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, ledgerId, bindings: [] };
      throw unavailable(error);
    }
  }

  async function save(file: BindingFile): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(file) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path);
      const parent = await open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    } finally { await rm(temporary, { force: true }); }
  }

  async function lock(): Promise<() => Promise<void>> {
    const lockPath = `${path}.lock`;
    const owner = `${process.pid}.${randomUUID()}`;
    const staged = `${lockPath}.${randomUUID()}`;
    const deadline = Date.now() + 5000;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await mkdir(staged, { mode: 0o700 });
    try {
      // Atomic publication of a nonempty directory never exposes an incomplete owner marker.
      await writeFile(join(staged, owner), '', { flag: 'wx', mode: 0o600 });
      while (true) {
        try {
          await rename(staged, lockPath);
          return async () => {
            await rm(join(lockPath, owner), { force: true });
            try { await rmdir(lockPath); } catch { /* A newer nonempty owner is never removed. */ }
          };
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          try {
            const owners = await readdir(lockPath);
            const match = owners.length === 1 ? /^([1-9]\d*)\.[\w-]+$/.exec(owners[0]!) : null;
            const pid = match ? Number(match[1]) : NaN;
            if (Number.isSafeInteger(pid)) {
              try { process.kill(pid, 0); }
              catch (check) {
                if ((check as NodeJS.ErrnoException).code === 'ESRCH') {
                  // A unique filename makes racing stale reclaimers unable to unlink a new owner's marker.
                  await rm(join(lockPath, owners[0]!), { force: true });
                  try { await rmdir(lockPath); } catch { /* Another contender may already own the directory. */ }
                  continue;
                }
              }
            }
          } catch { /* Unknown or malformed lock ownership remains fail-closed. */ }
          if (Date.now() >= deadline) throw new Error('Timed out waiting for asset metadata lock');
          await delay(20);
        }
      }
    } finally { await rm(staged, { recursive: true, force: true }); }
  }

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const previous = queues.get(path) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(work);
    queues.set(path, pending);
    void pending.finally(() => { if (queues.get(path) === pending) queues.delete(path); }).catch(() => undefined);
    return pending;
  }

  return {
    async list(commodities) {
      const file = await load();
      const selected = commodities === undefined ? null : new Set(commodities);
      return file.bindings.filter(binding => selected === null || selected.has(binding.commodity));
    },
    async set(commodity, asset) {
      if (!validCommodity(commodity)) throw new AssetBindingError('INVALID_INPUT', 'Commodity must contain 1–32 non-control Unicode characters and cannot be blank');
      if (asset !== null && !validAsset(asset)) throw new AssetBindingError('INVALID_INPUT', 'A valid catalog asset with an HTTPS source and HTTPS or PNG snapshot icon URL is required');
      // Copy before any await so callers cannot change a snapshot while the write is queued.
      const snapshot = asset === null ? null : structuredClone(asset);
      return serialized(async () => {
        try {
          const release = await lock();
          try {
            const file = await load();
            const binding: AssetBinding | null = snapshot === null ? null : { commodity, asset: snapshot, updatedAt: new Date().toISOString() };
            file.bindings = file.bindings.filter(existing => existing.commodity !== commodity);
            if (binding !== null) file.bindings.push(binding);
            await save(file);
            return binding;
          } finally { await release(); }
        } catch (error) { throw unavailable(error); }
      });
    },
  };
}

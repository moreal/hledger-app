import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface BooksFeature { moduleId: string; version: number; migrationVersion: number; enabled: boolean; migratedExistingData: boolean; canRead: boolean; canWrite: boolean; canLookupMetadata: boolean; canRecover: boolean }
export interface FeatureSettingsStore {
  read(): Promise<BooksFeature>;
  setEnabled(enabled: boolean, expectedVersion: number, hasPending?: boolean): Promise<BooksFeature>;
  withBooksEnabled<T>(run: () => Promise<T>): Promise<T>;
}
export class FeatureSettingsError extends Error { constructor(readonly code: string, message: string) { super(message); } }
export function disabledBooksFeature(): BooksFeature { return feature(false, 0, false); }
function feature(enabled: boolean, version: number, migratedExistingData: boolean): BooksFeature { return { moduleId: 'books', version, migrationVersion: 1, enabled, migratedExistingData, canRead: enabled, canWrite: enabled, canLookupMetadata: enabled, canRecover: true }; }
function checkVersion(current: BooksFeature, expected: number, pending: boolean, enabled: boolean) {
  if (!Number.isInteger(expected) || expected < 0) throw new FeatureSettingsError('INVALID_INPUT', 'A valid feature version is required.');
  if (current.version >= 2147483647) throw new FeatureSettingsError('FEATURE_SETTINGS_UNAVAILABLE', 'Feature version limit reached.');
  if (current.version !== expected) throw new FeatureSettingsError('FEATURE_VERSION_CONFLICT', 'Feature settings changed. Refresh and retry.');
  if (!enabled && pending) throw new FeatureSettingsError('PENDING_BOOK_REQUEST', 'Resolve the pending book request before disabling Books.');
}
function requireEnabled(current: BooksFeature) { if (!current.enabled) throw new FeatureSettingsError('FEATURE_DISABLED', 'Books is disabled for this ledger.'); }
const queues = new Map<string, Promise<unknown>>();
export function createFeatureSettingsStore(options: {path: string; ledgerId: string; inspectExisting?: () => Promise<boolean>}): FeatureSettingsStore {
  if (!options.path || !options.ledgerId) throw new Error('Feature path and ledger ID are required.');
  const path = resolve(options.path), directory = dirname(path);
  async function save(current: BooksFeature) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ formatVersion: 1, ledgerId: options.ledgerId, books: current }) + '\n'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path);
      const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
    } finally { await rm(temporary, {force:true}); }
  }
  async function load(): Promise<BooksFeature> {
    let value: any;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1) throw new Error();
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new FeatureSettingsError('FEATURE_SETTINGS_UNAVAILABLE', 'Feature settings are unavailable.');
      let existing = false;
      try { existing = await options.inspectExisting?.() ?? false; } catch { throw new FeatureSettingsError('FEATURE_SETTINGS_UNAVAILABLE', 'Existing book data could not be verified.'); }
      const initial = feature(existing, 0, existing); await save(initial); return initial;
    }
    const b = value?.books;
    if (value?.formatVersion !== 1 || value?.ledgerId !== options.ledgerId || !b || b.moduleId !== 'books' || b.migrationVersion !== 1 || !Number.isInteger(b.version) || b.version < 0 || b.version > 2147483647 || typeof b.enabled !== 'boolean' || typeof b.migratedExistingData !== 'boolean') throw new FeatureSettingsError('FEATURE_SETTINGS_UNAVAILABLE', 'Feature settings are unavailable.');
    return feature(b.enabled,b.version,b.migratedExistingData);
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
          if (Date.now() >= deadline) throw new Error('Timed out waiting for feature settings lock');
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

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    return serialized(async () => { const release = await lock(); try { return await work(); } finally { await release(); } });
  }
  return {
    read: () => guarded(load),
    setEnabled: (enabled, expectedVersion, hasPending = false) => guarded(async () => { const current = await load(); checkVersion(current,expectedVersion,hasPending,enabled); const next = feature(enabled,current.version+1,current.migratedExistingData); await save(next); return next; }),
    withBooksEnabled: run => guarded(async () => { requireEnabled(await load()); return run(); }),
  };
}
/** Explicit opt-in for isolated tests; production must use the durable store. */
export function createMemoryFeatureSettingsStore(options: {enabled?: boolean; ledgerId?: string} = {}): FeatureSettingsStore {
  let current = feature(options.enabled ?? false,0,false), queue: Promise<unknown> = Promise.resolve();
  function guarded<T>(work: () => Promise<T>): Promise<T> { const next=queue.catch(()=>undefined).then(work); queue=next; return next; }
  return { read: () => guarded(async()=>({...current})), setEnabled: (enabled,expectedVersion,hasPending=false)=>guarded(async()=>{ checkVersion(current,expectedVersion,hasPending,enabled); current=feature(enabled,current.version+1,false); return {...current}; }), withBooksEnabled: run=>guarded(async()=>{ requireEnabled(current); return run(); }) };
}

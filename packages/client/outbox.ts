import { isValidCreateConfirmation, LedgerTransportError, type CreateTransactionInput, type CreateTransactionMutation, type GraphQLResult, type LedgerClient } from './index.ts';

export interface OutboxStorage { load(): Promise<string | null>; save(serialized: string): Promise<void> }
export type OutboxState = 'queued' | 'sending' | 'succeeded' | 'blocked' | 'needsReview';
export interface OutboxRecord {
  id: string;
  endpoint: string;
  input: CreateTransactionInput;
  state: OutboxState;
  message?: string;
  result?: GraphQLResult<CreateTransactionMutation>;
}
export interface OutboxTemplate { id: string; name: string; input: Omit<CreateTransactionInput, 'idempotencyKey'> }
interface StoredOutbox { version: 1; records: OutboxRecord[]; templates: OutboxTemplate[] }
export class OutboxPersistenceError extends Error {
  constructor(cause: unknown) { super('Could not persist the outbox. The last durable state has been retained.', { cause }); this.name = 'OutboxPersistenceError'; }
}
export class OutboxCorruptionError extends Error {
  constructor(cause?: unknown) { super('The saved outbox is invalid. Preserve its data for recovery before clearing it.', { cause }); this.name = 'OutboxCorruptionError'; }
}
export class OutboxEndpointError extends Error {
  constructor() { super('This request belongs to another ledger endpoint. Reconnect to its original endpoint to retry.'); this.name = 'OutboxEndpointError'; }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function optionalString(value: unknown) { return value == null || typeof value === 'string'; }
function validCost(value: unknown): boolean {
  return value == null || (object(value) && ['UNIT', 'TOTAL'].includes(String(value.type)) && object(value.amount) && typeof value.amount.value === 'string' && typeof value.amount.commodity === 'string');
}
function validInput(value: unknown, withKey: boolean): boolean {
  if (!object(value) || typeof value.date !== 'string' || typeof value.description !== 'string' || !Array.isArray(value.postings) || !optionalString(value.code) || !optionalString(value.clientReference)) return false;
  if (withKey && (typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.length || value.idempotencyKey.length > 128)) return false;
  if (!withKey && 'idempotencyKey' in value) return false;
  if (!value.postings.every(posting => object(posting) && typeof posting.accountName === 'string' && optionalString(posting.memo) && validCost(posting.cost) && object(posting.amount) && typeof posting.amount.commodity === 'string' && typeof posting.amount.value === 'string')) return false;
  return value.tags == null || (Array.isArray(value.tags) && value.tags.every(tag => object(tag) && typeof tag.key === 'string' && typeof tag.value === 'string'));
}
function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && (!url.hash || (url.hash.startsWith('#ledger=') && decodeURIComponent(url.hash.slice(8)).length > 0)); } catch { return false; }
}
function parseStored(serialized: string): StoredOutbox {
  try {
    const data: unknown = JSON.parse(serialized);
    if (!object(data) || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.templates)) throw new Error('Unsupported outbox format.');
    const ids = new Set<string>();
    for (const record of data.records) {
      if (!object(record) || typeof record.id !== 'string' || ids.has(record.id) || !validEndpoint(record.endpoint) || !validInput(record.input, true) || !object(record.input) || record.input.idempotencyKey !== record.id || !['queued', 'sending', 'succeeded', 'blocked', 'needsReview'].includes(String(record.state)) || (record.message !== undefined && typeof record.message !== 'string') || (record.result !== undefined && !object(record.result))) throw new Error('Invalid saved request.');
      ids.add(record.id);
    }
    const templateIds = new Set<string>();
    for (const template of data.templates) {
      if (!object(template) || typeof template.id !== 'string' || !template.id || templateIds.has(template.id) || typeof template.name !== 'string' || !template.name.trim() || !validInput(template.input, false)) throw new Error('Invalid saved template.');
      templateIds.add(template.id);
    }
    return data as unknown as StoredOutbox;
  } catch (cause) { throw new OutboxCorruptionError(cause); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Single owner per storage instance. Nothing automatically sends during hydration or recovery. */
export function createOutbox(storage: OutboxStorage, client: Pick<LedgerClient, 'identity' | 'createTransaction'>) {
  let current: StoredOutbox = { version: 1, records: [], templates: [] };
  let hydrated = false;
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = tail.then(action);
    tail = next.catch(() => undefined);
    return next;
  }
  async function commit(next: StoredOutbox) {
    try { await storage.save(JSON.stringify(next)); }
    catch (cause) { throw new OutboxPersistenceError(cause); }
    current = next;
  }
  async function initialize() {
    if (hydrated) return;
    let saved: string | null;
    try { saved = await storage.load(); } catch (cause) { throw new OutboxPersistenceError(cause); }
    const next = saved === null ? { version: 1 as const, records: [], templates: [] } : parseStored(saved);
    let recovered = false;
    for (const record of next.records) {
      if (record.state === 'sending') { record.state = 'needsReview'; record.message = 'The app stopped during a request. Check the ledger or explicitly retry with the same key.'; recovered = true; }
    }
    if (recovered) await commit(next); else current = next;
    hydrated = true;
  }
  function find(id: string): OutboxRecord {
    const record = current.records.find(item => item.id === id);
    if (!record) throw new Error('Outbox request not found.');
    return record;
  }
  async function replace(record: OutboxRecord) {
    await commit({ ...current, records: current.records.map(item => item.id === record.id ? record : item) });
  }
  async function send(id: string): Promise<OutboxRecord> {
    const record = find(id);
    if (record.endpoint !== client.identity) throw new OutboxEndpointError();
    if (record.state === 'succeeded') return clone(record);
    const wasUncertain = record.state === 'needsReview' || record.state === 'sending';
    const sending: OutboxRecord = { ...record, state: 'sending', message: undefined, result: undefined };
    await replace(sending);
    let completed: OutboxRecord;
    try {
      // A clone prevents a transport implementation from changing the persisted retry input.
      const result = await client.createTransaction(clone(sending.input));
      const payload = result.data?.createTransaction;
      const expectedErrors = payload?.errors ?? [];
      const authenticationFailure = result.errors?.some(error => ['UNAUTHENTICATED', 'UNAUTHORIZED', 'FORBIDDEN', 'BAD_USER_INPUT', 'GRAPHQL_VALIDATION_FAILED', 'LEDGER_MISMATCH'].includes(String(error.extensions?.code)));
      if (expectedErrors.length || authenticationFailure) completed = { ...sending, state: 'blocked', result, message: expectedErrors.map(error => error.message).join('; ') || result.errors?.map(error => error.message).join('; ') || 'The ledger rejected this request.' };
      else if (!result.errors?.length && isValidCreateConfirmation(payload, sending.input.idempotencyKey)) completed = { ...sending, state: 'succeeded', result };
      else completed = { ...sending, state: 'needsReview', result, message: result.errors?.map(error => error.message).join('; ') || 'The server did not confirm this save. Check the ledger or explicitly retry with the same key.' };
    } catch (error) {
      const blocked = error instanceof LedgerTransportError && error.kind === 'http' && [400, 401, 403, 409, 422].includes(error.status ?? 0);
      completed = { ...sending, state: blocked ? 'blocked' : 'needsReview', message: error instanceof Error ? error.message : 'The write outcome is unknown.' };
    }
    if (wasUncertain && completed.state === 'blocked') {
      completed = { ...completed, state: 'needsReview', message: `${completed.message ?? 'The retry was rejected.'} The earlier write outcome is still unknown.` };
    }
    // If this save fails, durable and visible state remain sending; the caller must surface the error.
    await replace(completed);
    return clone(completed);
  }
  function visibleRecords(): OutboxRecord[] {
    return clone(current.records).map(record => record.endpoint !== client.identity && record.state !== 'succeeded' ? { ...record, state: record.state === 'needsReview' || record.state === 'sending' ? record.state : 'blocked', message: new OutboxEndpointError().message } : record);
  }
  return {
    hydrate: () => serialized(async () => { await initialize(); return visibleRecords(); }),
    list: (): OutboxRecord[] => visibleRecords(),
    listTemplates: (): OutboxTemplate[] => clone(current.templates),
    enqueue(input: CreateTransactionInput, options: { send?: boolean } = {}): Promise<OutboxRecord> {
      const captured = clone(input);
      const shouldSend = options.send !== false;
      return serialized(async () => {
        await initialize();
        if (!validInput(captured, true)) throw new TypeError('Invalid outbox transaction input.');
        const existing = current.records.find(record => record.id === captured.idempotencyKey);
        if (existing) {
          if (existing.endpoint !== client.identity) throw new OutboxEndpointError();
          if (canonical(existing.input) !== canonical(captured)) throw new Error('This idempotency key already belongs to different input.');
          // Duplicate enqueues never constitute explicit authorization to repeat a request.
          return clone(existing);
        }
        const record: OutboxRecord = { id: captured.idempotencyKey, endpoint: client.identity, input: captured, state: 'queued' };
        await commit({ ...current, records: [...current.records, record] });
        return shouldSend ? send(record.id) : clone(record);
      });
    },
    retry: (id: string) => serialized(async () => { await initialize(); return send(id); }),
    discard: (id: string) => serialized(async () => { await initialize(); find(id); await commit({ ...current, records: current.records.filter(record => record.id !== id) }); }),
    saveTemplate(name: string, input: CreateTransactionInput | Omit<CreateTransactionInput, 'idempotencyKey'>): Promise<OutboxTemplate> {
      const captured = clone(input);
      return serialized(async () => {
        await initialize();
        if (typeof name !== 'string' || !name.trim()) throw new TypeError('A template name is required.');
        const { idempotencyKey: _key, ...templateInput } = captured as CreateTransactionInput;
        if (!validInput(templateInput, false)) throw new TypeError('Invalid template input.');
        const template: OutboxTemplate = { id: name, name, input: templateInput };
        await commit({ ...current, templates: [...current.templates.filter(item => item.id !== template.id), template] });
        return clone(template);
      });
    },
  };
}
export type Outbox = ReturnType<typeof createOutbox>;

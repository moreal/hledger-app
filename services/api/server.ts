import { createFeatureSettingsStore, type FeatureSettingsStore } from './feature-settings.ts';
import { booksFromTransactions } from './books.ts';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { executeLedgerRequest } from './schema.ts';
import { createHledgerAdapter } from './hledger.ts';
import type { LedgerAdapter } from './types.ts';
import { createAssetCatalog, defaultAssetCatalogPath } from './asset-catalog.ts';
import type { AssetCatalog } from '../../packages/domain/src/asset-catalog.ts';
import { createAssetBindingStore, type AssetBindingStore } from './asset-bindings.ts';

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
];
const bodyLimit = 1_048_576;
export interface ServerOptions {
  adapter: LedgerAdapter;
  token: string;
  port?: number;
  host?: string;
  allowedOrigins?: readonly string[];
  defaultCommodity?: string;
  ledgerId?: string;
  assetCatalog?: AssetCatalog;
  assetBindings?: AssetBindingStore;
  featureSettings?: FeatureSettingsStore;
}
function matchesToken(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(header ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let length = 0;
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      if (length > bodyLimit) {
        request.off('data', onData);
        request.resume();
        rejectBody(Object.assign(new Error('Request too large'), { status: 413 }));
      } else chunks.push(chunk);
    };
    request.on('data', onData);
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () =>
      rejectBody(Object.assign(new Error('Invalid request'), { status: 400 })),
    );
    request.on('aborted', () =>
      rejectBody(Object.assign(new Error('Invalid request'), { status: 400 })),
    );
  });
}
export async function startServer(options: ServerOptions): Promise<Server> {
  if (typeof options.token !== 'string' || options.token.trim().length === 0)
    throw new Error('HLEDGER_API_TOKEN is required.');
  if (
    options.defaultCommodity != null &&
    (!options.defaultCommodity.trim() || [...options.defaultCommodity].length > 32)
  )
    throw new Error('HLEDGER_DEFAULT_COMMODITY must contain 1–32 characters.');
  const ledgerId = options.ledgerId ?? randomUUID();
  const assetCatalog = options.assetCatalog ?? createAssetCatalog();
  const port = options.port ?? 4000;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('HLEDGER_PORT must be between 0 and 65535.');
  const allowedOrigins = new Set(options.allowedOrigins ?? defaultOrigins);
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Allowed origins must be explicit HTTP(S) origins.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
      throw new Error('Allowed origins must be explicit HTTP(S) origins.');
  }
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    const send = (status: number, body: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-request-id': requestId,
      });
      response.end(JSON.stringify(body));
    };
    const failure = (status: number, code: string, message: string) =>
      send(status, { errors: [{ message, extensions: { code, requestId, timestamp } }] });
    try {
      if (request.url !== '/graphql') return failure(404, 'NOT_FOUND', 'Endpoint not found.');
      const origin = request.headers.origin;
      response.setHeader('vary', 'Origin');
      if (origin && !allowedOrigins.has(origin))
        return failure(403, 'ORIGIN_FORBIDDEN', 'This origin is not allowed.');
      if (origin) response.setHeader('access-control-allow-origin', origin);
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = request.headers['access-control-request-headers'];
        if (method && method !== 'POST')
          return failure(405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed.');
        if (
          typeof headers === 'string' &&
          headers
            .split(',')
            .some(
              (value) =>
                !['authorization', 'content-type', 'x-ledger-id'].includes(
                  value.trim().toLowerCase(),
                ),
            )
        )
          return failure(403, 'HEADERS_FORBIDDEN', 'Requested headers are not allowed.');
        response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
        response.setHeader(
          'access-control-allow-headers',
          'Authorization, Content-Type, X-Ledger-Id',
        );
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.headers['x-ledger-id'] != null && request.headers['x-ledger-id'] !== ledgerId)
        return failure(
          409,
          'LEDGER_MISMATCH',
          'This endpoint is connected to a different ledger. Reconnect before writing.',
        );
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST, OPTIONS');
        return failure(405, 'METHOD_NOT_ALLOWED', 'Use POST with a JSON GraphQL request.');
      }
      if (
        request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
      )
        return failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
      if (Number(request.headers['content-length']) > bodyLimit) {
        request.resume();
        return failure(413, 'REQUEST_TOO_LARGE', 'Request body exceeds the allowed size.');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(await readBody(request));
      } catch (error) {
        return (error as { status?: number }).status === 413
          ? failure(413, 'REQUEST_TOO_LARGE', 'Request body exceeds the allowed size.')
          : failure(400, 'INVALID_REQUEST', 'Request must contain valid JSON.');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return failure(400, 'INVALID_REQUEST', 'Request must be a GraphQL JSON object.');
      const { query, variables, operationName } = payload as Record<string, unknown>;
      if (
        typeof query !== 'string' ||
        !query.trim() ||
        (variables != null && (typeof variables !== 'object' || Array.isArray(variables))) ||
        (operationName != null && typeof operationName !== 'string')
      )
        return failure(400, 'INVALID_REQUEST', 'Invalid GraphQL request shape.');
      const result = await executeLedgerRequest({
        adapter: options.adapter,
        query,
        variables: variables as Record<string, unknown> | undefined,
        operationName: operationName as string | undefined,
        authorized: matchesToken(request.headers.authorization, options.token),
        requestId,
        defaultCommodity: options.defaultCommodity,
        ledgerId,
        assetCatalog,
        assetBindings: options.assetBindings,
        featureSettings: options.featureSettings,
      });
      send(200, result);
    } catch {
      failure(500, 'INTERNAL_ERROR', 'The request could not be completed.');
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolveListening();
    });
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const journalPath = process.env.HLEDGER_JOURNAL;
  const token = process.env.HLEDGER_API_TOKEN;
  if (!journalPath || !token) {
    console.error('HLEDGER_JOURNAL and HLEDGER_API_TOKEN are required.');
    process.exitCode = 1;
  } else {
    try {
      const canonicalJournal = realpathSync(journalPath);
      const ledgerId = createHash('sha256').update(canonicalJournal).digest('hex');
      const adapter = createHledgerAdapter({
        journalPath: canonicalJournal,
        hledgerPath: process.env.HLEDGER_BIN,
      });
      const featureSettings = createFeatureSettingsStore({
        path: `${canonicalJournal}.features.json`,
        ledgerId,
        inspectExisting: async () =>
          adapter.inspectReadOnly
            ? booksFromTransactions((await adapter.inspectReadOnly()).transactions).length > 0
            : false,
      });
      const server = await startServer({
        adapter,
        token,
        featureSettings,
        host: process.env.HLEDGER_HOST,
        port: process.env.HLEDGER_PORT ? Number(process.env.HLEDGER_PORT) : undefined,
        allowedOrigins: process.env.HLEDGER_ALLOWED_ORIGINS?.split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        defaultCommodity: process.env.HLEDGER_DEFAULT_COMMODITY,
        ledgerId,
        assetCatalog: createAssetCatalog({
          snapshotPath: defaultAssetCatalogPath(),
          brandfetchClientId: process.env.HLEDGER_BRANDFETCH_CLIENT_ID,
        }),
        assetBindings: createAssetBindingStore({
          path: process.env.HLEDGER_ASSET_METADATA_PATH ?? `${canonicalJournal}.assets.json`,
          ledgerId,
        }),
      });
      const address = server.address();
      if (address && typeof address !== 'string')
        console.log(
          `GraphQL API listening at http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}/graphql`,
        );
      for (const signal of ['SIGTERM', 'SIGINT'] as const)
        process.once(signal, () => {
          server.close();
        });
    } catch {
      console.error(
        'The API could not start. Check the journal, token, host, port and allowed origins.',
      );
      process.exitCode = 1;
    }
  }
}

import {
  disabledBooksFeature,
  FeatureSettingsError,
  type FeatureSettingsStore,
} from './feature-settings.ts';
import { lookupBookMetadata } from './book-metadata.ts';
import {
  proveBookRequest,
  booksFromTransactions,
  purchaseBook,
  disposeBook,
  type PurchaseBookInput,
  type DisposeBookInput,
} from './books.ts';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildSchema,
  graphql,
  GraphQLError,
  GraphQLScalarType,
  Kind,
  valueFromASTUntyped,
  type ExecutionResult,
} from 'graphql';
import {
  parseDecimal,
  parseDate,
  parseDateTime,
  parseJSONObject,
  validateAccountFilter,
  validateTransactionFilter,
  validatePriceFilter,
  validateCreateTransactionInput,
  validateFirst,
  validateDepth,
  validateGraphQLCount,
  type ValidationIssue,
} from '../../packages/api-contract/validation.ts';
import type {
  CreateTransactionInput,
  LedgerAdapter,
  LedgerSnapshot,
  LedgerAccount,
} from './types.ts';
import { accountId } from './hledger.ts';
import type { AssetCatalog } from '../../packages/domain/src/asset-catalog.ts';
import { getCompanyLogo } from '../../packages/domain/src/company-logos.ts';
import type { AssetBindingStore } from './asset-bindings.ts';

type Args = Record<string, any>;
export interface LedgerRequest {
  adapter: LedgerAdapter;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  authorized: boolean;
  requestId?: string;
  defaultCommodity?: string;
  ledgerId?: string;
  assetCatalog?: AssetCatalog;
  assetBindings?: AssetBindingStore;
  featureSettings?: FeatureSettingsStore;
}
const schema = buildSchema(
  readFileSync(new URL('../../packages/api-contract/schema.graphql', import.meta.url), 'utf8'),
);
const cursorSecret = randomBytes(32);
const lastSync = new WeakMap<LedgerAdapter, string>();
for (const [name, parser] of Object.entries({
  Decimal: parseDecimal,
  Date: parseDate,
  DateTime: parseDateTime,
  JSONObject: parseJSONObject,
})) {
  const scalar = schema.getType(name) as GraphQLScalarType;
  scalar.serialize = parser;
  scalar.parseValue = parser;
  scalar.parseLiteral = (node, variables) => {
    if (name !== 'JSONObject' && node.kind !== Kind.STRING)
      throw new TypeError(`${name} requires a string`);
    return parser(valueFromASTUntyped(node, variables));
  };
}
function fail(code: string, message: string, details?: Record<string, any>): never {
  throw new GraphQLError(message, { extensions: { code, ...(details ? { details } : {}) } });
}
function validate(issues: ValidationIssue[]): void {
  if (issues.length) fail('INVALID_INPUT', 'Invalid filter or arguments.', { issues });
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function belongs(postingAccount: string, name: string, descendants = false): boolean {
  return postingAccount === name || (descendants && postingAccount.startsWith(`${name}:`));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined && child !== null)
      .sort(([a], [b]) => compare(a, b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function effective(
  filter: Args | null | undefined,
  kind: 'accounts' | 'transactions' | 'prices',
): Args {
  const result = { ...filter };
  if (kind === 'accounts') {
    result.includeEmpty ??= false;
    result.includeSubaccounts ??= false;
  }
  if (kind === 'transactions') {
    result.includeSubaccounts ??= false;
    if (result.tags) result.tags = [...result.tags].sort((a, b) => compare(a.key, b.key));
    if (!result.tags?.length) delete result.tags;
  }
  return result;
}
function signature(value: string): string {
  return createHmac('sha256', cursorSecret).update(value).digest('base64url');
}
function connection<T>(items: T[], args: Args, revision: string, scope: string, filter: Args) {
  let limit: number;
  try {
    limit = validateFirst(args.first);
  } catch {
    return fail('INVALID_INPUT', 'first must be between 1 and 200.');
  }
  const identity = signature(canonical({ revision, scope, filter }));
  const cursor = (index: number) => {
    const body = Buffer.from(JSON.stringify({ identity, index })).toString('base64url');
    return `${body}.${signature(body)}`;
  };
  let offset = 0;
  if (args.after != null) {
    try {
      if (typeof args.after !== 'string' || args.after.length > 4096) throw new Error();
      const [body, mac, extra] = args.after.split('.');
      if (
        !body ||
        !mac ||
        extra ||
        mac.length !== signature(body).length ||
        !timingSafeEqual(Buffer.from(mac), Buffer.from(signature(body)))
      )
        throw new Error();
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (
        parsed.identity !== identity ||
        !Number.isSafeInteger(parsed.index) ||
        parsed.index < 0 ||
        parsed.index >= items.length
      )
        throw new Error();
      offset = parsed.index + 1;
    } catch {
      return fail(
        'INVALID_CURSOR',
        'The cursor is invalid, stale, or belongs to another connection.',
      );
    }
  }
  const edges = items
    .slice(offset, offset + limit)
    .map((node, index) => ({ cursor: cursor(offset + index), node }));
  return {
    edges,
    limit,
    totalEstimate: validateGraphQLCount(items.length),
    pageInfo: {
      hasNextPage: offset + edges.length < items.length,
      endCursor: edges.at(-1)?.cursor ?? null,
    },
  };
}
/** Exact signed integer arithmetic, preserving the greatest observed fractional scale. */
function addAmounts(amounts: { commodity: string; value: string }[], zeroCommodities: string[]) {
  const grouped = new Map<string, string[]>();
  for (const commodity of zeroCommodities) grouped.set(commodity, []);
  for (const amount of amounts) {
    parseDecimal(amount.value);
    grouped.set(amount.commodity, [...(grouped.get(amount.commodity) ?? []), amount.value]);
  }
  return [...grouped]
    .sort(([a], [b]) => compare(a, b))
    .map(([commodity, values]) => {
      const scale = values.reduce(
        (maximum, value) => Math.max(maximum, value.split('.')[1]?.length ?? 0),
        0,
      );
      const total = values.reduce((sum, value) => {
        const [integer, fraction = ''] = value.replace(/^-/, '').split('.');
        const magnitude = BigInt(integer + fraction.padEnd(scale, '0'));
        return sum + (value.startsWith('-') ? -magnitude : magnitude);
      }, 0n);
      const magnitude = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
      return {
        commodity,
        value: `${total < 0n ? '-' : ''}${scale ? `${magnitude.slice(0, -scale)}.${magnitude.slice(-scale)}` : magnitude}`,
      };
    });
}
function range(filter: Args, date: string): boolean {
  return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
}

export async function executeLedgerRequest(options: LedgerRequest): Promise<ExecutionResult> {
  const requestId = options.requestId ?? randomUUID();
  const timestamp = new Date().toISOString();
  let snapshot: Promise<LedgerSnapshot> | undefined;
  const read = () =>
    (snapshot ??= options.adapter.read().then((value) => {
      lastSync.set(options.adapter, value.readAt);
      return value;
    }));
  const authorize = () => {
    if (!options.authorized) fail('UNAUTHENTICATED', 'A valid bearer token is required.');
  };
  const protectedRead = async () => {
    authorize();
    return read();
  };
  const validateCommodity = (value: unknown) => {
    if (
      typeof value !== 'string' ||
      !value.trim().length ||
      [...value].length > 32 ||
      /[\p{Cc}\p{Cs}]/u.test(value)
    )
      fail(
        'INVALID_INPUT',
        'commodity must contain 1–32 non-control characters and cannot be blank.',
      );
  };
  const bindingStore = () => {
    if (!options.assetBindings)
      fail('ASSET_METADATA_UNAVAILABLE', 'Asset metadata storage is unavailable.');
    return options.assetBindings;
  };
  function accountAmounts(data: LedgerSnapshot, name: string, includeSubaccounts = false) {
    return data.transactions.flatMap((transaction) =>
      transaction.postings
        .filter((posting) => belongs(posting.accountName, name, includeSubaccounts))
        .map((posting) => ({ ...posting.amount, date: transaction.date })),
    );
  }
  function balances(data: LedgerSnapshot, name: string, args: Args, movement = false) {
    authorize();
    if (movement) validate(validateTransactionFilter({ from: args.from, to: args.to }));
    const relevant = accountAmounts(data, name, args.includeSubaccounts ?? false);
    // A parent without direct postings may inherit commodity identity from its children for zero display.
    let commodities = [...new Set(relevant.map((amount) => amount.commodity))];
    if (!commodities.length)
      commodities = [
        ...new Set(
          data.transactions.flatMap((transaction) =>
            transaction.postings
              .filter((posting) => belongs(posting.accountName, name, true))
              .map((posting) => posting.amount.commodity),
          ),
        ),
      ];
    if (!commodities.length && options.defaultCommodity) commodities = [options.defaultCommodity];
    if (!commodities.length)
      fail(
        'UNDEFINED_COMMODITY',
        'This empty account has no commodity; configure HLEDGER_DEFAULT_COMMODITY.',
      );
    const chosen = relevant.filter((amount) =>
      movement ? range(args, amount.date) : !args.asOf || amount.date <= args.asOf,
    );
    return addAmounts(chosen, commodities);
  }
  function transactions(data: LedgerSnapshot, args: Args, scopeAccount?: string) {
    authorize();
    validate(validateTransactionFilter(args.filter));
    const filter = effective(args.filter, 'transactions');
    if (scopeAccount && filter.accountId && filter.accountId !== accountId(scopeAccount))
      fail('INVALID_INPUT', 'filter.accountId must match the account scope.');
    const name =
      scopeAccount ??
      (filter.accountId
        ? data.accounts.find((account) => accountId(account.name) === filter.accountId)?.name
        : undefined);
    let rows =
      filter.accountId && !name
        ? []
        : data.transactions.filter((transaction) => {
            if (!range(filter, transaction.date)) return false;
            if (
              name &&
              !transaction.postings.some((posting) =>
                belongs(posting.accountName, name, filter.includeSubaccounts),
              )
            )
              return false;
            if (
              filter.commodity &&
              !transaction.postings.some(
                (posting) =>
                  posting.amount.commodity === filter.commodity &&
                  (!name || belongs(posting.accountName, name, filter.includeSubaccounts)),
              )
            )
              return false;
            if (
              filter.tags?.some(
                (tag: { key: string; value: string }) =>
                  !transaction.tags.some(
                    (existing) => existing.key === tag.key && existing.value === tag.value,
                  ),
              )
            )
              return false;
            if (filter.query) {
              const haystack = [
                transaction.description,
                ...transaction.postings.map((posting) => posting.accountName),
                ...transaction.tags.flatMap((tag) => [tag.key, tag.value]),
              ]
                .join('\n')
                .toLowerCase();
              if (!haystack.includes(filter.query.toLowerCase())) return false;
            }
            return true;
          });
    rows = [...rows].sort((a, b) => compare(b.date, a.date) || compare(a.id, b.id));
    return connection(rows, args, data.revision, `transactions:${scopeAccount ?? '*'}`, filter);
  }
  function account(data: LedgerSnapshot, entry: LedgerAccount) {
    const parts = entry.name.split(':');
    const ownTransactions = data.transactions.filter((transaction) =>
      transaction.postings.some((posting) => posting.accountName === entry.name),
    );
    return {
      id: accountId(entry.name),
      name: parts.at(-1),
      fullName: entry.name,
      parentId: parts.length > 1 ? accountId(parts.slice(0, -1).join(':')) : null,
      depth: validateDepth(parts.length, true),
      tags: entry.tags,
      transactionCount: validateGraphQLCount(ownTransactions.length),
      lastPostedDate:
        ownTransactions
          .map((transaction) => transaction.date)
          .sort(compare)
          .at(-1) ?? null,
      balances: (args: Args) => balances(data, entry.name, args),
      movements: (args: Args) => balances(data, entry.name, args, true),
      transactions: (args: Args) => transactions(data, args, entry.name),
    };
  }
  const fieldErrors = (issues: ValidationIssue[]) => ({
    transaction: null,
    idempotency: null,
    errors: issues.map((issue) => ({ ...issue, requestId, timestamp })),
  });
  const bookMutation = async (run: () => Promise<unknown>) => {
    authorize();
    try {
      return await run();
    } catch (error) {
      const code =
        (error as { code?: string; extensions?: { code?: string } }).code ??
        (error as { extensions?: { code?: string } }).extensions?.code;
      if (
        code &&
        [
          'INVALID_INPUT',
          'NOT_FOUND',
          'IDEMPOTENCY_CONFLICT',
          'UNBALANCED',
          'MIXED_COMMODITY',
          'DUPLICATE_TAG',
          'FEATURE_DISABLED',
          'FEATURE_SETTINGS_UNAVAILABLE',
        ].includes(code)
      )
        return {
          book: null,
          idempotency: null,
          errors: [
            {
              code,
              path: (error as { path?: string }).path ?? 'input',
              message: (error as Error).message,
              requestId,
              timestamp,
            },
          ],
        };
      throw error;
    }
  };
  const withBooks = <T>(run: () => Promise<T>): Promise<T> => {
    authorize();
    if (!options.featureSettings) fail('FEATURE_DISABLED', 'Books is disabled for this ledger.');
    return options.featureSettings.withBooksEnabled(run).catch((error) => {
      if (error instanceof FeatureSettingsError) fail(error.code, error.message);
      throw error;
    });
  };
  // First-party module registration keeps optional book operations behind one capability boundary.
  const bookModule = {
    id: 'books',
    version: 1,
    resolvers: {
      bookMetadata: async ({ isbn }: { isbn: string }) => {
        authorize();
        return withBooks(async () => {
          try {
            return await lookupBookMetadata(isbn);
          } catch {
            return fail('INVALID_INPUT', 'Enter a valid ISBN-10 or ISBN-13.');
          }
        });
      },
      books: async () =>
        withBooks(async () => booksFromTransactions((await protectedRead()).transactions)),
      purchaseBook: ({ input }: { input: PurchaseBookInput }) =>
        bookMutation(() => withBooks(() => purchaseBook(options.adapter, input))),
      disposeBook: ({ input }: { input: DisposeBookInput }) =>
        bookMutation(() => withBooks(() => disposeBook(options.adapter, input))),
    },
  };
  const rootValue = {
    ledgerFeatures: async () => {
      authorize();
      return {
        ledgerId: options.ledgerId ?? '',
        books: options.featureSettings
          ? await options.featureSettings.read()
          : disabledBooksFeature(),
      };
    },
    setBooksEnabled: async ({
      enabled,
      expectedVersion,
      hasPending = false,
    }: {
      enabled: boolean;
      expectedVersion: number;
      hasPending?: boolean;
    }) => {
      authorize();
      try {
        if (!options.featureSettings)
          throw new FeatureSettingsError(
            'FEATURE_SETTINGS_UNAVAILABLE',
            'Feature settings are unavailable.',
          );
        return {
          feature: await options.featureSettings.setEnabled(enabled, expectedVersion, hasPending),
          errors: [],
        };
      } catch (error) {
        if (!(error instanceof FeatureSettingsError)) throw error;
        return {
          feature: null,
          errors: [
            {
              code: error.code,
              path: 'expectedVersion',
              message: error.message,
              requestId,
              timestamp,
            },
          ],
        };
      }
    },
    bookRequestStatus: async ({
      input,
    }: {
      input: { purchase?: PurchaseBookInput; disposal?: DisposeBookInput };
    }) => {
      authorize();
      if (Boolean(input.purchase) === Boolean(input.disposal))
        fail('INVALID_INPUT', 'Exactly one original book request is required.');
      return proveBookRequest(
        options.adapter,
        input.purchase
          ? { kind: 'purchase', input: input.purchase }
          : { kind: 'dispose', input: input.disposal! },
      );
    },
    ...bookModule.resolvers,
    health: async () => {
      let connected = false;
      try {
        await read();
        connected = true;
      } catch {
        /* Public status never exposes upstream paths or output. */
      }
      return {
        status: connected ? 'OK' : 'DEGRADED',
        timestamp,
        version: '0.1.0',
        indexerLagSeconds: null,
        connectionStatus: connected ? 'CONNECTED' : 'DISCONNECTED',
        lastSuccessfulSyncAt: lastSync.get(options.adapter) ?? null,
        details: {
          mode: 'direct',
          indexer: false,
          ...(options.authorized && options.ledgerId ? { ledgerId: options.ledgerId } : {}),
        },
      };
    },
    assets: async (args: Args) => {
      authorize();
      const first = args.first ?? 20;
      if (
        typeof args.query !== 'string' ||
        [...args.query].length > 200 ||
        !Number.isInteger(first) ||
        first < 1 ||
        first > 50
      ) {
        fail(
          'INVALID_INPUT',
          'query must contain 0–200 characters and first must be between 1 and 50.',
        );
      }
      if (!options.assetCatalog)
        fail('ASSET_METADATA_UNAVAILABLE', 'The asset catalog is unavailable.');
      try {
        return await options.assetCatalog.search(args.query, first);
      } catch {
        return {
          items: [],
          providers: [
            {
              provider: 'catalog',
              status: 'UNAVAILABLE',
              updatedAt: null,
              message: 'Asset search is temporarily unavailable.',
            },
          ],
        };
      }
    },
    assetBindings: async (args: Args) => {
      authorize();
      if (args.commodities != null) {
        if (args.commodities.length > 200)
          fail('INVALID_INPUT', 'At most 200 commodity filters may be requested.');
        args.commodities.forEach(validateCommodity);
      }
      const store = bindingStore();
      try {
        const bindings = await store.list(args.commodities ?? undefined);
        if (options.assetCatalog?.decorate) {
          const assets = await options.assetCatalog.decorate(
            bindings.map((binding) => binding.asset),
          );
          return bindings.map((binding, index) => ({ ...binding, asset: assets[index]! }));
        }
        return bindings.map((binding) => {
          const logo = getCompanyLogo(binding.asset);
          return logo
            ? { ...binding, asset: { ...binding.asset, iconUrl: logo.imageUrl } }
            : binding;
        });
      } catch {
        return fail('ASSET_METADATA_UNAVAILABLE', 'Asset metadata storage is unavailable.');
      }
    },
    setAssetBinding: async (args: Args) => {
      authorize();
      validateCommodity(args.commodity);
      const store = bindingStore();
      let asset = null;
      if (args.assetId != null) {
        if (typeof args.assetId !== 'string' || !args.assetId.length || args.assetId.length > 512)
          fail('INVALID_INPUT', 'assetId must identify an available catalog asset.');
        if (!options.assetCatalog)
          fail('ASSET_METADATA_UNAVAILABLE', 'The asset catalog is unavailable.');
        try {
          asset = await options.assetCatalog.get(args.assetId);
        } catch {
          return fail('ASSET_METADATA_UNAVAILABLE', 'The asset catalog is unavailable.');
        }
        if (!asset) fail('INVALID_INPUT', 'assetId must identify an available catalog asset.');
      }
      try {
        const binding = await store.set(args.commodity, asset);
        return { commodity: args.commodity, binding };
      } catch {
        return fail('ASSET_METADATA_UNAVAILABLE', 'Asset metadata storage is unavailable.');
      }
    },
    accounts: async (args: Args) => {
      const data = await protectedRead();
      validate(validateAccountFilter(args.filter));
      const filter = effective(args.filter, 'accounts');
      const rows = data.accounts
        .filter((entry) => {
          if (filter.depth && entry.name.split(':').length > filter.depth) return false;
          if (filter.query && !entry.name.toLowerCase().includes(filter.query.toLowerCase()))
            return false;
          if (!filter.includeEmpty) {
            const amounts = accountAmounts(data, entry.name, filter.includeSubaccounts).filter(
              (amount) => !filter.asOf || amount.date <= filter.asOf,
            );
            if (!addAmounts(amounts, []).some((amount) => /[1-9]/.test(amount.value))) return false;
          }
          return true;
        })
        .sort((a, b) => compare(a.name, b.name))
        .map((entry) => account(data, entry));
      return connection(rows, args, data.revision, 'accounts', filter);
    },
    account: async (args: Args) => {
      const data = await protectedRead();
      const entry = data.accounts.find((candidate) => accountId(candidate.name) === args.id);
      return entry ? account(data, entry) : null;
    },
    transactions: async (args: Args) => transactions(await protectedRead(), args),
    prices: async (args: Args) => {
      const data = await protectedRead();
      validate(validatePriceFilter(args.filter));
      const filter = effective(args.filter, 'prices');
      const rows = data.prices
        .filter(
          (price) =>
            range(filter, price.date) &&
            (!filter.commodity || price.commodity === filter.commodity) &&
            (!filter.quoteCommodity || price.quoteCommodity === filter.quoteCommodity),
        )
        .sort(
          (a, b) =>
            compare(b.date, a.date) ||
            compare(a.commodity, b.commodity) ||
            compare(a.quoteCommodity, b.quoteCommodity),
        );
      return connection(rows, args, data.revision, 'prices', filter);
    },
    createTransaction: async ({ input }: { input: CreateTransactionInput }) => {
      authorize();
      if (input.tags?.some((tag) => tag.key.toLowerCase().startsWith('book.')))
        return fieldErrors([
          {
            code: 'INVALID_INPUT',
            path: 'tags',
            message: 'Book metadata tags are reserved for book operations.',
          },
        ]);
      if (
        input.postings.some(
          (posting) =>
            posting.amount.commodity.startsWith('asset:book:') ||
            posting.cost?.amount.commodity.startsWith('asset:book:'),
        )
      )
        return fieldErrors([
          {
            code: 'INVALID_INPUT',
            path: 'postings',
            message: 'Managed book commodities must use book operations.',
          },
        ]);
      const issues = validateCreateTransactionInput(input);
      if (issues.length) return fieldErrors(issues);
      try {
        const result = await options.adapter.create(input);
        return {
          transaction: result.transaction,
          idempotency: { key: input.idempotencyKey, replayed: result.replayed },
          errors: [],
        };
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (
          code &&
          [
            'IDEMPOTENCY_CONFLICT',
            'INVALID_INPUT',
            'UNBALANCED',
            'MIXED_COMMODITY',
            'DUPLICATE_TAG',
            'FEATURE_DISABLED',
            'FEATURE_SETTINGS_UNAVAILABLE',
          ].includes(code)
        ) {
          const path = (error as { path?: string }).path ?? 'input';
          return fieldErrors([
            {
              code,
              path,
              message:
                code === 'IDEMPOTENCY_CONFLICT'
                  ? 'This key was already used with different transaction input.'
                  : 'The transaction input is invalid.',
            },
          ]);
        }
        throw error;
      }
    },
  };
  const result = await graphql({
    schema,
    source: options.query,
    rootValue,
    variableValues: options.variables,
    operationName: options.operationName,
  });
  if (!result.errors) return result;
  return {
    ...result,
    errors: result.errors.map((error) => {
      const code =
        typeof error.extensions.code === 'string'
          ? error.extensions.code
          : error.originalError instanceof FeatureSettingsError
            ? error.originalError.code
            : error.path
              ? 'UPSTREAM_ERROR'
              : 'INVALID_INPUT';
      const safe =
        [
          'UNAUTHENTICATED',
          'INVALID_INPUT',
          'INVALID_CURSOR',
          'UNDEFINED_COMMODITY',
          'ASSET_METADATA_UNAVAILABLE',
          'FEATURE_DISABLED',
          'FEATURE_SETTINGS_UNAVAILABLE',
          'FEATURE_VERSION_CONFLICT',
        ].includes(code) &&
        (typeof error.extensions.code === 'string' ||
          error.originalError instanceof FeatureSettingsError);
      return new GraphQLError(
        safe
          ? error.message
          : error.path
            ? 'The ledger operation could not be completed.'
            : 'The GraphQL request is invalid.',
        {
          path: error.path,
          extensions: {
            code,
            requestId,
            timestamp,
            ...(safe && error.extensions.details ? { details: error.extensions.details } : {}),
          },
        },
      );
    }),
  };
}

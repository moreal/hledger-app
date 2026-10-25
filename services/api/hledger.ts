import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateCreateTransactionInput } from '../../packages/api-contract/validation.ts';
import {
  LedgerError,
  type CreateTransactionInput,
  type LedgerAdapter,
  type LedgerSnapshot,
  type LedgerTransaction,
  type LedgerTag,
  type LedgerPrice,
  type LedgerPosting,
} from './types.ts';

const execute = promisify(execFile);
const marker = 'hledger-app-v1';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const accountId = (name: string): string => `acct_${hash(name).slice(0, 40)}`;

/** JSON emitted by hledger can spell an arbitrary-precision integer as an exponent. */
function integerToken(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) throw new LedgerError('UPSTREAM_FORMAT', 'Invalid decimal mantissa');
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000)
    throw new LedgerError('UPSTREAM_FORMAT', 'Decimal exponent exceeds supported precision');
  let digits = match[2]! + fraction;
  if (exponent >= 0) digits += '0'.repeat(exponent);
  else {
    if (!digits.endsWith('0'.repeat(-exponent)))
      throw new LedgerError('UPSTREAM_FORMAT', 'Fractional decimal mantissa');
    digits = digits.slice(0, exponent) || '0';
  }
  return `${match[1]}${digits.replace(/^0+(?=\d)/, '')}`;
}

export function decimalFromQuantity(quantity: {
  decimalMantissa: string;
  decimalPlaces: string;
}): string {
  const mantissa = integerToken(quantity.decimalMantissa);
  const places = Number(quantity.decimalPlaces);
  if (!Number.isSafeInteger(places) || places < 0 || places > 10000)
    throw new LedgerError('UPSTREAM_FORMAT', 'Invalid decimal places');
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace(/^-/, '').padStart(places + 1, '0');
  return `${negative ? '-' : ''}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
}

/** Quote numeric tokens before JSON.parse: the JS parser never receives a mantissa as Number. */
function losslessJSON(text: string): any {
  return JSON.parse(
    text.replace(
      /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (whole, string: string | undefined, number: string | undefined) =>
        string ?? JSON.stringify(number),
    ),
  );
}

function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(field);
      field = '';
    } else if (!quoted && char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new LedgerError('UPSTREAM_FORMAT', 'Unterminated CSV field');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function exactCSVDecimal(
  value: string,
  style: { asdecimalmark?: string; asdigitgroups?: [string, unknown] | null },
): string {
  let decimal = value;
  if (style.asdigitgroups) decimal = decimal.split(style.asdigitgroups[0]).join('');
  if (style.asdecimalmark && style.asdecimalmark !== '.')
    decimal = decimal.replace(style.asdecimalmark, '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(decimal))
    throw new LedgerError('UPSTREAM_FORMAT', 'Unsupported exact CSV decimal style');
  return decimal;
}

function tagsFromComment(comment: string): LedgerTag[] {
  const tags: LedgerTag[] = [];
  for (const match of comment.matchAll(/(?:^|,)\s*([^,:]+):\s*([^,]*)/g))
    tags.push({ key: match[1]!.trim(), value: match[2]!.trim() });
  return tags;
}

function parsePrices(text: string): LedgerPrice[] {
  const token = '("[^"]*"|[^\\s\\d.,+\\-]+)';
  const directive = new RegExp(
    `^P\\s+(\\d{4}-\\d{2}-\\d{2})(?:\\s+\\d{2}:\\d{2}:\\d{2})?\\s+${token}\\s+(.+)$`,
  );
  // hledger quoted commodity names contain literal backslashes, not JSON escapes.
  const decode = (value: string) => (value.startsWith('"') ? value.slice(1, -1) : value);
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = directive.exec(line);
      if (!match) throw new LedgerError('UPSTREAM_FORMAT', 'Unsupported hledger price directive');
      const right = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*${token}$`).exec(match[3]!);
      const left = new RegExp(`^${token}\\s*(-?\\d+(?:\\.\\d+)?)$`).exec(match[3]!);
      if (!right && !left)
        throw new LedgerError(
          'UPSTREAM_FORMAT',
          'Unsupported price amount style; use a decimal point',
        );
      return {
        date: match[1]!,
        commodity: decode(match[2]!),
        quoteCommodity: decode(right ? right[2]! : left![1]!),
        rate: right ? right[1]! : left![2]!,
        source: null,
      };
    });
}

interface RecordMetadata {
  version: 1;
  key: string;
  fingerprint: string;
  transaction: LedgerTransaction;
}
function decodeMetadata(comment: string): RecordMetadata | undefined {
  const matches = [
    ...comment.matchAll(new RegExp(`(?:^|\\n)\\s*${marker}: ([A-Za-z0-9_-]+)\\s*(?=\\n|$)`, 'g')),
  ];
  if (!matches.length) return;
  if (matches.length !== 1)
    throw new LedgerError('IDEMPOTENCY_METADATA_INVALID', 'Duplicate durable request metadata');
  try {
    const data = JSON.parse(
      Buffer.from(matches[0]![1]!, 'base64url').toString('utf8'),
    ) as RecordMetadata;
    if (
      data.version !== 1 ||
      typeof data.key !== 'string' ||
      typeof data.fingerprint !== 'string' ||
      !data.transaction ||
      data.transaction.source !== 'APP' ||
      data.transaction.id !== `app_${hash(data.key)}`
    )
      throw new Error('Invalid metadata');
    return data;
  } catch {
    throw new LedgerError('IDEMPOTENCY_METADATA_INVALID', 'Invalid durable request metadata');
  }
}

function sameDecimal(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '')
      .replace(/^(-?)0+(?=\d)/, '$1')
      .replace(/^-0$/, '0');
  return normalize(a) === normalize(b);
}
function sameCost(a: LedgerPosting['cost'], b: LedgerPosting['cost']): boolean {
  return (
    (!a && !b) ||
    (!!a &&
      !!b &&
      a.type === b.type &&
      a.amount.commodity === b.amount.commodity &&
      sameDecimal(a.amount.value, b.amount.value))
  );
}

/** Text export retains full precision for costs, whereas hledger JSON rounds them. */
function exactCosts(text: string): NonNullable<LedgerPosting['cost']>[] {
  const costs: NonNullable<LedgerPosting['cost']>[] = [];
  for (const line of text.split('\n')) {
    if (!/^\s+\S/.test(line) || /^\s*;/.test(line)) continue;
    const amountText = line.trimStart().replace(/^.*?\s{2,}/, '');
    const tokens = amountText.match(/"[^"]*"|[^\s]+/g) ?? [];
    const at = tokens.findIndex((token) => token === '@' || token === '@@');
    const comment = tokens.findIndex((token) => token.startsWith(';'));
    if (at < 0 || (comment >= 0 && at > comment)) continue;
    const expression = tokens.slice(at + 1, comment < 0 ? undefined : comment).join(' ');
    const right = /^(-?\d[\d.,]*)\s*("[^"]*"|[^\s\d.,+-]+)$/.exec(expression);
    const left = /^("[^"]*"|[^\s\d.,+-]+)\s*(-?\d[\d.,]*)$/.exec(expression);
    if (!right && !left)
      throw new LedgerError('UPSTREAM_FORMAT', 'Unsupported exact cost amount style');
    const commodity = right ? right[2]! : left![1]!;
    costs.push({
      type: tokens[at] === '@' ? 'UNIT' : 'TOTAL',
      amount: {
        value:
          tokens[at] === '@@'
            ? (right ? right[1]! : left![2]!).replace(/^-/, '')
            : right
              ? right[1]!
              : left![2]!,
        commodity: commodity.startsWith('"') ? commodity.slice(1, -1) : commodity,
      },
    });
  }
  return costs;
}
function verifyRecovered(actual: LedgerTransaction, original: LedgerTransaction): void {
  // Empty tag keys have no hledger tag syntax; their lossless representation is metadata only.
  const expectedTags = original.tags
    .filter((tag) => tag.key)
    .map((tag) => ({ key: tag.key.trim(), value: tag.value.trim() }));
  const comparableTags = (tags: LedgerTag[]) =>
    JSON.stringify([...tags].sort((a, b) => a.key.localeCompare(b.key)));
  if (
    actual.date !== original.date ||
    actual.description !== original.description ||
    actual.code !== original.code ||
    actual.status !== original.status ||
    comparableTags(actual.tags) !== comparableTags(expectedTags) ||
    actual.postings.length !== original.postings.length ||
    actual.postings.some((posting, index) => {
      const before = original.postings[index]!;
      return (
        posting.accountName !== before.accountName ||
        posting.amount.commodity !== before.amount.commodity ||
        !sameDecimal(posting.amount.value, before.amount.value) ||
        posting.memo !== before.memo ||
        !sameCost(posting.cost, before.cost)
      );
    })
  )
    throw new LedgerError(
      'IDEMPOTENCY_METADATA_INVALID',
      'A previously saved transaction was edited; its durable result cannot be replayed safely',
    );
}

function normalizedInput(input: CreateTransactionInput): CreateTransactionInput {
  return {
    idempotencyKey: input.idempotencyKey,
    date: input.date,
    description: input.description,
    code: input.code ?? null,
    postings: input.postings.map((posting) => ({
      accountName: posting.accountName,
      amount: { commodity: posting.amount.commodity, value: posting.amount.value },
      memo: posting.memo ?? null,
      ...(posting.cost
        ? {
            cost: {
              type: posting.cost.type,
              amount: {
                commodity: posting.cost.amount.commodity,
                value: posting.cost.amount.value,
              },
            },
          }
        : {}),
    })),
    tags: input.tags ?? [],
    clientReference: input.clientReference ?? null,
  };
}

function safeString(value: string, path: string, forbidden: RegExp): void {
  // oxlint-disable-next-line no-control-regex -- Reject control characters in untrusted ledger/catalog input.
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) || forbidden.test(value))
    throw new LedgerError(
      'INVALID_INPUT',
      'This field contains journal syntax or control characters that cannot be saved safely',
      path,
    );
}
function quotedCommodity(value: string, path: string): string {
  // hledger accepts digits, spaces and punctuation inside quotes, but neither
  // quotes nor semicolons can be escaped there. Backslashes remain literal.
  safeString(value, path, /[";]/u);
  if (!value.trim())
    throw new LedgerError(
      'INVALID_INPUT',
      'Commodity must contain a non-whitespace character',
      path,
    );
  return `"${value}"`;
}
function validate(input: CreateTransactionInput): void {
  const issues = validateCreateTransactionInput(input);
  if (issues.length) {
    const issue = issues[0]!;
    throw new LedgerError(issue.code, issue.message, issue.path);
  }
  safeString(input.description, 'description', /;|^[*!([\s]/u);
  if (input.description !== input.description.trim())
    throw new LedgerError(
      'INVALID_INPUT',
      'Description must not have surrounding whitespace',
      'description',
    );
  if (input.code != null) safeString(input.code, 'code', /[();]/u);
  for (const [index, posting] of input.postings.entries()) {
    safeString(
      posting.accountName,
      `postings[${index}].accountName`,
      /[;[\](){}=@]|\s{2}|^\s|\s$|^:|:$|::/u,
    );
    if (posting.accountName.split(':').length > 20)
      throw new LedgerError(
        'INVALID_INPUT',
        'Account depth exceeds 20',
        `postings[${index}].accountName`,
      );
    quotedCommodity(posting.amount.commodity, `postings[${index}].amount.commodity`);
    if (posting.cost)
      quotedCommodity(posting.cost.amount.commodity, `postings[${index}].cost.amount.commodity`);
    if (posting.memo != null)
      safeString(posting.memo, `postings[${index}].memo`, /[;[\]]|(?:^|\s|,)date2?\s*:/iu);
  }
  for (const [index, tag] of (input.tags ?? []).entries()) {
    safeString(tag.key, `tags[${index}].key`, /[,:;]/u);
    safeString(tag.value, `tags[${index}].value`, /[,;]/u);
    if (tag.key.toLowerCase().startsWith('hledger-app'))
      throw new LedgerError(
        'INVALID_INPUT',
        'This tag name is reserved for durable request metadata',
        `tags[${index}].key`,
      );
  }
}

export function createHledgerAdapter(options: {
  journalPath: string;
  hledgerPath?: string;
}): LedgerAdapter {
  const journalPath = resolve(options.journalPath);
  const pendingPath = `${journalPath}.hledger-app.pending`;
  const hledgerPath = options.hledgerPath ?? 'hledger';
  const cli = async (
    command: string,
    flags: string[] = [],
    path = journalPath,
  ): Promise<string> => {
    try {
      const { stdout } = await execute(hledgerPath, ['-f', `journal:${path}`, command, ...flags], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 20000,
        env: { ...process.env, NO_COLOR: '1' },
      });
      return stdout;
    } catch (error) {
      const failure = error as Error & { stderr?: string };
      throw new LedgerError(
        'UPSTREAM_UNAVAILABLE',
        `hledger could not read the configured journal: ${(failure.stderr || failure.message).slice(0, 1500)}`,
      );
    }
  };

  const fileRevision = async (path = journalPath): Promise<string> => {
    const files = (await cli('files', [], path)).trim().split('\n').filter(Boolean);
    const contents = await Promise.all(
      files.map(async (file) => [file, hash(await readFile(file, 'utf8'))]),
    );
    return hash(JSON.stringify(contents));
  };

  async function load(
    path = journalPath,
  ): Promise<{ snapshot: LedgerSnapshot; records: RecordMetadata[] }> {
    const before = await fileRevision(path);
    const [jsonText, csvText, accountText, priceText, journalText] = await Promise.all([
      cli('print', ['-O', 'json'], path),
      cli('print', ['-O', 'csv'], path),
      cli('accounts', ['--directives'], path),
      cli('prices', [], path),
      cli('print', ['--explicit'], path),
    ]);
    if ((await fileRevision(path)) !== before)
      throw new LedgerError(
        'LEDGER_CHANGED',
        'Journal changed during the read; retry with a fresh snapshot',
      );
    const revision = hash(JSON.stringify([jsonText, csvText, accountText, priceText, before]));
    const rows = csv(csvText).slice(1);
    const raw = losslessJSON(jsonText) as any[];
    // Reject semantics that cannot be represented before parsing or exposing any postings.
    for (const transaction of raw) {
      const metadata = decodeMetadata(transaction.tcomment);
      if (!metadata) {
        for (const posting of transaction.tpostings) {
          if (posting.ptype !== 'RegularPosting')
            throw new LedgerError(
              'UPSTREAM_FORMAT',
              'Unsupported virtual posting: the application cannot preserve virtual posting semantics',
            );
          if (posting.pamount.some((amount: any) => amount.acostbasis))
            throw new LedgerError(
              'UPSTREAM_FORMAT',
              'Unsupported cost basis annotation: the application supports transaction costs only',
            );
          if (posting.pdate || posting.pdate2)
            throw new LedgerError(
              'UPSTREAM_FORMAT',
              'Unsupported posting date: the application supports transaction dates only',
            );
          if (posting.pbalanceassertion)
            throw new LedgerError(
              'UPSTREAM_FORMAT',
              'Unsupported posting balance assertion: the application cannot preserve assertion semantics',
            );
        }
      }
    }
    const costs = exactCosts(journalText);
    let costIndex = 0;
    const records: RecordMetadata[] = [];
    const seenKeys = new Set<string>();
    const transactions: LedgerTransaction[] = raw.map((transaction) => {
      const metadata = decodeMetadata(transaction.tcomment);
      const transactionRows = rows.filter((row) => row[0] === String(transaction.tindex));
      let rowIndex = 0;
      const postings = transaction.tpostings.flatMap((posting: any) =>
        posting.pamount.map((amount: any) => {
          const row = transactionRows[rowIndex++];
          if (!row || row[7] !== posting.paccount || row[9] !== amount.acommodity)
            throw new LedgerError(
              'UPSTREAM_FORMAT',
              'Exact CSV postings do not match hledger metadata',
            );
          // hledger JSON rounds aquantity to ten places; CSV is its lossless exported amount.
          decimalFromQuantity(amount.aquantity);
          let cost: LedgerPosting['cost'] = null;
          if (amount.acost) {
            if (!['UnitCost', 'TotalCost'].includes(amount.acost.tag))
              throw new LedgerError('UPSTREAM_FORMAT', 'Unknown hledger cost annotation');
            cost = costs[costIndex++];
            if (cost)
              cost.amount.value = exactCSVDecimal(cost.amount.value, amount.acost.contents.astyle);
            if (
              !cost ||
              cost.type !== (amount.acost.tag === 'UnitCost' ? 'UNIT' : 'TOTAL') ||
              cost.amount.commodity !== amount.acost.contents.acommodity
            )
              throw new LedgerError(
                'UPSTREAM_FORMAT',
                'Exact cost export does not match hledger metadata',
              );
          }
          return {
            cost,
            accountId: accountId(posting.paccount),
            accountName: posting.paccount,
            amount: { commodity: row[9]!, value: exactCSVDecimal(row[8]!, amount.astyle) },
            memo: posting.pcomment ? String(posting.pcomment).replace(/\n$/, '') : null,
          };
        }),
      );
      if (rowIndex !== transactionRows.length)
        throw new LedgerError('UPSTREAM_FORMAT', 'Unexpected extra CSV posting rows');
      const result: LedgerTransaction = {
        id: `txn_${hash(JSON.stringify([revision, transaction.tsourcepos, transaction.tindex])).slice(0, 64)}`,
        date: transaction.tdate,
        description: transaction.tdescription,
        code: transaction.tcode || null,
        status:
          transaction.tstatus === 'Cleared'
            ? 'CLEARED'
            : transaction.tstatus === 'Pending'
              ? 'PENDING'
              : 'UNMARKED',
        postings,
        tags: transaction.ttags
          .filter(([key]: [string, string]) => key !== marker)
          .map(([key, value]: [string, string]) => ({ key, value })),
        createdAt: null,
        source: 'HLEDGER',
      };
      if (metadata) {
        if (
          transaction.tpostings.some(
            (posting: any) =>
              posting.pdate ||
              posting.pdate2 ||
              posting.ptype !== 'RegularPosting' ||
              posting.pstatus !== 'Unmarked' ||
              posting.pbalanceassertion ||
              posting.pamount.some((amount: any) => amount.acostbasis),
          )
        )
          throw new LedgerError(
            'IDEMPOTENCY_METADATA_INVALID',
            'Previously saved postings contain unsupported changes to dates, status, costs or assertions',
          );
        if (seenKeys.has(metadata.key))
          throw new LedgerError(
            'IDEMPOTENCY_METADATA_INVALID',
            'Duplicate durable request keys in journal',
          );
        seenKeys.add(metadata.key);
        verifyRecovered(result, metadata.transaction);
        records.push(metadata);
        return metadata.transaction;
      }
      return result;
    });
    if (costIndex !== costs.length)
      throw new LedgerError('UPSTREAM_FORMAT', 'Unexpected exact cost annotations');
    const accounts = accountText
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, ...comments] = line.replace(/^account /, '').split(/\s+;\s*/);
        return { name: name!, tags: tagsFromComment(comments.join(', ')) };
      });
    return {
      snapshot: {
        revision,
        accounts,
        transactions,
        prices: parsePrices(priceText),
        readAt: new Date().toISOString(),
      },
      records,
    };
  }

  async function acquireRecoveryGuard(path: string): Promise<(() => Promise<void>) | null> {
    const owner = `${process.pid}.${randomUUID()}`;
    const staged = `${path}.${randomUUID()}`;
    await mkdir(staged, { mode: 0o700 });
    try {
      await writeFile(join(staged, owner), '', { flag: 'wx', mode: 0o600 });
      try {
        // Publishing a nonempty directory is atomic. rename cannot replace a held,
        // nonempty guard; an empty guard left by an old crash is safely replaceable.
        await rename(staged, path);
        return async () => {
          await rm(join(path, owner), { force: true });
          try {
            await rmdir(path);
          } catch {
            /* A new nonempty owner is never removed. */
          }
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error;
        const owners = await readdir(path);
        const match = owners.length === 1 ? /^([1-9]\d*)\.[\w-]+$/.exec(owners[0]!) : null;
        const pid = match ? Number(match[1]) : NaN;
        if (Number.isSafeInteger(pid)) {
          try {
            process.kill(pid, 0);
          } catch (check) {
            if ((check as NodeJS.ErrnoException).code === 'ESRCH') {
              // Each owner has a unique filename. A racing stale reclaimer cannot
              // unlink a newer owner's marker; rmdir also refuses a nonempty guard.
              await rm(join(path, owners[0]!), { force: true });
              try {
                await rmdir(path);
              } catch {
                /* Another contender may have won. */
              }
            }
          }
        }
        return null;
      }
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
  }

  async function withLock<T>(work: () => Promise<T>): Promise<T> {
    const lockPath = `${journalPath}.hledger-app.lock`;
    const token = randomUUID();
    const deadline = Date.now() + 15000;
    while (true) {
      // A symlink's complete target is created atomically; a killed process cannot leave
      // an empty owner file between exclusive creation and writing its PID.
      try {
        await symlink(JSON.stringify({ pid: process.pid, token }), lockPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const contents = await readlink(lockPath);
          const existing = JSON.parse(contents) as { pid: number };
          if (!Number.isSafeInteger(existing.pid) || existing.pid < 1)
            throw new Error('Invalid lock');
          try {
            process.kill(existing.pid, 0);
          } catch (check) {
            if ((check as NodeJS.ErrnoException).code === 'ESRCH') {
              // Serialize stale-owner reclamation so a second reclaimer cannot unlink
              // the live lock acquired immediately after the first one removes it.
              const reclamation = `${lockPath}.recovery`;
              try {
                const release = await acquireRecoveryGuard(reclamation);
                if (release) {
                  try {
                    if ((await readlink(lockPath)) === contents) await rm(lockPath);
                  } finally {
                    await release();
                  }
                  continue;
                }
              } catch {
                /* Recovery already in progress; remain fail-closed. */
              }
            }
          }
        } catch {
          /* A lock being initialized is still held; malformed locks never permit a write. */
        }
        if (Date.now() >= deadline)
          throw new LedgerError(
            'LEDGER_BUSY',
            'Another writer holds the journal lock; retry later',
          );
        await delay(40);
      }
    }
    try {
      return await work();
    } finally {
      try {
        const current = JSON.parse(await readlink(lockPath));
        if (current.token === token) await rm(lockPath);
      } catch {
        /* Never remove a replacement owner's lock. */
      }
    }
  }

  async function syncDirectory(): Promise<void> {
    const handle = await open(dirname(journalPath), 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  interface PendingWrite {
    version: 1;
    beforeSize: number;
    beforeHash: string;
    ino: number;
    dev: number;
    block: string;
    blockHash: string;
    key: string;
  }
  async function savePending(pending: PendingWrite): Promise<void> {
    const temporary = `${pendingPath}.${randomUUID()}`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(pending));
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Atomic no-replace publication, after every recovery byte is durable.
      await link(temporary, pendingPath);
      await syncDirectory();
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function recoverPending(): Promise<void> {
    let pending: PendingWrite;
    try {
      const info = await lstat(pendingPath);
      if (!info.isFile())
        throw new LedgerError(
          'WRITE_RECOVERY_REQUIRED',
          'Unexpected pending-write file; manual inspection is required',
        );
      pending = JSON.parse(await readFile(pendingPath, 'utf8')) as PendingWrite;
      if (
        pending.version !== 1 ||
        !Number.isSafeInteger(pending.beforeSize) ||
        pending.beforeSize < 0 ||
        typeof pending.beforeHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(pending.beforeHash) ||
        typeof pending.block !== 'string' ||
        typeof pending.blockHash !== 'string' ||
        hash(pending.block) !== pending.blockHash ||
        typeof pending.key !== 'string'
      )
        throw new Error('Invalid pending write');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof LedgerError) throw error;
      throw new LedgerError(
        'WRITE_RECOVERY_REQUIRED',
        'Pending write metadata is unreadable; manual inspection is required',
      );
    }
    const info = await lstat(journalPath);
    const contents = await readFile(journalPath);
    const block = Buffer.from(pending.block, 'base64');
    const prefix = contents.subarray(0, pending.beforeSize);
    const suffix = contents.subarray(pending.beforeSize);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.ino !== pending.ino ||
      info.dev !== pending.dev ||
      prefix.length !== pending.beforeSize ||
      hash(prefix.toString('base64')) !== pending.beforeHash ||
      !(suffix.length <= block.length
        ? block.subarray(0, suffix.length).equals(suffix)
        : suffix.subarray(0, block.length).equals(block))
    ) {
      throw new LedgerError(
        'WRITE_RECOVERY_REQUIRED',
        'External edits overlap an interrupted write; no journal bytes were changed. Inspect the journal and pending-write file before retrying',
      );
    }
    if (suffix.length < block.length) {
      const handle = await open(journalPath, 'a');
      try {
        const current = await handle.stat();
        if (
          current.ino !== info.ino ||
          current.dev !== info.dev ||
          current.size !== contents.length
        )
          throw new LedgerError(
            'LEDGER_CHANGED',
            'Journal changed during interrupted-write recovery',
          );
        await handle.writeFile(block.subarray(suffix.length));
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      const handle = await open(journalPath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const checked = await load();
    if (!checked.records.some((record) => record.key === pending.key))
      throw new LedgerError(
        'WRITE_RECOVERY_REQUIRED',
        'Recovered write has no matching durable request metadata',
      );
    await rm(pendingPath);
    await syncDirectory();
  }

  return {
    inspectReadOnly: async () => {
      // A pending append may be incomplete. Leave every recovery byte untouched.
      const requireNoPending = async () => {
        try {
          await lstat(pendingPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        throw new LedgerError(
          'WRITE_RECOVERY_REQUIRED',
          'Pending writes cannot be inspected as completed requests',
        );
      };
      await requireNoPending();
      const initialRevision = await fileRevision();
      const loaded = await load();
      await requireNoPending();
      if ((await fileRevision()) !== initialRevision)
        throw new LedgerError('LEDGER_CHANGED', 'Journal changed during read-only inspection');
      return loaded.snapshot;
    },
    read: async () =>
      withLock(async () => {
        await recoverPending();
        return (await load()).snapshot;
      }),
    create: async (input) => {
      validate(input);
      const normalized = normalizedInput(input);
      const fingerprint = hash(JSON.stringify(normalized));
      return withLock(async () => {
        await recoverPending();
        const initial = await load();
        const previous = initial.records.find((record) => record.key === input.idempotencyKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new LedgerError(
              'IDEMPOTENCY_CONFLICT',
              'This idempotency key was already used for different input',
            );
          return { transaction: previous.transaction, replayed: true };
        }
        const info = await lstat(journalPath);
        if (!info.isFile() || info.nlink !== 1)
          throw new LedgerError(
            'UNSUPPORTED_JOURNAL',
            'Writes require a regular journal file without symlinks or hard links',
          );
        const original = await readFile(journalPath, 'utf8');
        const transaction: LedgerTransaction = {
          id: `app_${hash(input.idempotencyKey)}`,
          date: input.date,
          description: input.description,
          code: input.code || null,
          status: 'UNMARKED',
          postings: input.postings.map((posting) => ({
            accountId: accountId(posting.accountName),
            accountName: posting.accountName,
            amount: { ...posting.amount },
            ...(posting.cost
              ? { cost: { type: posting.cost.type, amount: { ...posting.cost.amount } } }
              : {}),
            memo: posting.memo || null,
          })),
          tags: input.tags ?? [],
          createdAt: new Date().toISOString(),
          source: 'APP',
        };
        const metadata: RecordMetadata = {
          version: 1,
          key: input.idempotencyKey,
          fingerprint,
          transaction,
        };
        const block =
          `\n\n${input.date}${input.code ? ` (${input.code})` : ''} ${input.description}\n    ; ${marker}: ${Buffer.from(JSON.stringify(metadata)).toString('base64url')}\n` +
          transaction.tags
            .filter((tag) => tag.key)
            .map((tag) => `    ; ${tag.key}: ${tag.value}\n`)
            .join('') +
          transaction.postings
            .map(
              (posting, index) =>
                `    ${posting.accountName}  ${posting.amount.value} ${quotedCommodity(posting.amount.commodity, `postings[${index}].amount.commodity`)}${posting.cost ? ` ${posting.cost.type === 'UNIT' ? '@' : '@@'} ${posting.cost.amount.value} ${quotedCommodity(posting.cost.amount.commodity, `postings[${index}].cost.amount.commodity`)}` : ''}${posting.memo ? `  ; ${posting.memo}` : ''}\n`,
            )
            .join('');
        const candidate = join(dirname(journalPath), `.hledger-app-${randomUUID()}.journal`);
        try {
          await writeFile(candidate, original + block, { flag: 'wx', mode: 0o600 });
          const checked = await load(candidate);
          if (!checked.records.some((record) => record.key === input.idempotencyKey))
            throw new LedgerError(
              'UNSUPPORTED_JOURNAL',
              'Journal directives prevent safely appending this transaction',
            );
          const now = await lstat(journalPath);
          if (
            now.ino !== info.ino ||
            now.dev !== info.dev ||
            now.size !== info.size ||
            now.mtimeMs !== info.mtimeMs ||
            (await readFile(journalPath, 'utf8')) !== original ||
            (await load()).snapshot.revision !== initial.snapshot.revision
          )
            throw new LedgerError(
              'LEDGER_CHANGED',
              'Journal changed while validating the write; retry with the same key',
            );
          // Append only: an uncooperative external writer cannot have its data overwritten.
          // The request fingerprint and original result share this same durable journal write.
          const bytes = Buffer.from(block);
          await savePending({
            version: 1,
            beforeSize: info.size,
            beforeHash: hash(Buffer.from(original).toString('base64')),
            ino: info.ino,
            dev: info.dev,
            block: bytes.toString('base64'),
            blockHash: hash(bytes.toString('base64')),
            key: input.idempotencyKey,
          });
          const handle = await open(journalPath, 'a');
          try {
            const current = await handle.stat();
            if (current.ino !== info.ino || current.dev !== info.dev || current.size !== info.size)
              throw new LedgerError('LEDGER_CHANGED', 'Journal changed before append');
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rm(pendingPath);
          await syncDirectory();
          return { transaction, replayed: false };
        } finally {
          await rm(candidate, { force: true });
        }
      });
    },
  };
}

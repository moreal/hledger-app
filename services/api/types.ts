import type { CreateTransactionInput } from '../../packages/api-contract/generated/client/graphql.ts';

export type { CreateTransactionInput };
export interface LedgerTag { key: string; value: string }
export interface LedgerAccount { name: string; tags: LedgerTag[] }
export interface LedgerPosting {
  accountId: string | null;
  accountName: string;
  amount: { commodity: string; value: string };
  cost?: { type: 'UNIT' | 'TOTAL'; amount: { commodity: string; value: string } } | null;
  memo: string | null;
}
export interface LedgerTransaction {
  id: string;
  date: string;
  description: string;
  code: string | null;
  status: 'UNMARKED' | 'PENDING' | 'CLEARED';
  postings: LedgerPosting[];
  tags: LedgerTag[];
  createdAt: string | null;
  source: 'HLEDGER' | 'APP';
}
export interface LedgerPrice {
  commodity: string;
  quoteCommodity: string;
  date: string;
  rate: string;
  source: string | null;
}
export interface LedgerSnapshot {
  revision: string;
  accounts: LedgerAccount[];
  transactions: LedgerTransaction[];
  prices: LedgerPrice[];
  readAt: string;
}
export interface LedgerAdapter {
  read(): Promise<LedgerSnapshot>;
  create(input: CreateTransactionInput): Promise<{ transaction: LedgerTransaction; replayed: boolean }>;
}

/** Input/conflict errors are suitable for mutation field errors; storage failures are execution errors. */
export class LedgerError extends Error {
  constructor(public readonly code: string, message: string, public readonly path = 'input') {
    super(message);
    this.name = 'LedgerError';
  }
}

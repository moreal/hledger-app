import { useLingui } from '../../i18n/src/react';
import { formatAssetQuantity } from '../../domain/src/asset-quantity';
export { CurrencyIcon } from './CurrencyIcon';
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AssetIdentity, useAssetMetadata } from './AssetIdentity';
export { AssetIdentity, AssetIcon, AssetMetadataProvider, useAssetMetadata } from './AssetIdentity';

export type IconName =
  | 'accounts'
  | 'transactions'
  | 'plus'
  | 'prices'
  | 'sync'
  | 'search'
  | 'layers'
  | 'arrow'
  | 'chevron'
  | 'check'
  | 'info'
  | 'alert';
const iconPaths: Record<IconName, ReactNode> = {
  accounts: (
    <>
      <path d="M4 5h16v14H4zM4 9h16M9 9v10" />
    </>
  ),
  transactions: (
    <>
      <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  prices: <path d="m4 17 6-6 4 3 6-9m-6 0h6v6" />,
  sync: (
    <>
      <path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 21h20L12 3ZM12 9v5m0 3v.01" />
    </>
  ),
};
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name]}
    </svg>
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }
>(function Button({ variant = 'primary', className = '', type = 'button', ...props }, ref) {
  return (
    <button ref={ref} type={type} className={`button button--${variant} ${className}`} {...props} />
  );
});

export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }
>(function Field(
  { label, hint, error, id, className = '', 'aria-describedby': describedBy, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const descriptions =
    [describedBy, hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={inputId}>{label}</label>
      <input
        ref={ref}
        id={inputId}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={descriptions}
      />
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="field__error" role="alert">
          <Icon name="alert" />
          {error}
        </span>
      )}
    </div>
  );
});

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
export function Notice({
  title,
  children,
  tone = 'neutral',
  action,
}: {
  title: string;
  children?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon
        name={
          tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info'
        }
      />
      <div className="notice__body">
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
export function Money({
  value,
  commodity,
  className = '',
}: {
  value: string;
  commodity: string;
  className?: string;
}) {
  const metadata = useAssetMetadata();
  return (
    <span className={`money ${metadata ? 'money--asset' : ''} ${className}`}>
      {metadata && <AssetIdentity commodity={commodity} />}
      <span className="money__amount">
        {formatAssetQuantity(value, commodity, metadata?.bindings.get(commodity))}
      </span>
    </span>
  );
}
export function AccountRow({
  name,
  path,
  balances,
  count,
  selected = false,
  onClick,
}: {
  name: string;
  path: string;
  depth?: number;
  balances: readonly { value: string; commodity: string }[];
  count: number;
  selected?: boolean;
  onClick?: () => void;
}) {
  const { _ } = useLingui();
  const content = (
    <>
      <span className="account-row__identity">
        <span className="account-glyph">
          <Icon name="accounts" />
        </span>
        <span className="row-copy">
          <strong>{name}</strong>
          <span>{path}</span>
        </span>
      </span>
      <span className="account-row__numbers">
        {balances.map((balance, index) => (
          <Money key={`${balance.commodity}-${index}`} {...balance} />
        ))}
        <span className="row-meta">
          {_(
            /* i18n */ {
              id: 'ui.accounts.transactionCount',
              message: '거래 {count}건',
              values: { count },
            },
          )}
        </span>
      </span>
      {onClick && <Icon className="row-chevron" name="chevron" />}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={`account-row ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className="account-row">{content}</div>
  );
}
export function TransactionRow({
  date,
  description,
  account,
  amount,
  status,
  selected = false,
  onClick,
}: {
  date: string;
  description: string;
  account: string;
  amount: { value: string; commodity: string };
  status: 'unmarked' | 'pending' | 'cleared';
  selected?: boolean;
  onClick?: () => void;
}) {
  const { _ } = useLingui();
  const content = (
    <>
      <span className="transaction-date">
        {date.slice(5).replace('-', '.')}
        <span>{date.slice(0, 4)}</span>
      </span>
      <span className="row-copy">
        <strong>{description}</strong>
        <span>{account}</span>
      </span>
      <span className="transaction-row__end">
        <Money {...amount} />
        <span className="row-meta">
          {status === 'cleared'
            ? _(/* i18n */ { id: 'ui.transactions.status.cleared', message: '확인 완료' })
            : status === 'pending'
              ? _(/* i18n */ { id: 'ui.transactions.status.pending', message: '확인 대기' })
              : _(/* i18n */ { id: 'ui.transactions.status.unmarked', message: '미표시' })}
        </span>
      </span>
      {onClick && <Icon className="row-chevron" name="chevron" />}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={`transaction-row ${selected ? 'is-selected' : ''}`}
      aria-expanded={selected}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className="transaction-row">{content}</div>
  );
}
export function PostingRow({
  index,
  account,
  amount,
  commodity,
  onAccountChange,
  onAmountChange,
  accountError,
  amountError,
  disabled = false,
}: {
  index: number;
  account: string;
  amount: string;
  commodity: string;
  onAccountChange?: (value: string) => void;
  onAmountChange?: (value: string) => void;
  accountError?: string;
  amountError?: string;
  disabled?: boolean;
}) {
  const { _ } = useLingui();
  return (
    <div className="posting-row">
      <span className="posting-index" aria-hidden="true">
        {String(index).padStart(2, '0')}
      </span>
      <Field
        id={`posting-${index}-account`}
        label={_(
          /* i18n */ {
            id: 'ui.postings.accountLabel',
            message: '내역 {index} 항목',
            values: { index },
          },
        )}
        error={accountError}
        value={account}
        onChange={onAccountChange ? (event) => onAccountChange(event.target.value) : undefined}
        readOnly={!onAccountChange}
        disabled={disabled}
        required
        maxLength={512}
      />
      <Field
        id={`posting-${index}-amount`}
        label={_(
          /* i18n */ {
            id: 'ui.postings.amountLabel',
            message: '내역 {index} 금액 / 수량 ({commodity})',
            values: { index, commodity },
          },
        )}
        error={amountError}
        hint={_(/* i18n */ { id: 'ui.postings.amountHint', message: '예: 6500 또는 -6500.00' })}
        value={amount}
        onChange={onAmountChange ? (event) => onAmountChange(event.target.value) : undefined}
        readOnly={!onAmountChange}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        required
      />
    </div>
  );
}

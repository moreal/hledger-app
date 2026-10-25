import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { LedgerTransportError } from '../../../packages/client/index.ts';
import { translateError } from '../../../packages/i18n/src/index.ts';
import { useLingui } from '../../../packages/i18n/src/react.tsx';
import { Field, Notice } from '../../../packages/ui-web/src/index';

function LanguagePreview({ count }: { count: number }) {
  const { i18n } = useLingui();
  const [draft, setDraft] = useState('Example coffee');
  const navigation = [
    i18n._(/* i18n */ { id: 'nav.accounts', message: '항목' }),
    i18n._(/* i18n */ { id: 'nav.transactions', message: '거래' }),
    i18n._(/* i18n */ { id: 'nav.entry', message: '입력' }),
    i18n._(/* i18n */ { id: 'nav.prices', message: '시세' }),
    i18n._(/* i18n */ { id: 'nav.books', message: '책' }),
  ];
  return (
    <main
      className="ledger-app"
      lang={i18n.locale}
      style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 24 }}
    >
      <header style={{ display: 'grid', gap: 20, paddingBlock: 16 }}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <h1>hledger</h1>
        </div>
        <nav
          style={{
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
            color: 'var(--color-muted)',
            fontSize: 'var(--type-label-size)',
          }}
        >
          {navigation.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </nav>
      </header>
      <section
        style={{
          display: 'grid',
          gap: 16,
          padding: 24,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-panel)',
        }}
      >
        <h2>{i18n._(/* i18n */ { id: 'story.connection', message: '연결 설정' })}</h2>
        <p>
          {i18n._(
            /* i18n */ {
              id: 'story.connectionHelp',
              message: '서버 주소와 접근 토큰을 입력해 주세요.',
            },
          )}
        </p>
        <p>
          {i18n._(/* i18n */ { id: 'story.language', message: '언어' })}:{' '}
          {i18n.locale === 'en' ? 'English' : '한국어'}
        </p>
      </section>
      <section
        style={{
          display: 'grid',
          gap: 16,
          padding: 24,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-panel)',
        }}
      >
        <h2>{i18n._(/* i18n */ { id: 'nav.entry', message: '입력' })}</h2>
        <Field
          label={i18n._(/* i18n */ { id: 'story.description', message: '거래 내용' })}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p role="status">
          {i18n._(
            /* i18n */ {
              id: 'story.transactionCount',
              message: '{count, plural, one {거래 #개} other {거래 #개}}',
              values: { count },
            },
          )}
        </p>
        <code style={{ overflowWrap: 'anywhere', color: 'var(--color-muted)' }}>
          assets:example:cash · KRW · 1000.00
        </code>
      </section>
      <Notice
        tone="danger"
        title={translateError(new LedgerTransportError('Synthetic network failure', 'network'))}
      />
    </main>
  );
}

const meta = {
  title: 'App/Language',
  component: LanguagePreview,
  args: { count: 2 },
  argTypes: { count: { control: { type: 'number', min: 0, step: 1 } } },
  parameters: {
    docs: {
      description: {
        component:
          'Switch 한국어 / English in the toolbar. Edit the draft, then switch languages to verify that it is preserved. The count control exercises English singular/plural; account names, asset IDs and exact amounts remain data.',
      },
    },
  },
} satisfies Meta<typeof LanguagePreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NavigationSettingsAndErrors: Story = {};
export const OneTransaction: Story = { args: { count: 1 } };
export const NoTransactions: Story = { args: { count: 0 } };

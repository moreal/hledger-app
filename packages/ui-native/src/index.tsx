import { formatAssetQuantity } from '../../domain/src/asset-quantity';
export { CurrencyIcon } from './CurrencyIcon';
import { useId, useState, type ReactNode } from 'react';
import {
  Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
  type TextInputProps, type ViewStyle,
} from 'react-native';
import { tokens } from '../../design-tokens/src';
import { formatMoney, type GalleryAccount, type GalleryPosting, type GalleryTransaction } from '../../domain/src';
import { AssetIcon, useAssetIdentity } from './AssetIdentity';
export { AssetIdentity, AssetIcon, AssetMetadataProvider, useAssetIdentity } from './AssetIdentity';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
const toneColor = (tone: Tone) => tone === 'neutral' ? tokens.colors.muted : tokens.colors[tone];
const toneSurface = (tone: Tone) => tone === 'neutral' ? tokens.colors.surfaceSubtle : tokens.colors[`${tone}Subtle`];

export function Button({ children, onPress, variant = 'secondary', selected, disabled = false, label, expanded }: {
  children: ReactNode; onPress: () => void; variant?: 'primary' | 'secondary' | 'quiet';
  selected?: boolean; disabled?: boolean; label?: string; expanded?: boolean;
}) {
  const primary = variant === 'primary';
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }), ...(expanded === undefined ? {} : { expanded }) }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, variant === 'quiet' && styles.quietButton,
      selected && styles.selectedButton, primary && styles.primaryButton,
      pressed && !disabled && { backgroundColor: primary ? tokens.colors.accentPressed : tokens.colors.surfacePressed },
      disabled && styles.disabledButton]}>
    <Text style={[styles.buttonText, selected && styles.selectedButtonText, primary && styles.primaryButtonText,
      disabled && styles.disabledButtonText]}>{children}</Text>
  </Pressable>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <View style={[styles.badge, { backgroundColor: toneSurface(tone) }]}>
    <Text style={[styles.badgeText, { color: toneColor(tone) }]}>{children}</Text>
  </View>;
}

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Heading({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return <View style={styles.heading}>
    <Text accessibilityRole="header" style={styles.title}>{children}</Text>
    {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
  </View>;
}

export function Notice({ title, children, tone = 'neutral', action }: {
  title: string; children: ReactNode; tone?: Tone; action?: { label: string; onPress: () => void };
}) {
  return <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: toneSurface(tone), borderLeftColor: toneColor(tone) }]}>
    <Text style={[styles.strong, { color: toneColor(tone) }]}>{title}</Text>
    <Text style={styles.muted}>{children}</Text>
    {action ? <Button onPress={action.onPress}>{action.label}</Button> : null}
  </View>;
}

export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  const readOnly = props.editable === false || props.readOnly;
  return <View style={styles.field}>
    <Text nativeID={labelId} style={styles.label}>{label}</Text>
    <TextInput {...props} accessibilityLabel={`${props.accessibilityLabel ?? label}${error ? ', 오류' : ''}`}
      accessibilityLabelledBy={labelId}
      accessibilityHint={[props.accessibilityHint, readOnly ? '읽기 전용' : undefined, error ?? hint].filter(Boolean).join('. ') || undefined}
      placeholderTextColor={tokens.colors.muted}
      onFocus={event => { setFocused(true); props.onFocus?.(event); }}
      onBlur={event => { setFocused(false); props.onBlur?.(event); }}
      style={[styles.input, props.multiline && styles.multiline, readOnly && styles.readOnlyInput,
        focused && styles.focusedInput, error ? styles.invalidInput : null, props.style]} />
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>오류 · {error}</Text>
      : hint ? <Text style={styles.caption}>{hint}</Text> : null}
  </View>;
}

export function Money({ value, commodity, prominent = false, surface = 'default' }: { value: string; commodity: string; prominent?: boolean; surface?: 'default' | 'feature' }) {
  const { asset, name } = useAssetIdentity(commodity);
  return <View style={styles.moneyGroup}>
    <View style={styles.moneyLine}><AssetIcon commodity={commodity} asset={asset} size={20} />
      <Text selectable accessibilityLabel={`${formatAssetQuantity(value, commodity, asset)}${name ? `, ${name}` : ''}`}
        style={[styles.money, prominent && styles.prominentMoney, surface === 'feature' && { color: tokens.colors.featureText }]}>{formatAssetQuantity(value, commodity, asset)}</Text>
    </View>
    {name ? <Text style={[styles.caption, { textAlign: 'right' }, surface === 'feature' && { color: tokens.colors.featureMuted }]}>{name}</Text> : null}
  </View>;
}

function useStackedRow(amounts: string[]) {
  const { width, fontScale } = useWindowDimensions();
  return Math.min(width, 720) / fontScale < 560 || amounts.some(amount => amount.length > 26);
}

export function AccountRow({ account, selected, onPress }: {
  account: GalleryAccount; selected: boolean; onPress: () => void;
}) {
  const stacked = useStackedRow(account.balances.map(balance => formatMoney(balance.value, balance.commodity)));
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={`${account.path}, 잔액 ${account.balances.map(balance => formatMoney(balance.value, balance.commodity)).join(', ')}, 거래 ${account.transactionCount}건, 항목 상세 보기`}
    accessibilityState={{ selected }} style={({ pressed }) => [styles.row, !stacked && styles.horizontalRow,
      selected && styles.selectedRow, pressed && styles.pressedRow]}>
    <View style={[styles.accountIdentity, !stacked && styles.horizontalCopy]}>
      <View accessible={false} style={styles.accountMark}>
        <View style={styles.markLine} /><View style={styles.markLine} /><View style={styles.markLine} />
      </View>
      <View style={[styles.rowCopy, styles.horizontalCopy]}>
        <Text style={styles.strong}>{account.name || account.path}</Text>
        <Text selectable style={styles.caption}>{account.path}</Text>
        <Text style={styles.caption}>{account.transactionCount}건 · {account.lastTransactionDate ?? '거래 이력 없음'}</Text>
      </View>
    </View>
    <View style={[styles.balances, stacked ? styles.fullWidthAmount : styles.trailingAmount]}>{account.balances.map((balance, index) =>
      <Money key={`${balance.commodity}-${index}`} {...balance} />)}</View>
  </Pressable>;
}

const transactionLabels = { unmarked: '미확인', pending: '보류', cleared: '확인됨' } as const;
export function TransactionRow({ transaction, selected, onPress }: {
  transaction: GalleryTransaction; selected: boolean; onPress: () => void;
}) {
  const amount = transaction.postings[0]?.amount;
  const stacked = useStackedRow(amount ? [formatMoney(amount.value, amount.commodity)] : []);
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={`${transaction.date}, ${transaction.description}, ${transactionLabels[transaction.status]}, ${amount ? formatMoney(amount.value, amount.commodity) : '내역 없음'}, 거래 상세 보기`}
    accessibilityState={{ selected }} style={({ pressed }) => [styles.row, !stacked && styles.horizontalRow,
      selected && styles.selectedRow, pressed && styles.pressedRow]}>
    <View style={[styles.rowCopy, !stacked && styles.horizontalCopy]}>
      <Text style={styles.caption}>{transaction.date} · {transactionLabels[transaction.status]}</Text>
      <Text style={styles.strong}>{transaction.description}</Text>
      <Text style={styles.caption}>{transaction.postings[0]?.accountName ?? '내역 없음'}</Text>
    </View>
    {amount ? <View style={stacked ? styles.fullWidthAmount : styles.trailingAmount}><Money {...amount} /></View> : null}
  </Pressable>;
}

export function PostingRow({ posting }: { posting: GalleryPosting }) {
  const stacked = useStackedRow([formatMoney(posting.amount.value, posting.amount.commodity)]);
  return <View style={styles.posting}>
    <View style={[styles.postingContent, !stacked && styles.horizontalRow]}>
      <Text selectable style={[styles.body, styles.rowCopy, !stacked && styles.horizontalCopy]}>{posting.accountName}</Text>
      <View style={stacked ? styles.fullWidthAmount : styles.trailingAmount}><Money {...posting.amount} /></View>
    </View>
    {posting.memo ? <Text style={styles.caption}>{posting.memo}</Text> : null}
  </View>;
}

export const nativeStyles = StyleSheet.create({
  body: { color: tokens.colors.text, ...tokens.typography.body },
  muted: { color: tokens.colors.muted, ...tokens.typography.supporting },
  // Account paths, dates, and help text carry essential information, so use the supporting role.
  caption: { color: tokens.colors.muted, ...tokens.typography.supporting },
  strong: { color: tokens.colors.text, ...tokens.typography.body, fontWeight: '600' },
});

const styles = StyleSheet.create({
  ...nativeStyles,
  button: { minHeight: tokens.size.controlMin, minWidth: tokens.size.controlMin, paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm, backgroundColor: tokens.colors.surfaceSubtle, borderWidth: 1,
    borderColor: 'transparent', borderRadius: tokens.radius.control, alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  quietButton: { backgroundColor: 'transparent', borderColor: 'transparent' },
  selectedButton: { backgroundColor: tokens.colors.accentSubtle, borderColor: 'transparent' },
  primaryButton: { backgroundColor: tokens.colors.accent, borderColor: tokens.colors.accent },
  buttonText: { ...tokens.typography.label, color: tokens.colors.text, textAlign: 'center', flexShrink: 1 },
  selectedButtonText: { color: tokens.colors.accent },
  primaryButtonText: { color: tokens.colors.onAccent },
  disabledButton: { backgroundColor: tokens.colors.disabledSurface, borderColor: tokens.colors.border },
  disabledButtonText: { color: tokens.colors.disabledText },
  panel: { padding: tokens.space.lg,
    borderRadius: tokens.radius.panel, backgroundColor: tokens.colors.surface, gap: tokens.space.lg },
  heading: { gap: tokens.space.xs },
  title: { ...tokens.typography.title, color: tokens.colors.text },
  badge: { alignSelf: 'flex-start', borderRadius: tokens.radius.pill, maxWidth: '100%',
    paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
  badgeText: { ...tokens.typography.label },
  notice: { borderLeftWidth: 3, borderRadius: tokens.radius.control, padding: tokens.space.lg, gap: tokens.space.sm },
  field: { gap: tokens.space.sm, minWidth: 0 },
  label: { ...tokens.typography.label, color: tokens.colors.text },
  input: { minHeight: tokens.size.controlMin, borderWidth: 1, borderColor: tokens.colors.borderStrong,
    borderRadius: tokens.radius.control, backgroundColor: tokens.colors.surface, padding: tokens.space.md,
    color: tokens.colors.text, ...tokens.typography.body },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  readOnlyInput: { backgroundColor: tokens.colors.surfaceSubtle },
  focusedInput: { borderColor: tokens.colors.focus, borderWidth: 2, padding: tokens.space.md - 1 },
  invalidInput: { borderColor: tokens.colors.danger },
  errorText: { ...tokens.typography.supporting, color: tokens.colors.danger },
  money: { color: tokens.colors.text, ...tokens.typography.amount,
    fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1, minWidth: 0, maxWidth: '100%' },
  prominentMoney: { ...tokens.typography.title, fontVariant: ['tabular-nums'] },
  moneyGroup: { gap: tokens.space.xs, minWidth: 0, maxWidth: '100%' },
  moneyLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: tokens.space.xs, minWidth: 0 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.colors.border,
    paddingHorizontal: 0, paddingVertical: tokens.space.lg, minHeight: tokens.size.controlMin, gap: tokens.space.md },
  accountIdentity: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space.md, minWidth: 0 },
  accountMark: { width: 38, height: 38, borderRadius: tokens.radius.control, backgroundColor: tokens.colors.accentSubtle,
    alignItems: 'center', justifyContent: 'center', gap: 3 },
  markLine: { width: 15, height: 2, borderRadius: 1, backgroundColor: tokens.colors.accent },
  horizontalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedRow: { backgroundColor: tokens.colors.accentSubtle },
  pressedRow: { backgroundColor: tokens.colors.surfacePressed },
  rowCopy: { gap: tokens.space.xs, minWidth: 0, flexShrink: 1 },
  horizontalCopy: { flex: 1 },
  balances: { gap: tokens.space.xs, minWidth: 0 },
  fullWidthAmount: { width: '100%', minWidth: 0 },
  trailingAmount: { maxWidth: '48%', minWidth: 0, flexShrink: 1 },
  posting: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: tokens.colors.border, paddingTop: tokens.space.md, gap: tokens.space.sm },
  postingContent: { gap: tokens.space.sm },
});

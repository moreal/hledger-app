import { i18n, formatTradeValidation } from '../../packages/i18n/src';
import { useLingui } from '../../packages/i18n/src/react';
import { type ComponentProps } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, Notice, nativeStyles } from '../../packages/ui-native/src';
import { buildTradePostings, type TradeInput, type TradePosting } from '../../packages/domain/src/trade';
import { AssetUnitField } from './AssetUnitField';

type AssetProps = Pick<ComponentProps<typeof AssetUnitField>, 'customValues' | 'onComplete' | 'catalogClient' | 'onBind' | 'requestContext'>;
export const newTradeInput = (): TradeInput => ({ side: 'BUY', quantity: '', commodity: '', priceType: 'UNIT', price: '', settlementCommodity: 'KRW', securityAccount: '', cashAccount: '', fee: '0', feeAccount: '' });
export function TradeFields({ disabled, onApply, input, setInput, error, setError, ...assetProps }: AssetProps & { input: TradeInput; setInput: import('react').Dispatch<import('react').SetStateAction<TradeInput>>; error: unknown; setError: (error: unknown) => void; disabled: boolean; onApply: (postings: TradePosting[]) => void }) {
  const { _ } = useLingui();
  const change = (patch: Partial<TradeInput>) => { if (!disabled) { setInput(current => ({ ...current, ...patch })); setError(''); } };
  return <View style={{ gap: 12 }}>
    <Text style={nativeStyles.strong}>{_(/* i18n */ { id: 'native.tradefields.title', message: "주식 매매 내역 만들기" })}</Text>
    <Button disabled={disabled} onPress={() => change({ side: input.side === 'BUY' ? 'SELL' : 'BUY' })}>{_(/* i18n */ { id: 'native.tradefields.directionLabel.sentence', message: "거래 방향: {value0} · 누르면 변경", values: { value0: input.side === 'BUY' ? _(/* i18n */ { id: 'native.tradefields.buy', message: "매수" }) : _(/* i18n */ { id: 'native.tradefields.sell', message: "매도" }) } })}</Button>
    <AssetUnitField {...assetProps} requestContext={input} label={_(/* i18n */ { id: 'native.tradefields.asset', message: "주식 자산" })} value={input.commodity} onChangeText={commodity => change({ commodity })} editable={!disabled} />
    <Field label={_(/* i18n */ { id: 'native.tradefields.quantity', message: "수량 (양수)" })} value={input.quantity} onChangeText={quantity => change({ quantity })} editable={!disabled} keyboardType="numbers-and-punctuation" />
    <Button disabled={disabled} onPress={() => change({ priceType: input.priceType === 'UNIT' ? 'TOTAL' : 'UNIT' })}>{_(/* i18n */ { id: 'native.tradefields.priceTypeLabel.sentence', message: "가격 기준: {value0} · 누르면 변경", values: { value0: input.priceType === 'UNIT' ? _(/* i18n */ { id: 'native.tradefields.unitPrice', message: "1주당 가격" }) : _(/* i18n */ { id: 'native.tradefields.totalPrice', message: "전체 거래 금액" }) } })}</Button>
    <Field label={input.priceType === 'UNIT' ? _(/* i18n */ { id: 'native.tradefields.unitPriceLabel', message: "1주당 가격" }) : _(/* i18n */ { id: 'native.tradefields.totalPriceLabel', message: "전체 거래 금액" })} value={input.price} onChangeText={price => change({ price })} editable={!disabled} keyboardType="numbers-and-punctuation" />
    <AssetUnitField {...assetProps} requestContext={input} label={_(/* i18n */ { id: 'native.tradefields.settlement', message: "결제 자산" })} value={input.settlementCommodity} onChangeText={settlementCommodity => change({ settlementCommodity })} editable={!disabled} />
    <Field label={_(/* i18n */ { id: 'native.tradefields.securityAccount', message: "주식 보유 항목 경로" })} value={input.securityAccount} onChangeText={securityAccount => change({ securityAccount })} editable={!disabled} autoCapitalize="none" />
    <Field label={_(/* i18n */ { id: 'native.tradefields.cashAccount', message: "현금 항목 경로" })} value={input.cashAccount} onChangeText={cashAccount => change({ cashAccount })} editable={!disabled} autoCapitalize="none" />
    <Field label={_(/* i18n */ { id: 'native.tradefields.fee', message: "수수료 (결제 자산, 0 이상)" })} value={input.fee} onChangeText={fee => change({ fee })} editable={!disabled} keyboardType="numbers-and-punctuation" />
    <Field label={_(/* i18n */ { id: 'native.tradefields.feeAccount', message: "수수료 비용 항목 경로" })} value={input.feeAccount} onChangeText={feeAccount => change({ feeAccount })} editable={!disabled} autoCapitalize="none" />
    {!!error && <Notice title={_(/* i18n */ { id: 'native.tradefields.validationTitle', message: "매매 입력을 확인해 주세요" })} tone="danger">{_(/* i18n */ { id: 'native.tradefields.validationHint', message: "수량과 가격은 양수, 수수료는 0 이상인 정확한 소수로 입력하고 서로 다른 항목 경로와 자산을 선택해 주세요." })}{formatTradeValidation(error)}</Notice>}
    <Button disabled={disabled} onPress={() => { if (disabled) return; try { onApply(buildTradePostings(input)); setError(''); } catch (cause) { setError(cause); } }}>{_(/* i18n */ { id: 'native.tradefields.apply', message: "매매 내용을 아래 내역에 적용" })}</Button>
    <Text style={nativeStyles.caption}>{_(/* i18n */ { id: 'native.tradefields.hint', message: "적용하면 아래 항목별 내역을 교체합니다. 날짜·내용과 원가를 확인한 후 저장해 주세요. 매도는 이 거래의 가격으로 기록하며 실현 손익은 자동 계산하지 않습니다." })}</Text>
  </View>;
}

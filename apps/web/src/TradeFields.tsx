import { formatTradeValidation } from '../../../packages/i18n/src/index';
import { useLingui } from '../../../packages/i18n/src/react';
import { Field, Money, Notice } from '../../../packages/ui-web/src/index';
import { buildTradePostings, sumPostingsAtCost, type TradeInput } from '../../../packages/domain/src/trade';
import { AssetUnitField } from './AssetUnitField';

export const blankTrade = (): TradeInput => ({ side: 'BUY', quantity: '', commodity: '', priceType: 'UNIT', price: '', settlementCommodity: 'KRW', securityAccount: '', cashAccount: '', fee: '0', feeAccount: '' });
export function TradeFields({ value, onChange, customValues, onCommit }: { value: TradeInput; onChange: (value: TradeInput) => void; customValues: readonly string[]; onCommit: (values: readonly string[]) => void }) {
  const { _ } = useLingui();
  const set = (key: keyof TradeInput, next: string) => onChange({ ...value, [key]: next });
  let preview: ReturnType<typeof buildTradePostings> | undefined;
  let problem = '';
  try { preview = buildTradePostings(value); } catch (error) { problem = tradeValidationMessage(error); }
  const unit = (key: 'commodity' | 'settlementCommodity', label: string) => <AssetUnitField requestContext={value} label={label} value={value[key]} customValues={customValues} onCommit={onCommit} onValueChange={(next) => set(key, next)} onChange={(event) => set(key, event.target.value)} required />;
  return <section aria-label={_(/* i18n */ { id: 'web.forms.TradeFields.1', message: "주식 매매 입력" })}><div className="entry-basics"><label className="field">{_(/* i18n */ { id: 'web.forms.TradeFields.2', message: "매매 구분" })}<select value={value.side} onChange={(event) => set('side', event.target.value)}><option value="BUY">{_(/* i18n */ { id: 'web.forms.TradeFields.3', message: "매수" })}</option><option value="SELL">{_(/* i18n */ { id: 'web.forms.TradeFields.4', message: "매도" })}</option></select></label>{unit('commodity', _(/* i18n */ { id: 'web.forms.TradeFields.5', message: "종목" }))}
    <Field label={_(/* i18n */ { id: 'web.forms.TradeFields.6', message: "수량" })} value={value.quantity} inputMode="decimal" onChange={(event) => set('quantity', event.target.value)} required />
    <label className="field">{_(/* i18n */ { id: 'web.forms.TradeFields.7', message: "가격 입력 방식" })}<select value={value.priceType} onChange={(event) => set('priceType', event.target.value)}><option value="UNIT">{_(/* i18n */ { id: 'web.forms.TradeFields.8', message: "1주당 가격" })}</option><option value="TOTAL">{_(/* i18n */ { id: 'web.forms.TradeFields.9', message: "총 거래 금액" })}</option></select></label>
    <Field label={value.priceType === 'UNIT' ? _(/* i18n */ { id: 'web.forms.TradeFields.10', message: "1주당 가격" }) : _(/* i18n */ { id: 'web.forms.TradeFields.11', message: "총 거래 금액 (수수료 제외)" })} value={value.price} inputMode="decimal" onChange={(event) => set('price', event.target.value)} required />{unit('settlementCommodity', _(/* i18n */ { id: 'web.forms.TradeFields.12', message: "결제 자산" }))}
    <Field label={_(/* i18n */ { id: 'web.forms.TradeFields.13', message: "주식 계좌" })} list="ledger-account-options" value={value.securityAccount} onChange={(event) => set('securityAccount', event.target.value)} required />
    <Field label={_(/* i18n */ { id: 'web.forms.TradeFields.14', message: "결제 계좌" })} list="ledger-account-options" value={value.cashAccount} onChange={(event) => set('cashAccount', event.target.value)} required />
    <Field label={_(/* i18n */ { id: 'web.forms.TradeFields.15', message: "수수료" })} value={value.fee ?? '0'} inputMode="decimal" onChange={(event) => set('fee', event.target.value)} />
    <Field label={_(/* i18n */ { id: 'web.forms.TradeFields.16', message: "수수료 비용 항목" })} list="ledger-account-options" value={value.feeAccount ?? ''} onChange={(event) => set('feeAccount', event.target.value)} />
    </div><p className="form-help">{_(/* i18n */ { id: 'web.forms.TradeFields.17', message: "수량과 가격은 양수로 입력하세요. 매도는 해당 가격으로 결제한 거래를 기록하며 취득 원가나 실현 손익을 계산하지 않습니다." })}</p>
    {preview ? <div className="transaction-detail" aria-live="polite"><h4>{_(/* i18n */ { id: 'web.forms.TradeFields.18', message: "저장할 내역 미리보기" })}</h4><p>{_(/* i18n */ { id: 'web.forms.TradeFields.19', message: "거래 금액 (수수료 제외): " })}<Money value={grossFromPostings(preview)} commodity={value.settlementCommodity} /></p><p>{_(/* i18n */ { id: 'web.forms.TradeFields.20', message: "수수료: " })}<Money value={value.fee || '0'} commodity={value.settlementCommodity} /></p><p>{preview[1].amount.value.startsWith('-') ? _(/* i18n */ { id: 'web.forms.TradeFields.21', message: "결제 계좌에서 출금" }) : _(/* i18n */ { id: 'web.forms.TradeFields.22', message: "결제 계좌로 순 입금" })}: <Money value={preview[1].amount.value.replace(/^-/, '')} commodity={value.settlementCommodity} /></p>{preview.map((posting, index) => <div className="detail-posting" key={index}><span>{posting.accountName}</span><Money {...posting.amount} /></div>)}</div> : <Notice tone="warning" title={_(/* i18n */ { id: 'web.forms.TradeFields.23', message: "미리보기를 위한 정보를 입력하세요" })}>{problem}</Notice>}
  </section>;
}
function grossFromPostings(postings: ReturnType<typeof buildTradePostings>): string {
  // The shared builder's cost summary gives the exact gross without floating-point arithmetic.
  const amount = postings[0].amount;
  return sumPostingsAtCost([{ ...postings[0], amount: { ...amount, value: amount.value.startsWith('-') ? amount.value.slice(1) : amount.value } }])[0].value;
}


export const tradeValidationMessage = formatTradeValidation;

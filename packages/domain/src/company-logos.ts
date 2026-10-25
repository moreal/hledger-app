import type { Asset } from './asset-catalog.ts';

export interface CompanyLogo {
  readonly name: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly sourcePage: string;
  /** PNG renditions also work with React Native's built-in Image component. */
  readonly imageUrl: string;
  readonly license: string;
  readonly sources: readonly string[];
  readonly issuerNames: readonly string[];
}
const commons = 'https://commons.wikimedia.org/wiki/File:';
const thumbnail = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
const textLogoLicense =
  'Commons PD-textlogo (simple text/shapes); trademark rights may still apply.';

/** Deliberately small, reviewed registry, not ticker-to-domain inference.
 * Source pages and PNG responses verified 2026-10-22. Commons licensing describes
 * the image's copyright status; it does not grant trademark rights.
 */
export const companyLogos: readonly CompanyLogo[] = [
  {
    name: '삼성전자',
    symbol: '005930',
    exchange: 'KOSPI',
    sources: ['kind', 'krx'],
    issuerNames: ['삼성전자', '삼성전자보통주', 'Samsung Electronics Co., Ltd.'],
    sourcePage: `${commons}Samsung_wordmark.svg`,
    imageUrl: `${thumbnail}b/b4/Samsung_wordmark.svg/330px-Samsung_wordmark.svg.png`,
    license: textLogoLicense,
  },
  {
    name: 'NAVER',
    symbol: '035420',
    exchange: 'KOSPI',
    sources: ['kind', 'krx'],
    issuerNames: ['NAVER', '네이버', 'NAVER보통주', 'NAVER Corporation'],
    sourcePage: `${commons}Naver_logo_initial.svg`,
    imageUrl: `${thumbnail}b/b1/Naver_logo_initial.svg/330px-Naver_logo_initial.svg.png`,
    license: textLogoLicense,
  },
  {
    name: '현대자동차',
    symbol: '005380',
    exchange: 'KOSPI',
    sources: ['kind', 'krx'],
    issuerNames: ['현대자동차', '현대차', '현대자동차보통주', 'Hyundai Motor Company'],
    sourcePage: `${commons}Hyundai_Motor_Company_logo.svg`,
    imageUrl: `${thumbnail}4/44/Hyundai_Motor_Company_logo.svg/330px-Hyundai_Motor_Company_logo.svg.png`,
    license: textLogoLicense,
  },
  {
    name: 'Apple Inc.',
    symbol: 'AAPL',
    exchange: 'NASDAQ',
    sources: ['nasdaq', 'sec'],
    issuerNames: ['Apple Inc.', 'Apple Inc. - Common Stock'],
    sourcePage: `${commons}Apple_logo_black.svg`,
    imageUrl: `${thumbnail}f/fa/Apple_logo_black.svg/250px-Apple_logo_black.svg.png`,
    license:
      'Commons PD-US-no notice (United States); copyright may differ elsewhere; trademark rights may still apply.',
  },
  {
    name: 'Microsoft Corporation',
    symbol: 'MSFT',
    exchange: 'NASDAQ',
    sources: ['nasdaq', 'sec'],
    issuerNames: [
      'Microsoft Corp',
      'Microsoft Corporation',
      'Microsoft Corporation - Common Stock',
    ],
    sourcePage: `${commons}Microsoft_logo_(2012).svg`,
    imageUrl: `${thumbnail}9/96/Microsoft_logo_%282012%29.svg/330px-Microsoft_logo_%282012%29.svg.png`,
    license: textLogoLicense,
  },
  {
    name: 'NVIDIA Corporation',
    symbol: 'NVDA',
    exchange: 'NASDAQ',
    sources: ['nasdaq', 'sec'],
    issuerNames: ['NVIDIA Corp', 'NVIDIA Corporation', 'NVIDIA Corporation - Common Stock'],
    sourcePage: `${commons}NVIDIA_logo.svg`,
    imageUrl: `${thumbnail}a/a4/NVIDIA_logo.svg/330px-NVIDIA_logo.svg.png`,
    license: textLogoLicense,
  },
];

const normalizeName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
/** Require provider, exchange, exact symbol AND known issuer name. A commodity
 * string alone, an ETF mentioning an issuer, or a reused ticker never suffices.
 */
export function getCompanyLogo(
  asset: Pick<Asset, 'kind' | 'source' | 'exchange' | 'symbol' | 'name'>,
): CompanyLogo | null {
  if (asset.kind !== 'STOCK' || !asset.exchange) return null;
  return (
    companyLogos.find(
      (logo) =>
        logo.sources.includes(asset.source) &&
        logo.exchange === asset.exchange!.toUpperCase() &&
        logo.symbol === asset.symbol &&
        logo.issuerNames.some((name) => normalizeName(name) === normalizeName(asset.name)),
    ) ?? null
  );
}

import type { Asset } from './asset-catalog';

export interface OfficialHomepage {
  symbol: string;
  exchange: string;
  name: string;
  url: string;
  evidenceUrls: readonly string[];
  evidence: string;
  checkedAt: string;
}
/** Reviewed address corrections backed by official issuer/disclosure sources. */
export const officialHomepages: readonly OfficialHomepage[] = [
  {
    "symbol": "097520",
    "exchange": "KOSPI",
    "name": "엠씨넥스",
    "url": "https://www.mcnex.com/",
    "evidenceUrls": [
      "https://kind.krx.co.kr/external/2024/05/14/000776/20240514001687/11013.htm",
      "https://www.mcnex.com/"
    ],
    "evidence": "KIND quarterly report explicitly lists www.mcnex.com; current official homepage identifies MCNEX and Songdo HQ.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "298050",
    "exchange": "KOSPI",
    "name": "HS효성첨단소재",
    "url": "https://www.hshyosungadvancedmaterials.com/",
    "evidenceUrls": [
      "https://kind.krx.co.kr/external/2026/03/12/001860/20260312004294/11011.htm",
      "https://www.hshyosungadvancedmaterials.com/"
    ],
    "evidence": "2026 KIND annual report names HS HYOSUNG ADVANCED MATERIALS and lists this new homepage.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "424870",
    "exchange": "KOSDAQ",
    "name": "이뮨온시아",
    "url": "https://www.immuneoncia.co.kr/",
    "evidenceUrls": [
      "https://www.immuneoncia.co.kr/",
      "https://www.immuneoncia.co.kr/"
    ],
    "evidence": "Current company homepage identifies Immuneoncia and immune oncology platform, company overview, IR/PR and contact.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "320000",
    "exchange": "KOSDAQ",
    "name": "한울반도체",
    "url": "https://hanwoolsemi.com/",
    "evidenceUrls": [
      "https://hanwoolsemi.com/",
      "https://hanwoolsemi.com/"
    ],
    "evidence": "Current company homepage identifies 한울반도체; contact lists representative 김백산, registration 559-86-01510, telephone031-429-2401.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "058430",
    "exchange": "KOSPI",
    "name": "포스코스틸리온",
    "url": "https://www.poscosteeleon.com/kr/main.do",
    "evidenceUrls": [
      "https://www.poscosteeleon.com/kr/main.do",
      "https://www.poscosteeleon.com/kr/main.do"
    ],
    "evidence": "Current official page identifies 포스코스틸리온 and IR/company menus; footer173 Cheolgang-ro Pohang,054-280-6114.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "064960",
    "exchange": "KOSPI",
    "name": "SNT모티브",
    "url": "https://www.sntmotiv.com/",
    "evidenceUrls": [
      "https://www.sntmotiv.com/kor/business/defense.html/semiconductor.html",
      "https://www.sntmotiv.com/"
    ],
    "evidence": "Official SNT모티브 business page, SNT Motiv copyright, Busan address,051-509-2114; root fetch succeeds but empty parsed text.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "011070",
    "exchange": "KOSPI",
    "name": "LG이노텍",
    "url": "https://www.lginnotek.com/",
    "evidenceUrls": [
      "https://www.lginnotek.com/support/faq.do?locale=ko",
      "https://www.lginnotek.com/"
    ],
    "evidence": "Official LG Innotek FAQ describes company and materials/components business; root returns LG innotek Main.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "009540",
    "exchange": "KOSPI",
    "name": "HD한국조선해양",
    "url": "https://www.hd-ksoe.com/",
    "evidenceUrls": [
      "https://www.hd-ksoe.com/kr/business/ksoe/contents",
      "https://www.hd-ksoe.com/"
    ],
    "evidence": "Official HD Korea Shipbuilding business page describes company and affiliates; root succeeds, renders sitemap.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "001230",
    "exchange": "KOSPI",
    "name": "동국홀딩스",
    "url": "https://www.dongkuk.com/ko/index",
    "evidenceUrls": [
      "https://www.dongkuk.com/ko/index",
      "https://www.dongkuk.com/ko/index"
    ],
    "evidence": "Current official company homepage identifies 동국홀딩스, company/IR/governance/contact menus.",
    "checkedAt": "2026-10-22"
  },
  {
    "symbol": "005750",
    "exchange": "KOSPI",
    "name": "대림바스",
    "url": "https://www.daelimbath.com/",
    "evidenceUrls": [
      "https://kind.krx.co.kr/external/2026/05/15/003281/20260515007520/11013.htm",
      "https://www.daelimbath.com/"
    ],
    "evidence": "2026 KIND quarterly report explicitly lists www.daelimbath.com; official company history records 2025 rename from Daelim B&Co to Daelim Bath.",
    "checkedAt": "2026-10-22"
  }
];
export function getOfficialHomepage(asset: Pick<Asset, 'source' | 'symbol' | 'exchange' | 'name' | 'kind'>): OfficialHomepage | null {
  if (asset.kind !== 'STOCK' || !['kind', 'krx'].includes(asset.source)) return null;
  return officialHomepages.find(entry => entry.symbol === asset.symbol && entry.exchange === asset.exchange && entry.name === asset.name) ?? null;
}

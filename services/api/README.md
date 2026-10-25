# 로컬 hledger GraphQL API

`POST /graphql`에서 공유 SDL을 실행하며, `hledger` CLI로 명시한 로컬 장부를 조회하고 거래를 추가합니다. 별도 인덱스 DB는 사용하지 않습니다. 시작 명령과 안전한 샘플 복사 절차는 [루트 안내](../../README.md#샘플로-실행하기)를 참고합니다.

## 환경 변수

| 변수 | 필수·기본값 | 용도 |
| --- | --- | --- |
| `HLEDGER_JOURNAL` | 필수 | 사용할 로컬 장부 경로. 개인 장부 자동 탐색 없음 |
| `HLEDGER_API_TOKEN` | 필수 | 보호된 조회·쓰기의 bearer token |
| `HLEDGER_HOST` | `127.0.0.1` | API가 수신할 주소 |
| `HLEDGER_PORT` | `4000` | API 포트 |
| `HLEDGER_ALLOWED_ORIGINS` | 아래 참조 | 쉼표로 구분한 정확한 HTTP(S) origin |
| `HLEDGER_BIN` | `hledger` | hledger 실행 파일 |
| `HLEDGER_DEFAULT_COMMODITY` | 미설정 | 자체·하위 계정 모두 commodity 근거가 없는 빈 계정의 잔액 단위 |
| `HLEDGER_ASSET_CATALOG_PATH` | `.hledger-app/asset-catalog.json` | 명시적으로 갱신한 외부 자산 카탈로그 경로 |
| `HLEDGER_ASSET_METADATA_PATH` | `<실제 원장 경로>.assets.json` | 원장별 commodity → 표시 자산 매핑 파일 |
| `HLEDGER_BRANDFETCH_CLIENT_ID` | 미설정 | 정확한 ISIN이 있는 자산의 선택적 로고 URL |
| `HLEDGER_SEC_USER_AGENT` | 미설정 | SEC 갱신 요청용 앱 이름·실제 연락처 이메일 |
| `HLEDGER_KRX_API_KEY` | 미설정 | 승인된 KRX API 키. 명시적 갱신 시 사용 |
| `HLEDGER_KRX_API_KEY_FILE` | 미설정 | KRX 키 파일 경로. 직접 키 설정이 우선 |

기본 허용 origin은 `http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081,http://127.0.0.1:8081`입니다. URL 경로가 아닌 origin을 지정합니다. 다른 포트나 호스트의 웹 미리보기는 해당 origin을 명시해야 합니다. CLI처럼 `Origin` 헤더가 없는 요청은 사용할 수 있지만 보호 필드에는 여전히 토큰이 필요합니다. 브라우저 쿠키 인증은 사용하지 않습니다.

샘플의 빈 선언 계정에는 `HLEDGER_DEFAULT_COMMODITY=KRW`를 지정합니다. 설정하지 않은 경우 commodity 근거 없는 계정의 잔액 조회는 `UNDEFINED_COMMODITY` 오류를 반환합니다. 다른 계정의 통화를 임의로 추정하지 않습니다.

## 조회와 쓰기

`health`는 공개되며 실제 upstream 읽기 성공 시각을 반영합니다. 장부 경로나 거래 자료는 노출하지 않습니다. 인증된 health 응답의 `details.ledgerId`는 설정된 장부 경로의 식별자입니다. 앱은 이를 확인한 뒤 요청의 `X-Ledger-Id`에 묶습니다. 같은 endpoint의 서버가 다른 장부 경로로 재설정되면 기존 대기 요청은 `LEDGER_MISMATCH`로 거부합니다. 계정·거래·시세·생성은 각각 인증하며, 같은 요청에 `health`가 포함되어도 보호 필드의 접근 권한이 생기지 않습니다.

```sh
curl http://127.0.0.1:4000/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local-demo-token' \
  --data '{"query":"{ health { status lastSuccessfulSyncAt } }"}'
```

HTTP 요청은 JSON POST만 받고 본문은 최대 1 MiB입니다. 허용되지 않은 origin은 거부합니다. 금액은 문자열 decimal로 전달합니다. 조회 목록의 커서는 필터·정렬 범위와 장부 revision에 묶이므로, 장부가 바뀌면 처음부터 다시 조회해야 합니다.

생성은 날짜·계정·최소 두 분개와 입력 문자를 검증하며, 분개의 선택적 `cost`를 적용한 뒤 결제 자산별 합계가 정확히 0인지 확인합니다. `UNIT`은 hledger `@`, `TOTAL`은 `@@`로 저장합니다. 주식 수량과 현금 금액, 별도 수수료 분개를 함께 기록할 수 있습니다. 원가는 양수이며 수량은 매수 양수·매도 음수입니다. 멱등키와 같은 입력을 다시 보내면 원래 거래를 반환하고 다른 입력은 충돌로 처리합니다. 클라이언트는 결과가 불명확해도 새 키로 다시 생성하지 않아야 합니다.

주식 매매 입력·원장 예시와 지원 범위는 [주식 매매 안내](../../docs/stock-trades.md)를 참고합니다. 조회는 수량과 거래 가격을 보존하며 잔액을 시가 평가액으로 바꾸지 않습니다. 외부 원장의 가상 분개, 취득 원가 기준 주석, 분개별 날짜, 잔액 검증식은 의미를 잃지 않도록 `UPSTREAM_FORMAT` 오류로 조회를 중단합니다. 이를 일반 분개로 바꾸거나 무시하지 않습니다.

## 자산 검색과 표시 정보

`assets(query:, first:)`, `assetBindings(commodities:)`, `setAssetBinding(commodity:, assetId:)`도 인증·원장 식별자 검사를 적용합니다. 자산 검색은 번들 통화·BTC/ETH와 로컬 카탈로그를 사용하며 검색 중 외부 종목 API를 호출하지 않습니다. 카탈로그 ID는 제공자·거래소·심볼을 구분합니다. 동일한 심볼만으로 같은 상장 종목이라고 간주하지 않습니다.

원장별 매핑은 원래 commodity와 선택한 메타데이터 스냅샷을 별도 JSON에 저장합니다. `assetId: null`은 매핑만 삭제합니다. 원장의 commodity·거래·금액은 변경하지 않습니다. 매핑 파일은 실제 원장 경로의 `ledgerId`에 묶이고 원자적 교체와 별도 프로세스 잠금을 사용합니다. 파일 손상·다른 원장 식별자·쓰기 실패는 `ASSET_METADATA_UNAVAILABLE`로 보고하며 기존 파일을 임의로 초기화하지 않습니다.

미국 종목은 `corepack yarn assets:sync --provider nasdaq`로 공식 디렉터리를 갱신합니다. SEC에는 실제 연락처 User-Agent, KRX에는 승인 키와 `--basis-date YYYYMMDD`가 필요합니다. 갱신 실패 시 기존 정상 스냅샷을 유지하며, API는 오래된 자료를 `STALE`로 표시합니다. 한국 상장 회사 검색은 `corepack yarn assets:sync --provider kind`로 인증키 없이 KIND 공개 목록을 가져옵니다. 회사별 대표 종목 목록이며 모든 우선주·ETF·ETN 목록은 아닙니다. 선택적 로고는 ISIN 기반이며 없거나 로딩에 실패하면 배지를 표시합니다.

경로·오프라인 가져오기·상태·제공자 제한은 [자산 카탈로그 안내](../../docs/asset-catalog.md)를 참고합니다.

## 파일 저장과 복구 범위

새 거래와 멱등키·입력 fingerprint·원래 응답은 루트 장부에 함께 append하고 파일을 동기화합니다. 예약된 `hledger-app-v1` 주석에 복구 자료를 보관하며 별도 성공 기록 DB는 없습니다. append 전에는 인접한 `<장부 경로>.hledger-app.pending`에 복구 기록을 동기화합니다. 다음 읽기·쓰기에서 원본 prefix와 추가 블록의 prefix가 일치하면 중단된 append의 남은 바이트를 완성하고 검증한 뒤 복구 기록을 제거합니다. 이 주석을 제거하거나 수정하면 원래 키의 재사용을 안전하게 복구할 수 없으므로 보존해야 합니다. 사용자 태그의 `hledger-app` 접두사는 예약되어 있습니다.

인접한 `<장부 경로>.hledger-app.lock`이 이 어댑터의 여러 프로세스를 직렬화합니다. 종료된 PID의 잠금과 복구 가드는 자동 회수하며, 이전 형식의 빈 복구 가드도 자동 처리합니다. 살아 있는 소유자의 잠금은 유지합니다. 포함된 장부는 조회와 revision에 반영하지만 쓰기는 루트 장부에만 추가합니다. 쓰기 대상은 심볼릭 링크·하드 링크가 아닌 일반 파일이어야 합니다. 같은 디렉터리에 검증용 임시 장부를 만들고 hledger로 검사한 뒤 추가하므로 해당 디렉터리 쓰기 권한도 필요합니다.

외부 편집기는 이 잠금을 따르지 않습니다. 추가 직전 변경 검사는 감지한 경합을 거부하지만 잠금을 따르지 않는 도구와의 마지막 경쟁 구간까지 제거하지는 못합니다. append는 외부 자료를 덮어쓰지 않으며, 동시에 장부를 수정하는 작업은 피해야 합니다. 복구 기록과 외부 편집이 겹치거나 메타데이터가 손상되면 자동으로 덮어쓰지 않고 `WRITE_RECOVERY_REQUIRED` 등 읽기·복구 오류로 멈춥니다. 이 경우 장부와 pending 파일을 함께 보존하고 확인해야 합니다. 파일 시스템·운영체제 장애 전반에 대한 무손실 보장은 아닙니다.

로컬 개발 API입니다. 실제 장부에 쓰기 전에는 별도 복사본으로 실행 흐름을 확인하고 원본 백업을 유지합니다.

## 검증

루트의 `yarn test`가 API·어댑터 테스트를 포함합니다. 임시 장부에서 실제 CLI 조회·생성, 필터와 커서, 인증, decimal 정밀도 및 재시작 후 멱등 처리를 확인합니다. 사용자 장부를 테스트 대상으로 사용하지 않습니다. 로컬 CLI 버전이나 파일 시스템 동작이 다른 배포 환경에는 별도의 검증이 필요합니다.

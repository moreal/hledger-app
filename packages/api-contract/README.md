# GraphQL API 계약

앱 전용 단일 `/graphql` 계약의 원본은 `schema.graphql`과 공유 작업 문서
`operations.graphql`이다. React와 Expo는 여기서 생성한 같은 작업 타입과
TypedDocumentNode를 사용한다. `legacy/`의 OpenAPI·JSON Schema는 비활성 역사
자료다. 실행 서버·인증·hledger 저장은 `services/api`, 공유 통신·대기열은
`packages/client`에 구현되어 있다. 이 패키지는 그 계약과 검증·생성 타입을 제공한다.

## 파일과 검증

- `schema.graphql`: 모델, 입력, connection, 오류와 실행 의미를 정의하는 SDL.
- `operations.graphql`: Health, Accounts, AccountTransactions, Transactions,
  Prices, CreateTransaction 작업 및 공통 fragment.
- `validation.ts`: 순수 scalar 파서와 입력 제약 검증기. 실행 서버가 scalar
  coercion 및 resolver 경계에서 재사용한다.
- `contract.test.ts`: SDL·작업 문서 유효성, 필드 보존, decimal 정밀도,
  날짜·페이지·필터·태그·거래 입력 경계를 검증한다.
- `codegen.ts`: 공유 클라이언트 작업과 서버 resolver 타입 생성 설정.

루트에서 설치 후 다음 순서로 실행한다. Yarn이 직접 없다면 `corepack yarn`을
사용한다.

```sh
yarn install
yarn api:validate
yarn test
yarn api:codegen
yarn typecheck
yarn app:web
```

모바일 리뷰는 `yarn app:mobile` 또는 `yarn app:mobile:web`으로 연다.
웹 실행은 Android·iOS 네이티브 검증을 대신하지 않는다. 생성물은
`generated/client/`, `generated/server/resolvers.ts`이며 직접 수정하지 않는다.
웹 `/`는 실제 앱이며 `/gallery`는 가상 데이터 갤러리다. API 연결은
[루트 실행 안내](../../README.md)를 따른다. client preset의 `fragmentMasking: false`로
공유 fragment 필드를 작업 응답에서 직접 사용하며 별도 마스킹 해제 호출은 필요하지 않다.
Decimal, Date, DateTime은 문자열, JSONObject는 JSON 값만 포함하는 객체로
매핑하고 미등록 scalar는 생성 오류로 처리한다.

## 기존 계약 대응표

| 기존 REST/필드 | GraphQL | 보존 또는 의도적 변경 |
| --- | --- | --- |
| `GET /v1/health` | `Query.health` | status, timestamp, version, details 보존. enum은 대문자 사용 |
| `GET /v1/accounts` | `Query.accounts` | includeEmpty, depth, asOf 유지 |
| `GET /v1/accounts/{accountId}/transactions` | `Query.account(id).transactions` | 계정 ID는 불투명 값. 같은 계정 범위만 허용 |
| `GET /v1/transactions` | `Query.transactions` | 검색·날짜·계정·commodity·태그 필터 유지 |
| `POST /v1/transactions` | `Mutation.createTransaction` | 헤더 대신 필수 `input.idempotencyKey`, `clientReference` 유지 |
| `GET /v1/prices` | `Query.prices` | commodity, quoteCommodity, date, rate, source 유지 |
| `full_name`, `parent_id`, `transaction_count`, `last_posted_date` | `fullName`, `parentId`, `transactionCount`, `lastPostedDate` | 의미 유지. count는 GraphQL Int 상한 적용 |
| 거래·분개 필드 | `Transaction`, `Posting` | 코드·상태·출처·태그·accountId·accountName·memo 유지 |
| `TagMap` | `[Tag!]!`, `[TagInput!]` | 키/값 보존, 중복 키 거부. 빈 키와 빈 값은 유효 |
| `data`, `page.next_cursor`, `page.has_more` | `edges`, `pageInfo.endCursor`, `pageInfo.hasNextPage` | connection으로 변경. limit, totalEstimate 보존 |
| `created_at` | `createdAt: DateTime` | 실제 생성 시각이 없으면 null. 원장 날짜에서 만들지 않음 |
| `indexer_lag_seconds` | `indexerLagSeconds: Int` | 인덱서 부재·미상은 null. 0으로 위장하지 않음 |
| 없음 | `connectionStatus`, `lastSuccessfulSyncAt` | 마지막 성공한 upstream 읽기 반영 시각. 성공 전에는 null |
| `MoneyAmount.value`, 환율 | `Decimal` | JSON 문자열. Number로 변환하여 계산하지 않음 |
| 새 거래의 commodity | `CreateTransactionInput.postings` | 선택적 `cost`를 적용한 결제 자산별 정확한 합계 0 검증. 수량·거래 가격·별도 수수료 보존 |
| 제한 없는 비음수 카운트 | `Int` | 0–2147483647. 초과는 오류, 절단 금지 |
| `ApiError` | payload `FieldError` 또는 GraphQL `errors[].extensions` | code, message, requestId, timestamp, details 보존 |

## 잔액·필터·페이지 의미

`balances(asOf:)`는 기준일을 포함한 계정 자체 누계다. 생략하면 현재 전체
원장을 뜻한다. `movements(from:to:)`는 양 끝을 포함한 기간 증감이며
`from > to`는 거부한다. 하위 계정 포함은 `includeSubaccounts`로 명시한다.
잔액은 commodity별 최소 한 항목을 유지하고 서로 다른 commodity를 합산하지
않는다. `Accounts`의 목록 필터 `filter.asOf`와 선택된 잔액의 `$asOf`는 별도
인수이므로 같은 기준일이 필요한 화면은 둘 다 전달한다.

`AccountTransactions`의 `opening`은 `balances`의 별칭이다. 기간 기초 잔액을
원하면 `$asOf`에 `$from` 전날을 전달해야 한다. 기말은 기간 종료일까지의
누계로 별도 조회하거나 같은 commodity의 기초와 증감을 정확히 더한다.
거래 목록의 기간·하위 계정 범위도 `filter`에 명시해 잔액 범위와 맞춘다.

계정 정렬은 fullName 오름차순, 거래는 date 내림차순 후 ID 오름차순, 시세는
date 내림차순 후 commodity·quoteCommodity 오름차순이다. first 기본값은 50,
허용 범위는 1–200이다. after는 비어 있지 않은 불투명 문자열이며 이전
connection의 endCursor를 그대로 전달한다. 커서는 정렬·유효 필터·계정 범위·원장
리비전에 결합한다. 잘못되거나 오래된 커서는 `INVALID_CURSOR` 오류로 처리한다.
빈 페이지의 endCursor는 null, 그 외에는 마지막 edge cursor이고 다음 페이지가
없으면 hasNextPage는 false다.

## 입력과 오류 의미

depth 입력 1–10/출력 1–20, 검색어 1–200자, description 1–512자,
code 최대 64자, memo 최대 1000자, commodity 1–32자,
idempotencyKey 1–128자, clientReference 최대 128자를 유지한다. 길이는 Unicode
코드 포인트 수다. 거래 입력은 최소 두 분개와 유효한 Gregorian 날짜를 요구한다.
decimal의 문법은 `^-?[0-9]+(\.[0-9]+)?$`이며 지수, 공백, JSON 숫자는 거부한다.
금액 합계 검증에는 정수 기반 정확한 계산을 사용한다.

`Posting.cost`와 `PostingInput.cost`는 선택적 거래 가격이다. `type: UNIT`은 수량 × 단가(`@`), `TOTAL`은 전체 거래 금액(`@@`)이며 `amount`는 결제 자산의 양수 decimal이다. `TOTAL`의 평가 부호는 수량의 부호를 따른다. 원가가 있는 수량은 0일 수 없고 수량 자산과 결제 자산은 달라야 한다. 원가 없는 분개는 원래 금액으로 계산하며 각 결제 자산의 합계를 개별 검증한다. 수수료는 별도 비용 분개로 전달한다. 이 가격은 tax lot의 취득 원가나 자동 실현 손익 계산을 뜻하지 않는다. [매매 예시와 지원 범위](../../docs/stock-trades.md)를 참고한다.

거래 생성 성공은 transaction/idempotency가 있고 errors가 빈 목록이다. 예상
가능한 입력·충돌 실패는 transaction/idempotency가 null이고 errors가 비어 있지
않다. 동일 키와 동일한 coercion 후 입력은 원래 거래 및 replayed=true를 반환한다.
동일 키와 다른 입력은 `IDEMPOTENCY_CONFLICT`이며 새 거래를 기록하지 않는다.

인증·실행 실패는 GraphQL errors의 extensions에 code, requestId, timestamp와
선택적 details를 둔다. nullable 조회 루트는 관련 없는 부분 데이터를 보존한다.
health 공개 여부와 관계없이 각 원장 조회·쓰기 필드에 별도 권한 검사가 필요하다.

## 실행 구현과 검증 경계

이 패키지의 계약 테스트는 순수 계약·검증기를 확인한다. 실행 서버의 커서 범위·리비전,
계정 범위, 필드별 권한, scalar 연결·오류 변환은 `services/api`의 테스트가 확인한다.
영속 중복 방지·동시성·장애 복구는 실제 CLI와 격리된 임시 장부로 검증한다.
계약 검증이나 타입 생성만으로 저장 성공을 표시해서는 안 된다.

React·Expo 실제 앱은 `packages/client`를 사용하고 디자인 갤러리는 가상 자료를 사용한다.
[API 저장·복구 제약](../../services/api/README.md)과
[승인된 설계](../../docs/superpowers/specs/2026-10-19-graphql-design-system-mvp-design.md)를 참고한다.

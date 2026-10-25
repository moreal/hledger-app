# 선택형 책 기능 아키텍처

## 현재 결합 지점과 분리 범위

### Takeaway
사용자가 선택한 방향에 따라 제품의 중심은 범용 hledger 프런트엔드로 두고, 책은 사용자가 원장별로 켜는 **내장 선택 모듈**로 분리한다. 아래는 구현 사실과 구분한 설계 제안이며, 탭만 숨기는 변경으로는 이 목표를 달성할 수 없다.

### Cited Findings
- 웹은 책 탭을 기본 내비게이션에 포함하고, 연결되면 화면 선택과 관계없이 `Books`를 mount한 뒤 `hidden`으로 가린다. `Books`는 mount/revision 변경에 목록을 조회한다. — [App.tsx](/Users/moreal/github/moreal/hledger-app/apps/web/src/App.tsx:24), [mount](/Users/moreal/github/moreal/hledger-app/apps/web/src/App.tsx:261), [조회](/Users/moreal/github/moreal/hledger-app/apps/web/src/Books.tsx:98)
- 모바일도 책 탭과 항상 mount되는 책 화면을 가진다. 다만 목록·서지 조회에는 `active` 조건이 있다. — [LedgerApp.tsx](/Users/moreal/github/moreal/hledger-app/apps/mobile/LedgerApp.tsx:100), [mount](/Users/moreal/github/moreal/hledger-app/apps/mobile/LedgerApp.tsx:610), [Books.tsx](/Users/moreal/github/moreal/hledger-app/apps/mobile/Books.tsx:69)
- 서버 resolver는 책 목록·서지·구입·처분을 직접 연결하며 현재 해당 경계의 조건은 인증이다. 일반 거래 생성에는 `book.*` 태그와 `asset:book:` 단위 쓰기를 차단하는 별도 보호가 있다. — [schema.ts](/Users/moreal/github/moreal/hledger-app/services/api/schema.ts:171), [예약 보호](/Users/moreal/github/moreal/hledger-app/services/api/schema.ts:274)
- 책은 별도 목록 DB가 아니라 원장 거래의 태그·단위·원가로 재구성된다. 구입/처분 함수가 원장 거래를 생성한다. — [books.ts](/Users/moreal/github/moreal/hledger-app/services/api/books.ts:37), [구입](/Users/moreal/github/moreal/hledger-app/services/api/books.ts:106), [처분](/Users/moreal/github/moreal/hledger-app/services/api/books.ts:119)

### Inferences
- **안 A — 내장 선택 모듈(권고):** 책 도메인/서버 서비스/웹 화면/모바일 화면/서지 공급자 등록을 명시적 모듈 경계로 나누고, 코어의 작은 registry가 capability·내비게이션·진입점을 제공한다. 비활성 시 신규 책 화면 mount, 목록/서지 자동 조회, 신규 책 쓰기를 중단한다. 웹 lazy import는 적재 비용을 줄이는 수단이며 모바일에서 동일한 코드 제거 효과를 보장하지는 않는다. 단일 저장소·공유 계약을 유지해 기존 구조에서 가장 작은 위험으로 선택성을 만든다.
- **안 B — 배포 시 선택 패키지:** books를 별도 workspace 패키지로 옮기고 배포 구성을 통해 포함한다. 배포 크기와 의존성 분리가 더 강하지만 웹/모바일 빌드 조합·배포 검증·기존 원장 복구 경로가 늘어난다. 책 전용 배포가 필요할 때 고려한다. 이 경우에도 코어의 예약 보호·미확정 요청 확인 기능은 제거하면 안 된다.
- **안 C — 외부 런타임 플러그인:** 독립 배포되는 제3자 확장을 설치·실행한다. 버전 협상, 권한, 공급망, 격리, 웹/모바일 실행 환경 차이, 원장 쓰기 중재가 별도 제품 과제가 된다. 이번 범위에서는 제외하며 제3자 설치 요구가 생기면 별도 설계한다. 내장 선택 모듈을 외부 플러그인 시스템이라고 부르지 않는다.

### Gaps
- 사용자는 내장 선택 모듈 우선을 명시했다. 외부 런타임 실행은 이번 범위 밖이며, 향후 필수 요구로 바뀌면 안 C의 위협 모델·지원 플랫폼부터 별도 설계해야 한다.

## 활성 상태·요청 복구·원장 무결성

### Takeaway
비활성화는 기록 삭제나 미확정 쓰기 취소를 뜻하면 안 된다. 서버의 원장별 권한 상태와 클라이언트 표시 취향을 나누고, 요청 복구·예약 데이터 보호는 코어에 남긴다.

### Cited Findings
- 웹은 요청 전 정확한 입력과 키를 `hledger.book-request:${client.identity}`에 저장하고, 미확정 재시도 거부 시에도 기존 요청을 보존한다. 연결 변경에도 pending 보호가 있다. — [Books.tsx](/Users/moreal/github/moreal/hledger-app/apps/web/src/Books.tsx:78), [전송](/Users/moreal/github/moreal/hledger-app/apps/web/src/Books.tsx:139), [연결 보호](/Users/moreal/github/moreal/hledger-app/apps/web/src/App.tsx:192)
- 모바일은 durable storage의 `books-pending-v1`에서 요청을 복구하고, 원래 client identity와 일치할 때 같은 입력·멱등키로 재시도한다. — [Books.tsx](/Users/moreal/github/moreal/hledger-app/apps/mobile/Books.tsx:32), [복구·전송](/Users/moreal/github/moreal/hledger-app/apps/mobile/Books.tsx:90)
- 구입은 요청 키에서 복본 ID/adapter 키를 만들며, 처분은 복본별 단일 durable adapter 키와 요청 fingerprint로 경쟁·중복을 제어한다. — [books.ts](/Users/moreal/github/moreal/hledger-app/services/api/books.ts:114), [처분 키](/Users/moreal/github/moreal/hledger-app/services/api/books.ts:139)

### Inferences
- **제안 상태:** `enabled → draining → disabled`. enabled는 신규 사용 허용. 끄기를 요청하면 서버에서 신규 admission을 원자적으로 닫고 draining으로 전환한다. draining은 이미 승인된 요청의 완료·결과 확인만 허용한다. 서버 작업이 정리되면 disabled로 전환하며, disabled에서도 과거 요청의 읽기 전용 결과 확인 경로는 유지한다. 재활성화는 데이터를 다시 만들지 않고 상태만 바꾼다.
- 단순히 클라이언트가 '재시도'라고 주장하거나 키를 재사용하는 것만으로 disabled 쓰기를 허용하면 우회가 된다. 코어 요청 receipt/admission 저장소가 원장 ID·작업 종류·키·입력 fingerprint·상태를 영속 기록하고, disable 전 승인 여부를 검증해야 한다. 승인되지 않은 요청은 신규로 처리하지 않는다. admission 기록과 원장 쓰기 사이의 crash recovery도 필요하다. 현 adapter 멱등성만으로 새 lifecycle이 완성됐다고 볼 수 없다.
- 서버에 도달했는지 불명확한 클라이언트 요청은 core 복구 센터가 계속 표시한다. **비활성 상태의 '없음' 응답으로 원래 결과를 단정하지 않는다.** 과거 진행 요청과 원장 기록을 확인하여 terminal 결과를 증명하거나, 증명할 수 없으면 미확정 상태를 유지하고 원래 원장에 재연결하고 명시적으로 재활성화한 뒤 같은 키로 복구한다. 비활성 상태에서는 서버가 영속 멱등 기록으로 입증한 replay 결과 조회만 허용하며, 처음 보는 입력을 재전송하지 않는다. 다른 키로 새 구입을 자동 생성하지 않는다.
- 코어 복구 서비스가 책 화면 mount보다 먼저 웹/모바일 기존 저장소를 읽도록 이전하고, 책 화면을 감추거나 제거해도 원래 입력·키·연결 식별자와 복구 UI가 남아야 한다. 토큰을 영속 요청에 넣지 않는다. 원장 전환은 해당 원장의 미확정 요청을 덮어쓰지 않아야 한다.
- 서버의 **원장별 books 상태**가 API의 권위다. 클라이언트의 '책 탭 표시'는 개인/기기 취향일 뿐 권한이 아니다. 서버 gate를 모든 책 query/mutation과 서지 호출에 적용하며 다른 클라이언트·직접 GraphQL 호출도 같은 규칙을 따른다. 공통 거래·계좌·가격 조회는 그대로 가능하게 한다.
- `book.*`, `asset:book:` 원장 자료·원가·가격·태그는 비활성화 때 보존한다. 일반 계좌/거래 화면은 이를 읽고 표시할 수 있어야 한다. 일반 쓰기의 예약 보호는 상시 코어 규칙으로 남겨 기능을 꺼도 관리 단위를 일반 입력으로 위조하지 못하게 한다. 전문 책 상태 재구성은 켜졌을 때만 필요하며 일반 원장 읽기를 책 검증 실패에 종속시키지 않는다.
- **기본값 권고(미구현 제안):** 새 원장은 off. 업데이트 전 실제 책 기록이나 미확정 요청이 있는 기존 원장은 한 번의 명시적 마이그레이션으로 사용을 유지하고 안내한다. 모든 기존 원장에 무조건 off를 적용하거나 단지 `assets:books` 계좌가 있다는 이유로 켜지 않는다. 기존 기록/요청 식별은 보수적으로 하며 훼손된 관리 태그를 자동 복구하지 않는다.

### Gaps
- 서버가 클라이언트별 미전송 요청까지 모두 알 수는 없다. 따라서 draining 종료를 '모든 기기의 pending이 0'에 의존하게 하면 안 된다. 제안하는 활성 설정의 권위는 서버의 영속 설정 저장소에서 canonical ledger ID를 키로 한 enabled/state/version 레코드다. endpoint·브라우저 localStorage를 권위로 삼지 않는다. 최초 업그레이드 때 원장 기록/미확정 요청을 검사해 migration version과 기존 사용 유지 결정을 한 번 저장한다. 실제 설정 저장 형식·receipt 보존 기간·클라이언트 pending 신고 절차는 별도 결정 사항이다.

## GraphQL 계약과 국제 서지 확장 경계

### Takeaway
활성 여부에 따라 SDL을 제거하지 말고 고정 계약에 capability와 상태 오류를 추가한다. 책 자산 관리와 서지·표지 조회를 분리해 seoji 없이도 수동 기록과 해외 공급자를 사용할 수 있게 한다.

### Cited Findings
- SDL에는 책 query/mutation·타입이 고정 선언되고 공통 operations·client가 이를 참조한다. React와 Expo는 같은 생성 계약을 사용한다. — [schema.graphql](/Users/moreal/github/moreal/hledger-app/packages/api-contract/schema.graphql:21), [operations.graphql](/Users/moreal/github/moreal/hledger-app/packages/api-contract/operations.graphql:84), [client](/Users/moreal/github/moreal/hledger-app/packages/client/index.ts:100), [codegen 안내](/Users/moreal/github/moreal/hledger-app/docs/graphql-codegen.md:19)
- 현재 서지 함수는 seoji에서 404/실패하면 즉시 끝나며, 유효한 seoji 제목을 얻은 이후에만 Open Library/서점 표지 fallback을 호출한다. 따라서 현 표지 fallback만으로 seoji 없는 해외 서지 조회가 구현된 것은 아니다. — [seoji.ts](/Users/moreal/github/moreal/hledger-app/services/api/seoji.ts:35), [표지 fallback](/Users/moreal/github/moreal/hledger-app/services/api/seoji.ts:66)
- 서버 책 기록 모듈은 seoji 모듈에서 표지 정규화 함수를 import하고 있으나 실제 정규화 구현은 domain으로 재수출한다. — [books.ts](/Users/moreal/github/moreal/hledger-app/services/api/books.ts:1), [seoji.ts](/Users/moreal/github/moreal/hledger-app/services/api/seoji.ts:16)

### Inferences
- **제안 계약:** 인증된 `capabilities` 응답에 books 지원 버전·원장 상태·허용 동작(신규 쓰기/전문 조회/서지/복구)을 넣는다. UI는 이 값을 확인해 진입·자동 요청을 제어하고, resolver는 같은 정책을 독립 검증한다. 비활성에는 명시적인 `FEATURE_DISABLED`/`FEATURE_DRAINING`를 반환하며 '책 0권'으로 위장하지 않는다. 기존 nullable 필드와 오류 경로의 호환성을 검토한다.
- SDL과 typed operations는 배포 간 안정적으로 유지한다. off마다 필드/type을 제거하는 dynamic schema는 현재 codegen·공유 client와 충돌한다. 새 계약은 validate/codegen/typecheck 및 on/off/recovery 통합 검증을 거친다. 안 B에서도 최소 capability·복구 계약을 core에 고정하고, 향후 외부 확장은 별도 버전 경계로 둔다.
- books accounting은 외부 조회 없이 title/authors를 직접 받아 동작한다. metadata provider와 cover provider는 별도 인터페이스/설정/실패 처리·캐시를 갖는다. seoji는 선택 metadata adapter 하나로 낮추고, 해외 adapter의 성공을 seoji 응답에 종속시키지 않는다. 표지만 있으면 metadata 실패와 무관하게 독립 활용할 수 있게 응답 모델도 검토한다.
- 공급자별 원 ISBN 일치·출처·이용 조건·timeout·호출 제한·안전 URL 정책을 유지한다. 수동 수정한 제목/저자는 자동 응답으로 덮어쓰지 않는다. provider 선택은 locale/설정 기반 정책으로 두되 언어만으로 ISBN의 국가/판본을 단정하지 않는다. 새 해외 공급자 선택은 별도 조사 결과와 연결한다.

### Gaps
- 본 메모는 현 코드 근거와 설계 제안에 한정한다. 해외 공급자의 현재 API 정책·권한·커버리지 우열은 확인하지 않았으며 인접 공급자 조사 결과로 결정해야 한다.

# 네이티브 QA 반복 실행 안내

이 문서는 전체 54개 절차의 반복 범위와 증거 계약을 정의한다. 자동화 도구 실행 성공은 전체 네이티브 QA 성공과 다르다. 이번 실행 결과는 [전체 보고서](runs/2026-10-25-full-native.md)에 기록한다.

## 실행 순서

1. CI run/SHA·원본 해시·manifest·내장 번들·설치 서명·기기/OS를 기록한다. CI 원본을 로컬 개발 번들로 교체하지 않는다. Android 서명만 추가했다면 원본/파생본 해시와 내장 번들 동일성을 남긴다.
2. 플랫폼별 새 격리 원장과 별도 빈 원장, 충분한 페이지 자료, 상쇄 이력/하위 항목/태그/시세 자료를 준비한다. 응답 유실은 upstream 저장 성공 뒤 한 번만 끊는 제어 프록시로 만든다. 실사용 원장에는 쓰지 않는다.
3. iOS/Android 54행을 각각 PENDING으로 초기화하고 실제 앱에서 실행한다. 개발 서버 중단 후 콜드 실행·재인증 조건도 매 실행 반복한다.
4. 각 ID의 화면/접근성 트리·실제 관찰·런타임 로그를 플랫폼별 절대 경로로 저장한다. 표지·대비·겹침·실제 키보드는 화면을 직접 검토한다.
5. 쓰기 절차는 전후 거래 수·요청 키·책 실물 ID·원장 유효성·중복 여부를 대조한다. 실패한 저장은 무전송/건수 불변 증거가 필요하다.
6. 토큰 삭제·QA outbox 정리·프록시 disarm 후 최종 감사를 기록한다. 결과 수와 54행 완전성을 검사하고 미완료가 있으면 전체 통과를 선언하지 않는다.

`yarn api:codegen`, `yarn typecheck`, `yarn test`, `yarn test:mobile:release`는 기존 자동 검사다. API/client/빌드 회귀 증거로만 사용하며 네이티브 UI PASS로 승계하지 않는다. UI 실행 명령과 실제 실행 범위는 아래와 같다.

## 54개 ID별 자동화·직접 관찰·보조 증거

자동화 열은 반복할 동작/검사 범위를 뜻한다. 실제 실행기에서 해당 동작을 구현하고 실행했다는 기록이 없으면 자동 PASS로 간주하지 않는다. 네이티브 직접 관찰 열은 UI 기대 결과이며 자동 접근성 검사와 수동 시각 관찰을 결합할 수 있다.

| ID | 반복 자동화 범위 | 네이티브 직접 관찰 | API/원장 보조 증거 |
| --- | --- | --- | --- |
| N01.1 | 해시·manifest·내장 번들 비교 | 설치 앱 식별·서명 파생 여부 | 해당 없음 |
| N01.2 | 개발 서버 비리스닝 확인·종료/실행 | 시작 화면·충돌/빈 화면 | 해당 없음 |
| N01.3 | 탭·설정·뒤로 순회 | 모든 탐색 도착 화면 | 해당 없음 |
| N02.1 | 미인증 상태에서 전송 시도 | 연결 안내·거래/책 차단 | 전후 거래/책 건수 불변 |
| N02.2 | 토큰 입력란 확인 | 입력된 토큰의 마스킹 | 토큰 원문 증거 금지 |
| N03.1 | 격리 연결 적용 | CONNECTED·원장 ID | fixture 원장 ID 대조 |
| N03.2 | 잘못된 토큰→유효 토큰 적용 | 거절·인증 복구 | 거절 응답·원장 ID |
| N03.3 | 실패 후보→유효 후보 적용 | 실패 이유·활성 주소 구분·복구 | 활성 연결 유지 계약 |
| N04.1 | 기본값 아닌 주소 저장 후 재실행 | 주소 유지 | 해당 없음 |
| N04.2 | 종료·콜드 실행 | 토큰 빈 값·재인증 안내 | 재인증 전 요청 제한 |
| N05.1 | 항목 탭 열기 | 목록·잔액·강조 영역 대비 | 기준일 잔액 대조 |
| N05.2 | 일치/불일치 검색 | 결과·빈 안내 | fixture 일치 항목 |
| N05.3 | 기간 적용·항목 상세 열기 | 기초/증감/기말·기간 거래 | 정확한 기간별 합계 |
| N05.4 | 깊이·0잔액·기준일 조합 적용 | ON/OFF·표시 잔액·실제 필터 결과 | 상쇄 이력·다중 자산·정밀 소수 대조 |
| N05.5 | 하위 포함 ON/OFF | 범위별 표시 잔액 차이 | 부모 자체/하위 합계 |
| N05.6 | 항목/항목 거래 더 보기 | 추가 목록·중복/누락 없음 | 페이지 경계 ID·총수 |
| N06.1 | 거래 검색 일치/빈 검색 | 목록·빈 결과 | 검색 fixture |
| N06.2 | 날짜·항목 필터 적용 | 적용값·결과 | 기간·항목별 예상 집합 |
| N06.3 | 자산·태그 키/값 적용 | 결과 집합 | 해당 자산·태그 fixture |
| N06.4 | 상세 열기 | 날짜·분개·메모·태그·참고 번호 | 원본 거래 필드 |
| N06.5 | 거래 더 보기 | 추가 결과·중복/누락 없음 | 페이지 경계 ID·총수 |
| N07.1 | 최근 거래/상세 복사 | 내용·날짜·분개·태그 보존 | 복사 원본 비교 |
| N07.2 | 내역/태그 추가·삭제 | 최소 내역 2개 제한 | 저장 요청 없음 |
| N07.3 | 자산 검색/직접입력·폼 전환 | 선택값·일반/주식 폼 | 해당 없음 |
| N07.4 | 템플릿 저장·사용·빈 새 거래 | 원본 보존·새 입력 초기화 | 요청 키는 W01.8에서 대조 |
| N08.1 | 빈 일반 입력·빈 경로 저장 시도 | 검증 안내·차단 | 거래 수 불변 |
| N08.2 | 잘못된 날짜·소수 형식 | 각 검증 안내·차단 | 거래 수 불변 |
| N08.3 | 불균형 저장 시도 | 검증 안내·무전송 | 전후 원장/요청 로그 |
| N09.1 | 시세 탭 열기 | 기본 목록 | fixture 시세 |
| N09.2 | 자산·기준 자산·기간 적용 | 적용 결과 | 예상 시세 집합 |
| N09.3 | 빈 검색·충분한 결과 더 보기 | 빈 안내와 실제 추가 페이지 모두 | 페이지 경계·총수 |
| N10.1 | 동기화 탭·보관 후 재확인 | 빈/대기 수·상태 | 보관 요청 메타데이터 |
| N10.2 | 미인증/다른 연결에서 재시도 | 각 제한 안내·차단 | 원장 쓰기 없음 |
| B01.1 | 별도 빈 원장·새로고침 | 빈 목록 안내 유지 | 책 0권 |
| B01.2 | 보유/판매/폐기 목록 조회 | 제목·ISBN·가치·실현 손익·표지 | 각 상태·금액 대조 |
| B02.1 | 알려진 ISBN 조회 | 채식주의자·한강 자동 입력 | 조회 응답은 보조 |
| B02.2 | 조회 완료 대기 | 실제 이미지·출처 시각 확인 | URL만으로 PASS 불가 |
| B03.1 | 미검색 ISBN 조회 | 미검색/실패 안내 | 조회 결과 |
| B03.2 | 수동 필드 편집 | 제목·저자·금액·통화·항목 편집 가능 | 해당 없음 |
| B04.1 | 수동 제목/저자 입력→재조회 | 두 값 모두 보존 | 해당 없음 |
| B04.2 | 성공 ISBN→미검색 ISBN | 이전 표지·출처 제거 | 해당 없음 |
| B05.1 | 빈 구매 금액 저장 시도 | 한국어 안내·차단 | 책/거래 수 불변 |
| B05.2 | 0·음수 금액 각각 저장 시도 | 각 안내·차단 | 책/거래 수 불변 |
| B05.3 | 잘못된 ISBN·날짜·빈 제목 각각 | 각 안내·차단 | 책/거래 수 불변 |
| U01.1 | 포커스·키보드 닫기·스크롤 | 실제 키보드 표시/해제·하단 접근 | 텍스트 주입만으로 PASS 불가 |
| U01.2 | 긴 값 입력·탭 전환 | 금액·글자·표지 겹침/잘림·값 유지 | 시각 검토 필요 |
| W01.1 | 일반 거래 UI 저장 | 성공·목록/상세 반영 | 요청 키·거래 정확히 1건 |
| W01.2 | 주식 매수/매도 UI 저장 | 지원 원가·수수료·거래 결과 | 수량·단가·현금·수수료 대조; 자동 손익만 조건부 N/A |
| W01.3 | 자동/수동 책 각 구매 | 두 구매 성공·각 실물 ID | 각 1거래·가격·서지정보 |
| W01.4 | 책 판매/수수료·다른 책 폐기 | 상태·실현 손익·폐기 손실 | 원장 금액·잔여 수량 |
| W01.5 | 오프라인 보관·재실행 | 보관 복구·자동전송 없음 | 네트워크/거래 수 불변 |
| W01.6 | 연결 복구·동일 요청 재시도 | 성공·상태 갱신 | 동일 키 정확히 1건 |
| W01.7 | upstream 성공 후 응답 유실 제어 | 불명확 잠금·동일 키 확인/재시도 | 프록시 로그·성공 전후 건수·키 |
| W01.8 | 템플릿 재사용·완료/대기 삭제 | 새 요청·QA outbox 삭제 | 서로 다른 새 키·삭제 시 원장 불변 |

## 증거·판정 계약

증거 기록은 `id`, `platform`, `status`, `observed`, `evidence`(절대 경로), `ciRun`, `appSha`, `executedAt`를 포함한다. 쓰기는 추가로 격리 원장 ID·전후 건수·요청 키를 남긴다. 토큰 원문을 저장하지 않는다. 플랫폼/ID별 중복·누락·알 수 없는 ID·증거 없는 PASS/FAIL은 완료 판정에서 거절한다.

상태는 PENDING/PASS/FAIL/BLOCKED/N/A만 사용한다. 실행하지 않은 자동화 단계, 선택기 불일치, 충분하지 않은 fixture, 접근 불가 기기는 PASS가 아니다. BLOCKED에는 재개 조건을 적는다. N/A는 제품 미지원 자동 주식 손익처럼 적용되지 않는 하위 조건과 이유를 명시하며 페이지/빈 목록 fixture 부족을 숨기는 용도로 쓰지 않는다.

하나의 증거가 여러 ID를 뒷받침할 수 있지만 관찰 범위는 각 ID에 적는다. 예를 들어 응답 유실 후 같은 키 재시도는 W01.6/7을 지원할 수 있으나 오프라인 재실행 복구 W01.5까지 자동으로 입증하지 않는다. 과거 실행은 참고 링크만 남기며 새 54행 결과에 복사하지 않는다.

## 실제 실행기 명령

저장소 루트에서 실행한다. 아래 `qa-example-001`은 매 실행 새로운 이름으로 바꾼다. 같은 이름의 `new-run`은 실패하며 기존 원장을 초기화하지 않는다.

```sh
node --import tsx scripts/qa/fixture.mjs --help
node --import tsx scripts/qa/fixture.mjs new-run qa-example-001
node --import tsx scripts/qa/fixture.mjs start qa-example-001
node --import tsx scripts/qa/fixture.mjs audit qa-example-001
```

fixture는 `/private/tmp/hledger-qa-full-fixture/<RUN>/` 아래에만 생성된다. API는 iOS 4200 / Android 4201 / 빈 원장 4204, 응답 제어 프록시는 iOS 4202 / Android 4203이다. 원장 ID·토큰 권한 0600·원장 유효성·페이지 fixture를 감사한다. 토큰 파일은 `<RUN>/<platform>/token`이며 내용은 출력하거나 문서에 복사하지 않는다. 현재 `native-full-003` 초기 감사는 각 139거래·70항목·67시세·책 5권(3 HELD/1 SOLD/1 DISCARDED), 빈 원장 0건이다. 이 숫자는 UI 검증 결과가 아니다.

```sh
node scripts/qa/ios-runner.mjs --device <SIMULATOR_UUID> --ci-run 40165612461 --app-sha 366a0f99c2a77e042f9389b92f9bd8aa133c57ee --fixture-run qa-example-001 --endpoint http://127.0.0.1:4202/graphql --token-file /private/tmp/hledger-qa-full-fixture/qa-example-001/ios/token --output /private/tmp/hledger-qa-full/ios/automation/<NEW_EXECUTION> --flows auth-navigation
QA_TOKEN_FILE=/private/tmp/hledger-qa-full-fixture/qa-example-001/android/token QA_EVIDENCE=/private/tmp/hledger-qa-full/android/qa-example-001 QA_DEVICE=<EMULATOR_ID> python3 scripts/qa/android-runner.py --maestro .maestro/android/auth-navigation.yaml
```

실제 기기 ID를 명시한다. iOS는 `MAESTRO_BIN`, Android는 `MAESTRO`·`ADB`·`QA_DEVICE`·`QA_EVIDENCE`·`QA_TOKEN_FILE`로 로컬 도구/기기/이번 격리 원장을 지정한다. iOS는 Maestro JUnit·로그·화면을 저장한다. Android는 Maestro 실행 또는 접근성 트리에서 확인한 앱 요소만 조작하는 `--exec <검토한 로컬 시나리오>`를 지원하며 앞면 패키지가 `com.hledger.app`인지 확인한다. `--exec`는 임의 Python 실행이므로 저장소/검토된 이번 시나리오에만 사용한다. 자동화 시나리오는 `.maestro/{ios,android}/`의 auth-navigation/read-filters/books-validation/writes-recovery로 나뉜다. 각 파일의 구현·assert 범위만 실제 자동화 범위로 인정한다.

현재 iOS `auth-navigation`은 이미 해당 격리 fixture에 인증된 앱의 활성 주소·원장 ID·CONNECTED를 확인하는 guard다. 앱의 현재 화면에서 직접 확인한 입력 위치로 먼저 인증하며 이 흐름은 자격 증명을 입력하거나 앱을 재실행하지 않는다. 초기 실행 당시의 탐색 smoke 증거와 현재 guard 구현을 구분한다. 전체 54개 인증/저장/페이지 검증을 자동 통과시키지 않는다. 특히 `launchApp` 한 번만으로 개발 서버 중단 또는 토큰 종료 정책이 검증되지 않는다. coordinator가 개발 서버 비리스닝을 확인하고 앱을 종료한 뒤 실행한 cold 증거가 별도로 필요하다.

iOS의 검토한 하위 ID 관찰 JSON은 `--report-only --observations <JSON>`로 보고서화한다. 관찰 파일은 ID를 키로 두고 `status`, `observation`, `evidence` 배열을 제공한다. 관찰 없는 ID는 PENDING이다. 실행기 결과와 별도로 증거 파일 존재·ID 중복/누락·관찰 범위를 검사한다. Android `results.json`도 같은 ID→관찰 형식이며 아직 기록하지 않은 ID를 최종 보고서에서는 PENDING으로 채운다.

응답 유실 검증은 UI에서 이번 요청의 정확한 idempotency key를 먼저 확인한 뒤 arm한다. 전체 요청을 무차별 끊지 않는다.

```sh
node --import tsx scripts/qa/fixture.mjs proxy-arm qa-example-001 ios <EXACT_REQUEST_KEY>
node --import tsx scripts/qa/fixture.mjs proxy-disarm qa-example-001 ios
node --import tsx scripts/qa/fixture.mjs proxy-disarm qa-example-001 android
node --import tsx scripts/qa/fixture.mjs audit qa-example-001
node --import tsx scripts/qa/fixture.mjs stop qa-example-001
```

프록시는 지정된 키의 저장 성공 응답을 한 번 유실하고 이벤트를 기록한다. stop은 해당 fixture가 소유한 기록된 프로세스만 종료하며 원장과 증거를 보존한다. 앱을 미인증으로 정리하고 QA outbox만 삭제한 뒤 감사·disarm·stop한다.

## 공유 결과 검증기와 canonical 형식

`scripts/qa/validate-results.mjs`는 `schemaVersion: 1`, `platform: ios|android`, `ciRun`, `appSha`, `fixtureRun`, `results` 배열을 검사한다. 각 결과는 `id`, `status`, `observed`(또는 `observation`), `method`, ISO8601 `executedAt`, `evidence` 배열을 가진다. method는 실제 수행 방식을 기록한다. Maestro로 수행하지 않은 관찰을 maestro라고 표시하지 않으며 native-driver·manual로 구분한다. PENDING의 method는 예정 방식일 뿐 실행 증거가 아니다.

```sh
node scripts/qa/validate-results.mjs /private/tmp/hledger-qa-full/ios/results.json --ci-run 40165612461 --app-sha 366a0f99c2a77e042f9389b92f9bd8aa133c57ee --fixture-run native-full-003 --allow-incomplete
node scripts/qa/validate-results.mjs /private/tmp/hledger-qa-full/android/report.json --ci-run 40165612461 --app-sha 366a0f99c2a77e042f9389b92f9bd8aa133c57ee --fixture-run native-full-003 --allow-incomplete
```

`--allow-incomplete`는 진행 중 구조·증거 검사에만 사용한다. 최종 게이트에서는 이 옵션을 제거하고 필요하면 `--since <이번 실행 시작 ISO8601>`도 지정한다. 잘못된 메타데이터·알 수 없는/중복 ID·유효하지 않은 시각·비어 있거나 없는 증거 파일·증거 없는 PASS/FAIL을 거절한다. 미포함 ID는 missingCount로 집계하고 최종 완료를 거절한다. FAIL/BLOCKED/PENDING이 있어도 최종 완료를 거절한다. valid는 기록 형식 검증이며 관찰의 진실·제품 동작·N/A 타당성을 자동 보증하지 않는다.

iOS canonical은 `ios/results.json`, Android canonical export는 `android/report.json`이다. Android 내부 `results.json` 진행 자료와 export 시점이 다를 수 있으므로 최종 집계에는 검증된 canonical만 사용한다. 공유 검증기·fixture의 자동 테스트 12개 통과 (그 시점의 검사 결과)는 실행 도구 회귀 증거이며 54개 UI 검증 통과 수에 더하지 않는다.

## 지속 Maestro 세션 도우미

`scripts/qa/maestro-session.mjs`는 로컬 Maestro MCP 연결을 유지하며 UI 도구를 직렬 호출한다. 첫 터미널에서 serve를 유지하고 다른 터미널에서 list/call/stop을 실행한다.

```sh
node scripts/qa/maestro-session.mjs serve --maestro <MAESTRO_BINARY> --socket /private/tmp/hledger-qa-full/ios.sock --token-file /private/tmp/hledger-qa-full-fixture/qa-example-001/ios/token
node scripts/qa/maestro-session.mjs list --socket /private/tmp/hledger-qa-full/ios.sock
node scripts/qa/maestro-session.mjs call --socket /private/tmp/hledger-qa-full/ios.sock --tool <DISCOVERED_TOOL_NAME> --params /private/tmp/hledger-qa-full/request.json --output /private/tmp/hledger-qa-full/ios/session-step
node scripts/qa/maestro-session.mjs stop --socket /private/tmp/hledger-qa-full/ios.sock
```

도구 이름·입력 스키마는 list에서 발견한 값을 사용한다. 요청 JSON에는 실제 기기와 이번 절차만 지정한다. `--output`은 이미지 파일과 `reply.json`을 보존하며 파일 권한은 0600이다. 소켓은 전용 QA 경로 안에서만 만들고 0600으로 제한한다. `--token-file`은 여러 번 지정할 수 있으며 출력에서 해당 값을 가린다. Maestro 내부 별도 로그에도 토큰이 없도록 직접 검토한다. 이미 소켓이 있으면 새 세션을 거절한다.

동시 요청은 거절된다. RPC가 시간 초과하면 상태가 불명확하므로 세션은 shutdown만 허용한다. 세션 종료 후 해당 요청 키·원장·현재 화면을 감사하고 나서 재시도 여부를 결정한다. 도우미는 앱 데이터를 직접 수정하지 않는다. 도우미 호출 성공은 해당 UI 도구 실행 증거이며 별도 체크리스트 관찰·검증 없이 PASS를 생성하지 않는다. Maestro YAML 실행 증거와 이 세션을 통한 개별 UI 조작·native-driver 관찰은 canonical method와 실제 증거를 따라 구분한다.

세션 도우미는 Maestro를 시작하기 전에 토큰 파일이 일반 파일·비심볼릭 링크·정확히 0600 권한인지 확인한다. 해당 보호를 포함한 도우미 회귀 검사 14개가 통과했다. 도우미 자체는 전송 계층이므로 fixture 원장 identity를 강제하지 않는다. mutation 전 격리 fixture 확인 책임은 native runner와 실행자의 원장 ID 검증에 있다. 이 구분을 도구 회귀 성공과 실제 UI PASS에 동일하게 적용한다.

설치된 Maestro2.6에서 iOS 선택 전 Android 전체 기기 열거가 shell query에 멈춘 사례가 있었다. iOS 전용 기기 지정 플래그가 이를 우회한다고 확인하지 않았다. 이번에는 기기 목록이 emulator-5556만 표시된 뒤 읽기 전용 probe가 성공했으며 팀이 다른 에뮬레이터를 종료하지 않았다. 탐색 지연 시 기존 세션을 중복 실행하거나 저장 요청을 반복하지 말고 현재 도구 상태·기기 목록·요청 키를 확인한다.

## 최종 실행기 인터페이스·이번 수행 범위

Android는 `--suite`로 저장소에 포함된 auth/read/books/transactions/entry/writes 등의 시나리오를 실행하고 `--export`로 현재 run identity를 검증한 54행 canonical `report.json`을 생성한다. 실제 허용 suite 목록은 `python3 scripts/qa/android-runner.py --help`를 따른다. 예시는 다음과 같다.

```sh
export QA_TOKEN_FILE=/private/tmp/hledger-qa-full-fixture/qa-example-001/android/token
export QA_EVIDENCE=/private/tmp/hledger-qa-full/android/qa-example-001
export QA_DEVICE=<EMULATOR_ID>
python3 scripts/qa/android-runner.py --suite auth
python3 scripts/qa/android-runner.py --suite read
python3 scripts/qa/android-runner.py --export
```

쓰기 suite를 반복하면 새 거래를 만들 수 있다. 이미 완료한 실행에서 전체 suite를 다시 시작하지 말고 이번 run identity·현재 UI·원장 감사 후 미완료 단계만 재개한다. Android 이번 54개 canonical 판정의 method는 native-driver다. Maestro smoke가 보조로 실행됐더라도 모든 54개를 Maestro YAML만으로 검증했다고 표현하지 않는다.

iOS 실행기는 필수 CI/run 메타데이터와 `--endpoint`/`--token-file` 쌍을 받는다. 인증된 auth-navigation/read-filters/books-validation/writes-recovery는 해당 fixture의 iOS 토큰 경로·manifest·실제 health ledger ID·로컬 프록시4202를 확인한다. `--write-stage`는 core/general/buy/sell/books/prepare/retry/response-loss/response-retry/cleanup/template, `--case`와 명시적 `--run-id`는 쓰기 단계를 식별한다. 전체 core 재실행 전에 같은 run 거래가 없는지 검사하고 이미 저장한 general/buy/sell은 다시 실행하지 않는다.

`--report-only --observations`의 PASS/FAIL 관찰에는 현재 출력 폴더 안의 실제 비어 있지 않은 증거·`executedAt`·`appSha`·`fixtureRun`이 필요하고 `--since`로 이번 실행 시각을 제한한다. 실행기에서 공유 검증기도 호출한다. 새 출력 경로를 사용해 이전 증거를 덮어쓰지 않는다. iOS 현재 판정은 Maestro 실행과 native-driver 직접 관찰을 결합하며 canonical method를 따른다.

새 실행의 Android는 위처럼 토큰·증거 디렉터리·기기를 명시해야 한다. 기본값 `native-full-003`이나 기존 증거 폴더에 새 run 결과를 쓰지 않는다. `--suite auth`는 설치 provenance를 수집한다. 현재 실행기는 검증 대상 CI40165612461/SHA366a0f99c2a77e042f9389b92f9bd8aa133c57ee의 원본/설치 해시에 고정되어 있으므로 새 앱 CI에 그대로 사용해 새 출처라고 주장하지 않는다. 다른 CI를 검증하려면 해시와 기대 출처를 함께 검토·갱신해야 한다.

iOS [실제 자동화 검증 기록](/private/tmp/hledger-qa-full/ios/automation-validation.json)상 auth-navigation은 활성 endpoint/ledger/auth guard, read-filters는 검색 일치/빈 결과·페이지 명령의 기본 동작을 실제 실행했다. 초기 뷰포트·필터 상태를 먼저 맞춰야 한다. 자격 증명 입력의 모호한 선택기가 다른 입력을 겨냥했던 문제 때문에 auth 흐름의 runtime 자격 증명 자동 입력을 제거했다. 구문 통과만으로 폼 조작 전체가 검증됐다고 표현하지 않는다.

books-validation/writes-recovery는 전체 suite로 통과하지 않은 확장 DRAFT다. 실행기는 두 흐름을 `--allow-draft` 없이 거절한다. 해당 옵션은 선택기·fixture guard를 검토한 제한적 후속 실험에만 쓰며 완료 증거가 아니다. 일반 거래의 별도 bounded MCP 실행·독립 원장 감사는 해당 절차 증거이며 전체 YAML suite 성공이 아니다. coordinator의 CUA 관찰 batch는 canonical에서 native-driver로 기록한다.

Android auth-navigation YAML의 `eraseText` 수정은 정적 확인만 수행했다. 이 수정 이후 전체 인증 흐름을 재생해 통과했다고 주장하지 않는다. Android 54개 최종 네이티브 판정은 canonical의 실제 native-driver 증거를 근거로 한다.

## 이번 실행 최종 결과와 재현 한계

[전체 실행 보고서](runs/2026-10-25-full-native.md)의 iOS·Android는 각각54개 native 판정 PASS이며 공유 strict 검증기는 각각 valid/complete true다. 실제 판정은 canonical의 Maestro/native-driver 방법과 UI·원장 증거를 결합한다. iOS 전체 books/write YAML은 여전히 DRAFT이므로108 PASS가 완전한 무인 자동화 suite를 뜻하지 않는다. Android auth-navigation `eraseText` 수정도 정적 확인 범위를 유지한다. 양 플랫폼 영어 오류 본문은 제품 후속으로 남는다.

더 보기 검증은 실제 추가 행을 확인하는 범위이며 모든 페이지의 중복·누락 전수 검증을 뜻하지 않는다. 실행 종료 시 coordinator가 최종 감사 후 QA 프록시 disarm·QA 서비스 종료를 수행한다. Seoji와 기존 개발 서버처럼 원래 환경에 필요한 서비스는 유지한다.

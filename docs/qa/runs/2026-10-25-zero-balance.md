# 2026-10-25 0잔액 필터 수정·잔여 iOS 재검증

현재 상태: **양 플랫폼 집중 재검증 완료 · QA-005 해결 · iOS 잔여 조건 완료**. [이전 실행](2026-10-25-ci-native-retest.md)의 QA-005와 iOS 잔여 조건을 대상으로 한다. 이전 PASS를 새 산출물에 승계하지 않는다.

## 출처·실행 환경

| 항목 | iOS | Android |
| --- | --- | --- |
| CI 실행 / 전체 커밋 SHA | [40165612461](https://github.com/moreal/hledger-app/actions/runs/40165612461) / `366a0f99c2a77e042f9389b92f9bd8aa133c57ee` | 동일 CI/SHA (빌드 성공) |
| 원본 경로 / SHA-256 | `/private/tmp/hledger-qa-zero/artifacts/ios/ios-simulator-production-366a0f99c2a77e042f9389b92f9bd8aa133c57ee/mobile-output/ios-simulator.app.tar.gz` / `276696f93b9a75b629d1a6a691d158ea07758107a497dd50b4854597b83e4e74` | `/private/tmp/hledger-qa-zero/artifacts/android/mobile-output/app-release-unsigned.apk` / `a57cb882c4696922938711f19ef125eb4622b92a07a1748d7cf1f4d34e55035b` |
| manifest / 번들 해시 / 설치 서명 파생 여부 | simulator/unsigned/preparedOnly false/immutable-install, Hermes99 1,982,112 bytes SHA `f03b6170e2b5af15e122fd1d611a158a585f2b6425f6c5e3fe2d546dccb9da96` / 원본 추출 그대로 simctl 설치 성공, 재빌드·재서명 없음 | unsigned/preparedOnly false/immutable-install; Hermes99 1,597,020 bytes `7fc2416f26f6e4a315cc11bce89a4f09000da6d4872fb6f8350291e4b8fc8d58`. 서명만 추가한 설치본 `b3dcb1697d287bd9a3862e9b6c1b015b31bb15e54139667e44f0bbf1396cffae`, 번들 동일 |
| 기기 / OS / 앱 ID / 실행 시각 | iPhone17 iOS26.5 / UUID8B8396F8-B47E-49DE-B5E0-A9731645608C / com.hledger.app / 2026-10-25T05:35:46Z 설치 | sdk_gphone64_arm64 / Android15 API35 / emulator-5556 / com.hledger.app |
| 격리 원장 / 주소 / 자료 초기 상태 | 기존 iOS 원장97dc… / 4102→4100, 빈 원장4104. 기준일 자료 추가 후89거래·5권 | 기존 Android 원장6b55… / 4103→4101 / 기준일 자료 추가 후88거래·5권 |
| 증거 기본 경로 | `/private/tmp/hledger-qa-zero/ios/`, [provenance.json](/private/tmp/hledger-qa-zero/ios/provenance.json) | `/private/tmp/hledger-qa-zero/android/`, [provenance.json](/private/tmp/hledger-qa-zero/android/provenance.json) |

실사용 원장에는 쓰지 않는다. 기존 격리 자료를 초기화하지 않으며, 빈 목록 분기는 별도 빈 격리 원장에서 확인한다. 토큰은 기록하지 않는다. API 회귀 테스트 결과는 네이티브 UI 증거와 구분한다.

## 판정 기준·개별 결과

0잔액은 선택한 기준일까지 선택한 범위(항목 자체/하위 포함)의 자산별 합계가 모두 정확히 0인 상태다. 거래 이력이 있더라도 현재 합계가 0이면 OFF에서 제외해야 한다. 서로 다른 자산의 +1/-1은 상쇄하지 않는다. 필터와 화면에 표시하는 잔액은 같은 기준일·범위를 사용해야 한다.

| ID | 기대 결과 | iOS | Android | 실제 관찰 / 증거 |
| --- | --- | --- | --- | --- |
| Z01 | 집중 회귀: CI 원본·번들 일치, 올바른 앱 설치·실행 | PASS | PASS | iOS provenance: 원본 추출·simctl 설치와 실행 PID72367, 실제 후속 UI 확인. 개발 서버 중단 콜드 실행은 이번에 반복하지 않았다.  Android: New CI exact artifact, Hermes manifest match, same prior debug certificate, signing-only derivative, successful native launch. Development-server absence was not repeated. [provenance.json](/private/tmp/hledger-qa-zero/android/provenance.json) [z01-launch.xml](/private/tmp/hledger-qa-zero/android/z01-launch.xml) |
| Z02 | 집중 회귀: 유효 인증(원장 전환·복귀는 iOS만) | PASS | PASS | iOS4102 인증→빈4104→원래4102 CONNECTED/5권 확인. 후보 실패는 이번에 반복하지 않고 이전 QA-004 B 증거와 구분한다.  Android: Isolated 4103 authentication and correct ledger identity. [z03-connected.xml](/private/tmp/hledger-qa-zero/android/z03-connected.xml) |
| Z03 | 거래 이력 있는 현재 0잔액 항목: OFF 제외 / ON 포함 | PASS | PASS | iOS: asOf 2026-10-02 history 계정: 0잔액 OFF 빈 결과 / ON 0 KRW·거래 2건. [OFF](/private/tmp/hledger-qa-zero/ios/z03-zero-off.png), [ON](/private/tmp/hledger-qa-zero/ios/z03-zero-on.png).  Android: History asOf 10/2: zero OFF no items; ON shows 0 KRW and two historical transactions. Original assets:books: OFF empty; ON two exact-zero book asset balances. [z07-history-zero-off-controls.xml](/private/tmp/hledger-qa-zero/android/z07-history-zero-off-controls.xml) [z08-history-zero-off.xml](/private/tmp/hledger-qa-zero/android/z08-history-zero-off.xml) |
| Z04 | 비영 잔액 항목은 OFF/ON 모두 포함, 표시 금액 일치 | PASS | PASS | iOS: 하위 포함 자산(깊이1) 비영 잔액은 OFF/ON 모두 동일 11 AAPL / 5,110,815.25 KRW / -1,674.4900 USD. [ON](/private/tmp/hledger-qa-zero/ios/z04-nonzero-on.png), [OFF](/private/tmp/hledger-qa-zero/ios/z06-subtree.png).  Android: History asOf 10/1 nonzero 10 KRW remains with zero switch OFF and ON. [z11-history-nonzero-off.xml](/private/tmp/hledger-qa-zero/android/z11-history-nonzero-off.xml) [z12-history-nonzero-on.xml](/private/tmp/hledger-qa-zero/android/z12-history-nonzero-on.xml) |
| Z05 | 기준일 이전에는 비영·이후 0인 항목이 날짜에 맞게 포함/제외 | PASS | PASS | iOS: asOf 2026-10-01, 0잔액 OFF에서 history 10 KRW 표시. 10/02에는 0으로 제외/포함. [기준일](/private/tmp/hledger-qa-zero/ios/z05-asof.png).  Android: Changing asOf 10/2 to 10/1 changes 0 KRW to 10 KRW with exact entered dates evidenced. [z10-history-zero-on.xml](/private/tmp/hledger-qa-zero/android/z10-history-zero-on.xml) [z11-history-nonzero-off-controls.xml](/private/tmp/hledger-qa-zero/android/z11-history-nonzero-off-controls.xml) |
| Z06 | 항목 자체와 하위 포함 범위 변경 시 필터·표시 잔액이 같은 범위 사용 | PASS | PASS | iOS: 검색 자산·깊이1: 자체 범위 0잔액 OFF 빈 결과, 하위 포함 ON 자산 11 AAPL / 5,110,815.25 KRW / -1,674.4900 USD 및 책 표시. [자체](/private/tmp/hledger-qa-zero/ios/z06-own-off.png), [하위](/private/tmp/hledger-qa-zero/ios/z06-subtree.png).  Android: Blank search depth1 zero OFF: own scope empty; subtree scope includes actual 자산 with nonzero mixed balances. ASCII assets parent probe z15/z16 was invalid fixture and excluded from verdict. [z19-korean-parent-own-off-controls.xml](/private/tmp/hledger-qa-zero/android/z19-korean-parent-own-off-controls.xml) [z19-korean-parent-own-off.xml](/private/tmp/hledger-qa-zero/android/z19-korean-parent-own-off.xml) |
| Z07 | 다중 자산: 자산별 +1/-1은 합산 상쇄하지 않고 비영으로 취급 | N/A (네이티브) | N/A | 별도 혼합 자산·정밀 소수 UI fixture를 실행하지 않았다. 이 경계는 unit/API 행렬의 자동 검사 PASS로만 확인하며 A01에 구분한다.  Android: Mixed-commodity precision combinations are automated-only coverage, not native PASS.  |
| Z08 | 깊이·검색 필터와 0잔액 토글 조합, 빈 결과·목록 갱신 | PASS | PASS | iOS: 검색 자산·깊이1·0잔액 OFF에서 자체 범위 빈 결과, 하위 포함 시 갱신된 목록 표시. Z06 증거.  Android: History search 10/1 depth2 excludes, depth3 includes 10 KRW; depth/search conjunction and summary align. New pagination was not rerun. [z17-depth-excludes.xml](/private/tmp/hledger-qa-zero/android/z17-depth-excludes.xml) [z18-depth-includes.xml](/private/tmp/hledger-qa-zero/android/z18-depth-includes.xml) |
| I01 | iOS 실제 소프트웨어 키보드 표시·해제, 입력·스크롤 하단 접근(U01.1) | PASS | N/A | iOS: 실제 한국어 소프트웨어 키보드 표시·검색란 노출. 소프트웨어 삭제로 자산→자, 검색 버튼으로 필터 적용·키보드 해제. [표시](/private/tmp/hledger-qa-zero/ios/i01-keyboard-visible.png), [해제](/private/tmp/hledger-qa-zero/ios/i01-keyboard-dismissed.png). Android: iOS 전용 절차 |
| I02 | 별도 빈 원장 책 목록·새로고침(B01.1) 후 원래 연결 복귀 | PASS | N/A | iOS: 4104 별도 빈 원장 인증 후 등록한 책이 없습니다 표시. [빈 목록](/private/tmp/hledger-qa-zero/ios/i02-empty-books.png). 4104에서 목록 새로고침 후에도 빈 안내 유지([새로고침](/private/tmp/hledger-qa-zero/ios/i02-empty-refreshed.png)). 원래 4102 원장 97dc…에 복귀, CONNECTED와 기존 책 카드 5권 확인 후 토큰 삭제. Android: iOS 전용 절차 |
| C01 | ISBN 9788936434595 자동 제목/저자·실제 표지·출처 | PASS | PASS | iOS: 9788936434595 → 채식주의자/한강, 파란 Aladin 표지 실제 표시. [표지](/private/tmp/hledger-qa-zero/ios/c01-aladin-cover.png).  Android: Actual blue YES24 cover visually inspected after known ISBN lookup. [z23-live-cover.xml](/private/tmp/hledger-qa-zero/android/z23-live-cover.xml) [z23-live-cover.png](/private/tmp/hledger-qa-zero/android/z23-live-cover.png) |
| C02 | 집중 회귀: 미검색·수동 제목 재조회 보존·이전 표지 제거 | PASS | PASS | iOS: 9780000000002 미검색 안내, 직접 입력 QA 책 제목 재조회 후 유지. 직전 성공 ISBN의 파란 표지가 제거돼 [수동 입력](/private/tmp/hledger-qa-zero/ios/c02-manual-retained.png)에 없음. 이번 저자 재입력은 설정 실패해 재검증하지 않았다.   Android: 추가 미검색 ISBN 재조회 증거에서 9780000000002·Manual Missing Retry QA 제목 유지·저자 빈 값·한국어 미검색 안내를 함께 확인했다. [미검색 재조회](/private/tmp/hledger-qa-zero/android/z31-missing-isbn-manual-retry.xml) [화면](/private/tmp/hledger-qa-zero/android/z31-missing-isbn-manual-retry.png). 이전 표지/출처 제거는 z25 증거. |
| C03 | 집중 회귀: 잘못된 소수 금액 한국어 검증·전송 차단·읽기 쉬운 표시 | PASS | PASS | iOS: 금액을 숫자와 소수점으로 정확하게 입력해 주세요 안내와 전송 차단, 읽기 쉬운 표시 확인. [한국어 검증](/private/tmp/hledger-qa-zero/ios/c03-korean-validation.png). 빈/0/음수 각 경계는 이번에 반복하지 않았다.  Android: 1.2.3 rejected with Korean numeric/decimal guidance; no journal change. [z26-korean-invalid-decimal.xml](/private/tmp/hledger-qa-zero/android/z26-korean-invalid-decimal.xml) [z29-invalid-decimal-notice-top.xml](/private/tmp/hledger-qa-zero/android/z29-invalid-decimal-notice-top.xml) |
| A01 | API/client 회귀 검사: 정확한 자산별 0·기준일·하위범위 및 동일 표시 | PASS (자동 검사) | PASS (자동 검사) | CI40165612461 API/client 집중 회귀 8개 통과. 로컬 전체 258개 통과는 별도 검증이다. 정확한 자산별 0/소수·서로 다른 자산 비상쇄·기준일·하위범위 계약을 검사한다. UI PASS와 구분. |

상태는 PASS/FAIL/BLOCKED/N/A/PENDING을 사용한다. 조건부 N/A는 적용되지 않는 이유를 명시한다. 지원하는 주식 매수·매도·원가·수수료는 기존 검증과 구분하고, 제품이 명시적으로 지원하지 않는 자동 실현 손익 하위 조건은 양 플랫폼에서 일관되게 N/A로 취급한다. 이번 수정으로 해당 기능을 추가했다고 주장하지 않는다.

## 결함·잔여 조건

| 항목 | 상태 | 해제에 필요한 증거 |
| --- | --- | --- |
| QA-005 0잔액 필터 | PASS · 해결 | 새 CI 양 플랫폼 Z03~Z06/Z08 실제 조건 통과. Z07 혼합 자산 정밀 경계는 A01 자동 검사 |
| iOS U01.1 소프트웨어 키보드 | PASS | I01 실제 표시·입력·해제 증거 |
| iOS B01.1 빈 책 목록 | PASS | I02 별도 빈 원장·원래 연결 복귀 |
| 주식 자동 실현 손익 | N/A | 제품 미지원, 범위 확장 없음 |

## 완료 판정

양 플랫폼에서 QA-005의 현재 0/비영 잔액·기준일·범위·검색/깊이 재현 조건을 통과했고 iOS 기존 키보드·빈 책 목록 조건도 완료했다. QA-005는 해결로 판정한다. 이번 표 14행 기준 iOS 13 PASS(자동 검사 1 포함)/1 N/A, Android 11 PASS(자동 검사 1 포함)/3 N/A이며 FAIL/BLOCKED/PENDING은 없다. Android 네이티브 실행 원본은 11절차 중10 PASS/1 N/A다. 자동 검사·집중 회귀 범위를 넘어 새 CI 전체54절차 통과를 주장하지 않는다. 혼합 자산 정밀 경계는 자동 검사만, 제품 미지원 자동 주식 손익은 조건부 N/A다.

## 현재 보조 증거·도구 상태

- CI의 API/client 회귀 게이트 PASS, 로컬 전체 258개 테스트 PASS 보고. 네이티브 앱의 개별 UI PASS로 승계하지 않는다.
- [zero-history-validation.json](/private/tmp/hledger-qa-fixture/zero-history-validation.json): 두 격리 원장에 기준일 전 10 KRW·후 0 KRW인 `assets:qa-zero:history`를 추가해 날짜별 OFF/ON과 범위를 API로 확인했다. API 보조 증거이며 Z03~Z06 네이티브 PASS가 아니다.
- 초기 Device Hub getApp 응답 중단은 연결 재시도 후 해소됐고 루트가 실제 UI 검증을 완료했다. provenance.json은 후속 UI 확인과 최종4102 주소/토큰 삭제로 갱신됐다. developmentServerStopped false로 이번 개발 서버 중단 검증 미실행을 명시한다.
- 주 API 4000은 새 계약으로 재시작해 읽기 확인을 통과했다. 이번 네이티브 쓰기 대상은 격리 원장뿐이다.

### iOS 네이티브 관찰

루트가 새 CI 앱에서 격리 주소 4102 인증 후 위 Z03/Z05/Z06/Z08 화면을 직접 확인했다. 원장 쓰기는 하지 않았다. 키보드·빈 책 목록·핵심 회귀도 위 행의 실제 범위만 확인했다. 최종 UI에서 4102 주소를 유지하고 인증 토큰을 지웠다.

### 집중 회귀 범위

C02/C03은 이번에 실제 반복한 하위 절차만 기대 결과로 좁혀 판정했다. 저자 보존 및 빈/0/음수 금액의 전체 경계 검증은 [이전 전체 QA](2026-10-25-ci-native-retest.md)의 산출물별 기록을 참조하며 새 CI에서 재실행한 것으로 주장하지 않는다. 이번 기존 미완료 절차 I01 키보드와 I02 빈 책 목록은 실제 확인했다.

최종 읽기 감사: [final-zero-audit.json](/private/tmp/hledger-qa-fixture/final-zero-audit.json) PASS. iOS 89거래·5권과 빈 fixture 1거래·0권이 유효하며 iOS 원장 해시는 기준일 fixture 추가 직후와 일치한다. 이번 네이티브 검증에서 추가 저장은 없었다.

읽기 전용 정적 검토에서 조치할 결함은 발견되지 않았다. 큰 원장에 대한 성능 평가는 이번 검증 범위에 포함하지 않는다.

## Android 최종 증거·정리

[results.json](/private/tmp/hledger-qa-zero/android/results.json)의 11개 네이티브 집중 절차와 증거 경로를 확인했다. Z02는 유효 인증만 반복했고 원장 전환/후보 실패는 이번에 반복하지 않았다. 개발 서버 중단 콜드 실행 및 페이지 추가도 이번 범위가 아니다. 잘못된 ASCII 부모 fixture 탐색 z15/z16은 판정에서 제외하고 실제 한국어 자산 부모 z19/z20을 근거로 사용했다.

[final-audit.json](/private/tmp/hledger-qa-zero/android/final-audit.json): 88거래·5권, 실행 전후 원장 SHA-256 `e665fdd1d50cf52db01a61e13375fa75bb36b0ccffa692be008d20a04f7437fe` 일치. 새 구매/원장 쓰기 없음. [최종 정리](/private/tmp/hledger-qa-zero/android/z32-final-cleanup.xml) 증거를 남겼다. 네이티브 화면은 iOS 파란 Aladin 표지와 Android 파란 YES24 표지를 각각 확인했으며 서로 같은 공급자라고 주장하지 않는다.

# 공통 디자인 토큰

`src/index.ts`의 `tokens`가 React 웹과 Expo/React Native의 공통 원본입니다. 순수 TypeScript이며 플랫폼 또는 런타임 의존성이 없습니다. 각 UI 패키지는 상대 경로로 가져와 웹 CSS 변수 또는 네이티브 스타일에 연결합니다.

| 그룹 | 키와 값 |
| --- | --- |
| `space` | `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `xxl` 32, `xxxl` 48 |
| `radius` | `control` 10, `panel` 16, `feature` 24, `pill` 999 |
| `fontSize` | `caption` 13, `small` 14, `body` 16, `title` 24, `display` 32. 기존 크기 키 유지 |
| `size` | `controlMin` 44 |
| `fontFamily` | `web` 시스템 서체 스택, `native` System |

## 역할과 상태 색상

| 역할 | 토큰과 값 | 사용 |
| --- | --- | --- |
| 잔액 카드 | `featureBackground` #1F3151, `featureText` #FFFFFF, `featureMuted` #D5DFF0 | 대표 계정 잔액의 강조 표면·주요 정보·보조 정보 |
| 기본 표면 | `background` #F7F8FA, `surface` #FFFFFF | 페이지·패널 배경 |
| 보조·상호작용 표면 | `surfaceSubtle` #F2F4F7, `surfaceHover` #EDF1F5, `surfacePressed` #E7ECF2 | 보조 영역과 중립 컨트롤의 hover·pressed |
| 텍스트 | `text` #18212B, `muted` #5B6775 | 본문·보조 설명 |
| 경계 | `border` #DCE1E7, `borderStrong` #758294 | 장식 구분선·입력 등 식별 가능한 경계 |
| 강조 | `accent` #2458A6, `accentSubtle` #EAF1FB | 주요 행동·선택 항목의 약한 배경 |
| 주요 행동 상태 | `accentHover` #1E4D93, `accentPressed` #193F79, `onAccent` #FFFFFF | 주요 버튼 배경과 그 위의 레이블 |
| 성공 | `success` #23704A, `successSubtle` #EAF5EF | 성공 전경과 약한 배경 |
| 주의 | `warning` #915E0B, `warningSubtle` #FFF4DE | 주의 전경과 약한 배경 |
| 오류 | `danger` #B42318, `dangerSubtle` #FFF0EE | 오류 전경과 약한 배경 |
| 포커스 | `focus` #2458A6 | 키보드 포커스 표시 |
| 비활성 | `disabledSurface` #EDF0F3, `disabledText` #5B6775 | 사용할 수 없는 컨트롤의 배경·레이블 |

기존 색상 키와 값은 유지합니다. `accent`는 hledger의 기존 파랑이며 다른 회사의 브랜드 색을 복제한 값이 아닙니다. 비활성 상태도 레이블의 대비를 유지하고 실제 disabled 속성과 함께 사용합니다. 전체 컨트롤에 opacity를 적용하면 보장한 대비가 달라집니다.

## 텍스트 역할

`typography`의 각 항목은 `{fontSize, lineHeight, fontWeight}`입니다. `fontWeight`는 웹과 네이티브에서 공통으로 사용하는 문자열입니다.

| 역할 | 크기 / 행간 / 굵기 | 사용 |
| --- | --- | --- |
| `hero` | 32 / 40 / 600 | 대표 계정의 잔액. 좁은 화면에서도 정밀도를 보존하며 줄바꿈 |
| `title` | 24 / 32 / 600 | 화면 제목 |
| `heading` | 20 / 28 / 600 | 섹션 제목 |
| `body` | 16 / 24 / 400 | 본문과 주요 목록 정보 |
| `label` | 14 / 20 / 600 | 입력·컨트롤 레이블 |
| `supporting` | 14 / 22 / 400 | 계정 경로·도움말·보조 설명 |
| `caption` | 13 / 20 / 400 | 작은 부가 정보. 필수 경로·레이블·도움말에는 사용하지 않음 |
| `amount` | 16 / 24 / 600 | 금액 |

간격·크기의 숫자는 웹에서 CSS px, 네이티브에서는 논리 단위로 해석합니다. `controlMin`은 버튼·입력·선택 등 조작 영역의 최소 크기이며, 내용과 사용자 글자 크기에 따라 더 커질 수 있습니다. 높이를 고정해 확대된 글자를 자르지 않습니다. 숫자는 플랫폼에서 tabular figures를 적용하고 우측 정렬합니다.

본문·보조·강조·상태 텍스트는 흰 표면과 기본 배경에서 WCAG AA 일반 텍스트 대비 4.5:1 이상입니다. 본문·보조·비활성 텍스트는 중립 상태 표면에서도 4.5:1 이상이며, 상태 전경은 해당 `*Subtle` 배경과 짝지어 사용합니다. 성공·주의·오류에는 상태 문구를 함께 제공합니다. 금액의 부호나 commodity만 보고 수입·지출 색상을 결정하지 않습니다.

`border`는 장식용 경계이며 입력의 유일한 식별 표시나 포커스 표시로 사용하지 않습니다. `borderStrong`과 `focus`는 흰색·페이지·중립 상태 표면에 대해 3:1 이상입니다. 진한 주요 버튼에는 표면색 간격을 둔 포커스 외곽선을 적용해 동일한 파랑끼리 맞닿지 않게 합니다. 포커스 두께·간격과 실제 조작 영역은 소비하는 UI에서 검증합니다.

| 검증한 조합 | WCAG 대비 |
| --- | --- |
| `muted` / `surfacePressed` (중립 표면 중 최저) | 4.85:1 |
| `accent` / `accentSubtle` | 6.11:1 |
| `success` / `successSubtle` | 5.39:1 |
| `warning` / `warningSubtle` | 5.05:1 |
| `danger` / `dangerSubtle` | 5.93:1 |
| `onAccent` / `accentHover`, `accentPressed` | 8.27:1, 10.35:1 |
| `borderStrong` / `surface`, `surfacePressed` | 3.91:1, 3.29:1 |

## 공식 자료에서 채택한 원칙

[Daangn SEED Color role](https://seed-design.io/foundations/color/color-role)의 전경·배경·경계 역할과 상태 구분, [Toss TDS Typography](https://tossmini-docs.toss.im/tds-mobile/foundation/typography/)의 텍스트 역할별 크기·행간 구분을 적용합니다. 강한 행동과 약한 선택 배경의 위계 및 시스템 서체·확대 대응의 근거는 [공식 자료 감사 기록](../../docs/design-system-reference-audit.md)에 함께 정리했습니다.

여기의 색상 값·14–16px 업무 텍스트·10/16/24 모서리는 hledger의 선택입니다. 해당 회사의 토큰을 그대로 옮기거나 공식 구현이라고 주장하지 않습니다. SEED가 설명하는 APCA와 이 저장소가 검사하는 WCAG 상대 휘도 대비는 다른 지표입니다. WCAG 테스트 통과로 APCA 또는 각 회사의 전체 접근성 기준을 충족한다고 주장하지 않습니다.

`packages/domain/src/index.ts`는 다음 공유 도구와 가상 자료를 제공합니다.

- `formatDecimal(value)`는 `^-?[0-9]+(\.[0-9]+)?$` 문법의 문자열을 받아 정수부에 천 단위 쉼표를 넣습니다. 부호·선행 0·소수 자릿수·후행 0을 보존하고 잘못된 입력은 `TypeError`로 거부합니다. 숫자 변환, 반올림, 지수 표기 전환을 하지 않습니다.
- `formatMoney(value, commodity)`는 `1,234.00 USD`처럼 명시적 commodity를 붙입니다. 환산하거나 다른 commodity를 합산하지 않습니다.
- `galleryFixtures`는 기본 `accounts`, `transactions`, `prices` 배열과 같은 구조의 `worstCase` 묶음입니다. `MoneyAmount`는 `{value: string, commodity: string}`이고 계정별 `balances`와 분개별 `amount`로 유지합니다. 거래 금액 하나로 합산하지 않습니다.
- `GalleryAccount`, `GalleryTransaction`, `GalleryPosting`, `GalleryPrice`, `GalleryFixtureSet` 타입은 UI가 읽을 수 있는 `readonly` 자료 계약입니다. 최악 자료에는 긴 한국어 경로, 큰 정수, 작은 소수, 여러 commodity와 빈 거래 이력이 있습니다. 실제 원장 연결이나 실제 환율 자료가 아닙니다.

검증: 루트의 `yarn test`는 decimal 표시와 토큰 대비·최소 조작 크기를 확인합니다. 실제 조작 영역, 키보드 포커스, 네이티브 글자 확대 동작은 각 갤러리에서 별도로 확인합니다.

잔액 카드는 실제 가상 자료의 특정 계정을 명시한다. 다른 계정이나 commodity를 합산한 총자산처럼 표현하지 않는다. 새 어두운 표면 위의 주요·보조 텍스트도 4.5:1 이상 대비를 검사한다.

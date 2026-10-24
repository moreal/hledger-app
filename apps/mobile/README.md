# Expo 모바일 장부 앱

Android와 iOS가 공유하는 React Native 앱입니다. 웹과 같은 GraphQL API에서 계정·거래·시세를 읽고 거래를 입력하며, 최근 거래 복사·입력 템플릿과 기기 대기열을 제공합니다. API와 격리된 샘플 장부는 [루트 실행 안내](../../README.md#샘플로-실행하기)에 따라 준비합니다.

저장소 루트에서 실행합니다.

```sh
yarn app:mobile
```

기본 번들러는 Rollipop이며 `127.0.0.1:8082`에서 실행됩니다. 호환 Expo Go가 설치된 iOS 시뮬레이터에서 `exp://127.0.0.1:8082`를 엽니다. Android 에뮬레이터에서는 `adb reverse tcp:8082 tcp:8082` 후 같은 주소를 엽니다. 네이티브 Metro는 루트의 `yarn app:mobile:metro` 또는 이 워크스페이스의 `yarn start:metro`로 명시적으로 선택합니다. 브라우저 미리보기는 Expo Metro로 시작합니다.

```sh
yarn app:mobile:web
```

<http://localhost:8081>에서 미리볼 수 있습니다. 동기화 화면의 연결 설정에 GraphQL endpoint와 bearer token을 입력하고 `연결 적용 · 주소 기억`을 선택합니다. 기본 주소는 `http://localhost:4000/graphql`입니다. endpoint와 마지막 장부 식별자는 기기에 저장하고 토큰은 앱 실행 중에만 유지합니다. 재시작 후에는 토큰을 다시 입력합니다. 실제 기기에서 컴퓨터의 `127.0.0.1`에는 연결할 수 없으므로 접근 가능한 컴퓨터 주소와 API의 수신 주소·허용 origin을 명시적으로 설정합니다. [API 환경 변수](../../services/api/README.md#환경-변수)를 참고합니다.

## 임시 입력과 대기 거래

기기 보관을 선택한 입력·대기 거래·템플릿을 저장합니다. 보관하지 않은 입력 중 내용은 메모리에만 있으므로 재시작하면 사라집니다. Android/iOS는 `expo-file-system`의 앱 문서 영역, 웹 미리보기는 브라우저 `localStorage`를 사용합니다. 두 개의 저장 사본을 번갈아 기록하고 다시 읽어 확인합니다. 하나가 불완전하면 정상 사본을 복구하고 안내하며, 모두 손상되면 원본을 보존하고 새 저장을 중단합니다. 이 저장 방식은 암호화 저장소가 아니며 금융 자료를 포함합니다. 앱 삭제·브라우저 저장소 삭제 시 복구할 수 없습니다.

대기 거래는 전송 전 먼저 저장하며 재시도할 때 원래 멱등키를 유지합니다. 재시작 중 전송되던 거래나 응답을 확인하지 못한 거래는 확인 필요 상태로 남습니다. 대기열을 복구했다고 자동 전송하지 않습니다. 인증·입력 오류는 차단 상태로 표시하므로 원인을 해결하고 직접 재시도합니다. 저장된 거래는 원래 API endpoint와 연결 시 확인한 장부 식별자에 묶입니다. 다른 endpoint나 다른 장부 경로로 재설정된 서버에 이전 대기 거래를 전송하지 않습니다. 토큰은 저장 자료에 포함하지 않으며 네트워크 쓰기·재시도 전에는 현재 실행에서 인증된 연결 확인이 필요합니다.

템플릿·복사는 새로운 입력을 만들며 저장 전에 날짜·계정·모든 분개·commodity를 확인합니다. 기존 복수 commodity 거래는 읽을 수 있지만 신규 생성은 단일 commodity·최소 두 분개·정확한 합계 0으로 제한합니다.

## 디자인 갤러리와 기기 검증

`디자인 갤러리 보기`로 가상 데이터 갤러리에 들어가고 `실제 원장으로`로 돌아옵니다. 갤러리의 저장 상태는 데모이며 실제 장부에 쓰지 않습니다. `app:mobile`과 `app:mobile:web`은 실제 앱과 갤러리를 함께 시작하며 기존 `gallery:mobile` 계열도 같은 별칭입니다.

- 좁은 화면·가로 방향에서 긴 계정명과 큰 금액·작은 소수의 전체 자릿수, 안전 영역과 44pt 조작 영역을 확인합니다.
- 키보드를 연 상태에서 모든 입력과 저장 버튼까지 이동하고, 시스템 글자 확대에서 내용을 읽을 수 있는지 확인합니다.
- VoiceOver·TalkBack으로 선택 상태, 계정 잔액, 대기 상태와 입력 오류 안내를 확인합니다.
- 격리된 장부에서 저장, 앱 재시작 후 대기열 복구, 같은 키 재시도와 endpoint 전환 시 전송 차단을 확인합니다.

루트의 `yarn typecheck`는 타입 검사를 실행합니다. Expo 웹 미리보기·번들 생성은 실제 iOS·Android 기기의 실행·파일 저장·키보드·화면 읽기 검증을 대신하지 않습니다. 실제 기기 검증은 별도로 기록합니다.

## 네이티브 Release 빌드

저장소 루트에서 실행합니다. 각 명령은 별도 작업 폴더에서 Expo prebuild, 네이티브 번들 설정과 빌드를 수행합니다.

```sh
yarn build:mobile:ios --work-dir /tmp/hledger-release-ios --output-dir /tmp/hledger-artifacts-ios
yarn build:mobile:android --work-dir /tmp/hledger-release-android --output-dir /tmp/hledger-artifacts-android
```

iOS 기본 대상은 서명 없는 시뮬레이터 `.app`이며 `--ios-target device`로 서명 없는 기기 아키텍처를 컴파일합니다. Android는 서명 없는 Release APK를 생성합니다. 스토어 배포 서명은 별도 설정이 필요합니다. Rollipop은 production 옵션으로 번들을 만들고 React Native 네이티브 빌드가 Hermes와 자산을 패키징합니다. 도구 버전, CI 실행과 산출물은 [Release 자동화 안내](../../docs/mobile-release-ci.md)를 참고합니다.

# 이전 REST 계약 보관소

이 디렉터리는 GraphQL 전환 전 자료를 원본 내용 그대로 보관합니다. 현재 계약의 원본은 상위 `schema.graphql`과 `operations.graphql`이며, 현재 실행 절차는 [GraphQL 코드 생성 안내](../../../docs/graphql-codegen.md)를 따릅니다.

| 보관 경로 | 이전 위치와 용도 |
| --- | --- |
| `openapi/v1.openapi.json` | `packages/api-contract/openapi/v1.openapi.json`: 앱 전용 REST v1 계약 |
| `schemas/*.schema.json` | `packages/api-contract/schemas/`: 요청·응답 JSON Schema 9개 |
| `openapitools.json` | 저장소 루트: OpenAPI Generator 7.19.0 고정 설정 |

OpenAPI와 JSON Schema 간 상대 참조를 유지하도록 두 디렉터리를 함께 이동했습니다. 설정의 도구 경로도 역사 기록 그대로 보존합니다. 이 폴더는 실행 가능한 이전 개발 환경이나 병행 유지할 두 번째 계약이 아닙니다. 현재 코드 생성 입력으로 사용하지 않으며, 계약 보존 테스트가 이전 필드와 제약을 확인하는 자료로 참조할 수 있습니다.

전환 시 필드 이름은 camelCase, 태그는 키/값 목록으로 통일합니다. cursor 응답은 GraphQL connection으로 바뀌고 실제 생성 시각이 없는 거래·인덱서 지연은 nullable로 표현합니다. 새 거래 입력의 단일 commodity 제한과 GraphQL Int 상한도 의도적 변경입니다. 자세한 대응은 [현재 계약 README](../README.md)를 참조합니다.

초기 Kotlin·Swift SDK 생성은 React·Expo 공통 TypeScript 작업 타입 생성으로 대체했습니다. GraphQL 계약과 검증 함수는 실제 서버·인증·멱등 저장 구현을 뜻하지 않습니다.

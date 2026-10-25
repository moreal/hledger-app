# 해외 ISBN 서지·표지 출처 조사

기준일: 2026-10-25. 공식 문서 확인에 기반한 설계 조사이며, 전체 ISBN 표본 테스트나 구현은 하지 않았다.

## 키 없이 해외 책을 조회할 수 있는가?

### Takeaway
가능하다. 작은 개인용 앱의 기본 해외 공급자는 Open Library 하나로 시작하고, 나머지는 실제 미검색 사례가 쌓일 때 추가하는 구성이 현실적이다. 검색 성공률이나 국가별 수록률은 검증하지 않았으므로 수치로 보장하지 않는다.

### Cited Findings
- **Open Library**: 공개 ISBN API는 `/isbn/{ISBN}.json`으로 해당 Edition에 접근한다. Work는 여러 판본을 묶고 Edition은 ISBN·출판사·표지 등 판본 정보를 가진다. 한 번에 저자 이름까지 얻으려면 `/api/books?bibkeys=ISBN:{ISBN}&jscmd=data&format=json`의 `title`, `authors`, `identifiers`, `publishers`, `cover`를 활용할 수 있다. 공개 조회 예시에 키가 없다. — [Books API](https://openlibrary.org/dev/docs/api/books)
- 기본 API 제한은 미식별 요청 초당 1회, 앱 이름과 연락처를 User-Agent로 식별하면 초당 3회다. 사람의 실시간 조회·캐시를 권장하며 대량 수집은 월별 덤프를 이용해야 한다. 고트래픽 상용 서비스의 백엔드로 쓰는 용도는 지원하지 않는다. — [API 이용 지침](https://openlibrary.org/developers/api)
- 표지는 ISBN·OLID·CoverID로 조회하며, `?default=false`를 붙이면 누락 시 빈 이미지 대신 404를 준다. ISBN 등으로 접근하는 표지는 IP당 5분 100회 제한이 있다(CoverID·OLID 제외). 공개 페이지에서는 원본 표지 URL을 직접 쓰도록 안내한다. — [Covers API](https://openlibrary.org/dev/docs/api/covers)
- Internet Archive는 DB에 새 독점권을 주장하지 않지만, 기여 자료와 관할권에 기존 권리 문제가 남을 수 있다고 명시한다. 따라서 메타데이터 개방을 표지 저작권 전체의 소멸로 해석하면 안 된다. — [Licensing](https://openlibrary.org/developers/licensing)
- **Google Books**: `q=isbn:{ISBN}` 검색과 `authors`, `industryIdentifiers`, `imageLinks`를 제공한다. 공개 데이터는 사용자 OAuth 인증 없이 읽을 수 있지만, 앱 식별을 위한 API 키 또는 OAuth 토큰은 공식 요구사항이다. 익명 호출이 우연히 성공해도 ‘키 없는 지원 경로’로 분류하지 않는다. — [조회·식별 요구사항](https://developers.google.com/books/docs/v1/using), [Volume 필드](https://developers.google.com/books/docs/v1/reference/volumes)
- Google API 문서의 CC BY 표시는 응답 서지·표지 전체에 대한 라이선스가 아니다. Google은 보유 데이터 상당수가 별도 라이선스라고 설명한다. Books API 추가 약관에는 앱 사용료와 권리침해 콘텐츠 삭제 조건도 있으므로 선택 연결 전에 확인해야 한다. — [개요](https://developers.google.com/books/docs/overview), [추가 약관](https://developers.google.com/books/terms)

### Inferences
- 기본안: 한국 SeoJi 조회가 없거나 실패하면 **Open Library 서지 조회 → 정확한 ISBN 확인 → 같은 판본 표지 → 직접 입력**. Google Books는 키를 설정한 사용자만 선택적으로 연결한다. 기존 공급자 오류가 해외 조회를 막지 않아야 한다.
- 표지는 가능하면 확인된 Edition의 CoverID를 사용한다. 작품 대표 표지로 임의 대체하지 않는다. ISBN 판본 매칭은 정확도를 높이지만, 모든 인쇄 차수의 실제 표지까지 같다는 보장은 하지 않는다.

### Gaps
- Google Books의 고정 일일 쿼터는 이번 공식 문서에서 확인하지 못했다. 프로젝트 콘솔에서 실제 할당량 확인이 필요하다.
- Open Library가 동일 ISBN의 서로 다른 쇄·재킷까지 완벽히 구분한다는 공식 보장은 찾지 못했다.

## 지역별 보완 출처를 지금 모두 넣어야 하는가?

### Takeaway
당장은 필요하지 않다. 프랑스 BnF와 일본 NDL은 서지 보완 후보이고, DNB는 추가 확인 후보로 둔다. 일본 openBD를 종료 서비스로 단정하는 것도, 예전 표지 수록 범위를 그대로 기대하는 것도 부정확하다.

### Cited Findings
- **BnF**: Catalogue général SRU는 인증 없이 누구나 ISBN·저자·제목 등을 조회하고 XML(Dublin Core·UNIMARC·Intermarc)을 받는다. 메타데이터는 출처 표시를 요구하는 프랑스 국가 Open Licence이며, 디지털 이미지에는 별도 조건이 적용된다. SRU 실시간 검색과 MARC 데이터셋 다운로드는 별도 수단이다. — [SRU](https://api.bnf.fr/fr/api-sru-catalogue-general), [메타데이터·이미지 이용 조건](https://www.bnf.fr/fr/portail-bnf-api-et-jeux-de-donnees), [다운로드](https://www.bnf.fr/fr/recuperer-les-donnees-de-la-bnf-au-format-marc)
- **DNB**: DNB 공식 자료는 서지 메타데이터의 무료 CC0 제공 및 SRU·OAI·전체 덤프 이용을 확인한다. 오래된 자료에는 등록 요구가 있고 이후 공식 자료에는 접근 간소화가 설명되어 있다. — [DNB 공식 설명](https://blog.dnb.de/die-daten-sind-frei/), [공식 2021 보고서](https://d-nb.info/1243765690/34)
- **일본 NDL Search**: SRU·OpenSearch 실시간 검색과 OAI-PMH 수집을 구분한다. 현행 SRU 문서는 10·13자리 ISBN을 상호 변환하여 완전 일치 검색한다고 명시한다. 무인증 URL 호출과 데이터 재이용 허가는 별개이며, 데이터 제공기관·영리 여부에 따라 신청이 필요할 수 있다. 과다 동시 접근 제한은 있으나 숫자 기준은 공개하지 않는다. — [API 개요](https://ndlsearch.ndl.go.jp/help/api/specifications), [2026 사양](https://ndlsearch.ndl.go.jp/file/help/api/specifications/ndlsearch_api_20260331.pdf), [이용 조건](https://ndlsearch.ndl.go.jp/help/api)
- **openBD**: 현재 공식 사이트는 키 없는 `/get?isbn=...` JSON API와 동기화용 API를 계속 안내한다. 2023년 후속 공지는 JPRO 데이터를 NDL 기반 대체 서지로 전환하며 일부 필드 누락과 표지 범위의 큰 축소를 예고했다. 데이터·표지는 책의 판촉·소개 목적에 한정되고, 캐시 변경 반영·삭제 요청 준수·임의 변경 금지 조건이 있다. — [현행 안내·이용 지침](https://openbd.jp/), [대체 서지 공지](https://openbd.jp/news/20230829.html)

### Inferences
- 확장 우선순위는 ‘전 세계 모든 기관 연동’보다 실제 사용자 미검색 ISBN을 기준으로 한다. 일본 책 수요가 크면 NDL, 프랑스 책 수요가 크면 BnF를 추가한다. 각 XML 파서·필드 정규화·권리 조건 때문에 공급자마다 유지 비용이 생긴다.
- 개인 가계부의 도서 기록이 openBD의 ‘책 소개’에 해당하는지는 단정하지 않는다. 조건을 명확히 확인하기 전 기본값으로 채택하지 않는다.

### Gaps
- DNB 현행 SRU 문서가 조사 도구에서 403이어서 최신 인증·속도 제한을 확정하지 못했다. BnF의 숫자형 속도 제한도 확인하지 못했다. 이 출처들의 표지 재사용 권한이나 완전한 현대 책 표지 제공은 확인하지 않았다.
- 외부 API의 현재 응답·CORS·국가별 수록률은 직접 검증하지 않았다. openBD는 현행 공식 안내를 확인했으나 API 가용성을 실측하지 않았다.

## 현재 코드 설계에 주는 영향은?

### Takeaway
현재는 표지 폴백만 있어 해외 서지 폴백이 작동하지 않는다. 선택형 책 기능을 분리할 때 서지 공급자와 표지 공급자를 구분해야 한다.

### Cited Findings
- 로컬 `services/api/seoji.ts`를 직접 확인했다. SeoJi가 404이면 `NOT_FOUND`, 실패하면 `UNAVAILABLE`로 즉시 반환한다. 성공한 서지를 파싱한 뒤에만 `lookupBookCover`·`lookupBookstoreCover`가 실행된다. — [확인 파일](../../services/api/seoji.ts)

### Inferences
- 서지 공급자 간 폴백을 먼저 수행하고, 선택된 동일 ISBN의 서지에 표지를 보충한다. 서지·표지 출처는 각각 저장하고, 미검색·서비스 장애·표지 없음은 구분한다. 공급자를 모두 소진해도 수동 입력으로 구매 기록을 계속할 수 있게 한다.

### Gaps
- 구현·실제 조회 테스트는 이번 범위에 포함하지 않았다.

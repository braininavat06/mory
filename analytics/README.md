# Mory Analytics v1

공개 사이트 → `analytics.mory.place/event` Worker → 기존 `mory-analytics` D1.
관리 화면 → localhost/tailnet CMS → **outbound HTTPS** Cloudflare D1 API.
Mac mini inbound, Tunnel, public CMS, R2, CMS SQLite/publish/backup 구조 변경은 없습니다.
Worker와 CMS Analytics는 독립적으로 실패하며 글 작성/게시를 차단하지 않습니다.

## 파일과 실행

- `worker/index.ts`: 공개 수집 endpoint / cron, JSON·origin·bot·rate limit 검증.
- `protocol.ts`: event contract, UUID, 호스트 분류, 기기 family, 날짜/기간 기준.
- `core.ts`: D1 binding/SQLite 공통 SQL, atomic visitor summary, rollup/retention.
- `queries.ts`: CMS의 공용 조회 SQL. 전체 이력은 aggregate + 아직 집계되지 않은 날만 조회.
- `migrations/0001_analytics.sql`: Wrangler migration ledger로 한 번만 적용하는 초기 schema.
- `cms/server/analytics.ts`: server-only D1 REST, 별칭, Google service-account sync.
- `cms/client/Analytics.tsx`: lazy-loaded 개요/방문자/페이지/검색 화면.
- `src/scripts/analytics.ts`: 작은 non-blocking public client. `search.ts`에서 Pagefind 결과 확정/클릭 연결.
- `src/pages/privacy.astro`: footer에서 연결되는 방문 통계 안내.

```sh
npm run analytics:check
npm run analytics:test
npm run analytics:migrate:local
npm run analytics:build   # --dry-run; 원격 변경 없음
npm run analytics:measure
```

개발 산출물과 local D1은 `runtime/` 안에 있고 Git에서 제외됩니다.
`analytics:test`는 esbuild로 실제 Worker를 bundle하고 Miniflare/workerd의 로컬 D1을 사용합니다.
테스트 key/UUID만 사용하며 운영 credential은 읽지 않습니다.
`npm test`에도 Analytics tests가 포함됩니다. 별도의 상주 프로세스는 추가하지 않습니다.

## 데이터 계약

public UUID: `crypto.randomUUID()`, `localStorage.mory_visitor_id`.
Worker HMAC-SHA256의 앞 160bit(40 hex)를 `visitor_key`로 저장합니다.
UUID 원문을 DB에 넣지 않습니다. secret은 재방문 identity의 일부이므로 무심코 교체하지 않습니다.
다른 기기/브라우저를 연결하지 않고 저장소 삭제/차단 시에는 identity가 유지되지 않을 수 있습니다.

| 테이블 | 내용 / 수명 |
|---|---|
| visitors | integer ID, HMAC key, 최초/최근 시각·페이지, 누적 PV/방문, 별칭 / 영구 |
| pages | post ULID 또는 route+path identity, 유형, 현재 canonical path / 영구 |
| page_paths | page별 과거 path dimension / 영구; raw 방문 당시 주소 보존 |
| referrers | 호스트 + direct/internal/search/social/external 유형 / 영구 |
| pageviews | 시각(epoch 초), visitor/page/path/referrer integer ID, 국가, device/browser/OS family, 새 방문 flag / 365일 |
| search_events | 시각, visitor/page ID, 원문·공백 정규화 query, 결과 수 / 365일 |
| search_clicks | 시각, visitor/클릭 대상 page ID, 정규화 query, 순위 / 365일 |
| pending_days | 아직 최종 집계되지 않았거나 다시 집계할 날짜 / 완료 후 삭제 |
| daily_stats | 일별 PV, 고유/신규/재방문자, 방문 수 / 영구 |
| daily_page_stats | day+page+path별 조회·도착·최초/최근 / 영구 |
| daily_referrer_stats | day+referrer별 조회·도착 / 영구 |
| daily_breakdowns | day별 국가/device/browser/OS 분포 / 영구 |
| daily_search_stats | day+공백 정규화 query별 검색·결과 없음·클릭 / 영구 |
| external_search_stats | Google date/query/landing path, clicks/impressions/CTR/position / 영구; visitor FK 없음 |
| external_sync_days | Google 동기화 날짜 / 영구 |
| storage_daily | 날짜별 실제 D1 size_after bytes / 영구 |

`page_stats`, `referrer_stats`, `internal_search_stats`는 영구 일별 집계에 대한 view입니다.
누적 값은 원본 상세 로그에 의존하지 않습니다.

index: raw table의 timestamp, visitor+timestamp; PV에는 page+timestamp도 있습니다.
visitor 최근/최초 index, daily table date 또는 entity+date PK, 외부 검색 date index를 사용합니다.
DB에는 IP, full UA, 위치/도시, 화면 크기, 언어, fingerprint, session UUID,
full referrer URL/query, fragment, UTM, 페이지 제목, category/series를 방문별로 저장하지 않습니다.
공개 이미지 시스템을 사용하지 않습니다.

## 수집과 집계

- `POST /event`, JSON 최대 2KiB, path 512자, 내부 query 200자, 2자 이상.
- event별 allowlist schema: 예상하지 못한 필드 거부, SQL parameter binding.
- 허용 origin은 `https://mory.place`, `https://www.mory.place`. POST 및 CORS preflight만 지원.
- bot UA/verified bot은 drop. edge rate limiter는 60req/min/IP bucket.
  IP는 rate bucket을 HMAC하는 순간에만 사용하고 DB/log/visitor identity에는 넣지 않습니다.
  rate limiting은 edge 위치별 best effort이며 origin도 인증 수단이 아닙니다. 수치는 보안 감사 로그가 아닙니다.
- public client는 실제 HTTPS mory.place/www에서만 동작. localhost, CMS, preview에서는 식별자도 만들지 않습니다.
- sendBeacon → queue 거부 시 keepalive fetch, 실패 시 재시도 없음. Back/Forward cache 복원도 PV를 기록합니다.
- Pagefind 검색을 실제 수행한 뒤 800ms debounce; 같은 visitor/query의 60초 반복 억제.
  click 전 pending 검색을 먼저 보내고 query, 1-based rank, clicked post ULID/path를 보냅니다.
- 30분 이상 PV 간격은 새 방문. INSERT가 직전 `last_view_at`를 읽고 같은 batch의 trigger가 summary를 갱신합니다.
  동시 요청은 D1 atomic batch로 직렬화됩니다. 별도의 session identifier는 없습니다.
- raw 시각은 서버 epoch 초. 방문 통계 일자는 Asia/Seoul. 검색어 normalization은 trim/공백만.
- cron은 매시 UTC 15분: 완료된 날짜 최대 7개를 집계, expiry table별 최대 1,000행 삭제.
  현재 날은 live raw로 보여주며, 아직 집계되지 않은 날은 aggregate에서 제외하고 raw로 대체합니다.
- rollup은 날짜의 모든 aggregate를 같은 transaction에서 **교체**하므로 반복/crash에 중복되지 않습니다.
  transaction 안에서도 pending marker를 검사해 stale rollup이 expiry 후 누적 값을 덮어쓰지 않습니다.
- cleanup은 365일 이전이면서 rollup 완료·pending 없음인 날만 삭제합니다.
  cron 장애 시 다음 cron에서 재시도하며, UI raw timeline/search는 cutoff 이전을 표시하지 않습니다.
- 개인정보 보호 때문에 daily visitor presence를 영구 저장하지 않습니다.
  전체 누적 UV와 최근 365일 기간 UV는 정확합니다. 365일 이전을 포함하는 직접 선택 기간의
  여러 날짜에 걸친 UV는 재구성할 수 없어 `—`와 설명을 표시합니다. 일별 UV는 영구 유지합니다.
- 일반 브라우저 UA로 기기 family를 추정합니다. desktop UA를 쓰는 iPad 등은 desktop으로 보일 수 있습니다.

## CMS와 Google/Naver

CMS `통계` 메뉴: 개요/방문자/페이지/검색, 오늘/7일/30일/1년/전체/직접 선택.
방문자는 누적 기준, 상세 timeline은 최근 365일(30분 visit별 그룹), 별칭은 수정/빈칸 제거.
목록과 timeline은 pagination, 통계 상위 항목은 100개/유입 20개로 제한합니다.
DB 상태는 명시적으로 열어 조회하며 5분 cache합니다. 원본 row count 조회 비용을 매 refresh마다 만들지 않습니다.
크기 경고 기본값은 70/80/90%; env에서 변경할 수 있습니다. 30일 용량 변화는 측정이 쌓인 이후 표시합니다.
API 장애는 통계 내부 오류로 표시하고 React boundary도 CMS 나머지를 보호합니다.

Google Search Console:
- 공식 Search Analytics API, `webmasters.readonly` scope. service-account JSON은 서버에서만 읽습니다.
- default property `sc-domain:mory.place` (URL-prefix property를 쓰면 env로 지정).
- 수동 sync는 **Pacific 날짜 기준 3일 전~30일 전(28일)** 확정 데이터.
- dimensions=date/query/page, 페이지 단위 API pagination. 날짜 전체를 검증한 뒤 atomic replacement.
- Google 제공 범위는 전체 검색어를 보장하지 않습니다. 개별 visitor와 연결하지 않습니다.
- 하루 batch는 998행까지 처리합니다. 초과 시 그 날짜를 부분 교체하지 않고 명확한 오류로 중단합니다.
  큰 사이트가 되어 이 제한에 실제로 닿으면 staged import로 확장해야 합니다.
- 날짜별 sync가 독립적으로 완료되므로 뒤 날짜 API 실패 시 이미 성공한 날짜와 기존 다른 날짜는 유지됩니다.

Naver: 공개 공식 검색어 통계 API를 확인하지 못했습니다. 공식 수집요청 API는 이 목적과 다릅니다.
유입 호스트·landing page만 기록하며 scraping/비공식 endpoint/브라우저 자동화는 하지 않습니다.

공식 확인 자료:
- [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/), [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 atomic batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [REST batch / permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [Worker 권한](https://developers.cloudflare.com/workers/authorization/workers/)
- [Google API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [Google scope](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing)
- [Naver 성과 리포트](https://searchadvisor.naver.com/guide/report-expose-ctr), [Naver 공식 수집요청 API](https://searchadvisor.naver.com/guide/crawl-request-api)

## 운영 설정 순서 — 이번 구현에서는 실행하지 않음

1. Cloudflare 계정 ID를 확인합니다. DB는 기존 `mory-analytics` / `bc551a27-1b13-4488-adfd-12e7b21f0ea8` 그대로 사용합니다.
2. **CMS 전용 token**: 해당 account의 **D1 Write/Edit** (조회도 포함) 최소 권한.
   root `.env`의 `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_API_TOKEN`에 설정합니다.
   이미지/R2 credential을 재사용하지 않습니다. Worker 수정 권한은 CMS token에 필요 없습니다.
3. 배포는 `npx wrangler login`의 Cloudflare OAuth 또는 별도 deploy token을 사용합니다.
   최초 설치 token은 해당 account의 **Workers product-level Admin**(새 Worker 생성), D1 migration(Write),
   mory.place zone의 Workers Routes Write와 zone lookup(Read)이 필요합니다.
   생성/연결 후 기존 Worker 코드·secret 갱신은 Editor로 낮출 수 있습니다.
   새 permission model의 Editor는 Worker를 생성할 수 없습니다. 기존 token 화면의 legacy 이름과 혼동하지 않습니다.
   **CMS token과 deploy token을 구분**하고 Git에 넣지 않습니다.
4. 원격 migration, Worker/domain, secret을 사용자가 적용합니다:

```sh
# 여기부터는 실제 원격 자원을 변경합니다. 승인/credential 준비 후 사용자가 실행.
npx wrangler d1 migrations apply mory-analytics --config analytics/wrangler.jsonc --remote
npx wrangler deploy --config analytics/wrangler.jsonc
openssl rand -base64 32 | npx wrangler secret put ANALYTICS_HMAC_SECRET --config analytics/wrangler.jsonc
```

`wrangler deploy`는 `analytics.mory.place` custom domain과 hourly Cron Trigger도 설정합니다.
secret 적용 전 endpoint는 503으로 안전하게 거부합니다. secret은 출력하거나 repo/.env에 넣지 않습니다.
생성한 secret은 Cloudflare의 Worker secret으로 보관하며 identity가 유지되도록 임의 교체하지 않습니다.
public mory.place 사이트의 DNS/Pages는 이 Worker 배포와 별개입니다.

5. Google 선택 설정:
   - Search Console에서 Mory property를 소유 확인.
   - Google Cloud project에서 **Google Search Console API** enable.
   - service account 생성, JSON key를 `runtime/credentials/gsc-service-account.json` 등 Git-ignored 위치에 보관.
   - 그 서비스 계정 email을 해당 Search Console property에 **Restricted/읽기** 사용자로 추가.
   - root `.env`에 `MORY_GSC_SERVICE_ACCOUNT_FILE`(해당 파일 경로),
     `MORY_GSC_PROPERTY` (`sc-domain:mory.place` 또는 확인한 URL-prefix property)를 설정.
   - OAuth redirect server나 public Mac mini endpoint는 필요 없습니다.
6. 사용자가 기존 Mory 운영 반영을 실행하고 CMS를 재시작합니다. 이번 구현 작업에서는 commit/push와 재시작을 하지 않습니다.
7. mory.place 방문 → CMS 통계 확인 → 내 visitor 별칭 지정 → Google 수동 sync를 확인합니다.
   Worker 수집은 CMS 서버의 token/연결 여부와 독립적입니다.

## 용량 / quota / 성능 측정

`npm run analytics:measure`: 실제 Miniflare D1 schema+indexes, 2,500 visitors, Home/About/Writing + 80 posts,
5 referrers, 10,000 PV + 검색 834 + 클릭 286, 일별 rollup. 실행마다 새 `runtime/analytics-measurement-*`.
공식 `meta.size_after`의 실제 DB bytes 및 `meta.rows_read/rows_written`을 측정하고 report JSON을 남깁니다.
JS는 이전 HEAD search와 현재 search+analytics를 동일 esbuild/minify/gzip 조건으로 비교합니다.

측정된 DB: schema 192,512B → raw 1,650,688B → rollup 포함 1,765,376B.
증가 1,572,864B / 10k PV = **약 157.3B/PV** (위 visitor/search 분포 포함).
365일 raw 분량을 이 비율로 단순 환산하면 500MB에서 약 **8,700PV/day**,
70%(350MB)에서는 약 **6,100PV/day**입니다. 영구 집계의 장기 성장/검색어 길이/visitor 비율은 달라질 수 있습니다.
이는 첫 1년 분량의 단순 환산이며 보장치가 아닙니다. 방문자 요약과 집계는 365일 후에도 계속 쌓이므로 같은 PV/day를 무한히 유지할 수 있다는 뜻이 아닙니다. storage warning과 실제 사용량을 확인해야 합니다.

D1 Free: read 5,000,000 rows/day, write 100,000 rows/day, DB당 500MB (account total 5GB).
Workers Free: 100,000 requests/day, CPU 10ms/request. Free 초과 시 수집을 잃을 수 있지만 사이트는 계속 동작합니다.
안정된 반복 PV 1건은 local D1에서 read **13**, write **7** rows.
위 10k 데이터의 rollup은 read 144,924 / write 4,634 rows. 검색/신규 visitor/cleanup/API 조회 비용은 별도입니다.
운영 정상 상태의 expiry까지 포함하면 대략 **12~15 written rows/PV**로 예산을 잡는 것이 보수적입니다.
개인 사이트 운영 여유를 위해 약 5,000PV/day 수준을 초기 capacity 검토 기준으로 둘 수 있으나
이는 고정 limit이 아니며 실제 Cloudflare metrics가 기준입니다. sharding/추가 저장소는 구현하지 않습니다.

최종 public JS 증가량: 동일 bundle/minify 기준 **1,682B**, gzip **754B**. Public React/hydration이나 Analytics SDK를 추가하지 않습니다.

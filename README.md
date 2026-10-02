# Mory

`https://mory.place`를 위한 정적 개인 홈페이지와 글 아카이브. Astro 7.3.5 / TypeScript / npm / Markdown / YAML / Pagefind를 사용합니다. 콘텐츠의 source of truth는 이 저장소의 파일입니다.

## 실행과 검증

Node.js 22.18 이상을 사용합니다. GitHub Actions는 Node.js 24를 사용합니다.

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
npm run verify
npm run preview
```

`build`는 schema/관계/Markdown renderer 검증 → Astro 정적 빌드 → Pagefind 인덱싱 순서입니다. `astro build --force`로 콘텐츠 캐시를 비워 registry나 다른 글의 변경이 Markdown dynamic block / wikilink에 바로 반영되게 합니다. `verify`는 생성된 모든 Writing/Category 정렬·페이지네이션, 공개/비공개 경로, alias, Series 순서, canonical, RSS, sitemap, Pagefind 페이지 수를 확인합니다. 테스트 fixture는 사이트 콘텐츠와 분리되어 있습니다. 오류 사례를 검증하는 테스트의 Markdown 진단 출력은 의도된 것입니다.

검색은 `npm run build` 후 `npm run preview`에서 확인합니다. `dev`에서 인덱스가 없으면 검색 UI가 안내 문구를 제공합니다. 공개 글이 하나도 없더라도 일반 페이지를 검색에 포함하지 않습니다.

## 구조

```text
src/
  content/posts/          실제 글 .md
  content/pages/          home.md / about.md
  content.config.ts       Astro content collections
  data/                   categories.yaml
  lib/                    schema, validation, 정렬/페이지네이션, HTML, asset resolver
  markdown/               unified pipeline / Obsidian / dynamic blocks
  pages/                  Home / About / Writing / Category / Series / RSS
  layouts/                공통 shell / 일반 페이지 / 목록 / 글
  components/             Search / TOC / Pagination
  scripts/                검색 / theme / TOC의 browser JS
  styles/                 폰트와 light/dark design tokens
public/
  fixtures/               ULID 기반 로컬 이미지·영상
  robots.txt / .nojekyll
data/series/              시리즈별 YAML (many-to-many)
cms/                      개인용 CMS server / React client / tests
runtime/                  SQLite / backups / publish-repo (Git 제외)
scripts/                  콘텐츠 및 static artifact 검증
tests/                   독립적인 content / Markdown 회귀 검증
.github/workflows/        GitHub Pages 빌드와 배포
```

## Posts contract

```yaml
---
id: "01K6F4J0M00000000000000001"
title: "글 제목"
slug: "a-place-to-write"
category: "sample"
publishedAt: 2026-10-01T15:42:00+09:00
updatedAt:
status: "published"
description: "직접 작성하는 짧은 글 설명."
aliases:
  - "first-note"
---
```

- `id`: 영구 ULID. 새 글마다 고유하게 생성하며 이후 변경하지 않습니다. 글 URL에는 사용하지 않습니다.
- `title`: 변경 가능한 표시 제목. `slug`와 자동 동기화하지 않습니다.
- `slug`: 소문자 영문/숫자/하이픈. 최초 게시 후 고정하고, 변경할 때 이전 값을 `aliases`에 추가합니다. 목록과 충돌하는 `oldest`, `updated`, `page`는 예약어입니다.
- `category`: category registry의 ID 하나.
- `publishedAt`: 최초 공개 시각. draft는 비워둘 수 있으며 CMS 최초 게시 시 서울 기준 ISO offset datetime을 자동 설정합니다.
- `updatedAt`: 선택 수정 시각. CMS 변경사항 게시 시 갱신됩니다. timezone offset이 있는 ISO datetime을 허용하며 화면에는 Asia/Seoul 기준 시분을 표시합니다. 기존 `YYYY-MM-DD`는 그대로 호환하여 시각을 추측하지 않습니다. 정렬은 실제 instant 기준이고, legacy date-only는 서울 자정 기준으로 정렬합니다. legacy RSS 날짜는 기존 GMT 00:00을 유지합니다.
- `status`: `draft`, `published`, `archived`만 허용합니다.
- `description`: 목록/SEO/Open Graph에 사용하며 빈 문자열을 허용합니다.
- `aliases`: 과거 slug 배열. published 글에만 호환 페이지를 만듭니다.

이력에 따른 ID/최초 공개 날짜 불변성, slug 변경 시 alias 추가는 작성자가 유지하는 콘텐츠 규칙입니다. 직접 Markdown을 수정할 때는 이전 이력을 작성자가 유지합니다. CMS에서는 최초 게시 후 slug 기본 잠금과 이전 slug 자동 alias 추가를 제공합니다.

보수적인 공개 정책으로 `published`만 상세 경로, 목록, RSS, 검색, 공개 Series 탐색에 포함합니다. draft/archived 본문은 배포하지 않습니다. 비공개 글 또는 존재하지 않는 글을 참조하는 wikilink는 경고 후 일반 텍스트로 남깁니다. 끊어진 링크는 게시·삭제를 막지 않으며 CMS 오류 메뉴에서 확인합니다. Series에는 비공개 ID도 저장할 수 있지만 공개 목록/위치/이전·다음에는 공개 글만 포함합니다.

## Pages contract

`src/content/pages/home.md`, `about.md`의 frontmatter는 `title`, `description`입니다. 나머지는 일반 Markdown입니다. Home의 section 위치나 dynamic block 순서는 layout이 강제하지 않습니다. 일반 페이지는 Pagefind 검색에서 제외합니다.

```md
::recent-writing{count=5}

::category-list

::series-list

::series-writing{id=sample-series}

::writing-search

::writing-list
```

각 문법은 독립된 paragraph로 작성합니다. `recent-writing`은 양의 정수 `count`, `series-writing`은 고정 시리즈 `id`를 사용하며 다른 옵션은 지원하지 않습니다. `series-writing`은 글 본문에서도 사용할 수 있고, 시리즈 제목과 공개 글 전체를 registry 순서대로 표시합니다. 페이지네이션은 없으며 없는 ID는 검증 오류입니다. 시리즈 블록은 Pagefind 본문 검색에서 제외합니다. `writing-list`는 전체 공개 글을 최신순으로 삽입합니다. Writing/Category 경로의 목록은 별도로 페이지네이션됩니다.

## Category / Series

`src/data/categories.yaml`에서 key는 영구 내부 ID, `name`은 표시명, `order`는 표시 순서입니다. category name을 바꿔도 글 파일이나 글 URL을 바꿀 필요가 없습니다. 실제 초기 분류가 미정이므로 `sample` 하나만 있습니다.

`data/series/<id>.yaml`은 `id`, `name`, optional `description` (기본 빈 문자열), `posts` ULID 배열을 저장합니다. 배열 순서가 시리즈 순서이며 한 글이 여러 시리즈에 속할 수 있습니다. 없는 글 참조와 한 시리즈 내부의 중복 글은 빌드 오류입니다. 기존 sample-series를 같은 ID와 순서로 이전했고 URL은 유지했습니다.

## Markdown 확장

Astro 7의 공식 `@astrojs/markdown-remark` unified processor에서 remark/rehype를 사용합니다. GFM과 Shiki 문법 강조는 공식 processor가 처리합니다. `remark-math` / `rehype-katex`로 수식을 렌더링합니다.

`obsidian.ts`는 코드/일반 링크를 건드리지 않고 다음을 처리합니다.

- `==highlight==`
- `> [!note]`, `tip`, `important`, `warning`: label/icon/text를 가진 callout
- `[[slug]]`, `[[slug|표시 텍스트]]`: 공개 글 링크. 없는 slug는 파일/위치/진단 ID를 가진 오류
- `![[image.webp]]`, `![[image.webp|600]]`: 이미지와 선택적 너비
- `![[demo.mp4]]`, `![[demo.webm]]`: HTML video controls
- 단독 raw YouTube URL: lazy iframe. 작성된 Markdown 링크는 유지하며 지원되지 않는 raw URL은 일반 링크로 유지

TOC는 본문 `##`, `###` heading을 사용하며 자동 생성된 각주 label은 제외합니다. 대상 heading이 없으면 숨깁니다. desktop은 sticky, mobile은 처음에 접힌 상태이며 수동으로 열고 닫을 수 있습니다.

## 첨부파일 provider

Markdown에는 파일명만 저장합니다. `src/lib/assets.ts`에서 다음 object key를 해석합니다.

```text
![[image.webp]]        → posts/<post-ulid>/image.webp
![[shared/image.webp]] → shared/image.webp
```

현재 기본 public base는 `/fixtures`입니다. 테스트 이미지/WebP와 MP4가 이 구조로 들어 있습니다. 실제 public host를 연결한 이후 `.env` 또는 빌드 환경에 다음 값을 설정하면 Markdown 수정 없이 전환합니다.

```dotenv
MORY_ASSET_BASE=https://img.mory.place
```

기존 일반 Pages의 legacy asset embed에는 `shared/` 경로를 사용합니다. CMS 업로드 이미지의 `mory-asset-<ULID>.<ext>`는 Post ULID 또는 Home/About stable ID로 public R2 URL을 계산합니다. 공개 renderer는 DB/R2 API에 접근하지 않습니다. 업로드·미게시 백업·게시 전 R2 처리는 [CMS 설명](cms/README.md#이미지-업로드-v1)을 참고하세요. Archive와 R2 object 삭제는 연결하지 않습니다. fixture에는 자동 생성 자산만 포함됩니다.

## 정렬 / 페이지네이션

`src/lib/config.ts`의 `PAGE_SIZE = 20`을 공통으로 사용합니다. 데이터 전체를 정렬한 후 페이지를 나눕니다. 최신순·오래된순은 게시 시각을 기준으로 하며, 시각이 같은 경우 ULID로 순서를 고정합니다. 기존 `updated/` 주소는 같은 페이지 번호의 최신순 목록으로 이동합니다.

```text
/writing/
/writing/page/2/
/writing/oldest/
/writing/oldest/page/2/
/category/<id>/
/category/<id>/page/2/
/category/<id>/oldest/page/2/
/series/<id>/
```

Category는 Writing과 동일한 정렬·페이지네이션 모듈을 사용합니다. 데이터가 한 페이지 이하이면 2페이지는 생성하지 않습니다.

## 검색 / SEO / theme

`scripts/index-search.ts`가 Pagefind Node API로 빌드된 HTML의 `[data-pagefind-body]`만 인덱싱합니다. 공개 글이 없어도 실제 Pagefind bundle을 생성합니다. 검색은 `mory-search` custom element가 Pagefind browser API를 필요할 때 불러옵니다. Header dialog와 Markdown dynamic block, Writing의 검색이 같은 UI를 재사용합니다. bundle은 `dist/pagefind`에 생성하며 소스에는 커밋하지 않습니다. 검색 결과의 excerpt는 텍스트와 mark만 표시합니다.

canonical은 `https://mory.place`이며 한국어 lang, title/description, Open Graph, sitemap, RSS를 제공합니다. alias는 canonical과 meta refresh, 명시적 이동 링크, noindex를 가진 정적 호환 페이지이며 sitemap/search에서 제외합니다. HTTP redirect 상태 코드를 제공하는 서버는 없습니다.

Pretendard Variable을 로컬 unicode subset 웹폰트로 제공합니다. 기본 theme은 system이고 사용자의 system/light/dark 선택은 localStorage에 저장합니다. head의 작은 inline script가 스타일 적용 전에 theme을 결정합니다. 색상 token은 light/dark에 따로 정의합니다.

## GitHub Pages

workflow는 main push 또는 수동 실행 시 `npm ci → check → test → build → verify → dist artifact 업로드 → Pages 배포`를 수행합니다. 저장소 Pages source를 GitHub Actions로 설정해야 실제 배포할 수 있습니다. Custom domain은 나중에 GitHub Pages Settings에서 직접 설정합니다. Custom Actions 배포에 불필요한 CNAME 파일은 두지 않습니다. 모든 URL은 apex domain 기준이며 `/mory/` base에 의존하지 않습니다.

기존 공개 사이트는 GitHub Pages에서 배포됩니다. 로컬 CMS는 Pages artifact에 포함하지 않습니다. DNS 및 `www` redirect는 별도 운영 설정입니다.

## 의도적으로 제외한 범위

공개 사이트의 DB/backend/API, 인증/account, comments, R2 provisioning/remove/media library, analytics, AdSense, newsletter, social feed, AI integration, 공개 사이트 React, MDX, project content type, tags, 고급 Obsidian vault 기능은 구현하지 않았습니다. Post layout에는 향후 모듈을 연결할 slot만 있습니다.

## 개인용 CMS v1

설치·실행·저장/게시 정책·설정·제약은 [cms/README.md](cms/README.md)를 참조하세요. `npm run check`와 `npm test`에는 CMS typecheck와 로컬 저장소 통합 테스트도 포함됩니다. 공개 사이트는 계속 정적 Astro이며 React/SQLite는 CMS에서만 사용합니다.

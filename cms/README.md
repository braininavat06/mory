# 개인용 Mory CMS v1

공개 사이트는 정적 Astro/GitHub Pages 그대로입니다. CMS만 Node/Hono + better-sqlite3 + React/Vite + CodeMirror 6을 사용합니다. 소스의 Markdown/YAML이 마지막 공개본, SQLite가 미게시 작업본입니다. Dashboard·로그인·업로더·offline sync·Live Preview는 없습니다.

## 실행

Node.js 24 권장, npm 설치 후:

```sh
npm ci
npm run cms:start
```

기본 주소 `http://127.0.0.1:40009`. `cms:start`는 foreground 실행이며 Ctrl+C로 종료합니다. `cms:start`는 client/preview를 빌드한 뒤 server를 실행합니다. 빌드 후 반복 실행은 `npm run cms:serve`. 설치 script 허용 목록에 better-sqlite3가 포함되어 있습니다. 외부 origin으로 요청해야 하는 Tailnet은 별도 reverse proxy/Tailscale Serve를 쓰고 `MORY_CMS_ORIGIN`을 실제 접근 origin으로 설정하세요. Node는 계속 localhost에 bind하며 CORS는 열지 않습니다. 프록시가 설정된 origin의 Host를 전달해야 합니다.

현재 Mac mini의 Tailnet 주소를 사용하려면 Git 제외된 root `.env`에 다음을 설정하고 서버를 재시작합니다.

```dotenv
MORY_CMS_ORIGIN=https://mory.mau-hamal.ts.net
```

이 설정은 허용 Host와 변경 요청의 Origin을 함께 지정합니다. 서버는 계속 `127.0.0.1:40009`에 bind합니다. Tailnet origin 설정 상태에서는 브라우저도 위 HTTPS 주소로 접근하세요. `server.sh status`는 로컬 헬스체크에 설정된 Host를 보내므로 정상 동작합니다.

## Automator / 홈서버 운영

다른 홈서버와 같은 `000_mory-server.app` + `server.sh` 구조입니다. 평소 시작은 앱을 더블클릭하거나:

```sh
open "$HOME/server/mory/000_mory-server.app"
```

앱은 `automator-launcher.zsh` → `server.sh start`를 호출합니다. CMS assets를 빌드한 뒤 Node를 detached로 실행하므로 앱을 닫아도 서버는 유지됩니다. 이미 실행 중이면 재시작/중복 실행하지 않습니다. macOS XPC 부모 프로세스에서 app 경로를 찾지 않고 launcher 자신의 경로를 기준으로 동작합니다. workflow의 홈 경로는 실제 설치 위치 `~/server/mory`입니다.

```sh
./server.sh status
./server.sh stop
./server.sh logs
# 재시작: stop 후 위 Automator 앱을 다시 열기
```

수동 CLI에는 `start/restart`도 지원합니다. PID는 기존 `runtime/server.lock`, 로그는 `runtime/cms.log`, CMS 빌드 로그는 `runtime/automator.log`입니다. startup lock도 runtime 안에 두며 동시 시작을 막습니다. 다른 프로세스를 포트 기준으로 종료하지 않으며, 중지는 SIGTERM으로 게시/SQLite 백업을 마친 뒤 종료합니다. 종료 대기가 길어져도 force kill하지 않습니다. `MORY_RUNTIME_DIR` 설정을 같은 방식으로 사용합니다.

Automator “셸 스크립트 실행” 원문:

```sh
exec "$HOME/server/mory/automator-launcher.zsh"
```

Node PATH는 launcher에서 준비합니다. LaunchAgent·로그인 항목·Tailscale Serve 설정은 자동으로 추가하거나 변경하지 않습니다. 실행 중 `/api/health`는 `{ "service": "mory-cms", "ok": true }`를 반환합니다.

**최초 설치 시 CMS/날짜/시리즈 변경을 사용자가 검토하고 main에 배포한 뒤 실제 게시를 시작하세요.** 게시 clone의 사이트 코드가 새 content contract를 지원하지 않으면 게시를 중단합니다. 구현 검증에서는 로컬 bare 저장소로만 push했고 실제 GitHub에는 게시하지 않았습니다.

## 디렉터리와 상태

```text
src/content/posts/           공개 Post Markdown
src/content/pages/           공개 Home/About Markdown
src/data/categories.yaml     공개 category registry
src/lib/, src/markdown/      Site/CMS 공용 schema·검증·Markdown 핵심
data/series/<id>.yaml       독립 시리즈 파일
cms/server/                  Store, Publisher, Hono API, preview, backup
cms/client/                  Writing/Categories/Series/Pages, CodeMirror, autosave
cms/tests/                   저장·게시·실패·복구·보안 테스트
runtime/                     전체 Git 제외, mode 0700
  cms.sqlite                 workspace (mode 0600)
  cms.sqlite-wal / -shm       SQLite WAL
  server.lock                실제 Node PID / 중복 server 실행 방지
  service-start.lock         동시 시작 방지 (시작 완료 시 제거)
  cms.log / automator.log    운영 로그
  backups/YYYY-MM-DD.sqlite  consistent snapshots (mode 0600)
  publish-repo/              CMS 전용 clone
server.sh / automator-launcher.zsh  서비스 운영 스크립트
000_mory-server.app/          Automator 실행 앱
cms/dist/                    생성 CMS bundle, Git 제외 / Pages 배포 제외
```

SQLite `drafts`: `key`, `kind`, `id`, `path`, `value` JSON, `published` JSON, `base_hash`, `ever_published`, `revision`, `saved_at`, `updated_at`. 작업본 row 하나를 UPDATE하며 autosave history는 저장하지 않습니다. `published`는 마지막으로 원격에 반영한 snapshot입니다. `publish_jobs`는 요청당 immutable snapshot/revision/action과 state·commit SHA·pushed_at·run URL·error를 저장합니다. `(key, revision, action)` unique로 동일 요청을 재사용합니다. `settings`는 최초 import 여부와 `local-sync` 상태를 저장합니다. 동기화 상태에는 pending 여부, 마지막 원격 SHA, 게시 SHA, 오류, 마지막 시도 시각만 둡니다.

초기 실행은 현재 repo 콘텐츠를 import합니다. root 밖의 별도 데이터 repo는 만들지 않습니다. 외부에서 변경된 공개본은 자동으로 CMS 입력을 덮어쓰지 않습니다. 충돌 안내에서 사용자가 “공개본 다시 불러오기”를 선택하면 해당 문서만 불러오고 현재 입력을 복구 사본으로 남깁니다.

## 편집과 저장

Writing은 제목·설명 검색, 상태·분류 필터, CMS 수정 순 목록입니다. 초안/게시됨/수정 중/보관됨은 텍스트로 표시합니다. + 새 글 즉시 ULID와 SQLite row를 생성합니다.

새 글의 주소(slug)는 빈칸으로 시작하며 자동 생성하지 않습니다. 게시 설정에서 직접 입력해야 하고, 빈 주소·형식 오류·예약 경로·다른 글의 현재/이전 주소와 중복되면 경고하고 게시를 차단합니다. 제목을 바꿔도 주소는 유지됩니다.

CodeMirror는 Markdown 원문과 기호를 유지합니다. Desktop은 편집/분할/미리보기, mobile은 편집/미리보기입니다. IME composition 동안 문서 전체를 교체하지 않습니다. 제목·분류·본문이 기본 필드이며 주소·설명·시각·aliases는 접이식 게시 설정에 있습니다.

본문 영역은 각각 스크롤할 수 있으며, 원문 줄과 렌더링 문단의 위치를 연결해 양방향 스크롤과 화면 전환 위치를 유지합니다. 이미지·표 등 높이가 다른 구간은 인접 문단 사이를 보간합니다. Preview만 source 위치 속성을 추가하며 공개 HTML에는 추가하지 않습니다.

자동저장은 입력 종료 2초 후, 계속 입력하면 최대 12초 간격입니다. 한 요청만 보내며 전송 중 입력은 최신 payload 하나만 유지합니다. 화면 이동/게시 전 flush합니다. revision CAS가 다르면 HTTP409로 중단하며 입력을 유지합니다. 서버 시각으로 저장됨 표시를 합니다. 통신 실패 후 재시도 가능하며 저장 실패 이유가 화면에 표시됩니다.

localStorage는 emergency copy와 theme만 저장합니다. 서버 저장과 구분하며 성공한 최신 autosave 뒤 사본을 지웁니다. 복구본은 자동 적용하지 않고 별도 확인/사용/서버 유지 버튼을 제공합니다. 서버 revision이 바뀐 사본은 추가 확인을 요구합니다. 브라우저의 storage가 막혀 있으면 emergency copy는 제공되지 않지만 서버 저장은 계속 작동합니다. beforeunload에도 미저장 사본을 남깁니다.

## 게시

정확히 현재 revision으로만 게시합니다. pending autosave를 완료한 뒤 버튼·필드를 잠그고 immutable snapshot을 기록합니다. 서버 전역 단일 큐에서 개발 저장소 사전 검사/fast-forward → 전용 clone 최신화 → 외부 hash 비교 → 대상 파일만 반영 → 공용 validation/Markdown validation → scoped commit → 일반 push → 개발 저장소 fast-forward 순으로 처리합니다. 미커밋 코드와 다른 문서의 SQLite 작업은 게시 clone에 복사하지 않습니다. 강제 초기화는 CMS 전용 clone에서만 사용합니다.

개발 저장소는 게시 branch, 동일 origin(fetch/push), Git 작업/충돌 없음, 원격에 없는 로컬 커밋 없음, runtime 전체 제외를 검사합니다. CMS 관리 경로인 `src/content/posts/**/*.md`, `src/content/pages/**/*.md`, `src/data/categories.yaml`, 이전 `src/data/series.yaml`, `data/series/**/*.yaml`의 staged/unstaged/untracked 수정은 게시를 차단합니다. unrelated 코드 변경은 허용하며 index 항목, 변경 목록, 파일 내용 hash·mode·symlink를 fast-forward 전후 비교합니다. incoming 변경과 로컬 작업 또는 Git 제외 파일이 겹치면 미리 중단합니다. 특수한 assume-unchanged/skip-worktree 설정과 dirty 하위 저장소는 보존을 보장할 수 없어 보수적으로 차단합니다.

개발 저장소에서 변경을 수행하는 Git 명령은 `fetch`와 `merge --ff-only --no-autostash <확인한 원격 SHA>`뿐입니다. merge invocation에서는 post-merge hook도 끕니다. reset/stash/rebase/clean/자동 branch 변경/사용자 커밋 push는 하지 않습니다. local ahead/diverged는 사용자가 먼저 정리해야 합니다. 동기화가 끝나면 게시 SHA가 개발 HEAD의 ancestor인지 확인합니다. 이후 기존 Backup 패널의 `git add . → commit → push`를 그대로 사용할 수 있습니다. 동시에 실행한 Backup 작업까지 잠그지는 않으므로, 작업 도중 사용자가 커밋하거나 파일을 변경하면 안전하게 차단하거나 동기화 대기로 남깁니다.

원격이 먼저 변경되어 push가 거절되면 최신 clone을 다시 준비하고 대상 파일의 base hash·실행 중 CMS의 contract 호환성·validation을 재검사한 뒤 최대 3회 일반 push를 시도합니다. 대상 콘텐츠 자체가 외부에서 변경되면 병합하지 않습니다. `src/lib/content-contract.ts`는 실행 중 프로세스가 지원하는 버전이며, 호환되지 않는 content 구조 변경 시 버전을 올립니다. fetch로 로컬 소스가 바뀌어도 CMS 프로세스를 자동 재시작하지 않습니다.

원격 push가 반영되면 SQLite의 공개 snapshot과 hash를 갱신하고 새 revision을 동기화한 뒤 잠금을 풉니다. Actions 대기 중 새 수정은 미게시 작업으로 남습니다. 모든 실패는 draft를 삭제하거나 rollback하지 않습니다. push 응답이 끊겼거나 server가 중단돼도 `Mory-Publish: <job-id>`로 이미 반영된 정확한 commit을 찾아 중복 commit을 방지합니다.

push 후 개발 저장소 동기화 실패는 게시 실패가 아닙니다. 공개 게시를 유지하고 `게시 완료 · 로컬 저장소 동기화 필요`처럼 배포 상태와 별도로 표시합니다. pending은 SQLite에 먼저 기록하며 CMS 시작 시, 다음 게시 전, 화면의 `다시 동기화`에서 같은 큐로 재시도합니다. pending이 해결되지 않으면 새로운 콘텐츠 게시를 시작하지 않습니다. background 동기화 polling은 없습니다.

GitHub의 deploy.yml workflow에서 해당 SHA/push event를 조회합니다. push는 “배포 중”, 실제 workflow success만 “게시 완료”, 실패는 “배포 실패”입니다. API 오류/조회 지연/권한 없음은 완료로 표시하지 않습니다. 무인증 조회는 최대 분당 한 번, token 설정 시 15초 간격입니다. 배포 실패 재시도는 server token의 Actions write 권한이 필요하며 기존 run을 재실행하므로 추가 content commit을 만들지 않습니다.

서버에 배포 재시도 인증이 설정되지 않았다면 재시도 버튼 대신 해당 GitHub Actions 실행 링크를 표시합니다. API는 재시도 가능 여부만 전달하며 credential은 전달하지 않습니다. CMS 통합 테스트의 Markdown/YAML은 `tests/fixtures.ts`에서 임시 저장소에 생성하므로 실제 글의 보관·삭제·분류 변경에 영향을 받지 않습니다.

과거 배포 실패는 화면을 불러올 때 다시 확인합니다. 동일 workflow와 게시 branch의 최신 성공 배포가 해당 게시 커밋을 포함한다는 GitHub compare 결과를 확인하면 `후속 배포 완료`로 정리합니다. 실패 실행 자체를 성공으로 바꾸거나 기록을 삭제하지 않습니다. 재시도 전에도 확인하며, 이미 후속 배포가 완료됐으면 오래된 workflow를 재실행하지 않습니다. 원격 push 실패, 포함되지 않은 커밋, 확인할 수 없는 API 응답은 자동으로 정리하지 않습니다.

게시 자체의 validation/통신 실패와 실제 배포 실패를 구분합니다. 공개 파일이 base hash와 다르면 중단합니다. 자동 merge는 없습니다. 새 글 또는 아직 Git에 없는 시리즈를 먼저 참조하는 시리즈 게시에는 공유 validator의 없는 post ID 오류가 날 수 있습니다. 해당 글부터 게시하세요. 끊어진 wikilink는 경고이며 게시·삭제를 막지 않습니다. 렌더링에서는 표시 텍스트만 남기고 원문은 수정하지 않습니다. CMS의 **오류** 메뉴에서 작업본과 마지막 공개본을 따로 검사해 참조 글/페이지, 대상 slug, 본문 행을 확인하고 편집기로 이동할 수 있습니다. 코드·첨부파일·일반 링크는 검사 대상이 아닙니다. 시리즈는 소속 글이 있어도 삭제할 수 있으며 글 자체는 유지됩니다.

## 분류·시리즈·페이지·보관

분류 메뉴는 별도 목록을 거치지 않고 바로 중앙 registry 관리 화면을 엽니다. 자동저장/변경사항 게시를 사용합니다. ID는 한 번 만든 뒤 UI에서 편집하지 않습니다. 미게시 새 분류는 editor 선택지에 없습니다. 초안·게시·보관 글의 작업본 또는 공개본이 참조하면 삭제를 거부합니다. 글의 분류 이동은 그 글만 게시하며 categories.yaml을 건드리지 않습니다.

시리즈는 개별 YAML과 개별 SQLite row를 사용합니다. 이름/설명/ULID 배열을 편집하고 여러 글 선택, drag & drop 또는 mobile 위/아래 버튼으로 순서를 바꿉니다. 동일 글의 여러 시리즈 소속을 허용합니다. 시리즈 삭제는 post를 삭제하지 않습니다. 기존 sample-series의 URL/ID/순서를 유지하여 중앙 파일을 이동했습니다. description 기본은 빈 문자열입니다.

Home/About는 같은 CodeMirror/저장/복구/preview/publish를 사용하며 보관·삭제는 없습니다. 모든 dynamic block을 공유 파이프라인으로 렌더링합니다. preview는 공용 remark/Shiki/KaTeX와 public CSS·검색·TOC JS를 사용합니다. CMS 화면을 보호하기 위해 renderer 결과에서 script/event handler/위험 iframe 등을 제거하며 정상 지원 Markdown 문법을 유지합니다. preview의 다른 페이지 링크는 이동시키지 않고 heading 이동은 작동합니다. Pagefind는 로컬 `dist/pagefind`를 사용하며 index가 없으면 공용 fallback을 표시합니다.

`::series-writing{id=시리즈-ID}`는 Home/About와 글 본문에 모두 사용할 수 있습니다. 제목은 registry에서 가져오며 공개 글 전체를 시리즈 배열 순서대로 표시하고, 초안·보관 글은 제외합니다. 페이지네이션은 없고 없는 ID는 게시 검증 오류입니다. 미게시 Series는 먼저 게시해야 합니다. Site/CMS 공용 renderer를 사용하며 이 문법을 추가한 content contract는 버전 2입니다. 코드 배포 전 새 CMS가 구버전 사이트에 콘텐츠를 게시하거나, 구버전 CMS가 최신 문법을 잘못 처리하는 것을 호환성 검사로 차단합니다.

글은 보관 후에만 영구 삭제합니다. 삭제는 글 파일 제거 + 모든 공개 Series의 ULID 제거를 한 게시 작업으로 처리합니다. 미게시 Series 작업본에서도 그 ULID만 제거하여 나머지 변경을 유지합니다. Git에 없는 초안의 보관·복원·삭제는 SQLite 안에서 끝납니다. R2 자산은 삭제하지 않습니다.

## 날짜/시간 호환

새 게시 시각은 `2026-10-01T15:42:00+09:00`이며 서버 system timezone과 무관합니다. 화면은 `2026.10.01 15:42`, 정렬은 실제 instant 기준입니다. 최초 게시 시각은 재게시 때 유지하고 의미 있는 재게시에는 updatedAt을 갱신합니다. 고급 필드의 명시적 수동 수정은 허용합니다. 이전 date-only 값은 원문 유지·날짜만 표시하여 가짜 시각을 만들지 않습니다. YAML 1.2 parser를 재사용하며 Astro의 Date coercion도 기존 wrapper로 차단합니다.

## 백업

실행 시와 매시간 오늘의 snapshot 존재 여부를 확인하여 서울 날짜 기준 하루 한 번 better-sqlite3 backup API를 사용합니다. `.partial` 작성이 완료된 후 원자적으로 이름을 바꾸므로 실행 중 WAL 파일을 cp하지 않습니다. 최근 7일 daily와 이전 8주까지 주당 하나를 유지합니다. server가 꺼져 있으면 그동안의 백업은 만들 수 없습니다. 수동 실행은 `npm run cms:backup`. 외부/R2 backup은 없습니다.

## 설정 (server only)

`.env.example` 참고. `MORY_CMS_PORT` 기본 40009, `MORY_CMS_ORIGIN` 기본 `http://127.0.0.1:40009`, `MORY_RUNTIME_DIR` 기본 root/runtime. repo 안 override는 runtime/ 하위만 허용합니다. `MORY_PUBLISH_REMOTE` 기본 origin URL(GitHub HTTPS일 때 SSH로 clone), `MORY_PUBLISH_BRANCH` 미설정 시 origin 기본 branch, `MORY_GIT_NAME/EMAIL` 게시 author, `MORY_GITHUB_TOKEN` 선택 설정입니다. credential은 프런트엔드에 반환하거나 VITE_ 환경변수로 전달하지 않습니다. SSH agent/키 또는 Git credential helper는 서버에서 준비해야 합니다. Host·Origin·JSON 요청 검사를 적용하고 API/HTML을 no-store로 제공하며 Service Worker를 만들지 않습니다.

## 검증

```sh
npm run check
npm test
npm run build
npm run verify
npm run cms:build
```

Site 및 CMS test는 실제 사이트·임시 bare Git remote·SQLite·가상 timer를 이용합니다. GitHub 배포 API 결과는 mock으로 success/failure/outage를 확인하며 개발 repo/GitHub에 테스트 commit을 만들지 않습니다. 실제 Android/iPad 키보드/IME와 실제 GitHub 게시 credential은 사용자가 최종 확인해야 합니다. 전체 offline 편집, 협업, 자동 merge, 동영상/파일 업로드, AI 생성은 이후 범위입니다. 이미지 업로드는 아래 v1 범위로 지원합니다.

## 이미지 업로드 v1

글/Home/About 편집기에서 **이미지**, 이미지 붙여넣기, 끌어놓기를 사용합니다. 다중 선택은 선택 순서대로 삽입되고 업로드 중에도 타이핑할 수 있습니다. 브라우저의 이미지 선택/붙여넣기 지원은 기기에 따라 다릅니다.

- 파일마다 raw binary `POST /api/uploads/<draft-key>` 요청을 보냅니다. `application/octet-stream`과 원본 파일명 메타데이터만 전달하며 서버 경로는 전달하지 않습니다. 업로드는 클라이언트에서 직렬화하고 서버에서도 한 번에 하나로 제한합니다.
- 기본 최대 40 MiB, 전체 프레임 합계 120,000,000 pixels. JPEG/PNG/WebP/GIF만 허용합니다. 실제 서명·디코딩·픽셀 수를 확인하며 SVG/HEIC/AVIF/동영상은 업로드하지 않습니다.
- EXIF/GPS/XMP/텍스트 메타데이터를 제거합니다. 일반 파일은 압축된 픽셀을 그대로 보존하고 colour profile/필수 렌더링 정보 및 GIF 애니메이션 타이밍을 유지합니다. EXIF orientation 보정이 필요한 JPEG만 quality 100 / 4:4:4로 재인코딩하며 PNG/WebP는 같은 형식의 lossless 출력입니다. orientation 6/8 등은 표시 방향에 맞춰 폭·높이가 서로 바뀝니다. resize/자동 WebP 변환은 없습니다.
- 파일은 `runtime/uploads/posts/<post-id>/mory-asset-<asset-ulid>.<ext>` 또는 `runtime/uploads/pages/home|about/...`에 보관합니다. `.temporary/`에서 처리 후 atomic rename하며 바이너리를 SQLite에 넣지 않습니다. staged orphan은 당장 삭제하지 않습니다.
- SQLite `assets`에는 소유자, generated/original filename, MIME/size/dimensions/SHA256/local relative path/R2 key 및 생성·수정 시각을 저장합니다. `r2_uploaded_at`과 `published_at`은 별도 상태입니다. API에는 실제 경로나 자격증명을 보내지 않습니다.
- Markdown에는 `![[mory-asset-<ULID>.png|600]]`만 저장합니다. 공개 renderer는 명시적인 managed pattern만 `https://img.mory.place/posts|pages/<owner>/<filename>`로 처리합니다. 기존 파일명과 shared/video embed는 기존 resolver를 사용합니다.
- preview는 같은 소유자의 local staged file을 `/api/assets/<id>/content`로 제공하고, 공개 파일은 R2 URL로 표시합니다. width 문법은 유지됩니다.
- 게시 snapshot에서 Markdown parser로 실제 참조한 managed image만 추출합니다. 다른 소유자의 이미지와 unknown staged 참조는 거부합니다. HEAD에서 SHA256/size/MIME을 확인하고, 없으면 조건부 PUT(`If-None-Match: *`) 후 확인합니다. hash가 다른 object는 덮어쓰지 않습니다.
- PUT 성공 직후 `r2_uploaded_at`을 기록합니다. PUT 직후 중단돼도 HEAD metadata로 복구합니다. R2 성공 후 Git 실패 시 object와 local file은 유지됩니다. Git push 성공 후 publication 상태를 확정하고 local file을 정리합니다. 정리/상태 기록 중단은 게시를 rollback하지 않으며 시작 시 재확인합니다.
- 보관·복원은 마지막 공개 snapshot을 사용하며 현재 미게시 본문과 staged image를 유지합니다. image reference 제거/보관/영구삭제는 R2 object를 삭제하지 않습니다. 영구삭제된 글의 미업로드 staged file만 정리하며 공개 object는 향후 명시적 cleanup 대상입니다.
- asset row가 사라졌어도 해당 문서의 마지막 공개 Markdown이 참조하던 파일은 HEAD metadata를 검증해 재등록할 수 있습니다. 다른 문서의 파일이나 아직 게시되지 않은 unknown 파일에는 적용하지 않습니다.
- SQLite backup과 함께 미게시 바이너리를 `runtime/backups/assets/<sha256>`에 hardlink(불가능하면 copy)하고 `<date>.assets.json`이 참조합니다. 같은 파일은 날짜마다 중복 복사하지 않습니다. 7일 daily/이전 8주 weekly retention에 따라 더 이상 참조하지 않는 backup blob을 정리합니다. SQLite backup 복구 후 시작할 때 누락된 local 파일을 hash 검증한 backup blob에서 복구합니다. 자동 daily backup은 그날 이미 생성된 snapshot을 재사용합니다. 수동 `npm run cms:backup`은 실행할 때마다 fresh snapshot을 만듭니다.

서버 전용 `.env` 변수: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. 선택 제한: `MORY_IMAGE_MAX_BYTES`, `MORY_IMAGE_MAX_PIXELS`. 프런트엔드에 `VITE_` 이름으로 넣지 않습니다. R2 설정이 없어도 이미지 없는 작성/자동저장/게시가 동작하며 R2가 필요한 게시에서만 오류가 납니다. 선택한 파일은 게시 전까지 R2에 공개되지 않습니다. R2 공개 호스트 변경 시 `src/lib/assets.ts`의 public base와 서버 설정을 함께 변경합니다.

공개 site/Actions는 runtime, SQLite, R2 credential/HEAD/LIST/API 없이 build합니다. 새 managed renderer는 content contract v4이므로 최초 코드 배포 후 이미지 콘텐츠를 게시합니다. 현재 동작 확인을 위한 임시 Git 저장소/fake S3 테스트는 실제 콘텐츠를 게시하지 않습니다.

명시적인 실제 R2 smoke test(정상 build/tests/startup에서는 실행하지 않음):

```sh
npx tsx cms/scripts/r2-smoke.ts
```

`_cms-test/<random-ulid>.png` 하나를 업로드해 HEAD/hash/public GET/MIME/cache header를 확인하고 삭제합니다. 실제 글 object는 건드리지 않습니다. 자격증명/원본 AWS 예외는 출력하지 않습니다. CDN을 별도로 캐싱하도록 설정한 환경에서는 object 삭제와 이미 캐시된 응답의 만료가 다를 수 있습니다.


## Recovery / 이미지 수명 / 백업 보호

- Emergency recovery는 문서 + 브라우저 탭 세션별로 저장합니다. reload는 같은 세션을 재사용하고 새 탭/복구된 브라우저는 이전 세션 사본도 선택할 수 있습니다. 저장 성공은 그 탭이 전송한 revision에 대응하는 사본만 제거합니다. 다른 탭 사본은 자동 병합·삭제하지 않으며, “서버 내용 유지”는 해당 탭의 확인 기록만 남깁니다.
- `runtime/lifecycle-lock.sqlite`는 데이터 저장용 DB가 아니라 기존 SQLite의 OS 파일 잠금을 이용한 프로세스 간 coordination입니다. manual/automatic backup, 이미지 등록·삭제, GC 최종 참조 확인, 콘텐츠 저장이 같은 잠금을 사용합니다. live lock을 시간으로 만료시키지 않으며 프로세스 종료 시 OS가 해제합니다. 외부 DB/서비스는 필요 없습니다.
- `npm run cms:backup`은 매번 `YYYY-MM-DD-manual-<timestamp>-<id>.sqlite`와 같은 fresh snapshot을 만듭니다. 자동 백업은 기존 daily 파일을 재사용합니다. 모두 기존 staged SHA256 blob/manifest 복구 형식과 최근 7일·이전 8주 weekly retention을 사용합니다. 수동 snapshot에는 호출 직전까지 성공한 서버 저장이 포함되며 브라우저의 미저장 입력은 포함되지 않습니다.
- 기존 startup/hourly cycle이 하루 한 번 GC와 integrity audit을 실행합니다. 파일 생성 후 DB 등록과 로컬 파일 삭제도 같은 잠금으로 보호합니다. 로컬 포인터를 먼저 해제하여 crash 후 DB가 이미 지운 파일을 가리키는 순서를 피하고, 남은 파일은 orphan 정리로 처리합니다.
- Staged orphan: 현재 작업본, 공개본, 보관 글의 마지막 공개본, Home/About, 진행/실패 후 재시도 가능한 publish snapshot, 개발/게시 clone의 Markdown을 검사합니다. 일반 Markdown/HTML의 managed R2 이미지 URL도 공용 parser에서 수집하고, 알려진 managed filename의 코드/CSS 등 literal 언급은 보수적으로 보존합니다. 최초 미사용 판정 후 7일을 기다리고 삭제 직전에 다시 전수검사합니다. 참조가 다시 저장되면 유예 시간을 초기화합니다. 영구 삭제 역시 즉시 staged 파일을 없애지 않습니다.
- R2 orphan: 같은 보호 대상을 검사하고 최초 판정 후 최소 30일을 기다립니다. 최신 origin과 개발 HEAD가 일치하는지 확인하고 최종 HEAD/hash/size 및 참조 검사를 통과할 때만 DELETE합니다. 실패 시 DB 삭제 상태를 기록하지 않고 다음 cycle에 재시도합니다. DELETE 성공 후 crash한 경우 다음 HEAD의 missing 상태로 확정할 수 있습니다. Git history는 보호 범위에 포함되지 않습니다.
- GC가 해석/저장소 확인에 실패하면 파일을 보존합니다. GC 실패는 게시·편집을 실패로 처리하지 않습니다. `runtime/image-maintenance.jsonl`에 scanned/referenced/candidates/deleted/deferred/errors와 삭제 ID/path 또는 key/hash/timestamp를 기록합니다. 이 로그에는 credential을 기록하지 않습니다.
- Integrity audit은 현재 공개 Markdown의 managed image에 HEAD 및 SHA256/size/MIME 검사를 수행합니다. 누락/불일치를 경고하며 Markdown을 바꾸지 않습니다. 게시 직전 검증은 기존처럼 엄격합니다. R2 credential이 없으면 이미지 없는 편집/게시에는 영향이 없고 audit/GC는 경고·보류합니다.
- R2 GC에는 기존 bucket credential의 `DeleteObject` 권한이 필요합니다. R2 LIST나 별도 cleanup 계정/daemon은 사용하지 않습니다. audit는 DB가 잃은 asset row도 공개 Markdown의 owner 기반 key로 검사합니다.
- 공개 build는 여전히 SQLite/R2가 필요 없습니다. CMS가 게시 snapshot frontmatter의 선택 필드 `imageDimensions`에 `{filename: {width, height}}`를 기록합니다. renderer는 width 지정 시 비율에 맞춘 height를 계산하고 모든 이미지에 lazy/async를 적용합니다. CMS preview도 동일 parsing/rendering을 쓰며 staged DB metadata로 크기를 보완합니다. 기존 글은 재게시할 때 이 metadata가 채워집니다. 새 업로드에는 `original_size_bytes`도 기록하지만 과거 업로드의 원본 크기는 복원할 수 없습니다.
- 이미지 설명은 빈 줄 없이 `![[filename|600]]` 다음에 `::alt[대체 설명]`, `::caption[**화면 설명**]` 순서로 작성합니다. 둘 다 선택 사항입니다. caption이 있으면 figure/figcaption을 생성하고, alt가 생략되면 caption의 plain text를 사용합니다. 둘 다 없으면 빈 alt입니다. 중복/단독/깨진 대괄호/사이의 빈 줄은 읽을 수 있는 문법 오류로 안내합니다. CMS 팁에도 예시가 있습니다.

운영 반영은 새 content contract(5)를 지원하는 공개 사이트 배포 후 CMS를 수동 재시작하는 순서입니다. 실행 중인 구버전 CMS와 신버전 manual backup을 혼용하면 새 coordination 보장이 적용되지 않습니다. SQLite schema는 재시작 시 additive migration되며 자동 재시작하지 않습니다. 외부 mirror/NAS/cloud backup과 이미지 변환/미디어 관리 UI는 추가하지 않았습니다.

### Mory 운영 배포

상단 테마 옆 **배포 상태**를 누르면 개발 저장소의 로컬 변경과 `origin/main`에 대응하는 Pages workflow를 확인한다. 조회는 fetch만 수행하며 작업 파일을 바꾸지 않는다.

- 로컬 변경: 제안된 커밋 메시지를 확인/수정한 뒤 **커밋 및 배포**. 현재 변경 전체를 `git add -A`로 반영하며 `.env`와 `runtime/` 추적/ignore 상태를 검사한다.
- clean + local ahead: **Push 및 배포**. 기존 커밋만 push한다.
- remote ahead: **안전하게 동기화** 후 다시 판단한다. 기존 dev-sync의 파일 보존 검사와 ff-only를 재사용하며 충돌 시 중단한다.
- 동일 SHA의 workflow 실패/취소: **다시 배포**는 Actions rerun API만 사용한다. 새 커밋이나 재-push를 만들지 않는다.
- 동일 SHA 성공: 배포 완료, 추가 작업 없음. 실행 기록이 없으면 잠깐 재조회하고 기록 없음으로 표시한다. 기존 workflow_dispatch는 GitHub에서 수동 실행 가능하며 CMS가 새 커밋으로 이를 우회하지 않는다.

콘텐츠 게시와 운영 배포의 Git 단계는 기존 Publisher 큐에서 서로 차단한다. Actions 대기 중에는 Git 큐를 잠그지 않는다. Backup 패널은 그대로 사용하며 양쪽 모두 실제 Git/GitHub 상태를 기준으로 판단한다. 외부 Backup 작업이 동시에 원격을 바꾸면 normal push가 거절될 수 있다. 커밋은 보존되며 자동 merge/rebase/reset/stash/force 처리하지 않는다.

Git push는 origin의 SSH 인증을 사용한다. Actions 조회/재실행에는 기존 서버 전용 `MORY_GITHUB_TOKEN`을 사용한다. Fine-grained token은 Mory repository의 **Actions: Read and write**가 필요하며 토큰을 브라우저에 전달하지 않는다. 조회 실패와 배포 실패는 별도로 표시한다. 실행 중 polling은 5초, idle은 60초이며 숨긴 탭에서는 조회를 쉬고 창 포커스/콘텐츠 게시 상태 변경 시 다시 조회한다.

코드 반영은 `npm run cms:build` 후 운영 CMS를 **직접 재시작**해야 한다. 자동 재시작/새 서비스는 없다.

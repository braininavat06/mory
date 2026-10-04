import React, { useLayoutEffect, useRef, useState } from 'react';

const tick = '\u0060';
function Example({ children }: { children: string }) {
  return <pre><code>{children}</code></pre>;
}

export function Tips() {
  const article = useRef<HTMLElement>(null);
  const toc = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<{ id: string; title: string; depth: number }[]>([]);
  const [expanded, setExpanded] = useState(() => matchMedia('(min-width: 1000px)').matches);
  useLayoutEffect(() => {
    setHeadings([...article.current!.querySelectorAll<HTMLHeadingElement>('h2, h3')].map((heading, index) => {
      heading.id = `tips-heading-${index + 1}`;
      heading.tabIndex = -1;
      return { id: heading.id, title: heading.textContent ?? '', depth: Number(heading.tagName.slice(1)) };
    }));
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement, previous = root.style.getPropertyValue('--toc-height');
    const observer = new ResizeObserver(() => root.style.setProperty('--toc-height', `${toc.current!.getBoundingClientRect().height}px`));
    observer.observe(toc.current!);
    return () => { observer.disconnect(); if (previous) root.style.setProperty('--toc-height', previous); else root.style.removeProperty('--toc-height'); };
  }, []);
  function jump(id: string) {
    if (matchMedia('(max-width: 999px)').matches) setExpanded(false);
    // CMS uses the URL hash for screen navigation. Scroll within Tips without
    // replacing that route, so refresh and browser history keep working.
    requestAnimationFrame(() => {
      const heading = article.current?.querySelector<HTMLElement>(`#${id}`);
      heading?.scrollIntoView({ block: 'start' });
      heading?.focus({ preventScroll: true });
    });
  }
  return <div className="tips-layout"><article ref={article} className="cms-tips prose">
    <h1>팁</h1>
    <p>글과 페이지에 사용할 수 있는 문법입니다. 예시를 Markdown 편집창에 붙여넣고 미리보기에서 확인하세요.</p>
    <section>
      <h2>편집기 작성 도구</h2>
      <p>문장을 선택하고 툴바를 누르면 Markdown 기호를 붙입니다. 같은 서식이나 목록을 다시 누르면 가능한 경우 해제합니다. ‘더보기’에서 표·콜아웃·각주·수식·사이트 데이터 등을 넣을 수 있습니다.</p>
      <p>빈 줄에서 <code>/</code>를 입력하면 명령 목록이 나옵니다. <code>/image</code>, <code>/table</code>처럼 검색하고 ↑ ↓로 선택한 뒤 Enter로 실행하세요. Esc로 닫을 수 있고, 모바일에서는 항목을 누르면 됩니다.</p>
      <p><kbd>Ctrl/Cmd+B</kbd> 굵게 · <kbd>Ctrl/Cmd+I</kbd> 기울임 · <kbd>Ctrl/Cmd+K</kbd> 링크. 선택한 문장에 URL을 붙여넣으면 링크가 됩니다. 변환 없이 붙여넣으려면 <kbd>Ctrl/Cmd+Shift+V</kbd>를 사용하세요.</p>
      <p>이미지 문법이나 바로 아래 설명 줄에 커서를 놓으면 너비·alt·caption을 편집할 수 있습니다. ‘목차 이동’으로 H2~H4 위치로 이동하고, ↶ ↷로 실행 취소·다시 실행할 수 있습니다. 모든 조작은 Markdown 원문을 수정하며 기존 자동저장과 미리보기를 그대로 사용합니다.</p>
      <p>기존 링크나 콜아웃 안에 커서를 놓으면 수정 버튼이 나타납니다. 링크의 표시 이름·주소를 바꾸거나, ‘링크 해제’로 표시 문장만 남길 수 있습니다. ‘더보기’는 서식·목록과 인용·링크와 미디어·삽입 도구·사이트 데이터로 나뉘어 있습니다.</p>
    </section>
    <section>
      <h2>제목과 문단</h2>
      <Example>{'# 큰 제목\n\n## 소제목\n\n### 작은 소제목\n\n첫 번째 문단입니다.\n\n두 번째 문단입니다.'}</Example>
      <p>문단 사이에는 빈 줄을 넣습니다. 글 제목은 위의 제목 입력란에서 작성하고, 본문은 <code>##</code>부터 시작하면 자연스럽습니다. 글의 목차에는 <code>##</code>와 <code>###</code> 제목이 표시됩니다.</p>
    </section>
    <section>
      <h2>강조와 링크</h2>
      <Example>{'**굵게**\n*기울임*\n~~취소선~~\n==형광펜 강조==\n' + tick + '인라인 코드' + tick + '\n\n[링크 이름](https://example.com)\n\n---'}</Example>
      <p><code>---</code>는 구분선입니다. 본문에서 앞뒤에 빈 줄을 넣어 사용하세요.</p>
    </section>
    <section>
      <h2>목록과 인용</h2>
      <Example>{'- 첫 번째 항목\n- 두 번째 항목\n  - 하위 항목\n\n1. 첫 번째 순서\n2. 두 번째 순서\n\n- [ ] 아직 하지 않은 일\n- [x] 완료한 일\n\n> 인용한 문장입니다.\n> 여러 줄로 작성할 수 있습니다.'}</Example>
      <p>체크 목록은 글에 표시되는 작성 문법입니다. 공개 사이트에서 누르는 체크박스가 CMS에 저장되는 것은 아닙니다.</p>
    </section>
    <section>
      <h2>표와 코드 블록</h2>
      <Example>{'| 항목 | 설명 |\n| --- | --- |\n| Markdown | 본문 작성 |\n| 미리보기 | 실제 표시 확인 |'}</Example>
      <Example>{tick.repeat(3) + 'typescript\nconst message = "Mory";\nconsole.log(message);\n' + tick.repeat(3)}</Example>
      <p>백틱 세 개 뒤에 <code>typescript</code>, <code>javascript</code>, <code>python</code>, <code>bash</code>처럼 언어 이름을 넣으면 코드 색상이 적용됩니다. 코드 블록 안의 Markdown과 <code>::</code> 문법은 실행되지 않고 그대로 표시됩니다.</p>
    </section>
    <section>
      <h2>각주와 수식</h2>
      <Example>{'각주가 필요한 문장입니다.[^note]\n\n[^note]: 각주의 설명을 적습니다.'}</Example>
      <Example>{'문장 안의 수식: $E = mc^2$\n\n$$\nx^2 + y^2 = z^2\n$$'}</Example>
      <p>각주는 같은 이름으로 연결합니다. 수식은 문장 안에서는 <code>$…$</code>, 별도 문단에서는 <code>$$</code>로 감쌉니다.</p>
    </section>
    <section>
      <h2>콜아웃</h2>
      <Example>{'> [!note]\n> 참고할 내용입니다.\n\n> [!tip]\n> 도움이 되는 팁입니다.\n\n> [!important]\n> 중요한 내용입니다.\n\n> [!warning]\n> 주의할 내용입니다.'}</Example>
      <p>참고·팁·중요·주의 네 종류를 지원합니다. 첫 줄에 제목을 붙일 수도 있습니다.</p>
      <Example>{'> [!note] 직접 정한 제목\n> 콜아웃 본문입니다.'}</Example>
    </section>
    <section>
      <h2>다른 글 연결하기</h2>
      <Example>{'[[some-post-slug]]\n\n[[some-post-slug|독자에게 보여줄 이름]]'}</Example>
      <p>글 제목이나 ID 대신 게시 설정의 <strong>slug</strong>를 넣습니다. 게시된 글은 해당 글로 연결되고, 초안·보관된 글은 링크 없이 텍스트로 표시됩니다. 존재하지 않는 slug도 텍스트로 표시하며 게시를 막지 않습니다. 끊어진 링크는 오류 메뉴에서 확인할 수 있습니다.</p>
    </section>
    <section>
      <h2>이미지와 자체 동영상</h2>
      <Example>{'![[image.webp]]\n\n![[image.webp|600]]\n\n![[demo.mp4]]\n\n![[demo.webm]]'}</Example>
      <p>현재 글의 첨부파일 이름을 적습니다. <code>|600</code>은 너비 600px이며 좁은 화면에서는 화면 폭에 맞춰 줄어듭니다. 동영상은 재생 컨트롤과 함께 표시됩니다.</p>
      <p>지원 이미지: PNG, JPG/JPEG, GIF, WebP, AVIF, SVG. 지원 동영상: MP4, WebM. 너비는 양의 정수만 사용할 수 있습니다.</p>
      <Example>{'![[shared/image.webp]]\n\n![이미지 설명](https://example.com/image.webp)'}</Example>
      <p>Home/About에서는 <code>shared/</code> 경로를 사용합니다. 일반 Markdown 이미지로 외부 이미지 주소를 넣을 수도 있습니다. CMS 이미지 버튼·붙여넣기·끌어놓기로 JPG, PNG, WebP, GIF를 업로드할 수 있습니다. 게시 전에는 서버에만 보관됩니다.</p>
      <h3>이미지 설명</h3><Example>{'![[image.webp|600]]\n::alt[사진에서 전달하려는 내용]\n::caption[2026년 **진주 남강** 유등축제]'}</Example><p>이미지 바로 다음 줄에 붙여 쓰고 중간에 빈 줄을 넣지 마세요. alt는 대체 설명, caption은 화면에 보이는 설명입니다. 둘 다 선택 사항이며 caption에는 굵게·기울임·링크 같은 inline Markdown을 쓸 수 있습니다. alt가 없으면 caption의 읽을 수 있는 문장을 사용하고, 둘 다 없으면 빈 alt를 사용합니다.</p>
    </section>
    <section>
      <h2>YouTube 영상</h2>
      <Example>{'https://www.youtube.com/watch?v=jfKfPfyJRdk\n\n또는\n\nhttps://youtu.be/jfKfPfyJRdk'}</Example>
      <p>YouTube URL만 있는 문단으로 적고 앞뒤에 빈 줄을 넣으면 영상이 표시됩니다. watch·youtu.be·Shorts·embed 주소를 지원합니다.</p>
      <Example>{'[영상 보기](https://youtu.be/jfKfPfyJRdk)'}</Example>
      <p>위처럼 이름을 붙인 링크는 영상으로 바뀌지 않습니다. 지원하지 않는 외부 영상 URL도 일반 링크로 표시됩니다.</p>
    </section>
    <section>
      <h2>사이트 데이터 넣기: :: 문법</h2>
      <p>각 블록은 한 문단에 단독으로 적고 앞뒤에 빈 줄을 넣으세요. <strong>특정 시리즈의 글 목록은 일반 글과 Home/About에서 모두</strong> 사용할 수 있습니다. 나머지 블록은 Home/About 전용입니다.</p>
      <h3>최근 글</h3>
      <Example>{'::recent-writing{count=5}'}</Example>
      <p>최근 게시된 글 5개를 최신순으로 표시합니다. 숫자를 바꿔 개수를 정할 수 있습니다. <code>::recent-writing</code>만 적어도 기본 5개입니다. count는 양의 정수만 지원합니다.</p>
      <h3>분류 목록</h3>
      <Example>{'::category-list'}</Example>
      <p>게시된 분류 목록과 분류 페이지 링크를 표시합니다.</p>
      <h3>시리즈 목록</h3>
      <Example>{'::series-list'}</Example>
      <p>공개된 글이 있는 시리즈의 이름·글 수·시리즈 페이지 링크를 표시합니다.</p>
      <h3>특정 시리즈의 전체 글 목록</h3>
      <Example>{'::series-writing{id=ai-coding}'}</Example>
      <p>시리즈 제목과 공개 글 전체를 시리즈 관리 화면에서 정한 순서대로 표시합니다. 초안·보관된 글은 제외하며 페이지네이션으로 나누지 않습니다. 글 본문에서도 사용할 수 있습니다.</p>
      <p><code>ai-coding</code>을 시리즈 관리 화면에 표시된 ID로 바꾸세요. 제목이 바뀌어도 ID는 유지됩니다. 공개 글이 없으면 안내 문구가 나오며, 존재하지 않는 ID는 게시 검증 오류가 됩니다. 미게시 새 시리즈는 먼저 게시해야 합니다.</p>
      <h3>글 검색</h3>
      <Example>{'::writing-search'}</Example>
      <p>공개 글을 검색하는 입력창을 넣습니다. 초안·보관된 글과 Home/About는 검색 대상에서 제외됩니다.</p>
      <h3>전체 글 목록</h3>
      <Example>{'::writing-list'}</Example>
      <p>공개 글 전체를 최신순으로 표시합니다. 이 블록에는 페이지네이션이 없으므로 글이 많으면 목록이 길어집니다.</p>
      <h3>배치 예시</h3>
      <Example>{'# 나의 홈페이지\n\n소개 문장을 자유롭게 적습니다.\n\n## 최근 기록\n\n::recent-writing{count=3}\n\n## 찾아보기\n\n::writing-search\n\n::category-list\n\n::series-list'}</Example>
      <p>블록 위치는 자유롭게 바꿀 수 있습니다. 최근 글은 <code>count</code>, 특정 시리즈 글 목록은 <code>id</code> 옵션을 사용합니다. 나머지 블록에는 옵션을 붙이지 않습니다. 목록에는 CMS의 미게시 작업본이 아니라 마지막으로 게시한 내용이 표시됩니다.</p>
    </section>
    <section>
      <h2>지원하지 않는 Obsidian 기능</h2>
      <p>블록 참조, 문단·노트 가져오기, Canvas, 접히는 콜아웃 문법은 지원하지 않습니다. <code>![[…]]</code>는 이미지·동영상 첨부에만 사용하세요.</p>
    </section>
  </article>
    <aside ref={toc} className="toc tips-toc" aria-label="팁 목차">
      <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>목차 <span className="toc-expand">펼치기 +</span><span className="toc-collapse">접기 −</span></summary>
        <nav aria-label="문법 항목"><ol>{headings.map(heading => <li key={heading.id} className={heading.depth === 3 ? 'toc-subheading' : undefined}>
          <button type="button" onClick={() => jump(heading.id)}>{heading.title}</button>
        </li>)}</ol></nav>
      </details>
    </aside>
  </div>;
}

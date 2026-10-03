import { searchLogging } from './analytics.ts';
interface PagefindData { url: string; meta: { title?: string; description?: string; content_id?: string }; excerpt: string }
interface PagefindAPI { search(query: string): Promise<{ results: { data(): Promise<PagefindData> }[] }> }
let apiPromise: Promise<PagefindAPI> | undefined;
function api(): Promise<PagefindAPI> {
  // The bundle is generated after Astro build; Vite must leave this import alone.
  const path = '/pagefind/pagefind.js';
  return apiPromise ??= import(/* @vite-ignore */ path).catch(error => { apiPromise = undefined; throw error; });
}
function excerptFragment(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  function append(node: Node, parent: Node) {
    if (node.nodeType === Node.TEXT_NODE) parent.appendChild(document.createTextNode(node.textContent ?? ''));
    else if (node instanceof Element) {
      const target = node.tagName === 'MARK' ? document.createElement('mark') : parent;
      if (target !== parent) parent.appendChild(target);
      for (const child of node.childNodes) append(child, target);
    }
  }
  for (const child of parsed.body.childNodes) append(child, fragment);
  return fragment;
}
class MorySearch extends HTMLElement {
  private sequence = 0;
  connectedCallback() {
    const analytics = searchLogging();
    const form = this.querySelector<HTMLFormElement>('form')!;
    const input = this.querySelector<HTMLInputElement>('input')!;
    const status = this.querySelector<HTMLElement>('[role="status"]')!;
    const list = this.querySelector<HTMLOListElement>('ol')!;
    const mobileKeyboard = () => matchMedia('(pointer: coarse), (max-width: 767px)').matches;
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || !mobileKeyboard()) return;
      event.preventDefault();
      form.requestSubmit();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (mobileKeyboard()) input.blur();
      const query = input.value.trim();
      const sequence = ++this.sequence;
      list.replaceChildren();
      if (!query) { status.textContent = '검색어를 입력하세요.'; return; }
      if (this.hasAttribute('data-empty-archive')) { status.textContent = '아직 공개된 글이 없습니다.'; return; }
      status.textContent = `“${query}” 검색 중…`;
      list.setAttribute('aria-busy', 'true');
      try {
        const pagefind = await api();
        const search = await pagefind.search(query);
        const data = await Promise.all(search.results.map(result => result.data()));
        if (sequence !== this.sequence) return;
        analytics.searched(query, data.length);
        status.textContent = data.length ? `“${query}” 검색 결과: ${data.length}개의 글` : `“${query}” 검색 결과: 일치하는 글이 없습니다.`;
        for (const [index,result] of data.entries()) {
          const url = new URL(result.url, window.location.origin);
          if (url.origin !== window.location.origin || !url.pathname.startsWith('/writing/')) continue;
          const item = document.createElement('li');
          const heading = document.createElement('h3');
          const link = document.createElement('a');
          link.href = url.pathname + url.hash;
          link.addEventListener('click', () => analytics.clicked(query,index+1,url.pathname,result.meta.content_id));
          heading.textContent = result.meta.title ?? '제목 없는 글';
          link.setAttribute('aria-label', heading.textContent);
          const excerpt = document.createElement('p');
          excerpt.append(excerptFragment(result.excerpt));
          link.append(heading, excerpt);
          item.append(link);
          list.append(item);
        }
      } catch {
        if (sequence === this.sequence) status.textContent = '검색 인덱스를 불러오지 못했습니다. 개발 환경에서는 npm run build 후 npm run preview로 검색을 확인하세요. 글 목록에서 글을 찾을 수도 있습니다.';
      } finally { if (sequence === this.sequence) list.removeAttribute('aria-busy'); }
    });
  }
}
if (!customElements.get('mory-search')) customElements.define('mory-search', MorySearch);

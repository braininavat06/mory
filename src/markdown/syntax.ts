/** Authoring helpers and the public/CMS renderer share these supported forms. */
export const callouts = {
  note: { label: '참고', icon: 'ⓘ' },
  tip: { label: '팁', icon: '✓' },
  important: { label: '중요', icon: '!' },
  warning: { label: '주의', icon: '△' },
} as const;
export type CalloutType = keyof typeof callouts;
export function youtubeId(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    const host = url.hostname.replace(/^www\./, '');
    const id = host === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'm.youtube.com'].includes(host)
      ? url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1] : undefined;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
  } catch { return; }
}
export function imageDirective(line: string): { kind: 'alt' | 'caption'; value: string } | null {
  const m = /^::(alt|caption)\[/.exec(line); if (!m) return null;
  let depth = 1, escaped = false;
  for (let i = m[0].length; i < line.length; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '[') depth++;
    if (c === ']' && --depth === 0) {
      if (line.slice(i + 1).trim()) break;
      return { kind: m[1] as 'alt' | 'caption', value: line.slice(m[0].length, i) };
    }
  }
  throw new Error('이미지 설명 문법의 대괄호를 확인하세요. ::alt[설명] 또는 ::caption[설명] 형식입니다.');
}
export const dynamicKinds = ['recent-writing', 'category-list', 'series-list', 'writing-search', 'writing-list', 'series-writing'] as const;

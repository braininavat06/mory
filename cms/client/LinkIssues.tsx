import { useEffect, useState } from 'react';
import type { ContentIssue, LinkIssueDocument } from '../shared.ts';
import { api } from './api.ts';

const names: Record<ContentIssue['kind'], string> = { wikilink: '위키링크', route: '내부 경로', anchor: '목차·앵커', 'private-link': '비공개 글', 'duplicate-anchor': '중복 앵커', markdown: '문법·첨부파일' };
function issues(source: LinkIssueDocument['sources'][number]): ContentIssue[] {
  return source.issues ?? source.links.map(link => ({ kind: 'wikilink', severity: 'warning', line: link.line, target: link.target, message: '대상 글이 없거나 공개되지 않았습니다. 화면에는 텍스트로 표시됩니다.' }));
}
export function LinkIssues({ open }: { open: (key: string) => void }) {
  const [documents, setDocuments] = useState<LinkIssueDocument[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [source, setSource] = useState('전체'), [kind, setKind] = useState('전체'), [query, setQuery] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  async function scan() {
    setLoading(true); setError('');
    try { setDocuments(await api<LinkIssueDocument[]>('/api/link-issues')); setCheckedAt(new Intl.DateTimeFormat('ko', { hour: '2-digit', minute: '2-digit' }).format(new Date())); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void scan(); }, []);
  const filtered = documents.map(document => ({ ...document, sources: document.sources.filter(s => source === '전체' || s.source === source).map(s => ({ ...s, issues: issues(s).filter(i => (kind === '전체' || i.kind === kind) && `${document.title} ${i.target ?? ''} ${i.message}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(s => s.issues.length) })).filter(d => d.sources.length);
  const count = filtered.reduce((n, d) => n + d.sources.reduce((n, s) => n + s.issues.length, 0), 0);
  return <section className="link-issues">
    <div className="section-heading"><h1>오류</h1><button disabled={loading} onClick={() => void scan()}>다시 확인</button></div>
    <p>글과 페이지의 끊어진 링크, 목차 앵커, Markdown 문제를 확인합니다.</p>
    <p className="muted">서버에 저장된 작업본과 마지막 공개본을 따로 검사합니다. 링크 대상은 현재 공개된 문서 기준입니다. 수정한 뒤 변경사항을 게시해야 공개본에도 반영됩니다.</p>
    <div className="issue-filters">
      <label>대상<select value={source} onChange={e => setSource(e.target.value)}>{['전체', '공개본', '작업본'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>문제 종류<select value={kind} onChange={e => setKind(e.target.value)}><option>전체</option>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>찾기<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="제목 또는 링크" /></label>
    </div>
    {error && <p role="alert">! {error}{checkedAt && ' · 이전 확인 결과를 표시합니다.'}</p>}
    <p role="status">{loading ? '문서 확인 중…' : checkedAt ? `확인 ${checkedAt} · 문서 ${filtered.length}개 · 문제 ${count}개` : '문서를 확인하지 못했습니다.'}</p>
    {!loading && !error && !documents.length && <p>확인이 필요한 링크·Markdown 문제가 없습니다.</p>}
    {!!documents.length && !filtered.length && <p>선택한 조건에 맞는 문제가 없습니다.</p>}
    <ul className="link-issue-list">{filtered.map(d => <li key={d.key}>
      <div className="issue-document-heading"><h2>{d.title}</h2><button onClick={() => open(d.key)}>편집하기</button></div>
      <p className="muted">{d.kind === 'post' ? '글' : '페이지'} · {d.status}</p>
      {!documents.find(original => original.key === d.key)?.sources.some(s => s.source === '작업본') && <p className="muted">작업본에서는 해결됐습니다. 변경사항을 게시하면 공개본에도 반영됩니다.</p>}
      {d.sources.map(s => <div key={s.source} className="issue-source"><h3>{s.source === '공개본' && d.status === '보관됨' ? '마지막 공개본 · 보관됨' : s.source}</h3>
        <ul>{s.issues.map((issue, index) => <li key={index}>
          <p><strong>{issue.severity === 'error' ? '! 게시 전 수정 필요' : '△ 확인 필요'}</strong> · {names[issue.kind]} · {issue.line ? `본문 ${issue.line}행` : '본문'}</p>
          {issue.target && <code>{issue.kind === 'wikilink' ? `[[${issue.target}]]` : issue.target}</code>}
          <p>{issue.message}</p>
        </li>)}</ul>
      </div>)}
    </li>)}</ul>
  </section>;
}

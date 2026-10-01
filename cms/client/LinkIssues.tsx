import { useEffect, useState } from 'react';
import type { LinkIssueDocument } from '../shared.ts';
import { api } from './api.ts';

export function LinkIssues({ open }: { open: (key: string) => void }) {
  const [documents, setDocuments] = useState<LinkIssueDocument[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function scan() {
    setLoading(true); setError('');
    try { setDocuments(await api<LinkIssueDocument[]>('/api/link-issues')); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void scan(); }, []);
  return <section className="link-issues">
    <div className="section-heading"><h1>오류</h1><button disabled={loading} onClick={() => void scan()}>다시 확인</button></div>
    <p>끊어진 위키링크가 있는 글과 페이지입니다. 링크는 화면에서 텍스트로 표시되며, 게시·삭제를 막지 않습니다.</p>
    <p className="muted">작업본과 마지막 공개본을 따로 확인합니다. 공개본의 링크를 수정하려면 변경사항을 게시해 주세요.</p>
    {loading ? <p role="status">링크 확인 중…</p> : error ? <p role="alert">! {error}</p> : !documents.length ? <p role="status">끊어진 위키링크가 없습니다.</p> : <>
      <p role="status">확인이 필요한 글·페이지 {documents.length}개</p>
      <ul className="link-issue-list">{documents.map(d => <li key={d.key}>
        <button onClick={() => open(d.key)}>{d.title} · 편집하기</button><p className="muted">{d.kind === 'post' ? '글' : '페이지'} · {d.status}</p>
        {d.sources.map(s => <div key={s.source}><strong>{s.source}</strong><ul>{s.links.map((link, index) => <li key={index}>본문 {link.line}행 · <code>{`[[${link.target}]]`}</code>{link.label !== link.target && ` · 표시: ${link.label}`}</li>)}</ul></div>)}
      </li>)}</ul>
    </>}
  </section>;
}

import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Action, Draft, Payload, PublishJob, LocalSync } from '../shared.ts';
import { categoryReferences } from '../shared.ts';
import { api } from './api.ts';
import { Autosave } from './autosave.ts';
import type { Recovery } from './autosave.ts';
const CodeEditor = lazy(() => import('./CodeEditor.tsx'));
import { displayDate } from '../../src/lib/dates.ts';
import './style.css';
import { useScrollSync } from './scroll-sync.ts';
import { LinkIssues } from './LinkIssues.tsx';
import { Tips } from './Tips.tsx';
type State = { drafts: Draft[]; jobs: PublishJob[]; localSync: LocalSync | null; canRetryDeployment?: boolean };
const menuLabels: Record<string, string> = { Writing: '글', Categories: '분류', Series: '시리즈', Pages: '페이지', Issues: '오류', Tips: '팁' };
const recoveryStorage = { getItem: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } }, setItem: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} }, removeItem: (key: string) => { try { localStorage.removeItem(key); } catch {} } };
const name = (d: Draft) => d.value.data.title || d.value.data.name || (d.kind === 'categories' ? '분류' : '제목 없는 글');
function jobLabel(job: PublishJob) {
  const action = { publish: '게시', archive: '보관', restore: '복원', delete: '삭제' }[job.action];
  if (job.state === 'publishing') return `${action} 중`;
  if (job.state === 'deploying') return '배포 중';
  if (job.state === 'complete') return `${action} 완료`;
  if (job.state === 'superseded') return '후속 배포 완료';
  if (job.state === 'conflict') return '충돌 발생';
  return job.pushed_at ? '배포 실패' : `${action} 실패`;
}
function App() {
  const [state, setState] = useState<State>({ drafts: [], jobs: [], localSync: null });
  const [menu, setMenu] = useState('Writing'), [selected, setSelected] = useState<Draft | null>(null), [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('전체'), [category, setCategory] = useState('');
  const navigateGuard = useRef<((action: () => void) => void) | null>(null);
  const navigate = (action: () => void) => navigateGuard.current ? navigateGuard.current(action) : action();
  const refresh = useCallback(async () => { try { setState(await api<State>('/api/state')); } catch (e) { setError(String((e as Error).message)); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!state.jobs.some(j => ['publishing', 'deploying'].includes(j.state))) return; const timer = setInterval(() => { void refresh(); }, 4000); return () => clearInterval(timer); }, [state.jobs.some(j => ['publishing', 'deploying'].includes(j.state)), refresh]);
  const needsSync = (job: PublishJob | undefined) => !!state.localSync?.pending && job?.commit_sha === state.localSync.publication_sha;
  const listingStatus = (d: Draft) => { const job = state.jobs.find(j => j.key === d.key); const base = d.kind === 'series' && !d.published ? '미게시' : d.status; const label = !job || ['complete', 'superseded'].includes(job.state) ? base : `${base} · ${jobLabel(job)}`; return label + (needsSync(job) ? ' · 로컬 저장소 동기화 필요' : ''); };
  useEffect(() => { if (menu === 'Categories' && !selected) { const registry = state.drafts.find(d => d.kind === 'categories'); if (registry) setSelected(registry); } }, [menu, selected, state.drafts]);
  const select = (d: Draft) => { setSelected(d); setError(''); };
  const publishedCategories = state.drafts.find(d => d.kind === 'categories')?.published?.data ?? {};
  async function create(kind: 'post' | 'series') {
    try { const id = kind === 'series' ? prompt('시리즈 ID (영문 소문자·숫자·하이픈)') : undefined; if (kind === 'series' && !id) return;
      const draft = await api<Draft>('/api/drafts', 'POST', { kind, id }); await refresh(); select(draft);
    } catch (e) { setError((e as Error).message); }
  }
  const kind = menu === 'Writing' ? 'post' : menu === 'Series' ? 'series' : menu === 'Pages' ? 'page' : 'categories';
  return <><header className="cms-header"><a href="/" onClick={e => { e.preventDefault(); navigate(() => { setSelected(null); setMenu('Writing'); void refresh(); }); }}>Mory <small>CMS</small></a><nav aria-label="CMS 메뉴">{Object.keys(menuLabels).map(m => <button key={m} aria-current={menu === m ? 'page' : undefined} onClick={() => navigate(() => { setSelected(m === 'Categories' ? state.drafts.find(d => d.kind === 'categories') ?? null : null); setMenu(m); void refresh(); })}>{menuLabels[m]}</button>)}</nav><select aria-label="테마" defaultValue={document.documentElement.dataset.theme} onChange={e => { document.documentElement.dataset.theme = e.target.value; try { localStorage.setItem('mory-cms-theme', e.target.value); } catch {} window.dispatchEvent(new Event('mory-themechange')); }}><option value="light">밝게</option><option value="dark">어둡게</option></select></header>
  <main className="cms-main">{state.localSync?.pending && <section className="notice" role="status"><p>콘텐츠는 게시되었습니다. 로컬 저장소 동기화가 필요합니다.</p>{state.localSync.error && <p>{state.localSync.error}</p>}<button disabled={syncing} onClick={() => { setSyncing(true); void api<LocalSync | null>('/api/local-sync/retry', 'POST', {}).then(() => refresh()).catch(e => setError(e.message)).finally(() => setSyncing(false)); }}>{syncing ? '동기화 중…' : '다시 동기화'}</button></section>}{error && <p role="alert">! {error}</p>}{selected ? <Editor key={selected.key} navigateGuard={navigateGuard} initial={selected} state={state} refresh={refresh} back={() => { setSelected(null); void refresh(); }} /> : menu === 'Tips' ? <Tips /> : menu === 'Issues' ? <LinkIssues open={key => { const draft = state.drafts.find(d => d.key === key); if (draft) select(draft); }} /> : <>
    <div className="section-heading"><h1>{menuLabels[menu]}</h1>{kind === 'post' || kind === 'series' ? <button onClick={() => void create(kind)}>+ 새 {kind === 'post' ? '글' : '시리즈'}</button> : null}</div>
    {kind === 'post' && <div className="filters"><input aria-label="글 목록 검색" placeholder="제목·설명 검색" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="상태 필터" value={filter} onChange={e => setFilter(e.target.value)}>{['전체', '초안', '게시됨', '수정 중', '보관됨'].map(s => <option key={s}>{s}</option>)}</select><select aria-label="분류 필터" value={category} onChange={e => setCategory(e.target.value)}><option value="">모든 분류</option>{Object.entries(publishedCategories).map(([id, c]) => <option key={id} value={id}>{(c as any).name}</option>)}</select></div>}
    <ul className="cms-list">{state.drafts.filter(d => d.kind === kind && (kind !== 'post' || ((filter === '전체' || d.status === filter) && (!category || d.value.data.category === category) && `${name(d)} ${d.value.data.description}`.toLowerCase().includes(query.toLowerCase())))).map(d => <li key={d.key}><button onClick={() => select(d)}><strong>{name(d)}</strong><span>{d.kind === 'post' ? publishedCategories[d.value.data.category]?.name ?? '분류 없음' : d.kind === 'series' ? `${d.value.data.posts?.length ?? 0}편` : ''}</span><span>{listingStatus(d)}</span><time>{displayDate(d.updated_at)}</time></button></li>)}</ul>
  </>}</main></>;
}
function Editor({ initial, state, refresh, back, navigateGuard }: { navigateGuard: { current: ((action: () => void) => void) | null }; initial: Draft; state: State; refresh: () => Promise<void>; back: () => void }) {
  const [, rerender] = useState(0), [mode, setMode] = useState('편집'), [error, setError] = useState(''), [recovery, setRecovery] = useState<Recovery | null>(null), [locked, setLocked] = useState(false), [job, setJob] = useState<PublishJob | null>(state.jobs.find(j => j.key === initial.key) ?? null), [preview, setPreview] = useState(''), [previewError, setPreviewError] = useState(''), [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light'), [slugChange, setSlugChange] = useState(false), [addingPosts, setAddingPosts] = useState(false), [postQuery, setPostQuery] = useState('');
  const [blockedCategory, setBlockedCategory] = useState<string | null>(null);
  const slugAllowed = useRef(false), engine = useRef<Autosave | null>(null), previewVersion = useRef('');
  if (!engine.current) engine.current = new Autosave(initial, (revision, value) => api<Draft>(`/api/drafts/${initial.key}`, 'PUT', { revision, value, slugChange: slugAllowed.current }), () => rerender(n => n + 1), recoveryStorage);
  const autosave = engine.current, value = autosave.value, data = value.data;
  const scrollSync = useScrollSync(value.body, mode);
  const previewInput = useMemo(() => JSON.stringify({ value, theme }), [value, theme]);
  const previewStale = previewInput !== previewVersion.current;
  const dirty = autosave.generation !== autosave.savedGeneration;
  const update = (next: Payload) => { setError(''); autosave.change(next); };
  const field = (key: string, v: unknown) => update({ ...value, data: { ...data, [key]: v } });
  useEffect(() => {
    navigateGuard.current = action => {
      const current = engine.current!;
      if (current.state === 'conflict') { current.emergency(); if (confirm('미저장 내용은 복구 사본으로 남습니다. 다른 화면으로 이동할까요?')) action(); return; }
      void current.flush().then(action).catch(e => setError(e.message));
    };
    return () => { navigateGuard.current = null; };
  }, []);
  useEffect(() => { setRecovery(autosave.recovery()); return () => { engine.current?.dispose(); }; }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (engine.current!.generation !== engine.current!.savedGeneration) { engine.current!.emergency(); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => { const changed = () => setTheme(document.documentElement.dataset.theme ?? 'light'); window.addEventListener('mory-themechange', changed); return () => window.removeEventListener('mory-themechange', changed); }, []);
  useEffect(() => { const changed = () => { if (matchMedia('(max-width: 999px)').matches) setMode(m => m === '분할' ? '편집' : m); }; window.addEventListener('resize', changed); return () => window.removeEventListener('resize', changed); }, []);
  useLayoutEffect(() => {
    if (mode !== '편집' && ['post', 'page'].includes(initial.kind) && previewStale) scrollSync.previewWillLoad();
  }, [previewInput, mode]);
  useEffect(() => {
    if (mode === '편집' || !['post', 'page'].includes(initial.kind) || !previewStale) return;
    const version = previewInput;
    setPreviewError('');
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/preview/${initial.key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: previewInput, signal: controller.signal });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error); }
        const next = await response.json();
        if (controller.signal.aborted) return;
        scrollSync.previewWillLoad(); previewVersion.current = version;
        setPreview(next.url); setPreviewError('');
      } catch (e) { if ((e as Error).name !== 'AbortError') setPreviewError((e as Error).message); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewInput, mode]);
  useEffect(() => {
    if (!job || !['publishing', 'deploying'].includes(job.state)) return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const next = await api<PublishJob>(`/api/jobs/${job.id}`); if (!live) return;
        if (next.state !== 'publishing') {
          if (autosave.generation === autosave.savedGeneration) {
            try { const row = await api<Draft>(`/api/drafts/${initial.key}`); if (live && autosave.generation === autosave.savedGeneration && row.revision !== autosave.revision) { autosave.draft = row; autosave.value = row.value; autosave.revision = row.revision; autosave.savedAt = row.saved_at; rerender(n => n + 1); } } catch { if (['complete', 'superseded', 'deploying'].includes(next.state)) { back(); } }
          }
          if (live) setLocked(false);
          void refresh();
        }
        if (live) setJob(next);
      } catch { /* A polling outage does not mean the deployment succeeded. */ }
    }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [job?.id, job?.state]);
  async function publish(action: Action = 'publish') {
    if (recovery) { setError('먼저 복구 내용을 확인하세요.'); return; }
    if (action === 'delete' && !confirm(initial.kind === 'series' ? '이 시리즈를 삭제할까요? 글은 그대로 유지됩니다.' : '이 글을 영구 삭제할까요? 모든 시리즈에서도 제거됩니다.')) return;
    setLocked(true); setError('');
    try { await autosave.flush(); const next = await api<PublishJob>(`/api/publish/${initial.key}`, 'POST', { revision: autosave.revision, action }); setJob(next); if (next.state !== 'publishing') setLocked(false); }
    catch (e) { setError((e as Error).message); setLocked(false); }
  }
  async function reload(publicCopy = false) {
    if (dirty && !confirm('현재 미저장 내용은 복구 사본으로 남기고 서버 최신본을 불러올까요?')) return;
    autosave.emergency();
    try { const row = publicCopy ? await api<Draft>(`/api/reload-public/${initial.key}`, 'POST', { revision: autosave.revision }) : await api<Draft>(`/api/drafts/${initial.key}`); autosave.dispose(); engine.current = new Autosave(row, (revision, v) => api<Draft>(`/api/drafts/${initial.key}`, 'PUT', { revision, value: v, slugChange: slugAllowed.current }), () => rerender(n => n + 1), recoveryStorage); setRecovery(engine.current.recovery()); rerender(n => n + 1); } catch (e) { setError((e as Error).message); }
  }
  const categories = state.drafts.find(d => d.kind === 'categories')?.published?.data ?? {};
  const memberships = state.drafts.filter(d => d.kind === 'series' && d.published?.data.posts.includes(initial.id));
  const dragId = useRef<string | null>(null);
  function reorder(id: string, before: string) { const ids: string[] = [...data.posts]; const target = ids.indexOf(before); ids.splice(ids.indexOf(id), 1); ids.splice(target, 0, id); field('posts', ids); }
  return <section className="editor">{initial.kind === 'categories' && <h1>분류</h1>}<div className="editor-toolbar">{initial.kind !== 'categories' && <button onClick={() => { if (dirty || autosave.state === 'conflict') { void autosave.flush().then(back).catch(e => setError((e as Error).message)); } else back(); }}>← 목록</button>}<span className="muted">{autosave.draft.status}</span><p role="status">{autosave.state === 'saving' ? '저장 중…' : autosave.state === 'conflict' ? '충돌 발생' : dirty || autosave.state === 'unsaved' ? '서버에 저장되지 않음' : `저장됨 · ${displayDate(autosave.savedAt).slice(-5)}`}</p><button disabled={locked || data.status === 'archived' || autosave.state === 'conflict' || !!recovery} onClick={() => void publish()}>{initial.kind === 'post' && !autosave.draft.ever_published ? '게시' : '변경사항 게시'}</button></div>
    {error && <p role="alert">! {error}</p>}
    {autosave.error && <p role="alert">! {autosave.error}</p>}
    {recovery && <section className="notice"><p>서버에 저장되지 않은 복구 내용이 있습니다. 자동으로 덮어쓰지 않습니다.</p><details><summary>복구 내용 확인</summary><pre>{JSON.stringify(recovery.value.data, null, 2)}</pre><pre>{recovery.value.body}</pre></details><button onClick={() => { if (recovery.revision !== autosave.revision && !confirm('서버 내용이 그동안 바뀌었습니다. 확인한 복구본으로 현재 작업을 교체할까요?')) return; update(recovery.value); setRecovery(null); }}>복구 내용 사용</button><button onClick={() => { recoveryStorage.removeItem(autosave.recoveryKey); setRecovery(null); }}>서버 내용 유지</button></section>}
    {autosave.state === 'conflict' && <section className="notice"><p>다른 창이나 기기에서 저장한 서버 최신본이 있습니다. 현재 입력은 이 창에 보존됩니다.</p><button onClick={() => void reload()}>서버 최신본 불러오기</button></section>}
    {autosave.failed && autosave.state === 'unsaved' && !locked && <button onClick={() => void autosave.flush().catch(e => setError((e as Error).message))}>자동저장 다시 시도</button>}
    {autosave.failed && autosave.state === 'unsaved' && !locked && <button onClick={() => void reload()}>서버 저장본 불러오기</button>}
    {job && <p className="publish-status" role="status">{jobLabel(job)}{['publishing', 'deploying'].includes(job.state) ? '…' : ''}{['deploying', 'complete', 'superseded'].includes(job.state) && (dirty || autosave.draft.status === '수정 중') ? ' · 미게시 변경 있음' : ''}{job.error && ` · ${job.error.replace(/^배포 실패\.\s*/, '')}`}{state.localSync?.pending && job.commit_sha === state.localSync.publication_sha ? ' · 로컬 저장소 동기화 필요' : ''}</p>}
    {job?.state === 'failed' && job.pushed_at && (state.canRetryDeployment ? <button onClick={() => void api<PublishJob>(`/api/jobs/${job.id}/retry`, 'POST', {}).then(setJob).catch(e => setError(e.message))}>배포 다시 시도</button> : job.run_url && <p><a href={job.run_url} target="_blank" rel="noopener noreferrer">GitHub에서 배포 확인·재시도 →</a></p>)}
    {job?.state === 'conflict' && <button onClick={() => { if (confirm('현재 입력은 복구 사본으로 남기고 외부에서 변경된 공개본을 불러올까요?')) void reload(true); }}>공개본 다시 불러오기</button>}
    <fieldset disabled={locked || !!recovery}>
    {['post', 'page'].includes(initial.kind) && <>
      <label>제목<input value={data.title ?? ''} onChange={e => field('title', e.target.value)} /></label>
      {initial.kind === 'post' && <label>분류<select value={data.category ?? ''} onChange={e => field('category', e.target.value)}><option value="">분류 선택</option>{Object.entries(categories).map(([id, c]) => <option key={id} value={id}>{(c as any).name}</option>)}</select></label>}
      <details className="publication-settings"><summary>게시 설정</summary>{initial.kind === 'post' && <><label>주소 (slug)<input value={data.slug ?? ''} disabled={autosave.draft.ever_published && !slugChange} onChange={e => field('slug', e.target.value)} /></label>{autosave.draft.ever_published && <label className="check-label"><input type="checkbox" checked={slugChange} onChange={e => { slugAllowed.current = e.target.checked; setSlugChange(e.target.checked); }} />게시된 주소 변경 · 이전 주소는 자동 보존</label>}</>}
      <label>짧은 설명<textarea value={data.description ?? ''} onChange={e => field('description', e.target.value)} /></label>
      {initial.kind === 'post' && <><label>최초 게시 시각 (고급)<input placeholder="자동 설정 · ISO 8601 +09:00" value={data.publishedAt ?? ''} onChange={e => field('publishedAt', e.target.value)} /></label><label>수정 시각 (고급)<input placeholder="자동 설정 · ISO 8601 +09:00" value={data.updatedAt ?? ''} onChange={e => field('updatedAt', e.target.value)} /></label><label>이전 주소 (한 줄에 하나)<textarea value={(data.aliases ?? []).join('\n')} onChange={e => field('aliases', e.target.value.split('\n').filter(Boolean))} /></label></>}
      </details>
      <div className="view-modes" aria-label="편집 화면">{['편집', '분할', '미리보기'].map(m => <button type="button" key={m} className={m === '분할' ? 'split-mode' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>)}</div>
      <div className={`editing-surface mode-${mode === '분할' ? 'split' : mode === '미리보기' ? 'preview' : 'edit'}`}><div className="source-pane" ref={scrollSync.sourcePane} data-scroll-ready="false"><Suspense fallback={null}><CodeEditor ref={scrollSync.source} onScroll={scrollSync.sourceScrolled} onReady={scrollSync.sourceReady} value={value.body} disabled={locked || !!recovery} onChange={body => update({ ...value, body })} /></Suspense><p className="pane-loading" role="status">편집기 준비 중…</p></div><div className="preview-pane" data-preview-pending={previewStale ? 'true' : 'false'}><iframe ref={scrollSync.preview} onLoad={scrollSync.previewLoaded} data-scroll-ready="false" title="Mory 실제 미리보기" sandbox="allow-scripts allow-same-origin allow-forms" src={preview || 'about:blank'} /><p className="pane-loading" role={previewError ? 'alert' : 'status'}>{previewError || '미리보기 준비 중…'}</p></div></div>
    </>}
    {initial.kind === 'categories' && <><p>새 분류는 변경사항을 게시한 뒤 글에서 선택할 수 있습니다.</p><div className="registry-list">{Object.entries(data).map(([id, c]) => <div className="registry-row" key={id}><code>{id}</code><label>이름<input value={c.name} onChange={e => field(id, { ...c, name: e.target.value })} /></label><label>순서<input type="number" value={c.order} onChange={e => field(id, { ...c, order: Number(e.target.value) })} /></label><button disabled={locked} onClick={() => { if (categoryReferences(state.drafts, id).length) { setBlockedCategory(id); return; } setBlockedCategory(null); const next = { ...data }; delete next[id]; update({ ...value, data: next }); }}>삭제</button>{blockedCategory === id && <section className="notice category-delete-notice" role="alert"><strong>‘{c.name}’ 분류를 삭제할 수 없습니다.</strong><p>이 분류를 사용하는 글이 있습니다. 초안과 보관된 글도 포함됩니다.</p><ul>{categoryReferences(state.drafts, id).map(d => <li key={d.key}>{d.title} · {d.status} · {d.source}</li>)}</ul><p>글을 다른 분류로 옮겨 주세요. 공개본에도 사용 중이면 변경사항을 게시해야 삭제할 수 있습니다. 보관만으로는 분류 사용이 해제되지 않습니다.</p><button onClick={() => setBlockedCategory(null)}>확인</button></section>}</div>)}</div><button onClick={() => { const id = prompt('분류 ID (영문 소문자·숫자·하이픈)'); if (!id) return; if (Object.hasOwn(data, id)) { setError('이미 사용 중인 ID입니다.'); return; } const label = prompt('분류 이름'); if (label) field(id, { name: label, order: 10 }); }}>+ 새 분류</button></>}
    {initial.kind === 'series' && <><p className="muted">ID: {initial.id}</p><label>이름<input value={data.name} onChange={e => field('name', e.target.value)} /></label><label>설명<textarea value={data.description} onChange={e => field('description', e.target.value)} /></label><ol className="series-edit-list">{(data.posts as string[]).map((id, i) => <li key={id} draggable={!locked} onDragStart={() => { dragId.current = id; }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragId.current && dragId.current !== id) reorder(dragId.current, id); dragId.current = null; }}><span aria-label="끌어서 순서 변경">≡ {i + 1}. {state.drafts.find(d => d.kind === 'post' && d.id === id)?.value.data.title || '제목 없는 글'}</span><button aria-label={`${i + 1}번 글 위로`} disabled={i === 0} onClick={() => reorder(id, data.posts[i - 1])}>↑</button><button aria-label={`${i + 1}번 글 아래로`} disabled={i === data.posts.length - 1} onClick={() => { const ids = [...data.posts]; [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]; field('posts', ids); }}>↓</button><button onClick={() => field('posts', data.posts.filter((p: string) => p !== id))}>제거</button></li>)}</ol><button onClick={() => setAddingPosts(v => !v)}>+ 글 추가</button>{addingPosts && <section className="post-picker"><input aria-label="시리즈에 추가할 글 검색" placeholder="기존 글 검색" value={postQuery} onChange={e => setPostQuery(e.target.value)} />{state.drafts.filter(d => d.kind === 'post' && name(d).includes(postQuery)).map(d => <label className="check-label" key={d.key}><input type="checkbox" checked={data.posts.includes(d.id)} onChange={e => field('posts', e.target.checked ? [...data.posts, d.id] : data.posts.filter((id: string) => id !== d.id))} />{name(d)} · {d.status}</label>)}</section>}</>}
    </fieldset>
    {initial.kind === 'post' && <section className="editor-afterword"><p>시리즈: {memberships.map(d => name(d)).join(', ') || '없음'}</p><p>소속과 순서는 시리즈 메뉴에서 수정합니다.</p>{data.status === 'archived' ? <><button disabled={locked} onClick={() => void publish('restore')}>복원</button><button disabled={locked} onClick={() => void publish('delete')}>영구 삭제</button></> : <button disabled={locked} onClick={() => void publish('archive')}>보관</button>}</section>}
    {initial.kind === 'series' && <div className="editor-danger-zone"><button disabled={locked} onClick={() => void publish('delete')}>시리즈 삭제</button></div>}
  </section>;
}
createRoot(document.getElementById('root')!).render(<App />);

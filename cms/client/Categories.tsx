import { useState } from 'react';
import type { Draft } from '../shared.ts';
import { categoryReferences } from '../shared.ts';
import { routeId } from '../../src/lib/schema.ts';
import { orderedCategories, moveCategory, type CategoryRegistry } from './categories.ts';

export function Categories({ data, published, drafts, onChange }: { data: CategoryRegistry; published: CategoryRegistry; drafts: Draft[]; onChange: (data: CategoryRegistry) => void }) {
  const [adding, setAdding] = useState(false), [newName, setNewName] = useState(''), [newId, setNewId] = useState(''), [error, setError] = useState(''), [blocked, setBlocked] = useState<string | null>(null);
  const entries = orderedCategories(data);
  function add() {
    const id = newId.trim(), name = newName.trim();
    if (!name) { setError('분류 이름을 입력해 주세요.'); return; }
    if (!routeId.safeParse(id).success) { setError('ID는 소문자 영문·숫자를 하이픈으로 연결해 입력해 주세요. 예: daily-notes'); return; }
    if (Object.hasOwn(data, id) || Object.hasOwn(published, id)) { setError('이미 사용 중인 ID입니다. 다른 ID를 입력해 주세요.'); return; }
    const order = Math.max(0, ...entries.map(([, c]) => c.order)) + 10;
    onChange({ ...data, [id]: { name, order } });
    setAdding(false); setNewName(''); setNewId(''); setError('');
  }
  const removed = Object.keys(published).filter(id => !Object.hasOwn(data, id)).length;
  return <section className="category-manager" aria-label="분류 관리">
    <div className="category-heading"><div><p>이름을 바로 수정하고 ↑ ↓ 버튼으로 표시 순서를 바꿀 수 있습니다.</p><p className="muted">자동저장 후 ‘변경사항 게시’를 눌러 사이트에 반영합니다. 새 분류도 게시 후 글에서 선택할 수 있습니다.</p></div><button type="button" aria-expanded={adding} onClick={() => { setAdding(v => !v); setError(''); }}>+ 새 분류</button></div>
    {adding && <div className="category-create"><h2>새 분류</h2><div className="category-create-fields"><label>이름<input autoFocus value={newName} placeholder="예: 일상" onChange={e => setNewName(e.target.value)} /></label><label>ID<input value={newId} autoCapitalize="none" spellCheck={false} placeholder="예: daily" aria-describedby="category-id-help" onChange={e => setNewId(e.target.value)} /></label></div><p id="category-id-help" className="muted">ID는 분류 주소에 사용됩니다. 추가한 뒤에는 변경하지 않습니다.</p>{error && <p role="alert">{error}</p>}<div className="category-actions"><button type="button" onClick={add}>추가</button><button type="button" onClick={() => { setAdding(false); setError(''); }}>취소</button></div></div>}
    <p className="muted">분류 {entries.length}개{removed > 0 ? ` · 삭제 예정 ${removed}개 (게시 후 반영)` : ''}</p>
    {!entries.length && <p>아직 분류가 없습니다. 새 분류를 추가해 주세요.</p>}
    <ul className="category-rows">{entries.map(([id, c], index) => {
      const references = categoryReferences(drafts, id);
      const status = !published[id] ? '미게시' : published[id].name !== c.name || published[id].order !== c.order ? '수정 중' : '게시됨';
      return <li className="category-row" key={id}>
        <div className="category-row-main"><label>분류 이름<input value={c.name} onChange={e => onChange({ ...data, [id]: { ...c, name: e.target.value } })} /></label><p className="muted">{status} · 사용 글 {references.length}편</p></div>
        <div className="category-actions"><button type="button" aria-label={`${c.name || id} 위로`} disabled={index === 0} onClick={() => onChange(moveCategory(data, id, -1))}>↑</button><button type="button" aria-label={`${c.name || id} 아래로`} disabled={index === entries.length - 1} onClick={() => onChange(moveCategory(data, id, 1))}>↓</button><button type="button" aria-label={`${c.name || id} 삭제`} onClick={() => {
          if (references.length) { setBlocked(id); return; }
          if (!confirm(`‘${c.name || id}’ 분류를 삭제할까요? 변경사항을 게시하면 사이트에 반영됩니다.`)) return;
          const next = { ...data }; delete next[id]; onChange(next); setBlocked(null);
        }}>삭제</button></div>
        <details className="category-settings"><summary>ID · 순서 설정</summary><p className="muted">ID: <code>{id}</code></p><label>표시 순서<input type="number" value={c.order} onChange={e => onChange({ ...data, [id]: { ...c, order: Number(e.target.value) } })} /></label></details>
        {blocked === id && <section className="notice category-delete-notice" role="alert"><strong>‘{c.name}’ 분류를 삭제할 수 없습니다.</strong><p>이 분류를 사용하는 글 {references.length}편이 있습니다. 초안과 보관된 글도 포함됩니다.</p><ul>{references.map(d => <li key={d.key}>{d.title} · {d.status} · {d.source}</li>)}</ul><p>글을 다른 분류로 옮겨 주세요. 공개본에도 사용 중이면 변경사항을 게시해야 삭제할 수 있습니다. 보관만으로는 분류 사용이 해제되지 않습니다.</p><button type="button" onClick={() => setBlocked(null)}>확인</button></section>}
      </li>;
    })}</ul>
  </section>;
}

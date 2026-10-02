import { useLayoutEffect, useRef, useState } from 'react';
import { readWritingList, writingListKey } from './list-state.ts';
import type { WritingListState } from './list-state.ts';
import type { CmsLocation } from './navigation.ts';

export function useWritingList(location: CmsLocation, loaded: boolean) {
  const [state, setState] = useState(() => readWritingList({ getItem: key => sessionStorage.getItem(key) }));
  const saved = useRef(state);
  const persist = () => { try { sessionStorage.setItem(writingListKey, JSON.stringify(saved.current)); } catch { /* UI still works when browser storage is unavailable. */ } };
  function change(patch: Partial<Pick<WritingListState, 'query' | 'filter' | 'category'>>) {
    const next = { ...saved.current, ...patch, scrollY: 0 };
    saved.current = next; setState(next); persist();
  }
  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = previous; };
  }, []);
  useLayoutEffect(() => {
    if (!loaded) return;
    if (location.menu !== 'Writing' || location.draft) { window.scrollTo(0, 0); return; }
    // Restore after the saved filters have rendered the list. Scroll updates do
    // not rerender React, and each browser tab keeps its own UI state.
    const top = saved.current.scrollY;
    window.scrollTo(0, top);
    let restoring = true, pending = 0, live = true;
    const ready = requestAnimationFrame(() => { restoring = false; });
    void document.fonts.ready.then(() => { if (live && saved.current.scrollY === top) window.scrollTo(0, top); });
    const scroll = () => {
      if (restoring) return;
      saved.current = { ...saved.current, scrollY: window.scrollY };
      if (!pending) pending = requestAnimationFrame(() => { pending = 0; persist(); });
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { live = false; cancelAnimationFrame(ready); cancelAnimationFrame(pending); window.removeEventListener('scroll', scroll); persist(); };
  }, [loaded, location.menu, location.draft, state.query, state.filter, state.category]);
  return { ...state, change };
}

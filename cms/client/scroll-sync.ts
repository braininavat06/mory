import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { CodeEditorHandle } from './CodeEditor.tsx';

type Anchor = { line: number; top: number };
export function interpolate(anchors: Anchor[], value: number, from: 'line' | 'top', to: 'line' | 'top') {
  if (!anchors.length) return 0;
  if (value <= anchors[0][from]) return anchors[0][to];
  for (let i = 1; i < anchors.length; i++) {
    const previous = anchors[i - 1], next = anchors[i];
    if (value <= next[from]) {
      const span = next[from] - previous[from];
      return previous[to] + (span ? (value - previous[from]) / span : 0) * (next[to] - previous[to]);
    }
  }
  return anchors.at(-1)![to];
}

export function useScrollSync(body: string, mode: string) {
  const source = useRef<CodeEditorHandle>(null), preview = useRef<HTMLIFrameElement>(null);
  const sourcePane = useRef<HTMLDivElement>(null), readyDocument = useRef<Document | null>(null);
  const position = useRef(1), lines = useRef(1), suppress = useRef(false), scrollGeneration = useRef(0), cleanup = useRef(() => {});
  lines.current = body.split('\n').length;
  const anchors = useCallback(() => {
    const frame = preview.current, doc = frame?.contentDocument, win = frame?.contentWindow;
    if (!doc || !win || !frame?.clientHeight) return [];
    const map: Anchor[] = [{ line: 1, top: 0 }];
    const marked = [...doc.querySelectorAll<HTMLElement>('[data-source-start]')]
      .map(element => ({ line: Number(element.dataset.sourceStart), top: element.getBoundingClientRect().top + win.scrollY }))
      .filter(anchor => anchor.line > 1 && anchor.line <= lines.current)
      .sort((a, b) => a.line - b.line || a.top - b.top);
    for (const anchor of marked) if (anchor.line > map.at(-1)!.line && anchor.top > map.at(-1)!.top) map.push(anchor);
    map.push({ line: lines.current + 1, top: doc.documentElement.scrollHeight });
    return map;
  }, []);
  const restorePreview = useCallback(() => {
    const frame = preview.current;
    if (!frame?.clientHeight) return;
    const generation = ++scrollGeneration.current;
    suppress.current = true;
    frame.contentWindow?.scrollTo(0, interpolate(anchors(), position.current, 'line', 'top'));
    requestAnimationFrame(() => requestAnimationFrame(() => { if (generation === scrollGeneration.current) suppress.current = false; }));
  }, [anchors]);
  const sourceScrolled = useCallback((line: number) => { position.current = line; restorePreview(); }, [restorePreview]);
  const sourceReady = useCallback(() => {
    const pane = sourcePane.current;
    if (!pane?.clientHeight) return;
    pane.dataset.scrollReady = 'false';
    source.current?.scrollToSource(position.current, () => { if (sourcePane.current === pane) pane.dataset.scrollReady = 'true'; });
  }, []);
  const previewWillLoad = useCallback(() => {
    cleanup.current(); readyDocument.current = null; suppress.current = true;
    if (preview.current) preview.current.dataset.scrollReady = 'false';
  }, []);
  const previewLoaded = useCallback(() => {
    cleanup.current();
    const frame = preview.current, win = frame?.contentWindow, doc = frame?.contentDocument;
    if (!win || !doc) return;
    let animation = 0, live = true;
    const scrolled = () => {
      if (suppress.current || !frame?.clientHeight) return;
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        if (suppress.current) return;
        position.current = interpolate(anchors(), win.scrollY, 'top', 'line');
        source.current?.scrollToSource(position.current);
      });
    };
    const userScroll = () => { scrollGeneration.current++; suppress.current = false; };
    win.addEventListener('scroll', scrolled, { passive: true });
    for (const event of ['wheel', 'pointerdown', 'keydown']) win.addEventListener(event, userScroll, { passive: true });
    const observer = new ResizeObserver(restorePreview);
    if (doc.body) observer.observe(doc.body);
    // Late image/font layout changes retain the current source position.
    doc.addEventListener('load', restorePreview, true);
    void doc.fonts.ready.then(() => {
      if (!live) return;
      restorePreview();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!live || preview.current?.contentDocument !== doc) return;
        restorePreview(); readyDocument.current = doc;
        preview.current.dataset.scrollReady = 'true';
      }));
    });
    restorePreview();
    cleanup.current = () => {
      live = false; cancelAnimationFrame(animation); observer.disconnect();
      win.removeEventListener('scroll', scrolled);
      for (const event of ['wheel', 'pointerdown', 'keydown']) win.removeEventListener(event, userScroll);
      doc.removeEventListener('load', restorePreview, true);
    };
  }, [anchors, restorePreview]);
  useLayoutEffect(() => {
    sourceReady();
    restorePreview();
    if (preview.current?.contentDocument === readyDocument.current) preview.current!.dataset.scrollReady = 'true';
  }, [mode, restorePreview]);
  useEffect(() => () => cleanup.current(), []);
  return { source, sourcePane, preview, sourceScrolled, sourceReady, previewLoaded, previewWillLoad };
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { basicSetup } from 'codemirror';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
export type CodeEditorHandle = { scrollToSource: (line: number, restored?: () => void) => void };
export default forwardRef<CodeEditorHandle, { value: string; onChange: (v: string) => void; disabled: boolean; onScroll: (line: number) => void; onReady: () => void }>(function CodeEditor({ value, onChange, disabled, onScroll, onReady }, ref) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), callback = useRef(onChange), editable = useRef(new Compartment()), syncing = useRef(false);
  const scrollCallback = useRef(onScroll), suppressScroll = useRef(false), scrollGeneration = useRef(0);
  const reveal = useRef<(() => void) | null>(null);
  callback.current = onChange;
  scrollCallback.current = onScroll;
  useImperativeHandle(ref, () => ({ scrollToSource(line, restored) {
    const editor = view.current;
    if (!editor || !editor.scrollDOM.clientHeight) return;
    if (restored) reveal.current = restored;
    const number = Math.max(1, Math.min(editor.state.doc.lines, Math.floor(line)));
    editor.requestMeasure({ key: scrollCallback, read: () => {
      const block = editor.lineBlockAt(editor.state.doc.line(number).from);
      const top = block.top + Math.min(.999, Math.max(0, line - number)) * block.height;
      return top + editor.documentTop - editor.scrollDOM.getBoundingClientRect().top + editor.scrollDOM.scrollTop;
    }, write: top => {
      const generation = ++scrollGeneration.current;
      suppressScroll.current = true; editor.scrollDOM.scrollTop = top;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (generation === scrollGeneration.current) { suppressScroll.current = false; reveal.current?.(); reveal.current = null; } }));
    } });
  } }), []);
  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [basicSetup, markdown(), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping, editable.current.of(EditorView.editable.of(!disabled)), EditorView.contentAttributes.of({ 'aria-label': 'Markdown 본문', spellcheck: 'false' }), EditorView.updateListener.of(update => { if (update.docChanged && !syncing.current) callback.current(update.state.doc.toString()); })] }) });
    let frame = 0;
    const scrolled = () => {
      if (suppressScroll.current || !editor.scrollDOM.clientHeight) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (suppressScroll.current) return;
        const top = Math.max(0, editor.scrollDOM.getBoundingClientRect().top - editor.documentTop);
        const block = editor.lineBlockAtHeight(top);
        const line = editor.state.doc.lineAt(block.from).number;
        scrollCallback.current(line + Math.min(.999, Math.max(0, (top - block.top) / block.height)));
      });
    };
    const userScroll = () => { scrollGeneration.current++; suppressScroll.current = false; reveal.current?.(); reveal.current = null; };
    editor.scrollDOM.addEventListener('scroll', scrolled, { passive: true });
    for (const event of ['wheel', 'pointerdown', 'keydown']) editor.scrollDOM.addEventListener(event, userScroll, { passive: true });
    view.current = editor; onReady(); return () => { cancelAnimationFrame(frame); editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!disabled)) }); }, [disabled]);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== value && !editor.composing) { syncing.current = true; try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); } finally { syncing.current = false; } } }, [value]);
  return <div className="code-editor" ref={host} />;
});

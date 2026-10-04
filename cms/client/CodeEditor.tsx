import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { imageAnchors, addImageAnchor, removeImageAnchor } from './image-anchors.ts';
import { EditorAssist } from './EditorAssist.tsx';
import { editorTargets, edit, smartPasteLink, wrapSelectedInput } from './editor-commands.ts';
import { syncEditorSelection } from './editor-selection.ts';
import type { Draft } from '../shared.ts';
import { basicSetup } from 'codemirror';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
export type CodeEditorHandle = { scrollToSource: (line: number, restored?: () => void) => void; imageSelection: (files: File[]) => void; captureImagePosition: () => void };
export default forwardRef<CodeEditorHandle, { value: string; onChange: (v: string) => void; disabled: boolean; onScroll: (line: number) => void; onReady: () => void; onImages: (files: File[]) => Promise<string[]>; onImagePending: (count: number) => void; posts: Draft[]; series: Draft[]; isPage: boolean; onPickImage: () => void }>(function CodeEditor({ value, onChange, disabled, onScroll, onReady, onImages, onImagePending, posts, series, isPage, onPickImage }, ref) {
  const plainPaste = useRef(false), pickCallback = useRef(onPickImage);pickCallback.current=onPickImage;
  const [instance, setInstance] = useState<EditorView | null>(null);
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), callback = useRef(onChange), assistant = useRef(new Compartment()), editable = useRef(new Compartment()), syncing = useRef(false);
  const scrollCallback = useRef(onScroll), suppressScroll = useRef(false), scrollGeneration = useRef(0);
  const imageCallback = useRef(onImages), pickerAnchor = useRef<string | null>(null), isDisabled = useRef(disabled);
  const pendingImages = useRef(0), pendingCallback = useRef(onImagePending); pendingCallback.current = onImagePending;
  imageCallback.current = onImages; isDisabled.current = disabled;
  function capture(pos: number) { const editor=view.current!; const id=crypto.randomUUID();editor.dispatch({effects:addImageAnchor.of({id,pos})});return id; }
  async function images(files: File[], position?: number) {
    const editor=view.current;if(!editor||isDisabled.current||!files.length)return;
    const id=position===undefined&&pickerAnchor.current?pickerAnchor.current:capture(position??editor.state.selection.main.from);pickerAnchor.current=null;pendingCallback.current(++pendingImages.current);
    try { const filenames=await imageCallback.current(files);
      while(editor.composing&&view.current===editor)await new Promise(resolve=>setTimeout(resolve,50));
      if(view.current!==editor)return;
      const pos=editor.state.field(imageAnchors).get(id);
      if(pos!==undefined&&filenames.length)editor.dispatch({changes:{from:pos,insert:'\n'+filenames.map(name=>`![[${name}]]`).join('\n')+'\n'},effects:removeImageAnchor.of(id)});
    }finally{if(view.current===editor){editor.dispatch({effects:removeImageAnchor.of(id)});pendingCallback.current(--pendingImages.current);}}
  }
  const reveal = useRef<(() => void) | null>(null);
  callback.current = onChange;
  scrollCallback.current = onScroll;
  useImperativeHandle(ref, () => ({ captureImagePosition() { if(view.current){if(pickerAnchor.current)view.current.dispatch({effects:removeImageAnchor.of(pickerAnchor.current)});pickerAnchor.current=capture(view.current.state.selection.main.from);} }, imageSelection(files) { void images(files); }, scrollToSource(line, restored) {
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
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [assistant.current.of([]), Prec.highest(EditorView.inputHandler.of((editor,_from,_to,text)=>{
      if(isDisabled.current)return false;
      const wrapped=wrapSelectedInput(editor.state,text,editor.composing||editor.compositionStarted);
      if(!wrapped)return false;
      editor.dispatch(wrapped);return true;
    })), basicSetup, imageAnchors, editorTargets, EditorView.domEventHandlers({
      copy(_event,editor) { syncEditorSelection(editor); return false; },
      cut(_event,editor) { syncEditorSelection(editor); return false; },
      paste(event,editor) {
        const plain=plainPaste.current;plainPaste.current=false;
        if(isDisabled.current)return false;
        syncEditorSelection(editor);
        const files=[...(event.clipboardData?.items??[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
        if(files.length){event.preventDefault();void images(files);return true;}
        const link=smartPasteLink(editor,event.clipboardData?.getData('text/plain')??'',plain),selection=editor.state.selection.main;
        if(link!==null){event.preventDefault();editor.dispatch(edit(selection.from,selection.to,link));return true;}
        return false;
      },
      drop(event,editor) { const files=[...(event.dataTransfer?.files??[])].filter(file=>file.type.startsWith('image/')||/\.(jpe?g|png|webp|gif)$/i.test(file.name));if(!files.length)return false;if(isDisabled.current)return false;event.preventDefault();void images(files,editor.posAtCoords({x:event.clientX,y:event.clientY})??editor.state.selection.main.from);return true; },
      dragover(event) { if([...event.dataTransfer?.items??[]].some(item=>item.kind==='file'&&item.type.startsWith('image/'))){event.preventDefault();return true;}return false; },
    }), markdown({pasteURLAsLink:false}), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping, editable.current.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]), EditorView.contentAttributes.of({ 'aria-label': 'Markdown 본문', spellcheck: 'false' }), EditorView.updateListener.of(update => { if (update.docChanged && !syncing.current) callback.current(update.state.doc.toString()); })] }) });
    let plainTimer:ReturnType<typeof setTimeout>;
    const pasteKey = (event: KeyboardEvent) => { if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='v'){plainPaste.current=true;clearTimeout(plainTimer);plainTimer=setTimeout(()=>{plainPaste.current=false;},1500);} };
    editor.contentDOM.addEventListener('keydown',pasteKey,true);
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
    view.current = editor; setInstance(editor); onReady(); return () => { clearTimeout(plainTimer);editor.contentDOM.removeEventListener('keydown',pasteKey,true);cancelAnimationFrame(frame); editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]) }); }, [disabled]);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== value && !editor.composing) { syncing.current = true; try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); } finally { syncing.current = false; } } }, [value]);
  const pickImage = useCallback(() => { const editor=view.current;if(!editor||editor.composing||isDisabled.current)return;if(pickerAnchor.current)editor.dispatch({effects:removeImageAnchor.of(pickerAnchor.current)});pickerAnchor.current=capture(editor.state.selection.main.from);pickCallback.current(); }, []);
  return <div className="code-editor"><EditorAssist slot={assistant.current} editor={instance} disabled={disabled} posts={posts} series={series} isPage={isPage} onImage={pickImage} /><div className="code-editor-host" ref={host} /></div>;
});

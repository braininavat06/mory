import { useEffect, useRef, useState, memo, type PointerEvent, type MouseEvent } from 'react';
import { syncEditorSelection } from './editor-selection.ts';
import { Compartment, EditorSelection, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { isolateHistory, undo, redo } from '@codemirror/commands';
import type { Draft } from '../shared.ts';
import { callouts, dynamicKinds, youtubeId, type CalloutType } from '../../src/markdown/syntax.ts';
import { addTarget, removeTarget, editorTargets, assistCommands, filterCommands, slashContext, imageContext, outline, format, edit, blockEdit, markdownLink, wikiLink, imageMarkdown, calloutMarkdown, tableMarkdown, dynamicMarkdown, type Range, type ImageContext, type LinkContext, linkContext, updateLink, commandGroups, commandGroup, calloutContext, codeMarkdown, canEdit, nextCommandIndex } from './editor-commands.ts';
interface Panel { kind:string; id:string; source:string; slash:boolean; selected:string; image?:ImageContext; callout?:ReturnType<typeof calloutContext>; link?:LinkContext }
const titles:Record<string,string>={menu:'작성 도구',link:'링크 넣기',callout:'콜아웃',table:'표 넣기',youtube:'YouTube 영상',code:'코드 블록',dynamic:'사이트 데이터', 'image-edit':'이미지 설명',outline:'본문 목차'};
export const EditorAssist = memo(function EditorAssist({ slot, editor, disabled, posts, series, isPage, onImage }: { slot:Compartment;editor:EditorView|null;disabled:boolean;posts:Draft[];series:Draft[];isPage:boolean;onImage:()=>void }) {
 const [slashTop,setSlashTop]=useState(64);
 const [panel,setPanel]=useState<Panel|null>(null), [error,setError]=useState(''), [notice,setNotice]=useState(''), [filter,setFilter]=useState(''), [slash,setSlash]=useState<ReturnType<typeof slashContext>>(null), [active,setActive]=useState(0), [image,setImage]=useState<ImageContext|null>(null), [length,setLength]=useState(0), [link,setLink]=useState<LinkContext|null>(null), [callout,setCallout]=useState<ReturnType<typeof calloutContext>>(null);
 const [fields,setFields]=useState({label:'',url:'',linkMode:'external',type:'note',title:'',rows:'3',columns:'2',language:'',width:'',alt:'',caption:'',dynamic:'recent-writing',count:'5',series:''});
 const composing=useRef(false);
 const dialog=useRef<HTMLDialogElement>(null), menuInput=useRef<HTMLInputElement>(null), panelRef=useRef(panel), commandsRef=useRef<(id:string,fromSlash?:boolean)=>void>(()=>{}), slashRef=useRef(slash), listRef=useRef<HTMLDivElement>(null), activeRef=useRef(active), escaped=useRef<string|null>(null);
 panelRef.current=panel;slashRef.current=slash;activeRef.current=active;
 const available=filterCommands(slash?.query??filter,isPage).filter(c=>c.id!=='image-edit'||!!image);
 const availableRef=useRef(available);availableRef.current=available;
 const setField=(key:keyof typeof fields,value:string)=>{setFields(f=>({...f,[key]:value}));setError('');};
 function allowed() {if(!editor||disabled||editor.state.readOnly)return false;if(composing.current||!canEdit(editor,disabled)){setNotice('한글 입력을 마친 뒤 작성 도구를 사용해 주세요.');return false;}setNotice('');return true;}
 function finish() {
   if(editor&&panelRef.current)editor.dispatch({effects:removeTarget.of(panelRef.current.id)});
   setPanel(null);setError('');setFilter('');dialog.current?.close();editor?.focus();
 }
 function target(p:Panel):Range {
   if(!editor)throw new Error('편집기가 준비되지 않았습니다.');
   const range=editor.state.field(editorTargets).get(p.id);
   if(!range||range.to<range.from||editor.state.sliceDoc(range.from,range.to)!==p.source)throw new Error('선택한 내용이 바뀌었습니다. 창을 닫고 다시 선택해 주세요.');
   return range;
 }
 function capture(kind:string,fromSlash=false):Panel {
   const current=editor!.state, context=kind==='image-edit'?imageContext(current):null;
   if(kind==='image-edit'&&!context)throw new Error('이미지 문법 또는 바로 아래 설명 줄에 커서를 놓아 주세요.');
   const slashRange=fromSlash?slashContext(current):null;
   const callout=kind==='callout'&&!fromSlash&&current.selection.main.empty?calloutContext(current):null;
   const link=kind==='link'&&!fromSlash?linkContext(current):null;
   const range=context??callout??link??slashRange??current.selection.main,id=crypto.randomUUID(),source=current.sliceDoc(range.from,range.to);
   editor!.dispatch({effects:addTarget.of({id,range:{from:range.from,to:range.to}})});
   return {kind,id,source,slash:!!slashRange,selected:slashRange?'':callout?callout.body:source,image:context??undefined,callout,link:link??undefined};
 }
 function apply(p:Panel,text:string,block=false,start=text.length,end=start) {
   if(!allowed())return;
   const range=target(p);editor!.dispatch(block?blockEdit(editor!.state,range,text,start,end):edit(range.from,range.to,text,start,end));finish();
 }
 function retainSelection(event:PointerEvent<HTMLElement>|MouseEvent<HTMLElement>) {
   if(event.button!==0||!(event.target as HTMLElement).closest('button'))return;
   if(editor&&!panelRef.current&&!composing.current)syncEditorSelection(editor);
   event.preventDefault();
 }
 function run(id:string,fromSlash=false) {
   if(!allowed())return;
   if(!panelRef.current)syncEditorSelection(editor!);
   try {
     if(id==='undo'||id==='redo'){(id==='undo'?undo:redo)(editor!);editor!.focus();return;}
     const currentPanel=panelRef.current;
     const reuse=currentPanel?.kind==='menu'&&id!=='image-edit'&&!(id==='callout'&&editor!.state.selection.main.empty)&&!(id==='link'&&linkContext(editor!.state)); 
     if(currentPanel?.kind==='menu'&&!reuse)editor!.dispatch({effects:removeTarget.of(currentPanel.id)});
     const p=reuse?{...currentPanel!,kind:id}:capture(id,fromSlash);
     const command=assistCommands.find(c=>c.id===id), range=target(p);
     setSlash(null);escaped.current=fromSlash?`${range.from}:${p.source}`:escaped.current;
     if(id==='image') {
       if(p.slash)editor!.dispatch(edit(range.from,range.to,''));
       editor!.dispatch({effects:removeTarget.of(p.id)});setPanel(null);dialog.current?.close();editor!.focus();onImage();return;
     }
     if(command?.format&&id!=='code') {
       if(p.slash) {
         const cleared=editor!.state.update({changes:{from:range.from,to:range.to,insert:''},selection:EditorSelection.cursor(range.from)});
         const transformed=cleared.state.update(format(cleared.state,command.format));
         editor!.dispatch({changes:cleared.changes.compose(transformed.changes),selection:transformed.newSelection,annotations:isolateHistory.of('full'),userEvent:'input.mory',scrollIntoView:true});
       }else editor!.dispatch(format(editor!.state,command.format,range));
       editor!.dispatch({effects:removeTarget.of(p.id)});setPanel(null);dialog.current?.close();editor!.focus();return;
     }
     setFilter('');setError('');
     setFields(f=>({...f,label:p.link?.label??p.selected,url:p.link?.url??(id==='youtube'&&youtubeId(p.selected.trim())?p.selected.trim():''),linkMode:'external',type:p.callout?.type??'note',title:p.callout?.title??'',width:p.image?.width??'',alt:p.image?.alt??'',caption:p.image?.caption??'',dynamic:dynamicKinds.includes(id as any)?id:isPage?'recent-writing':'series-writing',series:series.find(s=>s.published)?.id??''}));
     setPanel({...p,kind:dynamicKinds.includes(id as any)?'dynamic':id});
   }catch(e){setNotice((e as Error).message);}
 }
 commandsRef.current=run;
 useEffect(()=>{
   if(!editor)return;
   let live=true;let timer:ReturnType<typeof setTimeout>;
   function update() {
     if(!live||composing.current||editor!.composing)return;
     const next=slashContext(editor!.state),key=next?`${next.from}:${editor!.state.sliceDoc(next.from,next.to)}`:null;
     if(key!==escaped.current)escaped.current=null;
     const shown=next&&key!==escaped.current?next:null;
     setSlash(old=>old?.from===shown?.from&&old?.to===shown?.to&&old?.query===shown?.query?old:shown);
     clearTimeout(timer);timer=setTimeout(()=>{setImage(imageContext(editor!.state));setLink(linkContext(editor!.state));setCallout(calloutContext(editor!.state));setLength(editor!.state.doc.length);},180);
   }
   const slashKey=(key:string)=>{
     if(composing.current||editor.composing||editor.state.readOnly||!slashRef.current)return false;
     if(key==='Escape'){const s=slashRef.current;escaped.current=`${s.from}:${editor.state.sliceDoc(s.from,s.to)}`;setSlash(null);return true;}
     const count=availableRef.current.length;
     if(key==='Enter'){if(!count)return false;commandsRef.current(availableRef.current[Math.min(activeRef.current,count-1)].id,true);return true;}
     if(count){const next=nextCommandIndex(activeRef.current,key==='ArrowDown'?1:-1,count);activeRef.current=next;setActive(next);}return true;
   };
   editor.dispatch({effects:slot.reconfigure([
     EditorView.updateListener.of(u=>{if(u.docChanged||u.selectionSet)update();}),
     Prec.highest(keymap.of([
       ...['ArrowDown','ArrowUp','Enter','Escape'].map(key=>({key,run:()=>slashKey(key)})),
       {key:'Mod-b',run:()=>{commandsRef.current('bold');return true;}}, {key:'Mod-i',run:()=>{commandsRef.current('italic');return true;}}, {key:'Mod-k',run:()=>{commandsRef.current('link');return true;}},
     ])),

   ])});
   const compositionStart=()=>{composing.current=true;setSlash(null);};
   const compositionEnd=()=>{composing.current=false;setTimeout(update,0);};
   editor.contentDOM.addEventListener('compositionstart',compositionStart,true);editor.contentDOM.addEventListener('compositionend',compositionEnd,true);
   update();return()=>{live=false;editor.contentDOM.removeEventListener('compositionstart',compositionStart,true);editor.contentDOM.removeEventListener('compositionend',compositionEnd,true);clearTimeout(timer);if(editor.dom.isConnected)editor.dispatch({effects:slot.reconfigure([])});};
 },[editor,slot]);
 useEffect(()=>{setActive(0);},[slash?.query,filter]);
 useEffect(()=>{listRef.current?.querySelector<HTMLElement>(`[data-active='true']`)?.scrollIntoView({block:'nearest'});},[active]);
 useEffect(()=>{
   if(panel&&!dialog.current?.open)dialog.current?.showModal();
   if(!panel&&dialog.current?.open)dialog.current.close();
   if(!panel)return;
   const frame=requestAnimationFrame(()=>{
     const mobile=matchMedia('(max-width: 600px)').matches;
     dialog.current!.scrollTop=0;
     const preferred=mobile&&['image-edit','table','callout','dynamic'].includes(panel.kind)?null:panel.kind==='menu'?(mobile?null:menuInput.current):dialog.current?.querySelector<HTMLElement>('[data-assist-focus]');
     (preferred??dialog.current?.querySelector<HTMLElement>('.dialog-header button'))?.focus({preventScroll:true});
   });return()=>cancelAnimationFrame(frame);
 },[panel?.kind,panel?.id]);
 useEffect(()=>{
   if(!slash||!editor)return;
   editor.requestMeasure({read:()=>{const coords=editor.coordsAtPos(slash.to),box=editor.dom.closest('.code-editor')!.getBoundingClientRect();return coords?Math.max(60,Math.min(coords.bottom-box.top+4,box.height-230)):64;},write:top=>setSlashTop(top)});
 },[slash?.from,slash?.to,editor]);
 useEffect(()=>{
   if(!panel)return;
   const resize=()=>dialog.current?.style.setProperty('--assist-max-height',`${Math.max(180,(window.visualViewport?.height??innerHeight)-32)}px`);
   resize();window.visualViewport?.addEventListener('resize',resize);return()=>window.visualViewport?.removeEventListener('resize',resize);
 },[!!panel]);
 const currentChoices=filterCommands(filter,isPage).filter(c=>c.id!=='image-edit'||!!image);
 function submit() {
   if(!panel||!allowed())return;
   try {
     if(panel.kind==='link'){apply(panel,panel.link?updateLink(panel.link,fields.label,fields.url):markdownLink(fields.label||fields.url,fields.url));}
     else if(panel.kind==='image-edit'&&panel.image)apply(panel,imageMarkdown({...panel.image,width:fields.width,alt:fields.alt,caption:fields.caption}));
     else if(panel.kind==='callout'){const text=calloutMarkdown(fields.type as CalloutType,fields.title,panel.selected);apply(panel,text,true);}
     else if(panel.kind==='table'){const text=tableMarkdown(Number(fields.rows),Number(fields.columns));apply(panel,text,true,2,5);}
     else if(panel.kind==='youtube'){if(!youtubeId(fields.url.trim()))throw new Error('YouTube 영상 주소를 확인해 주세요.');apply(panel,fields.url.trim(),true);}
     else if(panel.kind==='dynamic'){apply(panel,dynamicMarkdown(fields.dynamic,Number(fields.count),fields.series,isPage),true);}
     else if(panel.kind==='code'){
       const code=codeMarkdown(panel.selected,fields.language);apply(panel,code.text,true,code.start,code.start+panel.selected.length);
     }
   }catch(e){setError((e as Error).message);}
 }
 const primary=[['bold','굵게','B'],['italic','기울임','I'],['highlight','강조','강조'],['h2','소제목 H2','H2'],['link','링크 · 내부 글','링크'],['image','이미지 업로드','이미지']];
 return <>
   <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 작성 도구" onPointerDown={retainSelection} onMouseDown={retainSelection}>
     {primary.map(([id,label,text])=><button type="button" key={id} disabled={disabled} title={`${label}${id==='bold'?' (Ctrl/Cmd+B)':id==='italic'?' (Ctrl/Cmd+I)':id==='link'?' (Ctrl/Cmd+K)':''}`} aria-label={label} onClick={()=>run(id)}>{text}</button>)}
     <button type="button" disabled={disabled} aria-label="작성 도구 더보기" aria-haspopup="dialog" onClick={()=>run('menu')}>더보기</button>
   </div>

   {notice&&<p className="markdown-notice" role="status">{notice}</p>}
   {slash&&!disabled&&<div className="slash-picker" style={{top:slashTop}} role="listbox" aria-label="슬래시 작성 명령" ref={listRef} onPointerDown={retainSelection}>
     {available.map((c,i)=><button type="button" role="option" aria-selected={i===active} data-active={i===active} key={c.id} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c.id,true)}>{c.name}<small>/{c.id}</small></button>)}
     {!available.length&&<p>일치하는 도구가 없습니다.</p>}
     <p className="muted">↑ ↓ 선택 · Enter 실행 · Esc 닫기</p>
   </div>}
   <div className="markdown-editor-status" onPointerDown={retainSelection} onMouseDown={retainSelection}><div className="markdown-status-context">{image?<button type="button" disabled={disabled} aria-label="이미지 너비·설명 편집" onClick={()=>run('image-edit')}>이미지 설정</button>:link?<button type="button" disabled={disabled} onClick={()=>run('link')}>링크 수정</button>:callout?<button type="button" disabled={disabled} onClick={()=>run('callout')}>콜아웃 수정</button>:<span>{length.toLocaleString('ko-KR')}자 · Markdown 원문</span>}</div><button type="button" disabled={disabled} onClick={()=>run('outline')}>목차 이동</button><button type="button" disabled={disabled} aria-label="실행 취소" onClick={()=>run('undo')}>↶</button><button type="button" disabled={disabled} aria-label="다시 실행" onClick={()=>run('redo')}>↷</button></div>
   <dialog ref={dialog} className="editor-assist-dialog" aria-labelledby="editor-assist-title" onCancel={e=>{e.preventDefault();finish();}} onClick={e=>{if(e.target===e.currentTarget){const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)finish();}}}>
     <div className="dialog-header"><h2 id="editor-assist-title">{panel?.link?'링크 수정':panel?.callout?'콜아웃 수정':titles[panel?.kind??'']??'작성 도구'}</h2><button type="button" aria-label="작성 도구 닫기" onClick={finish}>닫기 ×</button></div>
     {panel?.kind==='menu'&&<><label>도구 검색<input ref={menuInput} value={filter} placeholder="표, 각주, 시리즈…" onChange={e=>setFilter(e.target.value)} /></label>{commandGroups.map(group=>{const choices=currentChoices.filter(c=>commandGroup(c)===group);return choices.length>0&&<section className="assist-command-section" key={group}><h3>{group}</h3><div className="assist-command-grid">{choices.map(c=><button type="button" key={c.id} aria-label={c.name} onClick={()=>run(c.id)}>{c.name}<small>/{c.id}</small></button>)}</div></section>;})}{!currentChoices.length&&<p className="muted">일치하는 도구가 없습니다. 다른 이름으로 검색해 주세요.</p>}</>}
     {panel?.kind==='outline'&&<div className="assist-outline">{editor&&outline(editor.state).map(h=><button key={h.from} type="button" className={`heading-${h.level}`} onClick={()=>{finish();editor.dispatch({selection:EditorSelection.cursor(h.from),effects:EditorView.scrollIntoView(h.from,{y:'center'})});editor.focus();}}>{h.title}</button>)}{editor&&!outline(editor.state).length&&<p>H2~H4 소제목을 넣으면 여기에서 이동할 수 있습니다.</p>}</div>}
     {panel&&['link','image-edit','callout','table','youtube','dynamic','code'].includes(panel.kind)&&<form onSubmit={e=>{e.preventDefault();submit();}}>
       {panel.kind==='link'&&<><div className="assist-tabs"><button type="button" aria-pressed={fields.linkMode==='external'} onClick={()=>setField('linkMode','external')}>주소 입력</button><button type="button" aria-pressed={fields.linkMode==='internal'} onClick={()=>setField('linkMode','internal')}>Mory 글</button></div><label>표시 이름<input value={fields.label} onChange={e=>setField('label',e.target.value)} /></label>{fields.linkMode==='external'?<label>{panel.link?.kind==='wiki'?'글 주소 (slug)':'URL 또는 내부 경로'}<input data-assist-focus value={fields.url} placeholder={panel.link?.kind==='wiki'?'예: some-post':'https://… 또는 /about/'} type="text" autoCapitalize="none" onChange={e=>setField('url',e.target.value)} /></label>:<><label>글 검색<input inputMode="search" enterKeyHint="search" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}} value={filter} placeholder="제목 또는 주소 검색" onChange={e=>setFilter(e.target.value)} /></label><div className="assist-post-picker">{posts.filter(p=>`${p.value.data.title} ${p.value.data.slug} ${p.published?.data.title??''} ${p.published?.data.slug??''}`.toLowerCase().includes(filter.toLowerCase())).map(p=>{const data=p.published?.data??p.value.data;return <button type="button" key={p.key} disabled={!data.slug} onClick={()=>{try{apply(panel,wikiLink(data.slug,fields.label||data.title||data.slug));}catch(e){setError((e as Error).message);}}}><strong>{data.title||'제목 없는 글'}</strong><small>{p.status} · {data.slug||'주소 미설정'}</small></button>;})}</div><p className="muted">초안·보관된 글은 공개 사이트에서 링크 없이 표시됩니다.</p></>}</>}
       {panel.kind==='image-edit'&&<><p className="muted">{panel.image?.filename}</p><label>너비 (px)<input data-assist-focus inputMode="numeric" value={fields.width} placeholder="원본" onChange={e=>setField('width',e.target.value)} /></label><div className="assist-presets">{['','300','600','900'].map(w=><button type="button" key={w} aria-pressed={fields.width===w} onClick={()=>setField('width',w)}>{w||'원본'}</button>)}</div><label>대체 설명 (alt)<input value={fields.alt} onChange={e=>setField('alt',e.target.value)} /></label><label>화면 설명 (caption)<input value={fields.caption} placeholder="굵게·기울임·링크 문법 사용 가능" onChange={e=>setField('caption',e.target.value)} /></label><p className="muted">둘 다 선택 사항입니다. alt를 비우면 caption의 읽을 수 있는 문장이 대체 설명으로 쓰입니다.</p></>}
       {panel.kind==='callout'&&<><label>종류<select data-assist-focus aria-label="콜아웃 종류" value={fields.type} onChange={e=>setField('type',e.target.value)}>{Object.entries(callouts).map(([id,c])=><option key={id} value={id}>{c.label} ({id})</option>)}</select></label><label>제목 (선택)<input value={fields.title} onChange={e=>setField('title',e.target.value)} /></label><p className="muted">선택한 문장을 본문으로 넣습니다. 선택이 없으면 ‘내용’을 삽입합니다.</p></>}
       {panel.kind==='table'&&<div className="assist-two-fields"><label>본문 행 수<input data-assist-focus type="number" min="1" max="30" value={fields.rows} onChange={e=>setField('rows',e.target.value)} /></label><label>열 수<input type="number" min="1" max="12" value={fields.columns} onChange={e=>setField('columns',e.target.value)} /></label></div>}
       {panel.kind==='youtube'&&<label>영상 URL<input data-assist-focus value={fields.url} placeholder="https://youtu.be/…" onChange={e=>setField('url',e.target.value)} /></label>}
       {panel.kind==='code'&&<><label>코드 언어 (선택)<input data-assist-focus value={fields.language} placeholder="예: typescript, python, bash" onChange={e=>setField('language',e.target.value)} /></label><p className="muted">선택한 내용을 코드 블록으로 감쌉니다.</p></>}
       {panel.kind==='dynamic'&&<><label>블록<select data-assist-focus aria-label="사이트 데이터 블록" value={fields.dynamic} onChange={e=>setField('dynamic',e.target.value)}>{assistCommands.filter(c=>dynamicKinds.includes(c.id as any)&&(!c.pageOnly||isPage)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{fields.dynamic==='recent-writing'&&<label>글 개수<input type="number" min="1" value={fields.count} onChange={e=>setField('count',e.target.value)} /></label>}{fields.dynamic==='series-writing'&&<label>시리즈<select aria-label="삽입할 시리즈" value={fields.series} onChange={e=>setField('series',e.target.value)}><option value="">시리즈 선택</option>{series.filter(s=>s.published).map(s=><option key={s.id} value={s.id}>{s.published!.data.name}</option>)}</select></label>}</>}
       {error&&<p role="alert">{error}</p>}
       {!(panel.kind==='link'&&fields.linkMode==='internal')&&<div className="assist-form-actions"><button type="submit" disabled={disabled}>{panel.kind==='image-edit'||panel.link||panel.callout?'적용':'삽입'}</button><button type="button" onClick={finish}>취소</button>{panel.link&&<button type="button" onClick={()=>{try{apply(panel,panel.link!.rawLabel);}catch(e){setError((e as Error).message);}}}>링크 해제</button>}</div>}
     </form>}
   </dialog>
 </>;
});

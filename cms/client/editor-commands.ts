import { EditorSelection, EditorState, StateEffect, StateField, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { callouts, dynamicKinds, imageDirective, type CalloutType } from '../../src/markdown/syntax.ts';
export type Range = { from: number; to: number };
export type Format = 'bold' | 'italic' | 'strike' | 'highlight' | 'inline-code' | 'h2' | 'h3' | 'h4' | 'bullet' | 'numbered' | 'task' | 'quote' | 'code' | 'footnote' | 'math';
export const addTarget = StateEffect.define<{ id: string; range: Range }>();
export const removeTarget = StateEffect.define<string>();
export const editorTargets = StateField.define<Map<string, Range>>({
  create: () => new Map(),
  update(value, tr) {
    const next = new Map([...value].map(([id, r]) => [id, {from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, r.from === r.to ? 1 : -1)}]));
    for (const e of tr.effects) { if (e.is(addTarget)) next.set(e.value.id, e.value.range); if (e.is(removeTarget)) next.delete(e.value); }
    return next;
  },
});
export function edit(from: number, to: number, insert: string, start = insert.length, end = start): TransactionSpec {
  return {changes:{from,to,insert}, selection:EditorSelection.single(from+start,from+end), annotations:isolateHistory.of('full'), userEvent:'input.mory', scrollIntoView:true};
}
export function inCode(state: EditorState, pos = state.selection.main.head) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) { if (/^(FencedCode|CodeBlock|InlineCode)$/.test(node.name)) return true; if (!node.parent) break; node=node.parent; }
  return false;
}
export function blockEdit(state: EditorState, range: Range, text: string, start = text.length, end = start): TransactionSpec {
  const before = state.sliceDoc(0,range.from), after = state.sliceDoc(range.to);
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return edit(range.from,range.to,prefix+text+suffix,prefix.length+start,prefix.length+end);
}
export function format(state: EditorState, id: Format, range: Range = state.selection.main): TransactionSpec {
  const {from,to}=range, selected=state.sliceDoc(from,to);
  if (id === 'footnote') {
    const source=state.doc.toString(), labels=new Set([...source.matchAll(/\[\^([^\]\n]+)\]/g)].map(m=>m[1]));
    let n=1;while(labels.has(String(n)))n++;
    const ref=`[^${n}]`, definition=`${source.endsWith('\n\n')?'':source.endsWith('\n')?'\n':'\n\n'}${ref}: 설명`;
    if(to===state.doc.length) return edit(from,to,selected+ref+definition,selected.length+ref.length+definition.length-2,selected.length+ref.length+definition.length);
    return {changes:[{from,to,insert:selected+ref},{from:state.doc.length,insert:definition}],selection:EditorSelection.single(state.doc.length+ref.length+definition.length-2,state.doc.length+ref.length+definition.length),annotations:isolateHistory.of('full'),userEvent:'input.mory',scrollIntoView:true};
  }
  if(id==='code') {
    const code=codeMarkdown(selected);
    return blockEdit(state,range,code.text,code.start,code.start+selected.length);
  }
  const markers:Partial<Record<Format,string>>={bold:'**',italic:'*',strike:'~~',highlight:'==',math:'$'};
  let marker=markers[id];
  if(id==='inline-code')marker='`'.repeat(Math.max(1,...[...selected.matchAll(/`+/g)].map(m=>m[0].length+1)));
  if(marker) {
    if(selected.length>=marker.length*2&&selected.startsWith(marker)&&selected.endsWith(marker))return edit(from,to,selected.slice(marker.length,-marker.length),0,selected.length-marker.length*2);
    if(from>=marker.length&&state.sliceDoc(from-marker.length,from)===marker&&state.sliceDoc(to,to+marker.length)===marker)return edit(from-marker.length,to+marker.length,selected,0,selected.length);
    const pad=id==='inline-code' && /^`|`$/.test(selected)?' ':'';
    return edit(from,to,marker+pad+selected+pad+marker,marker.length+pad.length,marker.length+pad.length+selected.length);
  }
  const first=state.doc.lineAt(from), last=state.doc.lineAt(to>from&&state.doc.lineAt(to).from===to?to-1:to);
  const lines=state.sliceDoc(first.from,last.to).split('\n');
  const patterns:Partial<Record<Format,RegExp>>={h2:/^##\s+/,h3:/^###\s+/,h4:/^####\s+/,bullet:/^[-+*]\s+(?!\[[ xX]\]\s)/,numbered:/^\d+[.)]\s+/,task:/^[-+*]\s+\[[ xX]\]\s+/,quote:/^> ?/};
  const pattern=patterns[id]!;
  const strip=lines.every(l=>pattern.test(l.trimStart()));
  const result=lines.map((line,index)=>{
    const indent=/^\s*/.exec(line)![0], raw=line.slice(indent.length);
    if(strip)return indent+raw.replace(pattern,'');
    const clean=id.startsWith('h')?raw.replace(/^#{1,6}\s+/,''):['bullet','numbered','task'].includes(id)?raw.replace(/^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,''):raw;
    const prefix=id==='h2'?'## ':id==='h3'?'### ':id==='h4'?'#### ':id==='bullet'?'- ':id==='numbered'?`${index+1}. `:id==='task'?'- [ ] ': '> ';
    return indent+prefix+clean;
  }).join('\n');
  // Map the cursor/selection through the line rewrite instead of moving it to document end.
  const changes=state.changes({from:first.from,to:last.to,insert:result});
  const lineLength=result.split('\n')[0].length;
  const cursor=first.from+Math.max(0,Math.min(lineLength,from-first.from+lineLength-first.length));
  return {changes,selection:from===to?EditorSelection.cursor(cursor):EditorSelection.range(first.from,first.from+result.length),annotations:isolateHistory.of('full'),userEvent:'input.mory',scrollIntoView:true};
}
export function markdownLink(label: string, url: string) {
  url=url.trim();
  if(!url.trim()||/[\r\n<>]/.test(url)||/^(?!https?:|mailto:)[a-z][a-z0-9+.-]*:/i.test(url))throw new Error('https 주소 또는 사이트 내부 경로를 입력해 주세요.');
  return `[${label.replace(/([\\\[\]])/g,'\\$1')}](${url.replace(/ /g,'%20').replace(/[()]/g,c=>c==='('? '%28':'%29')})`;
}
export function smartPasteLink(editor:{state:EditorState;composing:boolean},text:string,plain=false):string|null {
  const range=editor.state.selection.main,label=editor.state.sliceDoc(range.from,range.to),url=text.trim();
  if(!canEdit(editor,false)||plain||range.empty||label.includes('\n')||inCode(editor.state)||!/^https?:\/\/\S+$/.test(url))return null;
  try{return markdownLink(label,url);}catch{return null;}
}
export function wikiLink(slug:string,label:string) {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('글 주소가 아직 없거나 올바르지 않습니다. 글의 게시 설정에서 주소를 정해 주세요.');
  if(/[|\]\n]/.test(label))throw new Error('링크 표시 이름에는 |, ] 또는 줄바꿈을 넣을 수 없습니다.');
  return `[[${slug}${label?'|'+label:''}]]`;
}
export interface LinkContext extends Range { kind:'markdown'|'wiki'; label:string; rawLabel:string; url:string; title:string }
export function linkContext(state:EditorState):LinkContext|null {
  if(inCode(state))return null;
  const pos=state.selection.main.head,line=state.doc.lineAt(pos);
  for(const match of line.text.matchAll(/(?<!!)\[\[([^|\]\n]+)(?:\|([^\]\n]*))?\]\]/g)) {
    const from=line.from+match.index!;
    if(state.selection.main.from>=from&&state.selection.main.to<=from+match[0].length)return {from,to:from+match[0].length,kind:'wiki',label:match[2]??'',rawLabel:match[2]??match[1],url:match[1],title:''};
  }
  let node=syntaxTree(state).resolveInner(pos,-1);
  while(node&&node.name!=='Link'){if(!node.parent)return null;node=node.parent;}
  if(!node)return null;
  const url=node.getChild('URL'),title=node.getChild('LinkTitle'),marks=node.getChildren('LinkMark');
  if(!url||marks.length<4||state.selection.main.from<node.from||state.selection.main.to>node.to||(node.from>0&&state.sliceDoc(node.from-1,node.from)==='!'))return null;
  const rawLabel=state.sliceDoc(marks[0].to,marks[1].from);
  return {from:node.from,to:node.to,kind:'markdown',label:rawLabel.replace(/\\([\\\[\]])/g,'$1'),rawLabel,url:state.sliceDoc(url.from,url.to).replace(/^<|>$/g,'').replace(/\\([\\()[\]])/g,'$1'),title:title?state.sliceDoc(title.from,title.to):''};
}
export function updateLink(link:LinkContext,label:string,url:string) {
  if(link.kind==='wiki')return wikiLink(url.trim(),label);
  const rendered=markdownLink(label,url);
  return link.title?rendered.slice(0,-1)+' '+link.title+')':rendered;
}
export const commandGroups=['서식','목록과 인용','링크와 미디어','삽입 도구','사이트 데이터','이동'] as const;
export function commandGroup(command:AssistCommand):typeof commandGroups[number] {
  if(dynamicKinds.includes(command.id as any))return '사이트 데이터';
  if(['bullet','numbered','task','quote','callout'].includes(command.id))return '목록과 인용';
  if(['link','image','image-edit','youtube'].includes(command.id))return '링크와 미디어';
  if(['table','footnote','code','math'].includes(command.id))return '삽입 도구';
  return command.id==='outline'?'이동':'서식';
}
export function calloutMarkdown(type: CalloutType,title:string,body:string) {
  if(!Object.hasOwn(callouts,type))throw new Error('지원하지 않는 콜아웃입니다.');
  if(/[\r\n]/.test(title))throw new Error('콜아웃 제목은 한 줄로 입력해 주세요.');
  return `> [!${type}]${title.trim()?' '+title.trim():''}\n${(body||'내용').split('\n').map(l=>'> '+l).join('\n')}`;
}
export function tableMarkdown(rows:number,columns:number) {
  if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||rows>30||columns<1||columns>12)throw new Error('본문 행은 1~30개, 열은 1~12개로 입력해 주세요.');
  const line=(cells:string[])=>'| '+cells.join(' | ')+' |';
  return [line(Array.from({length:columns},(_,i)=>`열 ${i+1}`)),line(Array(columns).fill('---')),...Array.from({length:rows},()=>line(Array(columns).fill(' ')))].join('\n');
}
export function dynamicMarkdown(kind: string,count:number,seriesId:string,isPage:boolean) {
  if(!dynamicKinds.includes(kind as any)||(!isPage&&kind!=='series-writing'))throw new Error('이 블록은 Home/About에서만 사용할 수 있습니다.');
  if(kind==='recent-writing') {if(!Number.isSafeInteger(count)||count<1)throw new Error('글 개수는 양의 정수로 입력해 주세요.');return `::recent-writing{count=${count}}`;}
  if(kind==='series-writing') {if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(seriesId))throw new Error('게시된 시리즈를 선택해 주세요.');return `::series-writing{id=${seriesId}}`;}
  return `::${kind}`;
}
export interface ImageContext extends Range { filename:string; width:string; alt:string; caption:string; source:string }
export function imageContext(state: EditorState): ImageContext | null {
  if(inCode(state))return null;
  let line=state.doc.lineAt(state.selection.main.head);
  try {
    while(imageDirective(line.text.trim())&&line.number>1)line=state.doc.line(line.number-1);
    const match=/^!\[\[([^|\]\n]+\.(?:png|jpe?g|webp|gif|avif|svg))(?:\|([1-9]\d*))?\]\]$/i.exec(line.text.trim());
    if(!match)return null;
    let to=line.to, alt='',caption='';const seen=new Set<string>();
    for(let n=line.number+1;n<=state.doc.lines;n++){const next=state.doc.line(n), d=imageDirective(next.text.trim());if(!d)break;if(seen.has(d.kind))return null;seen.add(d.kind);if(d.kind==='alt')alt=d.value;else caption=d.value;to=next.to;}
    return {from:line.from,to,filename:match[1],width:match[2]??'',alt,caption,source:state.sliceDoc(line.from,to)};
  }catch{return null;}
}
export function imageMarkdown(image:Pick<ImageContext,'filename'|'width'|'alt'|'caption'>) {
  if(image.width&&!/^[1-9]\d*$/.test(image.width))throw new Error('너비는 양의 정수로 입력하거나 원본을 선택해 주세요.');
  for(const kind of ['alt','caption'] as const){if(/[\r\n]/.test(image[kind]))throw new Error('이미지 설명은 한 줄로 입력해 주세요.');if(image[kind])imageDirective(`::${kind}[${image[kind]}]`);}
  return `![[${image.filename}${image.width?'|'+image.width:''}]]${image.alt?'\n::alt['+image.alt+']':''}${image.caption?'\n::caption['+image.caption+']':''}`;
}
export function outline(state:EditorState) {
  const headings:{from:number;level:number;title:string}[]=[];
  (ensureSyntaxTree(state,state.doc.length,100)??syntaxTree(state)).iterate({enter(node){if(/^ATXHeading[234]$/.test(node.name)){const line=state.doc.lineAt(node.from),m=/^(#{2,4})\s+(.+?)(?:\s+#+)?$/.exec(line.text);if(m)headings.push({from:node.from,level:m[1].length,title:m[2]});}}});
  return headings;
}
export interface AssistCommand {id:string;name:string;keywords:string;format?:Format;pageOnly?:boolean}
export const assistCommands:AssistCommand[]=[
 {id:'h2',name:'소제목 H2',keywords:'heading 제목',format:'h2'}, {id:'h3',name:'소제목 H3',keywords:'heading 제목',format:'h3'}, {id:'h4',name:'소제목 H4',keywords:'heading 제목',format:'h4'},
 {id:'bold',name:'굵게',keywords:'bold',format:'bold'},{id:'italic',name:'기울임',keywords:'italic',format:'italic'},{id:'strike',name:'취소선',keywords:'strike',format:'strike'},{id:'highlight',name:'강조',keywords:'highlight',format:'highlight'},
 {id:'link',name:'링크 · 내부 글',keywords:'link wikilink'}, {id:'image',name:'이미지 업로드',keywords:'image 사진'}, {id:'image-edit',name:'이미지 설명 편집',keywords:'image alt caption 너비'},
 {id:'code',name:'코드 블록',keywords:'code',format:'code'},{id:'inline-code',name:'인라인 코드',keywords:'code',format:'inline-code'},
 {id:'quote',name:'인용',keywords:'quote',format:'quote'}, {id:'bullet',name:'글머리 목록',keywords:'bullet list',format:'bullet'}, {id:'numbered',name:'번호 목록',keywords:'numbered list',format:'numbered'}, {id:'task',name:'체크 목록',keywords:'task list',format:'task'},
 {id:'footnote',name:'각주',keywords:'footnote',format:'footnote'}, {id:'callout',name:'콜아웃',keywords:'callout 참고 주의'}, {id:'table',name:'표',keywords:'table'}, {id:'youtube',name:'YouTube 영상',keywords:'youtube 영상'}, {id:'math',name:'인라인 수식',keywords:'math 수식',format:'math'},
 {id:'recent-writing',name:'최근 글',keywords:'recent writing',pageOnly:true}, {id:'category-list',name:'분류 목록',keywords:'category list',pageOnly:true}, {id:'series-list',name:'시리즈 목록',keywords:'series list',pageOnly:true}, {id:'writing-search',name:'글 검색',keywords:'writing search',pageOnly:true}, {id:'writing-list',name:'전체 글 목록',keywords:'writing list',pageOnly:true}, {id:'series-writing',name:'시리즈 글 목록',keywords:'series writing'}, {id:'outline',name:'본문 목차 이동',keywords:'outline 목차'},
];
export function filterCommands(query:string,isPage:boolean) {
 const q=query.trim().toLowerCase();
 const score=(c:AssistCommand)=>c.id===q?0:c.id.startsWith(q)?1:`${c.name} ${c.keywords}`.toLowerCase().split(/\s+/).some(word=>word.startsWith(q))?2:3;
 return assistCommands.filter(c=>(!c.pageOnly||isPage)&&`${c.id} ${c.name} ${c.keywords}`.toLowerCase().includes(q)).sort((a,b)=>score(a)-score(b));
}
export function nextCommandIndex(current:number,direction:-1|1,total:number) { return total?((current+direction)%total+total)%total:0; }

export function slashContext(state:EditorState):{from:number;to:number;query:string}|null {
 if(!state.selection.main.empty||inCode(state))return null;
 const line=state.doc.lineAt(state.selection.main.head),text=state.sliceDoc(line.from,state.selection.main.head),match=/^\/(\S*)$/.exec(text);
 return match && state.selection.main.head===line.to ? {from:line.from,to:line.to,query:match[1]}:null;
}

export interface CalloutContext extends Range { type:CalloutType; title:string; body:string }
export function calloutContext(state:EditorState):CalloutContext|null {
 if(inCode(state))return null;
 let first=state.doc.lineAt(state.selection.main.head);
 if(!/^>/.test(first.text))return null;
 while(first.number>1&&/^>/.test(state.doc.line(first.number-1).text)&&!/^> \[!/.test(first.text))first=state.doc.line(first.number-1);
 const marker=/^> \[!(note|tip|important|warning)\](?:[ \t]+([^\n]*))?$/i.exec(first.text);
 if(!marker)return null;
 let last=first;const body:string[]=[];
 for(let n=first.number+1;n<=state.doc.lines;n++){const line=state.doc.line(n);if(!/^>/.test(line.text)||/^> \[!/.test(line.text))break;body.push(line.text.replace(/^> ?/,''));last=line;}
 return {from:first.from,to:last.to,type:marker[1].toLowerCase() as CalloutType,title:marker[2]??'',body:body.join('\n')};
}
export function codeMarkdown(body:string,language='') {
 if(!/^[a-zA-Z0-9_+-]*$/.test(language))throw new Error('코드 언어에는 영문·숫자·하이픈을 사용해 주세요.');
 const fence='`'.repeat(Math.max(3,...[...body.matchAll(/`+/g)].map(m=>m[0].length+1)));
 return {text:`${fence}${language}\n${body}\n${fence}`,start:fence.length+language.length+1};
}
export function canEdit(editor:{composing:boolean;state:EditorState},disabled:boolean) { return !disabled&&!editor.composing&&!editor.state.readOnly; }

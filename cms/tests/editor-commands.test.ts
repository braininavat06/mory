import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { history, undo, redo } from '@codemirror/commands';
import { format, markdownLink, wikiLink, calloutMarkdown, tableMarkdown, dynamicMarkdown, imageContext, imageMarkdown, filterCommands, slashContext, outline, editorTargets, addTarget, removeTarget, type Format, codeMarkdown, calloutContext, canEdit, nextCommandIndex, smartPasteLink, linkContext, updateLink, edit, commandGroups, commandGroup } from '../client/editor-commands.ts';
const state=(doc:string,from=0,to=doc.length)=>EditorState.create({doc,selection:EditorSelection.single(from,to),extensions:[markdown(),history(),editorTargets]});
const apply=(doc:string,id:Format,from=0,to=doc.length)=>state(doc,from,to).update(format(state(doc,from,to),id)).state;
for(const [command,marker] of [['bold','**'],['italic','*'],['strike','~~'],['highlight','=='],['inline-code','`'],['math','$']] as const) {
 test(`${command} wraps and toggles selected Korean text`,()=>{const s=apply('선택한 문장',command);assert.equal(s.doc.toString(),`${marker}선택한 문장${marker}`);assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'선택한 문장');assert.equal(s.update(format(s,command)).state.doc.toString(),'선택한 문장');});
}
test('empty bold puts cursor between markers',()=>{const s=apply('앞뒤','bold',1,1);assert.equal(s.doc.toString(),'앞****뒤');assert.equal(s.selection.main.head,3);assert.equal(s.update(format(s,'bold')).state.doc.toString(),'앞뒤');});
test('heading converts line and toggles without touching adjacent lines',()=>{let s=apply('앞\n### 제목\n뒤','h2',7,7);assert.equal(s.doc.toString(),'앞\n## 제목\n뒤');s=s.update(format(s,'h2')).state;assert.equal(s.doc.toString(),'앞\n제목\n뒤');});
for(const [command,result] of [['bullet','- A\n- B\n- C'],['numbered','1. A\n2. B\n3. C'],['task','- [ ] A\n- [ ] B\n- [ ] C'],['quote','> A\n> B\n> C']] as const) test(`${command} transforms multiline and toggles`,()=>{const s=apply('A\nB\nC',command);assert.equal(s.doc.toString(),result);assert.equal(s.update(format(s,command)).state.doc.toString(),'A\nB\nC');});
test('line selection ending at next line start excludes that line; list conversion preserves indent',()=>{assert.equal(apply('A\nB','bullet',0,2).doc.toString(),'- A\nB');assert.equal(apply('  - [x] A\n  - [ ] B','numbered').doc.toString(),'  1. A\n  2. B');});
test('code fences are safe around nested backticks; inline code handles embedded tick',()=>{assert.equal(apply('```js\ncode\n```','code').doc.toString(),'````\n```js\ncode\n```\n````');assert.equal(apply('a`b','inline-code').doc.toString(),'``a`b``');});
test('links escape labels and URL delimiters; unsafe schemes rejected',()=>{assert.equal(markdownLink('선택 [텍스트]','https://example.com/a(b)'), '[선택 \\[텍스트\\]](https://example.com/a%28b%29)');assert.equal(markdownLink('소개','/about/#hi'),'[소개](/about/#hi)');assert.throws(()=>markdownLink('x','javascript:alert(1)'),/주소/);});
test('internal picker emits existing wikilink, refusing missing slug or invalid label',()=>{assert.equal(wikiLink('valid-post','표시 이름'),'[[valid-post|표시 이름]]');assert.throws(()=>wikiLink('','a'),/주소/);assert.throws(()=>wikiLink('slug','a|b'),/표시 이름/);});
test('callouts use only shared renderer types and preserve multiline selection',()=>{assert.equal(calloutMarkdown('warning','주의','A\nB'),'> [!warning] 주의\n> A\n> B');assert.throws(()=>calloutMarkdown('danger' as any,'',''),/지원/);});
test('footnote finds safe numeric label and puts cursor in definition',()=>{const doc='문장[^1]\n\n[^1]: 기존\n\n[^3]: 셋';const s=apply(doc,'footnote',2,2);assert.match(s.doc.toString(),/문장\[\^2\]\[\^1\]/);assert.match(s.doc.toString(),/\[\^2\]: 설명$/);assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),'설명');});
test('image inspector shares balanced caption parsing and canonical directive order',()=>{const doc='앞\n\n![[foo.jpg|600]]\n::caption[**캡션** [링크](https://example.com)]\n::alt[설명]\n\n뒤';const context=imageContext(state(doc,doc.indexOf('설명'),doc.indexOf('설명')))!;assert.equal(context.filename,'foo.jpg');assert.equal(context.width,'600');assert.equal(imageMarkdown({...context,width:'900'}),'![[foo.jpg|900]]\n::alt[설명]\n::caption[**캡션** [링크](https://example.com)]');assert.equal(imageMarkdown({...context,width:'',alt:'',caption:''}),'![[foo.jpg]]');assert.throws(()=>imageMarkdown({...context,width:'0'}),/너비/);assert.throws(()=>imageMarkdown({...context,caption:'[깨짐'}),/대괄호/);});
test('image context excludes code, video, unrelated text and blank-separated metadata',()=>{for(const [doc,pos] of [['```\n![[a.jpg]]\n```',10],['![[a.mp4]]',3],['앞 문장',1],['![[a.jpg]]\n\n::caption[설명]',22]] as const)assert.equal(imageContext(state(doc,pos,pos)),null);});
test('table helper makes valid GFM and enforces small limits',()=>{assert.equal(tableMarkdown(1,2),'| 열 1 | 열 2 |\n| --- | --- |\n|   |   |');assert.throws(()=>tableMarkdown(100,2),/행/);});
test('dynamic helper exposes exact existing options and page restrictions',()=>{assert.equal(dynamicMarkdown('recent-writing',5,'',true),'::recent-writing{count=5}');assert.equal(dynamicMarkdown('series-writing',5,'ai-coding',false),'::series-writing{id=ai-coding}');assert.equal(dynamicMarkdown('category-list',5,'',true),'::category-list');assert.throws(()=>dynamicMarkdown('writing-list',5,'',false),/Home/);});
test('slash filtering supports aliases, hides page-only actions for posts and ignores URL/code',()=>{assert.ok(filterCommands('im',false).some(c=>c.id==='image'));assert.ok(!filterCommands('',false).some(c=>c.id==='category-list'));assert.ok(filterCommands('',true).some(c=>c.id==='writing-search'));assert.deepEqual(slashContext(state('/im',3,3)),{from:0,to:3,query:'im'});assert.equal(slashContext(state('https://x/',10,10)),null);assert.equal(slashContext(state('```\n/im\n```',7,7)),null);});
test('outline uses incremental CM headings and ignores fenced headings',()=>{assert.deepEqual(outline(state('## A\n\n### B\n\n```\n## code\n```')).map(h=>h.title),['A','B']);});
test('dialog target mapping tracks edits outside selection, allowing conflicts inside to be detected',()=>{let s=state('avant 선택 after',6,8);s=s.update({effects:addTarget.of({id:'dialog',range:{from:6,to:8}})}).state;s=s.update({changes:{from:0,insert:'new '}}).state;const range=s.field(editorTargets).get('dialog')!;assert.equal(s.sliceDoc(range.from,range.to),'선택');s=s.update({changes:{from:range.from,to:range.to,insert:'다름'}}).state;const changed=s.field(editorTargets).get('dialog')!;assert.notEqual(s.sliceDoc(changed.from,changed.to),'선택');s=s.update({effects:removeTarget.of('dialog')}).state;assert.equal(s.field(editorTargets).size,0);});
test('command is one undo unit with restored selection and redo',()=>{let s=state('선택',0,2);const before=s.selection.main;s=s.update(format(s,'bold')).state;const target={get state(){return s;},dispatch(tr:any){s=tr.state;}};assert.equal(undo(target),true);assert.equal(s.doc.toString(),'선택');assert.equal(s.selection.main.anchor,before.anchor);assert.equal(s.selection.main.head,before.head);assert.equal(redo(target),true);assert.equal(s.doc.toString(),'**선택**');});

test('existing callout context preserves its body when changing type/title',()=>{const doc='앞\n\n> [!note] 기존 제목\n> 첫 줄\n> 둘째 줄\n\n뒤',s=state(doc,doc.indexOf('둘째'),doc.indexOf('둘째'));const context=calloutContext(s)!;assert.equal(context.type,'note');assert.equal(context.title,'기존 제목');assert.equal(calloutMarkdown('tip',context.title,context.body),'> [!tip] 기존 제목\n> 첫 줄\n> 둘째 줄');});
test('composition and publication locks refuse commands without editing state',()=>{const s=state('한글');assert.equal(canEdit({state:s,composing:true},false),false);assert.equal(canEdit({state:s,composing:false},true),false);assert.equal(canEdit({state:EditorState.create({doc:'한글',extensions:EditorState.readOnly.of(true)}),composing:false},false),false);assert.equal(canEdit({state:s,composing:false},false),true);});
test('code helper uses source syntax with chosen language and prevents fence escape',()=>{assert.equal(codeMarkdown('console.log(1)','javascript').text,'```javascript\nconsole.log(1)\n```');assert.throws(()=>codeMarkdown('x','js\n<script>'),/언어/);});

test('slash navigation wraps, empty results are safe and prefix commands outrank substring matches',()=>{assert.equal(nextCommandIndex(0,-1,3),2);assert.equal(nextCommandIndex(2,1,3),0);assert.equal(nextCommandIndex(0,1,0),0);assert.equal(filterCommands('ta',false)[0].id,'task');assert.equal(filterCommands('table',false)[0].id,'table');});
test('URL smart paste preserves plain paste, multiline, code and composition input',()=>{
 const editor={state:state('선택'),composing:false};assert.equal(smartPasteLink(editor,' https://example.com '),'[선택](https://example.com)');
 assert.equal(smartPasteLink(editor,'https://example.com',true),null);assert.equal(smartPasteLink({...editor,composing:true},'https://example.com'),null);
 assert.equal(smartPasteLink({state:state('A\nB'),composing:false},'https://example.com'),null);
 assert.equal(smartPasteLink({state:state('```\ncode\n```',4,8),composing:false},'https://example.com'),null);
 assert.equal(smartPasteLink(editor,'plain text'),null);assert.equal(smartPasteLink(editor,'javascript:alert(1)'),null);
});

test('heading and list commands preserve the cursor inside the original text',()=>{
 let s=state('긴 제목의 중간',4,4);s=s.update(format(s,'h2')).state;assert.equal(s.selection.main.head,7);s=s.update(format(s,'h2')).state;assert.equal(s.selection.main.head,4);
 s=s.update(format(s,'bullet')).state;assert.equal(s.selection.main.head,6);
});
test('existing Markdown links edit without nesting and preserve optional title and undo',()=>{
 const doc='앞 [표시 \\[이름\\]](https://example.com "제목") 뒤',s=state(doc,8,8),link=linkContext(s)!;
 assert.equal(link.label,'표시 [이름]');assert.equal(link.url,'https://example.com');assert.equal(link.title,'"제목"');
 const next=s.update(edit(link.from,link.to,updateLink(link,'새 표시','/about/'))).state;
 assert.equal(next.doc.toString(),'앞 [새 표시](/about/ "제목") 뒤');
 assert.equal(linkContext(state('```\n[a](https://x)\n```',7,7)),null);
 assert.equal(linkContext(state('![a](https://x)',3,3)),null);
 const escaped=linkContext(state('[a](https://example.com/a\\(b\\))',1,1))!;
 assert.equal(escaped.url,'https://example.com/a(b)');assert.equal(updateLink(escaped,'b',escaped.url),'[b](https://example.com/a%28b%29)');
});
test('wikilink context preserves the supported syntax and skips image embeds',()=>{
 const doc='앞 [[some-post|표시]] 뒤',link=linkContext(state(doc,8,8))!;assert.equal(link.kind,'wiki');assert.equal(updateLink(link,'새 제목','another-post'),'[[another-post|새 제목]]');
 assert.equal(linkContext(state('![[foo.jpg]]',5,5)),null);
 assert.equal(linkContext(state(doc,0,doc.length)),null);
});
test('every searchable command belongs to a visible tool group',()=>{for(const command of filterCommands('',true))assert.ok(commandGroups.includes(commandGroup(command)));});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { syncEditorSelection } from '../client/editor-selection.ts';
import { format } from '../client/editor-commands.ts';

function fixture(anchor=0,head=6) {
 const node={},outside={};let s=EditorState.create({doc:'복사할 문장 다른 문장',selection:EditorSelection.cursor(12),extensions:history()});
 const native={anchorNode:node,focusNode:node,anchorOffset:anchor,focusOffset:head};let transactions=0;
 const editor={get state(){return s;},composing:false,root:{getSelection:()=>native},contentDOM:{contains:(n:unknown)=>n===node,ownerDocument:{getSelection:()=>native}},posAtDOM:(_n:unknown,offset:number)=>offset,dispatch:(spec:TransactionSpec)=>{transactions++;s=s.update(spec).state;}};
 return {editor:editor as any,native,outside,get state(){return s;},get transactions(){return transactions;}};
}
test('native selection is read before copy/formatting without modifying source',()=>{
 const f=fixture();assert.equal(syncEditorSelection(f.editor),true);assert.equal(f.state.sliceDoc(f.state.selection.main.from,f.state.selection.main.to),'복사할 문장');
 f.editor.dispatch(format(f.state,'bold'));assert.equal(f.state.doc.toString(),'**복사할 문장** 다른 문장');
 const target={get state(){return f.state;},dispatch:(tr:any)=>f.editor.dispatch(tr)};assert.equal(undo(target),true);assert.equal(f.state.doc.toString(),'복사할 문장 다른 문장');assert.equal(f.state.selection.main.from,0);assert.equal(f.state.selection.main.to,6);
});
test('backward native selection retains its direction and collapsed cursor can update',()=>{
 const f=fixture(6,0);syncEditorSelection(f.editor);assert.equal(f.state.selection.main.anchor,6);assert.equal(f.state.selection.main.head,0);
 f.native.anchorOffset=3;f.native.focusOffset=3;syncEditorSelection(f.editor);assert.equal(f.state.selection.main.head,3);
});
test('unchanged native selection does not repeatedly dispatch or add history',()=>{
 const f=fixture();syncEditorSelection(f.editor);assert.equal(syncEditorSelection(f.editor),false);assert.equal(f.transactions,1);
 const target={get state(){return f.state;},dispatch:(tr:any)=>f.editor.dispatch(tr)};assert.equal(undo(target),false);
});
test('dialog/page selections, composition and multiple CM selections remain untouched',()=>{
 const f=fixture();f.native.focusNode=f.outside;assert.equal(syncEditorSelection(f.editor),false);f.native.focusNode=f.native.anchorNode;
 f.editor.composing=true;assert.equal(syncEditorSelection(f.editor),false);f.editor.composing=false;
 f.editor.dispatch({selection:EditorSelection.create([EditorSelection.range(0,2),EditorSelection.range(4,6)]),effects:[],});
 // Separate configuration enables multiple ranges for rectangular/native CM selection.
 const multi=EditorState.create({doc:f.state.doc,selection:EditorSelection.create([EditorSelection.range(0,2),EditorSelection.range(4,6)]),extensions:EditorState.allowMultipleSelections.of(true)});
 assert.equal(syncEditorSelection({...f.editor,state:multi}),false);
});
test('detached/unmappable DOM nodes fail safely',()=>{
 const f=fixture();assert.equal(syncEditorSelection({...f.editor,posAtDOM:()=>{throw new Error('detached');}}),false);assert.equal(f.transactions,0);
});

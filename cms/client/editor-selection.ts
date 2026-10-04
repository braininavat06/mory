import { EditorSelection, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type SelectionView = Pick<EditorView, 'state' | 'composing' | 'contentDOM' | 'root' | 'posAtDOM' | 'dispatch'>;

// Native touch handles and the clipboard can fire before CM's selection observer.
// Only import a selection wholly inside this editor; dialog/page selections stay separate.
export function syncEditorSelection(editor: SelectionView): boolean {
  if (editor.composing || editor.state.selection.ranges.length > 1) return false;
  const native = (editor.root as Document).getSelection?.() ?? editor.contentDOM.ownerDocument.getSelection();
  if (!native?.anchorNode || !native.focusNode || !editor.contentDOM.contains(native.anchorNode) || !editor.contentDOM.contains(native.focusNode)) return false;
  try {
    const selection = EditorSelection.single(editor.posAtDOM(native.anchorNode, native.anchorOffset), editor.posAtDOM(native.focusNode, native.focusOffset));
    if (selection.eq(editor.state.selection)) return false;
    editor.dispatch({ selection, annotations: Transaction.addToHistory.of(false), userEvent: 'select.pointer' });
    return true;
  } catch { return false; }
}

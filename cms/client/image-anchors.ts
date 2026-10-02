import { StateField, StateEffect } from "@codemirror/state";
export const addImageAnchor = StateEffect.define<{ id: string; pos: number }>({
  map: (value, changes) => ({ ...value, pos: changes.mapPos(value.pos, 1) }),
});
export const removeImageAnchor = StateEffect.define<string>();
export const imageAnchors = StateField.define<Map<string, number>>({
  create: () => new Map(),
  update(value, tr) {
    const next = new Map(
      [...value].map(([id, pos]) => [id, tr.changes.mapPos(pos, 1)]),
    );
    for (const effect of tr.effects) {
      if (effect.is(addImageAnchor))
        next.set(effect.value.id, effect.value.pos);
      if (effect.is(removeImageAnchor)) next.delete(effect.value);
    }
    return next;
  },
});

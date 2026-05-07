---
"slate-react": patch
---

Rename React annotation and void helper props for clearer v2 authoring.

**Migration:**

- Use `<Slate annotationStore={store}>` instead of `annotationStores={[store]}`.
- Use `useSlateAnnotations()` and `useSlateAnnotation(id)` inside `Slate` when reading the provider store.
- Use `renderVoid={({ element, path }) => ...}` instead of `target` for void paths.

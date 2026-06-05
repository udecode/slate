# Docs Proof Map

This page maps the public docs to the source contracts that keep them honest.
Use it when a guide, concept page, or API page makes a runtime claim. The proof
source should be code, tests, or a browser contract row.

## Source Ledger

| Docs claim | Public docs | Source proof |
| --- | --- | --- |
| Editors are created with `createEditor`, read through `editor.read`, and written through `editor.update`. | `walkthroughs/01-installing-slate.md`, `concepts/07-editor.md` | `packages/slate/test/read-update-contract.ts`, `packages/slate/test/write-boundary-contract.ts`, `packages/slate/src/interfaces/editor.ts` |
| Transaction helpers live on the `tx` object inside `editor.update`. | `walkthroughs/04-applying-custom-formatting.md`, `walkthroughs/05-executing-commands.md`, `concepts/07-editor.md` | `packages/slate/test/read-update-contract.ts`, `packages/slate/test/transforms-contract.ts`, `packages/slate/src/interfaces/editor.ts` |
| Extension helpers are grouped under `state` and `tx`, not added as adapter namespaces on the editor object. | `concepts/08-plugins.md`, `walkthroughs/07-enabling-collaborative-editing.md` | `packages/slate/test/extension-namespaces-contract.ts`, `packages/slate/test/editor-foundation-contract.ts`, `packages/slate/src/core/editor-extension.ts` |
| React and history setup use `createReactEditor`, `react()`, and `history()` instead of mutating plugin wrappers. | `libraries/slate-react/with-react.md`, `libraries/slate-history/with-history.md`, `libraries/slate-history/history-editor.md` | `packages/slate-react/src/plugin/with-react.ts`, `packages/slate-history/src/index.ts`, `packages/slate-react/test/generic-react-editor-contract.tsx` |
| Debug value scrubbing uses `setDebugValueScrubber` before default text redaction. | `api/scrubber.md` | `packages/slate/src/utils/format-debug-value.ts`, `packages/slate/test/format-debug-value-contract.ts` |
| Schema behavior describes inline, void, selectable, and markable void nodes. | `api/nodes/editor.md`, `api/nodes/element.md`, `concepts/08-plugins.md` | `packages/slate/test/extension-contract.ts`, `packages/slate/test/editor-foundation-contract.ts`, `packages/slate/src/interfaces/editor.ts` |
| Slate React owns void shells, hidden anchors, editable roots, and DOM repair. App void renderers return visible content. | `api/nodes/element.md`, `libraries/slate-react/editable.md` | `packages/slate-react/src/components/slate-void-shell.tsx`, `packages/slate-react/test/shell-runtime-contract.test.tsx`, `packages/slate-react/test/rendered-dom-shape-contract.test.tsx` |
| Element selection UI is target-scoped instead of subscribed through the whole editor. | `api/nodes/element.md`, `concepts/09-rendering.md`, `libraries/slate-react/editable.md` | `packages/slate-react/src/hooks/use-editor-selection.tsx`, `packages/slate-react/src/components/editable-text-blocks.tsx`, `packages/slate-react/test/projections-and-selection-contract.test.tsx` |
| Slate React root exports teach only first-class v2 hook names and keep old hook names out of the public root. | `libraries/slate-react/hooks.md`, `libraries/slate-react/react-editor.md` | `packages/slate-react/src/index.ts`, `packages/slate-react/test/generic-react-editor-contract.tsx`, `packages/slate-react/test/surface-contract.tsx` |
| Decorations and annotations use projection stores and source-scoped subscriptions. | `libraries/slate-react/slate.md`, `libraries/slate-react/annotations.md`, `libraries/slate-react/editable.md`, `concepts/09-rendering.md` | `packages/slate-react/src/decoration-source.ts`, `packages/slate-react/src/annotation-store.ts`, `packages/slate-react/test/annotation-store-contract.test.tsx` |
| Collaboration adapters export commit operations and import remote operations through explicit replay. | `walkthroughs/07-enabling-collaborative-editing.md` | `packages/slate/test/collab-history-runtime-contract.ts`, `packages/slate/test/commit-metadata-contract.ts`, `packages/slate/test/editor-foundation-contract.ts` |
| Full document persistence uses `state.value.get()` so saved values include roots and persistent state fields. | `walkthroughs/06-saving-to-a-database.md`, `concepts/14-document-state.md`, `api/nodes/editor.md`, `libraries/slate-react/slate.md` | `packages/slate/src/interfaces/editor.ts`, `packages/slate/src/core/public-state.ts`, `packages/slate/test/document-state-contract.ts`, `packages/slate/test/document-state-patch-contract.ts`, `site/examples/ts/document-state.tsx` |
| Runtime ids are local projection handles, not persistence ids. | `walkthroughs/07-enabling-collaborative-editing.md`, `libraries/slate-react/editable.md` | `packages/slate/test/collab-history-runtime-contract.ts`, `packages/slate/test/editor-foundation-contract.ts`, `packages/slate-react/test/runtime-live-state-contract.ts` |
| DOM strategy mounts stable projection segments and keeps React off hot editor paths. | `walkthroughs/09-performance.md`, `libraries/slate-react/editable.md`, `concepts/09-rendering.md` | `packages/slate-react/src/dom-strategy`, `packages/slate-react/test/render-profiler-contract.test.tsx`, `playwright/integration/examples/huge-document.test.ts` |
| Document roots keep one editor runtime across `main`, named roots, content roots, and rooted operations. | `concepts/13-roots.md`, `api/nodes/editor.md`, `api/locations/point.md`, `api/operations/operation.md` | `packages/slate/src/interfaces/editor.ts`, `packages/slate/test/rooted-operation-contract.ts`, `packages/slate-react/test/content-root-navigation-contract.test.ts`, `site/examples/ts/multi-root-document.tsx`, `site/examples/ts/synced-blocks.tsx` |
| DOM coverage boundaries model hidden same-root content with selection, copy, find, and materialization policies. | `libraries/slate-react/dom-coverage-boundaries.md`, `libraries/slate-react/editable.md`, `libraries/slate-react/experimental-virtualized-rendering.md` | `packages/slate-dom/src/plugin/dom-coverage.ts`, `packages/slate-react/src/components/dom-coverage-boundary.tsx`, `packages/slate-react/test/dom-coverage-boundary-contract.tsx`, `playwright/integration/examples/hidden-content-blocks.test.ts` |
| Page layout derives paginated geometry and page-level mount plans outside the document tree. | `libraries/slate-layout/README.md`, `walkthroughs/09-performance.md` | `packages/slate-layout/src/index.ts`, `packages/slate-layout/src/react.tsx`, `packages/slate-layout/test/page-layout-contract.test.ts`, `site/examples/ts/pagination.tsx` |

## Browser Contract Map

`slate-browser` owns browser proof. The docs should point browser-sensitive
behavior at these operation families instead of relying on example screenshots
or one-off manual checks.

| Behavior family | Routes | Contract source |
| --- | --- | --- |
| Inline void boundary navigation | `mentions` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Markable inline void formatting | `mentions` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Block void navigation | `images`, `embeds` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Paste HTML image void | `paste-html` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Editable island native focus | `editable-voids` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Huge document DOM strategy | `huge-document` | `playwright/integration/examples/huge-document.test.ts` |
| Table cell boundary navigation | `tables` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| External decoration refresh | `search-highlighting` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Annotation anchor rebase | `comment-mode`, `persistent-annotation-anchors` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Mouse selection toolbar | `hovering-toolbar` | `packages/slate-browser/src/core/first-party-browser-contracts.ts` |
| Paste, normalize, undo | `richtext`, `plaintext`, `forced-layout` | `playwright/stress/generated-editing.test.ts` |
| Selection repair and IME | `richtext` | `playwright/stress/generated-editing.test.ts`, `packages/slate-browser/src/playwright/ime.ts` |
| Hidden same-root content | `hidden-content-blocks`, `dom-coverage-boundaries` | `playwright/integration/examples/hidden-content-blocks.test.ts`, `playwright/integration/examples/dom-coverage-boundaries.test.ts` |
| Multi-root and content-root selection | `multi-root-document`, `synced-blocks` | `playwright/integration/examples/multi-root-document.test.ts`, `playwright/integration/examples/synced-blocks.test.ts`, `packages/slate-react/test/content-root-navigation-contract.test.ts` |
| Paginated editor layout | `pagination` | `playwright/integration/examples/pagination.test.ts`, `packages/slate-layout/test/page-layout-contract.test.ts` |

## Fast Gates

Use the focused source and docs gates during docs work.

```bash
rg -n "createEditor<|initialValue|renderVoid|useElementSelected|decorationSources|annotationStore|operations\\.replay|editor\\.update|editor\\.read" docs packages
```

Use the browser contract registry when a browser-sensitive claim changes.

```bash
bun run test:slate-browser
```

Use stress replay for generated operation families.

```bash
bun test:stress
```

Keep `bun check` fast. Full browser sweeps belong to the release-quality gate,
not the normal docs edit loop.

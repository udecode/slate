# Experimental Virtualized Rendering

`virtualized` is an opt-in DOM strategy for pathological documents. It is
experimental and not production-ready. Use it to measure and harden
huge-document behavior without making ordinary editors give up native DOM
coverage.

## When To Use It

Use this mode only when a document is large enough that staged rendering and
partial-DOM preview rendering still leave too much DOM or heap pressure.

| Strategy | Use it for | Production posture |
| --- | --- | --- |
| `auto` | default editor rendering | production default |
| `staged` | safe large-document rendering with eventual DOM coverage | production-ready path |
| `full` | debugging full DOM behavior | debug path |
| `virtualized` | viewport-only mounting for pathological documents | experimental, not production-ready |

This mode uses TanStack Virtual internally as the viewport range and measurement
engine. Slate still owns selection, DOM coverage boundaries, model-backed copy,
and materialization policy.

## Usage

Virtualized rendering needs a bounded editable scroll surface. If Slate cannot
prove that the editable root is a safe scroll owner, it falls back to staged
rendering and reports the actual strategy through metrics.

```tsx
<Editable
  domStrategy={{
    estimatedBlockSize: 32,
    overscan: 4,
    type: 'virtualized',
    threshold: 25_000,
  }}
  style={{ height: 480, overflowY: 'auto' }}
/>
```

The public API uses editor-shaped options. It does not expose TanStack's
`getScrollElement`, `measureElement`, `rangeExtractor`, item-key hooks, or raw
virtualizer options.

## Native Behavior Limits

Unmounted content has no native DOM. That is the point of virtualization, and it
is also the reason this mode stays experimental.

| Area | Current behavior |
| --- | --- |
| Caret entry | Slate materializes the target block before editing. |
| Broad selection | Slate keeps large selections model-backed instead of expanding every block. |
| Copy | Slate uses model-backed copy for ranges crossing unmounted content. |
| Browser find | Native find only sees mounted blocks. |
| Screen readers | Screen readers only traverse mounted blocks. |
| IME and mobile selection | Still release-gated before this can be production-ready. |

Do not use this mode when the product requires native find, full screen-reader
traversal, or production-grade mobile selection over the full document.

## Metrics

Use `onDOMStrategyMetrics` whenever you test this mode. The callback tells
you whether Slate actually used the requested strategy and how much DOM remains
mounted.

```tsx
<Editable
  domStrategy={{ type: 'virtualized' }}
  onDOMStrategyMetrics={(metrics) => {
    navigator.sendBeacon(
      '/rum/slate-dom-strategy',
      JSON.stringify({
        degradationMode: metrics.degradationMode,
        documentSize: metrics.documentSize,
        domNodeCount: metrics.domNodeCount,
        effectiveStrategy: metrics.effectiveStrategy,
        mountedTopLevelCount: metrics.mountedTopLevelCount,
        pendingTopLevelCount: metrics.pendingTopLevelCount,
        requestedStrategy: metrics.requestedStrategy,
        viewportVirtualizationBoundaryCount:
          metrics.viewportVirtualizationBoundaryCount,
      })
    )
  }}
  style={{ height: 480, overflowY: 'auto' }}
/>
```

If `effectiveStrategy` is not `virtualized`, Slate is telling you
that the virtualized path did not activate.

## Release Gate

Keep this mode behind explicit product flags until these rows are green:

- caret target materializes before every edit path;
- copy and paste across unmounted ranges stay model-backed and correct;
- IME composition does not lose text near virtualized boundaries;
- mobile selection handles behave deterministically near mounted and unmounted
  edges;
- browser find behavior is either custom-owned or explicitly limited;
- screen-reader behavior has an accepted product strategy;
- 25k and 50k document stress rows meet edit-latency budgets, not just ready
  time and DOM-count budgets.

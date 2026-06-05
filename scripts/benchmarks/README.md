# Slate Benchmarks

This is the canonical benchmark home for `/Users/zbeyens/git/slate-v2`.

If you add a benchmark and it does not live here, you are making the repo
worse.

## Folder Layout

```text
scripts/benchmarks/
  browser/
    react/         # browser-facing React locality lanes
  core/
    current/       # headless current-only lanes
    compare/       # headless current-vs-legacy lanes
  shared/          # helper code used by multiple lanes
  slate/           # compatibility wrappers for issue-shaped or legacy command names
```

## What Goes Where

### `browser/react`

Use for browser-facing React runtime locality lanes.

Current live family owners:

- rerender breadth
- huge-document overlays
- huge-document legacy compare
- huge-document cross-editor browser comparison

### `core/current`

Use for headless current-only measurements.

Current live family owners:

- transaction execution
- clipboard large payload
- normalization
- query/ref observation
- structural node transforms
- text/selection transforms
- editor store/public snapshot surface
- refs/projection
- history retained memory

### `core/compare`

Use for headless current-vs-legacy comparisons.

Current live compare owners:

- core huge-document
- core observation
- normalization compare

### `slate/`

Use only for compatibility wrappers where a kept public command name or issue
lane should stay stable.

Current live example:

- `6038-transaction-execution.mjs`
- `5945-large-plaintext-paste.mjs`

## Naming Rules

Keep file names blunt and family-shaped:

- `transaction-execution.mjs`
- `normalization.mjs`
- `query-ref-observation.mjs`
- `node-transforms.mjs`
- `huge-document.mjs`

Do not keep the old “everything is a flat `*-benchmark.mjs` blob in
scripts/`” habit going.

The folder already tells you it is a benchmark.

## Command Rules

Public command names in `/Users/zbeyens/git/slate-v2/package.json` stay stable.

That means:

- change file layout freely here
- do **not** churn user-facing `bench:*` command names casually

The command surface is the contract.
This folder is the implementation.

## Shared Helpers

Use the helpers in `shared/` instead of re-copying boilerplate:

- [shared/stats.mjs](/Users/zbeyens/git/slate-v2/scripts/benchmarks/shared/stats.mjs)
- [shared/repo-compare.mjs](/Users/zbeyens/git/slate-v2/scripts/benchmarks/shared/repo-compare.mjs)

If a new lane needs the same setup a second time, extract it.
Do not copy another private helper block and call it “temporary”.

## Artifact Rules

Write JSON results into `tmp/` with stable names.

Current artifact owners:

- `packages/slate-react/tmp/slate-react-rerender-breadth-benchmark.json`
- `packages/slate-react/tmp/slate-react-huge-document-overlays-benchmark.json`

- `tmp/bench-slate-6038.json`
- `tmp/slate-clipboard-large-payload-benchmark.json`
- `tmp/slate-react-huge-document-legacy-compare-benchmark.json`
- `tmp/slate-react-huge-document-cross-editor-benchmark.json`
- `tmp/slate-normalization-benchmark.json`
- `tmp/slate-query-ref-observation-benchmark.json`
- `tmp/slate-node-transform-benchmark.json`
- `tmp/slate-text-selection-benchmark.json`
- `tmp/slate-history-retained-memory.json`
- `tmp/slate-editor-store-benchmark.json`
- `tmp/slate-refs-projection-benchmark.json`
- `tmp/slate-normalization-compare-benchmark.json`
- `tmp/slate-core-observation-benchmark.json`
- `tmp/slate-core-huge-document-benchmark.json`

The lane file can move.
The artifact name should stay stable unless the lane meaning changes.

## How To Run

From `/Users/zbeyens/git/slate-v2`:

```bash
bun run bench:slate:6038:local
bun run bench:core:transaction:local
bun run bench:core:normalization:local
bun run bench:core:query-ref-observation:local
bun run bench:core:node-transforms:local
bun run bench:core:text-selection:local
bun run bench:core:editor-store:local
bun run bench:core:refs-projection:local
bun run bench:core:clipboard-large-payload:local
bun run bench:core:normalization:compare:local
bun run bench:core:observation:compare:local
bun run bench:core:huge-document:compare:local
bun run bench:react:rerender-breadth:local
bun run bench:react:huge-document-overlays:local
bun run bench:react:huge-document:full:local
bun run bench:react:huge-document:legacy-compare:local
bun run bench:react:huge-document:cross-editor:local
bun run bench:slate:5945:local
```

The full huge-document wrapper keeps `defaultAuto` and `virtualized` as strict
browser perf gates. Full-DOM staged surfaces are diagnostic evidence, printed in
the wrapper metrics, and should be kept/reverted/quarantined explicitly instead
of silently inflating the primary product budget. The browser trace and full
wrapper print cold and materialized selection-ready metrics separately from
select-to-paint metrics. Selection-ready is the click-latency gate: the editor
has imported the DOM selection and can type from it. Select-to-paint is the
settled visual latency after the browser has painted the selection. The same
trace promotes `core_notify_listeners`, listener sub-buckets
(`core_notify_commit_listeners`, `core_notify_snapshot_listeners`,
`core_notify_source_listeners`, `core_notify_extension_commit_listeners`),
`core_listener_snapshot`, and `selector_dispatch` duration plus selector
check/notify/subscription count metrics so listener fanout has a
machine-readable target before any architecture work.
The route trace also records model-backed ready, type-to-paint, and burst/op
metrics; DOM-visible typing alone is not enough proof for virtualized editors.

The cross-editor huge-document benchmark compares Slate auto, Slate virtualized,
ProseMirror, and Lexical on the same large-document browser packet. It emits
type-to-paint p95, cold select-to-paint p95, materialized select-to-paint p95,
burst/op p95, DOM p95, and long-task p95 metrics per surface. Cold select
includes any first-time virtualized materialization; materialized select isolates
paint-settled latency after the target block exists in the editor surface.

The large clipboard payload lane defaults to a bounded local stress size. To run
the exact #5945/#5992 issue-size gate:

```bash
SLATE_CLIPBOARD_BENCH_STRESS_LINES=10000 SLATE_CLIPBOARD_BENCH_HUGE_CUT_BLOCKS=50000 bun run bench:slate:5945:local
```

## Harsh Rules

- Do not add another benchmark file at `scripts/*.mjs`.
- Do not create a benchmark unless you know what decision it changes.
- Do not widen coverage for sport.
- If a lane does not affect roadmap or proof truth, it is probably not worth
  adding.

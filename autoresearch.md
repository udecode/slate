# Autoresearch: Deep research: Perfect @slate/yjs collaboration API, DX, correctness, offline/reconnect, undo/redo, awareness, selection, examples, and test coverage; route each accepted gap to slate-patch, slate-plan, slate-ar-gate, or slate-ar-perf.

## Objective
Perfect @slate/yjs collaboration API, DX, correctness, offline/reconnect, undo/redo, awareness, selection, examples, and test coverage; route each accepted gap to slate-patch, slate-plan, slate-ar-gate, or slate-ar-perf.

## Metrics
- Primary: quality_gap (gaps, lower is better)
- Secondary: none yet

## How to Run
`./autoresearch.sh` prints `METRIC name=value` lines.

## Files in Scope
- autoresearch.research/yjs-pr20

## Off Limits
- TBD: add off-limits files or behaviors if needed

## Constraints
- - Decision contract: quality_gap is treated as a quality-bearing score; faster runs should not be promoted when component evidence shows quality or correctness erosion.
- Keep research notes under autoresearch.research/yjs-pr20.
- Use source-backed evidence before implementing recommendations.

## Decision Rules
- Keep when the primary metric improves or a baseline is needed and checks pass.
- Discard when the metric is equal or worse, unless the run only establishes the baseline.
- Log crashes and failed checks with a concrete rollback reason.
- Put next-step guidance in ASI so another Codex session can continue.

## Stop Conditions
- Stop when the target metric reaches the agreed threshold.
- For qualitative loops, stop when `quality_gap=0`, checks pass, and no high-impact open finding remains.
- Stop when maxIterations is reached or the user interrupts.

## Research Notes
- Source-backed facts, contradictions, and open questions go here or in linked scratchpad files.
- For deep research loops, link the scratchpad folder and summarize the current synthesis.

## What's Been Tried
- Baseline: `scripts/benchmarks/core/current/yjs-collaboration.mjs` measures real `@slate/yjs` multi-editor sync, awareness updates, reconnect, and large-doc sync. Primary metric `yjs_collaboration_worst_p95_ms=122.33`; focused package gates and `bun check` pass; existing Yjs browser offline replace failure blocks optimization promotion.

## Resume This Session

Use these commands to pick the loop back up without rediscovering state:

```bash
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.1/scripts/autoresearch.mjs" state --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2"
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.1/scripts/autoresearch.mjs" doctor --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2" --check-benchmark
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.1/scripts/autoresearch.mjs" next --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2"
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.1/scripts/autoresearch.mjs" log --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2" --from-last --status keep --description "Describe the kept change"
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.1/scripts/autoresearch.mjs" export --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2"
```

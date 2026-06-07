# Autoresearch: Deep research: yjs-pr21 @slate/yjs collaboration quality routing

## Objective
Perfect @slate/yjs collaboration API, DX, correctness, offline/reconnect, undo/redo, awareness, selection, examples, and test coverage; route each accepted gap to slate-patch, slate-plan, slate-ar-gate, slate-ar-perf, or slate-ar.

## Metrics
- Primary: quality_gap (gaps, lower is better)
- Secondary: none yet

## How to Run
`./autoresearch.sh` prints `METRIC name=value` lines.

## Files in Scope
- autoresearch.research/yjs-pr21

## Off Limits
- TBD: add off-limits files or behaviors if needed

## Constraints
- Decision contract: quality_gap is treated as a quality-bearing score; faster runs should not be promoted when component evidence shows quality or correctness erosion.
- Keep research notes under autoresearch.research/yjs-pr21.
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
- yjs-pr21 research setup created `autoresearch.research/yjs-pr21`.
- Live source inspection found four accepted routed gaps: provider lifecycle/API (`slate-plan`), remote cursor rendering (`slate-plan`), operation encoder exhaustiveness (`slate-patch`), and named collaboration release gate (`slate-ar-gate`).
- This round rejected `slate-ar-perf`: a Yjs collaboration benchmark exists, but no current metric regression or threshold miss was identified.

## Resume This Session

Use these commands to pick the loop back up without rediscovering state:

```bash
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.2/scripts/autoresearch.mjs" state --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2"
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.2/scripts/autoresearch.mjs" quality-gap --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2" --research-slug yjs-pr21 --list
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.2/scripts/autoresearch.mjs" benchmark-lint --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2" --metric-name quality_gap --command "bash ./autoresearch.sh"
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.2/scripts/autoresearch.mjs" serve --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2"
node "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.2/scripts/autoresearch.mjs" export --cwd "/Users/felixfeng/Desktop/repos/plate-copy/.tmp/slate-v2"
```

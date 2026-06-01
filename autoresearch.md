# Autoresearch: react-pagination-virtualized-char-burst

## Objective
Improve rows=800 virtualized pagination char-burst typing until it is close to
staged table performance without breaking native editing behavior.

## Metrics
- Primary: pagination_virtualized_vs_table_ratio (ratio, lower is better)
- Secondary: pagination_virtualized_burst_ms,
  pagination_virtualized_p95_typing_ms, pagination_virtualized_scroll_ms,
  pagination_virtualized_dom_nodes, pagination_virtualized_page_surfaces

## How to Run
`cd '/Users/zbeyens/git/plate-2/.tmp/slate-v2' && bun run bench:react:pagination-virtualized-char-burst:local` prints `METRIC name=value` lines.

## Files in Scope
- TBD: add files after initial inspection

## Off Limits
- TBD: add off-limits files or behaviors if needed

## Constraints
- - Decision contract: typing_seconds is the primary metric; secondary evidence explains tradeoffs but should not silently override it.

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
- Baseline: pending

## Resume This Session

Use these commands to pick the loop back up without rediscovering state:

```bash
node "/Users/zbeyens/git/codex-autoresearch/plugins/codex-autoresearch/scripts/autoresearch.mjs" state --cwd "/Users/zbeyens/git/plate-2/.tmp/slate-v2"
node "/Users/zbeyens/git/codex-autoresearch/plugins/codex-autoresearch/scripts/autoresearch.mjs" doctor --cwd "/Users/zbeyens/git/plate-2/.tmp/slate-v2" --check-benchmark
node "/Users/zbeyens/git/codex-autoresearch/plugins/codex-autoresearch/scripts/autoresearch.mjs" next --cwd "/Users/zbeyens/git/plate-2/.tmp/slate-v2"
node "/Users/zbeyens/git/codex-autoresearch/plugins/codex-autoresearch/scripts/autoresearch.mjs" log --cwd "/Users/zbeyens/git/plate-2/.tmp/slate-v2" --from-last --status keep --description "Describe the kept change"
node "/Users/zbeyens/git/codex-autoresearch/plugins/codex-autoresearch/scripts/autoresearch.mjs" export --cwd "/Users/zbeyens/git/plate-2/.tmp/slate-v2"
```

## Run Ledger

<!-- AUTORESEARCH_RUN_LEDGER:START -->
- Run 1 crash: Baseline pagination packet failed: virtualized rows800 char-burst lost expected text/block visibility before metric emission; metric=null; best=unknown; commit=257935a; Git: no scoped experiment changes to revert; preserved 19 unowned dirty path(s). cleanup=ae8d549d6d8a..
- Run 2 keep: Virtualized pagination keeps rows=800 char-burst responsive with page-windowed projection and scroll-safe selection retention; metric=2.43; best=2.43; commit=6c5b89f; Git: committed 6c5b89f..
- Run 3 keep: Virtualized pagination keeps rows=800 char-burst correct with immediate virtualized text repair and page-windowed rendering; metric=2.49; best=2.43; commit=4ed0bf7; Git: committed 4ed0bf7..
<!-- AUTORESEARCH_RUN_LEDGER:END -->

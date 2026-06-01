#!/usr/bin/env bash
set -euo pipefail

PLAYWRIGHT_RETRIES=0 PLAYWRIGHT_WORKERS=1 bun playwright test \
  playwright/integration/examples/pagination.test.ts \
  --project=chromium \
  -g "keeps rows=800 virtualized pagination in the staged-class perf envelope|keeps fast staged text after insert breaks at the model caret|selects projected pagination words on native double click|places virtualized pagination selection at wrapped line ends"

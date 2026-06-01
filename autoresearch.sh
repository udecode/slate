#!/usr/bin/env bash
set -euo pipefail

cd '/Users/zbeyens/git/plate-2/.tmp/slate-v2'
bun run bench:react:pagination-virtualized-char-burst:local

#!/usr/bin/env bash
set -euo pipefail

"/Users/felixfeng/.nvm/versions/node/v24.11.1/bin/node" "/Users/felixfeng/.codex/plugins/cache/thegreencedar-autoresearch/codex-autoresearch/2.0.2/scripts/autoresearch.mjs" quality-gap --cwd . --research-slug "yjs-pr21"

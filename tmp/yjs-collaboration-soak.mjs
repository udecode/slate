#!/usr/bin/env bun

process.env.SOAK_OUTPUT_ROOT ??= 'tmp/yjs-collaboration-soak'

console.warn(
  '[yjs-collaboration-soak] tmp/yjs-collaboration-soak.mjs moved to scripts/proof/yjs-collaboration-soak.mjs; forwarding.'
)

await import('../scripts/proof/yjs-collaboration-soak.mjs')

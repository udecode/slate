import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const coreCurrentDir = fileURLToPath(
  new URL('../../../scripts/benchmarks/core/current/', import.meta.url)
)
const packageJsonPath = fileURLToPath(
  new URL('../../../package.json', import.meta.url)
)
const legacyReactComparePath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/browser/react/huge-document-legacy-compare.mjs',
    import.meta.url
  )
)
const activeTypingBreakdownPath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/browser/react/active-typing-breakdown.tsx',
    import.meta.url
  )
)
const observationComparePath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/compare/observation.mjs',
    import.meta.url
  )
)
const hugeDocumentComparePath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/compare/huge-document.mjs',
    import.meta.url
  )
)
const historyRetainedMemoryPath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/current/history-retained-memory.mjs',
    import.meta.url
  )
)
const clipboardLargePayloadPath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/current/clipboard-large-payload.mjs',
    import.meta.url
  )
)
const transactionExecutionPath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/current/transaction-execution.mjs',
    import.meta.url
  )
)
const historyComparePath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/compare/history.mjs',
    import.meta.url
  )
)
const normalizationComparePath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/compare/normalization.mjs',
    import.meta.url
  )
)
const textSelectionPath = fileURLToPath(
  new URL(
    '../../../scripts/benchmarks/core/current/text-selection.mjs',
    import.meta.url
  )
)

type BenchmarkSummary = {
  max: number
  mean: number
  median: number
  min: number
  p75?: number
  p95?: number
  p99?: number
  samples: number[]
}

const compareBenchmarkSummaryPaths = [
  legacyReactComparePath,
  observationComparePath,
  hugeDocumentComparePath,
  historyComparePath,
  normalizationComparePath,
]

const summaryNumbers = (summary: BenchmarkSummary) =>
  Object.values(summary).filter((value): value is number => {
    return typeof value === 'number'
  })

const extractSummarizeSource = (source: string) => {
  const summarizeStart = source.indexOf('const summarize =')

  assert.ok(summarizeStart >= 0)

  const percentileStart = source.lastIndexOf(
    'const percentile =',
    summarizeStart
  )
  const extractionStart =
    percentileStart >= 0 ? percentileStart : summarizeStart
  const bodyStart = source.indexOf('{', summarizeStart)

  assert.ok(bodyStart >= 0)

  let depth = 0

  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') {
      depth++
    }

    if (source[index] === '}') {
      depth--

      if (depth === 0) {
        let end = index + 1

        if (source[end] === ')') {
          end += 1
        }

        return source.slice(
          extractionStart,
          source[end] === ';' ? end + 1 : end
        )
      }
    }
  }

  throw new Error('Unable to extract summarize helper')
}

const extractConstFunctionSource = (
  source: string,
  functionName: string,
  dependencyName?: string
) => {
  const functionStart = source.indexOf(`const ${functionName} =`)

  assert.ok(functionStart >= 0)

  const dependencyStart = dependencyName
    ? source.lastIndexOf(`const ${dependencyName} =`, functionStart)
    : -1
  const extractionStart = dependencyStart >= 0 ? dependencyStart : functionStart
  const bodyStart = source.indexOf('{', functionStart)
  const nextDeclaration = source.indexOf('\nconst ', functionStart + 1)

  if (nextDeclaration >= 0 && nextDeclaration < bodyStart) {
    return source.slice(extractionStart, nextDeclaration).trimEnd()
  }

  assert.ok(bodyStart >= 0)

  let depth = 0

  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') {
      depth++
    }

    if (source[index] === '}') {
      depth--

      if (depth === 0) {
        let end = index + 1

        if (source[end] === ')') {
          end += 1
        }

        return source.slice(
          extractionStart,
          source[end] === ';' ? end + 1 : end
        )
      }
    }
  }

  throw new Error(`Unable to extract ${functionName} helper`)
}

const summarizeEmptySamplesFromPath = (path: string) => {
  const source = extractSummarizeSource(readFileSync(path, 'utf8'))
  const round = (value: number) => Number(value.toFixed(2))
  const summarize = Function('round', `${source}; return summarize`)(round) as (
    samples: number[]
  ) => BenchmarkSummary

  return summarize([])
}

const emptySummaryFromPath = <TSummary>(
  path: string,
  functionName: string,
  dependencyName?: string
) => {
  const source = extractConstFunctionSource(
    readFileSync(path, 'utf8'),
    functionName,
    dependencyName
  )
  const round = (value: number) => Number(value.toFixed(2))
  const summarize = Function(
    'round',
    `${source}; return ${functionName}`
  )(round) as (samples: number[]) => TSummary

  return summarize([])
}

describe('core benchmark scripts contract', () => {
  it('returns finite zero summaries for empty shared benchmark samples', async () => {
    const reactBenchmark = (await import(
      new URL(
        '../../../scripts/benchmarks/shared/react-benchmark.tsx',
        import.meta.url
      ).href
    )) as { summarize: (samples: number[]) => BenchmarkSummary }
    const stats = (await import(
      new URL('../../../scripts/benchmarks/shared/stats.mjs', import.meta.url)
        .href
    )) as { summarize: (samples: number[]) => BenchmarkSummary }
    const expected = {
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      p75: 0,
      p95: 0,
      p99: 0,
      samples: [],
    }

    for (const summary of [reactBenchmark.summarize([]), stats.summarize([])]) {
      assert.deepEqual(summary, expected)
      assert.ok(summaryNumbers(summary).every(Number.isFinite))
    }
  })

  it('returns finite zero summaries for empty copied benchmark compare samples', () => {
    const expectedWithPercentiles = {
      samples: [],
      mean: 0,
      median: 0,
      p75: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
    }
    const expectedWithoutPercentiles = {
      samples: [],
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
    }

    for (const path of compareBenchmarkSummaryPaths) {
      const summary = summarizeEmptySamplesFromPath(path)

      assert.deepEqual(
        summary,
        path === normalizationComparePath
          ? expectedWithoutPercentiles
          : expectedWithPercentiles
      )
      assert.ok(summaryNumbers(summary).every(Number.isFinite))
    }
  })

  it('returns finite zero summaries for empty current benchmark samples', () => {
    const retainedHeapSummary = emptySummaryFromPath<{
      max: number
      mean: number
      min: number
      samples: number[]
    }>(historyRetainedMemoryPath, 'summarizeHeapDeltas')
    const clipboardDurationSummary = emptySummaryFromPath<{
      max: number
      mean: number
      min: number
      p50: number
      p95: number
      samples: number[]
    }>(clipboardLargePayloadPath, 'summarizeDurations', 'percentile')
    const clipboardHeapSummary = emptySummaryFromPath<{
      max: number
      mean: number
      samples: number[]
    }>(clipboardLargePayloadPath, 'summarizeHeapDeltas')
    const meanSource = extractConstFunctionSource(
      readFileSync(transactionExecutionPath, 'utf8'),
      'mean'
    )
    const mean = Function(`${meanSource}; return mean`) as () => (
      samples: number[]
    ) => number

    assert.deepEqual(retainedHeapSummary, {
      samples: [],
      mean: 0,
      max: 0,
      min: 0,
    })
    assert.deepEqual(clipboardDurationSummary, {
      samples: [],
      mean: 0,
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
    })
    assert.deepEqual(clipboardHeapSummary, {
      max: 0,
      mean: 0,
      samples: [],
    })
    assert.equal(mean()([]), 0)
    assert.ok(summaryNumbers(retainedHeapSummary).every(Number.isFinite))
    assert.ok(summaryNumbers(clipboardDurationSummary).every(Number.isFinite))
    assert.ok(summaryNumbers(clipboardHeapSummary).every(Number.isFinite))
  })

  it('exposes every current core benchmark through a local core script', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    const coreBenchmarkFiles = readdirSync(coreCurrentDir)
      .filter((file) => file.endsWith('.mjs'))
      .sort()
    const coreLocalScriptCommands = Object.entries(packageJson.scripts)
      .filter(
        ([name]) => name.startsWith('bench:core:') && name.endsWith(':local')
      )
      .map(([, command]) => command)

    const missingFiles = coreBenchmarkFiles.filter((file) => {
      const expectedCommand = `bun ./scripts/benchmarks/core/current/${file}`

      return !coreLocalScriptCommands.includes(expectedCommand)
    })

    assert.deepEqual(missingFiles, [])
  })

  it('samples retained history heap after a post-run GC pass', () => {
    const source = readFileSync(historyRetainedMemoryPath, 'utf8')
    const measureStart = source.indexOf('const measureRetainedLane')
    const measureEnd = source.indexOf('const measureFullDocumentReplace')
    const measureSource = source.slice(measureStart, measureEnd)
    const runIndex = measureSource.indexOf('const result = run(context)')
    const gcAfterIndex = measureSource.indexOf(
      'const gcAfter = forceGc()',
      runIndex
    )
    const heapAfterIndex = measureSource.indexOf(
      'const heapAfter = heapUsed()',
      runIndex
    )

    assert.ok(runIndex >= 0)
    assert.ok(gcAfterIndex > runIndex)
    assert.ok(heapAfterIndex > gcAfterIndex)
    assert.match(measureSource, /postRunGcAvailable/)
    assert.match(measureSource, /heapGrowthDeltaBytes/)
  })

  it('prepares the move selection document before timing movement', () => {
    const source = readFileSync(textSelectionPath, 'utf8')
    const setupStart = source.indexOf('const createMoveEditor')
    const setupEnd = source.indexOf('const write =')
    const setupSource = source.slice(setupStart, setupEnd)
    const moveStart = source.indexOf('const moveMs = measureLane')
    const moveSource = source.slice(
      moveStart,
      source.indexOf('const collapseMs')
    )

    assert.ok(setupStart >= 0)
    assert.ok(setupEnd > setupStart)
    assert.match(setupSource, /Editor\.replace\(editor/)
    assert.match(setupSource, /text:\s*'x'\.repeat\(steps \+ 20\)/)
    assert.match(moveSource, /measureLane\(createMoveEditor/)
    assert.doesNotMatch(moveSource, /Editor\.replace\(editor/)
  })

  it('runs active typing warmups through the measured typing path', () => {
    const source = readFileSync(activeTypingBreakdownPath, 'utf8')
    const measureStart = source.indexOf('const measureScenario')
    const measureEnd = source.indexOf('const measureTyping')
    const measureSource = source.slice(measureStart, measureEnd)
    const promoteStart = measureSource.indexOf('if (promote)')
    const elseStart = measureSource.indexOf('} else {', promoteStart)
    const disposeStart = measureSource.indexOf(
      'await context.dispose()',
      elseStart
    )
    const promoteSource = measureSource.slice(promoteStart, elseStart)
    const nonPromoteSource = measureSource.slice(elseStart, disposeStart)

    assert.ok(measureStart >= 0)
    assert.ok(measureEnd > measureStart)
    assert.ok(promoteStart >= 0)
    assert.ok(elseStart > promoteStart)
    assert.ok(disposeStart > elseStart)

    for (const branchSource of [promoteSource, nonPromoteSource]) {
      const typingIndex = branchSource.indexOf(
        'const typingMetrics = measureTyping(context, blockIndex)'
      )
      const sampleGateIndex = branchSource.indexOf('if (iteration > 0)')

      assert.ok(typingIndex >= 0)
      assert.ok(sampleGateIndex > typingIndex)
      assert.match(branchSource, /\.\.\.typingMetrics/)
    }
  })

  it('keeps the core huge-document compare assertions out of snapshot materialization', () => {
    const source = readFileSync(hugeDocumentComparePath, 'utf8')
    const getChildrenStart = source.indexOf('const getChildren =')
    const getSelectionStart = source.indexOf('const getSelection =')
    const selectStart = source.indexOf('const select =')
    const getChildrenSource = source.slice(getChildrenStart, getSelectionStart)
    const getSelectionSource = source.slice(getSelectionStart, selectStart)

    assert.ok(getChildrenStart >= 0)
    assert.ok(getSelectionStart > getChildrenStart)
    assert.ok(selectStart > getSelectionStart)
    assert.ok(
      getChildrenSource.indexOf('Editor.getChildren') <
        getChildrenSource.indexOf('Editor.getSnapshot')
    )
    assert.ok(
      getSelectionSource.indexOf('Editor.getSelection') <
        getSelectionSource.indexOf('Editor.getSnapshot')
    )
  })

  it('runs the observation compare node traversal through legacy and v2 node APIs', () => {
    const source = readFileSync(observationComparePath, 'utf8')

    assert.match(
      source,
      /Slate\.NodeApi\s*\?\?\s*Slate\.Node\s*\?\?\s*SlateInternal\.NodeApi\s*\?\?\s*SlateInternal\.Node/
    )
    assert.match(source, /NodeApi\.nodes\(editor, \{ at: \[\] \}\)/)
    assert.doesNotMatch(source, /const \{\s*createEditor,\s*Node\s*\} = Slate/)
  })

  it('keeps observation compare children reads out of snapshot materialization', () => {
    const source = readFileSync(observationComparePath, 'utf8')
    const getChildrenStart = source.indexOf('const getChildren =')
    const insertTextStart = source.indexOf('const insertText =')
    const getChildrenSource = source.slice(getChildrenStart, insertTextStart)

    assert.ok(getChildrenStart >= 0)
    assert.ok(insertTextStart > getChildrenStart)
    assert.ok(
      getChildrenSource.indexOf('Editor.getChildren') <
        getChildrenSource.indexOf('Editor.getSnapshot')
    )
  })

  it('keeps normalization compare children reads out of snapshot materialization', () => {
    const source = readFileSync(normalizationComparePath, 'utf8')
    const getChildrenStart = source.indexOf('const getChildren =')
    const normalizeStart = source.indexOf('const normalizeEditor =')
    const getChildrenSource = source.slice(getChildrenStart, normalizeStart)

    assert.ok(getChildrenStart >= 0)
    assert.ok(normalizeStart > getChildrenStart)
    assert.ok(
      getChildrenSource.indexOf('Editor.getChildren') <
        getChildrenSource.indexOf('Editor.getSnapshot')
    )
  })
})

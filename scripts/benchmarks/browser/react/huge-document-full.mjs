import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { round, writeBenchmarkArtifact } from '../../shared/stats.mjs'

const smoke = process.env.HUGE_DOC_FULL_SMOKE === '1'
const includeLegacyBrowserTrace =
  process.env.HUGE_DOC_FULL_INCLUDE_LEGACY_BROWSER_TRACE === '1'
const legacyRepo = process.env.HUGE_DOC_FULL_LEGACY_REPO || '../../../slate'

const blocks = Number(process.env.HUGE_DOC_FULL_BLOCKS || (smoke ? 20 : 5000))
const iterations = Number(
  process.env.HUGE_DOC_FULL_ITERATIONS || (smoke ? 1 : 5)
)
const coreIterations = Number(
  process.env.HUGE_DOC_FULL_CORE_ITERATIONS ||
    (smoke ? 1 : Math.max(iterations, 10))
)
const traceIterations = Number(
  process.env.HUGE_DOC_FULL_TRACE_ITERATIONS || iterations
)
const typeOps = Number(process.env.HUGE_DOC_FULL_TYPE_OPS || (smoke ? 3 : 10))
const overlayBlocks = Number(
  process.env.HUGE_DOC_FULL_OVERLAY_BLOCKS || (smoke ? 40 : blocks)
)
const overlayIslandSize = Number(
  process.env.HUGE_DOC_FULL_OVERLAY_ISLAND_SIZE || (smoke ? 10 : 50)
)
const skipBrowserBuild = process.env.HUGE_DOC_FULL_SKIP_BROWSER_BUILD === '1'

const latestArtifactPath = 'tmp/slate-react-huge-document-full-benchmark.json'
const runArtifactPath = `${[
  'tmp/slate-react-huge-document-full-benchmark',
  `blocks-${blocks}`,
  `iters-${iterations}`,
  `trace-iters-${traceIterations}`,
  `ops-${typeOps}`,
  smoke ? 'smoke' : 'full',
].join('-')}.json`

const sanitizeArtifactSegment = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'default'

const browserTraceArtifactPath = (surfaces) =>
  `${[
    'tmp/slate-react-huge-document-browser-trace-benchmark',
    `surfaces-${sanitizeArtifactSegment(surfaces.split(',').join('-'))}`,
    `blocks-${blocks}`,
    `iters-${traceIterations}`,
    `ops-${typeOps}`,
  ].join('-')}.json`

const childLinePattern = /^[a-zA-Z][\w-]*: /
const lineBreakPattern = /\r?\n/
const nativeSurfacePattern = /^nativeSurface /
const surfaceHeaderPattern = /^[a-zA-Z][\w-]* \([^)]*\)$/

const stringifyEnv = (env) =>
  Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, String(value)])
  )

const rememberTail = (tail, line) => {
  tail.push(line)

  if (tail.length > 80) {
    tail.shift()
  }
}

const shouldEchoChildLine = (line) =>
  line.startsWith('METRIC ') ||
  line.startsWith('Wrote ') ||
  line.startsWith('huge-document ') ||
  nativeSurfacePattern.test(line) ||
  surfaceHeaderPattern.test(line) ||
  childLinePattern.test(line)

const pipeChildOutput = ({ stream, tail, writeLine }) => {
  let buffer = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(lineBreakPattern)

    buffer = lines.pop() ?? ''

    for (const line of lines) {
      rememberTail(tail, line)

      if (shouldEchoChildLine(line)) {
        writeLine(line)
      }
    }
  })

  stream.on('end', () => {
    if (!buffer) {
      return
    }

    rememberTail(tail, buffer)

    if (shouldEchoChildLine(buffer)) {
      writeLine(buffer)
    }
  })
}

const runStep = (step) =>
  new Promise((resolve) => {
    const start = performance.now()
    const stderrTail = []
    const stdoutTail = []
    let settled = false

    console.log(`\n== ${step.id} ==`)
    console.log(step.command)

    if (step.artifactPath) {
      rmSync(step.artifactPath, { force: true })
    }

    const child = spawn('sh', ['-lc', step.command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...stringifyEnv(step.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    pipeChildOutput({
      stream: child.stdout,
      tail: stdoutTail,
      writeLine: (line) => console.log(line),
    })
    pipeChildOutput({
      stream: child.stderr,
      tail: stderrTail,
      writeLine: (line) => console.error(line),
    })

    child.once('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      resolve({
        ...step,
        durationMs: round(performance.now() - start),
        error: error.message,
        exitCode: 1,
        stderrTail,
        stdoutTail,
      })
    })

    child.once('close', async (code) => {
      if (settled) {
        return
      }

      settled = true
      const result = {
        ...step,
        durationMs: round(performance.now() - start),
        exitCode: code ?? 1,
        stderrTail,
        stdoutTail,
      }

      result.artifact = await readArtifact(step.artifactPath)
      result.summary = summarizeStepArtifact(step.id, result.artifact?.json)

      if (
        result.exitCode !== 0 ||
        !result.artifact?.exists ||
        result.artifact?.parseError
      ) {
        console.error(`\n${step.id} failed; recent output:`)
        console.error([...stdoutTail, ...stderrTail].slice(-80).join('\n'))
      }

      resolve(result)
    })
  })

const readArtifact = async (path) => {
  if (!path || !existsSync(path)) {
    return {
      exists: false,
      path,
    }
  }

  try {
    return {
      exists: true,
      json: JSON.parse(await readFile(path, 'utf8')),
      path,
    }
  } catch (error) {
    return {
      exists: true,
      parseError: error.message,
      path,
    }
  }
}

const statValue = (summary, statName) => {
  const value = summary?.[statName]

  return Number.isFinite(value) ? value : null
}

const p95 = (stat) => statValue(stat, 'p95')

const formatStatName = (statName) =>
  `${statName[0].toUpperCase()}${statName.slice(1)}`

const sampleCountAbove = (samples, threshold) =>
  Array.isArray(samples) && Number.isFinite(threshold)
    ? samples.filter((sample) => Number.isFinite(sample) && sample > threshold)
        .length
    : null

const maxFinite = (values) => {
  const finiteValues = values.filter(Number.isFinite)

  return finiteValues.length === 0 ? null : Math.max(...finiteValues)
}

const ratioRows = ({ current, legacy }) =>
  Object.entries(current ?? {}).flatMap(([laneName, currentLane]) => {
    const currentP95 = p95(currentLane)
    const legacyP95 = p95(legacy?.[laneName])

    if (!currentP95 || !legacyP95) {
      return []
    }

    return [
      {
        currentMaxMs: statValue(currentLane, 'max'),
        currentMedianMs: statValue(currentLane, 'median'),
        currentP75Ms: statValue(currentLane, 'p75'),
        currentP95Ms: currentP95,
        currentP99Ms: statValue(currentLane, 'p99'),
        currentSamples: Array.isArray(currentLane?.samples)
          ? currentLane.samples
          : [],
        laneName,
        legacyMaxMs: statValue(legacy?.[laneName], 'max'),
        legacyMedianMs: statValue(legacy?.[laneName], 'median'),
        legacyP75Ms: statValue(legacy?.[laneName], 'p75'),
        legacyP95Ms: legacyP95,
        legacyP99Ms: statValue(legacy?.[laneName], 'p99'),
        ratio: round(currentP95 / legacyP95),
      },
    ]
  })

const summarizeCoreCompare = (artifact) => {
  const rows = ratioRows({
    current: artifact?.current,
    legacy: artifact?.legacy,
  })
  const worst = rows.reduce(
    (winner, row) => (!winner || row.ratio > winner.ratio ? row : winner),
    null
  )

  return {
    blocks: artifact?.config?.blocks ?? null,
    lanes: rows,
    worstP95Ratio: worst?.ratio ?? null,
    worstP95RatioLane: worst?.laneName ?? null,
  }
}

const summarizeLegacyCompare = (artifact) => {
  const legacy = artifact?.surfaces?.legacyChunkOn
  const productLanes = [
    'readyMs',
    'middleBlockTypeMs',
    'middleBlockSelectThenTypeMs',
    'middleBlockPromoteThenTypeMs',
    'replaceFullDocumentWithTextMs',
    'insertFragmentFullDocumentMs',
  ]
  const rows = ['v2DefaultRenderAuto', 'v2DomPresent'].flatMap((surfaceName) =>
    productLanes.flatMap((laneName) => {
      const currentP95 = p95(artifact?.surfaces?.[surfaceName]?.[laneName])
      const legacyP95 = p95(legacy?.[laneName])

      if (!currentP95 || !legacyP95) {
        return []
      }

      return [
        {
          currentP95Ms: currentP95,
          laneName,
          legacyP95Ms: legacyP95,
          ratio: round(currentP95 / legacyP95),
          surfaceName,
        },
      ]
    })
  )
  const worst = rows.reduce(
    (winner, row) => (!winner || row.ratio > winner.ratio ? row : winner),
    null
  )

  return {
    blocks: artifact?.config?.blocks ?? null,
    lanes: rows,
    worstP95Ratio: worst?.ratio ?? null,
    worstP95RatioLane: worst?.laneName ?? null,
    worstP95RatioSurface: worst?.surfaceName ?? null,
  }
}

const browserLaneRows = (artifact) =>
  Object.entries(artifact?.surfaces ?? {}).flatMap(([surfaceName, surface]) =>
    Object.entries(surface.lanes ?? {}).map(([laneName, lane]) => ({
      domNodesP95: p95(lane.domTags?.domNodeCount),
      burstToPaintP95Ms: p95(lane.burstToPaintMs),
      burstToPaintPerOpP95Ms: p95(lane.burstToPaintPerOpMs),
      heapMBP95: p95(lane.domTags?.jsHeapUsedMB),
      laneName,
      longTaskMaxP95Ms: p95(lane.longTaskMaxMs),
      selectThenTypeToPaintP95Ms: p95(lane.selectThenTypeToPaintMs),
      surfaceName,
      typeToPaintP95Ms: p95(lane.typeToPaintMs),
    }))
  )

const summarizeBrowserTrace = (artifact) => {
  const lanes = browserLaneRows(artifact)
  const domNodesP95BySurface = Object.fromEntries(
    Object.entries(artifact?.surfaces ?? {}).map(([surfaceName, surface]) => [
      surfaceName,
      maxFinite(
        Object.values(surface.lanes ?? {}).map((lane) =>
          p95(lane.domTags?.domNodeCount)
        )
      ),
    ])
  )

  return {
    blocks: artifact?.meta?.blocks ?? null,
    domNodesP95: maxFinite(lanes.map((lane) => lane.domNodesP95)),
    domNodesP95BySurface,
    burstToPaintP95Ms: maxFinite(lanes.map((lane) => lane.burstToPaintP95Ms)),
    burstToPaintPerOpP95Ms: maxFinite(
      lanes.map((lane) => lane.burstToPaintPerOpP95Ms)
    ),
    heapMBP95: maxFinite(lanes.map((lane) => lane.heapMBP95)),
    lanes,
    longTaskMaxP95Ms: maxFinite(lanes.map((lane) => lane.longTaskMaxP95Ms)),
    nativeSurfaceTimeoutCount: Object.values(artifact?.surfaces ?? {}).reduce(
      (total, surface) => total + (surface.nativeSurface?.timeoutCount ?? 0),
      0
    ),
    typeToPaintP95Ms: maxFinite(lanes.map((lane) => lane.typeToPaintP95Ms)),
  }
}

const summarizeOverlays = (artifact) => ({
  activeEditP95Ms: p95(artifact?.activeEditAfterOverlay?.editMs),
  blocks: artifact?.config?.blockCount ?? null,
  overlayToggleP95Ms: p95(artifact?.overlayToggle?.overlayToggleMs),
  partialDOMPromotionColdP95Ms: p95(
    artifact?.partialDOMPromotion?.coldPromotionMs
  ),
  partialDOMPromotionSteadyP95Ms: p95(
    artifact?.partialDOMPromotion?.promotionMs
  ),
  partialDOMPromotionTextAfterP95: p95(
    artifact?.partialDOMPromotion?.mountedTextAfter
  ),
})

const summarizeStepArtifact = (id, artifact) => {
  if (!artifact) {
    return null
  }

  if (id === 'core-huge-document-compare') {
    return summarizeCoreCompare(artifact)
  }
  if (id === 'react-huge-document-legacy-compare') {
    return summarizeLegacyCompare(artifact)
  }
  if (
    id === 'react-huge-document-browser-trace' ||
    id === 'react-huge-document-virtualized-type-to-paint' ||
    id === 'react-huge-document-slate-browser-trace'
  ) {
    return summarizeBrowserTrace(artifact)
  }
  if (id === 'react-huge-document-overlays') {
    return summarizeOverlays(artifact)
  }

  return null
}

const metricBudgetRows = (stepResults) => {
  const byId = Object.fromEntries(stepResults.map((step) => [step.id, step]))
  const rows = []
  const add = ({ budget, metric, value, ...metadata }) => {
    if (!Number.isFinite(value)) {
      return
    }

    rows.push({
      budget,
      metric,
      ...metadata,
      ratio: round(value / budget),
      value: round(value),
    })
  }
  const coreLaneBudgets = {
    insertFragmentFullDocumentMs: { budget: 50, stat: 'p95' },
    middleBlockTypeMs: { budget: 5, stat: 'p75' },
    replaceFullDocumentWithTextMs: { budget: 50, stat: 'p95' },
    selectAllMs: { budget: 5, stat: 'p75' },
    startBlockTypeMs: { budget: 5, stat: 'p75' },
  }

  for (const lane of byId['core-huge-document-compare']?.summary?.lanes ?? []) {
    const config = coreLaneBudgets[lane.laneName]

    if (!config) {
      continue
    }

    const statLabel = formatStatName(config.stat)

    add({
      budget: config.budget,
      metric: `core.${lane.laneName}.current${statLabel}Ms`,
      overBudgetSampleCount: sampleCountAbove(
        lane.currentSamples,
        config.budget
      ),
      rawP95Ms: lane.currentP95Ms,
      stat: config.stat,
      value: lane[`current${statLabel}Ms`],
    })
  }

  add({
    budget: 1.5,
    metric: 'legacyCompareWorstP95Ratio',
    value: byId['react-huge-document-legacy-compare']?.summary?.worstP95Ratio,
  })
  add({
    budget: 75,
    metric: 'browserTraceTypeToPaintP95Ms',
    value: byId['react-huge-document-browser-trace']?.summary?.typeToPaintP95Ms,
  })
  add({
    budget: 75,
    metric: 'virtualizedTypeToPaintP95Ms',
    value:
      byId['react-huge-document-virtualized-type-to-paint']?.summary
        ?.typeToPaintP95Ms,
  })
  add({
    budget: 16,
    metric: 'browserTraceBurstToPaintPerOpP95Ms',
    rawBurstToPaintP95Ms:
      byId['react-huge-document-browser-trace']?.summary?.burstToPaintP95Ms,
    value:
      byId['react-huge-document-browser-trace']?.summary
        ?.burstToPaintPerOpP95Ms,
  })
  add({
    budget: 16,
    metric: 'virtualizedBurstToPaintPerOpP95Ms',
    rawBurstToPaintP95Ms:
      byId['react-huge-document-virtualized-type-to-paint']?.summary
        ?.burstToPaintP95Ms,
    value:
      byId['react-huge-document-virtualized-type-to-paint']?.summary
        ?.burstToPaintPerOpP95Ms,
  })
  add({
    budget: 50,
    metric: 'browserTraceLongTaskMaxP95Ms',
    value: byId['react-huge-document-browser-trace']?.summary?.longTaskMaxP95Ms,
  })
  add({
    budget: 50,
    metric: 'virtualizedLongTaskMaxP95Ms',
    value:
      byId['react-huge-document-virtualized-type-to-paint']?.summary
        ?.longTaskMaxP95Ms,
  })
  add({
    budget: 50,
    metric: 'overlayActiveEditP95Ms',
    value: byId['react-huge-document-overlays']?.summary?.activeEditP95Ms,
  })
  add({
    budget: 50,
    metric: 'overlayToggleP95Ms',
    value: byId['react-huge-document-overlays']?.summary?.overlayToggleP95Ms,
  })
  add({
    budget: 50,
    metric: 'partialDOMPromotionSteadyP95Ms',
    value:
      byId['react-huge-document-overlays']?.summary
        ?.partialDOMPromotionSteadyP95Ms,
  })

  return rows
}

const coreBudgetRatio = (budgetRows) =>
  maxFinite(
    budgetRows
      .filter((row) => row.metric.startsWith('core.'))
      .map((row) => row.ratio)
  )

const steps = [
  {
    artifactPath: 'tmp/slate-core-huge-document-benchmark.json',
    command: 'bun run bench:core:huge-document:compare:local',
    env: {
      CORE_HUGE_BENCH_BLOCKS: blocks,
      CORE_HUGE_BENCH_ITERATIONS: coreIterations,
      CORE_HUGE_BENCH_LEGACY_REPO: legacyRepo,
      CORE_HUGE_BENCH_TYPE_OPS: typeOps,
    },
    id: 'core-huge-document-compare',
  },
  {
    artifactPath: 'tmp/slate-react-huge-document-legacy-compare-benchmark.json',
    command: 'bun run bench:react:huge-document:legacy-compare:local',
    env: {
      REACT_HUGE_COMPARE_BLOCKS: blocks,
      REACT_HUGE_COMPARE_DISPOSE_DELAY_MS: 0,
      REACT_HUGE_COMPARE_ISOLATE_SURFACES: 1,
      REACT_HUGE_COMPARE_ITERATIONS: iterations,
      REACT_HUGE_COMPARE_LEGACY_REPO: legacyRepo,
      REACT_HUGE_COMPARE_SPLIT_SELECTION: 1,
      REACT_HUGE_COMPARE_SURFACES: 'v2DefaultRenderAuto,v2DomPresent',
      REACT_HUGE_COMPARE_TYPE_OPS: typeOps,
    },
    id: 'react-huge-document-legacy-compare',
  },
  {
    artifactPath: browserTraceArtifactPath('defaultAuto,stagedDomPresent'),
    command: 'bun run bench:react:huge-document:browser-trace:local',
    env: {
      SLATE_BROWSER_TRACE_BLOCKS: blocks,
      SLATE_BROWSER_TRACE_ITERATIONS: traceIterations,
      SLATE_BROWSER_TRACE_SKIP_BUILD: skipBrowserBuild ? 1 : 0,
      SLATE_BROWSER_TRACE_SURFACES: 'defaultAuto,stagedDomPresent',
      SLATE_BROWSER_TRACE_TYPE_OPS: typeOps,
    },
    id: 'react-huge-document-browser-trace',
  },
  {
    artifactPath: browserTraceArtifactPath('virtualized'),
    command: 'bun run bench:react:huge-document:browser-trace:local',
    env: {
      SLATE_BROWSER_TRACE_BLOCKS: blocks,
      SLATE_BROWSER_TRACE_ITERATIONS: traceIterations,
      SLATE_BROWSER_TRACE_NATIVE_TIMEOUT_MS: 5000,
      SLATE_BROWSER_TRACE_SKIP_BUILD: 1,
      SLATE_BROWSER_TRACE_SURFACES: 'virtualized',
      SLATE_BROWSER_TRACE_TYPE_OPS: typeOps,
    },
    id: 'react-huge-document-virtualized-type-to-paint',
  },
  {
    artifactPath:
      'packages/slate-react/tmp/slate-react-huge-document-overlays-benchmark.json',
    command: 'bun run bench:react:huge-document-overlays:local',
    env: {
      REACT_HUGE_DOC_ACTIVE_RADIUS: 1,
      REACT_HUGE_DOC_BENCH_ITERATIONS: iterations,
      REACT_HUGE_DOC_BLOCKS: overlayBlocks,
      REACT_HUGE_DOC_ISLAND_SIZE: overlayIslandSize,
    },
    id: 'react-huge-document-overlays',
  },
]

if (includeLegacyBrowserTrace) {
  steps.push({
    artifactPath:
      'tmp/slate-react-huge-document-slate-browser-trace-benchmark.json',
    command: 'bun run bench:react:huge-document:slate-browser-trace:local',
    env: {
      SLATE_LEGACY_BROWSER_TRACE_BLOCKS: blocks,
      SLATE_LEGACY_BROWSER_TRACE_ITERATIONS: traceIterations,
      SLATE_LEGACY_BROWSER_TRACE_REPO: legacyRepo,
      SLATE_LEGACY_BROWSER_TRACE_SURFACES: 'legacyChunkOn',
      SLATE_LEGACY_BROWSER_TRACE_TYPE_OPS: typeOps,
    },
    id: 'react-huge-document-slate-browser-trace',
  })
}

const stepResults = []

for (const step of steps) {
  stepResults.push(await runStep(step))
}

const failures = stepResults.filter(
  (step) =>
    step.exitCode !== 0 ||
    !step.artifact?.exists ||
    Boolean(step.artifact?.parseError)
)
const budgetRows = metricBudgetRows(stepResults)
const maxBudgetRatio = maxFinite(budgetRows.map((row) => row.ratio)) ?? 0

const byId = Object.fromEntries(stepResults.map((step) => [step.id, step]))
const summary = {
  artifactPaths: {
    latest: latestArtifactPath,
    run: runArtifactPath,
  },
  config: {
    blocks,
    coreIterations,
    includeLegacyBrowserTrace,
    iterations,
    legacyRepo,
    overlayBlocks,
    overlayIslandSize,
    skipBrowserBuild,
    smoke,
    traceIterations,
    typeOps,
  },
  failureCount: failures.length,
  failures: failures.map((step) => ({
    artifactExists: step.artifact?.exists ?? false,
    artifactParseError: step.artifact?.parseError ?? null,
    exitCode: step.exitCode,
    id: step.id,
  })),
  lane: 'slate-react-huge-document-full',
  metrics: {
    budgetRows,
    coreWorstBudgetRatio: coreBudgetRatio(budgetRows),
    coreWorstP95Ratio:
      byId['core-huge-document-compare']?.summary?.worstP95Ratio ?? null,
    domNodesP95: maxFinite(
      [
        byId['react-huge-document-browser-trace']?.summary?.domNodesP95,
        byId['react-huge-document-virtualized-type-to-paint']?.summary
          ?.domNodesP95,
      ].filter(Number.isFinite)
    ),
    browserDomNodesP95:
      byId['react-huge-document-browser-trace']?.summary?.domNodesP95 ?? null,
    browserDomNodesP95BySurface:
      byId['react-huge-document-browser-trace']?.summary
        ?.domNodesP95BySurface ?? null,
    virtualizedDomNodesP95:
      byId['react-huge-document-virtualized-type-to-paint']?.summary
        ?.domNodesP95 ?? null,
    burstToPaintP95Ms: maxFinite(
      [
        byId['react-huge-document-browser-trace']?.summary?.burstToPaintP95Ms,
        byId['react-huge-document-virtualized-type-to-paint']?.summary
          ?.burstToPaintP95Ms,
      ].filter(Number.isFinite)
    ),
    burstToPaintPerOpP95Ms: maxFinite(
      [
        byId['react-huge-document-browser-trace']?.summary
          ?.burstToPaintPerOpP95Ms,
        byId['react-huge-document-virtualized-type-to-paint']?.summary
          ?.burstToPaintPerOpP95Ms,
      ].filter(Number.isFinite)
    ),
    heapMBP95: maxFinite(
      [
        byId['react-huge-document-browser-trace']?.summary?.heapMBP95,
        byId['react-huge-document-virtualized-type-to-paint']?.summary
          ?.heapMBP95,
      ].filter(Number.isFinite)
    ),
    legacyCompareWorstP95Ratio:
      byId['react-huge-document-legacy-compare']?.summary?.worstP95Ratio ??
      null,
    longTaskMaxP95Ms: maxFinite(
      [
        byId['react-huge-document-browser-trace']?.summary?.longTaskMaxP95Ms,
        byId['react-huge-document-virtualized-type-to-paint']?.summary
          ?.longTaskMaxP95Ms,
      ].filter(Number.isFinite)
    ),
    maxBudgetRatio,
    partialDOMPromotionColdP95Ms:
      byId['react-huge-document-overlays']?.summary
        ?.partialDOMPromotionColdP95Ms ?? null,
    partialDOMPromotionSteadyP95Ms:
      byId['react-huge-document-overlays']?.summary
        ?.partialDOMPromotionSteadyP95Ms ?? null,
    typeToPaintP95Ms: maxFinite(
      [
        byId['react-huge-document-browser-trace']?.summary?.typeToPaintP95Ms,
        byId['react-huge-document-virtualized-type-to-paint']?.summary
          ?.typeToPaintP95Ms,
      ].filter(Number.isFinite)
    ),
    virtualizedTypeToPaintP95Ms:
      byId['react-huge-document-virtualized-type-to-paint']?.summary
        ?.typeToPaintP95Ms ?? null,
  },
  steps: stepResults.map((step) => ({
    artifactPath: step.artifactPath,
    durationMs: step.durationMs,
    exitCode: step.exitCode,
    id: step.id,
    summary: step.summary,
  })),
}

await writeBenchmarkArtifact(latestArtifactPath, summary)
await writeBenchmarkArtifact(runArtifactPath, summary)

console.log(
  `METRIC react_huge_doc_full_max_budget_ratio=${round(maxBudgetRatio)}`
)
console.log(`METRIC react_huge_doc_full_failure_count=${failures.length}`)
console.log(
  `METRIC react_huge_doc_full_legacy_compare_worst_p95_ratio=${round(
    summary.metrics.legacyCompareWorstP95Ratio ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_core_worst_p95_ratio=${round(
    summary.metrics.coreWorstP95Ratio ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_core_worst_budget_ratio=${round(
    summary.metrics.coreWorstBudgetRatio ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_type_to_paint_p95_ms=${round(
    summary.metrics.typeToPaintP95Ms ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_burst_to_paint_p95_ms=${round(
    summary.metrics.burstToPaintP95Ms ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_burst_to_paint_per_op_p95_ms=${round(
    summary.metrics.burstToPaintPerOpP95Ms ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_virtualized_type_to_paint_p95_ms=${round(
    summary.metrics.virtualizedTypeToPaintP95Ms ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_partial_dom_promotion_steady_p95_ms=${round(
    summary.metrics.partialDOMPromotionSteadyP95Ms ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_partial_dom_promotion_cold_p95_ms=${round(
    summary.metrics.partialDOMPromotionColdP95Ms ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_dom_nodes_p95=${round(
    summary.metrics.domNodesP95 ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_browser_dom_nodes_p95=${round(
    summary.metrics.browserDomNodesP95 ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_virtualized_dom_nodes_p95=${round(
    summary.metrics.virtualizedDomNodesP95 ?? 0
  )}`
)
console.log(
  `METRIC react_huge_doc_full_long_task_max_p95_ms=${round(
    summary.metrics.longTaskMaxP95Ms ?? 0
  )}`
)
console.log(`\nWrote ${runArtifactPath}`)

if (failures.length > 0) {
  process.exitCode = 1
}

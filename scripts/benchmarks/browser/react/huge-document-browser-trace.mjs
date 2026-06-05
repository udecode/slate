import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import handler from 'serve-handler'

import {
  round,
  summarize,
  writeBenchmarkArtifact,
} from '../../shared/stats.mjs'

const siteOutRoot = fileURLToPath(
  new URL('../../../../site/out', import.meta.url)
)
const blocks = Number(process.env.SLATE_BROWSER_TRACE_BLOCKS || 5000)
const iterations = Number(process.env.SLATE_BROWSER_TRACE_ITERATIONS || 3)
const typeOps = Number(process.env.SLATE_BROWSER_TRACE_TYPE_OPS || 10)
const port = Number(process.env.SLATE_BROWSER_TRACE_PORT || 0)
const nativeSurfaceTimeoutMs = Number(
  process.env.SLATE_BROWSER_TRACE_NATIVE_TIMEOUT_MS || 10_000
)
const materializationTimeoutMs = Number(
  process.env.SLATE_BROWSER_TRACE_MATERIALIZATION_TIMEOUT_MS || 15_000
)
const headless = process.env.SLATE_BROWSER_TRACE_HEADLESS !== '0'
const skipBuild = process.env.SLATE_BROWSER_TRACE_SKIP_BUILD === '1'
const selectedSurfaces = new Set(
  (process.env.SLATE_BROWSER_TRACE_SURFACES || 'defaultAuto,stagedDomPresent')
    .split(',')
    .map((surface) => surface.trim())
    .filter(Boolean)
)

const latestArtifactPath =
  'tmp/slate-react-huge-document-browser-trace-benchmark.json'

const sanitizeArtifactSegment = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'default'

const runArtifactPath = `${[
  'tmp/slate-react-huge-document-browser-trace-benchmark',
  `surfaces-${sanitizeArtifactSegment(Array.from(selectedSurfaces).join('-'))}`,
  `blocks-${blocks}`,
  `iters-${iterations}`,
  `ops-${typeOps}`,
].join('-')}.json`

const typeText = 'X'.repeat(typeOps)

const surfaces = [
  {
    key: 'defaultAuto',
    label: 'v2 auto',
    path: `/examples/huge-document?blocks=${blocks}&content_visibility=none&strict=false&strategy=auto`,
  },
  {
    key: 'stagedDomPresent',
    label: 'v2 staged DOM-present',
    path: `/examples/huge-document?blocks=${blocks}&content_visibility=none&strict=false&strategy=staged`,
  },
  {
    key: 'stagedDefault',
    label: 'v2 staged default',
    path: `/examples/huge-document?blocks=${blocks}&strict=false&strategy=staged`,
  },
  {
    key: 'stagedContentVisibility',
    label: 'v2 staged content-visibility',
    path: `/examples/huge-document?blocks=${blocks}&content_visibility=element&strict=false&strategy=staged`,
  },
  {
    key: 'virtualized',
    label: 'v2 virtualized',
    path: `/examples/huge-document?blocks=${blocks}&content_visibility=none&strict=false&strategy=virtualized&threshold=1&overscan=2&editor_height=600`,
  },
].filter((surface) => selectedSurfaces.has(surface.key))

const lanes = [
  {
    blockIndex: 0,
    key: 'startBlock',
    offset: 1,
  },
  {
    blockIndex: Math.floor(blocks / 2),
    key: 'middleBlock',
    offset: 1,
  },
]

const nextPaint = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(performance.now())
          })
        })
      })
  )

const startStaticServer = async () => {
  const server = createServer((request, response) => {
    Promise.resolve()
      .then(() =>
        handler(request, response, {
          cleanUrls: true,
          directoryListing: false,
          public: siteOutRoot,
        })
      )
      .catch((error) => {
        console.error('Browser trace server request failed:', error)

        if (response.headersSent) {
          response.destroy()
          return
        }

        response.statusCode = 500
        response.end('Internal Server Error')
      })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const actualPort =
    typeof address === 'object' && address ? address.port : port

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${actualPort}`,
  }
}

const buildSite = async () => {
  if (skipBuild) {
    return
  }

  await new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', 'build:next'], {
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`bun run build:next exited with code ${code}`))
    })
  })
}

const installTraceObserver = async (page) => {
  await page.evaluate(() => {
    const target = globalThis

    if (target.__SLATE_BROWSER_TRACE_OBSERVER__) {
      target.__SLATE_BROWSER_TRACE__?.reset?.()
      return
    }

    const trace = {
      longAnimationFrames: [],
      longTasks: [],
      beforeInputEvents: [],
      inputEvents: [],
      profilerEvents: [],
      reset() {
        this.beforeInputEvents.length = 0
        this.inputEvents.length = 0
        this.longAnimationFrames.length = 0
        this.longTasks.length = 0
        this.profilerEvents.length = 0
      },
      snapshot() {
        return {
          beforeInputEvents: this.beforeInputEvents.slice(),
          inputEvents: this.inputEvents.slice(),
          longAnimationFrames: this.longAnimationFrames.slice(),
          longTasks: this.longTasks.slice(),
          profilerEvents: this.profilerEvents.slice(),
        }
      },
    }

    target.__SLATE_BROWSER_TRACE__ = trace
    target.__SLATE_BROWSER_TRACE_OBSERVER__ = true
    target.__SLATE_REACT_RENDER_PROFILER__ = {
      record(event) {
        trace.profilerEvents.push(event)
      },
    }
    const getInputEventTargetSnapshot = (event) => {
      const targetElement =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Text
            ? event.target.parentElement
            : null
      const targetTextHost =
        targetElement?.closest?.('[data-slate-node="text"]') ?? null
      const selection = document.getSelection()
      const anchorElement =
        selection?.anchorNode instanceof Element
          ? selection.anchorNode
          : selection?.anchorNode instanceof Text
            ? selection.anchorNode.parentElement
            : null
      const anchorTextHost =
        anchorElement?.closest?.('[data-slate-node="text"]') ?? null
      const root = targetElement?.closest?.('[data-slate-editor="true"]')
      const handle = root?.__slateBrowserHandle ?? null

      return {
        anchorOffset: selection?.anchorOffset ?? null,
        anchorPath: anchorTextHost?.getAttribute('data-slate-path') ?? null,
        anchorText: anchorTextHost?.textContent?.replace(/\uFEFF/g, '') ?? null,
        handleSelection: handle?.getSelection?.() ?? null,
        inputState: handle?.getInputState?.() ?? null,
        targetPath: targetTextHost?.getAttribute('data-slate-path') ?? null,
        targetSync: targetTextHost?.getAttribute('data-slate-dom-sync') ?? null,
        targetSyncReason:
          targetTextHost?.getAttribute('data-slate-dom-sync-reason') ?? null,
        targetText: targetTextHost?.textContent?.replace(/\uFEFF/g, '') ?? null,
      }
    }
    target.document.addEventListener(
      'beforeinput',
      (event) => {
        const inputEvent = event instanceof InputEvent ? event : null

        trace.beforeInputEvents.push({
          ...getInputEventTargetSnapshot(event),
          data: inputEvent?.data ?? null,
          inputType: inputEvent?.inputType ?? null,
          time: performance.now(),
        })
      },
      true
    )
    target.document.addEventListener(
      'input',
      (event) => {
        const inputEvent = event instanceof InputEvent ? event : null

        trace.inputEvents.push({
          ...getInputEventTargetSnapshot(event),
          data: inputEvent?.data ?? null,
          inputType: inputEvent?.inputType ?? null,
          time: performance.now(),
        })
      },
      true
    )

    if ('PerformanceObserver' in target) {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            trace.longTasks.push({
              duration: entry.duration,
              name: entry.name,
              startTime: entry.startTime,
            })
          }
        })

        longTaskObserver.observe({ type: 'longtask', buffered: false })
      } catch {}

      try {
        const loafObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            trace.longAnimationFrames.push({
              duration: entry.duration,
              name: entry.name,
              startTime: entry.startTime,
            })
          }
        })

        loafObserver.observe({
          type: 'long-animation-frame',
          buffered: false,
        })
      } catch {}
    }
  })
}

const waitForEditorReady = async (page) => {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-slate-editor="true"]')
      return !!root?.__slateBrowserHandle?.selectRange
    },
    undefined,
    { timeout: 30_000 }
  )
}

const waitForNativeSurface = async (page) => {
  const start = await page.evaluate(() => performance.now())

  await page
    .waitForFunction(
      (expectedBlocks) => {
        const root = document.querySelector('[data-slate-editor="true"]')

        if (!root) {
          return false
        }

        const readNumber = (testId) => {
          const value = Number(
            document.querySelector(`[data-test-id="${testId}"]`)?.textContent ??
              0
          )

          return Number.isFinite(value) ? value : 0
        }
        const effectiveStrategy = document.querySelector(
          '[data-test-id="huge-document-effective-strategy"]'
        )?.textContent
        const mountedTopLevelCount = readNumber(
          'huge-document-mounted-top-level-count'
        )

        if (
          effectiveStrategy === 'partial-dom' ||
          effectiveStrategy === 'virtualized'
        ) {
          return mountedTopLevelCount > 0
        }

        return (
          root.querySelectorAll('[data-slate-node="text"]').length >=
          expectedBlocks
        )
      },
      blocks,
      { timeout: nativeSurfaceTimeoutMs }
    )
    .then(() => true)
    .catch(() => false)

  const end = await nextPaint(page)
  const domTags = await getMemoryAndDomTags(page)
  const state = await page.evaluate((expectedBlocks) => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const readText = (testId) =>
      document.querySelector(`[data-test-id="${testId}"]`)?.textContent ?? null
    const readNumber = (testId) => {
      const value = Number(readText(testId) ?? 0)

      return Number.isFinite(value) ? value : 0
    }
    const effectiveStrategy = readText('huge-document-effective-strategy')
    const editorTextNodeCount =
      root?.querySelectorAll('[data-slate-node="text"]').length ?? 0
    const bounded =
      effectiveStrategy === 'partial-dom' || effectiveStrategy === 'virtualized'

    return {
      bounded,
      complete: !bounded && editorTextNodeCount >= expectedBlocks,
      editorTextNodeCount,
      effectiveStrategy,
      mountedTopLevelCount: readNumber('huge-document-mounted-top-level-count'),
      pendingTopLevelCount: readNumber('huge-document-pending-top-level-count'),
      requestedStrategy: readText('huge-document-requested-strategy'),
    }
  }, blocks)

  return {
    bounded: state.bounded,
    complete: state.complete,
    durationMs: end - start,
    editorTextNodeCount: state.editorTextNodeCount,
    effectiveStrategy: state.effectiveStrategy,
    mountedTopLevelCount: state.mountedTopLevelCount,
    observedBlocks: domTags.editorElementCount,
    pendingTopLevelCount: state.pendingTopLevelCount,
    requestedStrategy: state.requestedStrategy,
  }
}

const resetTrace = async (page) => {
  await page.evaluate(() => {
    globalThis.__SLATE_BROWSER_TRACE__?.reset?.()
  })
}

const getTraceSnapshot = async (page) =>
  page.evaluate(() => globalThis.__SLATE_BROWSER_TRACE__?.snapshot?.() ?? null)

const getLaneDiagnostics = async (page, lane, beforeTypeState) =>
  page.evaluate(
    ({ beforeTypeState, index }) => {
      const root = document.querySelector('[data-slate-editor="true"]')
      const activeElement = document.activeElement
      const domSelection = document.getSelection()
      const traceSnapshot =
        globalThis.__SLATE_BROWSER_TRACE__?.snapshot?.() ?? null
      const truncateText = (value) =>
        typeof value === 'string' && value.length > 160
          ? `${value.slice(0, 157)}...`
          : value
      const compactOperation = (operation) => ({
        newProperties: operation.newProperties ?? undefined,
        offset: operation.offset ?? undefined,
        path: operation.path ?? undefined,
        properties: operation.properties ?? undefined,
        root: operation.root ?? undefined,
        text: truncateText(operation.text),
        type: operation.type,
      })
      const compactKernelTraceEntry = (entry) => ({
        command: entry.command ?? null,
        eventFamily: entry.eventFamily ?? null,
        intent: entry.intent ?? null,
        lastOperations: Array.isArray(entry.operations)
          ? entry.operations.slice(-5).map(compactOperation)
          : [],
        movement: entry.movement ?? null,
        nativeAllowed: entry.nativeAllowed ?? null,
        operationsCount: Array.isArray(entry.operations)
          ? entry.operations.length
          : 0,
        ownership: entry.ownership ?? null,
        repairPolicy: entry.repairPolicy ?? null,
        selectionAfter: entry.selectionAfter ?? null,
        selectionBefore: entry.selectionBefore ?? null,
        selectionChangeOrigin: entry.selectionChangeOrigin ?? null,
        selectionPolicy: entry.selectionPolicy ?? null,
        selectionSource: entry.selectionSource ?? null,
        stateAfter: entry.stateAfter ?? null,
        stateBefore: entry.stateBefore ?? null,
        targetOwner: entry.targetOwner ?? null,
      })
      const compactDOMEvent = (event) => ({
        ...event,
        anchorText: truncateText(event.anchorText),
        targetText: truncateText(event.targetText),
      })
      const block = root
        ?.querySelector(
          `[data-slate-node="text"][data-slate-path="${index},0"]`
        )
        ?.closest('[data-slate-node="element"]')
      const selectedText =
        domSelection?.anchorNode?.parentElement?.closest(
          '[data-slate-node="element"]'
        )?.textContent ?? null

      return {
        activeElementTag: activeElement?.tagName ?? null,
        blockText: block?.textContent?.replace(/\uFEFF/g, '') ?? null,
        domAnchorText: domSelection?.anchorNode?.textContent ?? null,
        domSelectionText: selectedText?.replace(/\uFEFF/g, '') ?? null,
        beforeInputTrace:
          root?.__slateBrowserHandle
            ?.getKernelTrace?.()
            .filter?.((entry) => entry.eventFamily === 'beforeinput')
            .slice(-8)
            .map(compactKernelTraceEntry) ?? null,
        beforeTypeState,
        handleSelection: root?.__slateBrowserHandle?.getSelection?.() ?? null,
        inputState: root?.__slateBrowserHandle?.getInputState?.() ?? null,
        beforeInputEvents:
          traceSnapshot?.beforeInputEvents?.slice(-12).map(compactDOMEvent) ??
          null,
        inputEvents:
          traceSnapshot?.inputEvents?.slice(-12).map(compactDOMEvent) ?? null,
        kernelTrace:
          root?.__slateBrowserHandle
            ?.getKernelTrace?.()
            .slice(-12)
            .map(compactKernelTraceEntry) ?? null,
        profilerEvents: traceSnapshot?.profilerEvents?.slice(-20) ?? null,
      }
    },
    { beforeTypeState, index: lane.blockIndex }
  )

const summarizeProfilerEvents = (events = []) => {
  const buckets = new Map()
  const requiredBucketKeys = new Set([
    'selector:selector-dispatch-checks',
    'selector:selector-dispatch-notifies',
    'selector:selector-dispatch-subscriptions',
  ])
  let selectorCheckCount = 0
  let selectorNotifyCount = 0
  let selectorSubscriptionCount = 0

  for (const event of events) {
    const key = event.id ? `${event.kind}:${event.id}` : event.kind
    const current = buckets.get(key) ?? {
      count: 0,
      durationMs: 0,
    }

    if (event.kind === 'selector' && typeof event.id === 'string') {
      if (event.id.endsWith('-check')) {
        selectorCheckCount += 1
      } else if (event.id.endsWith('-notify')) {
        selectorNotifyCount += 1
      } else if (event.id.startsWith('selector-subscription-')) {
        selectorSubscriptionCount += 1
      }
    }

    current.count += 1
    current.durationMs +=
      typeof event.duration === 'number' && Number.isFinite(event.duration)
        ? event.duration
        : 0
    buckets.set(key, current)
  }

  buckets.set('selector:selector-dispatch-checks', {
    count: selectorCheckCount,
    durationMs: 0,
  })
  buckets.set('selector:selector-dispatch-notifies', {
    count: selectorNotifyCount,
    durationMs: 0,
  })
  buckets.set('selector:selector-dispatch-subscriptions', {
    count: selectorSubscriptionCount,
    durationMs: 0,
  })

  const sortedBuckets = [...buckets.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      right.durationMs - left.durationMs ||
      right.count - left.count ||
      leftKey.localeCompare(rightKey)
  )

  const retainedBuckets = new Map(sortedBuckets.slice(0, 20))

  for (const [key, value] of sortedBuckets) {
    if (requiredBucketKeys.has(key)) {
      retainedBuckets.set(key, value)
    }
  }

  return Object.fromEntries(retainedBuckets)
}

const readBlockText = async (page, blockIndex) =>
  page.evaluate((index) => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const textElement = root?.querySelector(
      `[data-slate-node="text"][data-slate-path="${index},0"]`
    )
    const block = textElement?.closest('[data-slate-node="element"]')

    return (block ?? textElement)?.textContent?.replace(/\uFEFF/g, '') ?? null
  }, blockIndex)

const readModelBlockText = async (page, blockIndex) =>
  page.evaluate((index) => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const getBlockText = root?.__slateBrowserHandle?.getBlockText

    return typeof getBlockText === 'function' ? getBlockText(index) : null
  }, blockIndex)

const waitForModelBlockText = async (
  page,
  blockIndex,
  expectedText,
  context
) => {
  await page
    .waitForFunction(
      ({ expectedText, index }) => {
        const root = document.querySelector('[data-slate-editor="true"]')
        const getBlockText = root?.__slateBrowserHandle?.getBlockText

        return (
          typeof getBlockText === 'function' &&
          getBlockText(index) === expectedText
        )
      },
      { expectedText, index: blockIndex },
      { timeout: 10_000 }
    )
    .catch(async (error) => {
      const modelText = await readModelBlockText(page, blockIndex)

      throw new Error(
        `Model typing assertion timed out for ${context.surfaceKey}/${context.laneKey}/iteration-${context.iteration} at block ${blockIndex}: expected=${JSON.stringify(expectedText)} actual=${JSON.stringify(modelText)}; ${error.message}`
      )
    })

  return page.evaluate(() => performance.now())
}

const getMemoryAndDomTags = async (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const performanceMemory =
      'memory' in performance ? performance.memory : null

    return {
      domNodeCount: document.querySelectorAll('*').length,
      editorElementCount:
        root?.querySelectorAll('[data-slate-node="element"]').length ?? 0,
      editorTextNodeCount:
        root?.querySelectorAll('[data-slate-node="text"]').length ?? 0,
      jsHeapUsedMB:
        performanceMemory &&
        typeof performanceMemory.usedJSHeapSize === 'number'
          ? performanceMemory.usedJSHeapSize / 1024 / 1024
          : null,
    }
  })

const requestCollapsedSelection = async (page, blockIndex, offset) =>
  page.evaluate(
    ({ index, offset }) => {
      const root = document.querySelector('[data-slate-editor="true"]')

      if (!(root instanceof HTMLElement)) {
        throw new Error('Missing Slate editor root')
      }

      const handle = root.__slateBrowserHandle
      const selection = {
        anchor: { path: [index, 0], offset },
        focus: { path: [index, 0], offset },
      }

      if (!handle?.selectRange) {
        throw new Error('Missing Slate browser selectRange handle')
      }

      handle.selectRange(selection)
      root.focus()
    },
    { index: blockIndex, offset }
  )

const getMaterializationDiagnostics = async (page, blockIndex) =>
  page.evaluate((index) => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const virtualizer = root?.querySelector(
      '[data-slate-dom-strategy-virtualizer="true"]'
    )
    const scrollParent = root
      ? Array.from(document.querySelectorAll('*')).find(
          (element) =>
            element instanceof HTMLElement &&
            element.contains(root) &&
            element.scrollHeight > element.clientHeight
        )
      : null
    const textElements = Array.from(
      root?.querySelectorAll('[data-slate-node="text"]') ?? []
    )

    return {
      exactPathExists: !!root?.querySelector(
        `[data-slate-node="text"][data-slate-path="${index},0"]`
      ),
      handleInputState: root?.__slateBrowserHandle?.getInputState?.() ?? null,
      handleSelection: root?.__slateBrowserHandle?.getSelection?.() ?? null,
      hasHandle: !!root?.__slateBrowserHandle,
      hasScrollPathIntoView:
        typeof root?.__slateBrowserHandle?.scrollPathIntoView === 'function',
      mountedTextPaths: textElements
        .slice(0, 20)
        .map((element) => element.getAttribute('data-slate-path')),
      requestedIndex: index,
      rootTextCount: textElements.length,
      scrollParent:
        scrollParent instanceof HTMLElement
          ? {
              clientHeight: scrollParent.clientHeight,
              scrollHeight: scrollParent.scrollHeight,
              scrollTop: scrollParent.scrollTop,
              tagName: scrollParent.tagName,
            }
          : null,
      virtualizerHeight:
        virtualizer instanceof HTMLElement ? virtualizer.offsetHeight : null,
    }
  }, blockIndex)

const waitForMaterializedText = async (page, blockIndex, context) => {
  await page
    .waitForFunction(
      (index) => {
        const root = document.querySelector('[data-slate-editor="true"]')
        const materialized = !!root?.querySelector(
          `[data-slate-node="text"][data-slate-path="${index},0"]`
        )

        if (!materialized) {
          root?.__slateBrowserHandle?.scrollPathIntoView?.([index, 0], 'center')
        }

        return materialized
      },
      blockIndex,
      { timeout: materializationTimeoutMs }
    )
    .catch(async (error) => {
      const diagnostics = await getMaterializationDiagnostics(page, blockIndex)

      throw new Error(
        `Text materialization timed out for ${context.surfaceKey}/${context.laneKey}/iteration-${context.iteration} at block ${blockIndex}: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`
      )
    })
}

const syncDOMSelection = async (page, blockIndex, offset) =>
  page.evaluate(
    ({ index, offset }) => {
      const root = document.querySelector('[data-slate-editor="true"]')

      if (!(root instanceof HTMLElement)) {
        throw new Error('Missing Slate editor root')
      }

      const textElement = root.querySelector(
        `[data-slate-node="text"][data-slate-path="${index},0"]`
      )

      if (!textElement) {
        throw new Error(`Missing DOM text node for block ${index}`)
      }

      const walker = document.createTreeWalker(
        textElement,
        NodeFilter.SHOW_TEXT
      )
      const textNode = walker.nextNode()

      if (!textNode) {
        throw new Error(`Missing DOM text leaf for block ${index}`)
      }

      const range = document.createRange()
      const domSelection = document.getSelection()

      root.focus()
      range.setStart(textNode, offset)
      range.collapse(true)
      domSelection?.removeAllRanges()
      domSelection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      root.__slateBrowserHandle?.importDOMSelection?.()
    },
    { index: blockIndex, offset }
  )

const waitForDOMSelectionPath = async (page, blockIndex, offset) => {
  await page.waitForFunction(
    ({ index, offset }) => {
      const root = document.querySelector('[data-slate-editor="true"]')
      const selection = document.getSelection()
      const textElement = selection?.anchorNode?.parentElement?.closest(
        '[data-slate-node="text"]'
      )

      const inputState = root?.__slateBrowserHandle?.getInputState?.() ?? null

      return (
        textElement?.getAttribute('data-slate-path') === `${index},0` &&
        selection?.anchorOffset === offset &&
        inputState?.preferModelSelection === false &&
        inputState?.selectionSource === 'dom-current'
      )
    },
    { index: blockIndex, offset },
    { timeout: 5000 }
  )
}

const selectCollapsed = async (page, blockIndex, offset, context) => {
  await requestCollapsedSelection(page, blockIndex, offset)
  await waitForMaterializedText(page, blockIndex, context)
  await nextPaint(page)
  await waitForMaterializedText(page, blockIndex, context)
  await syncDOMSelection(page, blockIndex, offset)
  await waitForDOMSelectionPath(page, blockIndex, offset)
  const readyTime = await page.evaluate(() => performance.now())
  await nextPaint(page)
  await waitForDOMSelectionPath(page, blockIndex, offset)

  return { readyTime }
}

const clickMaterializedBlock = async (page, blockIndex, context) => {
  await waitForMaterializedText(page, blockIndex, context)
  const point = await page.evaluate((index) => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const textElement = root?.querySelector(
      `[data-slate-node="text"][data-slate-path="${index},0"]`
    )

    if (!(textElement instanceof HTMLElement)) {
      throw new Error(`Missing click target for block ${index}`)
    }

    const rect = textElement.getBoundingClientRect()

    return {
      x: rect.left + Math.min(Math.max(rect.width * 0.5, 4), rect.width - 2),
      y: rect.top + rect.height / 2,
    }
  }, blockIndex)
  const beforeSelection = await page.evaluate(() => {
    const root = document.querySelector('[data-slate-editor="true"]')

    return root?.__slateBrowserHandle?.getSelection?.() ?? null
  })
  const clickStart = await page.evaluate(() => performance.now())

  await page.mouse.click(point.x, point.y)
  await page
    .waitForFunction(
      ({ beforeSelection, index }) => {
        const pointsEqual = (left, right) =>
          !!left &&
          !!right &&
          left.offset === right.offset &&
          left.path.length === right.path.length &&
          left.path.every((part, pathIndex) => part === right.path[pathIndex])
        const selectionsEqual = (left, right) =>
          !!left &&
          !!right &&
          pointsEqual(left.anchor, right.anchor) &&
          pointsEqual(left.focus, right.focus)
        const root = document.querySelector('[data-slate-editor="true"]')
        const selection = root?.__slateBrowserHandle?.getSelection?.() ?? null

        return (
          selection?.anchor.path[0] === index &&
          selection?.focus.path[0] === index &&
          !selectionsEqual(selection, beforeSelection)
        )
      },
      { beforeSelection, index: blockIndex },
      { timeout: 5000 }
    )
    .catch(async (error) => {
      const diagnostics = await getMaterializationDiagnostics(page, blockIndex)

      throw new Error(
        `Click selection timed out for ${context.surfaceKey}/${context.laneKey}/iteration-${context.iteration} at block ${blockIndex}: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`
      )
    })

  const clickReadyTime = await page.evaluate(() => performance.now())
  const clickPaintTime = await nextPaint(page)

  return {
    clickToPaintMs: clickPaintTime - clickStart,
    clickToSelectionReadyMs: clickReadyTime - clickStart,
  }
}

const measureInteraction = async (page, lane, context) => {
  await resetTrace(page)

  const combinedStart = await page.evaluate(() => performance.now())
  const selectTiming = await selectCollapsed(
    page,
    lane.blockIndex,
    lane.offset,
    {
      ...context,
      laneKey: lane.key,
    }
  )
  const selectPaint = await nextPaint(page)
  const materializedOffset = lane.offset + 1
  const materializedSelectStart = await page.evaluate(() => performance.now())
  const materializedSelectTiming = await selectCollapsed(
    page,
    lane.blockIndex,
    materializedOffset,
    {
      ...context,
      laneKey: lane.key,
    }
  )
  const materializedSelectPaint = await nextPaint(page)
  const preClickBlockIndex =
    lane.blockIndex === 0 ? lane.blockIndex + 1 : lane.blockIndex - 1
  await selectCollapsed(page, preClickBlockIndex, 0, {
    ...context,
    laneKey: lane.key,
  })
  const clickTiming = await clickMaterializedBlock(page, lane.blockIndex, {
    ...context,
    laneKey: lane.key,
  })
  await selectCollapsed(page, lane.blockIndex, materializedOffset, {
    ...context,
    laneKey: lane.key,
  })
  const beforeText = await readBlockText(page, lane.blockIndex)
  const beforeTypeState = await page.evaluate((index) => {
    const root = document.querySelector('[data-slate-editor="true"]')
    const textHost = root?.querySelector(
      `[data-slate-node="text"][data-slate-path="${index},0"]`
    )
    const selection = document.getSelection()
    const anchorElement =
      selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode instanceof Text
          ? selection.anchorNode.parentElement
          : null
    const anchorTextHost = anchorElement?.closest?.('[data-slate-node="text"]')

    return {
      anchorOffset: selection?.anchorOffset ?? null,
      anchorPath: anchorTextHost?.getAttribute('data-slate-path') ?? null,
      handleSelection: root?.__slateBrowserHandle?.getSelection?.() ?? null,
      inputState: root?.__slateBrowserHandle?.getInputState?.() ?? null,
      textHostPath: textHost?.getAttribute('data-slate-path') ?? null,
      textHostSync: textHost?.getAttribute('data-slate-dom-sync') ?? null,
      textHostSyncReason:
        textHost?.getAttribute('data-slate-dom-sync-reason') ?? null,
      textHostText: textHost?.textContent?.replace(/\uFEFF/g, '') ?? null,
    }
  }, lane.blockIndex)

  if (beforeText == null) {
    throw new Error(`Missing initial block text for ${lane.key}`)
  }

  const expectedText =
    beforeText.slice(0, materializedOffset) +
    typeText +
    beforeText.slice(materializedOffset)
  const typeStart = await page.evaluate(() => performance.now())
  await page.keyboard.type(typeText)
  const modelTextPromise = waitForModelBlockText(
    page,
    lane.blockIndex,
    expectedText,
    context
  )

  await page
    .waitForFunction(
      ({ expectedText, index }) => {
        const root = document.querySelector('[data-slate-editor="true"]')
        const textElement = root?.querySelector(
          `[data-slate-node="text"][data-slate-path="${index},0"]`
        )
        const block = textElement?.closest('[data-slate-node="element"]')
        const text =
          (block ?? textElement)?.textContent?.replace(/\uFEFF/g, '') ?? ''

        return text === expectedText
      },
      { expectedText, index: lane.blockIndex },
      { timeout: 10_000 }
    )
    .catch(async (error) => {
      const diagnostics = await getLaneDiagnostics(page, lane, beforeTypeState)

      throw new Error(
        `Typing assertion timed out for ${context.surfaceKey}/${lane.key}/iteration-${context.iteration} at block ${lane.blockIndex}: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`
      )
    })

  const updateTime = await page.evaluate(() => performance.now())
  const modelReadyTime = await modelTextPromise
  const paintTime = await nextPaint(page)
  const afterText = await readBlockText(page, lane.blockIndex)
  const modelPaintTime = paintTime
  const trace = await getTraceSnapshot(page)
  const memory = await getMemoryAndDomTags(page)
  const lastInputAt = Math.max(
    0,
    ...(trace?.inputEvents ?? [])
      .filter((event) => event.inputType === 'insertText')
      .map((event) => event.time)
      .filter(Number.isFinite)
  )
  const typeToPaintMs =
    lastInputAt > 0 ? paintTime - lastInputAt : paintTime - typeStart

  if (afterText !== expectedText || afterText === beforeText) {
    const diagnostics = await getLaneDiagnostics(page, lane, beforeTypeState)

    throw new Error(
      `Native typing did not update ${context.surfaceKey}/${lane.key}/iteration-${context.iteration}: expected=${JSON.stringify(expectedText)} actual=${JSON.stringify(afterText)} before=${JSON.stringify(beforeText)}; diagnostics=${JSON.stringify(diagnostics)}`
    )
  }

  return {
    clickToPaintMs: clickTiming.clickToPaintMs,
    clickToSelectionReadyMs: clickTiming.clickToSelectionReadyMs,
    domTags: memory,
    burstToPaintPerOpMs: (paintTime - typeStart) / typeText.length,
    longAnimationFrameCount: trace?.longAnimationFrames?.length ?? 0,
    longAnimationFrameMaxMs: Math.max(
      0,
      ...(trace?.longAnimationFrames ?? []).map((entry) => entry.duration)
    ),
    longTaskCount: trace?.longTasks?.length ?? 0,
    longTaskMaxMs: Math.max(
      0,
      ...(trace?.longTasks ?? []).map((entry) => entry.duration)
    ),
    materializedSelectReadyMs:
      materializedSelectTiming.readyTime - materializedSelectStart,
    materializedSelectMs: materializedSelectPaint - materializedSelectStart,
    modelBurstToPaintPerOpMs: (modelPaintTime - typeStart) / typeText.length,
    modelTypeToPaintMs: modelPaintTime - typeStart,
    modelTypeToReadyMs: modelReadyTime - typeStart,
    selectReadyMs: selectTiming.readyTime - combinedStart,
    selectMs: selectPaint - combinedStart,
    selectThenTypeToPaintMs: paintTime - combinedStart,
    burstToPaintMs: paintTime - typeStart,
    profiler: summarizeProfilerEvents(trace?.profilerEvents),
    typeToPaintMs,
    typeToUpdateMs: updateTime - typeStart,
  }
}

const summarizeMetric = (samples, key) =>
  summarize(samples.map((sample) => sample[key]))

const summarizeTagSamples = (samples, key) =>
  summarize(
    samples.map((sample) => sample.domTags[key]).filter(Number.isFinite)
  )

const summarizeNumberSamples = (samples, key) =>
  summarize(samples.map((sample) => sample[key]).filter(Number.isFinite))

const summarizeProfilerBuckets = (samples) => {
  const bucketNames = new Set()

  for (const sample of samples) {
    for (const bucketName of Object.keys(sample.profiler ?? {})) {
      bucketNames.add(bucketName)
    }
  }

  return Object.fromEntries(
    [...bucketNames].map((bucketName) => [
      bucketName,
      {
        count: summarize(
          samples.map((sample) => sample.profiler?.[bucketName]?.count ?? 0)
        ),
        durationMs: summarize(
          samples.map(
            (sample) => sample.profiler?.[bucketName]?.durationMs ?? 0
          )
        ),
      },
    ])
  )
}

const summarizeLane = (samples) => ({
  domTags: {
    domNodeCount: summarizeTagSamples(samples, 'domNodeCount'),
    editorElementCount: summarizeTagSamples(samples, 'editorElementCount'),
    editorTextNodeCount: summarizeTagSamples(samples, 'editorTextNodeCount'),
    jsHeapUsedMB: summarizeTagSamples(samples, 'jsHeapUsedMB'),
  },
  longAnimationFrameCount: summarizeMetric(samples, 'longAnimationFrameCount'),
  longAnimationFrameMaxMs: summarizeMetric(samples, 'longAnimationFrameMaxMs'),
  longTaskCount: summarizeMetric(samples, 'longTaskCount'),
  longTaskMaxMs: summarizeMetric(samples, 'longTaskMaxMs'),
  profiler: summarizeProfilerBuckets(samples),
  burstToPaintMs: summarizeMetric(samples, 'burstToPaintMs'),
  burstToPaintPerOpMs: summarizeMetric(samples, 'burstToPaintPerOpMs'),
  clickToPaintMs: summarizeMetric(samples, 'clickToPaintMs'),
  clickToSelectionReadyMs: summarizeMetric(samples, 'clickToSelectionReadyMs'),
  materializedSelectReadyMs: summarizeMetric(
    samples,
    'materializedSelectReadyMs'
  ),
  materializedSelectMs: summarizeMetric(samples, 'materializedSelectMs'),
  modelBurstToPaintPerOpMs: summarizeMetric(
    samples,
    'modelBurstToPaintPerOpMs'
  ),
  modelTypeToPaintMs: summarizeMetric(samples, 'modelTypeToPaintMs'),
  modelTypeToReadyMs: summarizeMetric(samples, 'modelTypeToReadyMs'),
  selectReadyMs: summarizeMetric(samples, 'selectReadyMs'),
  selectMs: summarizeMetric(samples, 'selectMs'),
  selectThenTypeToPaintMs: summarizeMetric(samples, 'selectThenTypeToPaintMs'),
  typeToPaintMs: summarizeMetric(samples, 'typeToPaintMs'),
  typeToUpdateMs: summarizeMetric(samples, 'typeToUpdateMs'),
})

const profilerDurationP95 = (lane, key) =>
  lane.profiler?.[key]?.durationMs?.p95 ?? 0

const profilerCountP95 = (lane, key) => lane.profiler?.[key]?.count?.p95 ?? 0

const measureSurface = async ({ browser, baseUrl, surface }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const laneSamples = Object.fromEntries(lanes.map((lane) => [lane.key, []]))
  const nativeSurfaceSamples = []

  try {
    for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
      const url = `${baseUrl}${surface.path}`

      await page.goto(url, { waitUntil: 'networkidle' })
      await waitForEditorReady(page)
      await installTraceObserver(page)
      nativeSurfaceSamples.push(await waitForNativeSurface(page))

      for (const lane of lanes) {
        const sample = await measureInteraction(page, lane, {
          iteration,
          surfaceKey: surface.key,
        })

        if (iteration > 0) {
          laneSamples[lane.key].push(sample)
        }
      }
    }
  } finally {
    await context.close()
  }

  return {
    label: surface.label,
    lanes: Object.fromEntries(
      Object.entries(laneSamples).map(([key, samples]) => [
        key,
        summarizeLane(samples),
      ])
    ),
    nativeSurface: {
      boundedCount: nativeSurfaceSamples
        .slice(1)
        .filter((sample) => sample.bounded).length,
      completeCount: nativeSurfaceSamples
        .slice(1)
        .filter((sample) => sample.complete).length,
      durationMs: summarizeNumberSamples(
        nativeSurfaceSamples.slice(1),
        'durationMs'
      ),
      observedBlocks: summarizeNumberSamples(
        nativeSurfaceSamples.slice(1),
        'observedBlocks'
      ),
      timeoutCount: nativeSurfaceSamples
        .slice(1)
        .filter((sample) => !sample.complete && !sample.bounded).length,
      timeoutMs: nativeSurfaceTimeoutMs,
    },
    path: surface.path,
  }
}

const run = async () => {
  if (surfaces.length === 0) {
    throw new Error('SLATE_BROWSER_TRACE_SURFACES selected no known surfaces')
  }

  await buildSite()

  const server = await startStaticServer()
  const browser = await chromium.launch({ headless })

  try {
    const summary = {
      artifactPaths: {
        latest: latestArtifactPath,
        run: runArtifactPath,
      },
      meta: {
        blocks,
        browser: 'chromium',
        headless,
        iterations,
        typeOps,
      },
      surfaces: {},
    }

    for (const surface of surfaces) {
      summary.surfaces[surface.key] = await measureSurface({
        baseUrl: server.url,
        browser,
        surface,
      })
    }

    await writeBenchmarkArtifact(latestArtifactPath, summary)
    await writeBenchmarkArtifact(runArtifactPath, summary)

    for (const [key, surface] of Object.entries(summary.surfaces)) {
      console.log(`\n${key} (${surface.label})`)
      console.log(
        `nativeSurface durationMs p95=${surface.nativeSurface.durationMs.p95}, complete=${surface.nativeSurface.completeCount}, bounded=${surface.nativeSurface.boundedCount}, timedOut=${surface.nativeSurface.timeoutCount}, observedBlocks p95=${surface.nativeSurface.observedBlocks.p95}`
      )

      for (const [laneKey, lane] of Object.entries(surface.lanes)) {
        console.log(
          `${laneKey}: selectionReadyMs p95=${lane.selectReadyMs.p95}, selectToPaintMs p95=${lane.selectMs.p95}, materializedSelectionReadyMs p95=${lane.materializedSelectReadyMs.p95}, materializedSelectToPaintMs p95=${lane.materializedSelectMs.p95}, clickToSelectionReadyMs p95=${lane.clickToSelectionReadyMs.p95}, clickToPaintMs p95=${lane.clickToPaintMs.p95}, selectThenTypeToPaintMs p95=${lane.selectThenTypeToPaintMs.p95}, typeToPaintMs p95=${lane.typeToPaintMs.p95}, modelTypeToReadyMs p95=${lane.modelTypeToReadyMs.p95}, modelTypeToPaintMs p95=${lane.modelTypeToPaintMs.p95}, burstToPaintMs p95=${lane.burstToPaintMs.p95}, burstToPaintPerOpMs p95=${lane.burstToPaintPerOpMs.p95}, modelBurstToPaintPerOpMs p95=${lane.modelBurstToPaintPerOpMs.p95}, longTaskMaxMs p95=${lane.longTaskMaxMs.p95}, domNodes p95=${lane.domTags.domNodeCount.p95}, heapMB p95=${round(lane.domTags.jsHeapUsedMB.p95)}`
        )
      }
    }

    const laneSummaries = Object.values(summary.surfaces).flatMap((surface) =>
      Object.values(surface.lanes)
    )
    const maxTypeToPaintP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.typeToPaintMs.p95)
    )
    const maxSelectToPaintP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.selectMs.p95)
    )
    const maxSelectionReadyP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.selectReadyMs.p95)
    )
    const maxMaterializedSelectToPaintP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.materializedSelectMs.p95)
    )
    const maxMaterializedSelectionReadyP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.materializedSelectReadyMs.p95)
    )
    const maxClickToPaintP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.clickToPaintMs.p95)
    )
    const maxClickToSelectionReadyP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.clickToSelectionReadyMs.p95)
    )
    const maxBurstToPaintPerOpP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.burstToPaintPerOpMs.p95)
    )
    const maxModelTypeToPaintP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.modelTypeToPaintMs.p95)
    )
    const maxModelTypeToReadyP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.modelTypeToReadyMs.p95)
    )
    const maxModelBurstToPaintPerOpP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.modelBurstToPaintPerOpMs.p95)
    )
    const maxDomNodesP95 = Math.max(
      ...laneSummaries.map((lane) => lane.domTags.domNodeCount.p95)
    )
    const maxHeapMBP95 = Math.max(
      ...laneSummaries.map((lane) => lane.domTags.jsHeapUsedMB.p95)
    )
    const maxLongTaskP95Ms = Math.max(
      ...laneSummaries.map((lane) => lane.longTaskMaxMs.p95)
    )
    const printSurfaceMetrics = (surfaceKey, prefix) => {
      const surface = summary.surfaces[surfaceKey]

      if (!surface) {
        return
      }

      const surfaceLaneSummaries = Object.values(surface.lanes)
      const maxSurfaceTypeToPaintP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.typeToPaintMs.p95)
      )
      const maxSurfaceSelectToPaintP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.selectMs.p95)
      )
      const maxSurfaceSelectionReadyP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.selectReadyMs.p95)
      )
      const maxSurfaceMaterializedSelectToPaintP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.materializedSelectMs.p95)
      )
      const maxSurfaceMaterializedSelectionReadyP95Ms = Math.max(
        ...surfaceLaneSummaries.map(
          (lane) => lane.materializedSelectReadyMs.p95
        )
      )
      const maxSurfaceClickToPaintP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.clickToPaintMs.p95)
      )
      const maxSurfaceClickToSelectionReadyP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.clickToSelectionReadyMs.p95)
      )
      const maxSurfaceBurstToPaintPerOpP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.burstToPaintPerOpMs.p95)
      )
      const maxSurfaceModelTypeToPaintP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.modelTypeToPaintMs.p95)
      )
      const maxSurfaceModelTypeToReadyP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.modelTypeToReadyMs.p95)
      )
      const maxSurfaceModelBurstToPaintPerOpP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.modelBurstToPaintPerOpMs.p95)
      )
      const maxSurfaceDomNodesP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.domTags.domNodeCount.p95)
      )
      const maxSurfaceHeapMBP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.domTags.jsHeapUsedMB.p95)
      )
      const maxSurfaceLongTaskP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) => lane.longTaskMaxMs.p95)
      )
      const maxSurfaceCoreNotifyListenersP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(lane, 'core-time:notify-listeners')
        )
      )
      const maxSurfaceCoreNotifyListenersCountP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerCountP95(lane, 'core-time:notify-listeners')
        )
      )
      const maxSurfaceCoreNotifyCommitListenersP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(lane, 'core-time:notify-commit-listeners')
        )
      )
      const maxSurfaceCoreNotifyExtensionCommitListenersP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(
            lane,
            'core-time:notify-extension-commit-listeners'
          )
        )
      )
      const maxSurfaceCoreNotifySnapshotListenersP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(lane, 'core-time:notify-snapshot-listeners')
        )
      )
      const maxSurfaceCoreNotifySourceListenersP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(lane, 'core-time:notify-source-listeners')
        )
      )
      const maxSurfaceCoreListenerSnapshotP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(lane, 'core-time:listener-snapshot')
        )
      )
      const maxSurfaceSelectorDispatchP95Ms = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerDurationP95(lane, 'runtime-time:selector-dispatch')
        )
      )
      const maxSurfaceSelectorDispatchCountP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerCountP95(lane, 'runtime-time:selector-dispatch')
        )
      )
      const maxSurfaceSelectorCheckCountP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerCountP95(lane, 'selector:selector-dispatch-checks')
        )
      )
      const maxSurfaceSelectorNotifyCountP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerCountP95(lane, 'selector:selector-dispatch-notifies')
        )
      )
      const maxSurfaceSelectorSubscriptionCountP95 = Math.max(
        ...surfaceLaneSummaries.map((lane) =>
          profilerCountP95(lane, 'selector:selector-dispatch-subscriptions')
        )
      )

      console.log(
        `METRIC ${prefix}_type_to_paint_p95_ms=${round(
          maxSurfaceTypeToPaintP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_select_to_paint_p95_ms=${round(
          maxSurfaceSelectToPaintP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_selection_ready_p95_ms=${round(
          maxSurfaceSelectionReadyP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_materialized_select_to_paint_p95_ms=${round(
          maxSurfaceMaterializedSelectToPaintP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_materialized_selection_ready_p95_ms=${round(
          maxSurfaceMaterializedSelectionReadyP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_click_to_paint_p95_ms=${round(
          maxSurfaceClickToPaintP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_click_to_selection_ready_p95_ms=${round(
          maxSurfaceClickToSelectionReadyP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_burst_to_paint_per_op_p95_ms=${round(
          maxSurfaceBurstToPaintPerOpP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_model_type_to_paint_p95_ms=${round(
          maxSurfaceModelTypeToPaintP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_model_type_to_ready_p95_ms=${round(
          maxSurfaceModelTypeToReadyP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_model_burst_to_paint_per_op_p95_ms=${round(
          maxSurfaceModelBurstToPaintPerOpP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_dom_nodes_p95=${round(maxSurfaceDomNodesP95)}`
      )
      console.log(`METRIC ${prefix}_heap_mb_p95=${round(maxSurfaceHeapMBP95)}`)
      console.log(
        `METRIC ${prefix}_long_task_max_p95_ms=${round(
          maxSurfaceLongTaskP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_notify_listeners_p95_ms=${round(
          maxSurfaceCoreNotifyListenersP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_notify_listeners_count_p95=${round(
          maxSurfaceCoreNotifyListenersCountP95
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_notify_commit_listeners_p95_ms=${round(
          maxSurfaceCoreNotifyCommitListenersP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_notify_extension_commit_listeners_p95_ms=${round(
          maxSurfaceCoreNotifyExtensionCommitListenersP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_notify_snapshot_listeners_p95_ms=${round(
          maxSurfaceCoreNotifySnapshotListenersP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_notify_source_listeners_p95_ms=${round(
          maxSurfaceCoreNotifySourceListenersP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_core_listener_snapshot_p95_ms=${round(
          maxSurfaceCoreListenerSnapshotP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_selector_dispatch_p95_ms=${round(
          maxSurfaceSelectorDispatchP95Ms
        )}`
      )
      console.log(
        `METRIC ${prefix}_selector_dispatch_count_p95=${round(
          maxSurfaceSelectorDispatchCountP95
        )}`
      )
      console.log(
        `METRIC ${prefix}_selector_check_count_p95=${round(
          maxSurfaceSelectorCheckCountP95
        )}`
      )
      console.log(
        `METRIC ${prefix}_selector_notify_count_p95=${round(
          maxSurfaceSelectorNotifyCountP95
        )}`
      )
      console.log(
        `METRIC ${prefix}_selector_subscription_count_p95=${round(
          maxSurfaceSelectorSubscriptionCountP95
        )}`
      )
    }

    console.log(
      `METRIC react_huge_doc_type_to_paint_p95_ms=${round(maxTypeToPaintP95Ms)}`
    )
    console.log(
      `METRIC react_huge_doc_select_to_paint_p95_ms=${round(
        maxSelectToPaintP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_selection_ready_p95_ms=${round(
        maxSelectionReadyP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_materialized_select_to_paint_p95_ms=${round(
        maxMaterializedSelectToPaintP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_materialized_selection_ready_p95_ms=${round(
        maxMaterializedSelectionReadyP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_click_to_paint_p95_ms=${round(
        maxClickToPaintP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_click_to_selection_ready_p95_ms=${round(
        maxClickToSelectionReadyP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_burst_to_paint_per_op_p95_ms=${round(
        maxBurstToPaintPerOpP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_model_type_to_paint_p95_ms=${round(
        maxModelTypeToPaintP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_model_type_to_ready_p95_ms=${round(
        maxModelTypeToReadyP95Ms
      )}`
    )
    console.log(
      `METRIC react_huge_doc_model_burst_to_paint_per_op_p95_ms=${round(
        maxModelBurstToPaintPerOpP95Ms
      )}`
    )
    console.log(`METRIC react_huge_doc_dom_nodes_p95=${round(maxDomNodesP95)}`)
    console.log(`METRIC react_huge_doc_heap_mb_p95=${round(maxHeapMBP95)}`)
    console.log(
      `METRIC react_huge_doc_long_task_max_p95_ms=${round(maxLongTaskP95Ms)}`
    )
    console.log(
      `METRIC react_huge_doc_core_notify_listeners_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(lane, 'core-time:notify-listeners')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_core_notify_listeners_count_p95=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerCountP95(lane, 'core-time:notify-listeners')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_core_notify_commit_listeners_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(lane, 'core-time:notify-commit-listeners')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_core_notify_extension_commit_listeners_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(
              lane,
              'core-time:notify-extension-commit-listeners'
            )
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_core_notify_snapshot_listeners_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(lane, 'core-time:notify-snapshot-listeners')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_core_notify_source_listeners_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(lane, 'core-time:notify-source-listeners')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_core_listener_snapshot_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(lane, 'core-time:listener-snapshot')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_selector_dispatch_p95_ms=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerDurationP95(lane, 'runtime-time:selector-dispatch')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_selector_dispatch_count_p95=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerCountP95(lane, 'runtime-time:selector-dispatch')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_selector_check_count_p95=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerCountP95(lane, 'selector:selector-dispatch-checks')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_selector_notify_count_p95=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerCountP95(lane, 'selector:selector-dispatch-notifies')
          )
        )
      )}`
    )
    console.log(
      `METRIC react_huge_doc_selector_subscription_count_p95=${round(
        Math.max(
          ...laneSummaries.map((lane) =>
            profilerCountP95(lane, 'selector:selector-dispatch-subscriptions')
          )
        )
      )}`
    )
    printSurfaceMetrics('defaultAuto', 'react_huge_doc_auto')
    printSurfaceMetrics('stagedDomPresent', 'react_huge_doc_staged')
    printSurfaceMetrics('stagedDefault', 'react_huge_doc_staged_default')
    printSurfaceMetrics(
      'stagedContentVisibility',
      'react_huge_doc_staged_content_visibility'
    )
    printSurfaceMetrics('virtualized', 'react_huge_doc_virtualized')

    console.log(`\nWrote ${runArtifactPath}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

await run()

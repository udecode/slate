export type SlateReactRenderKind =
  | 'editable'
  | 'element'
  | 'leaf'
  | 'spacer'
  | 'text'
  | 'void'

export type SlateReactRenderProfilerEvent = {
  kind: SlateReactRenderKind
  id?: string | null
  runtimeId?: string | null
}

export type SlateReactRenderProfilerSnapshot = {
  byKey: Record<string, number>
  byKind: Partial<Record<SlateReactRenderKind, number>>
  events: SlateReactRenderProfilerEvent[]
  total: number
}

export type SlateReactRenderProfiler = {
  record: (event: SlateReactRenderProfilerEvent) => void
}

declare global {
  var __SLATE_REACT_RENDER_PROFILER__: SlateReactRenderProfiler | undefined
}

const getRenderKey = (event: SlateReactRenderProfilerEvent) => {
  const id = event.id ?? event.runtimeId

  return id ? `${event.kind}:${id}` : event.kind
}

export const recordSlateReactRender = (
  event: SlateReactRenderProfilerEvent
) => {
  globalThis.__SLATE_REACT_RENDER_PROFILER__?.record(event)
}

export const createSlateReactRenderCounter = () => {
  const events: SlateReactRenderProfilerEvent[] = []

  const snapshot = (): SlateReactRenderProfilerSnapshot => {
    const byKey: Record<string, number> = {}
    const byKind: Partial<Record<SlateReactRenderKind, number>> = {}

    for (const event of events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1
      const key = getRenderKey(event)
      byKey[key] = (byKey[key] ?? 0) + 1
    }

    return {
      byKey,
      byKind,
      events: events.map((event) => ({ ...event })),
      total: events.length,
    }
  }

  return {
    profiler: {
      record(event: SlateReactRenderProfilerEvent) {
        events.push({ ...event })
      },
    },
    reset() {
      events.length = 0
    },
    snapshot,
  }
}

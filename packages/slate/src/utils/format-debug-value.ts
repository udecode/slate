export type DebugValueScrubber = (key: string, value: unknown) => unknown

let debugValueScrubber: DebugValueScrubber | undefined

export const setDebugValueScrubber = (
  scrubber: DebugValueScrubber | null | undefined
) => {
  debugValueScrubber = scrubber ?? undefined
}

export const formatDebugValue = (value: unknown): string => {
  try {
    const seen = new WeakSet<object>()
    const formatted = JSON.stringify(value, (_key, item) => {
      const next = debugValueScrubber ? debugValueScrubber(_key, item) : item

      if (typeof next !== 'object' || next === null) {
        return next
      }

      if (seen.has(next)) {
        return '[Circular]'
      }

      seen.add(next)
      return next
    })

    return formatted ?? String(value)
  } catch {
    try {
      return Object.prototype.toString.call(value)
    } catch {
      return '[Unformattable]'
    }
  }
}

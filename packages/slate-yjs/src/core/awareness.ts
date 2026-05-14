import type {
  YjsAwarenessChange,
  YjsAwarenessState,
  YjsLocalAwareness,
} from './types'

class LocalAwareness implements YjsLocalAwareness {
  clientID: number

  private readonly listeners = new Set<(event: YjsAwarenessChange) => void>()
  private localState: YjsAwarenessState | null = null
  private readonly states = new Map<number, YjsAwarenessState>()

  constructor(clientID: number) {
    this.clientID = clientID
  }

  applyRemoteState(clientId: number, state: YjsAwarenessState | null) {
    const hadState = this.states.has(clientId)
    const currentState = this.states.get(clientId) ?? null

    if (JSON.stringify(currentState) === JSON.stringify(state)) {
      return
    }

    if (state) {
      this.states.set(clientId, { ...state })
      this.emit({
        added: hadState ? [] : [clientId],
        removed: [],
        updated: hadState ? [clientId] : [],
      })
    } else if (hadState) {
      this.states.delete(clientId)
      this.emit({ added: [], removed: [clientId], updated: [] })
    }
  }

  getLocalState() {
    return this.localState ? { ...this.localState } : null
  }

  getStates() {
    return new Map(this.states)
  }

  off(event: 'change', listener: (event: YjsAwarenessChange) => void) {
    if (event === 'change') {
      this.listeners.delete(listener)
    }
  }

  on(event: 'change', listener: (event: YjsAwarenessChange) => void) {
    if (event === 'change') {
      this.listeners.add(listener)
    }
  }

  setLocalState(state: YjsAwarenessState | null) {
    const hadState = this.localState !== null
    this.localState = state ? { ...state } : null

    if (this.localState) {
      this.states.set(this.clientID, this.localState)
      this.emit({
        added: hadState ? [] : [this.clientID],
        removed: [],
        updated: hadState ? [this.clientID] : [],
      })
    } else {
      this.states.delete(this.clientID)
      this.emit({
        added: [],
        removed: hadState ? [this.clientID] : [],
        updated: [],
      })
    }
  }

  setLocalStateField(field: string, value: unknown) {
    this.setLocalState({
      ...(this.localState ?? {}),
      [field]: value,
    })
  }

  private emit(event: YjsAwarenessChange) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

/**
 * Create a deterministic awareness object for tests, examples, and local-only
 * transports. Real providers can pass their own awareness implementation.
 */
export const createYjsLocalAwareness = (clientID: number): YjsLocalAwareness =>
  new LocalAwareness(clientID)

/**
 * Connect two local awareness objects without a network provider.
 */
export const connectYjsLocalAwareness = (
  awarenessA: YjsLocalAwareness,
  awarenessB: YjsLocalAwareness
) => {
  const syncA = () => {
    awarenessB.applyRemoteState(awarenessA.clientID, awarenessA.getLocalState())
  }
  const syncB = () => {
    awarenessA.applyRemoteState(awarenessB.clientID, awarenessB.getLocalState())
  }

  awarenessA.on('change', syncA)
  awarenessB.on('change', syncB)
  syncA()
  syncB()

  return () => {
    awarenessA.off('change', syncA)
    awarenessB.off('change', syncB)
    awarenessA.applyRemoteState(awarenessB.clientID, null)
    awarenessB.applyRemoteState(awarenessA.clientID, null)
  }
}

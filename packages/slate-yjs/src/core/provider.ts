import type {
  YjsProviderLike,
  YjsProviderStatus,
  YjsProviderStatusPayload,
  YjsProviderSyncedPayload,
} from './types'

export const normalizeYjsProviderStatus = (
  value: YjsProviderStatusPayload | unknown
): YjsProviderStatus | null => {
  if (typeof value === 'string') {
    return value
  }

  if (
    value &&
    typeof value === 'object' &&
    'status' in value &&
    typeof value.status === 'string'
  ) {
    return value.status
  }

  return null
}

export const normalizeYjsProviderSynced = (
  value: YjsProviderSyncedPayload | unknown
): boolean | null => {
  if (typeof value === 'boolean') {
    return value
  }

  if (
    value &&
    typeof value === 'object' &&
    'state' in value &&
    typeof value.state === 'boolean'
  ) {
    return value.state
  }

  if (
    value &&
    typeof value === 'object' &&
    'synced' in value &&
    typeof value.synced === 'boolean'
  ) {
    return value.synced
  }

  return null
}

export const readYjsProviderStatus = (provider: YjsProviderLike | undefined) =>
  normalizeYjsProviderStatus(provider?.status)

export const readYjsProviderSynced = (provider: YjsProviderLike | undefined) =>
  normalizeYjsProviderSynced(provider?.synced)

export const connectedFromYjsProviderStatus = (
  status: YjsProviderStatus | null,
  fallback: boolean
) => {
  if (status === 'connected') {
    return true
  }

  if (status === 'connecting' || status === 'disconnected') {
    return false
  }

  return fallback
}

export const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      'then' in value &&
      typeof value.then === 'function'
  )

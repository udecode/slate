import type { ReactNode } from 'react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Descendant } from 'slate'

import type { YjsController, YjsRemoteCursorState } from '../core'

const subscribeController = (controller: YjsController, listener: () => void) =>
  controller.subscribe(listener)

export const useYjsControllerState = (controller: YjsController) =>
  useSyncExternalStore(
    (listener) => subscribeController(controller, listener),
    () => controller.getState(),
    () => controller.getState()
  )

export const useRemoteCursorStates = <TData = unknown>(
  controller: YjsController
): readonly YjsRemoteCursorState<TData>[] => {
  useYjsControllerState(controller)

  return controller.getRemoteCursorStates<TData>()
}

export const useRemoteCursorDecorations = <TData = unknown>(
  controller: YjsController
) => {
  const state = useYjsControllerState(controller)

  return useCallback(
    (entry: [Descendant, number[]]) =>
      controller.getRemoteCursorDecorations<TData>(entry),
    [controller, state.revision]
  )
}

export const useRemoteCursorOverlayPositions = <TData = unknown>(
  controller: YjsController
) => {
  const cursors = useRemoteCursorStates<TData>(controller)

  return useMemo(
    () =>
      cursors.map((cursor) => ({
        clientId: cursor.clientId,
        color: cursor.user?.color ?? '#2563eb',
        name: cursor.user?.name ?? `Peer ${cursor.clientId}`,
        range: cursor.range,
      })),
    [cursors]
  )
}

export const getRemoteCursorsOnLeaf = <TData = unknown>(leaf: {
  yjsRemoteCursorStates?: readonly YjsRemoteCursorState<TData>[]
}) => leaf.yjsRemoteCursorStates ?? []

export const getRemoteCaretsOnLeaf = getRemoteCursorsOnLeaf

export type RemoteCursorOverlayProps<TData = unknown> = {
  className?: string
  controller: YjsController
  renderCursor?: (cursor: YjsRemoteCursorState<TData>) => ReactNode
}

export const RemoteCursorOverlay = <TData,>({
  className,
  controller,
  renderCursor,
}: RemoteCursorOverlayProps<TData>) => {
  const cursors = useRemoteCursorStates<TData>(controller)

  return (
    <div className={className} data-slate-yjs-remote-cursor-overlay="">
      {cursors.map((cursor) => (
        <span
          data-slate-yjs-remote-cursor={cursor.clientId}
          key={cursor.clientId}
          style={{ color: cursor.user?.color ?? '#2563eb' }}
        >
          {renderCursor
            ? renderCursor(cursor)
            : (cursor.user?.name ?? `Peer ${cursor.clientId}`)}
        </span>
      ))}
    </div>
  )
}

export type {
  YjsRemoteCursorDecorationData,
  YjsRemoteCursorState,
} from '../core'

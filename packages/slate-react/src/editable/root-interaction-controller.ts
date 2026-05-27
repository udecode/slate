import { type MouseEventHandler, useCallback, useRef } from 'react'
import type { BaseSelection, Range, RootKey } from 'slate'

import { scheduleSlateReactFocus } from '../hooks/focus-scheduler'
import {
  type focusSlateEditable,
  focusSlateEditableAfterEventFrame,
} from '../hooks/focus-slate-editable'
import type { ReactRuntimeEditor } from '../plugin/react-editor'
import { writeSlateViewSelection } from '../view-selection'
import {
  isRootInteractionEditableFocused,
  type RootInteractionFocusSelection,
  type RootInteractionMouseDownAction,
  type RootInteractionMouseUpAction,
  type RootInteractionSelectionMode,
  resolveRootInteractionMouseDown,
  resolveRootInteractionMouseUp,
  resolveRootInteractionTarget,
} from './root-interaction-resolver'

type SlateFocusableEditor = Parameters<typeof focusSlateEditable>[0]
const MAIN_ROOT_KEY: RootKey = 'main'

export type RootInteractionEditor = Pick<
  ReactRuntimeEditor,
  'read' | 'update'
> &
  SlateFocusableEditor & {
    api: SlateFocusableEditor['api'] & {
      dom: SlateFocusableEditor['api']['dom'] & {
        resolveEventRange: (event: Event) => Range | null
      }
    }
  }

export type RootInteractionControllerOptions = {
  disabled: boolean
  editor: RootInteractionEditor
  getLastSelectionForRoot: (root: RootKey) => BaseSelection
  getMountedViewEditor: (root: RootKey) => RootInteractionEditor | null
  root: RootKey
  selection: RootInteractionSelectionMode
}

export type RootInteractionController = {
  onMouseDownCapture: MouseEventHandler<HTMLElement>
  onMouseUpCapture: MouseEventHandler<HTMLElement>
}

const withInteractionRangeRoot = (range: Range, root: RootKey): Range => {
  if (root === MAIN_ROOT_KEY) {
    return range
  }

  return {
    anchor:
      range.anchor.root === undefined
        ? { ...range.anchor, root }
        : range.anchor,
    focus:
      range.focus.root === undefined ? { ...range.focus, root } : range.focus,
  }
}

export const useRootInteractionController = ({
  disabled,
  editor,
  getLastSelectionForRoot,
  getMountedViewEditor,
  root,
  selection,
}: RootInteractionControllerOptions): RootInteractionController => {
  const pendingActionRef = useRef<RootInteractionMouseDownAction>({
    type: 'ignore',
  })

  const focusRoot = useCallback(
    ({
      forceSelection = false,
      selection: selectionPreference = selection,
    }: {
      forceSelection?: boolean
      selection?: RootInteractionFocusSelection
    } = {}) => {
      const focusEditor = getMountedViewEditor(root) ?? editor
      const getEndSelection = (): Range => {
        const point = focusEditor.read((state) => state.points.end([]))

        return { anchor: point, focus: point }
      }
      const focusSelection =
        selectionPreference === 'end'
          ? getEndSelection()
          : selectionPreference === 'restore' &&
              (forceSelection ||
                !focusEditor.read((state) => state.selection.get()))
            ? (getLastSelectionForRoot(root) ?? getEndSelection())
            : null
      const applyFocusSelection = () => {
        if (!focusSelection) {
          return false
        }

        writeSlateViewSelection(focusEditor, null)
        focusEditor.update((tx) => {
          tx.selection.set(focusSelection)
        })

        return true
      }
      const appliedSelection = applyFocusSelection()

      focusSlateEditableAfterEventFrame(focusEditor)

      if (appliedSelection) {
        globalThis.setTimeout?.(() => {
          applyFocusSelection()
          focusSlateEditableAfterEventFrame(focusEditor)
        }, 0)
      }
    },
    [editor, getLastSelectionForRoot, getMountedViewEditor, root, selection]
  )

  const applyInteractionAction = useCallback(
    (action: RootInteractionMouseUpAction) => {
      if (action.type === 'ignore') {
        return
      }
      const focusEditor = getMountedViewEditor(root) ?? editor

      if (action.type === 'set-selection') {
        writeSlateViewSelection(focusEditor, null)
        focusEditor.update((tx) => {
          tx.selection.set(withInteractionRangeRoot(action.range, root))
        })
        focusSlateEditableAfterEventFrame(focusEditor)
        return
      }

      focusRoot({
        forceSelection: action.selection === 'restore',
        selection: action.selection,
      })
    },
    [editor, focusRoot, getMountedViewEditor, root]
  )

  const onMouseDownCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (disabled || event.defaultPrevented) {
        return
      }

      const target = resolveRootInteractionTarget({
        currentTarget: event.currentTarget,
        target: event.target,
      })
      const editableRoot =
        target.kind === 'editable-root' || target.kind === 'native-editable'
          ? target.editableRoot
          : null
      const action = resolveRootInteractionMouseDown({
        editableRootFocused: editableRoot
          ? isRootInteractionEditableFocused(editableRoot)
          : undefined,
        target,
      })

      pendingActionRef.current = action

      if (action.type === 'ignore') {
        return
      }

      if (action.type === 'focus-native-editable') {
        if (target.kind === 'native-editable') {
          target.editableRoot?.focus({ preventScroll: true })
        }
        pendingActionRef.current = { type: 'ignore' }
        return
      }

      if (action.preventDefault) {
        event.preventDefault()
      }

      if (action.type === 'place-editable-root') {
        return
      }

      scheduleSlateReactFocus(() => {
        applyInteractionAction(
          resolveRootInteractionMouseUp({
            eventRange: null,
            pendingAction: action,
            selection,
          })
        )
      })
    },
    [applyInteractionAction, disabled, selection]
  )

  const onMouseUpCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      const pendingAction = pendingActionRef.current
      pendingActionRef.current = { type: 'ignore' }
      if (pendingAction.type === 'ignore') {
        return
      }

      if (disabled) {
        return
      }

      if ('preventDefault' in pendingAction && pendingAction.preventDefault) {
        event.preventDefault()
      }

      const focusEditor = getMountedViewEditor(root) ?? editor
      const eventRange = focusEditor.api.dom.resolveEventRange(
        event.nativeEvent
      )

      applyInteractionAction(
        resolveRootInteractionMouseUp({
          eventRange,
          pendingAction,
          selection,
        })
      )
    },
    [
      applyInteractionAction,
      disabled,
      editor,
      getMountedViewEditor,
      root,
      selection,
    ]
  )

  return {
    onMouseDownCapture,
    onMouseUpCapture,
  }
}

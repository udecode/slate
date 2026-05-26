import type { Range } from 'slate'

const INTERACTIVE_CHROME_TARGET =
  'a[href], button, input, select, textarea, [contenteditable="true"]:not([data-slate-editor="true"]), [role="button"], [data-slate-root-chrome-ignore="true"]'
const NATIVE_EDITABLE_TARGET =
  '[data-slate-string], [data-slate-zero-width], [data-slate-leaf], [data-slate-node="text"], [data-slate-node="element"]'
const EDITABLE_ROOT_TARGET = '[data-slate-editor="true"]'

export type RootInteractionTarget =
  | { kind: 'external' }
  | { kind: 'interactive-descendant'; target: Element }
  | {
      editableRoot: HTMLElement | null
      kind: 'native-editable'
      target: Element
    }
  | { editableRoot: HTMLElement; kind: 'editable-root'; target: HTMLElement }
  | { kind: 'root-chrome'; target: Element }

export type RootInteractionMouseDownAction =
  | { type: 'ignore' }
  | { preventDefault?: true; type: 'recover-native-click' }
  | { preventDefault: true; type: 'activate-root' }
  | { preventDefault: true; type: 'place-editable-root' }

export type RootInteractionFocusSelection = 'end' | 'preserve' | 'restore'

export type RootInteractionMouseUpAction =
  | { type: 'ignore' }
  | { range: Range; type: 'set-selection' }
  | { selection: RootInteractionFocusSelection; type: 'focus-root' }

export type RootInteractionSelectionMode = 'end' | 'restore'

const eventTargetToElement = (target: EventTarget | null): Element | null => {
  if (target instanceof Element) {
    return target
  }
  if (typeof Text !== 'undefined' && target instanceof Text) {
    return target.parentElement
  }

  return null
}

const hasClosestWithin = (
  currentTarget: HTMLElement,
  target: Element,
  selector: string
) => {
  const match = target.closest(selector)

  return match instanceof Element && currentTarget.contains(match)
}

const findEditableRootTarget = (
  currentTarget: HTMLElement,
  target: Element
): HTMLElement | null => {
  const match = target.closest(EDITABLE_ROOT_TARGET)

  if (match instanceof HTMLElement && currentTarget.contains(match)) {
    return match
  }

  return null
}

const isCurrentTargetEditableRoot = (currentTarget: HTMLElement) =>
  currentTarget.matches(EDITABLE_ROOT_TARGET)

export const isRootInteractionEditableFocused = (target: HTMLElement) =>
  target.ownerDocument.activeElement === target

export const resolveRootInteractionTarget = ({
  currentTarget,
  target,
}: {
  currentTarget: HTMLElement
  target: EventTarget | null
}): RootInteractionTarget => {
  const element = eventTargetToElement(target)

  if (!element || !currentTarget.contains(element)) {
    return { kind: 'external' }
  }

  const editableRoot = findEditableRootTarget(currentTarget, element)

  if (
    isCurrentTargetEditableRoot(currentTarget) &&
    editableRoot &&
    editableRoot !== currentTarget
  ) {
    return { kind: 'interactive-descendant', target: element }
  }

  if (hasClosestWithin(currentTarget, element, INTERACTIVE_CHROME_TARGET)) {
    return { kind: 'interactive-descendant', target: element }
  }

  if (hasClosestWithin(currentTarget, element, NATIVE_EDITABLE_TARGET)) {
    return {
      editableRoot,
      kind: 'native-editable',
      target: element,
    }
  }

  if (element instanceof HTMLElement && element.matches(EDITABLE_ROOT_TARGET)) {
    return {
      editableRoot: element,
      kind: 'editable-root',
      target: element,
    }
  }

  return { kind: 'root-chrome', target: element }
}

export const resolveRootInteractionMouseDown = ({
  editableRootFocused,
  target,
}: {
  editableRootFocused?: boolean
  target: RootInteractionTarget
}): RootInteractionMouseDownAction => {
  if (target.kind === 'external' || target.kind === 'interactive-descendant') {
    return { type: 'ignore' }
  }

  if (target.kind === 'native-editable') {
    if (target.editableRoot && editableRootFocused === false) {
      return { preventDefault: true, type: 'recover-native-click' }
    }

    return { type: 'ignore' }
  }

  if (target.kind === 'editable-root') {
    if (editableRootFocused) {
      return { type: 'ignore' }
    }

    return {
      preventDefault: true,
      type: 'place-editable-root',
    }
  }

  return {
    preventDefault: true,
    type: 'activate-root',
  }
}

export const resolveRootInteractionMouseUp = ({
  eventRange,
  pendingAction,
  selection,
}: {
  eventRange: Range | null
  pendingAction: RootInteractionMouseDownAction
  selection: RootInteractionSelectionMode
}): RootInteractionMouseUpAction => {
  if (pendingAction.type === 'ignore') {
    return { type: 'ignore' }
  }

  if (eventRange) {
    return {
      range: eventRange,
      type: 'set-selection',
    }
  }

  if (pendingAction.type === 'recover-native-click') {
    return {
      selection: 'preserve',
      type: 'focus-root',
    }
  }

  if (pendingAction.type === 'place-editable-root') {
    return {
      selection: 'end',
      type: 'focus-root',
    }
  }

  return {
    selection,
    type: 'focus-root',
  }
}

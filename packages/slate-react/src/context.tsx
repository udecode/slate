import { createContext } from 'react'
import type { Path, RuntimeId } from 'slate'

export { ComposingContext } from './hooks/use-composing'
export { ElementContext } from './hooks/use-element'
export { FocusedContext } from './hooks/use-focused'
export { ReadOnlyContext } from './hooks/use-read-only'
export { EditorContext } from './hooks/use-slate-static'

export const ElementPathContext = createContext<Path | null>(null)
export const NodeRuntimeIdContext = createContext<RuntimeId | null>(null)

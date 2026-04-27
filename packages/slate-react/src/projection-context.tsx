import { createContext } from 'react'

import type { SlateProjectionStore } from './hooks/use-slate-projections'

export const ProjectionContext = createContext<SlateProjectionStore | null>(
  null
)

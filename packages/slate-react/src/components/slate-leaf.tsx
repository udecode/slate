import { createElement, type ReactNode } from 'react'

export const SlateLeaf = ({ children }: { children: ReactNode }) =>
  createElement('span', { 'data-slate-leaf': true }, children)

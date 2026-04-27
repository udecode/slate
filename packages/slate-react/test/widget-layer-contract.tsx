import { act, render } from '@testing-library/react'
import React from 'react'
import { createEditor, Editor } from 'slate'

import {
  createSlateWidgetStore,
  Slate,
  type SlateWidget,
  useSlateSelector,
  useSlateWidgetStore,
  useSlateWidgets,
} from '../src'

const createChildren = () => [
  {
    type: 'paragraph',
    children: [{ text: 'alpha' }],
  },
  {
    type: 'paragraph',
    children: [{ text: 'beta' }],
  },
]

const createRenderCounts = () => ({
  left: 0,
  right: 0,
  selection: 0,
})

const TextSlice = ({
  counts,
  slot,
}: {
  counts: ReturnType<typeof createRenderCounts>
  slot: 'left' | 'right'
}) => {
  const value = useSlateSelector((snapshot) =>
    snapshot?.children?.[slot === 'left' ? 0 : 1] &&
    'children' in snapshot.children[slot === 'left' ? 0 : 1]
      ? String(
          (
            snapshot.children[slot === 'left' ? 0 : 1] as {
              children: { text: string }[]
            }
          ).children[0]?.text ?? ''
        )
      : ''
  )

  counts[slot] += 1

  return <span id={`${slot}-text`}>{value}</span>
}

const MemoTextSlice = React.memo(TextSlice)

const WidgetHarness = ({
  counts,
  editor,
  widgets,
}: {
  counts: ReturnType<typeof createRenderCounts>
  editor: ReturnType<typeof createEditor>
  widgets: readonly SlateWidget<{
    label: string
  }>[]
}) => {
  const widgetStore = useSlateWidgetStore(editor, widgets)
  const widgetSnapshot = useSlateWidgets(widgetStore)

  return (
    <Slate editor={editor} initialValue={Editor.getSnapshot(editor).children}>
      <MemoTextSlice counts={counts} slot="left" />
      <MemoTextSlice counts={counts} slot="right" />
      <span id="widget-state">
        {widgetSnapshot.allIds.length === 0
          ? 'none'
          : widgetSnapshot.allIds
              .map((id) => {
                const widget = widgetSnapshot.byId.get(id)!

                return `${widget.id}:${widget.visible ? 'visible' : 'hidden'}:${
                  widget.data?.label ?? 'none'
                }`
              })
              .join('|')}
      </span>
    </Slate>
  )
}

describe('slate-react widget layer contract', () => {
  test('selection widgets toggle without rerendering text slices', async () => {
    const editor = createEditor()
    const counts = createRenderCounts()

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
    })

    const widgets = [
      {
        anchor: {
          type: 'selection' as const,
        },
        data: {
          label: 'Toolbar',
        },
        id: 'toolbar-widget',
      },
    ] as const

    const mounted = render(
      <WidgetHarness counts={counts} editor={editor} widgets={widgets} />
    )

    expect(counts).toEqual({
      left: 1,
      right: 1,
      selection: 0,
    })
    expect(mounted.container.querySelector('#widget-state')?.textContent).toBe(
      'toolbar-widget:hidden:Toolbar'
    )

    await act(async () => {
      editor.update(() => {
        editor.select({
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 4 },
        })
      })
    })

    expect(counts).toEqual({
      left: 1,
      right: 1,
      selection: 0,
    })
    expect(mounted.container.querySelector('#widget-state')?.textContent).toBe(
      'toolbar-widget:visible:Toolbar'
    )

    await act(async () => {
      editor.update(() => {
        editor.collapse({ edge: 'end' })
      })
    })

    expect(counts).toEqual({
      left: 1,
      right: 1,
      selection: 0,
    })
    expect(mounted.container.querySelector('#widget-state')?.textContent).toBe(
      'toolbar-widget:hidden:Toolbar'
    )

    mounted.unmount()
  })

  test('selection widget stores ignore unrelated text changes', async () => {
    const editor = createEditor()
    let notifications = 0

    Editor.replace(editor, {
      children: createChildren(),
      selection: null,
    })

    const store = createSlateWidgetStore(editor, () => [
      {
        anchor: {
          type: 'selection' as const,
        },
        data: {
          label: 'Toolbar',
        },
        id: 'toolbar-widget',
      },
    ])
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    await act(async () => {
      editor.update(() => {
        editor.insertText('!', {
          at: { path: [0, 0], offset: 5 },
        })
      })
    })

    expect(notifications).toBe(0)

    await act(async () => {
      editor.update(() => {
        editor.select({
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 3 },
        })
      })
    })

    expect(notifications).toBe(1)
    expect(store.getSnapshot().byId.get('toolbar-widget')?.visible).toBe(true)

    unsubscribe()
    store.destroy()
  })
})

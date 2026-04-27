import type {
  Editor,
  EditorCommand,
  EditorCommandHandler,
  EditorCommandOptions,
  EditorCommandResult,
} from '../interfaces/editor'
import { getExtensionRegistry } from './extension-registry'
import {
  getCommandContext,
  updateEditor,
  withCommandContext,
} from './public-state'

type RegisteredCommand = {
  handler: EditorCommandHandler<any>
  order: number
  priority: number
}

let commandOrder = 0

const getCommandRegistry = (editor: Editor) =>
  getExtensionRegistry(editor).commands as Map<string, RegisteredCommand[]>

export const registerCommand = <TCommand extends EditorCommand>(
  editor: Editor,
  type: TCommand['type'],
  handler: EditorCommandHandler<TCommand>,
  { priority = 0 }: EditorCommandOptions = {}
) => {
  const commands = getCommandRegistry(editor)
  const handlers = commands.get(type) ?? []
  const registration = {
    handler,
    order: commandOrder++,
    priority,
  }

  handlers.push(registration)
  handlers.sort((a, b) => b.priority - a.priority || a.order - b.order)
  commands.set(type, handlers)

  return () => {
    const current = getCommandRegistry(editor).get(type)

    if (!current) {
      return
    }

    const index = current.indexOf(registration)
    if (index >= 0) {
      current.splice(index, 1)
    }
  }
}

export const executeCommand = <TCommand extends EditorCommand>(
  editor: Editor,
  command: TCommand,
  defaultHandler: (command: TCommand) => EditorCommandResult,
  options: { implicitUpdate?: boolean } = {}
): EditorCommandResult => {
  const handlers = getCommandRegistry(editor).get(command.type) ?? []

  const dispatch = (
    index: number,
    nextCommand: TCommand
  ): EditorCommandResult => {
    const registration = handlers[index]

    if (!registration) {
      return defaultHandler(nextCommand)
    }

    return (
      registration.handler(
        {
          command: nextCommand,
          editor,
        },
        (overrideCommand = nextCommand) => dispatch(index + 1, overrideCommand)
      ) ?? { handled: false }
    )
  }

  if (getCommandContext(editor)) {
    return dispatch(0, command)
  }

  if (!options.implicitUpdate) {
    return withCommandContext(
      editor,
      { origin: 'command', type: command.type },
      () => dispatch(0, command)
    )
  }

  let result: EditorCommandResult = { handled: false }
  updateEditor(editor, () => {
    result = withCommandContext(
      editor,
      { origin: 'command', type: command.type },
      () => dispatch(0, command)
    )
  })

  return result
}

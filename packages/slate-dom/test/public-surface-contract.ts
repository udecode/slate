import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createEditor } from 'slate'

import * as SlateDOM from '../src'

const packageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url)
)
const tsdownConfigPath = fileURLToPath(
  new URL('../tsdown.config.mts', import.meta.url)
)
const reactEditorDocsPath = fileURLToPath(
  new URL(
    '../../../docs/libraries/slate-react/react-editor.md',
    import.meta.url
  )
)

const extractDocumentedCapabilityMethods = (
  source: string,
  capability: 'clipboard' | 'dom'
) =>
  [
    ...source.matchAll(
      new RegExp(`#### \`editor\\.api\\.${capability}\\.([A-Za-z0-9_]+)`, 'g')
    ),
  ]
    .map((match) => match[1])
    .sort()

describe('slate-dom public surface contract', () => {
  it('keeps the package README aligned to the public DOM and coverage APIs', () => {
    const readme = readFileSync(
      fileURLToPath(new URL('../README.md', import.meta.url)),
      'utf8'
    )

    assert.match(readme, /editor\.api\.dom\.focus\(\)/)
    assert.match(readme, /editor\.api\.clipboard\.insertTextData/)
    assert.match(readme, /import \{ DOMCoverage \} from 'slate-dom'/)
    assert.match(readme, /DOM coverage boundaries model same-root content/)
    assert.match(readme, /Framework packages own bridge installation/)
  })

  it('publishes root export declarations through the export map', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      description: string
      exports: Record<string, unknown>
      scripts: Record<string, string>
    }

    assert.equal(
      packageJson.description,
      'DOM bridge and browser utilities for Slate editors.'
    )
    assert.deepEqual(packageJson.exports['.'], {
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    })
    assert.deepEqual(packageJson.exports['./internal'], {
      types: './dist/internal/index.d.ts',
      import: './dist/internal/index.js',
      default: './dist/internal/index.js',
    })
    assert.equal(
      packageJson.scripts.build,
      'tsdown --config ./tsdown.config.mts --log-level warn'
    )
  })

  it('keeps exported package subpaths backed by build entries', () => {
    const tsdownConfig = readFileSync(tsdownConfigPath, 'utf8')

    assert.match(tsdownConfig, /index:\s*'src\/index\.ts'/)
    assert.match(
      tsdownConfig,
      /'internal\/index':\s*'src\/internal\/index\.ts'/
    )
  })

  it('keeps the internal DOMEditor static namespace out of the public root at runtime', () => {
    assert.equal('DOMEditor' in SlateDOM, false)
    assert.equal('withDOM' in SlateDOM, false)
    assert.equal(typeof SlateDOM.dom, 'function')
  })

  it('keeps weak-map runtime state out of the public root at runtime', () => {
    for (const name of [
      'EDITOR_TO_ELEMENT',
      'EDITOR_TO_FORCE_RENDER',
      'EDITOR_TO_KEY_TO_ELEMENT',
      'EDITOR_TO_PENDING_ACTION',
      'EDITOR_TO_PENDING_DIFFS',
      'EDITOR_TO_PENDING_INSERTION_MARKS',
      'EDITOR_TO_PENDING_SELECTION',
      'EDITOR_TO_PLACEHOLDER_ELEMENT',
      'EDITOR_TO_ROOT_VIEW_EDITORS',
      'EDITOR_TO_SCHEDULE_FLUSH',
      'EDITOR_TO_USER_MARKS',
      'EDITOR_TO_USER_SELECTION',
      'EDITOR_TO_WINDOW',
      'ELEMENT_TO_NODE',
      'IS_COMPOSING',
      'IS_FOCUSED',
      'IS_NODE_MAP_DIRTY',
      'IS_READ_ONLY',
      'MARK_PLACEHOLDER_SYMBOL',
      'NODE_TO_ELEMENT',
      'NODE_TO_INDEX',
      'NODE_TO_KEY',
      'NODE_TO_PARENT',
      'NODE_TO_RUNTIME_ID',
      'PLACEHOLDER_SYMBOL',
    ]) {
      assert.equal(name in SlateDOM, false, `${name} must stay internal`)
    }
  })

  it('keeps the public dom capability surface explicit', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })

    assert.deepEqual(Object.keys(editor.api.dom).sort(), [
      'assertDOMNode',
      'assertDOMPoint',
      'assertDOMRange',
      'assertEventRange',
      'assertPath',
      'assertSlateNode',
      'assertSlatePoint',
      'assertSlateRange',
      'blur',
      'deselect',
      'findDocumentOrShadowRoot',
      'findKey',
      'focus',
      'getWindow',
      'hasDOMNode',
      'hasEditableTarget',
      'hasRange',
      'hasSelectableTarget',
      'hasTarget',
      'isComposing',
      'isFocused',
      'isReadOnly',
      'isTargetInsideNonReadonlyVoid',
      'resolveDOMNode',
      'resolveDOMPoint',
      'resolveDOMRange',
      'resolveEventRange',
      'resolvePath',
      'resolveRangeRect',
      'resolveSlateNode',
      'resolveSlatePoint',
      'resolveSlateRange',
    ])
  })

  it('keeps React DOM API docs aligned to the runtime capability surface', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })
    const docs = readFileSync(reactEditorDocsPath, 'utf8')

    assert.deepEqual(
      extractDocumentedCapabilityMethods(docs, 'dom'),
      Object.keys(editor.api.dom).sort()
    )
    assert.deepEqual(
      extractDocumentedCapabilityMethods(docs, 'clipboard'),
      Object.keys(editor.api.clipboard).sort()
    )
  })

  it('publishes DOM coverage boundaries for public examples and docs', () => {
    assert.equal(typeof SlateDOM.DOMCoverage, 'object')
    assert.equal(typeof SlateDOM.DOMCoverage.registerBoundary, 'function')
    assert.equal(typeof SlateDOM.DOMCoverage.getBoundaries, 'function')
    assert.equal(typeof SlateDOM.DOMCoverage.materializeBoundary, 'function')
  })

  it('publishes Hotkeys as a named export without a default-export alias', () => {
    const rootSource = readFileSync(
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      'utf8'
    )
    const hotkeySource = readFileSync(
      fileURLToPath(new URL('../src/utils/hotkeys.ts', import.meta.url)),
      'utf8'
    )

    assert.equal(typeof SlateDOM.Hotkeys, 'object')
    assert.equal(typeof SlateDOM.Hotkeys.isUndo, 'function')
    assert.doesNotMatch(rootSource, /default as Hotkeys/)
    assert.match(hotkeySource, /export const Hotkeys =/)
    assert.doesNotMatch(hotkeySource, /export default/)
  })

  it('treats nodes from torn down DOM views as non-DOM values', () => {
    const tornDownTextNode = {
      nodeType: 3,
      ownerDocument: {
        defaultView: {},
      },
    }

    assert.doesNotThrow(() => SlateDOM.isDOMNode(tornDownTextNode))
    assert.equal(SlateDOM.isDOMNode(tornDownTextNode), false)
    assert.equal(SlateDOM.isDOMText(tornDownTextNode), false)
  })

  it('exposes nullable resolver methods without try-style aliases', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })
    const resolverNames = [
      'resolveDOMNode',
      'resolveDOMPoint',
      'resolveDOMRange',
      'resolveEventRange',
      'resolvePath',
      'resolveRangeRect',
      'resolveSlateNode',
      'resolveSlatePoint',
      'resolveSlateRange',
    ]

    for (const name of resolverNames) {
      assert.equal(
        typeof editor.api.dom[name as keyof typeof editor.api.dom],
        'function'
      )
    }

    for (const name of Object.keys(editor.api.dom)) {
      assert.equal(
        /^try/i.test(name),
        false,
        `${name} must not use try* naming`
      )
    }
  })

  it('keeps Android text-repair internals off the public dom capability', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })

    assert.equal('androidPendingDiffs' in editor.api.dom, false)
    assert.equal('androidScheduleFlush' in editor.api.dom, false)
  })

  it('uses resolve/assert names for DOM mapping contracts', () => {
    const editor = createEditor({ extensions: [SlateDOM.dom()] })
    const assertNames = [
      'assertDOMNode',
      'assertDOMPoint',
      'assertDOMRange',
      'assertEventRange',
      'assertPath',
      'assertSlateNode',
      'assertSlatePoint',
      'assertSlateRange',
    ]
    const removedStrictMappingNames = [
      'findEventRange',
      'findPath',
      'toDOMNode',
      'toDOMPoint',
      'toDOMRange',
      'toSlateNode',
      'toSlatePoint',
      'toSlateRange',
    ]

    for (const name of assertNames) {
      assert.equal(
        typeof editor.api.dom[name as keyof typeof editor.api.dom],
        'function',
        `${name} should expose the assertion contract`
      )
    }

    for (const name of removedStrictMappingNames) {
      assert.equal(
        name in editor.api.dom,
        false,
        `${name} should not be public DOM mapping API`
      )
    }
  })
})

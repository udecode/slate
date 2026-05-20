export const EXAMPLE_NAMES_AND_PATHS = [
  ['Android Tests', 'android-tests'],
  ['Checklists', 'check-lists'],
  ['Code Highlighting', 'code-highlighting'],
  ['Custom Placeholder', 'custom-placeholder'],
  ['DOM Coverage Boundaries', 'dom-coverage-boundaries'],
  ['Editable Voids', 'editable-voids'],
  ['Embeds', 'embeds'],
  ['Linting', 'linting'],
  ['Forced Layout', 'forced-layout'],
  ['Highlighted Text', 'highlighted-text'],
  ['Hovering Toolbar', 'hovering-toolbar'],
  ['Huge Document', 'huge-document'],
  ['Images', 'images'],
  ['Inlines', 'inlines'],
  ['Markdown Preview', 'markdown-preview'],
  ['Markdown Shortcuts', 'markdown-shortcuts'],
  ['Mentions', 'mentions'],
  ['Paste HTML', 'paste-html'],
  ['Persistent Annotation Anchors', 'persistent-annotation-anchors'],
  ['Plain Text', 'plaintext'],
  ['Read-only', 'read-only'],
  ['Comment Mode', 'comment-mode'],
  ['Rendering in iframes', 'iframe'],
  ['Rich Text', 'richtext'],
  ['Search Highlighting', 'search-highlighting'],
  ['Shadow DOM', 'shadow-dom'],
  ['Styling', 'styling'],
  ['Tables', 'tables'],
] as const

export const HIDDEN_EXAMPLES = [
  'android-tests',
  'dom-coverage-boundaries',
  'persistent-annotation-anchors',
] as const

const hiddenExamplePaths: readonly string[] = HIDDEN_EXAMPLES

export const NON_HIDDEN_EXAMPLES = EXAMPLE_NAMES_AND_PATHS.filter(
  ([, path]) => !hiddenExamplePaths.includes(path)
)

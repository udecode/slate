export const EXAMPLE_NAMES_AND_PATHS = [
  ['Android Tests', 'android-tests'],
  ['Checklists', 'check-lists'],
  ['Code Highlighting', 'code-highlighting'],
  ['Collaborative Comments', 'collaborative-comments'],
  ['Custom Placeholder', 'custom-placeholder'],
  ['DOM Coverage Boundaries', 'dom-coverage-boundaries'],
  ['Editable Voids', 'editable-voids'],
  ['Embeds', 'embeds'],
  ['External Decoration Sources', 'external-decoration-sources'],
  ['Forced Layout', 'forced-layout'],
  ['Highlighted Text', 'highlighted-text'],
  ['Hovering Toolbar', 'hovering-toolbar'],
  ['Huge Document', 'huge-document'],
  ['Rendering Strategy Runtime', 'rendering-strategy-runtime'],
  ['Experimental Virtualized Rendering', 'rendering-strategy-virtualized'],
  ['Images', 'images'],
  ['Inlines', 'inlines'],
  ['Markdown Preview', 'markdown-preview'],
  ['Markdown Shortcuts', 'markdown-shortcuts'],
  ['Mentions', 'mentions'],
  ['Paste HTML', 'paste-html'],
  ['Persistent Annotation Anchors', 'persistent-annotation-anchors'],
  ['Plain Text', 'plaintext'],
  ['Read-only', 'read-only'],
  ['Review Comments', 'review-comments'],
  ['Rendering in iframes', 'iframe'],
  ['Rich Text', 'richtext'],
  ['Scroll Into View', 'scroll-into-view'],
  ['Search Highlighting', 'search-highlighting'],
  ['Shadow DOM', 'shadow-dom'],
  ['Styling', 'styling'],
  ['Tables', 'tables'],
] as const

export const HIDDEN_EXAMPLES = [
  'android-tests',
  'dom-coverage-boundaries',
] as const

export const NON_HIDDEN_EXAMPLES = EXAMPLE_NAMES_AND_PATHS.filter(
  ([, path]) => !HIDDEN_EXAMPLES.includes(path as any)
)

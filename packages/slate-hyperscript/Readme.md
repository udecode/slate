# slate-hyperscript

JSX hyperscript helpers for Slate tests and fixtures.

Use this package when a test reads better as nested JSX than as raw JSON
objects. Runtime editor code should use normal Slate node values.

```tsx
/** @jsx jsx */
import { jsx } from 'slate-hyperscript'

const editor = (
  <editor>
    <element type="paragraph">
      alpha
      <cursor />
    </element>
  </editor>
)
```

Use `createHyperscript({ elements })` to define domain tags for fixtures.

Root exports:

- `jsx`: default JSX factory with Slate's built-in fixture tags.
- `createHyperscript`: custom JSX factory builder.
- `createEditor` and `createText`: low-level creators for custom factories and
  fixture helpers.
- `HyperscriptCreators` and `HyperscriptShorthands`: TypeScript helper types
  for custom factories.

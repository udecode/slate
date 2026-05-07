# withReact

Adds React and DOM specific behaviors to the editor.

### `withReact<T extends Editor>(editor: T, options?: ReactEditorOptions): T & ReactEditor`

When used with withHistory, withReact should be applied outside. For example:

```typescript
const [editor] = useState(() => withReact(withHistory(createEditor())))
```

##### `options.clipboardFormatKey`

`clipboardFormatKey` customizes the `DataTransfer` type used for Slate's
internal fragment payload. The default key is `x-slate-fragment`, which writes
and reads `application/x-slate-fragment`.

```typescript
const [editor] = useState(() =>
  withReact(createEditor(), { clipboardFormatKey: 'x-product-fragment' })
)
```

Use a custom key when multiple Slate editors with different schemas can exchange
clipboard data. Slate only imports an internal fragment when the MIME payload or
embedded HTML fallback matches the receiving editor's key. Otherwise, paste
continues through custom `dom.clipboard.insertData` handlers or plain text.

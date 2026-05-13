# PathRef API

`PathRef` objects keep a specific path synced over time as operations are applied. They are low-level location values used by Slate internals and advanced runtime code. You can access their property `current` for the up-to-date `Path` value. When you no longer need to track this location, call `unref()` to free the resources. The `affinity` refers to the direction the `PathRef` will go when content is inserted at the current position of the `Path`.

```typescript
interface PathRef {
  current: Path | null
  affinity: 'forward' | 'backward' | null
  unref(): Path | null
}
```

- [Instance methods](path-ref.md#instance-methods)
- [Static methods](path-ref.md#static-methods)
  - [Transform methods](path-ref.md#trasnform-methods)

## Instance methods

#### `unref() => Path | null`

Free the resources used by the PathRefApi. This should be called when you no longer need to track the path. Returns the final path value before being unrefed, or null if the path was already invalid.

## Static methods

### Transform methods

#### `PathRefApi.transform(ref: PathRef, op: Operation)`

Transform the path refs current value by an `op`.
The editor calls this as needed, so normally you won't need to.

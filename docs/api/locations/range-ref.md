# RangeRef API

`RangeRef` objects keep a specific range synced over time as operations are applied. They are low-level location values used by Slate internals and advanced runtime code. You can access their property `current` for the up-to-date `Range` value. When you no longer need to track this location, call `unref()` to free the resources. The `affinity` refers to the direction the `RangeRef` will go when content is inserted at the edges of the `Range`. `inward` means that the `Range` tends to stay the same size when content is inserted at its edges, and `outward` means that the `Range` tends to grow when content is inserted at its edges.

```typescript
interface RangeRef {
  current: Range | null
  affinity: 'forward' | 'backward' | 'outward' | 'inward' | null
  unref(): Range | null
}
```

- [Instance methods](range-ref.md#instance-methods)
- [Static methods](range-ref.md#static-methods)
  - [Transform methods](range-ref.md#transform-methods)

## Instance methods

#### `unref() => Range | null`

Call this when you no longer need to sync this range.
It also returns the current value.

## Static methods

### Transform methods

#### `RangeRef.transform(ref: RangeRef, op: Operation)`

Transform the range refs current value by an `op`.
The editor calls this as needed, so normally you won't need to.

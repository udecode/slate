# PointRef API

`PointRef` objects keep a specific point synced over time as operations are applied. They are low-level location values used by Slate internals and advanced runtime code. You can access their property `current` for the up-to-date `Point` value. When you no longer need to track this location, call `unref()` to free the resources. The `affinity` refers to the direction the `PointRef` will go when content is inserted at the current position of the `Point`.

```typescript
interface PointRef {
  current: Point | null
  affinity: 'forward' | 'backward' | null
  unref(): Point | null
}
```

- [Instance methods](point-ref.md#instance-methods)
- [Static methods](point-ref.md#static-methods)
  - [Transform methods](point-ref.md#trasnform-methods)

## Instance methods

#### `unref() => Point | null`

Call this when you no longer need to sync this point.
It also returns the current value.

## Static methods

### Transform methods

#### `PointRef.transform(ref: PointRef, op: Operation)`

Transform the point refs current value by an `op`.
The editor calls this as needed, so normally you won't need to.
